# @crvouga/atlas-bun

A [Bun WebView](https://bun.com/docs/runtime/webview) driver for [Atlas](../../README.md): run
statecharts against a web app in Bun's built-in headless browser. On macOS it is the system WebKit
(`WKWebView`), so there is nothing to download; elsewhere Bun drives an installed Chrome, Chromium,
Edge or Brave over the DevTools Protocol. A view starts in milliseconds and a screenshot takes
about ten, which makes it the quickest way to run a chart against a real page.

```sh
pnpm add -D @crvouga/atlas @crvouga/atlas-bun
bun --bun atlas run --config atlas.config.ts
```

It needs the Bun runtime with Bun.WebView, which is experimental (tested on Bun 1.4.2). The `atlas` binary runs
under Bun as it is. FFmpeg on the `PATH` is needed for clips.

## Use

```ts
import { defineConfig } from '@crvouga/atlas';
import type { WebViewContext } from '@crvouga/atlas-bun';
import { bunWebViewDriver, label, role, screen, text } from '@crvouga/atlas-bun';

export default defineConfig<WebViewContext>({
  specs: './specs',
  driver: bunWebViewDriver({ baseUrl: 'http://127.0.0.1:3000' }),
  targets: ['http://127.0.0.1:3000'],
  implementation: {
    setup: (ctx) => ctx.goto('/'),
    events: {
      'Adds a todo': {
        kind: 'user',
        how: 'Types a todo and taps "Add".',
        async run({ user }) {
          await user.type(label('New todo'), 'Water the plants', 'New todo');
          await user.tap(role('button', 'Add', { exact: true }), 'Add');
        }
      }
    },
    states: {
      'No todos': screen({ all: [text('Nothing to do yet')] }),
      'Some todos open': screen({ all: [text(/^\d+ left$/)] })
    }
  }
});
```

## What it provides

- **`bunWebViewDriver(options)`**: a fresh view per path attempt (390×844 by default; `width`,
  `height`), `backend` (`webkit` or `chrome`), `baseUrl` for `goto`, `actionTimeoutMs` for how long
  a tap waits for its target, and showcase `pacing`.
- **`WebViewContext`**: the `view` itself, `goto`, `evaluate`, `find(signal)` (where a signal is on
  screen) and `user.tap` / `user.type` / `user.press`, which log to the step's timeline with the tap
  position. It is a `SignalContext`, so implementations written against `@crvouga/atlas/signals`
  run here and on Playwright, WebDriver and Detox alike.
- **`screen({ all, any, none, checks, transient, sameAs, lookIn, settle })`** and the signals
  `testId`, `role`, `label`, `text`, `css`. Signals resolve in the page with the WAI-ARIA implicit
  roles of common elements and their accessible names.
- **Media**: PNG screenshots of the viewport; in showcase mode a clip per transition, encoded from
  screenshots (about 30 frames a second) as H.264 MP4.

Bun.WebView has no fake clock and no init scripts, so a time event uses the app's own controls
(or runs on Playwright, whose clock can jump). Playwright also runs under Bun, so a single run can
put one client in Bun's WebKit and another in Playwright's Chromium (`combineDrivers`).

## License

MIT
