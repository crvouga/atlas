/**
 * @module HTTP driver
 *
 * A driver (and a bare client) for acting on or observing a system over HTTP, with no browser or
 * device: a fetch with a base URL, a cookie jar and timeline logging. It is the fastest driver and
 * runs any number of attempts side by side, each with its own cookie jar. Uses the global `fetch`.
 */
import type { Driver, Timeline } from './types';

/** The response of an `HttpClient` call; the body is read in full. */
export type HttpResponse = {
  status: number;
  /** True for a 2xx status. A non-2xx status does not throw. */
  ok: boolean;
  headers: Headers;
  /** The body as text. */
  text: string;
  /** The body parsed as JSON when the content type is JSON and it parses; `null` otherwise (also for a literal JSON `null`). */
  json: unknown;
};

/** Per-call options of an `HttpClient`. */
export type HttpRequestOptions = {
  /** A string is sent as is; anything else is sent as JSON with a `content-type: application/json` header. */
  body?: unknown;
  /** Added to the client's headers for this call and overriding them (and the cookie header) on conflict. */
  headers?: Record<string, string>;
  /** What the timeline says this call was for; `METHOD /path` when omitted. */
  label?: string;
};

/** What every event and recogniser receives from an HTTP client: a fetch with a base URL and a cookie jar. */
export type HttpClient = {
  /** The URL that request paths are resolved against with `new URL(path, baseUrl)`: a path starting with `/` replaces any path in the base URL. */
  baseUrl: string;
  /** Sent with every request; set an `authorization` header here after signing in. */
  headers: Record<string, string>;
  /** Cookie name to value, stored from `Set-Cookie` responses and sent back on every request. Only the name and value are kept (no expiry, path or domain handling). */
  cookies: Map<string, string>;
  /** Sends a request. Rejects on a network error or timeout; resolves for any HTTP status. Each call adds a `system` entry (method, path, status, never bodies) to the timeline. */
  request(method: string, path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  get(path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  post(path: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse>;
  put(path: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse>;
  patch(path: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse>;
  delete(path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
};

/** Options for `httpDriver` and `httpClient`. */
export type HttpDriverOptions = {
  /** The driver's name and the `source` recorded on timeline entries; `http` when omitted. */
  name?: string;
  /** Headers sent with every request. */
  headers?: Record<string, string>;
  /** Per request, in milliseconds (default 30 000). */
  timeoutMs?: number;
};

function parseBody(text: string, contentType: string | null) {
  if (!text || !contentType || !/[/+]json\b/i.test(contentType)) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Creates an `HttpClient` that logs each call to `timeline`. Use it directly when you need a client
 * outside a driver; `httpDriver` creates one per path attempt.
 *
 * @param baseUrl the URL request paths are resolved against.
 */
export function httpClient(baseUrl: string, timeline: Timeline, options: HttpDriverOptions = {}): HttpClient {
  const source = options.name ?? 'http';
  const client: HttpClient = {
    baseUrl,
    headers: { ...options.headers },
    cookies: new Map(),
    async request(method, path, { body, headers, label } = {}) {
      const url = new URL(path, baseUrl);
      const cookie = [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      const init: RequestInit = {
        method,
        headers: {
          ...client.headers,
          ...(body !== undefined && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers
        },
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
      };
      const response = await fetch(url, init);
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const at = pair?.indexOf('=') ?? -1;
        if (pair && at > 0) client.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
      }
      const text = await response.text();
      timeline.add({
        kind: 'system',
        label: label ?? `${method} ${url.pathname} → ${response.status}`,
        system: { source, endpoint: `${method} ${url.pathname}`, responseStatus: response.status }
      });
      return { status: response.status, ok: response.ok, headers: response.headers, text, json: parseBody(text, response.headers.get('content-type')) };
    },
    get: (path, o) => client.request('GET', path, o),
    post: (path, body, o) => client.request('POST', path, { ...o, body }),
    put: (path, body, o) => client.request('PUT', path, { ...o, body }),
    patch: (path, body, o) => client.request('PATCH', path, { ...o, body }),
    delete: (path, o) => client.request('DELETE', path, o)
  };
  return client;
}

/**
 * The fastest driver: a client of an HTTP API, with no browser or device. Use it for actors that
 * only talk to the system (a partner webhook, an operator API, a back office job) or to drive a
 * whole chart at the API level. Each path attempt gets a fresh cookie jar; every call is logged to
 * the step's timeline (method, path, status; never bodies). Has no screenshots or clips, and no limit on
 * concurrent attempts.
 *
 * @param baseUrl the API's base URL, or a function returning it (called for each attempt).
 *
 * @example
 * const driver = httpDriver('http://127.0.0.1:4000', { headers: { 'x-test': '1' } });
 * // events then receive an HttpClient: run: (api) => api.post('/orders', { sku: 'A1' })
 */
export function httpDriver(baseUrl: string | (() => string | Promise<string>), options: HttpDriverOptions = {}): Driver<HttpClient> {
  return {
    name: options.name ?? 'http',
    concurrency: Number.POSITIVE_INFINITY,
    async open({ timeline }) {
      return httpClient(typeof baseUrl === 'function' ? await baseUrl() : baseUrl, timeline, options);
    },
    async close() {
      return undefined;
    }
  };
}
