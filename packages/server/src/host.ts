import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

export type RunningServer = {
  readonly port: number;
  readonly url: string;
  /** Stop accepting, let requests in flight finish for up to `graceMs`, then end what is left. */
  close(graceMs?: number): Promise<void>;
};

export type ListenOptions = {
  readonly port: number;
  readonly host: string;
  /** The largest request body to read, in bytes. */
  readonly maxBodyBytes: number;
};

type Handler = (request: Request) => Promise<Response> | Response;

const display = (host: string, port: number) => `http://${host === '0.0.0.0' || host === '::' ? 'localhost' : host}:${port}`;

/**
 * Serve a fetch handler. On Bun, which is what Atlas is made for, that is `Bun.serve`: one native server for the
 * API, the live streams and the page. On Node it is the same handler behind `node:http`, so the package still runs
 * where Bun is not installed.
 */
export async function listen(handler: Handler, options: ListenOptions): Promise<RunningServer> {
  const bun = getBun();
  if (bun) return listenBun(bun, handler, options);
  return listenNode(handler, options);
}

type BunRuntime = { serve: (options: Record<string, unknown>) => { port: number; stop: (force?: boolean) => Promise<void> | void } };
const getBun = () => (globalThis as unknown as { Bun?: BunRuntime }).Bun;

async function listenBun(bun: BunRuntime, handler: Handler, options: ListenOptions): Promise<RunningServer> {
  const server = bun.serve({
    port: options.port,
    hostname: options.host,
    // Live streams are quiet between heartbeats; the longest idle time Bun allows keeps them open.
    idleTimeout: 120,
    maxRequestBodySize: options.maxBodyBytes + 1024 * 1024,
    fetch: handler,
    error: (error: Error) => Response.json({ error: error.message }, { status: 500 })
  });
  return {
    port: server.port,
    url: display(options.host, server.port),
    close: async (graceMs = 10_000) => {
      // Stop taking new connections and let requests in flight finish; end the rest after the grace period.
      const closing = Promise.resolve(server.stop(false));
      const timer = setTimeout(() => { void server.stop(true); }, graceMs);
      (timer as { unref?: () => void }).unref?.();
      await closing;
      clearTimeout(timer);
    }
  };
}
function toRequest(req: IncomingMessage, host: string, maxBodyBytes: number): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  let size = 0;
  const body = hasBody ? (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { size += chunk.byteLength; if (size > maxBodyBytes) controller.error(new Error('The request body is too large')); else controller.enqueue(chunk); } })) : null;
  return new Request(`http://${req.headers.host ?? host}${req.url ?? '/'}`, { method, headers, ...(body ? { body, duplex: 'half' } as RequestInit : {}) });
}

async function send(response: Response, res: ServerResponse, head: boolean): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => { headers[name] = value; });
  const cookies = response.headers.getSetCookie?.();
  if (cookies?.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  if (head || !response.body) { res.end(); return; }
  const reader = response.body.getReader();
  res.on('close', () => { void reader.cancel().catch(() => {}); });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!res.write(value)) await new Promise<void>(resolve => res.once('drain', resolve));
  }
  res.end();
}

async function listenNode(handler: Handler, options: ListenOptions): Promise<RunningServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      try {
        const request = toRequest(req, options.host, options.maxBodyBytes);
        const abortable = new Request(request, { signal: controller.signal });
        await send(await handler(abortable), res, req.method === 'HEAD');
      } catch (error) {
        if (!res.headersSent) await send(Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }), res, false).catch(() => {});
        else res.destroy();
      }
    })();
  });
  server.keepAliveTimeout = 65_000;
  server.requestTimeout = 0;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, options.host, resolve); });
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: display(options.host, port),
    close: (graceMs = 10_000) => new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
      const timer = setTimeout(() => { server.closeAllConnections?.(); }, graceMs);
      (timer as { unref?: () => void }).unref?.();
    })
  };
}
