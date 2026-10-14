import { readFile, stat } from 'node:fs/promises';
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
import { publishChecks } from '../../reports/src/publish-checks';
import { reportStatus } from '../../reports/src/report-status';
import { ReportIndex, type IndexChange } from '../../reports/src/report-index';
import { listRunSummaries, readRunFile } from '../../reports/src/run-bundle';
import { latestSpecSet, readSpecBody } from '../../reports/src/spec-set';
import { Refusal } from './validate';
import { createAuth, type Auth } from './auth';
import type { ResolvedToken } from './config';
import { EventHub } from './events';
import { readLimited, storeApi } from './store-api';

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

export type AtlasServerOptions = {
  /** Every backend, read together. */
  readonly backends: readonly BackendInput[];
  /** The id of the backend uploads go to. */
  readonly write: string;
  readonly tokens?: readonly ResolvedToken[];
  readonly anonymousRead?: boolean;
  /** The built viewer. Without it, only the API is served. */
  readonly site?: string;
  readonly outlineBranch?: string;
  readonly include?: (layer: LayerHeader) => boolean;
  readonly refreshMs?: number;
  readonly limits?: { readonly maxObjectMiB?: number; readonly maxJsonMiB?: number; readonly maxStreams?: number };
  readonly heartbeatMs?: number;
  readonly log?: (line: Record<string, unknown>) => void;
  readonly now?: () => number;
  readonly version?: string;
  /** Extra runtime configuration written into the page. */
  readonly page?: Record<string, unknown>;
};

export type AtlasServer = {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly index: ReportIndex;
  readonly events: EventHub;
  /** Resolves when the first pass over the backends is done. */
  readonly ready: Promise<void>;
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

type Cached<T> = { (): Promise<T>; invalidate(): void };

/**
 * The whole of a project's Atlas on one process: the API that results are uploaded to, the live report every
 * viewer is shown, and the viewer itself. All of it is under one host, `/api` for the API and `/` for the page.
 * What it knows lives in its backends (by default a folder on its own disk), so replacing it loses nothing.
 */
export function createAtlasServer(options: AtlasServerOptions): AtlasServer {
  const now = options.now ?? Date.now;
  const backends = options.backends;
  const writeBackend = backends.find(backend => backend.id === options.write);
  if (!writeBackend) throw new Error(`The write backend "${options.write}" is not among the backends (${backends.map(backend => backend.id).join(', ')})`);
  const stores: ObjectStore[] = backends.map(backend => backend.store);
  const auth: Auth = createAuth(options.tokens ?? [], options.anonymousRead ?? false);
  const limits = { object: (options.limits?.maxObjectMiB ?? 256) * MiB, json: (options.limits?.maxJsonMiB ?? 32) * MiB };
  const index = new ReportIndex(backends, { now, ...(options.include ? { include: options.include } : {}) });
  const events = new EventHub({ maxSubscribers: options.limits?.maxStreams ?? 500, heartbeatMs: options.heartbeatMs ?? 15_000 });
  const compressed = new Map<string, Uint8Array>();

  // Spec sets and runs change rarely: answer from memory, look again in the background, and look at once when
  // something that could change them was uploaded.
  function cached<T>(load: () => Promise<T>, ttlMs = 10_000): Cached<T> {
    let value: Promise<T> | undefined;
    let at = 0;
    let refreshing = false;
    const read = (() => {
      if (!value) {
        at = now();
        value = load();
        value.catch(() => { value = undefined; });
      } else if (now() - at > ttlMs && !refreshing) {
        refreshing = true;
        at = now();
        load().then(result => { value = Promise.resolve(result); }, () => {}).finally(() => { refreshing = false; });
      }
      return value!;
    }) as Cached<T>;
    read.invalidate = () => {
      if (!value || refreshing) { at = -Infinity; return; }
      refreshing = true;
      at = now();
      load().then(result => { value = Promise.resolve(result); }, () => {}).finally(() => { refreshing = false; });
    };
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
    if (!found) return { specs: [], sha: null, changedFiles: [], readSpec: async () => null };
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
   * a script, one version of the report) is compressed once and kept; `slow` asks for the smallest form, which
   * is worth waiting for only when it is made once and sent to every visitor: the viewer's own files.
   */
  async function body(c: Context, data: string | Uint8Array, contentType: string, headers: Record<string, string>, cacheKey?: string, slow = false): Promise<Response> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const accepts = c.req.header('accept-encoding') ?? '';
    const encoding = COMPRESSIBLE.test(contentType) && bytes.length > 1024 ? (slow && /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null) : null;
    let out: Uint8Array = bytes;
    if (encoding) {
      const key = cacheKey ? `${encoding}|${cacheKey}|${bytes.length}` : null;
      out = (key && compressed.get(key)) || new Uint8Array(encoding === 'br'
        ? await brotliAsync(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: bytes.length } })
        : await gzipAsync(bytes));
      if (key) { if (compressed.size > 64) compressed.delete(compressed.keys().next().value!); compressed.set(key, out); }
    }
    return new Response(out as BodyInit, { headers: { 'content-type': contentType, vary: 'accept-encoding', ...(encoding ? { 'content-encoding': encoding } : {}), ...headers } });
  }

  const app = new Hono();
  const unauthorized = (verdict: Extract<ReturnType<Auth['check']>, { ok: false }>) =>
    new Response(JSON.stringify({ error: verdict.message }), { status: verdict.status, headers: { 'content-type': 'application/json', ...(verdict.status === 401 ? { 'www-authenticate': 'Basic realm="Atlas", charset="UTF-8"' } : {}) } });

  // Everything but the probes and the store protocol (which checks for itself) needs at least a reader.
  app.use('*', async (c, next) => {
    const started = now();
    const pathname = new URL(c.req.url).pathname;
    const open = pathname === '/healthz' || pathname === '/readyz' || pathname.startsWith('/api/store');
    if (!open) {
      const verdict = auth.check(c.req.raw, 'read');
      if (!verdict.ok) { c.res = unauthorized(verdict); } else await next();
    } else await next();
    if (pathname !== '/healthz' && pathname !== '/readyz') options.log?.({ at: new Date(started).toISOString(), method: c.req.method, path: pathname, status: c.res.status, ms: now() - started });
  });

  app.get('/healthz', c => c.json({ ok: true }));
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
      ...(({ backends: _unused, ...rest }) => rest)(index.stats()), capabilities: { events: true, ingest: true, store: true, checks: true, status: true, effective: true }
    });
  });

  // Live updates: told when the report changes, and when specs or runs do.
  app.get('/api/events', c => events.stream(c.req.raw, () => ({ version: index.snapshot().version, ready: index.ready, time: now() })));

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
  app.route('/api/reports', layers);

  // Upload: the store protocol, and a simple JSON way in for anything that can make a request.
  app.route('/api/store', storeApi({
    store: writeBackend.store, auth, maxObjectBytes: limits.object,
    onStored: async (key, kind, layer) => {
      if (kind === 'layer-catalog') await index.accept(writeBackend.id, key, layer);
      else if (kind === 'spec-catalog') { specs.invalidate(); events.publish('atlas:change', { scope: 'specs', files: [], runIds: [] }); }
      else if (kind === 'run-catalog') { runs.invalidate(); events.publish('atlas:change', { scope: 'runs', files: [], runIds: [/-([\w.-]+)\.json$/.exec(key)?.[1] ?? ''].filter(Boolean) }); }
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
    const asked = `${snapshot.version}|${(await specs())?.set.id ?? ''}|${[...branches].sort().join(',')}|${ignoreModified}|${required.join(',')}|${requireAllSpecs}`;
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
            filtered.set(key, combineBackends(backends, { outline: found, include: layer => (!branches.length || (layer.branch !== null && branches.includes(layer.branch))) && (!ignoreModified || layer.freshness === undefined) }));
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
    const config = JSON.stringify({ api: './api', reportsUrl: './api/reports', dataUrl: './api/data/', eventsUrl: './api/events', effective: true, ...(options.page ?? {}) });
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
      const isIndex = path.basename(file) === 'index.html';
      let data: string | Uint8Array = new Uint8Array(await readFile(file));
      if (isIndex) data = new TextDecoder().decode(data).replace('</head>', `<script>window.__ATLAS_CONFIG__=${config}</script></head>`);
      const hashed = /(^|\/)assets\//.test(relative);
      return body(c, data, typeOf(file), { 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' }, `${file}|${info.mtimeMs}`, true);
    });
  }

  app.onError((error, c) => {
    options.log?.({ at: new Date(now()).toISOString(), level: 'error', path: new URL(c.req.url).pathname, error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: 'Something went wrong on the server. It has been logged.' }, 500);
  });

  return {
    fetch: async request => app.fetch(request),
    index,
    events,
    ready: index.start(options.refreshMs ?? 10_000),
    close: () => { stopListening(); index.stop(); events.close(); }
  };
}
