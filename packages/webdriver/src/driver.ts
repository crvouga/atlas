import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

import type { Driver, Timeline } from '@crvouga/atlas';
import type { Signal, SignalContext } from '@crvouga/atlas/signals';
import { recordFrames } from '@crvouga/atlas';
import { DOM_PROBE, describeSignal, signatureScreen, toWire } from '@crvouga/atlas/signals';

import type { Locator } from './protocol';
import { waitForServer, WebDriverSession } from './protocol';

/** What a step points at: a signal (resolved per platform) or a raw WebDriver locator. */
export type Target = Signal | Locator;

export type Mode = 'web' | 'native';

/** What every event and recogniser receives: the session and user actions logged to the timeline. */
export type WebDriverContext = SignalContext & {
  session: WebDriverSession;
  mode: Mode;
  baseUrl: string | undefined;
  /** Navigate, relative to `baseUrl` (a deep link in a native session). */
  goto(url: string): Promise<void>;
  /** The first visible element a target resolves to, or null. */
  find(target: Target): Promise<string | null>;
  isVisible(target: Target): Promise<boolean>;
  user: {
    tap(target: Target, label: string): Promise<void>;
    type(target: Target, text: string, label: string): Promise<void>;
  };
};

export type WebDriverServer = {
  /** The server binary: `safaridriver`, `chromedriver`, `geckodriver`, `appium`. */
  command: string;
  /** `{port}` is replaced with the port. Defaults: `--port {port}` (`--port={port}` for chromedriver). */
  args?: string[];
  port?: number;
  readyTimeoutMs?: number;
};

export type WebDriverDriverOptions = {
  /** A running WebDriver server; or set `server` to start one for the run. */
  url?: string;
  server?: WebDriverServer;
  /** W3C capabilities (`alwaysMatch`), e.g. `{ browserName: 'safari' }` or Appium's `platformName`, `appium:app`. */
  capabilities: Record<string, unknown>;
  /** `web` resolves signals in the DOM; `native` resolves them in the accessibility tree. Inferred from the capabilities. */
  mode?: Mode;
  /** Where `goto` paths resolve; the implementation's setup decides where to open. */
  baseUrl?: string | (() => string | Promise<string>);
  /** `per-attempt` (default) starts a fresh session (browser or app) for every path attempt; `per-run` reuses one. */
  session?: 'per-attempt' | 'per-run';
  /** Clips: `frames` (default) encodes screenshots with FFmpeg; `appium` uses Appium's screen recorder; `none`. */
  recording?: 'frames' | 'appium' | 'none';
  /** How long a tap waits for its target, in milliseconds (default 15 000). */
  actionTimeoutMs?: number;
  name?: string;
  pacing?: { before: number; after: number };
};

function inferMode(capabilities: Record<string, unknown>): Mode {
  if (capabilities.browserName) return 'web';
  const native = ['appium:app', 'appium:bundleId', 'appium:appPackage', 'appium:appActivity'].some((k) => k in capabilities);
  return native || /^(ios|android)$/i.test(String(capabilities.platformName ?? '')) ? 'native' : 'web';
}

const xpathLiteral = (value: string) => {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value
    .split("'")
    .map((part) => `'${part}'`)
    .join(`, "'", `)})`;
};

/** iOS (XCUITest) and Android (UiAutomator2) element types for the common roles. */
const NATIVE_ROLES: Record<string, string[]> = {
  button: ['XCUIElementTypeButton', 'android.widget.Button', 'android.widget.ImageButton'],
  textbox: ['XCUIElementTypeTextField', 'XCUIElementTypeSecureTextField', 'XCUIElementTypeTextView', 'android.widget.EditText'],
  checkbox: ['XCUIElementTypeSwitch', 'android.widget.CheckBox', 'android.widget.Switch'],
  switch: ['XCUIElementTypeSwitch', 'android.widget.Switch'],
  link: ['XCUIElementTypeLink'],
  img: ['XCUIElementTypeImage', 'android.widget.ImageView'],
  heading: []
};
const TEXT_ATTRIBUTES = ['label', 'name', 'value', 'text', 'content-desc'];

/** A signal as a native locator: test IDs are accessibility identifiers, text is any label, value or text. */
export function nativeLocator(signal: Signal): Locator | null {
  const name = describeSignal(signal);
  if ('testId' in signal) return { using: 'accessibility id', value: signal.testId, name };
  if ('css' in signal) throw new Error(`${name}: CSS selectors only work in web sessions`);
  const match = 'label' in signal ? signal.label : 'role' in signal ? signal.name : signal.text;
  const exact = 'exact' in signal && signal.exact === true;
  if (match instanceof RegExp) return null;
  const types = 'role' in signal ? (NATIVE_ROLES[signal.role] ?? []) : [];
  const typeTest = types.length ? `(${types.map((t) => `self::${t}`).join(' or ')})` : '';
  const attributes = 'label' in signal ? ['label', 'name', 'content-desc', 'hint'] : TEXT_ATTRIBUTES;
  const textTest = match === undefined ? '' : `(${attributes.map((a) => (exact ? `@${a}=${xpathLiteral(match)}` : `contains(@${a}, ${xpathLiteral(match)})`)).join(' or ')})`;
  const tests = [typeTest, textTest].filter(Boolean).join(' and ');
  return { using: 'xpath', value: `//*${tests ? `[${tests}]` : ''}`, name };
}

/** Elements of an Appium page source whose text attributes match a pattern and that are shown. */
function sourceMatches(source: string, pattern: RegExp) {
  const results: Record<string, string>[] = [];
  for (const tag of source.matchAll(/<([\w.]+)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g)) {
    const attributes = Object.fromEntries([...(tag[2] ?? '').matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
    if (attributes.visible === 'false' || attributes.displayed === 'false') continue;
    if (TEXT_ATTRIBUTES.some((a) => attributes[a] !== undefined && pattern.test(attributes[a]!))) results.push(attributes);
  }
  return results;
}

const isLocator = (target: Target): target is Locator => 'using' in target;
const describe = (target: Target) => (isLocator(target) ? (target.name ?? `${target.using} ${target.value}`) : describeSignal(target));

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function contextFor(session: WebDriverSession, mode: Mode, baseUrl: string | undefined, timeline: Timeline, timeoutMs: number): WebDriverContext {
  const resolve = async (target: Target): Promise<string | null> => {
    if (isLocator(target)) {
      for (const element of await session.findElements(target)) if (await session.isDisplayed(element).catch(() => false)) return element;
      return null;
    }
    if (mode === 'web') {
      const found = (await session.execute(`return (${DOM_PROBE})(arguments[0], arguments[1], true)`, [toWire(target), true])) as { visible?: boolean; element?: unknown };
      return found?.visible ? session.elementId(found.element) : null;
    }
    const locator = nativeLocator(target);
    if (locator) return resolve(locator);
    const pattern = 'label' in target ? target.label : 'role' in target ? target.name : 'text' in target ? target.text : undefined;
    if (!(pattern instanceof RegExp)) return null;
    const [first] = sourceMatches(await session.source(), pattern);
    const key = first && TEXT_ATTRIBUTES.find((a) => first[a] !== undefined && pattern.test(first[a]!));
    return key ? resolve({ using: 'xpath', value: `//*[@${key}=${xpathLiteral(first[key]!)}]` }) : null;
  };
  const waitFor = async (target: Target) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const element = await resolve(target).catch(() => null);
      if (element) return element;
      if (Date.now() > deadline) throw new Error(`${describe(target)} is not on screen`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const centre = async (element: string) => {
    const r = await session.rect(element).catch(() => null);
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : {};
  };
  return {
    session,
    mode,
    baseUrl,
    goto: (url) => session.navigate(baseUrl ? new URL(url, baseUrl).href : url),
    find: resolve,
    isVisible: async (target) => Boolean(await resolve(target)),
    user: {
      async tap(target, label) {
        const element = await waitFor(target);
        timeline.add({ kind: 'tap', label, ...(await centre(element)) });
        await session.click(element);
      },
      async type(target, text, label) {
        const element = await waitFor(target);
        timeline.add({ kind: 'type', label, text, ...(await centre(element)) });
        await session.click(element).catch(() => undefined);
        await session.sendKeys(element, text);
      }
    }
  };
}

/**
 * Drive anything that speaks W3C WebDriver: Safari (safaridriver ships with macOS), Chrome,
 * Firefox and Edge, or a native iOS or Android app through Appium. Signals resolve in the DOM
 * for web sessions and in the accessibility tree for native ones (test IDs are accessibility
 * identifiers), so one implementation style covers both. Screenshots and the page source are
 * standard; clips are encoded from screenshots, or come from Appium's screen recorder.
 */
export function webdriverDriver(options: WebDriverDriverOptions): Driver<WebDriverContext> {
  const mode = options.mode ?? inferMode(options.capabilities);
  const timeoutMs = options.actionTimeoutMs ?? 15_000;
  let server: { url: string; process: ChildProcess | null } | null = null;
  let shared: WebDriverSession | null = null;

  const serverUrl = async () => {
    if (server) return server.url;
    if (options.url) {
      server = { url: options.url, process: null };
      return server.url;
    }
    if (!options.server) throw new Error('webdriverDriver needs `url` (a running WebDriver server) or `server` (a command to start one)');
    const port = options.server.port ?? (await freePort());
    const defaults = /chromedriver|msedgedriver/.test(options.server.command) ? ['--port={port}'] : ['--port', '{port}'];
    const args = (options.server.args ?? defaults).map((a) => a.replaceAll('{port}', String(port)));
    const child = spawn(options.server.command, args, { stdio: 'ignore' });
    const url = `http://127.0.0.1:${port}`;
    const exited = new Promise<never>((_, reject) => {
      child.once('error', (e) => reject(new Error(`Could not start ${options.server!.command}: ${e.message}`)));
      child.once('exit', (code) => reject(new Error(`${options.server!.command} exited with code ${code}`)));
    });
    await Promise.race([waitForServer(url, options.server.readyTimeoutMs ?? 30_000), exited]);
    server = { url, process: child };
    return url;
  };

  const startSession = async () => WebDriverSession.create(await serverUrl(), options.capabilities);

  return {
    name: options.name ?? (mode === 'native' ? `webdriver:${String(options.capabilities.platformName ?? 'native').toLowerCase()}` : `webdriver:${String(options.capabilities.browserName ?? 'browser')}`),
    pacing: options.pacing ?? { before: 400, after: 900 },
    async open({ timeline }) {
      const session = options.session === 'per-run' ? (shared ??= await startSession()) : await startSession();
      const baseUrl = typeof options.baseUrl === 'function' ? await options.baseUrl() : options.baseUrl;
      return contextFor(session, mode, baseUrl, timeline, timeoutMs);
    },
    async close(ctx) {
      if (options.session !== 'per-run') await ctx.session.delete().catch(() => undefined);
    },
    async screenshot(ctx, file) {
      const png = await ctx.session.screenshot();
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, png);
      return { png: file };
    },
    ...(options.recording === 'none'
      ? {}
      : {
          async record(ctx: WebDriverContext, workDirectory: string) {
            if (options.recording !== 'appium') return recordFrames(() => ctx.session.screenshot(), workDirectory);
            await ctx.session.command('POST', '/appium/start_recording_screen', { options: { forceRestart: true } });
            const started = Date.now();
            return {
              async stop(output: string) {
                const video = await ctx.session.command('POST', '/appium/stop_recording_screen', {}).catch(() => null);
                if (!video) return null;
                mkdirSync(path.dirname(output), { recursive: true });
                writeFileSync(output, Buffer.from(String(video), 'base64'));
                return { video: output, durationMs: Date.now() - started };
              }
            };
          }
        }),
    async text(ctx) {
      if (ctx.mode === 'web') return String(await ctx.session.execute('return document.body ? document.body.innerText : ""'));
      return sourceMatches(await ctx.session.source(), /\S/)
        .map((a) => TEXT_ATTRIBUTES.map((k) => a[k]).find(Boolean))
        .join('\n');
    },
    async dispose() {
      await shared?.delete().catch(() => undefined);
      shared = null;
      server?.process?.kill();
      server = null;
    }
  };
}

/** A state recognised from signals or locators: every `all` visible and no `none` visible. */
export const screen = signatureScreen<WebDriverContext, Target>(async (ctx, target) => Boolean(await ctx.find(target)), describe);
