# Reference: webdriver

The W3C WebDriver / Appium driver for statechart runs. Import path `@crvouga/atlas/webdriver`.

> Generated from the doc comments of `packages/webdriver/src` by `bun run docs`. Do not edit: change the comment next to the code.

### WebDriver driver

Source: `packages/webdriver/src/driver.ts`

The Atlas driver for anything that speaks W3C WebDriver: browsers through their driver binary
(safaridriver, chromedriver, geckodriver, msedgedriver) and native iOS and Android apps through
Appium. It owns starting (or connecting to) the WebDriver server, opening sessions, resolving
signals and raw locators to elements, and logging taps and typing to the step timeline; the
protocol calls themselves live in `./protocol`. It requires a reachable WebDriver server (`url`) or a
server binary on the `PATH` (`server`), and FFmpeg on the `PATH` for clips encoded from
screenshots. A session or server that cannot start rejects the attempt that needed it.

#### `Target`

```ts
export type Target = Signal | Locator;
```

What a step points at: a signal (resolved per platform) or a raw WebDriver locator.

#### `Mode`

```ts
export type Mode = 'web' | 'native';
```

How signals are resolved: `web` evaluates a DOM probe in the page, `native` queries the accessibility tree (an Appium session).

#### `WebDriverContext`

```ts
export type WebDriverContext = SignalContext & {
  /** The open WebDriver session, for protocol calls the context does not wrap (`session.execute`, `session.command`). */
  session: WebDriverSession;
  /** Whether signals resolve in the DOM (`web`) or the accessibility tree (`native`). */
  mode: Mode;
  /** What `goto` resolves paths against; undefined when the options set no `baseUrl`. */
  baseUrl: string | undefined;
  /** Navigate, relative to `baseUrl` (a deep link in a native session). Without a `baseUrl` the URL is sent as given. */
  goto(url: string): Promise<void>;
  /** The id of the first visible element a target resolves to, or null. Does not wait. */
  find(target: Target): Promise<string | null>;
  /** Whether the target resolves to a visible element right now. Does not wait; resolution errors count as not visible. */
  isVisible(target: Target): Promise<boolean>;
  /** Actions a person does; each is added to the step timeline (with the element's centre as the tap position) and then performed. */
  user: {
    /** Clicks the target's element, polling up to `actionTimeoutMs` for it to appear; throws `<target> is not on screen` otherwise. `label` is the caption. */
    tap(target: Target, label: string): Promise<void>;
    /** Clicks the target's element to focus it, then sends `text` as keys (it does not clear existing text); waits and throws like `tap`. */
    type(target: Target, text: string, label: string): Promise<void>;
  };
};
```

What every event and recogniser receives from `webdriverDriver`: the open session plus a
`SignalContext` whose targets may also be raw locators. It is created per attempt (or once per run
with `session: 'per-run'`) and carries the actions that are logged to the step timeline.

#### `WebDriverServer`

```ts
export type WebDriverServer = {
  /** The server binary: `safaridriver`, `chromedriver`, `geckodriver`, `appium`. */
  command: string;
  /** `{port}` is replaced with the port. Defaults: `--port {port}` (`--port={port}` for chromedriver and msedgedriver). */
  args?: string[];
  /** The port to listen on; a free port on 127.0.0.1 is picked when omitted. */
  port?: number;
  /** How long to wait for the server to answer `GET /status` as ready, in milliseconds (default 30 000). */
  readyTimeoutMs?: number;
};
```

A WebDriver server binary the driver starts for the run and kills when the driver is disposed.

#### `WebDriverDriverOptions`

```ts
export type WebDriverDriverOptions = {
  /** A running WebDriver server (for example `http://127.0.0.1:4723` for Appium); or set `server` to start one for the run. */
  url?: string;
  /** A server to start for the run; used when `url` is not set. The driver throws on first use if neither is set. */
  server?: WebDriverServer;
  /** W3C capabilities (`alwaysMatch`), e.g. `{ browserName: 'safari' }` or Appium's `platformName`, `appium:app`. */
  capabilities: Record<string, unknown>;
  /** `web` resolves signals in the DOM; `native` resolves them in the accessibility tree. Inferred from the capabilities. */
  mode?: Mode;
  /** Where `goto` paths resolve; the implementation's setup decides where to open. */
  baseUrl?: string | (() => string | Promise<string>);
  /** `per-attempt` (default) starts a fresh session (browser or app) for every path attempt; `per-run` reuses one. */
  session?: 'per-attempt' | 'per-run';
  /** Clips: `frames` (default) encodes screenshots with FFmpeg; `appium` uses Appium's screen recorder; `none`. */
  recording?: 'frames' | 'appium' | 'none';
  /** How long a tap waits for its target, in milliseconds (default 15 000). */
  actionTimeoutMs?: number;
  /** The driver's name in reports; `webdriver:<platformName>` for native sessions, else `webdriver:<browserName>`, when omitted. */
  name?: string;
  /** Pauses around actions in showcase mode, in milliseconds; 400 before and 900 after when omitted. */
  pacing?: { before: number; after: number };
  /**
   * Sessions open at once (one per worker): raise it for a grid or several devices. 1 when
   * omitted, and always 1 with a per-run session.
   */
  concurrency?: number;
};
```

Options of `webdriverDriver`. `capabilities` and one of `url` or `server` are required.

#### `nativeLocator`

```ts
export function nativeLocator(signal: Signal): Locator | null
```

Translates a signal into an Appium locator: a test ID becomes an `accessibility id`; text, labels
and roles become an XPath over the label, name, value, text and content-desc attributes (a
substring match unless `exact`), with a role narrowed to the matching XCUITest and UiAutomator2
element types.

**Returns** the locator, or null when the signal matches by regular expression, which XPath 1.0
cannot express (the driver then matches it against the page source instead).

**Throws** Error for a `css` signal, which only works in web sessions.

#### `webdriverDriver`

```ts
export function webdriverDriver(options: WebDriverDriverOptions): Driver<WebDriverContext>
```

Creates a driver for anything that speaks W3C WebDriver: Safari (safaridriver ships with macOS),
Chrome, Firefox and Edge, or a native iOS or Android app through Appium. Signals resolve in the
DOM for web sessions and in the accessibility tree for native ones (test IDs are accessibility
identifiers), so one implementation style covers both. Screenshots and the page source are
standard; clips are encoded from screenshots (FFmpeg on the `PATH`), or come from Appium's screen
recorder.

The WebDriver server is started lazily on the first attempt (`options.server`) or used as is
(`options.url`); `dispose()` deletes the shared session and kills a server this driver started.
With `session: 'per-attempt'` each attempt opens and deletes its own session. A server that exits
or is not ready in time, and a session the server refuses, reject the attempt that needed them.

- `options`: the server, capabilities and behaviour; see `WebDriverDriverOptions`.

**Returns** a driver whose context is a `WebDriverContext`.

**Throws** Error on the first attempt when neither `options.url` nor `options.server` is set.

**Example**

```ts
const driver = webdriverDriver({
  server: { command: 'chromedriver' },
  capabilities: { browserName: 'chrome', 'goog:chromeOptions': { args: ['--headless=new'] } },
  baseUrl: 'http://localhost:3000'
});
```

#### `screen`

```ts
export const screen = …
```

Builds a state implementation recognised from signals or raw locators: every `all` target visible,
one of `any` (when given) and none of `none`. `checks` pair a statement from the state's
`meta.checks` with the target that proves it. A target whose lookup throws counts as not visible.

**Example**

```ts
states: { 'Visit booked': screen({ all: [text('Booked for')], none: [accessibilityId('book-button')] }) }
```

### WebDriver driver entry point

Source: `packages/webdriver/src/index.ts`. Import: `@crvouga/atlas/webdriver`

Public surface of `@crvouga/atlas/webdriver`: the driver (`webdriverDriver`), the protocol client
(`WebDriverSession`), the shared UI signals, and builders for raw locators that only Appium
understands. Requires a WebDriver server at run time; importing it has no side effects.

#### `accessibilityId`

```ts
export const accessibilityId = …
```

Appium: an accessibility identifier (iOS) or content description (Android); React Native's `testID`.

#### `xpath`

```ts
export const xpath = …
```

An XPath 1.0 expression over the page or Appium source tree.

#### `iosPredicate`

```ts
export const iosPredicate = …
```

Appium iOS: an NSPredicate over the element tree, e.g. `label == "Book" AND type == "XCUIElementTypeButton"`.

#### `androidUiAutomator`

```ts
export const androidUiAutomator = …
```

Appium Android: a UiSelector expression, e.g. `new UiSelector().text("Book")`.

### WebDriver protocol client

Source: `packages/webdriver/src/protocol.ts`

A dependency-free client for the W3C WebDriver protocol (https://www.w3.org/TR/webdriver2/), the
standard every browser driver speaks (safaridriver, chromedriver, geckodriver, msedgedriver) and
Appium extends for native iOS and Android apps. It only speaks HTTP+JSON through the global
`fetch`: it neither starts servers nor knows about Atlas signals (that is `./driver`). Every call
has a timeout and rejects with a `WebDriverError` when the server reports an error.

#### `ELEMENT_KEY`

```ts
export const ELEMENT_KEY = …
```

The W3C web element identifier key: the property under which a server sends an element id in an element reference.

#### `Locator`

```ts
export type Locator = { using: string; value: string; name?: string };
```

A location strategy and value. W3C strategies: `css selector`, `xpath`, `link text`,
`partial link text`, `tag name`. Appium adds `accessibility id`, `id`, `class name`,
`-ios predicate string`, `-ios class chain` and `-android uiautomator`.

#### `WebDriverError`

```ts
export class WebDriverError extends Error
```

The error a WebDriver server reports for a command, or `invalid response` when its answer is not
JSON. The message reads `<code>: <message>`. Network failures and timeouts are not wrapped: they
reject with the error `fetch` raised.

- `readonly code: string;` — The W3C error code, such as `no such element`, `stale element reference` or `invalid session id`; `unknown error` when the server gave none.
- `readonly status: number;` — The HTTP status of the response.

#### `Rect`

```ts
export type Rect = { x: number; y: number; width: number; height: number };
```

An element's position and size as the server reports it (`x` and `y` are the top-left corner).

#### `WebDriverSession`

```ts
export class WebDriverSession
```

One WebDriver session: a browser window or an Appium app on a device. Each method is one W3C
command (or a small combination) sent to `<serverUrl>/session/<id>/...`. Create it with
`WebDriverSession.create`; end it with `delete()`. Every method rejects with a `WebDriverError`
when the server refuses the command (for example `no such element` or `stale element reference`).
Elements are passed as the element id strings `findElements` returns.

**Example**

```ts
const session = await WebDriverSession.create('http://127.0.0.1:4444', { browserName: 'chrome' });
await session.navigate('http://localhost:3000');
const [button] = await session.findElements({ using: 'css selector', value: '#book' });
if (button) await session.click(button);
await session.delete();
```

- `readonly serverUrl: string;` — The server's base URL, without a trailing slash.
- `readonly id: string;` — The session id the server assigned.
- `readonly capabilities: Record<string, unknown>;` — The capabilities the server matched for this session (empty if it returned none).
- `timeoutMs: number;` — How long each command may take before it is aborted, in milliseconds (60 000 by default). Writable.
- `static async create(serverUrl: string, capabilities: Record<string, unknown>, timeoutMs = 120_000)` — Starts a session (New Session) with `capabilities` as `alwaysMatch`. - `serverUrl`: base URL of the WebDriver server, such as `http://127.0.0.1:4444`. - `timeoutMs`: how long New Session may take (default 120 000), since starting a browser or app is slow; later commands use the session's own `timeoutMs`. **Throws** WebDriverError when the server cannot match the capabilities or start the session.
- `command(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown)` — Sends any command to this session, for what this client does not wrap (extensions such as `/appium/start_recording_screen`). - `path`: the command path after `/session/<id>`, starting with `/`. - `body`: the JSON body; a POST without one sends `{}` as the standard requires, GET and DELETE send none. **Returns** the response's `value`.
- `async navigate(url: string)` — Navigates to a URL (Navigate To) and resolves when the server answers (the page load strategy decides how long that takes). In a native session this is how a deep link is opened.
- `async currentUrl()` — The current URL (Get Current URL).
- `async refresh()` — Reloads the page (Refresh).
- `async back()` — Goes back in the history (Back).
- `async findElements(locator: Locator)` — The ids of every element matching the locator, (Find Elements); empty when none match.
- `async isDisplayed(element: string)` — Whether the element is shown (the `displayed` endpoint, which browser drivers and Appium implement).
- `async rect(element: string)` — The element's position and size (Get Element Rect).
- `async click(element: string)` — Clicks or taps the element (Element Click).
- `async clear(element: string)` — Clears an editable element (Element Clear).
- `async sendKeys(element: string, text: string)` — Types `text` into the element (Element Send Keys).
- `async elementText(element: string)` — The element's rendered text (Get Element Text).
- `async execute(script: string, args: unknown[] = [])` — Runs a JavaScript function body in the page (Execute Script, web contexts only) and returns its result. `args` are available as `arguments`; an element reference in an argument or result uses the W3C element key (see `elementId` to read one).
- `elementId(value: unknown)` — The element id inside an element reference returned by `execute`, or null when `value` is not one.
- `async source()` — The page source (Get Page Source): the HTML of a web page, or the XML element tree of a native app under Appium.
- `async screenshot()` — A screenshot of the viewport or screen (Take Screenshot), decoded from base64 to PNG bytes.
- `async tapAt(x: number, y: number)` — A tap at viewport coordinates through W3C Actions (a touch pointer).
- `async delete()` — Ends the session (Delete Session), closing its browser window or app session.

#### `waitForServer`

```ts
export async function waitForServer(serverUrl: string, timeoutMs = 30_000)
```

Waits until a WebDriver server answers `GET /status` as ready, polling every 250 ms (a server
that reports no `ready` field counts as ready).

- `serverUrl`: base URL of the server.

- `timeoutMs`: how long to keep polling (default 30 000).

**Throws** Error naming the last failure when the deadline passes.
