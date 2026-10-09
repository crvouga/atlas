import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Driver, Timeline } from '@crvouga/atlas';
import type { DomProbeResult, Signal, SignalContext } from '@crvouga/atlas/signals';
import { recordFrames } from '@crvouga/atlas';
import { DOM_PROBE, describeSignal, signatureScreen, toWire } from '@crvouga/atlas/signals';

/** The parts of `Bun.WebView` the driver uses, typed structurally so it builds without Bun's types. */
export type BunWebView = {
  readonly url: string;
  navigate(url: string): Promise<void>;
  reload(): Promise<void>;
  evaluate(script: string): Promise<unknown>;
  screenshot(options?: { format?: 'png' | 'jpeg' | 'webp'; quality?: number; encoding?: 'buffer' }): Promise<Uint8Array>;
  click(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  press(key: string, options?: { modifiers?: string[] }): Promise<void>;
  resize(width: number, height: number): Promise<void>;
  close(): void;
};

type WebViewOptions = {
  width?: number;
  height?: number;
  headless?: boolean;
  backend?: 'webkit' | 'chrome';
  dataStore?: 'ephemeral' | { directory: string };
};
type WebViewConstructor = new (options: WebViewOptions) => BunWebView;

/** What every event and recogniser receives: the view, and paced user actions logged to the timeline. */
export type WebViewContext = SignalContext & {
  view: BunWebView;
  baseUrl: string | undefined;
  /** Navigate, relative to `baseUrl`. */
  goto(url: string): Promise<void>;
  /** Run a JavaScript expression in the page and return its JSON result. */
  evaluate(script: string): Promise<unknown>;
  /** Where a signal is on screen right now. */
  find(signal: Signal, options?: { scroll?: boolean }): Promise<DomProbeResult>;
  user: {
    tap(target: Signal, label: string): Promise<void>;
    type(target: Signal, text: string, label: string): Promise<void>;
    press(key: string, label?: string): Promise<void>;
  };
};

export type BunWebViewDriverOptions = {
  /** Where `goto` paths resolve; the implementation's setup decides where to open. */
  baseUrl?: string | (() => string | Promise<string>);
  /** Viewport in CSS pixels; a 390×844 phone by default. */
  width?: number;
  height?: number;
  /** `webkit` (macOS default, the system WKWebView) or `chrome` (CDP; the default elsewhere). */
  backend?: 'webkit' | 'chrome';
  /** How long a tap waits for its target to show, in milliseconds (default 10 000). */
  actionTimeoutMs?: number;
  /** Showcase pacing, in milliseconds. */
  pacing?: { before: number; after: number };
};

function webViewConstructor() {
  const bun = (globalThis as { Bun?: { WebView?: WebViewConstructor } }).Bun;
  if (!bun?.WebView) {
    throw new Error('bunWebViewDriver needs the Bun runtime with Bun.WebView: run atlas with `bun --bun atlas run` (or `bunx --bun atlas run`)');
  }
  return bun.WebView;
}

function contextFor(view: BunWebView, baseUrl: string | undefined, timeline: Timeline, options: BunWebViewDriverOptions): WebViewContext {
  const timeoutMs = options.actionTimeoutMs ?? 10_000;
  const find = async (signal: Signal, { scroll = false } = {}) =>
    (await view.evaluate(`(${DOM_PROBE})(${JSON.stringify(toWire(signal))}, ${scroll})`)) as DomProbeResult;
  const waitFor = async (signal: Signal) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = await find(signal, { scroll: true });
      if (found.visible && found.x !== undefined && found.y !== undefined) return { x: found.x, y: found.y };
      if (Date.now() > deadline) throw new Error(`${describeSignal(signal)} is not on screen`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const ctx: WebViewContext = {
    view,
    baseUrl,
    goto: (url) => view.navigate(baseUrl ? new URL(url, baseUrl).href : url),
    evaluate: (script) => view.evaluate(script),
    find,
    isVisible: async (signal) => (await find(signal)).visible,
    user: {
      async tap(target, label) {
        const { x, y } = await waitFor(target);
        timeline.add({ kind: 'tap', label, x, y });
        await view.click(x, y);
      },
      async type(target, text, label) {
        const { x, y } = await waitFor(target);
        timeline.add({ kind: 'type', label, text, x, y });
        await view.click(x, y);
        await view.type(text);
      },
      async press(key, label) {
        timeline.add({ kind: 'tap', label: label ?? key });
        await view.press(key);
      }
    }
  };
  return ctx;
}

/**
 * Drive a web app in Bun's built-in headless browser: the system WebKit on macOS (nothing to
 * install), Chrome over CDP elsewhere. A view starts in milliseconds and screenshots take about
 * ten, so it is the quickest way to run a chart against a real page. Clips are encoded from
 * screenshots with FFmpeg. Needs the Bun runtime; there is no fake clock, so time events use the
 * app's own controls.
 */
export function bunWebViewDriver(options: BunWebViewDriverOptions = {}): Driver<WebViewContext> {
  const width = options.width ?? 390;
  const height = options.height ?? 844;
  return {
    name: 'bun-webview',
    pacing: options.pacing ?? { before: 400, after: 900 },
    async open({ timeline }) {
      const WebView = webViewConstructor();
      const view = new WebView({ width, height, headless: true, ...(options.backend ? { backend: options.backend } : {}) });
      const baseUrl = typeof options.baseUrl === 'function' ? await options.baseUrl() : options.baseUrl;
      return contextFor(view, baseUrl, timeline, options);
    },
    async close(ctx) {
      ctx.view.close();
    },
    async screenshot(ctx, file) {
      const png = await ctx.view.screenshot({ format: 'png', encoding: 'buffer' });
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, png);
      return { png: file };
    },
    async record(ctx, workDirectory) {
      return recordFrames(() => ctx.view.screenshot({ format: 'jpeg', quality: 90, encoding: 'buffer' }), workDirectory, { extension: 'jpg' });
    },
    text: async (ctx) => String(await ctx.view.evaluate('document.body ? document.body.innerText : ""')),
    hold: (_ctx, ms) => new Promise((r) => setTimeout(r, ms))
  };
}

/** A state recognised from its signals in the page: every `all` visible and no `none` visible. */
export const screen = signatureScreen<WebViewContext>((ctx, signal) => ctx.isVisible(signal), describeSignal);
