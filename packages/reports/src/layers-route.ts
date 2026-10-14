import { Hono } from 'hono';
import { createBundleReader } from './bundle';
import { eachLimited } from './completion-order';
import { createLiveEvidence, liveRunRecord, type LiveRunRecord } from './evidence-live';
import type { ActiveRun, BackendInfo, EvidencePage, LayerEvidence, LayerHeader, LayerRows } from './evidence-types';
import { isFramePath, isKeySegment } from './keys';
import { catalogEntries, catalogLayers } from './layer-catalog';
import { layerEvidence } from './layer-merge';
import { readLayer } from './layer-store';
import { readBytes, readUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import { SPEC_RUN_ID } from './publish';
import { testFrameKey, testReportKey } from './recording-keys';
import type { ReportsAppDeps } from './reports-route';

const TTL = 30_000;
const LOCAL_TTL = 1_500;
const PAGE = 40;
const CACHED_ENTRIES = 4_096;

/** A further store whose layers join the combined report, beside the local and the shared one. */
export type ReportBackend = {
  /** Stable and unique: letters, digits and hyphens. `local` and `shared` are taken. */
  readonly id: string;
  readonly label: string;
  readonly store: ObjectStore;
};

type Backend = ReportBackend & { readonly live: boolean };
type Listing = { at: number; keys: readonly string[]; available: boolean };
type Entry = { readonly backend: number; readonly key: string };

export const LOCAL_BACKEND = 'local';
export const SHARED_BACKEND = 'shared';

/** The stores that contribute layers, in the order they answer for a recording. */
export function reportBackends(deps: ReportsAppDeps): Backend[] {
  const backends: Backend[] = [];
  if (deps.localStore) backends.push({ id: LOCAL_BACKEND, label: 'This machine', store: deps.localStore, live: true });
  if (deps.store && deps.store !== deps.localStore) backends.push({ id: SHARED_BACKEND, label: 'Shared reports', store: deps.store, live: false });
  for (const backend of deps.backends ?? []) {
    if (!/^[a-z0-9-]+$/.test(backend.id) || backends.some(known => known.id === backend.id)) throw new Error(`Invalid report backend id: "${backend.id}"`);
    backends.push({ ...backend, live: false });
  }
  return backends;
}

function archived(id: string): boolean {
  return /^[0-9a-f]{64}$/.test(id);
}

/** Bounded pages of layer origins, each layer's checks read once, and the runs still writing. */
export function createLayersApp(deps: ReportsAppDeps) {
  const backends = reportBackends(deps);
  const listings: (Listing | undefined)[] = backends.map(() => undefined);
  let pending: Promise<Entry[]> | null = null;
  const loaded = new Map<string, { at: number; value: Promise<readonly LayerEvidence[]> }>();
  const readers = new Map<string, ReturnType<typeof createBundleReader>>();
  const live = createLiveEvidence({ live: deps.live, clock: deps.clock, backend: LOCAL_BACKEND });

  function freshFor(backend: Backend): number {
    return backend.live ? LOCAL_TTL : TTL;
  }

  async function discover(): Promise<Entry[]> {
    pending ??= (async () => {
      const now = deps.clock.now();
      await Promise.all(backends.map(async (backend, i) => {
        const prior = listings[i];
        if (prior && now - prior.at < freshFor(backend)) return;
        try {
          listings[i] = { at: now, keys: await catalogEntries(backend.store), available: true };
        } catch {
          // Keep what was listed before; the next refresh after the wait tries again.
          listings[i] = { at: now, keys: prior?.keys ?? [], available: false };
        }
      }));
      const entries = listings.flatMap((listing, backend) => (listing?.keys ?? []).map(key => ({ backend, key })));
      // Immutable layers first, newest first: their index keys start with an inverted time.
      return entries.sort((a, b) => Number(b.key.startsWith('layer:')) - Number(a.key.startsWith('layer:')) || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.backend - b.backend));
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  /** An immutable layer is read once. A commit's mutable parts are re-read after a short wait. */
  function entryEvidence(entry: Entry): Promise<readonly LayerEvidence[]> {
    const backend = backends[entry.backend]!;
    const cacheKey = `${backend.id}|${entry.key}`;
    const cached = loaded.get(cacheKey);
    if (cached && (entry.key.startsWith('layer:') || deps.clock.now() - cached.at < freshFor(backend))) return cached.value;
    const value = catalogLayers(backend.store, entry.key).then(layers => layers.map(layer => layerEvidence(layer, backend.id)));
    value.catch(() => {
      if (loaded.get(cacheKey)?.value === value) loaded.delete(cacheKey);
    });
    if (!cached && loaded.size >= CACHED_ENTRIES) loaded.delete(loaded.keys().next().value!);
    loaded.set(cacheKey, { at: deps.clock.now(), value });
    return value;
  }

  async function findEvidence(backend: number, id: string): Promise<LayerEvidence | null> {
    const own = backends[backend]!.id === LOCAL_BACKEND ? live.find(id) : null;
    if (own) return own;
    const sha = /^(?:source|part)-([0-9a-f]{40})-/.exec(id)?.[1];
    const key = archived(id)
      ? (await discover()).find(entry => entry.backend === backend && entry.key.endsWith(`-${id}.json`))?.key
      : sha && `commit:${sha}`;
    if (!key) return null;
    try {
      return (await entryEvidence({ backend, key })).find(evidence => evidence.id === id) ?? null;
    } catch {
      return null;
    }
  }

  async function file(id: string, path: string) {
    if (!archived(id)) return null;
    let reader = readers.get(id);
    if (!reader) {
      for (const backend of backends) {
        const layer = await readLayer(backend.store, id);
        if (!layer) continue;
        reader = createBundleReader(backend.store, layer.bundle);
        if (readers.size >= 8) readers.delete(readers.keys().next().value!);
        readers.set(id, reader);
        break;
      }
    }
    return reader?.(path) ?? null;
  }

  async function activeRecords(): Promise<LiveRunRecord[]> {
    const local = deps.localStore;
    if (!local) return [];
    const runs = await Promise.all((await local.listKeys('active/')).map(async key => {
      try {
        const raw = await readUtf8(local, key);
        if (raw === null) return null;
        return liveRunRecord(JSON.parse(raw) as Partial<LiveRunRecord>);
      } catch {
        return null;
      }
    }));
    return runs.filter(run => run !== null);
  }

  let outlineAt = -Infinity;
  let outlinePending: ReturnType<NonNullable<ReportsAppDeps['outline']>> | undefined;
  function currentOutline() {
    if (!outlinePending || deps.clock.now() - outlineAt >= TTL) {
      outlineAt = deps.clock.now();
      outlinePending = deps.outline?.().catch(error => { outlinePending = undefined; throw error; });
    }
    return outlinePending;
  }

  const app = new Hono();
  app.get('/outline', async c => {
    const outline = await currentOutline();
    if (!outline) return c.json({ error: 'Current spec outline is unavailable' }, 503);
    return c.json({ specs: outline.specs, sha: outline.sha, changedFiles: outline.changedFiles }, 200, { 'cache-control': 'no-cache' });
  });
  app.get('/outline/spec', async c => {
    const outline = await currentOutline();
    const path = c.req.query('path') ?? '';
    if (!outline?.specs.some(entry => entry.path === path)) return c.notFound();
    const text = await outline.readSpec(path);
    return text === null ? c.notFound() : c.text(text);
  });
  app.get('/evidence', async c => {
    const cursor = c.req.query('cursor') ?? '';
    // Asking again reaches a store that was unavailable without waiting out its listing.
    if (c.req.query('retry')) for (const [i, listing] of listings.entries()) if (listing && !listing.available) listings[i] = { ...listing, at: -Infinity };
    const entries = await discover();
    const ref = (entry: Entry) => `${backends[entry.backend]!.id}:${entry.key}`;
    const after = cursor ? entries.findIndex(entry => ref(entry) === cursor) + 1 : 0;
    if (cursor && after === 0) return c.json({ error: 'Layer catalog changed; refresh the report.' }, 409);
    const selected = entries.slice(after, after + PAGE);
    const layers: LayerHeader[] = [];
    const notices: string[] = [];
    if (!backends.length) notices.push('No report store is configured.');
    for (const [i, listing] of listings.entries()) if (listing && !listing.available) notices.push(`${backends[i]!.label} is unavailable. Layers already loaded remain usable.`);
    await eachLimited(selected, 8, async entry => {
      try {
        for (const evidence of await entryEvidence(entry)) layers.push(evidence.layer);
      } catch {
        notices.push('A report layer could not be loaded. Its outcome is unknown.');
      }
    });
    let active: ActiveRun[] = [];
    if (!cursor) {
      const running = await live.refresh(await activeRecords(), layers);
      layers.push(...running.layers.map(evidence => evidence.layer));
      active = running.active;
    }
    layers.sort((a, b) => b.recordedAtMs - a.recordedAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const last = selected.at(-1);
    const info: BackendInfo[] = backends.map((backend, i) => ({ id: backend.id, label: backend.label, live: backend.live, available: listings[i]?.available ?? false }));
    const page: EvidencePage = { layers, notices: [...new Set(notices)], backends: info, active, cursor: after + PAGE < entries.length && last ? ref(last) : null };
    return c.json(page, 200, { 'cache-control': 'no-cache' });
  });
  app.get('/evidence/rows/:backend/:id', async c => {
    const backend = backends.findIndex(known => known.id === c.req.param('backend'));
    const id = c.req.param('id');
    const evidence = backend < 0 ? null : await findEvidence(backend, id);
    if (!evidence) return c.notFound();
    const rows: LayerRows = { id: evidence.id, rows: evidence.rows, fingerprints: evidence.fingerprints };
    return c.json(rows, 200, { 'cache-control': archived(id) ? 'public, max-age=31536000, immutable' : 'no-cache' });
  });
  app.get('/layers/:id/*', async c => {
    const id = c.req.param('id');
    let path: string;
    try { path = decodeURIComponent(new URL(c.req.url).pathname.split(`/layers/${id}/`)[1] ?? ''); }
    catch { return c.json({ error: 'Invalid recording path' }, 400); }
    const valid = path === 'frame.css' || /^tests\/[a-zA-Z0-9._-]+\/report\.json$/.test(path) || (path.startsWith('tests/') && isKeySegment(path.split('/')[1] ?? '') && path.split('/')[2] === 'files' && isFramePath(path.split('/').slice(3).join('/')));
    if (!valid) return c.notFound();
    const body = await file(id, path);
    return body ? new Response(new Uint8Array(body.bytes), { headers: { 'content-type': body.contentType, 'cache-control': 'public, max-age=31536000, immutable' } }) : c.notFound();
  });
  app.get('/live/:source/frame.css', async c => {
    const css = live.store(c.req.param('source')) ? await deps.live?.frameCss?.() : null;
    return css == null ? c.notFound() : c.body(css, 200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
  });
  app.get('/live/:source/tests/:testId/*', async c => {
    const source = c.req.param('source');
    const testId = c.req.param('testId');
    const store = isKeySegment(testId) ? live.store(source) : null;
    if (!store) return c.notFound();
    let path: string;
    try { path = decodeURIComponent(new URL(c.req.url).pathname.split(`/tests/${testId}/`)[1] ?? ''); }
    catch { return c.json({ error: 'Invalid recording path' }, 400); }
    const frame = path.startsWith('files/') ? path.slice('files/'.length) : null;
    if (path !== 'report.json' && !(frame && isFramePath(frame))) return c.notFound();
    const stored = await store.get(frame ? testFrameKey(SPEC_RUN_ID, testId, frame) : testReportKey(SPEC_RUN_ID, testId));
    if (stored === null) return c.notFound();
    return new Response(new Uint8Array(await readBytes(stored.body)), { headers: { 'content-type': stored.contentType, 'cache-control': 'no-store' } });
  });
  return app;
}
