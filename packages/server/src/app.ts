/**
 * @module The Atlas server application
 *
 * `createAtlasServer` is the whole of a project's Atlas as one `fetch` handler: the API results are uploaded to, the live
 * report every viewer is shown, the gate, the server-sent event stream, the specs and runs the viewer reads, the viewer
 * itself, and the server's own description (`/api/openapi.json`, `/llms.txt`). What it knows lives in its backends (by
 * default a folder on its own disk), so replacing it loses nothing. Every error leaves as an RFC 9457 problem document; every
 * route is described in `openapi.ts` (a test holds the two together).
 *
 * @see docs/server.md
 */

import { createHash } from 'node:crypto';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';

import { Hono, type Context } from 'hono';

import { UNTRUSTED_HEADERS } from '../../reports/src/attachment-response';
import { combineBackends, summarize, type BackendInput, type CombinedReport } from '../../reports/src/compose';
import { combineEvidence } from '../../reports/src/layer-merge';
import type { LayerHeader } from '../../reports/src/evidence-types';
import { layerCatalogKey } from '../../reports/src/layer-store';
import { createLayersApp } from '../../reports/src/layers-route';
import type { ReportOutline } from '../../reports/src/layer-types';
import type { ObjectStore } from '../../reports/src/object-store';
import { readArtifactTagEntries, recordArtifactTags, ArtifactTagError } from '../../reports/src/artifact-tag-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { reportStatus } from '../../reports/src/report-status';
import { ReportIndex, type IndexChange } from '../../reports/src/report-index';
import { listRunSummaries, readRunFile } from '../../reports/src/run-bundle';
import { latestSpecSet, readSpecBody } from '../../reports/src/spec-set';
import { catalogHealth, healthMarkdown, parseRootMapping, parseRootMappings, type RootMapping } from '../../reports/src/catalog-health';
import { parseArtifactFilter } from '../../reports/src/artifact-query';
import { filterUiCatalog, pageUiCatalog, parseUiCatalogQuery, uiCatalog, uiCatalogMarkdown } from '../../reports/src/ui-catalog';
import { parseReliabilityScope, reliability, reliabilityMarkdown } from '../../reports/src/reliability';
import { artifactList, artifactsMarkdown, catalogMarkdown, catalogModel, historyMarkdown, parseTestQuery, runDetail, runList, runMarkdown, runsMarkdown, testCatalog, testHistory, type CatalogModel } from '../../reports/src/test-catalog';
import { llmsTxt } from './llms';
import { openApiDocument } from './openapi';
import { asProblem, problemResponse } from './problem';
import { LiveRunStartSchema, LiveRunUpdateSchema } from '../../schema/src/live-run';
import { LiveRuns, LiveRunError } from './live-runs';
import { ConfigError } from './config';
import { renderSettingsPage, type GcSettings, type ServerSettings } from './settings';
import { collectGarbage, planGarbage } from '../../reports/src/garbage';
import type { GcPolicy, GcRun } from '../../schema/src/user-state';
import { Refusal } from './validate';
import { createAuth, type Auth } from './auth';
import type { ResolvedToken } from './config';
import { EventHub } from './events';
import { projectServer } from './projects';
import { mountReviewCollections } from './review-collections';
import { readLimited, storeApi } from './store-api';

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

/** What the server is built from: its `backends` (read together) and which one takes uploads (`write`), `tokens`, the built `site`, the report's filters (`include`, `outlineBranch`), `limits`, timings, `log`, and `now` for tests. */
export type AtlasServerOptions = {
  /** Every backend, read together. */
  readonly backends: readonly BackendInput[];
  /** The id of the backend uploads go to. */
  readonly write: string;
  /** Operational lease storage. Defaults to the write backend; HTTP relays use their own local store. */
  readonly liveStore?: ObjectStore;
  readonly tokens?: readonly ResolvedToken[];
  readonly anonymousRead?: boolean;
  /** The built viewer. Without it, only the API is served. */
  readonly site?: string;
  readonly outlineBranch?: string;
  /** Root mappings `from>to` the catalog health report always applies (the `catalog.roots` setting), beside any `root` a request adds. */
  readonly catalogRoots?: readonly string[];
  readonly include?: (layer: LayerHeader) => boolean;
  readonly refreshMs?: number;
  readonly limits?: { readonly maxObjectMiB?: number; readonly maxJsonMiB?: number; readonly maxStreams?: number };
  readonly heartbeatMs?: number;
  /** Producer lease timeout; default 30 seconds. */
  readonly runTimeoutMs?: number;
  /** Maximum time without progress; default 15 minutes, 0 disables. */
  readonly runStallMs?: number;
  readonly log?: (line: Record<string, unknown>) => void;
  readonly now?: () => number;
  readonly version?: string;
  /** Admin configuration persistence, supplied by atlas serve; kept in S3. Changes apply on restart. */
  readonly settings?: ServerSettings;
  /** The garbage collection policy, kept in S3 and read from there each time the server collects. Supplied by atlas serve. */
  readonly gc?: GcSettings;
  /** How often (ms) the server checks whether a garbage collection pass is due. Default 60 000; for tests. */
  readonly gcCheckMs?: number;
  /** Extra runtime configuration written into the page. */
  readonly page?: Record<string, unknown>;
};

/** A running server application: `fetch` (serve requests), `index` (the live report), `events` (the viewers), `routes` (what it answers), `ready` (the first pass over the backends is done) and `close`. */
export type AtlasServer = {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly index: ReportIndex;
  readonly events: EventHub;
  /** The routes the server answers, as registered: what the OpenAPI document must describe (a test holds the two together). */
  readonly routes: readonly { readonly method: string; readonly path: string }[];
  /** Resolves when the first pass over the backends is done. */
  readonly ready: Promise<void>;
  /**
   * Apply a garbage collection policy to this project's upload backend. Deletes only layers the report has read and
   * that no longer decide any result, older than the policy allows and beyond its `keepLatest`. With `dryRun` it only
   * counts. Never throws: a failure is the `error` of the returned run.
   */
  collectGarbage(policy: GcPolicy, options: { readonly dryRun: boolean; readonly project: string }): Promise<GcRun>;
  /** Stop refreshing and end every live connection. */
  close(): void;
};

const TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', map: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', txt: 'text/plain; charset=utf-8', wasm: 'application/wasm'
};
const typeOf = (file: string) => TYPES[file.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream';
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;
const MiB = 1024 * 1024;

type Cached<T> = { (): Promise<T>; invalidate(): Promise<void> };

/**
 * The whole of a project's Atlas on one process: the API that results are uploaded to, the live report every
 * viewer is shown, and the viewer itself. All of it is under one host, `/api` for the API and `/` for the page.
 * What it knows lives in its backends (by default a folder on its own disk), so replacing it loses nothing.
 */
export function createAtlasServer(options: AtlasServerOptions): AtlasServer {
  return projectServer(options, createProjectApplication);
}

function createProjectApplication(options: AtlasServerOptions): AtlasServer {
  const now = options.now ?? Date.now;
  const backends = options.backends;
  const writeBackend = backends.find(backend => backend.id === options.write);
  if (!writeBackend) throw new Error(`The write backend "${options.write}" is not among the backends (${backends.map(backend => backend.id).join(', ')})`);
  const stores: ObjectStore[] = backends.map(backend => backend.store);
  const auth: Auth = createAuth(options.tokens ?? [], options.anonymousRead ?? false);
  const limits = { object: (options.limits?.maxObjectMiB ?? 256) * MiB, json: (options.limits?.maxJsonMiB ?? 32) * MiB };
  const index = new ReportIndex(backends, { now, ...(options.include ? { include: options.include } : {}) });
  const events = new EventHub({ maxSubscribers: options.limits?.maxStreams ?? 500, heartbeatMs: options.heartbeatMs ?? 15_000 });
  const live = new LiveRuns({ store: options.liveStore ?? writeBackend.store, now, timeoutMs: options.runTimeoutMs ?? 30_000, stalledMs: options.runStallMs ?? 900_000,
    onChange: run => {
      events.publish('run', run);
      events.publish('atlas:change', { scope: 'runs', files: [], runIds: [], liveRunId: run.id });
    },
    onLayer: (key, layer) => index.accept(writeBackend.id, key, layer) });
  const leaseTimer = setInterval(() => { void live.sweep().catch(error => options.log?.({ level: 'error', error: String(error) })); }, Math.min(5000, options.runTimeoutMs ?? 30_000));
  leaseTimer.unref?.();
  const compressed = new Map<string, Promise<Uint8Array>>();
  const assets = new Map<string, Promise<Uint8Array>>();

  // Spec sets and runs change rarely: answer from memory, look again in the background, and look at once when
  // something that could change them was uploaded. `invalidate()` resolves when the fresh answer is in place, so
  // viewers are told to read again only when there is something new to read.
  function cached<T>(load: () => Promise<T>, ttlMs = 10_000): Cached<T> {
    let value: Promise<T> | undefined;
    let at = 0;
    let started = 0;
    let applied = 0;
    const reload = async (): Promise<void> => {
      const mine = ++started;
      at = now();
      try {
        const result = await load();
        // Loads can finish out of order: only the newest one started may replace what is held.
        if (mine > applied) { applied = mine; value = Promise.resolve(result); }
      } catch { /* what is held stays */ }
    };
    const read = (() => {
      if (!value) {
        const mine = ++started;
        at = now();
        value = load();
        value.then(() => { applied = Math.max(applied, mine); }, () => { value = undefined; });
      } else if (now() - at > ttlMs) {
        at = now();
        void reload();
      }
      return value!;
    }) as Cached<T>;
    read.invalidate = reload;
    return read;
  }
  const specSets = new Map<string, import('../../schema/src/layer').SpecSet>();
  const specs = cached(() => latestSpecSet(stores, options.outlineBranch, specSets));
  const lastRuns = new Map<number, Awaited<ReturnType<typeof listRunSummaries>>>();
  const runCatalog = stores.map(() => new Map<string, Awaited<ReturnType<typeof listRunSummaries>>[number]>());
  const runs = cached(async () => {
    const lists = await Promise.all(stores.map(async (store, i) => {
      try {
        const rows = await listRunSummaries(store, 100, runCatalog[i]!);
        lastRuns.set(i, rows);
        return rows;
      } catch {
        return lastRuns.get(i) ?? [];
      }
    }));
    const byId = new Map(lists.flat().map(run => [run.id, run]));
    return [...byId.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || (a.id < b.id ? -1 : 1));
  });

  const outline = async (): Promise<ReportOutline & { readSpec: (path: string) => Promise<string | null> }> => {
    const found = await specs();
    // Without a published spec set, the report is laid over the specs its layers recorded, as the CLI does.
    if (!found) return { specs: [...index.history.specs.entries()], sha: null, changedFiles: [], readSpec: async () => null };
    const entries = found.set.files.map(({ path: file, domain, kind, title, fingerprint }) => ({ path: file, domain, kind, title, fingerprint }));
    return { specs: entries, sha: found.set.sha, changedFiles: [], readSpec: async file => {
      const entry = found.set.files.find(item => item.path === file);
      return entry ? readSpecBody(found.store, entry.digest) : null;
    } };
  };

  const layers = createLayersApp({
    store: null, backends: backends.map(backend => ({ id: backend.id, label: backend.label ?? backend.id, store: backend.store })),
    clock: { now }, timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as never), setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: handle => clearInterval(handle as never) },
    outline,
    ...(options.include ? { include: options.include } : {})
  });

  // What every viewer is told when the report changes: small, and enough to say what arrived.
  const summaryOf = (change: IndexChange) => ({
    version: change.version,
    totalLayers: change.totalLayers,
    added: change.added.slice(0, 20).map(layer => ({ id: layer.id, producer: layer.producer, environment: layer.environment, branch: layer.branch, sha: layer.sha, recordedAtMs: layer.recordedAtMs, counts: layer.counts, ...(layer.freshness ? { freshness: layer.freshness } : {}) })),
    addedTotal: change.added.length
  });
  const stopListening = index.onChange(change => events.publish('report', summaryOf(change)));

  /**
   * A response, compressed when the client accepts it and it is worth it. What is the same for everyone (a page,
   * a script, one version of the report) is compressed once, however many ask at the same moment, and kept; `slow`
   * asks for the smallest form, which is worth waiting for only when it is made once and sent to every visitor:
   * the viewer's own files, which are kept for as long as the server runs.
   */
  async function body(c: Context, data: string | Uint8Array, contentType: string, headers: Record<string, string>, cacheKey?: string, slow = false): Promise<Response> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const accepts = c.req.header('accept-encoding') ?? '';
    const qualities = new Map(accepts.toLowerCase().split(',').map(part => {
      const [name, ...parameters] = part.trim().split(';');
      const q = parameters.map(parameter => /^\s*q\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*$/.exec(parameter)).find(Boolean);
      return [name!, q ? Number(q[1]) : parameters.some(parameter => /^\s*q\s*=/.test(parameter)) ? 0 : 1] as const;
    }));
    const quality = (name: string) => qualities.get(name) ?? qualities.get('*') ?? 0;
    const encoding = COMPRESSIBLE.test(contentType) && bytes.length > 1024
      ? slow && quality('br') > 0 && quality('br') >= quality('gzip') ? 'br' : quality('gzip') > 0 ? 'gzip' : null
      : null;
    let out: Uint8Array = bytes;
    if (encoding) {
      const key = cacheKey ? `${encoding}|${cacheKey}|${bytes.length}` : null;
      const kept = slow ? assets : compressed;
      let packing = key ? kept.get(key) : undefined;
      if (!packing) {
        packing = (encoding === 'br'
          ? brotliAsync(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes.length } })
          : gzipAsync(bytes)).then(packed => new Uint8Array(packed));
        if (key) {
          if (kept.size >= (slow ? 512 : 64)) kept.delete(kept.keys().next().value!);
          kept.set(key, packing);
          packing.catch(() => kept.delete(key));
        }
      }
      out = await packing;
    }
    return new Response(out as BodyInit, { headers: { 'content-type': contentType, vary: 'accept-encoding', ...(encoding ? { 'content-encoding': encoding } : {}), ...headers } });
  }

  const app = new Hono();
  const unauthorized = (verdict: Extract<ReturnType<Auth['check']>, { ok: false }>) =>
    problemResponse(verdict.status, verdict.message, verdict.status === 401 ? { 'www-authenticate': 'Basic realm="Atlas", charset="UTF-8"' } : {});

  // Everything but the probes and the store protocol (which checks for itself) needs at least a reader.
  app.use('*', async (c, next) => {
    const started = now();
    const pathname = new URL(c.req.url).pathname;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      const site = c.req.header('sec-fetch-site');
      // Browsers identify same-origin requests even when a TLS proxy forwards HTTP to Atlas.
      if (site === 'cross-site' || (origin && origin !== new URL(c.req.url).origin && site !== 'same-origin')) return problemResponse(403, 'Changes must come from this server origin.');
    }
    const open = pathname === '/healthz' || pathname === '/readyz' || pathname === '/llms.txt' || pathname === '/api/openapi.json' || pathname.startsWith('/api/store');
    if (!open) {
      const verdict = auth.check(c.req.raw, 'read');
      if (!verdict.ok) { c.res = unauthorized(verdict); } else await next();
    } else await next();
    // Every error, whichever handler made it, leaves as a problem document.
    if (c.res.status >= 400) { c.res = await asProblem(c.res); c.res.headers.set('cache-control', 'no-store'); }
    if (!auth.open && c.res.headers.get('cache-control')?.startsWith('public')) c.res.headers.set('cache-control', c.res.headers.get('cache-control')!.replace(/^public/, 'private'));
    if (pathname !== '/healthz' && pathname !== '/readyz') options.log?.({ at: new Date(started).toISOString(), method: c.req.method, path: pathname, status: c.res.status, ms: now() - started });
  });

  app.get('/healthz', c => c.json({ ok: true }));
  // What an agent handed only this server's address reads first: how to use it, and the machine-readable API.
  app.get('/llms.txt', c => {
    const forwarded = c.req.header('x-forwarded-host');
    const origin = forwarded ? `${c.req.header('x-forwarded-proto') ?? 'https'}://${forwarded}` : new URL(c.req.url).origin;
    return c.text(llmsTxt({ url: origin, open: auth.open, write: options.write }), 200, { 'cache-control': 'no-cache' });
  });
  app.get('/api/openapi.json', c => {
    const forwarded = c.req.header('x-forwarded-host');
    const serverUrl = forwarded ? `${c.req.header('x-forwarded-proto') ?? 'https'}://${forwarded}` : undefined;
    return c.json(openApiDocument(serverUrl ? { serverUrl } : {}), 200, { 'cache-control': 'no-cache' });
  });
  app.get('/readyz', c => {
    const snapshot = index.snapshot();
    const up = snapshot.backends.some(backend => backend.available);
    return c.json({ ready: index.ready && up, ...index.stats(), backends: snapshot.backends.map(({ id, available }) => ({ id, available })) }, index.ready && up ? 200 : 503);
  });

  // Who is asking, and what this server is: for the viewer's header, and for `atlas report doctor`.
  app.get('/api/server', c => {
    const identity = auth.identify(c.req.raw);
    const snapshot = index.snapshot();
    return c.json({
      name: 'atlas', version: options.version ?? null, role: identity?.role ?? 'read', open: auth.open,
      write: options.write, ready: index.ready, viewers: events.count, time: now(),
      backends: snapshot.backends.map(({ id, label, available }) => ({ id, label, available, write: id === options.write })),
      ...(({ backends: _unused, ...rest }) => rest)(index.stats()), capabilities: { events: true, ingest: true, store: true, checks: true, status: true, effective: true, live: true, tests: true, artifactTags: true, artifactSearch: true, reviewCollections: true }
    });
  });

  app.get('/api/live', async c => c.json({ runs: await live.list() }, 200, { 'cache-control': 'no-store' }));
  const writeLive = async (c: Context, action: 'start' | 'update' | 'heartbeat') => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return unauthorized(verdict);
    const owner = createHash('sha256').update(c.req.header('authorization') ?? 'open').digest('hex');
    const id = c.req.param('id')!;
    if (!/^[a-f0-9-]{36}$/.test(id)) return problemResponse(422, 'Invalid live run id.');
    try {
      if (action === 'heartbeat') { await live.heartbeat(id, owner); return c.json({ ok: true }); }
      const bytes = await readLimited(c.req.raw, Math.min(limits.json, 2 * MiB));
      let input: unknown;
      try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return problemResponse(422, 'The body is not JSON.'); }
      const schema = action === 'start' ? LiveRunStartSchema : LiveRunUpdateSchema;
      const parsed = schema.safeParse(input);
      if (!parsed.success) return problemResponse(422, parsed.error.message);
      if (action === 'start') {
        const start = LiveRunStartSchema.parse(parsed.data);
        if (start.id !== id) return problemResponse(422, 'Run ids must match.');
        return c.json(await live.start(start, owner), 201);
      }
      return c.json(await live.update(id, LiveRunUpdateSchema.parse(parsed.data), owner));
    } catch (error) {
      if (error instanceof LiveRunError) return problemResponse(error.status, error.message);
      if (error instanceof Refusal) return problemResponse(error.status, error.message);
      throw error;
    }
  };
  app.post('/api/live/:id', c => writeLive(c, 'start'));
  app.patch('/api/live/:id', c => writeLive(c, 'update'));
  app.post('/api/live/:id/heartbeat', c => writeLive(c, 'heartbeat'));

  app.get('/admin', async c => c.html(await renderSettingsPage(), 200, { 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff' }));
  app.get('/api/settings', async c => {
    const verdict = auth.check(c.req.raw, 'admin');
    if (!verdict.ok) return unauthorized(verdict);
    if (!options.settings) return problemResponse(503, 'Settings are managed by the embedding application.');
    return c.json(await options.settings.read(), 200, { 'cache-control': 'no-store' });
  });
  app.put('/api/settings', async c => {
    const verdict = auth.check(c.req.raw, 'admin');
    if (!verdict.ok) return unauthorized(verdict);
    if (!options.settings) return problemResponse(503, 'Settings are managed by the embedding application.');
    const revision = /^"([a-f0-9]{64})"$/.exec(c.req.header('if-match') ?? '')?.[1];
    if (!revision) return problemResponse(428, 'Load settings first and send their revision in If-Match.');
    try {
      const bytes = await readLimited(c.req.raw, Math.min(limits.json, 64 * 1024));
      let input: unknown;
      try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return problemResponse(422, 'The body is not JSON.'); }
      return c.json(await options.settings.save(input, revision), 200, { 'cache-control': 'no-store' });
    } catch (error) {
      if (error instanceof ConfigError) return problemResponse(error.message.startsWith('Settings changed') ? 409 : 422, error.message);
      if (error instanceof Refusal) return problemResponse(error.status, error.message);
      throw error;
    }
  });

  // The garbage collection policy: its own document in the user state, saved in S3 with the same revision rules.
  app.get('/api/settings/gc', async c => {
    const verdict = auth.check(c.req.raw, 'admin');
    if (!verdict.ok) return unauthorized(verdict);
    if (!options.gc) return problemResponse(503, 'Garbage collection settings are managed by the embedding application.');
    try { return c.json(await options.gc.read(), 200, { 'cache-control': 'no-store' }); } catch (error) {
      if (error instanceof ConfigError) return problemResponse(503, error.message);
      throw error;
    }
  });
  app.put('/api/settings/gc', async c => {
    const verdict = auth.check(c.req.raw, 'admin');
    if (!verdict.ok) return unauthorized(verdict);
    if (!options.gc) return problemResponse(503, 'Garbage collection settings are managed by the embedding application.');
    const revision = /^"([a-f0-9]{64})"$/.exec(c.req.header('if-match') ?? '')?.[1];
    if (!revision) return problemResponse(428, 'Load the policy first and send its revision in If-Match.');
    try {
      const bytes = await readLimited(c.req.raw, Math.min(limits.json, 16 * 1024));
      let input: unknown;
      try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return problemResponse(422, 'The body is not JSON.'); }
      return c.json(await options.gc.save(input, revision), 200, { 'cache-control': 'no-store' });
    } catch (error) {
      if (error instanceof ConfigError) return problemResponse(error.message.startsWith('Settings changed') ? 409 : 422, error.message);
      if (error instanceof Refusal) return problemResponse(error.status, error.message);
      throw error;
    }
  });

  // Live updates: told when the report changes, and when specs or runs do.
  app.get('/api/events', c => events.stream(c.req.raw, () => ({ version: index.snapshot().version, ready: index.ready, time: now(), heartbeatMs: options.heartbeatMs ?? 15_000 })));

  // The report as it stands: one request, only what wins. Everything else about a layer is history.
  app.get('/api/reports/evidence/effective', async c => {
    if (!index.ready) return c.json({ error: 'Atlas is still reading its backends; try again in a moment.' }, 503, { 'retry-after': '1' });
    const { version, text } = index.json();
    const etag = `"${version}"`;
    const headers = { etag, 'cache-control': 'no-cache' };
    if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers });
    // A viewer that holds a recent report is sent what changed since, not all of it again.
    const since = c.req.query('since');
    const delta = since ? index.delta(since) : null;
    if (delta) return body(c, delta.text, 'application/json', headers);
    return body(c, text, 'application/json', headers, `effective|${version}`);
  });
  // Tests, their history and the runs that recorded them: the report as a person or an agent explores it.
  let model: { key: string; value: CatalogModel } | null = null;
  const catalog = async (): Promise<CatalogModel> => {
    const snapshot = index.snapshot();
    const set = await specs();
    const key = `${snapshot.version}|${index.history.rev}|${set?.set.id ?? ''}`;
    if (model?.key !== key) {
      const entries = set?.set.files.map(({ path: file, domain, kind, title }) => ({ path: file, domain, kind, title }));
      model = { key, value: catalogModel(snapshot.layers, { history: index.history, version: createHash('sha256').update(key).digest('hex').slice(0, 20), now: now(), ...(entries ? { specs: entries } : {}) }) };
    }
    return model.value;
  };
  let uiModel: { version: string; value: ReturnType<typeof uiCatalog> } | undefined;
  const wantsMarkdown = (c: Context) => {
    const format = c.req.query('format');
    return format === 'markdown' || format === 'md' || (format === undefined && /\btext\/markdown\b/.test(c.req.header('accept') ?? ''));
  };
  const notReady = (c: Context) => c.json({ error: 'Atlas is still reading its backends; try again in a moment.' }, 503, { 'retry-after': '1' });
  // What was written for a version and a question is written once, however many viewers poll for it.
  const rendered = new Map<string, string>();
  const answer = async (c: Context, version: string, document: () => unknown, markdown: () => string, cacheKey: string) => {
    const key = `${version}|${cacheKey}`;
    const etag = `"${version}-${createHash('sha256').update(cacheKey).digest('hex').slice(0, 12)}"`;
    const headers = { etag, 'cache-control': 'no-cache' };
    if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers });
    const asMarkdown = wantsMarkdown(c);
    let text = rendered.get(key);
    if (text === undefined) {
      text = asMarkdown ? markdown() : JSON.stringify(document());
      if (rendered.size >= 32) rendered.delete(rendered.keys().next().value!);
      rendered.set(key, text);
    }
    return body(c, text, asMarkdown ? 'text/markdown; charset=utf-8' : 'application/json', headers, key);
  };
  app.get('/api/reports/tests', async c => {
    if (!index.ready) return notReady(c);
    const found = await catalog();
    const query = parseTestQuery(new URL(c.req.url).searchParams);
    const document = () => testCatalog(found, query);
    return answer(c, found.version, document, () => catalogMarkdown(document()), `tests|${new URL(c.req.url).search}|${wantsMarkdown(c)}`);
  });
  const configuredRoots: RootMapping[] = (options.catalogRoots ?? []).flatMap(text => parseRootMapping(text) ?? []).map(mapping => ({ ...mapping, source: 'configuration' as const }));
  app.get('/api/reports/tests/health', async c => {
    if (!index.ready) return notReady(c);
    const found = await catalog();
    const params = new URL(c.req.url).searchParams;
    // The mappings the operator configured, then those this request adds (one already configured is not counted twice).
    const requested = parseRootMappings(params).filter(mapping => !configuredRoots.some(item => item.from === mapping.from && item.to === mapping.to));
    const roots: RootMapping[] = [...configuredRoots, ...requested.map(mapping => ({ ...mapping, source: 'request' as const }))];
    const document = () => catalogHealth(found, roots);
    return answer(c, found.version, document, () => healthMarkdown(document()), `health|${params.getAll('root').join('\u0001')}|${wantsMarkdown(c)}`);
  });
  app.get('/api/reports/tests/history', async c => {
    if (!index.ready) return notReady(c);
    const key = c.req.query('key');
    if (!key) return problemResponse(400, 'Name the test with ?key=, a key from GET /api/reports/tests.');
    const found = await catalog();
    const document = testHistory(found, key);
    if (!document) return problemResponse(404, 'No test in the report has that key.');
    return answer(c, found.version, () => document, () => historyMarkdown(document), `history|${key}|${wantsMarkdown(c)}`);
  });
  app.get('/api/reports/tests/reliability', async c => {
    if (!index.ready) return notReady(c);
    const key = c.req.query('key');
    if (!key) return problemResponse(400, 'Name the test with ?key=, a key from GET /api/reports/tests.');
    const found = await catalog();
    const recorded = testHistory(found, key);
    if (!recorded) return problemResponse(404, 'No test in the report has that key.');
    const search = new URL(c.req.url).searchParams;
    const document = () => reliability(key, recorded.history, parseReliabilityScope(search));
    return answer(c, found.version, document, () => reliabilityMarkdown(document()), `reliability|${search.toString()}|${wantsMarkdown(c)}`);
  });
  app.get('/api/reports/runs', async c => {
    if (!index.ready) return notReady(c);
    const found = await catalog();
    const limit = /^\d+$/.test(c.req.query('limit') ?? '') ? Number(c.req.query('limit')) : 100;
    const search = new URL(c.req.url).searchParams;
    const document = () => runList(index.history, found.version, limit, parseArtifactFilter(search));
    return answer(c, found.version, document, () => runsMarkdown(document()), `runs|${search.toString()}|${wantsMarkdown(c)}`);
  });
  app.get('/api/reports/artifacts', async c => {
    if (!index.ready) return notReady(c);
    const found = await catalog();
    const search = new URL(c.req.url).searchParams;
    const number = (name: string, fallback: number) => (/^\d+$/.test(search.get(name) ?? '') ? Number(search.get(name)) : fallback);
    const domains = new Map(found.facets.specs.map(spec => [spec.path, spec.domain]));
    const document = () => artifactList(index.history, found.version, parseArtifactFilter(search), { limit: number('limit', 100), offset: number('offset', 0), domainOf: path => domains.get(path) });
    return answer(c, found.version, document, () => artifactsMarkdown(document()), `artifacts|${search.toString()}|${wantsMarkdown(c)}`);
  });
  app.get('/api/reports/ui-catalog', async c => {
    if (!index.ready) return notReady(c);
    const snapshot = index.snapshot();
    const search = new URL(c.req.url).searchParams;
    const number = (name: string, fallback: number) => (/^\d+$/.test(search.get(name) ?? '') ? Number(search.get(name)) : fallback);
    // The catalog is a function of the report, so it is built once per version and narrowed per question.
    if (uiModel?.version !== snapshot.version) uiModel = { version: snapshot.version, value: uiCatalog(snapshot.layers, { version: snapshot.version, backends: snapshot.backends, notices: snapshot.notices }) };
    const whole = uiModel.value;
    const document = () => pageUiCatalog(filterUiCatalog(whole, parseUiCatalogQuery(search)), { limit: number('limit', 200), offset: number('offset', 0) });
    return answer(c, snapshot.version, document, () => uiCatalogMarkdown(document()), `ui-catalog|${search.toString()}|${wantsMarkdown(c)}`);
  });
  app.get('/api/reports/runs/detail', async c => {
    if (!index.ready) return notReady(c);
    const key = c.req.query('key');
    if (!key) return problemResponse(400, 'Name the run with ?key=, a key from GET /api/reports/runs.');
    const found = await catalog();
    const document = runDetail(index.history, found.version, key);
    if (!document) return problemResponse(404, 'No run has that key.');
    return answer(c, found.version, () => document, () => runMarkdown(document), `run|${key}|${wantsMarkdown(c)}`);
  });
  // Reviewer tags for attachments: an audit trail of edits kept beside the layers, which they never change. Read
  // with a read token; an edit needs a publish token in a Bearer header, and is recorded under that token's name.
  const tagStore = options.liveStore ?? writeBackend.store;
  // Edits are ordered by time, so two in one millisecond are told apart by moving the later one on.
  let lastTagAt = 0;
  const artifactTags = cached(() => readArtifactTagEntries(tagStore), 5_000);
  app.get('/api/reports/artifact-tags', async c => c.json({ schemaVersion: 1, entries: await artifactTags() }, 200, { 'cache-control': 'no-store' }));
  app.post('/api/reports/artifact-tags', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return unauthorized(verdict);
    try {
      const bytes = await readLimited(c.req.raw, Math.min(limits.json, 64 * 1024));
      let input: unknown;
      try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return problemResponse(422, 'The body is not JSON.'); }
      const entry = await recordArtifactTags(tagStore, input, verdict.identity.name, lastTagAt = Math.max(now(), lastTagAt + 1));
      await artifactTags.invalidate();
      return c.json(entry, 201, { 'cache-control': 'no-store' });
    } catch (error) {
      if (error instanceof ArtifactTagError || error instanceof Refusal) return problemResponse(error.status, error.message);
      throw error;
    }
  });
  // Review collections: immutable, curated references to recorded results, with reviewers' notes kept apart.
  mountReviewCollections(app, { store: tagStore, stores, auth, index, now, maxBytes: limits.json, unauthorized });
  app.route('/api/reports', layers);

  // Upload: the store protocol, and a simple JSON way in for anything that can make a request.
  app.route('/api/store', storeApi({
    store: writeBackend.store, auth, maxObjectBytes: limits.object,
    onStored: async (key, kind, layer) => {
      if (kind === 'layer-catalog') await index.accept(writeBackend.id, key, layer);
      else if (kind === 'spec-catalog') { await specs.invalidate(); events.publish('atlas:change', { scope: 'specs', files: [], runIds: [] }); }
      else if (kind === 'run-catalog') { await runs.invalidate(); events.publish('atlas:change', { scope: 'runs', files: [], runIds: [/-([\w.-]+)\.json$/.exec(key)?.[1] ?? ''].filter(Boolean) }); }
    }
  }));
  app.post('/api/checks', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return unauthorized(verdict);
    try {
      const bytes = await readLimited(c.req.raw, limits.json);
      let input: Record<string, unknown>;
      try { input = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>; } catch { throw new Refusal(422, 'The body is not JSON'); }
      // Anything that can make a request can report: the time defaults to now, and the rest is the layer format.
      const layer = await publishChecks(writeBackend.store, { recordedAtMs: now(), ...input } as never);
      await index.accept(writeBackend.id, layerCatalogKey(layer.recordedAtMs, layer.id), layer);
      return c.json({ ok: true, id: layer.id, checks: layer.parts[0]?.checks.length ?? 0 }, 201);
    } catch (error) {
      if (error instanceof Refusal) return c.json({ error: error.message }, error.status as 422);
      if (error instanceof Error && /^publishChecks:/.test(error.message)) return c.json({ error: error.message }, 422);
      throw error;
    }
  });

  // The gate: does the report pass? Computed here, from what the server already holds.
  const filtered = new Map<string, Promise<CombinedReport>>();
  const verdicts = new Map<string, Promise<{ text: string; ok: boolean }>>();
  app.get('/api/status', async c => {
    if (!index.ready) return c.json({ error: 'Atlas is still reading its backends; try again in a moment.' }, 503, { 'retry-after': '1' });
    const branches = c.req.queries('branch') ?? [];
    const ignoreModified = c.req.query('ignoreModified') === '1';
    const required = (c.req.query('requireEnvironments') ?? '').split(',').map(name => name.trim()).filter(Boolean);
    const requireAllSpecs = c.req.query('requireAllSpecs') === '1';
    const snapshot = index.snapshot();
    const found = await outline();
    // The gate is a function of the report and the specs, so it is worked out once for each pair, however often CI asks.
    const asked = `${snapshot.version}|${(await specs())?.set.id ?? `recorded:${index.history.specs.size}`}|${[...branches].sort().join(',')}|${ignoreModified}|${required.join(',')}|${requireAllSpecs}`;
    if (!verdicts.has(asked)) {
      if (verdicts.size >= 16) verdicts.delete(verdicts.keys().next().value!);
      verdicts.set(asked, (async () => {
        let report: CombinedReport;
        if (!branches.length && !ignoreModified) {
          const combined = combineEvidence(found, snapshot.layers);
          report = { combined, layers: snapshot.layers.map(entry => entry.layer), backends: snapshot.backends, notices: snapshot.notices, summary: summarize(combined) };
        } else {
          // Narrowing needs the history the live report has dropped: read it, once per version and filter.
          const key = `${snapshot.version}|${[...branches].sort().join(',')}|${ignoreModified}`;
          if (!filtered.has(key)) {
            if (filtered.size >= 8) filtered.delete(filtered.keys().next().value!);
            const specSet = await specs();
            filtered.set(key, combineBackends(backends, { ...(specSet ? { outline: found } : {}), include: layer => (options.include?.(layer) ?? true) && (!branches.length || (layer.branch !== null && branches.includes(layer.branch))) && (!ignoreModified || layer.freshness === undefined) }));
          }
          report = await filtered.get(key)!;
        }
        const status = reportStatus(report, { requireEnvironments: required, requireAllSpecs });
        return { text: JSON.stringify({ ...status, layers: snapshot.totalLayers }), ok: status.ok };
      })());
      verdicts.get(asked)!.catch(() => verdicts.delete(asked));
    }
    const { text, ok } = await verdicts.get(asked)!;
    return body(c, text, 'application/json', { 'cache-control': 'no-cache', 'x-atlas-ok': String(ok) }, `status|${asked}`);
  });

  // The viewer's data directory: specs and runs, read from the backends.
  app.get('/api/data/sources.json', c => c.json({ schemaVersion: 1, sources: [{ id: 'workspace', label: 'Atlas', type: 'http', baseUrl: './', eventsUrl: '../events', live: true }] }, 200, { 'cache-control': 'no-cache' }));
  app.get('/api/data/specs/index.json', async c => {
    const found = await specs();
    return c.json({ schemaVersion: 1, generatedAt: new Date(now()).toISOString(), ref: found?.set.sha ?? null, files: (found?.set.files ?? []).map(file => file.path.replace(/^specs\//, '')) }, 200, { 'cache-control': 'no-cache' });
  });
  app.get('/api/data/specs/*', async c => {
    let file: string;
    try { file = decodeURIComponent(new URL(c.req.url).pathname.slice('/api/data/specs/'.length)); } catch { return c.notFound(); }
    const found = await specs();
    const entry = found?.set.files.find(item => item.path === `specs/${file}`);
    const text = found && entry ? await readSpecBody(found.store, entry.digest) : null;
    if (text === null) return c.notFound();
    // The address is the spec's path, which a later set can fill with other text: revalidate, by content.
    const etag = `"${entry!.digest}"`;
    if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-cache' } });
    return body(c, text, 'text/plain; charset=utf-8', { 'cache-control': 'no-cache', etag }, entry!.digest);
  });
  app.get('/api/data/runs/index.json', async c => c.json({ generatedAt: new Date(now()).toISOString(), runs: await runs() }, 200, { 'cache-control': 'no-cache' }));
  app.get('/api/data/runs/:id/*', async c => {
    const id = c.req.param('id');
    let rel: string;
    try { rel = decodeURIComponent(new URL(c.req.url).pathname.slice(`/api/data/runs/${id}/`.length)); } catch { return c.notFound(); }
    for (const store of stores) {
      const stored = await readRunFile(store, id, rel).catch(() => null);
      if (stored) return new Response(stored.body, { headers: { 'content-type': stored.contentType, ...UNTRUSTED_HEADERS, 'cache-control': 'public, max-age=31536000, immutable' } });
    }
    return c.notFound();
  });

  // Everything else under /api is for reading: a write to it is a wrong method, not a missing page.
  app.on(['POST', 'PUT', 'PATCH', 'DELETE'], '/api/*', c => c.json({ error: 'Method not allowed' }, 405, { allow: 'GET, HEAD' }));

  // The viewer, with this server's address book written into its page.
  if (options.site) {
    const root = path.resolve(options.site);
    const config = JSON.stringify({ api: './api', reportsUrl: './api/reports', dataUrl: './api/data/', eventsUrl: './api/events', projectsUrl: './api/projects', effective: true, ...(options.page ?? {}) }).replaceAll('<', '\\u003c');
    const pageDigest = createHash('sha256').update(config).digest('hex').slice(0, 16);
    const files = new Map<string, { stamp: string; bytes: Uint8Array }>();
    app.get('*', async c => {
      const pathname = new URL(c.req.url).pathname;
      // An API path that nothing answered is an error, not a page.
      if (pathname.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
      let relative: string;
      try { relative = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return c.notFound(); }
      if (relative.split('/').some(part => part === '..' || part.includes('\\'))) return c.notFound();
      let file = path.join(root, relative || 'index.html');
      let info = await stat(file).catch(() => null);
      if (info?.isDirectory()) { file = path.join(file, 'index.html'); info = await stat(file).catch(() => null); }
      if (!info && !path.extname(relative)) { file = path.join(root, 'index.html'); info = await stat(file).catch(() => null); }
      if (!info?.isFile()) return c.notFound();
      const resolved = await realpath(file);
      const realRoot = await realpath(root);
      if (!resolved.startsWith(`${realRoot}${path.sep}`)) return c.notFound();
      const isIndex = path.basename(file) === 'index.html';
      const stamp = `${info.mtimeMs}|${info.size}`;
      const etag = `"${info.mtimeMs}-${info.size}${isIndex ? `-${pageDigest}` : ''}"`;
      const hashed = /(^|\/)assets\//.test(relative);
      const headers = { etag, 'x-content-type-options': 'nosniff', 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' };
      if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers });
      let kept = files.get(file);
      if (!kept || kept.stamp !== stamp) {
        kept = { stamp, bytes: new Uint8Array(await readFile(file)) };
        if (files.size >= 128) files.delete(files.keys().next().value!);
        // Keep only small assets; large downloads do not occupy the viewer cache.
        if (kept.bytes.length <= 2 * MiB) files.set(file, kept);
      }
      let data: string | Uint8Array = kept.bytes;
      if (isIndex) data = new TextDecoder().decode(data).replace('</head>', `<script>window.__ATLAS_CONFIG__=${config}</script></head>`);
      return body(c, data, typeOf(file), headers, `${file}|${stamp}`, true);
    });
  }

  // An API path that nothing answered is an error a client can read, whether or not a viewer is served.
  app.notFound(c => (new URL(c.req.url).pathname.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('404 Not Found', 404)));

  app.onError((error, c) => {
    options.log?.({ at: new Date(now()).toISOString(), level: 'error', path: new URL(c.req.url).pathname, error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: 'Something went wrong on the server. It has been logged.' }, 500);
  });

  async function collect(policy: GcPolicy, run: { readonly dryRun: boolean; readonly project: string }): Promise<GcRun> {
    const base = { project: run.project, dryRun: run.dryRun };
    try {
      // Look at the store once more first, so "superseded" is judged on everything uploaded so far.
      await index.refreshNow();
      const plan = await planGarbage(writeBackend!.store, { policy, nowMs: now(), eligible: index.superseded() });
      const outcome = run.dryRun ? { deletedLayers: 0, deletedBlobs: 0 } : await collectGarbage(writeBackend!.store, plan);
      if (outcome.deletedLayers) options.log?.({ at: new Date(now()).toISOString(), level: 'info', gc: run.project, deletedLayers: outcome.deletedLayers, deletedBlobs: outcome.deletedBlobs });
      return { ...base, at: new Date(now()).toISOString(), candidates: plan.candidates.length, ...outcome, keptLayers: plan.kept };
    } catch (error) {
      options.log?.({ at: new Date(now()).toISOString(), level: 'error', gc: run.project, error: String(error) });
      return { ...base, at: new Date(now()).toISOString(), candidates: 0, deletedLayers: 0, deletedBlobs: 0, keptLayers: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    fetch: async request => app.fetch(request),
    routes: app.routes.map(({ method, path }) => ({ method, path })),
    index,
    events,
    collectGarbage: collect,
    ready: index.start(options.refreshMs ?? 10_000),
    close: () => { clearInterval(leaseTimer); stopListening(); index.stop(); events.close(); }
  };
}
