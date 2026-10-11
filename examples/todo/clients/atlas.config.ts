import { fileURLToPath } from 'node:url';

import type { Driver, EventMatcher, EventSource, HttpClient } from '@crvouga/atlas';
import type { SignalContext } from '@crvouga/atlas/signals';
import { cloudEventsHttpSource, combineDrivers, combineImplementations, defineConfig, httpDriver } from '@crvouga/atlas';
import { label, role, screen, text } from '@crvouga/atlas/signals';
import { bunWebViewDriver } from '@crvouga/atlas-bun';
import { PHONE, playwrightDriver } from '@crvouga/atlas-playwright';
import { webdriverDriver } from '@crvouga/atlas-webdriver';

import type { TodoServer } from '../server';
import { DEFAULT_LIST_NAME, EVENT_TYPES, startTodoServer } from '../server';

/**
 * The shared list chart, run with three clients at once: a phone and a desktop (each a browser
 * on any driver) and the sync server (plain HTTP). The implementation is written once against
 * signals, so each device can be played by any driver:
 *
 *   ATLAS_PHONE=playwright|bun|webdriver   (default playwright)
 *   ATLAS_DESKTOP=playwright|bun|webdriver (default playwright)
 *
 * `bun` needs the Bun runtime (`bun --bun atlas run ...`). `webdriver` needs a server: set
 * ATLAS_WEBDRIVER_URL to a running one, or ATLAS_WEBDRIVER_COMMAND to start one (chromedriver,
 * safaridriver, geckodriver); ATLAS_WEBDRIVER_BROWSER picks the browser (default chrome) and
 * ATLAS_CHROME_BINARY a Chrome build.
 */

const PORT = Number(process.env.TODO_CLIENTS_PORT ?? 4318);
const TODO = 'Water the plants';

let started: Promise<{ server: TodoServer; events: EventSource & { url: string } }> | null = null;
const start = () =>
  (started ??= (async () => {
    const events = await cloudEventsHttpSource();
    const server = await startTodoServer({ port: PORT, eventSink: events.url });
    return { server, events };
  })());
const appUrl = async () => (await start()).server.url;

type DriverKind = 'playwright' | 'bun' | 'webdriver';
type Device = { width: number; height: number; scale: number; mobile: boolean };
const PHONE_SIZE: Device = { width: 390, height: 844, scale: 3, mobile: true };
const DESKTOP_SIZE: Device = { width: 1280, height: 800, scale: 2, mobile: false };

function kindOf(variable: string): DriverKind {
  const value = process.env[variable] ?? 'playwright';
  if (value === 'playwright' || value === 'bun' || value === 'webdriver') return value;
  throw new Error(`${variable} must be playwright, bun or webdriver, not "${value}"`);
}

function webdriverCapabilities(device: Device): Record<string, unknown> {
  const browserName = process.env.ATLAS_WEBDRIVER_BROWSER ?? 'chrome';
  if (browserName !== 'chrome') return { browserName };
  const binary = process.env.ATLAS_CHROME_BINARY;
  return {
    browserName,
    'goog:chromeOptions': {
      args: ['--headless=new', `--window-size=${device.width},${device.height}`],
      ...(binary ? { binary } : {}),
      ...(device.mobile ? { mobileEmulation: { deviceMetrics: { width: device.width, height: device.height, pixelRatio: device.scale, touch: true } } } : {})
    }
  };
}

function deviceDriver(kind: DriverKind, device: Device): Driver<SignalContext> {
  if (kind === 'bun') return bunWebViewDriver({ baseUrl: appUrl, width: device.width, height: device.height });
  if (kind === 'webdriver') {
    const command = process.env.ATLAS_WEBDRIVER_COMMAND;
    return webdriverDriver({
      ...(process.env.ATLAS_WEBDRIVER_URL ? { url: process.env.ATLAS_WEBDRIVER_URL } : command ? { server: { command } } : {}),
      capabilities: webdriverCapabilities(device),
      baseUrl: appUrl
    });
  }
  return playwrightDriver({
    baseUrl: appUrl,
    device: device.mobile ? PHONE : { viewport: { width: device.width, height: device.height }, deviceScaleFactor: device.scale }
  });
}

type Clients = { phone: SignalContext; desktop: SignalContext; server: HttpClient };

const reload = async (ctx: SignalContext) => ctx.goto('/');

const implementation = combineImplementations<Clients>(
  {
    phone: {
      setup: (phone) => phone.goto('/'),
      events: {
        'Sets up on the phone': {
          kind: 'user',
          how: 'Taps "Get started", then "Skip for now".',
          async run(phone) {
            await phone.user.tap(role('button', 'Get started'), 'Get started');
            await phone.user.tap(role('button', 'Skip for now'), 'Skip for now');
          }
        },
        'Adds a todo on the phone': {
          kind: 'user',
          how: `Types "${TODO}" and taps "Add".`,
          async run(phone) {
            await phone.user.type(label('New todo'), TODO, 'New todo');
            await phone.user.tap(role('button', 'Add', { exact: true }), 'Add');
          }
        },
        'Refreshes the phone': { kind: 'user', how: 'Reloads the app on the phone.', run: reload }
      },
      states: {
        'Welcome on the phone': screen({ all: [role('heading', 'Plan your day'), role('button', 'Get started')] }),
        'Empty list on the phone': screen({ all: [role('heading', DEFAULT_LIST_NAME), text('Nothing to do yet')] }),
        'Todo open on the phone': screen({ all: [text(TODO), text('1 left', { exact: true })] }),
        'Done on both': screen({ all: [text('All done!')], lookIn: reload }),
        'Offline on the phone': screen({
          all: [text('Offline', { exact: true })],
          checks: [{ check: 'Says changes are kept on this device', signal: text('Changes are kept on this device') }]
        })
      }
    },
    desktop: {
      events: {
        'Opens the list on the desktop': { kind: 'user', how: 'Opens the app in a desktop browser.', run: reload },
        'Marks all done on the desktop': {
          kind: 'user',
          how: 'Taps "Mark all done" on the desktop.',
          run: (desktop) => desktop.user.tap(role('button', 'Mark all done'), 'Mark all done')
        }
      },
      states: {
        'Todo open on the desktop': screen({ all: [text(TODO), text('1 left', { exact: true })], lookIn: reload }),
        'Done on the desktop': screen({ all: [text('All done!')] })
      }
    },
    server: {
      events: {
        'Sync server drops the connection': {
          kind: 'system',
          how: 'POSTs /control/sync-failure, so the next sync check of each device fails.',
          async run(server) {
            const response = await server.post('/control/sync-failure', { checks: 2 }, { label: 'The sync server drops the connection' });
            if (!response.ok) throw new Error(`/control/sync-failure answered ${response.status}`);
          }
        }
      }
    }
  },
  {
    async setup({ server }) {
      const response = await server.post('/control/reset');
      if (!response.ok) throw new Error(`/control/reset answered ${response.status}`);
    }
  }
);

const phone = kindOf('ATLAS_PHONE');
const desktop = kindOf('ATLAS_DESKTOP');

export default defineConfig<Clients>({
  specs: fileURLToPath(new URL('./specs', import.meta.url)),
  driver: async () => {
    const { server } = await start();
    const driver = combineDrivers<Clients>(
      { phone: deviceDriver(phone, PHONE_SIZE), desktop: deviceDriver(desktop, DESKTOP_SIZE), server: httpDriver(server.url, { name: 'todo-server' }) },
      { screens: 'all' }
    );
    return {
      ...driver,
      async dispose() {
        await driver.dispose?.();
        await server.close();
        started = null;
      }
    };
  },
  implementation,
  eventSources: async () => [(await start()).events],
  eventMatchers: Object.fromEntries(Object.entries(EVENT_TYPES).map(([name, type]): [string, EventMatcher] => [name, { type }])),
  targets: [`http://127.0.0.1:${PORT}`],
  output: fileURLToPath(new URL('../atlas-runs', import.meta.url)),
  environment: { app: 'todo example' }
});
