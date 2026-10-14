/**
 * Server-sent events: what the server tells every connected viewer the moment it happens. A viewer that
 * misses some (a dropped connection, a laptop that slept) loses nothing: events say "something changed", the
 * state is always fetched, and a viewer fetches it again on reconnecting.
 */
export type EventName = 'hello' | 'report' | 'atlas:change';

type Subscriber = { readonly send: (chunk: Uint8Array) => void; readonly close: () => void };

/** Events a viewer may be behind by before it is let go. */
const MAX_BACKLOG = 256;

export class EventHub {
  readonly #subscribers = new Set<Subscriber>();
  readonly #max: number;
  readonly #heartbeatMs: number;
  readonly #encoder = new TextEncoder();
  #id = 0;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: { readonly maxSubscribers?: number; readonly heartbeatMs?: number } = {}) {
    this.#max = options.maxSubscribers ?? 500;
    this.#heartbeatMs = options.heartbeatMs ?? 15_000;
  }

  get count(): number {
    return this.#subscribers.size;
  }

  /** Tell every viewer. `data` is JSON. */
  publish(name: EventName, data: unknown): void {
    this.#id += 1;
    // Written once, however many are listening.
    const frame = this.#encoder.encode(`id: ${this.#id}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const subscriber of [...this.#subscribers]) subscriber.send(frame);
  }

  /** A stream for one viewer, starting with `hello` (what `greeting` returns). It ends when the viewer goes. */
  stream(request: Request, greeting: () => unknown): Response {
    if (this.#subscribers.size >= this.#max) return Response.json({ error: 'Too many viewers are connected for live updates; they will poll instead.' }, { status: 503, headers: { 'retry-after': '30' } });
    let subscriber: Subscriber | null = null;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (chunk: Uint8Array) => {
          try {
            // A viewer that has stopped reading (a laptop asleep, a dead connection) must not make the server hold its backlog: it reconnects and reads everything again.
            if ((controller.desiredSize ?? 1) < -MAX_BACKLOG) { drop(); controller.close(); return; }
            controller.enqueue(chunk);
          } catch { drop(); }
        };
        const drop = () => { if (subscriber) this.#subscribers.delete(subscriber); subscriber = null; if (!this.#subscribers.size) this.#stopTimer(); };
        subscriber = { send, close: () => { drop(); try { controller.close(); } catch { /* already closed */ } } };
        this.#subscribers.add(subscriber);
        this.#startTimer();
        // `retry` is how long the browser waits before reconnecting by itself.
        send(this.#encoder.encode(`retry: 3000\n\n`));
        this.#id += 1;
        send(this.#encoder.encode(`id: ${this.#id}\nevent: hello\ndata: ${JSON.stringify(greeting())}\n\n`));
        request.signal.addEventListener('abort', drop, { once: true });
      },
      cancel: () => { if (subscriber) this.#subscribers.delete(subscriber); subscriber = null; if (!this.#subscribers.size) this.#stopTimer(); }
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
  }

  #startTimer(): void {
    if (this.#timer) return;
    // A comment line: proxies and load balancers see traffic and keep the connection; viewers ignore it.
    const ping = this.#encoder.encode(': ping\n\n');
    this.#timer = setInterval(() => { for (const subscriber of [...this.#subscribers]) subscriber.send(ping); }, this.#heartbeatMs);
    (this.#timer as { unref?: () => void }).unref?.();
  }

  #stopTimer(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** End every stream, for shutting down. */
  close(): void {
    for (const subscriber of [...this.#subscribers]) subscriber.close();
    this.#stopTimer();
  }
}
