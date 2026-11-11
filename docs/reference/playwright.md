# Reference: playwright

The Playwright driver for statechart runs. Import path `@crvouga/atlas/playwright`.

> Generated from the doc comments of `packages/playwright/src` by `bun run docs`. Do not edit: change the comment next to the code.

### Playwright driver

Source: `packages/playwright/src/driver.ts`

`playwrightDriver()` is the core `Driver` that runs a statechart's paths against a web app (or a React Native app
on the web) in Chromium. Each path attempt gets its own browser context and page; the `PlaywrightContext` it passes
to event and state implementations carries the page and paced user actions. Screens are recognised by signals
(`signals.ts`), and screenshots, clips and touch overlay come from `media.ts`.

See docs/statecharts.md

#### `PlaywrightContext`

```ts
export type PlaywrightContext = SignalContext & {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  /** Paced taps and typing, logged to the step's timeline and shown by the touch overlay in videos. */
  user: UserActions;
};
```

What every Playwright event and recogniser receives for one path attempt. It is a
`SignalContext` too, so implementations written against signals run here unchanged.

#### `PlaywrightDriverOptions`

```ts
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
```

Options of `playwrightDriver`; every field is optional.

#### `playwrightDriver`

```ts
export function playwrightDriver(options: PlaywrightDriverOptions = {}): Driver<PlaywrightContext>
```

Drives a web app (or a React Native app on the web) in Chromium with Playwright, for `atlas run`. Pass it in the
config as `driver: () => playwrightDriver(options)`. The browser launches on first use (and again if it was
disconnected) and is shared by every context; each path attempt opens a fresh context from `options.device`
(default `PHONE`). Screenshots are taken at the device's physical resolution; clips are recorded at that
resolution too and encoded with FFmpeg as H.264 MP4. FFmpeg must be on the PATH: each screenshot also writes a
WebP thumbnail with it, so without FFmpeg no screenshot is recorded (the run goes on). A Playwright trace is
kept only for a failed attempt that was traced (see `trace`), and `dispose` closes the browser.

See /statecharts.md

**Example**

```ts
import { defineConfig } from '@crvouga/atlas';
import { playwrightDriver, screen, text } from '@crvouga/atlas/playwright';

export default defineConfig({
  specs: './specs',
  driver: () => playwrightDriver({ clock: true }),
  implementation: {
    async setup({ page }) { await page.goto('http://127.0.0.1:4317'); },
    events: {
      // one entry per event of the spec
    },
    states: { 'No todos': screen({ all: [text('Nothing to do yet')] }) }
  }
});
```

### Playwright driver entry point (`@crvouga/atlas/playwright`)

Source: `packages/playwright/src/index.ts`. Import: `@crvouga/atlas/playwright`

Re-exports the Playwright driver for statechart runs (`playwrightDriver`), the helpers an implementation uses to
recognise screens and tap or type (`screen`, `recognize`, `locate`, the signal constructors and `UserActions`), and
the media tools (`captureScreen`, `ScreencastRecorder`, `ffmpeg`, `PHONE` and the pacing presets). Needs the
`playwright` package; clips and thumbnails need FFmpeg on the PATH.

Also `captureUiState`, the optional Playwright adapter of the UI catalog with its opt-in readiness policies, and
`catalogWorkerPool`, warm reusable capture workers for `collectCatalog` (neither needs a Playwright import itself).

See docs/statecharts.md
See docs/ui-catalog.md

### Playwright screenshots, clips and paced actions

Source: `packages/playwright/src/media.ts`

The media side of the Playwright driver: `UserActions` taps and types like a person (pausing, and drawing a touch
indicator in showcase videos) while logging each action to the step's timeline; `captureScreen` takes a settled,
deterministic screenshot at device resolution plus a WebP thumbnail; `ScreencastRecorder` records an H.264 clip at
device resolution; `ffmpeg` runs the `ffmpeg` binary, which must be on the PATH for thumbnails and clips.

See docs/statecharts.md

#### `Pacing`

```ts
export type Pacing = {
  moveMs: number;
  pauseBeforeTapMs: number;
  typeDelayMs: number;
  holdAfterMs: number;
  holdBeforeMs: number;
};
```

Pauses, in milliseconds, that make a showcase video readable: how long the touch indicator takes to glide to a tap
target, the pause before the tap, the delay between typed characters, and the holds after and before a step.

#### `SHOWCASE_PACING`

```ts
export const SHOWCASE_PACING: Pacing
```

The default pacing of showcase mode: a visible glide and pauses, so a person can follow the clip.

#### `FAST_PACING`

```ts
export const FAST_PACING: Pacing
```

No pauses at all; the pacing of fast mode.

#### `PHONE`

```ts
export const PHONE = …
```

The default `device` of `playwrightDriver`: a 390 by 844 CSS pixel viewport at device scale factor 3 (screenshots
are 1170 by 2532 pixels), a mobile user agent and touch.

#### `UserActions`

```ts
export class UserActions
```

Taps and typing a person would do, paced for showcase videos and logged to the step timeline. Provided to event
implementations as `user` on the `PlaywrightContext`. `showTouches` turns on the touch indicator (showcase mode).

- `static async install(page: Page)` — Registers the touch indicator overlay to be added to every page load, so it exists before the app's scripts run. Call it once per page, before navigating.
- `async tap(target: Locator | Signal, label: string)` — Taps the centre of a locator or a signal (resolved with `locate`). Waits up to 15 s for it to be visible, scrolls it into view, logs a `tap` entry labelled `label` to the timeline, then clicks (10 s timeout). In showcase mode the touch indicator glides there first. Throws when the target has no position on screen.
- `async type(target: Locator | Signal, text: string, label: string)` — Taps `target`, clears it, then types `text` one character at a time, `pacing.typeDelayMs` apart. Logs a `tap` and a `type` entry labelled `label` to the timeline.
- `async hold(ms: number)` — Waits `ms` milliseconds; does nothing when `ms` is zero or less.
- `async hideTouches()` — Hides the touch indicator, so a screenshot does not show it.
- `async showTouchLayer()` — Shows the touch indicator again after `hideTouches`.

#### `ScreenshotFiles`

```ts
export type ScreenshotFiles = { png: string; webp?: string };
```

The files `captureScreen` wrote: the full-size PNG and its WebP thumbnail.

#### `captureScreen`

```ts
export async function captureScreen(
  page: Page,
  driver: UserActions,
  file: string,
  mask: Locator[] = []
): Promise<ScreenshotFiles>
```

Takes a settled, deterministic screenshot at device resolution, with the touch layer hidden: waits for the network to
go quiet (up to 5 s) and for fonts, disables animations and hides the caret. Writes the PNG to `file` (creating its
folder) and a 400 px wide WebP thumbnail beside it with FFmpeg. `mask` lists locators to paint over. Rejects when
FFmpeg is missing or fails.

#### `ffmpeg`

```ts
export function ffmpeg(args: string[])
```

Runs `ffmpeg` with `args` and resolves when it exits with code 0. Rejects with the spawn error when `ffmpeg` is not
on the PATH, or with `ffmpeg <code>: <stderr>` when it fails.

#### `ScreencastRecorder`

```ts
export class ScreencastRecorder
```

Records a clip of a page at its physical resolution (1170×2532 for the default `PHONE`). Chrome's screencast, and
Playwright's built-in video that rides on it, only deliver CSS-pixel frames (390×844) and
upscale them, so text goes soft. Instead this loops device-scale JPEG captures (about 20 fps
here), keeps each frame's own timestamp, and encodes H.264 at 30 fps, holding each frame for as
long as it was on screen. The first frame becomes the poster.

- `async start(workDirectory: string)` — Begins capturing frames of the page into `workDirectory`, which is emptied first. Call `stop` to encode them.
- `async stop(output: string)` — Stops capturing and encodes the frames to the MP4 file `output` (the poster is written beside it, with `.mp4` replaced by `.poster.webp`), then deletes the work directory. Resolves to `{ video, poster, durationMs }`, or `null` when no frame was captured.

### Playwright signal helpers

Source: `packages/playwright/src/signals.ts`

Maps the driver-neutral `Signal` values (test ID, role, label, text, CSS) to Playwright locators, and builds state
recognisers from them: `recognize` evaluates a UI signature, `checkSignals` verifies quoted spec text is on screen,
and `screen` wraps both into a `StateImplementation` for any context that exposes `page`. Also re-exports the
signal constructors so an implementation imports everything from `@crvouga/atlas/playwright`. Visibility always
means the first visible match.

See docs/statecharts.md

#### `locate`

```ts
export function locate(page: Page, signal: Signal): Locator
```

Resolves a `Signal` to a Playwright locator for the first visible match, using Playwright's own role, label and
text rules (text matches are substrings unless `exact`).

#### `SignatureSpec`

```ts
export type SignatureSpec = { all?: Signal[]; any?: Signal[]; none?: Signal[] };
```

A state's UI signature: every `all` signal visible, at least one `any` signal visible (when `any` is given), and no
`none` signal visible.

#### `recognize`

```ts
export async function recognize(page: Page, spec: SignatureSpec): Promise<RecognizerResult>
```

Recognises a state from its UI signature on `page`: every `all` signal visible, one `any` signal visible (when `any`
is given), no `none` signal visible. Returns `matched` plus one entry per signal with what was expected and whether
it
was visible, which the report shows when the state is not recognised. A signal that cannot be evaluated counts as not
visible.

#### `checkSignals`

```ts
export async function checkSignals(page: Page, checks: { check: string; signal: Signal }[]): Promise<CheckResult[]>
```

Checks that each quoted piece of the spec (`check`) is visible on screen; returns one result per check, with
`expected` and `actual` filled in.

#### `screen`

```ts
export function screen<C extends { page: Page }>(
  spec: SignatureSpec & {
    checks?: { check: string; signal: Signal }[];
    transient?: boolean;
    sameAs?: string;
    lookIn?: (ctx: C) => Promise<void>;
    settle?: (ctx: C) => Promise<void>;
  }
): StateImplementation<C>
```

Builds a state implementation from a UI signature, for a context that exposes `page` (the `PlaywrightContext`). The
state is recognised as `recognize` describes; `checks` become the state's `meta.checks` results. The other fields
(`lookIn`, `settle`, `transient`, `sameAs`) pass through to the `StateImplementation`.

See /statecharts.md

**Example**

```ts
import { role, screen, text } from '@crvouga/atlas/playwright';

const states = {
  'No todos': screen({ all: [text('Nothing to do yet')], none: [role('listitem')] })
};
```

### Reusable capture workers for a UI catalog queue

Source: `packages/playwright/src/ui-catalog-pool.ts`

`catalogWorkerPool` turns declared capture recipes into the `capture` callback of `collectCatalog`
(`@crvouga/atlas/reports/ui-catalog-collect`), with a bounded pool of warm workers instead of a process per claim. A worker is
whatever the project's `launch` returns (normally a Playwright `Browser`, or the `browser` fixture of a Playwright Test) and is
started once and reused; every captured item gets a fresh page from `newPage` (normally a new browser context sized and
themed for the item's profile), so no mutable state crosses from one capture to the next, and the page is closed afterwards.

Claimed items are matched to recipes by state id, and run through `captureUiState`. A recipe that throws, or a state without a
recipe, is that item's failure only. When the claim is lost or the shard stops, the active page is closed at once, the call
rejects with the signal's reason, and nothing it captured is returned, so the collector never publishes it. Nothing here
imports Playwright: the pool knows the worker and the page only through the project's callbacks, and reports and core never
acquire a Playwright dependency.

See docs/ui-catalog.md#warm-workers-for-a-queue

#### `CatalogRecipeContext`

```ts
export type CatalogRecipeContext<W> = { readonly item: CollectItem; readonly worker: W; readonly signal: AbortSignal };
```

What a recipe's `open` is given: the item it captures, the worker it runs on, and the signal to stop on.

#### `CatalogRecipe`

```ts
export type CatalogRecipe<P extends CapturePage = CapturePage, W = unknown> = Omit<CaptureUiStateOptions, 'id' | 'signal'> & {
  readonly open?: (page: P, context: CatalogRecipeContext<W>) => Promise<void>;
};
```

How to bring a page to one declared state: `open` navigates and arranges fixture data, then `captureUiState` runs with the rest
(its `ready` check, readiness policies, regions). The state id, title and facts come from the claimed item.

#### `CatalogWorkerPoolOptions`

```ts
export type CatalogWorkerPoolOptions<W, P extends CapturePage> = {
  /** How many workers at most; default 1. Give `collectCatalog` the same `concurrency`. */
  readonly size?: number;
  /** Start one worker, once (`chromium.launch()`, or return a Playwright Test `browser` fixture). A failure is an infrastructure error, never an item result. */
  readonly launch: (index: number) => Promise<W>;
  /** A fresh page for one item, isolated from every other capture: apply its profile here (`viewport`, `colorScheme`). */
  readonly newPage: (worker: W, item: CollectItem, signal: AbortSignal) => Promise<P>;
  /** Close what `newPage` made (its context too). Default `page.close()` when the page has one. Called once per page, also on cancellation. */
  readonly closePage?: (page: P, worker: W) => Promise<void>;
  /** Stop one worker when the pool closes (`browser.close()`). Default nothing: a fixture's owner closes it. */
  readonly teardown?: (worker: W) => Promise<void>;
  /** Whether a worker can still be used after a capture (`browser.isConnected()`). One that cannot is torn down and replaced. */
  readonly healthy?: (worker: W) => boolean;
  /** The recipes, by state id, or a function that finds one. A claimed state without a recipe is a failed item. */
  readonly recipes: Readonly<Record<string, CatalogRecipe<P, W>>> | ((item: CollectItem) => CatalogRecipe<P, W> | undefined);
};
```

How the pool runs. `W` is the worker (a browser), `P` the page each capture gets.

#### `CatalogWorkerPoolStats`

```ts
export type CatalogWorkerPoolStats = { readonly launched: number; readonly captures: number; readonly pagesOpen: number; readonly busy: number };
```

What the pool tells about itself, for a log line or a test.

#### `CatalogWorkerPool`

```ts
export type CatalogWorkerPool = {
  readonly capture: (unit: CollectUnit, signal: AbortSignal) => Promise<readonly CapturedItem[]>;
  /** Wait for active captures to end, then tear every worker down. Captures after it reject. */
  readonly close: () => Promise<void>;
  readonly stats: () => CatalogWorkerPoolStats;
};
```

A pool: `capture` goes to `collectCatalog`, `close` ends it.

#### `catalogWorkerPool`

```ts
export function catalogWorkerPool<W, P extends CapturePage>(options: CatalogWorkerPoolOptions<W, P>): CatalogWorkerPool
```

A bounded pool of warm capture workers for `collectCatalog`. Throws for a `size` that is not a positive integer.

**Example**

```ts
const pool = catalogWorkerPool({
  size: 4, launch: () => chromium.launch(), teardown: browser => browser.close(), healthy: browser => browser.isConnected(),
  newPage: async (browser, item) => (await browser.newContext({ viewport: viewportOf(item.profile), colorScheme: item.profile.parameters.scheme === 'dark' ? 'dark' : 'light' })).newPage(),
  closePage: page => page.context().close(),
  recipes: { 'checkout/payment': { open: page => page.goto(`${base}/checkout`).then(() => undefined), ready: page => page.getByText('Total').waitFor() } }
});
try { await collectCatalog({ store, catalog, shard: { id: 'ci-1' }, concurrency: 4, capture: pool.capture }); } finally { await pool.close(); }
```

### Playwright adapter for the UI catalog

Source: `packages/playwright/src/ui-catalog.ts`

The optional Playwright side of the UI catalog: take a page to a state, wait until it is ready, photograph it, and hand the
result to `uiStateLayer` (`@crvouga/atlas/reports/ui-catalog-publish`) as a capture. This is the only Playwright-specific code
of the feature; reading, composing and exploring the catalog know nothing about it, and any other program that writes the
same layer produces the same catalog. The page is typed by the methods used, so no `playwright` import is needed here
and a Playwright Test `page`, a `Page` of the driver, or a stub all fit.

Readiness is bounded and cancellable. The project's own `ready` check (its business state: a locator, a route) receives a
signal and a deadline; opt-in generic policies wait for web fonts, for visible images to load and decode, and for the
picture to stop changing, and explicitly named scrolling regions are captured as supplemental views of the same state.
None of them is on by default, none sleeps for a fixed time, and none waits for the network to go idle: a state that
intentionally shows loading or animation stays valid by leaving them off. Each phase is timed; a phase that runs out of
budget fails the capture naming the phase, with a picture of what the page showed.

See docs/ui-catalog.md#readiness-policies

#### `CaptureLocator`

```ts
export type CaptureLocator = {
  screenshot(options?: { readonly animations?: 'disabled' | 'allow'; readonly type?: 'png'; readonly timeout?: number }): Promise<Uint8Array>;
  evaluate<R, A>(pageFunction: (element: HTMLElement, arg: A) => R | Promise<R>, arg: A): Promise<R>;
};
```

The part of a Playwright `Locator` that capturing a scrolling region uses.

#### `CapturePage`

```ts
export type CapturePage = {
  screenshot(options?: { readonly fullPage?: boolean; readonly animations?: 'disabled' | 'allow'; readonly type?: 'png' }): Promise<Uint8Array>;
  viewportSize(): { readonly width: number; readonly height: number } | null;
  /** Run a function in the page. Needed by `waitForFonts` and `waitForImages`. */
  evaluate?<R>(pageFunction: () => R | Promise<R>): Promise<R>;
  /** Find an element. Needed by `regions`. */
  locator?(selector: string): CaptureLocator;
};
```

The part of a Playwright `Page` that capturing uses. `evaluate` and `locator` are optional: only the readiness policies
and scrolling regions need them, so a stub with the first two methods still fits.

#### `CaptureReadyContext`

```ts
export type CaptureReadyContext = {
  /** Aborts when the readiness budget runs out or the capture is cancelled (the claim was lost, the shard is stopping). */
  readonly signal: AbortSignal;
  /** When the readiness budget runs out, epoch milliseconds. */
  readonly deadlineAt: number;
};
```

What a `ready` check is given besides the page: abort when `signal` does, and finish by `deadlineAt` (epoch ms).

#### `CapturePhase`

```ts
export type CapturePhase = 'ready' | 'fonts' | 'images' | 'stability' | 'screenshot' | 'regions';
```

A phase of readiness or capture, timed and named in a timeout.

#### `CapturePhaseTiming`

```ts
export type CapturePhaseTiming = { readonly phase: CapturePhase; readonly ms: number; readonly outcome: 'ok' | 'timeout' | 'failed' };
```

How one phase went: `ok`, `timeout` (it ran out of budget), or `failed` (it threw).

#### `CaptureReadiness`

```ts
export type CaptureReadiness = { readonly phases: readonly CapturePhaseTiming[]; readonly timedOut?: CapturePhase };
```

What `captureUiState` reports about readiness besides the capture: each phase's time, and the phase that ran out of budget.

#### `CaptureResult`

```ts
export type CaptureResult = UiStateCapture & { readonly readiness: CaptureReadiness };
```

A capture with its readiness report. `readiness` is not published; the timings are in the `atlas.readiness` label when a policy is on.

#### `StabilityPolicy`

```ts
export type StabilityPolicy = { readonly frames?: number; readonly timeoutMs?: number };
```

Wait for the picture to stop changing: `frames` consecutive identical screenshots (default 2) within `timeoutMs`.

#### `CaptureRegion`

```ts
export type CaptureRegion = {
  /** Stable: part of each view's name (`<state>--<name>-<n>.png`). */
  readonly name: string;
  /** A selector the page's `locator` understands. */
  readonly selector: string;
  /** For a person; default the name. */
  readonly label?: string;
  readonly maxViews?: number;
};
```

A scrolling element captured as named supplemental views: its content a viewport at a time, at most `maxViews` (default 5).

#### `READINESS_LABEL`

```ts
export const READINESS_LABEL = …
```

The label holding each phase's time when a readiness policy is on (`ready=12ms fonts=3ms …`).

#### `READINESS_TIMEOUT_LABEL`

```ts
export const READINESS_TIMEOUT_LABEL = …
```

The label naming the phase that ran out of budget (`fonts`, `images`, `stability`…), when a readiness policy is on.

#### `CaptureUiStateOptions`

```ts
export type CaptureUiStateOptions = UiStateFacts & {
  /** The state's stable id: how a later capture replaces this one. */
  readonly id: string;
  readonly title?: string;
  /**
   * Resolves when the page shows the state (a locator is visible, a request has answered). A rejection or a timeout makes the
   * capture `failed`, with the reason as its detail. It is given a signal and deadline: stop when the signal aborts.
   */
  readonly ready?: (page: CapturePage, context: CaptureReadyContext) => Promise<void>;
  /** The readiness budget: how long `ready` and every policy may take together; default 15 seconds. */
  readonly readyTimeoutMs?: number;
  /** Photograph the whole scrollable page rather than the viewport. */
  readonly fullPage?: boolean;
  /** Extra labels for the capture (`browser`, `os`), which never split it. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Cancel the capture: it throws the signal's reason and returns nothing, so no late capture is ever published. */
  readonly signal?: AbortSignal;
  /** Opt in: wait for `document.fonts.ready`. Needs `page.evaluate`. */
  readonly waitForFonts?: boolean;
  /** Opt in: wait until every image in the viewport has loaded and decoded. Needs `page.evaluate`. */
  readonly waitForImages?: boolean;
  /** Opt in: wait for consecutive identical frames, within the budget. The last frame is the picture. */
  readonly stability?: boolean | StabilityPolicy;
  /** Opt in: scrolling elements to capture as supplemental views of this state. Needs `page.locator`. */
  readonly regions?: readonly CaptureRegion[];
  /** Supplemental evidence the caller already has (a trace, a video), kept after any region views. */
  readonly attachments?: readonly UiCaptureAttachment[];
  /** The clock; default `Date.now`. */
  readonly now?: () => number;
};
```

What to capture and how to know the page is ready.

#### `captureUiState`

```ts
export async function captureUiState(page: CapturePage, options: CaptureUiStateOptions): Promise<CaptureResult>
```

Wait for the page to be ready, photograph it, and return the capture to publish. Never throws for the page's sake: a page
that never became ready, or could not be photographed, is a `failed` capture that says why, so a broken state shows in the
catalog instead of ending the run. A readiness failure still attaches a picture of what the page showed, for diagnosis.

Throws only when `signal` aborts (with its reason): a cancelled capture returns nothing, so a collector whose claim was
lost never publishes it. With no policy enabled it behaves as it always has.

**Example**

```ts
const shot = await captureUiState(page, {
  id: 'checkout/payment', route: '/checkout', ready: (p, { signal }) => waitForTotal(p, signal),
  waitForFonts: true, waitForImages: true, stability: { frames: 2 }, regions: [{ name: 'summary', selector: '#summary' }]
});
await publishChecks(store, uiStateLayer({ producer: 'playwright', recordedAtMs: Date.now(), environment: 'desktop-web', profile: { viewport: '1280x800' }, states: [shot] }));
```
