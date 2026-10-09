# @crvouga/atlas-playwright

A Playwright driver for [Atlas](../../README.md): run statecharts against a web app (or a React
Native app on the web), recognise screens from UI signals, and record showcase media.

```sh
pnpm add -D @crvouga/atlas @crvouga/atlas-playwright playwright
pnpm exec playwright install chromium
```

FFmpeg on the `PATH` is needed for clips and WebP thumbnails.

## Use

```ts
import { defineConfig } from '@crvouga/atlas';
import type { PlaywrightContext } from '@crvouga/atlas-playwright';
import { css, playwrightDriver, role, screen, testId, text } from '@crvouga/atlas-playwright';

export default defineConfig<PlaywrightContext>({
  specs: './specs',
  driver: () => playwrightDriver({ clock: true }),
  targets: ['http://127.0.0.1:3000'],
  implementation: {
    setup: ({ page }) => page.goto('http://127.0.0.1:3000').then(() => undefined),
    events: {
      'Signs in': {
        kind: 'user',
        how: 'Types the test account and taps "Sign in".',
        async run({ page, user }) {
          await user.type(page.getByLabel('Email'), 'sam@example.com', 'Email');
          await user.tap(page.getByRole('button', { name: 'Sign in' }), 'Sign in');
        }
      },
      'Session expires': {
        kind: 'time',
        how: 'Jumps the clock an hour.',
        run: ({ page }) => page.clock.fastForward('01:00:00')
      }
    },
    states: {
      Home: screen({ all: [role('heading', 'Home')], none: [text('Sign in')] }),
      'Signed out': screen({
        all: [role('button', 'Sign in')],
        checks: [{ check: 'Explains the session ended', signal: testId('session-ended') }]
      }),
      Saving: screen({ all: [css('[aria-busy="true"]')], transient: true })
    }
  }
});
```

## What it provides

- **`playwrightDriver(options)`**: a fresh browser context per path attempt; a 390×844 phone at
  device scale factor 3 with touch by default (`device`); `launch` options; `clock: true` installs
  Playwright's fake clock before the app loads, so time events can call `page.clock.fastForward`;
  a Playwright trace for failed attempts (`traceOnFailure`, default on); `onPage` to prepare each
  page; `pacing` to tune showcase timing.
- **`PlaywrightContext`**: `{ page, context, browser, user, goto, isVisible }`, a `SignalContext`
  (see `@crvouga/atlas/signals`), so implementations written against signals run here and on the
  Bun, WebDriver and Detox drivers alike. `user.tap(target, label)` and
  `user.type(target, text, label)` take a Playwright locator or a signal, and log to the step's
  timeline; in showcase mode they move a soft touch indicator to the target, pause like a person
  and type at human speed. `goto` resolves paths against `baseUrl`.
- **`screen({ all, any, none, checks, transient, sameAs, lookIn, settle })`**: a state recogniser
  from a UI signature. Every `all` signal visible, at least one `any`, no `none`.
- **Signals**: `testId(id)`, `role(role, name?, { exact? })`, `text(string | RegExp, { exact? })`,
  `label(string | RegExp)`, `css(selector)`, the same values every driver resolves. Prefer roles,
  labels and text as a person would; reach for test ids last.
- **Media**: screenshots at the device's physical resolution with the touch layer hidden, plus WebP
  thumbnails; in showcase mode a clip per transition, captured at device resolution and encoded as
  H.264 MP4 with a poster frame.

## License

MIT
