import { fileURLToPath } from 'node:url';

import type { EventMatcher, EventSource, Implementation } from '@crvouga/atlas';
import { cloudEventsHttpSource, defineConfig } from '@crvouga/atlas';
import type { PlaywrightContext } from '@crvouga/atlas-playwright';
import { css, playwrightDriver, role, screen, text } from '@crvouga/atlas-playwright';

import type { TodoServer } from './server';
import { DEFAULT_LIST_NAME, EVENT_TYPES, RETRY_AFTER_MS, startTodoServer } from './server';

const PORT = Number(process.env.TODO_EXAMPLE_PORT ?? 4317);
const LIST_NAME = 'Weekend chores';
const TODO = 'Water the plants';

/**
 * The app server and the CloudEvents endpoint it reports business events to, started once per
 * run (when the runner asks for the driver) and stopped when the driver is disposed.
 */
let started: Promise<{ server: TodoServer; events: EventSource & { url: string } }> | null = null;
const start = () =>
  (started ??= (async () => {
    const events = await cloudEventsHttpSource();
    const server = await startTodoServer({ port: PORT, eventSink: events.url });
    return { server, events };
  })());

const implementation: Implementation<PlaywrightContext> = {
  async setup({ page }) {
    const { server } = await start();
    await fetch(`${server.url}/control/reset`, { method: 'POST' });
    await page.goto(server.url);
  },

  events: {
    'Starts setup': {
      kind: 'user',
      how: 'Taps "Get started".',
      run: ({ page, user }) => user.tap(page.getByRole('button', { name: 'Get started' }), 'Get started')
    },
    'Types a list name': {
      kind: 'user',
      how: `Types "${LIST_NAME}" into the list name field.`,
      run: ({ page, user }) => user.type(page.getByLabel('List name'), LIST_NAME, 'List name')
    },
    'Creates the list': {
      kind: 'user',
      how: 'Taps "Create list" and waits for the server to answer.',
      async run({ page, user }) {
        const created = page.waitForResponse((r) => r.url().endsWith('/api/setup'));
        await user.tap(page.getByRole('button', { name: 'Create list' }), 'Create list');
        await created;
      }
    },
    'Skips naming the list': {
      kind: 'user',
      how: 'Taps "Skip for now" and waits for the server to answer.',
      async run({ page, user }) {
        const created = page.waitForResponse((r) => r.url().endsWith('/api/setup'));
        await user.tap(page.getByRole('button', { name: 'Skip for now' }), 'Skip for now');
        await created;
      }
    },
    'Setup completes': {
      kind: 'hand-off',
      how: 'The app opens the new list by itself.',
      run: async () => undefined
    },
    'Setup completes with the default list': {
      kind: 'hand-off',
      how: 'The app opens the default list by itself.',
      run: async () => undefined
    },
    'Adds a todo': {
      kind: 'user',
      how: `Types "${TODO}" and taps "Add".`,
      async run({ page, user }) {
        await user.type(page.getByLabel('New todo'), TODO, 'New todo');
        await user.tap(page.getByRole('button', { name: 'Add', exact: true }), 'Add');
      }
    },
    'Marks all done': {
      kind: 'user',
      how: 'Taps "Mark all done".',
      run: ({ page, user }) => user.tap(page.getByRole('button', { name: 'Mark all done' }), 'Mark all done')
    },
    'Clears completed todos': {
      kind: 'user',
      how: 'Taps "Clear completed".',
      run: ({ page, user }) => user.tap(page.getByRole('button', { name: 'Clear completed' }), 'Clear completed')
    },
    'Starts over': {
      kind: 'user',
      how: 'Taps "Start over".',
      run: ({ page, user }) => user.tap(page.getByRole('button', { name: 'Start over' }), 'Start over')
    },
    'Sync fails': {
      kind: 'system',
      how: 'POSTs /control/sync-failure on the app server, so its next sync check fails.',
      async run(_ctx, { timeline }) {
        const { server } = await start();
        const response = await fetch(`${server.url}/control/sync-failure`, { method: 'POST' });
        timeline.add({
          kind: 'system',
          label: 'The sync server drops the connection',
          system: { source: 'todo server', endpoint: '/control/sync-failure', responseStatus: response.status }
        });
        if (!response.ok) throw new Error(`/control/sync-failure answered ${response.status}`);
      }
    },
    'Retry timer elapses': {
      kind: 'time',
      how: 'Jumps the page clock forward 30 seconds (Playwright clock).',
      async run({ page }, { timeline }) {
        timeline.add({ kind: 'time', label: '30 seconds pass' });
        await page.clock.fastForward(RETRY_AFTER_MS);
      }
    }
  },

  states: {
    Welcome: screen({ all: [role('heading', 'Plan your day'), role('button', 'Get started')] }),
    'Naming the list': screen({ all: [role('heading', 'Name your list'), css('[data-testid="create-list"]:disabled')] }),
    'List name entered': screen({ all: [role('heading', 'Name your list'), css('[data-testid="create-list"]:enabled')] }),
    'List ready': screen({ all: [role('heading', LIST_NAME)], transient: true }),
    'Default list kept': screen({ all: [role('heading', DEFAULT_LIST_NAME)], transient: true }),
    Synced: screen({ all: [text('All changes synced')], none: [text('Offline')] }),
    Offline: screen({
      all: [text('Offline')],
      none: [text('All changes synced')],
      checks: [{ check: 'Says changes are kept on this device', signal: text('Changes are kept on this device') }]
    }),
    'No todos': screen({ all: [text('Nothing to do yet')] }),
    'Some todos open': screen({ all: [text(/^\d+ left$/), role('button', 'Mark all done')] }),
    'All todos done': screen({ all: [text('All done!'), role('button', 'Clear completed')], none: [text(/^\d+ left$/)] })
  }
};

export default defineConfig<PlaywrightContext>({
  specs: fileURLToPath(new URL('./specs', import.meta.url)),
  driver: async () => {
    const { server } = await start();
    const driver = playwrightDriver({ clock: true });
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
  environment: { app: 'todo example', browser: 'chromium' }
});
