# Reference: bun

The Bun WebView driver for statechart runs. Import path `@crvouga/atlas/bun`.

> Generated from the doc comments of `packages/bun/src` by `bun run docs`. Do not edit: change the comment next to the code.

### Bun WebView driver

Source: `packages/bun/src/driver.ts`

`bunWebViewDriver()` is the core `Driver` that runs a statechart's paths in Bun's built-in headless browser
(`Bun.WebView`), the quickest way to run a chart against a real page. It provides a `WebViewContext` whose
`user.tap` and `user.type` act on `Signal`s, found by the shared in-page DOM probe from core, so an implementation
written against `SignalContext` runs here and on the other web drivers unchanged. `Bun.WebView` is typed
structurally (`BunWebView`), so this package builds without Bun's types; at run time the Bun runtime is required.

See docs/statecharts.md

#### `BunWebView`

```ts
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
```

The parts of `Bun.WebView` the driver uses, typed structurally so it builds without Bun's types.

#### `WebViewContext`

```ts
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
```

What every event and recogniser receives: the view, and paced user actions logged to the timeline.

#### `BunWebViewDriverOptions`

```ts
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
  /**
   * Showcase pacing, in milliseconds: the hold before each event runs and after its state shows (default 400 and
   * 900).
   */
  pacing?: { before: number; after: number };
  /** Views open at once (one per worker); 8 when omitted. */
  concurrency?: number;
};
```

Options of `bunWebViewDriver`; every field is optional.

#### `bunWebViewDriver`

```ts
export function bunWebViewDriver(options: BunWebViewDriverOptions = {}): Driver<WebViewContext>
```

Drives a web app in Bun's built-in headless browser for `atlas run`: the system WebKit on macOS (nothing to
install), Chrome over CDP elsewhere. A view starts in milliseconds and screenshots take about ten, so it is the
quickest way to run a chart against a real page. Each path attempt gets its own view, closed afterwards. Screenshots
are PNG files without a thumbnail. Clips are encoded from screenshots with FFmpeg (no clip is recorded without it).
`user.tap` and `user.type` wait up to `actionTimeoutMs` for the target signal to show, then click its centre; a
target that never shows fails the step with "<signal> is not on screen". Needs the Bun runtime (run
`bun --bun atlas run`), and throws on open without it. There is no fake clock, so time events use the app's own
controls.

See /statecharts.md

**Example**

```ts
import { defineConfig } from '@crvouga/atlas';
import { bunWebViewDriver, screen, text } from '@crvouga/atlas/bun';

export default defineConfig({
  specs: './specs',
  driver: () => bunWebViewDriver({ baseUrl: 'http://127.0.0.1:4317' }),
  implementation: {
    async setup(ctx) { await ctx.goto('/'); },
    events: {
      // one entry per event of the spec
    },
    states: { 'No todos': screen({ all: [text('Nothing to do yet')] }) }
  }
});
```

#### `screen`

```ts
export const screen = …
```

Builds a state implementation for a `WebViewContext` from its signals in the page: every `all` signal visible, one
`any` signal visible (when given), no `none` signal visible. It is core's `signatureScreen` over `ctx.isVisible`, so
it takes the same spec as `screen` from `@crvouga/atlas/signals` (`checks`, `transient`, `sameAs`, `lookIn`,
`settle` included).

See /statecharts.md

### Bun WebView driver entry point (`@crvouga/atlas/bun`)

Source: `packages/bun/src/index.ts`. Import: `@crvouga/atlas/bun`

Re-exports the Bun WebView driver for statechart runs (`bunWebViewDriver`), its context and option types, `screen`
for recognising states from signals, and the signal constructors. Needs the Bun runtime.

See docs/statecharts.md
