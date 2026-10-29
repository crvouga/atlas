/**
 * @module The catalog client
 *
 * How a critic process reads the UI catalog from an Atlas server: list entries a page at a time with a stable cursor
 * (`page`, `entries`), read only what changed since a report version it holds (`since`), follow the server's event stream and
 * catch up after every announcement or reconnection without missing an entry or handling one twice (`follow`), and fetch an
 * entry's picture by the hash it was stored under, checking the bytes against it (`image`). It needs only `fetch`: no
 * browser, no model, no SDK. The token goes in `Authorization: Bearer`, never in a URL, and is never put in an error.
 *
 * A missed event costs nothing: every wake-up is followed by a `since` read, and a version the server does not remember is
 * answered with the whole catalog, which the client de-duplicates by entry key and picture hash.
 *
 * @see docs/critics.md#reading-the-catalog
 */
import { CatalogEntriesSchema } from '../../schema/src/api';
import { catalogEntriesParams, type CatalogEntriesQuery, type CatalogEntry } from '../../reports/src/ui-catalog-entries';
import { sha256Hex } from '../../reports/src/sigv4';

/** How to reach a server. `token` is a `critic`, `publish` or `admin` token for reading the catalog; any token that may read works. */
export type CatalogClientOptions = {
  /** The Atlas server, such as `https://atlas.example.com`. */
  readonly url: string;
  /** Sent as `Authorization: Bearer`. Never put in the URL, never in an error. */
  readonly token?: string;
  /** A project of a shared node. Omit for the default project. */
  readonly project?: string;
  /** For tests and special runtimes. Default `fetch`. */
  readonly fetch?: typeof fetch;
  /** Retries after the first attempt for network errors, 5xx and 429. Default 3. */
  readonly retries?: number;
  /** Waits. Default `setTimeout`. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/** One page of the catalog as the server answered it. */
export type CatalogPage = {
  /** The report version this was read at. */
  readonly version: string;
  readonly entries: readonly CatalogEntry[];
  /** Entries that match, across all pages. */
  readonly total: number;
  /** Pass as `cursor` to read the next page; absent on the last. */
  readonly nextCursor?: string;
  /** Present when `since` was asked: whether the server remembered that version. When it did not, `entries` is the whole catalog. */
  readonly since?: { readonly requested: string; readonly honored: boolean };
  /** Captured cells that could not be offered for judging because no stored picture of a known hash backs them. */
  readonly unjudgeable: number;
  /** What the server could not read. */
  readonly notices: readonly string[];
};

/** Everything a pass over the catalog saw, and the version to resume from. */
export type CatalogRead = {
  /** The version of the first page. Resume with `since` this: it finds whatever changed while the rest was read. */
  readonly version: string;
  readonly entries: readonly CatalogEntry[];
  readonly unjudgeable: number;
  readonly notices: readonly string[];
  /** False when a `since` was asked and the server did not remember it, so `entries` is the whole catalog. */
  readonly sinceHonored: boolean;
};

/** Something new in the catalog, as {@link CatalogClient.follow} hands it over. */
export type CatalogBatch = {
  /** The report version this batch brings the follower up to. */
  readonly version: string;
  /** Entries not seen before, or whose picture changed; none twice. */
  readonly entries: readonly CatalogEntry[];
  /** True for the first batch (the catch-up on connecting), false for what arrived afterwards. */
  readonly initial: boolean;
};

/** An Atlas server refused or could not answer, with what to do about it. Its message never holds a token. */
export class CatalogClientError extends Error {
  /** @param status the HTTP status, or null when the server could not be reached. */
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'CatalogClientError';
  }
}

/** A connection to the catalog of one Atlas server. */
export type CatalogClient = {
  /** The server address, with no secrets. */
  readonly url: string;
  /** One page of entries for a query (`cursor`, `limit`, `since`, `unjudgedBy`, filters). */
  page(query?: CatalogEntriesQuery): Promise<CatalogPage>;
  /** Every page of a query, in key order, each entry once. `query.cursor` is ignored. */
  read(query?: Omit<CatalogEntriesQuery, 'cursor'>): Promise<CatalogRead>;
  /** The picture of an entry: its stored bytes, checked against `entry.image.sha256`. Throws if they differ. */
  image(entry: Pick<CatalogEntry, 'image'>): Promise<Uint8Array>;
  /**
   * Catches up with the catalog and then follows it: a batch on connecting (everything, or what changed since `since`), then
   * a batch each time the server announces a change. A dropped connection is reconnected after a pause, and the next batch
   * is a `since` read from the version held, so nothing is missed and nothing is handed over twice. Ends when `signal` aborts.
   */
  follow(options?: { readonly since?: string; readonly query?: Omit<CatalogEntriesQuery, 'cursor' | 'since'>; readonly signal?: AbortSignal; readonly reconnectMs?: number }): AsyncGenerator<CatalogBatch, void, void>;
};

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => {
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
});

const encode = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/**
 * A client for the catalog of an Atlas server. Nothing is read until a method is called.
 *
 * @example
 * const catalog = createCatalogClient({ url: 'https://atlas.example.com', token: process.env.ATLAS_CRITIC_TOKEN });
 * const { version, entries } = await catalog.read({ unjudgedBy: { name: 'uiclip', version: '1.0.0' } });
 * for (const entry of entries) judge(entry, await catalog.image(entry));
 */
export function createCatalogClient(options: CatalogClientOptions): CatalogClient {
  const base = options.url.replace(/\/+$/, '');
  const api = options.project ? `${base}/api/projects/${encodeURIComponent(options.project)}` : `${base}/api`;
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const retries = options.retries ?? 3;
  const headers: Record<string, string> = options.token ? { authorization: `Bearer ${options.token}` } : {};

  function explain(status: number, said: string | null): CatalogClientError {
    const tail = said ? `: ${said.replace(/[.\s]+$/, '')}` : '';
    if (status === 401) return new CatalogClientError(`${base} wants a token${tail}. Set ATLAS_CRITIC_TOKEN (or ATLAS_TOKEN): a critic, publish or admin token.`, status);
    if (status === 403) return new CatalogClientError(`${base} knows this token but it may not do that${tail}.`, status);
    if (status === 404) return new CatalogClientError(`${base} has no such thing${tail}. An older server may not have the catalog list: upgrade it.`, status);
    return new CatalogClientError(`${base} answered ${status}${tail}`, status);
  }

  async function request(url: string, init: { readonly accept?: string; readonly signal?: AbortSignal } = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let failure: CatalogClientError;
      try {
        const response = await doFetch(url, { headers: { ...headers, ...(init.accept ? { accept: init.accept } : {}) }, ...(init.signal ? { signal: init.signal } : {}) });
        if (response.ok) return response;
        const said = await response.json().then((body: unknown) => (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : null), () => null);
        failure = explain(response.status, said);
        if (response.status < 500 && response.status !== 429) throw failure;
      } catch (error) {
        if (init.signal?.aborted) throw error;
        if (error instanceof CatalogClientError && error.status !== null && error.status < 500 && error.status !== 429) throw error;
        failure = error instanceof CatalogClientError ? error : new CatalogClientError(`cannot reach ${base} (${error instanceof Error ? error.message : String(error)})`, null);
      }
      if (attempt >= retries) throw failure;
      await sleep(Math.min(8_000, 100 * 2 ** attempt) * (0.5 + Math.random() / 2), init.signal);
    }
  }

  async function page(query: CatalogEntriesQuery = {}): Promise<CatalogPage> {
    const search = catalogEntriesParams(query).toString();
    const response = await request(`${api}/reports/ui-catalog/entries${search ? `?${search}` : ''}`, { accept: 'application/json' });
    const parsed = CatalogEntriesSchema.safeParse(await response.json().catch(() => null));
    // A document this reader cannot read is unknown, never an empty catalog.
    if (!parsed.success) throw new CatalogClientError(`${base} answered something that is not a catalog list. Upgrade @crvouga/atlas, or the server.`, response.status);
    const document = parsed.data;
    return {
      version: document.version, entries: document.entries.map(entry => ({ ...entry, marks: entry.marks ?? [] })) as unknown as CatalogEntry[], total: document.total, unjudgeable: document.unjudgeable, notices: document.sources.notices,
      ...(document.nextCursor ? { nextCursor: document.nextCursor } : {}),
      ...(document.since ? { since: document.since } : {})
    };
  }

  async function read(query: Omit<CatalogEntriesQuery, 'cursor'> = {}): Promise<CatalogRead> {
    const entries: CatalogEntry[] = [];
    let version: string | undefined, unjudgeable = 0, notices: readonly string[] = [], sinceHonored = true;
    for (let cursor: string | undefined; ;) {
      const found = await page({ ...query, ...(cursor === undefined ? {} : { cursor }) });
      if (version === undefined) { version = found.version; sinceHonored = found.since?.honored ?? true; }
      unjudgeable = found.unjudgeable;
      notices = found.notices;
      entries.push(...found.entries);
      if (!found.nextCursor) break;
      cursor = found.nextCursor;
    }
    return { version: version!, entries, unjudgeable, notices, sinceHonored };
  }

  async function image(entry: Pick<CatalogEntry, 'image'>): Promise<Uint8Array> {
    const response = await request(`${api}/reports${encode(entry.image.path)}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if ((await sha256Hex(bytes)) !== entry.image.sha256) throw new CatalogClientError(`The picture ${entry.image.path} is not the bytes the catalog hashed (${entry.image.sha256.slice(0, 12)}…); nothing was judged.`, response.status);
    return bytes;
  }

  async function* follow(followOptions: { since?: string; query?: Omit<CatalogEntriesQuery, 'cursor' | 'since'>; signal?: AbortSignal; reconnectMs?: number } = {}): AsyncGenerator<CatalogBatch, void, void> {
    const signal = followOptions.signal;
    let held = followOptions.since;
    let initial = true;
    // What was handed over: an entry is new when its key is unseen or its picture changed.
    const seen = new Map<string, string>();
    async function* catchUp(): AsyncGenerator<CatalogBatch, void, void> {
      const found = await read({ ...(followOptions.query ?? {}), ...(held === undefined ? {} : { since: held }) });
      const fresh = found.entries.filter(entry => seen.get(entry.key) !== entry.image.sha256);
      for (const entry of fresh) seen.set(entry.key, entry.image.sha256);
      held = found.version;
      if (fresh.length || initial) { const batch = { version: found.version, entries: fresh, initial }; initial = false; yield batch; }
    }
    while (!signal?.aborted) {
      let response: Response | undefined;
      try {
        response = await request(`${api}/events`, { accept: 'text/event-stream', ...(signal ? { signal } : {}) });
      } catch (error) {
        if (signal?.aborted) return;
        // A refusal will not pass by waiting; the server being away will.
        if (error instanceof CatalogClientError && error.status !== null && error.status !== 503) throw error;
      }
      if (response?.body) {
        // Whatever happened while disconnected is found by this read, not by the events that were missed.
        try {
          yield* catchUp();
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffered = '';
          const onAbort = () => { reader.cancel().catch(() => {}); };
          signal?.addEventListener('abort', onAbort, { once: true });
          try {
            for (;;) {
              const chunk = await reader.read();
              if (chunk.done) break;
              buffered += decoder.decode(chunk.value, { stream: true });
              let end: number;
              while ((end = buffered.indexOf('\n\n')) >= 0) {
                const frame = buffered.slice(0, end);
                buffered = buffered.slice(end + 2);
                const name = /^event: (.+)$/m.exec(frame)?.[1];
                if (name === 'report') yield* catchUp();
              }
            }
          } finally {
            signal?.removeEventListener('abort', onAbort);
          }
        } catch (error) {
          if (signal?.aborted) return;
          if (error instanceof CatalogClientError && error.status !== null && error.status !== 503) throw error;
        }
      }
      if (signal?.aborted) return;
      await sleep(followOptions.reconnectMs ?? 2_000, signal);
    }
  }

  return { url: base, page, read, image, follow };
}
