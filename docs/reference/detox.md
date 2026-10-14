# Reference: detox

The Detox driver for statechart runs of React Native apps. Import path `@crvouga/atlas/detox`.

> Generated from the doc comments of `packages/detox/src` by `bun run docs`. Do not edit: change the comment next to the code.

### Detox driver

Source: `packages/detox/src/index.ts`. Import: `@crvouga/atlas/detox`

The Atlas driver for native iOS and Android apps tested with Detox (https://wix.github.io/Detox/).
It owns launching and terminating the app, mapping signals to Detox matchers, screenshots, and
logging taps and typing to the step timeline; it does not record video (Detox does that through its
artifacts plugin). It must run inside a Detox test, where Detox's `device`, `element`, `by` and
`waitFor` globals exist, or be given them as `api`. Detox is typed structurally here, so importing
this module needs no Detox install.

#### `DetoxMatcher`

```ts
export type DetoxMatcher = unknown;
```

What Detox's `by.*` builders return: an opaque matcher that is only passed back to Detox's `element(...)`.

#### `DetoxApi`

```ts
export type DetoxApi = {
  /** The device under test; Detox's `device`. */
  device: {
    /** Launches the app; the driver passes `newInstance: true` and any `launchArgs`. */
    launchApp(params?: Record<string, unknown>): Promise<void>;
    /** Opens a deep link; when the device lacks it, `goto` throws. */
    openURL?(params: { url: string }): Promise<void>;
    /** Terminates the app; skipped when absent. */
    terminateApp?(): Promise<void>;
    /** Takes a screenshot and resolves to the path of the file Detox wrote. */
    takeScreenshot(name: string): Promise<string>;
  };
  /** Detox's `element(matcher)`: the actions the driver performs on an element. */
  element(matcher: DetoxMatcher): { tap(): Promise<void>; typeText(text: string): Promise<void>; replaceText?(text: string): Promise<void> };
  /** Detox's `by`: matcher builders. `traits` exists on iOS only. */
  by: {
    id(id: string): DetoxMatcher;
    text(text: string): DetoxMatcher;
    label(label: string): DetoxMatcher;
    traits?(traits: string[]): DetoxMatcher & { and?(other: DetoxMatcher): DetoxMatcher };
  };
  /** Detox's `waitFor(element)`, used to ask whether an element is visible. */
  waitFor(element: unknown): { toBeVisible(): { withTimeout(ms: number): Promise<void> } };
};
```

The parts of Detox's global API the driver uses (`device`, `element`, `by`, `waitFor`), typed
structurally so this package needs no Detox install to build. Detox's real globals satisfy it.

#### `DetoxContext`

```ts
export type DetoxContext = DetoxApi & SignalContext & {
  /** The step timeline the actions below write to. */
  timeline: Timeline;
  /** Tap the element a matcher finds and log it to the step timeline. Rejects with Detox's error if the element is not found. */
  tap(matcher: DetoxMatcher, label: string): Promise<void>;
  /** Type `text` into the element a matcher finds (Detox `typeText`, which appends) and log it to the step timeline; `label` is the caption. */
  type(matcher: DetoxMatcher, text: string, label: string): Promise<void>;
};
```

What every event and recogniser receives from `detoxDriver`: Detox's API plus a `SignalContext`,
so implementations written against signals run here too. One context is created per path attempt.

#### `DetoxDriverOptions`

```ts
export type DetoxDriverOptions = {
  /** Detox's globals; `globalThis` (where Detox puts them) by default. */
  api?: DetoxApi;
  /** Passed to `device.launchApp` as `launchArgs` at the start of every attempt. */
  launchArgs?: Record<string, unknown>;
};
```

Options of `detoxDriver`.

#### `detoxMatcher`

```ts
export function detoxMatcher(api: DetoxApi, signal: Signal): DetoxMatcher
```

Translates a signal into a Detox matcher: test IDs are `by.id` (React Native's `testID`), labels
`by.label`, text `by.text`, a role with a name `by.label` (with the iOS `button` trait when Detox
has it). Detox matches exact strings, so regular expressions and CSS selectors are refused.

- `api`: the Detox API whose `by` builds the matcher.

**Throws** Error for a `css` signal, a regular expression, or a role without a name.

#### `detoxDriver`

```ts
export function detoxDriver(options: DetoxDriverOptions = {}): Driver<DetoxContext>
```

Creates a driver for a native app tested with Detox. Every path attempt relaunches the app
(`device.launchApp({ newInstance: true })`) and terminates it afterwards. Screenshots come from
`device.takeScreenshot`. Detox records video per test through its artifacts plugin rather than per
call, so this driver does not record clips; enable Detox's `--record-videos` to keep a video of
each attempt.

The Detox globals are read when an attempt opens, so call `runConfig` from inside a Detox test.
Signals are resolved with `detoxMatcher`, so regular expressions and CSS selectors are refused.

- `options`: `api` to use instead of the globals, and `launchArgs` for the app.

**Returns** a driver whose context is a `DetoxContext`.

**Example**

```ts
const config = defineConfig<DetoxContext>({
  specs: './specs',
  driver: detoxDriver({ launchArgs: { resetData: true } }),
  implementation
});
await runConfig(config, { mode: 'fast' });
```

#### `detoxScreen`

```ts
export function detoxScreen(spec: {
  all: { matcher: DetoxMatcher; name: string }[];
  none?: { matcher: DetoxMatcher; name: string }[];
  checks?: { check: string; matcher: DetoxMatcher; name: string }[];
}): StateImplementation<DetoxContext>
```

Builds a state implementation recognised by Detox matchers: matched when every `all` matcher is
visible and no `none` matcher is. `checks` pair a statement from the state's `meta.checks` with
the matcher that proves it. Each entry's `name` appears in failure reports. Unlike
`screen(...)` from the signals module it takes matchers, not signals, and has no `any`.

**Example**

```ts
states: { 'No todos': detoxScreen({ all: [{ matcher: by.text('Nothing to do yet'), name: 'empty message' }] }) }
```
