import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AtlasHttpError, httpStore, type HttpStore } from '../../reports/src/http-store';
import { captureJournal, findBundles, importBundle, mergeBundles, validateBundle } from '../../reports/src/ui-catalog-bundle';
import { planMatrix } from '../../reports/src/ui-catalog-ci';
import { uiCatalogMain } from '../../reports/src/ui-catalog-cli';
import { collectCatalog } from '../../reports/src/ui-catalog-collect';
import { parseWhere, resolveCatalog, type CatalogDefinition } from '../../reports/src/ui-catalog-definition';
import { beginRefresh, finalizeRefresh, joinRefresh } from '../../reports/src/ui-catalog-refresh';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { listen } from '../src/host';

const servers: AtlasServer[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const TOKEN = 'publish-token-12345';
async function serve(clock?: { now: number }) {
  const server = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data', tokens: [{ name: 'ci', role: 'publish', token: TOKEN }], refreshMs: 60_000, ...(clock ? { now: () => clock.now } : {}) });
  servers.push(server);
  await server.ready;
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
  cleanups.push(() => http.close(100));
  const url = `http://127.0.0.1:${http.port}`;
  return { url, client: httpStore({ url, token: TOKEN }) };
}
async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'atlas-bundle-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const definition = (count: number): CatalogDefinition => ({
  name: 'web', states: Array.from({ length: count }, (_, i) => ({ id: `s${i}` })),
  matrix: { dimensions: { device: { values: ['mobile', 'desktop'], profile: device => ({ environment: `${device}-web` }) }, scheme: { values: ['light', 'dark'] } } }
});
const png = (tail: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tail]);
const picture = async (unit: { items: readonly { key: string }[] }) => unit.items.map((item, i) => ({ item: item.key, screenshot: { data: png(i), contentType: 'image/png' } }));

/** A server whose layer uploads fail once `cut` is set: the network went away mid-collection. */
function flaky(client: HttpStore, cut: { after: number }): HttpStore {
  let layers = 0;
  return { ...client, put: async (...args: Parameters<HttpStore['put']>) => {
    if (args[0].startsWith('layers/index/') && ++layers > cut.after) throw new AtlasHttpError('connect ECONNREFUSED', null, true);
    return client.put(...args);
  } };
}

describe('#89 capture journals and shard bundles', () => {
  test('1, 5: a capture whose publish loses the network stays in the bundle with its bytes and publication status, and an offline export of merged bundles shows what is missing', async () => {
    const { client } = await serve();
    const dir = await scratch();
    const catalog = await resolveCatalog(definition(2));
    const journal = captureJournal(path.join(dir, 'a'), { shard: 'capture#1', participant: 'capture', attempt: '1' });
    const result = await collectCatalog({ store: flaky(client, { after: 1 }), catalog, shard: { id: 'capture#1' }, batchSize: 1, journal, capture: picture });
    expect(result.stoppedBy).toBe('unreachable');
    const manifest = journal.manifest();
    expect(manifest.definition?.version).toBe(catalog.version);
    expect(manifest.plans).toHaveLength(4);
    expect(manifest.captures.map(capture => capture.publication)).toEqual(['published', 'failed']);
    expect(manifest.captures[1]!.error).toMatch(/ECONNREFUSED/);
    expect(manifest.captures[1]!.claimId).toBeString();
    const checked = await validateBundle(path.join(dir, 'a'));
    expect(checked.problems).toEqual([]);
    // The picture's bytes are in the bundle: every listed object is there with its digest.
    expect(manifest.objects.some(item => item.path.startsWith('layers/blobs/'))).toBe(true);

    // The server is gone: merge locally and render.
    const merged = await mergeBundles([path.join(dir, 'a')], path.join(dir, 'merged'));
    expect(merged.ok).toBe(true);
    const out: string[] = [];
    const code = await uiCatalogMain(['status', '--store', path.join(dir, 'merged', 'store'), '--format', 'json'], { out: text => out.push(text), env: {} });
    expect(code).toBe(1);
    const status = JSON.parse(out.join('')) as { summary: { coverage: Record<string, number> }; problems: { kind: string }[] };
    expect(status.summary.coverage.captured).toBe(2);
    expect(status.summary.coverage.missing).toBe(6);
    const exported: string[] = [];
    expect(await uiCatalogMain(['export', '--store', path.join(dir, 'merged', 'store'), '--out', path.join(dir, 'catalog.html'), '--format', 'json'], { out: text => exported.push(text), env: {} })).toBe(0);
    expect(JSON.parse(exported.join(''))).toMatchObject({ ok: true, states: 2 });
    expect((await readFile(path.join(dir, 'catalog.html'), 'utf8')).length).toBeGreaterThan(1000);
    const validated: string[] = [];
    expect(await uiCatalogMain(['bundle', 'validate', path.join(dir, 'merged'), '--format', 'json'], { out: text => validated.push(text), env: {} })).toBe(0);
    expect(JSON.parse(validated.join('')).bundles[0].captures).toEqual({ total: 2, published: 1, failed: 1, pending: 0 });
  });

  test('4: a capture whose claim expired before it was published is retained on import, and only the explicit accept policy imports it', async () => {
    const clock = { now: 1_000_000 };
    const { client } = await serve(clock);
    const dir = await scratch();
    const catalog = await resolveCatalog({ name: 'one', states: [{ id: 'home' }] });
    const journal = captureJournal(dir, { shard: 'slow' });
    let stalled = false;
    // The upload stalls long enough for the lease to lapse: the server takes the claim back.
    const stalling: HttpStore = { ...client, put: async (...args: Parameters<HttpStore['put']>) => {
      if (!stalled && args[0].startsWith('layers/')) { stalled = true; clock.now += 3_600_000; await Bun.sleep(3_600); }
      return client.put(...args);
    } };
    const result = await collectCatalog({ store: stalling, catalog, shard: { id: 'slow' }, leaseSeconds: 10, maxUnits: 1, journal, capture: picture });
    expect(result.lostClaims).toHaveLength(1);
    const [capture] = journal.manifest().captures;
    expect(capture?.publication).not.toBe('published');
    expect(capture?.claimId).toBe(result.lostClaims[0]!);

    const retained = await importBundle(dir, client, { plans: false });
    expect(retained.ok).toBe(true);
    expect(retained.retained.map(item => item.layer)).toEqual([capture!.layer]);
    expect(retained.layers).toBe(0);
    // Still current work: the queue hands the unit out again.
    const again = await client.call('POST', '/ui-catalog/claims', { accept: [204], json: { shard: 'next', definition: catalog.version, batchSize: 5 } });
    expect(again.status).toBe(200);
    const claimed = await again.json() as { claimId: string };
    await client.call('DELETE', `/ui-catalog/claims/${claimed.claimId}`);

    const accepted = await importBundle(dir, client, { plans: false, reconcile: 'accept' });
    expect(accepted).toMatchObject({ ok: true, layers: 1, retained: [] });
    expect(accepted.copied).toBeGreaterThan(0);
  }, 20_000);
});

describe('#95 the same plan, fewer workers', () => {
  test('6: a laptop running the plan\'s jobs one after another reaches the same complete refresh and the same merged evidence as parallel CI jobs', async () => {
    const catalog = await resolveCatalog(definition(3));
    const plan = planMatrix(catalog, { jobDimensions: ['device', 'scheme'], maxParallel: 4 });
    expect(plan.jobs).toBe(4);
    const run = async (parallel: boolean) => {
      const { client } = await serve();
      const dir = await scratch();
      await beginRefresh(client, { id: 'plan', catalog, staleBeforeMs: 0, participants: plan.participants });
      const job = async (row: (typeof plan.matrix.include)[number]) => {
        const where = parseWhere(row.where.split(' ').filter(word => word !== '--where'));
        const joined = await joinRefresh(client, 'plan', { participant: row.job, where });
        const journal = captureJournal(path.join(dir, row.job), { shard: joined.collect.shard.id, participant: row.job, refresh: 'plan', collection: joined.collect.collection });
        return collectCatalog({ store: client, catalog, ...joined.collect, journal, capture: picture });
      };
      if (parallel) await Promise.all(plan.matrix.include.map(job));
      else for (const row of plan.matrix.include) await job(row);
      const status = await finalizeRefresh(client, 'plan');
      const merged = await mergeBundles(await findBundles([dir]), path.join(dir, 'merged'), { expect: plan.participants });
      return { status, merged };
    };
    const [laptop, ci] = [await run(false), await run(true)];
    for (const side of [laptop, ci]) {
      expect(side.status).toMatchObject({ outcome: 'complete', health: { status: 'healthy', missing: [] } });
      expect(side.merged.ok).toBe(true);
    }
    const items = (side: typeof laptop) => side.merged.manifest!.captures.reduce((sum, capture) => sum + capture.items, 0);
    expect(items(laptop)).toBe(12);
    expect(items(ci)).toBe(items(laptop));
    expect(laptop.status.capture).toEqual(ci.status.capture);
  }, 20_000);
});
