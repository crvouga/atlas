/**
 * A dependency-free client for the W3C WebDriver protocol (https://www.w3.org/TR/webdriver2/), the
 * standard every browser driver speaks (safaridriver, chromedriver, geckodriver, msedgedriver) and
 * Appium extends for native iOS and Android apps.
 */

/** The W3C web element identifier key. */
export const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * A location strategy and value. W3C strategies: `css selector`, `xpath`, `link text`,
 * `partial link text`, `tag name`. Appium adds `accessibility id`, `id`, `class name`,
 * `-ios predicate string`, `-ios class chain` and `-android uiautomator`.
 */
export type Locator = { using: string; value: string; name?: string };

export class WebDriverError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(`${code}: ${message}`);
    this.code = code;
    this.status = status;
  }
}

export type Rect = { x: number; y: number; width: number; height: number };

const elementIdOf = (value: unknown) =>
  value && typeof value === 'object' && ELEMENT_KEY in value ? String((value as Record<string, unknown>)[ELEMENT_KEY]) : null;

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

export class WebDriverSession {
  readonly serverUrl: string;
  readonly id: string;
  readonly capabilities: Record<string, unknown>;
  timeoutMs: number;

  constructor(serverUrl: string, id: string, capabilities: Record<string, unknown>, timeoutMs = 60_000) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.id = id;
    this.capabilities = capabilities;
    this.timeoutMs = timeoutMs;
  }

  /** New Session: `capabilities` go in `alwaysMatch`. */
  static async create(serverUrl: string, capabilities: Record<string, unknown>, timeoutMs = 120_000) {
    const value = (await call(`${serverUrl.replace(/\/$/, '')}/session`, 'POST', { capabilities: { alwaysMatch: capabilities } }, timeoutMs)) as {
      sessionId: string;
      capabilities?: Record<string, unknown>;
    };
    return new WebDriverSession(serverUrl, value.sessionId, value.capabilities ?? {});
  }

  /** Any session command, for what this client does not wrap (extensions such as `appium/...`). */
  command(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
    return call(`${this.serverUrl}/session/${this.id}${path}`, method, method === 'POST' ? (body ?? {}) : undefined, this.timeoutMs);
  }

  async navigate(url: string) {
    await this.command('POST', '/url', { url });
  }
  async currentUrl() {
    return String(await this.command('GET', '/url'));
  }
  async refresh() {
    await this.command('POST', '/refresh');
  }
  async back() {
    await this.command('POST', '/back');
  }

  async findElements(locator: Locator) {
    const value = await this.command('POST', '/elements', { using: locator.using, value: locator.value });
    return Array.isArray(value) ? value.map(elementIdOf).filter((id): id is string => Boolean(id)) : [];
  }
  async isDisplayed(element: string) {
    return Boolean(await this.command('GET', `/element/${element}/displayed`));
  }
  async rect(element: string) {
    return (await this.command('GET', `/element/${element}/rect`)) as Rect;
  }
  async click(element: string) {
    await this.command('POST', `/element/${element}/click`);
  }
  async clear(element: string) {
    await this.command('POST', `/element/${element}/clear`);
  }
  async sendKeys(element: string, text: string) {
    await this.command('POST', `/element/${element}/value`, { text });
  }
  async elementText(element: string) {
    return String(await this.command('GET', `/element/${element}/text`));
  }

  /** Execute Script (web contexts); element references in the result come back as element ids. */
  async execute(script: string, args: unknown[] = []) {
    return this.command('POST', '/execute/sync', { script, args });
  }
  elementId(value: unknown) {
    return elementIdOf(value);
  }

  async source() {
    return String(await this.command('GET', '/source'));
  }

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

  async delete() {
    await call(`${this.serverUrl}/session/${this.id}`, 'DELETE', undefined, this.timeoutMs);
  }
}

/** Wait until a WebDriver server answers `GET /status` as ready. */
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
