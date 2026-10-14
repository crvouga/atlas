/**
 * @module Playwright driver
 *
 * `playwrightDriver()` is the core `Driver` that runs a statechart's paths against a web app (or a React Native app
 * on the web) in Chromium. Each path attempt gets its own browser context and page; the `PlaywrightContext` it passes
 * to event and state implementations carries the page and paced user actions. Screens are recognised by signals
 * (`signals.ts`), and screenshots, clips and touch overlay come from `media.ts`.
 *
 * @see docs/statecharts.md
 */
import type { Driver } from '../../core/src/index';
import type { SignalContext } from '../../core/src/signals';
import type { Browser, BrowserContext, BrowserContextOptions, LaunchOptions, Page } from 'playwright';
import { chromium } from 'playwright';

import type { Pacing } from './media';
import { captureScreen, FAST_PACING, PHONE, ScreencastRecorder, SHOWCASE_PACING, UserActions } from './media';
import { locate } from './signals';

/**
 * What every Playwright event and recogniser receives for one path attempt. It is a
 * `SignalContext` too, so implementations written against signals run here unchanged.
 */
export type PlaywrightContext = SignalContext & {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  /** Paced taps and typing, logged to the step's timeline and shown by the touch overlay in videos. */
  user: UserActions;
};

/** Options of `playwrightDriver`; every field is optional. */
export type PlaywrightDriverOptions = {
  /** Where `goto` paths resolve; the implementation's setup decides where to open. */
  baseUrl?: string | (() => string | Promise<string>);
  /** Browser context options; a 390×844 phone at device scale factor 3 with touch by default. */
  device?: BrowserContextOptions;
  /** Options for `chromium.launch`. */
  launch?: LaunchOptions;
  /** Override the pacing used in showcase mode. */
  pacing?: Partial<Pacing>;
  /** Install Playwright's fake clock before the app loads, so time events can jump it. */
  clock?: boolean;
  /** Save a Playwright trace for failed attempts (default true). */
  traceOnFailure?: boolean;
  /**
   * Which attempts record a trace: `retry` (default) traces only the retry of a failed path, which
   * keeps first attempts fast; `always` traces every attempt so even a first failure has one.
   */
  trace?: 'retry' | 'always';
  /** Called after the page is created and before the implementation's setup. */
  onPage?: (page: Page) => Promise<void>;
  /** Browser contexts open at once (one per worker); unlimited when omitted. */
  concurrency?: number;
};

/**
 * Drives a web app (or a React Native app on the web) in Chromium with Playwright, for `atlas run`. Pass it in the
 * config as `driver: () => playwrightDriver(options)`. The browser launches on first use (and again if it was
 * disconnected) and is shared by every context; each path attempt opens a fresh context from `options.device`
 * (default `PHONE`). Screenshots are taken at the device's physical resolution; clips are recorded at that
 * resolution too and encoded with FFmpeg as H.264 MP4. FFmpeg must be on the PATH: each screenshot also writes a
 * WebP thumbnail with it, so without FFmpeg no screenshot is recorded (the run goes on). A Playwright trace is
 * kept only for a failed attempt that was traced (see `trace`), and `dispose` closes the browser.
 *
 * @see docs/statecharts.md
 *
 * @example
 * ```ts
 * import { defineConfig } from '@crvouga/atlas';
 * import { playwrightDriver, screen, text } from '@crvouga/atlas/playwright';
 *
 * export default defineConfig({
 *   specs: './specs',
 *   driver: () => playwrightDriver({ clock: true }),
 *   implementation: {
 *     async setup({ page }) { await page.goto('http://127.0.0.1:4317'); },
 *     events: {
 *       // one entry per event of the spec
 *     },
 *     states: { 'No todos': screen({ all: [text('Nothing to do yet')] }) }
 *   }
 * });
 * ```
 */
export function playwrightDriver(options: PlaywrightDriverOptions = {}): Driver<PlaywrightContext> {
  let browser: Promise<Browser> | null = null;
  const tracedContexts = new WeakSet<BrowserContext>();
  const device = options.device ?? PHONE;
  const scale = device.deviceScaleFactor ?? 1;
  const showcasePacing = { ...SHOWCASE_PACING, ...options.pacing };
  const ensureBrowser = async () => {
    const current = browser ? await browser.catch(() => null) : null;
    if (current?.isConnected()) return current;
    browser = chromium.launch(options.launch);
    return browser;
  };
  return {
    name: 'playwright',
    pacing: { before: showcasePacing.holdBeforeMs, after: showcasePacing.holdAfterMs },
    concurrency: options.concurrency ?? Number.POSITIVE_INFINITY,
    async open({ mode, timeline, attempt }) {
      const b = await ensureBrowser();
      const context = await b.newContext(device);
      const tracing = options.traceOnFailure !== false && (options.trace === 'always' || attempt > 1);
      if (tracing) await context.tracing.start({ screenshots: true, snapshots: true });
      tracedContexts.add(context);
      if (!tracing) tracedContexts.delete(context);
      const page = await context.newPage();
      const showcase = mode === 'showcase';
      if (showcase) await UserActions.install(page);
      if (options.clock) await page.clock.install();
      await options.onPage?.(page);
      const baseUrl = typeof options.baseUrl === 'function' ? await options.baseUrl() : options.baseUrl;
      return {
        page,
        context,
        browser: b,
        user: new UserActions(page, showcase ? showcasePacing : FAST_PACING, timeline, showcase),
        goto: async (url) => {
          await page.goto(baseUrl ? new URL(url, baseUrl).href : url);
        },
        isVisible: (signal) => locate(page, signal).isVisible().catch(() => false)
      };
    },
    async close(ctx, { failed, traceFile }) {
      let trace: string | undefined;
      if (tracedContexts.delete(ctx.context)) {
        if (failed) {
          await ctx.context.tracing.stop({ path: traceFile }).catch(() => undefined);
          trace = traceFile;
        } else {
          await ctx.context.tracing.stop().catch(() => undefined);
        }
      }
      await ctx.context.close().catch(() => undefined);
      return trace ? { trace } : undefined;
    },
    screenshot: (ctx, file) => captureScreen(ctx.page, ctx.user, file),
    async record(ctx, workDirectory) {
      const recorder = new ScreencastRecorder(ctx.page, scale);
      await recorder.start(workDirectory);
      return { stop: (output) => recorder.stop(output) };
    },
    text: (ctx) => ctx.page.evaluate(() => document.body.innerText),
    hold: (ctx, ms) => ctx.page.waitForTimeout(ms),
    async dispose() {
      const current = browser;
      browser = null;
      await current?.then((b) => b.close()).catch(() => undefined);
    }
  };
}
