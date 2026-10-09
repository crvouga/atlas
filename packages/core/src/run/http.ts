import type { Driver, Timeline } from './types';

export type HttpResponse = { status: number; ok: boolean; headers: Headers; text: string; json: unknown };

export type HttpRequestOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  /** What the timeline says this call was for; `METHOD /path` when omitted. */
  label?: string;
};

/** What every event and recogniser receives from an HTTP client: a fetch with a base URL and a cookie jar. */
export type HttpClient = {
  baseUrl: string;
  /** Sent with every request; set an `authorization` header here after signing in. */
  headers: Record<string, string>;
  cookies: Map<string, string>;
  request(method: string, path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  get(path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  post(path: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse>;
  put(path: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse>;
  patch(path: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse>;
  delete(path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
};

export type HttpDriverOptions = {
  name?: string;
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
 * the step's timeline (method, path, status; never bodies).
 */
export function httpDriver(baseUrl: string | (() => string | Promise<string>), options: HttpDriverOptions = {}): Driver<HttpClient> {
  return {
    name: options.name ?? 'http',
    async open({ timeline }) {
      return httpClient(typeof baseUrl === 'function' ? await baseUrl() : baseUrl, timeline, options);
    },
    async close() {
      return undefined;
    }
  };
}
