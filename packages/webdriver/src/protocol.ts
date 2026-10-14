/**
 * @module WebDriver protocol client
 *
 * A dependency-free client for the W3C WebDriver protocol (https://www.w3.org/TR/webdriver2/), the
 * standard every browser driver speaks (safaridriver, chromedriver, geckodriver, msedgedriver) and
 * Appium extends for native iOS and Android apps. It only speaks HTTP+JSON through the global
 * `fetch`: it neither starts servers nor knows about Atlas signals (that is `./driver`). Every call
 * has a timeout and rejects with a `WebDriverError` when the server reports an error.
 */

/** The W3C web element identifier key: the property under which a server sends an element id in an element reference. */
export const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * A location strategy and value. W3C strategies: `css selector`, `xpath`, `link text`,
 * `partial link text`, `tag name`. Appium adds `accessibility id`, `id`, `class name`,
 * `-ios predicate string`, `-ios class chain` and `-android uiautomator`.
 */
export type Locator = { using: string; value: string; name?: string };

/**
 * The error a WebDriver server reports for a command, or `invalid response` when its answer is not
 * JSON. The message reads `<code>: <message>`. Network failures and timeouts are not wrapped: they
 * reject with the error `fetch` raised.
 */
export class WebDriverError extends Error {
  /** The W3C error code, such as `no such element`, `stale element reference` or `invalid session id`; `unknown error` when the server gave none. */
  readonly code: string;
  /** The HTTP status of the response. */
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(`${code}: ${message}`);
    this.code = code;
    this.status = status;
  }
}

/** An element's position and size as the server reports it (`x` and `y` are the top-left corner). */
export type Rect = { x: number; y: number; width: number; height: number };

const elementIdOf = (value: unknown) =>
  value && typeof value === 'object' && ELEMENT_KEY in value ? String((value as Record<string, unknown>)[ELEMENT_KEY]) : null;

/**
 * Sends one JSON request and returns the response's `value`.
 *
 * @throws WebDriverError when the HTTP status is not ok, the `value` carries an `error`, or the body is not JSON.
 */
async function call(url: string, method: string, body: unknown, timeoutMs: number) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' },
    signal: AbortSignal.timeout(timeoutMs),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let parsed: { value?: unknown } = {};
  try {
    parsed = text ? (JSON.parse(text) as { value?: unknown }) : {};
  } catch {
    throw new WebDriverError('invalid response', `${method} ${url} answered ${response.status} with non-JSON`, response.status);
  }
  const value = parsed.value;
  if (!response.ok || (value && typeof value === 'object' && 'error' in value)) {
    const error = (value ?? {}) as { error?: string; message?: string };
    throw new WebDriverError(error.error ?? 'unknown error', error.message ?? `${method} ${url} answered ${response.status}`, response.status);
  }
  return value;
}

/**
 * One WebDriver session: a browser window or an Appium app on a device. Each method is one W3C
 * command (or a small combination) sent to `<serverUrl>/session/<id>/...`. Create it with
 * `WebDriverSession.create`; end it with `delete()`. Every method rejects with a `WebDriverError`
 * when the server refuses the command (for example `no such element` or `stale element reference`).
 * Elements are passed as the element id strings `findElements` returns.
 *
 * @example
 * const session = await WebDriverSession.create('http://127.0.0.1:4444', { browserName: 'chrome' });
 * await session.navigate('http://localhost:3000');
 * const [button] = await session.findElements({ using: 'css selector', value: '#book' });
 * if (button) await session.click(button);
 * await session.delete();
 */
export class WebDriverSession {
  /** The server's base URL, without a trailing slash. */
  readonly serverUrl: string;
  /** The session id the server assigned. */
  readonly id: string;
  /** The capabilities the server matched for this session (empty if it returned none). */
  readonly capabilities: Record<string, unknown>;
  /** How long each command may take before it is aborted, in milliseconds (60 000 by default). Writable. */
  timeoutMs: number;

  constructor(serverUrl: string, id: string, capabilities: Record<string, unknown>, timeoutMs = 60_000) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.id = id;
    this.capabilities = capabilities;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Starts a session (New Session) with `capabilities` as `alwaysMatch`.
   *
   * @param serverUrl base URL of the WebDriver server, such as `http://127.0.0.1:4444`.
   * @param timeoutMs how long New Session may take (default 120 000), since starting a browser or app is slow; later commands use the session's own `timeoutMs`.
   * @throws WebDriverError when the server cannot match the capabilities or start the session.
   */
  static async create(serverUrl: string, capabilities: Record<string, unknown>, timeoutMs = 120_000) {
    const value = (await call(`${serverUrl.replace(/\/$/, '')}/session`, 'POST', { capabilities: { alwaysMatch: capabilities } }, timeoutMs)) as {
      sessionId: string;
      capabilities?: Record<string, unknown>;
    };
    return new WebDriverSession(serverUrl, value.sessionId, value.capabilities ?? {});
  }

  /**
   * Sends any command to this session, for what this client does not wrap (extensions such as
   * `/appium/start_recording_screen`).
   *
   * @param path the command path after `/session/<id>`, starting with `/`.
   * @param body the JSON body; a POST without one sends `{}` as the standard requires, GET and DELETE send none.
   * @returns the response's `value`.
   */
  command(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
    return call(`${this.serverUrl}/session/${this.id}${path}`, method, method === 'POST' ? (body ?? {}) : undefined, this.timeoutMs);
  }

  /** Navigates to a URL (Navigate To) and resolves when the server answers (the page load strategy decides how long that takes). In a native session this is how a deep link is opened. */
  async navigate(url: string) {
    await this.command('POST', '/url', { url });
  }
  /** The current URL (Get Current URL). */
  async currentUrl() {
    return String(await this.command('GET', '/url'));
  }
  /** Reloads the page (Refresh). */
  async refresh() {
    await this.command('POST', '/refresh');
  }
  /** Goes back in the history (Back). */
  async back() {
    await this.command('POST', '/back');
  }

  /** The ids of every element matching the locator, (Find Elements); empty when none match. */
  async findElements(locator: Locator) {
    const value = await this.command('POST', '/elements', { using: locator.using, value: locator.value });
    return Array.isArray(value) ? value.map(elementIdOf).filter((id): id is string => Boolean(id)) : [];
  }
  /** Whether the element is shown (the `displayed` endpoint, which browser drivers and Appium implement). */
  async isDisplayed(element: string) {
    return Boolean(await this.command('GET', `/element/${element}/displayed`));
  }
  /** The element's position and size (Get Element Rect). */
  async rect(element: string) {
    return (await this.command('GET', `/element/${element}/rect`)) as Rect;
  }
  /** Clicks or taps the element (Element Click). */
  async click(element: string) {
    await this.command('POST', `/element/${element}/click`);
  }
  /** Clears an editable element (Element Clear). */
  async clear(element: string) {
    await this.command('POST', `/element/${element}/clear`);
  }
  /** Types `text` into the element (Element Send Keys). */
  async sendKeys(element: string, text: string) {
    await this.command('POST', `/element/${element}/value`, { text });
  }
  /** The element's rendered text (Get Element Text). */
  async elementText(element: string) {
    return String(await this.command('GET', `/element/${element}/text`));
  }

  /**
   * Runs a JavaScript function body in the page (Execute Script, web contexts only) and returns its
   * result. `args` are available as `arguments`; an element reference in an argument or result uses
   * the W3C element key (see `elementId` to read one).
   */
  async execute(script: string, args: unknown[] = []) {
    return this.command('POST', '/execute/sync', { script, args });
  }
  /** The element id inside an element reference returned by `execute`, or null when `value` is not one. */
  elementId(value: unknown) {
    return elementIdOf(value);
  }

  /** The page source (Get Page Source): the HTML of a web page, or the XML element tree of a native app under Appium. */
  async source() {
    return String(await this.command('GET', '/source'));
  }

  /** A screenshot of the viewport or screen (Take Screenshot), decoded from base64 to PNG bytes. */
  async screenshot() {
    return Buffer.from(String(await this.command('GET', '/screenshot')), 'base64');
  }

  /** A tap at viewport coordinates through W3C Actions (a touch pointer). */
  async tapAt(x: number, y: number) {
    await this.command('POST', '/actions', {
      actions: [
        {
          type: 'pointer',
          id: 'finger',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 50 },
            { type: 'pointerUp', button: 0 }
          ]
        }
      ]
    });
  }

  /** Ends the session (Delete Session), closing its browser window or app session. */
  async delete() {
    await call(`${this.serverUrl}/session/${this.id}`, 'DELETE', undefined, this.timeoutMs);
  }
}

/**
 * Waits until a WebDriver server answers `GET /status` as ready, polling every 250 ms (a server
 * that reports no `ready` field counts as ready).
 *
 * @param serverUrl base URL of the server.
 * @param timeoutMs how long to keep polling (default 30 000).
 * @throws Error naming the last failure when the deadline passes.
 */
export async function waitForServer(serverUrl: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no answer';
  while (Date.now() < deadline) {
    try {
      const value = (await call(`${serverUrl.replace(/\/$/, '')}/status`, 'GET', undefined, 2_000)) as { ready?: boolean; message?: string };
      if (value?.ready !== false) return;
      last = value.message ?? 'not ready';
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`The WebDriver server at ${serverUrl} did not become ready: ${last}`);
}
