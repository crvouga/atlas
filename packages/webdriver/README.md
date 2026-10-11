# @crvouga/atlas-webdriver

A [W3C WebDriver](https://www.w3.org/TR/webdriver2/) driver for [Atlas](../../README.md), with no
dependencies: it speaks the protocol over `fetch`. One driver covers every browser and, through
[Appium](https://appium.io), native iOS and Android apps:

| Target | Server | Capabilities |
| --- | --- | --- |
| Safari | `safaridriver` (ships with macOS; enable once with `safaridriver --enable`) | `{ browserName: 'safari' }` |
| Chrome | `chromedriver` | `{ browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new'] } }` |
| Firefox | `geckodriver` | `{ browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] } }` |
| iOS app | `appium` with the XCUITest driver | `{ platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:app': './App.app' }` |
| Android app | `appium` with the UiAutomator2 driver | `{ platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:app': './app.apk' }` |

```sh
pnpm add -D @crvouga/atlas @crvouga/atlas-webdriver
```

FFmpeg on the `PATH` is needed for clips encoded from screenshots.

## Use

```ts
import { defineConfig } from '@crvouga/atlas';
import type { WebDriverContext } from '@crvouga/atlas-webdriver';
import { accessibilityId, role, screen, testId, text, webdriverDriver } from '@crvouga/atlas-webdriver';

export default defineConfig<WebDriverContext>({
  specs: './specs',
  driver: webdriverDriver({
    server: { command: 'appium' },
    capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:app': './build/App.app' },
    recording: 'appium'
  }),
  implementation: {
    setup: async () => undefined,
    events: {
      'Books a visit': {
        kind: 'user',
        how: 'Taps "Book".',
        run: ({ user }) => user.tap(testId('book-button'), 'Book')
      }
    },
    states: {
      'Visit booked': screen({ all: [text('Booked for')], none: [accessibilityId('book-button')] }),
      'Choosing a time': screen({ all: [role('button', 'Confirm time')] })
    }
  }
});
```

## What it provides

- **`webdriverDriver(options)`**: `url` of a running server, or `server: { command, args?, port? }`
  to start one for the run (`{port}` in `args` is replaced; the server is stopped on dispose);
  `capabilities` (`alwaysMatch`); `mode` (`web` or `native`, inferred from the capabilities);
  `baseUrl` for `goto`; `session: 'per-attempt'` (default, a fresh browser or app per attempt) or
  `'per-run'`; `recording: 'frames' | 'appium' | 'none'`; `actionTimeoutMs`.
- **`WebDriverContext`**: the `session`, `mode`, `goto`, `find(target)`, `isVisible(target)` and
  `user.tap` / `user.type`, logged to the step's timeline with the tap position. It is a
  `SignalContext`, so implementations written against `@crvouga/atlas/signals` run here and on
  Playwright, Bun and Detox alike.
- **Targets**: the shared signals (`testId`, `role`, `label`, `text`, `css`) or raw locators
  (`accessibilityId`, `xpath`, `iosPredicate`, `androidUiAutomator`, or any `{ using, value }`).
  In web sessions signals resolve in the DOM with WAI-ARIA roles and accessible names; in native
  sessions a test ID is the accessibility identifier (React Native's `testID`), text matches an
  element's label, name, value or text, and a role maps to the XCUITest or UiAutomator2 element
  types. Regular expressions are matched against the page source.
- **`WebDriverSession`**: the protocol client itself (New Session, Find Elements, Element Click,
  Element Send Keys, Execute Script, Get Page Source, Take Screenshot, Perform Actions, and
  `command()` for extensions such as Appium's `mobile:` commands).
- **Media**: standard screenshots; clips encoded from screenshots, or Appium's screen recorder with
  `recording: 'appium'`.

## License

MIT
