import { Hono } from 'hono';
import { catalogEntries, catalogLayers } from './layer-catalog';
import { createBundleReader } from './bundle';
import { LAYER_INDEX, readLayer } from './layer-store';
import type { LayerPage, LayerSummary } from './layer-types';
import type { ReportsAppDeps } from './reports-route';
import { eachLimited } from './completion-order';
import { isFramePath, isKeySegment } from './keys';

const TTL = 30_000;
const PAGE = 20;
/** Bounded, warm metadata caches. Refresh may lag publication by thirty seconds. */
export function createLayersApp(deps: ReportsAppDeps) {
  const stores = [...new Set([deps.localStore, deps.store].filter(store => store != null))];
  type Catalog = { at: number; entries: { store: number; key: string }[]; notices: string[] };
  let catalog: Catalog | null = null;
  let pending: Promise<Catalog> | null = null;
  const summaries = new Map<string, { at: number; value: readonly LayerSummary[] }>();
  const readers = new Map<string, ReturnType<typeof createBundleReader>>();
  async function discover(): Promise<Catalog> {
    if (catalog && deps.clock.now() - catalog.at < TTL) return catalog;
    pending ??= (async () => {
      const entries: { store: number; key: string }[] = [], notices: string[] = [];
      await Promise.all(stores.map(async (store, i) => {
        try { for (const key of await catalogEntries(store)) entries.push({ store: i, key }); }
        catch { notices.push('A report store is unavailable. Loaded layers remain usable.'); }
      }));
      if (!stores.length) notices.push('No report store is configured.');
      entries.sort((a, b) => Number(b.key.startsWith('layer:')) - Number(a.key.startsWith('layer:')) || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.store - b.store));
      catalog = { at: deps.clock.now(), entries, notices };
      return catalog;
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function file(id: string, path: string) {
    if (!/^[0-9a-f]{64}$/.test(id)) return null;
    let reader = readers.get(id);
    if (!reader) {
      for (const store of stores) {
        const layer = await readLayer(store, id);
        if (!layer) continue;
        reader = createBundleReader(store, layer.bundle);
        if (readers.size >= 8) readers.delete(readers.keys().next().value!);
        readers.set(id, reader);
        break;
      }
    }
    return reader?.(path) ?? null;
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
    return c.json(outline ? { specs: outline.specs, sha: outline.sha, changedFiles: outline.changedFiles } : { specs: [], sha: null, changedFiles: [] }, 200, { 'cache-control': 'no-cache' });
  });
  app.get('/outline/spec', async c => {
    const outline = await currentOutline();
    const path = c.req.query('path') ?? '';
    if (!outline?.specs.some(entry => entry.path === path)) return c.notFound();
    const text = await outline.readSpec(path);
    return text === null ? c.notFound() : c.text(text);
  });
  app.get('/layers', async c => {
    const cursor = c.req.query('cursor') ?? '';
    const index = await discover();
    const after = cursor ? index.entries.findIndex(entry => `${entry.store}:${entry.key}` === cursor) + 1 : 0;
    if (cursor && after === 0) return c.json({ error: 'Layer catalog changed; refresh the report.' }, 409);
    const selected = index.entries.slice(after, after + PAGE);
    const layers = new Map<string, LayerSummary>();
    const notices = [...index.notices];
    await eachLimited(selected, 8, async entry => {
      const cacheKey = `${entry.store}:${entry.key}`;
      try {
        let cached = summaries.get(cacheKey);
        if (!cached || (!entry.key.startsWith(`layer:${LAYER_INDEX}`) && deps.clock.now() - cached.at >= TTL)) {
          cached = { at: deps.clock.now(), value: await catalogLayers(stores[entry.store]!, entry.key) };
          if (summaries.size >= 256) summaries.delete(summaries.keys().next().value!);
          summaries.set(cacheKey, cached);
        }
        for (const layer of cached.value) layers.set(layer.id, layer);
      } catch { notices.push('A report layer could not be loaded. Its outcome is unknown.'); }
    });
    const last = selected.at(-1);
    const page: LayerPage = { layers: [...layers.values()], notices: [...new Set(notices)], cursor: after + PAGE < index.entries.length && last ? `${last.store}:${last.key}` : null };
    return c.json(page, 200, { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' });
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
  return app;
}
