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

Also `captureUiState`, the optional Playwright adapter of the UI catalog (it needs no Playwright import itself).

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

### Playwright adapter for the UI catalog

Source: `packages/playwright/src/ui-catalog.ts`

The optional Playwright side of the UI catalog: take a page to a state, wait until it is ready, photograph it, and hand the
result to `uiStateLayer` (`@crvouga/atlas/reports/ui-catalog-publish`) as a capture. This is the only Playwright-specific code
of the feature; reading, composing and exploring the catalog know nothing about it, and any other program that writes the
same layer produces the same catalog. The page is typed by the three methods used, so no `playwright` import is needed here
and a Playwright Test `page`, a `Page` of the driver, or a stub all fit.

See docs/ui-catalog.md

#### `CapturePage`

```ts
export type CapturePage = {
  screenshot(options?: { readonly fullPage?: boolean; readonly animations?: 'disabled' | 'allow'; readonly type?: 'png' }): Promise<Uint8Array>;
  viewportSize(): { readonly width: number; readonly height: number } | null;
};
```

The part of a Playwright `Page` that capturing uses.

#### `CaptureUiStateOptions`

```ts
export type CaptureUiStateOptions = UiStateFacts & {
  /** The state's stable id: how a later capture replaces this one. */
  readonly id: string;
  readonly title?: string;
  /** Resolves when the page shows the state (a locator is visible, the network is idle). A rejection or a timeout makes the capture `failed`, with the reason as its detail. */
  readonly ready?: (page: CapturePage) => Promise<void>;
  /** How long to wait for `ready`; default 15 seconds. */
  readonly readyTimeoutMs?: number;
  /** Photograph the whole scrollable page rather than the viewport. */
  readonly fullPage?: boolean;
  /** Extra labels for the capture (`browser`, `os`), which never split it. */
  readonly labels?: Readonly<Record<string, string>>;
};
```

What to capture and how to know the page is ready.

#### `captureUiState`

```ts
export async function captureUiState(page: CapturePage, options: CaptureUiStateOptions): Promise<UiStateCapture>
```

Wait for the page to be ready, photograph it, and return the capture to publish. Never throws for the page's sake: a page
that never became ready, or could not be photographed, is a `failed` capture that says why, so a broken state shows in the
catalog instead of ending the run. A readiness failure still attaches a picture of what the page showed, for diagnosis.

**Example**

```ts
const shot = await captureUiState(page, { id: 'checkout/payment', route: '/checkout', ready: p => expectVisible(p, '#total') });
await publishChecks(store, uiStateLayer({ producer: 'playwright', recordedAtMs: Date.now(), environment: 'desktop-web', profile: { viewport: '1280x800' }, states: [shot] }));
```
