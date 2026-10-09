import type { Driver } from '@crvouga/atlas';
import type { SignalContext } from '@crvouga/atlas/signals';
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

export type PlaywrightDriverOptions = {
  /** Where `goto` paths resolve; the implementation's setup decides where to open. */
  baseUrl?: string | (() => string | Promise<string>);
  /** Browser context options; a 390×844 phone at device scale factor 3 with touch by default. */
  device?: BrowserContextOptions;
  launch?: LaunchOptions;
  /** Override the pacing used in showcase mode. */
  pacing?: Partial<Pacing>;
  /** Install Playwright's fake clock before the app loads, so time events can jump it. */
  clock?: boolean;
  /** Save a Playwright trace for failed attempts (default true). */
  traceOnFailure?: boolean;
  /** Called after the page is created and before the implementation's setup. */
  onPage?: (page: Page) => Promise<void>;
};

/**
 * Drive a web app (or a React Native app on the web) with Playwright. Screenshots are taken at the
 * device's physical resolution; clips are recorded at that resolution too and encoded with
 * FFmpeg as H.264 MP4 (FFmpeg on the PATH is needed for video and WebP thumbnails).
 */
export function playwrightDriver(options: PlaywrightDriverOptions = {}): Driver<PlaywrightContext> {
  let browser: Browser | null = null;
  const device = options.device ?? PHONE;
  const scale = device.deviceScaleFactor ?? 1;
  const showcasePacing = { ...SHOWCASE_PACING, ...options.pacing };
  const ensureBrowser = async () => {
    if (!browser || !browser.isConnected()) browser = await chromium.launch(options.launch);
    return browser;
  };
  return {
    name: 'playwright',
    pacing: { before: showcasePacing.holdBeforeMs, after: showcasePacing.holdAfterMs },
    async open({ mode, timeline }) {
      const b = await ensureBrowser();
      const context = await b.newContext(device);
      if (options.traceOnFailure !== false) await context.tracing.start({ screenshots: true, snapshots: true });
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
      if (options.traceOnFailure !== false) {
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
      await browser?.close().catch(() => undefined);
      browser = null;
    }
  };
}
