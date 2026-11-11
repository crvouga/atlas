import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AtlasHttpError, httpStore } from '../../reports/src/http-store';
import { collectCatalog } from '../../reports/src/ui-catalog-collect';
import { uiCatalogMain } from '../../reports/src/ui-catalog-cli';
import { resolveCatalog, type CatalogDefinition } from '../../reports/src/ui-catalog-definition';
import { beginRefresh, finalizeRefresh, joinRefresh, refreshStatus } from '../../reports/src/ui-catalog-refresh';
import { memoryStore } from '../../reports/tests/memory-store';
import { UiRefreshStatusSchema } from '../../schema/src/ui-catalog-refresh';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { listen } from '../src/host';

const servers: AtlasServer[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  for (const close of closers.splice(0)) await close();
});

const TOKEN = 'publish-token-12345';
const TOKENS = [{ name: 'ci', role: 'publish' as const, token: TOKEN }];

async function serve(backends?: { id: string; store: ReturnType<typeof memoryStore> }[]) {
  const store = memoryStore();
  const server = createAtlasServer({ backends: backends ?? [{ id: 'data', store }], write: 'data', tokens: TOKENS, refreshMs: 60_000 });
  servers.push(server);
  await server.ready;
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
  closers.push(() => http.close(100));
  const url = `http://127.0.0.1:${http.port}`;
  return { server, store, url, client: httpStore({ url, token: TOKEN }) };
}

const definition = (count: number, extra: Partial<CatalogDefinition> = {}): CatalogDefinition => ({
  name: 'web', states: Array.from({ length: count }, (_, i) => ({ id: `s${i}` })),
  matrix: { dimensions: { device: { values: ['mobile', 'desktop'], profile: device => ({ environment: `${device}-web` }) } } }, ...extra
});
const passing = async (unit: { items: readonly { key: string }[] }) => unit.items.map(item => ({ item: item.key }));

describe('#88 refresh receipts', () => {
  test('1: while another shard holds a lease, a shard that finds nothing left does not make the refresh complete; the held work is named', async () => {
    const { client } = await serve();
    const catalog = await resolveCatalog(definition(3));
    await beginRefresh(client, { id: 'run-1', catalog, staleBeforeMs: 0 });
    const slow = await joinRefresh(client, 'run-1', { participant: 'slow' });
    const held = await client.call('POST', '/ui-catalog/claims', { json: { shard: slow.collect.shard.id, definition: catalog.version, batchSize: 1, collection: slow.collect.collection } });
    const claim = await held.json() as { units: { key: string }[] };
    const fast = await joinRefresh(client, 'run-1', { participant: 'fast' });
    const result = await collectCatalog({ store: client, catalog, ...fast.collect, capture: passing });
    expect(result.stoppedBy).toBe('empty');
    expect(result.ok).toBe(true);
    const status = await finalizeRefresh(client, 'run-1');
    expect(UiRefreshStatusSchema.safeParse(status).success).toBe(true);
    expect(status.outcome).toBe('incomplete');
    expect(status.ok).toBe(false);
    expect(status.capture).toMatchObject({ units: 6, satisfied: 5, held: 1 });
    expect(status.outstanding).toEqual([expect.objectContaining({ unit: claim.units[0]!.key, reason: 'held', shard: 'slow#1' })]);
    expect(status.health.attempts.map(item => [item.shard, item.status])).toEqual([['slow#1', 'active'], ['fast#1', 'idle']]);
  });

  test('2: when every eligible unit exhausted its retries, the refresh fails its capture requirement instead of passing as empty', async () => {
    const { client } = await serve();
    const catalog = await resolveCatalog(definition(1, { maxAttempts: 2 }));
    await beginRefresh(client, { id: 'run-2', catalog, staleBeforeMs: 0 });
    for (const attempt of ['1', '2']) {
      const joined = await joinRefresh(client, 'run-2', { participant: 'capture', attempt });
      const result = await collectCatalog({ store: client, catalog, ...joined.collect, capture: async unit => unit.items.map(item => ({ item: item.key, status: 'failed' as const, detail: 'broken' })) });
      expect(result.stoppedBy).toBe('empty');
    }
    const last = await collectCatalog({ store: client, catalog, ...(await joinRefresh(client, 'run-2', { participant: 'capture', attempt: '3' })).collect, capture: passing });
    expect(last).toMatchObject({ stoppedBy: 'empty', claims: 0 });
    const status = await finalizeRefresh(client, 'run-2');
    expect(status.outcome).toBe('failed');
    expect(status.capture).toMatchObject({ units: 2, satisfied: 0, exhausted: 2 });
    expect(status.outstanding.every(entry => entry.reason === 'exhausted' && entry.attempts === 2)).toBe(true);
  });

  test('3: yesterday\'s captures do not satisfy today\'s cutoff, and a required source counts only evidence at that commit', async () => {
    const { client } = await serve();
    const catalog = await resolveCatalog(definition(2));
    const day = 86_400_000;
    const yesterday = Date.now() - day;
    await collectCatalog({ store: client, catalog, shard: { id: 'nightly' }, now: () => yesterday, origin: { sha: 'a'.repeat(40) }, capture: passing });
    const cutoff = Date.now() - 1000;
    await beginRefresh(client, { id: 'today', catalog, staleBeforeMs: cutoff, source: { sha: 'b'.repeat(40) } });
    const before = await refreshStatus(client, 'today');
    expect(before.outcome).toBe('incomplete');
    expect(before.capture).toMatchObject({ units: 4, satisfied: 0, stale: 4 });
    const joined = await joinRefresh(client, 'today', { participant: 'capture' });
    expect(joined.collect.origin.sha).toBe('b'.repeat(40));
    const result = await collectCatalog({ store: client, catalog, ...joined.collect, capture: passing });
    expect(result.units.collected).toBe(4);
    expect((await finalizeRefresh(client, 'today')).outcome).toBe('complete');
    // The same evidence judged by a refresh that requires another commit: it is there, recent, and not enough.
    await beginRefresh(client, { id: 'pinned', catalog, staleBeforeMs: cutoff, source: { sha: 'c'.repeat(40), require: true } });
    const pinned = await refreshStatus(client, 'pinned');
    expect(pinned.outcome).toBe('failed');
    expect(pinned.capture).toMatchObject({ source: 4, satisfied: 0 });
  });

  test('4: a rerun attempt joins the same refresh; earlier evidence is kept and attempts stay distinguishable', async () => {
    const { client } = await serve();
    const catalog = await resolveCatalog(definition(3));
    const first = await beginRefresh(client, { id: 'run-4', catalog, staleBeforeMs: 0, participants: ['capture', 'other'] });
    expect(first.created).toBe(true);
    const again = await beginRefresh(client, { id: 'run-4', catalog });
    expect(again.created).toBe(false);
    expect(again.receipt.staleBeforeMs).toBe(0);
    await expect(beginRefresh(client, { id: 'run-4', catalog, staleBeforeMs: 5 })).rejects.toBeInstanceOf(AtlasHttpError);
    const one = await joinRefresh(client, 'run-4', { participant: 'capture', attempt: '1' });
    const partial = await collectCatalog({ store: client, catalog, ...one.collect, batchSize: 2, maxUnits: 2, capture: passing });
    expect(partial.stoppedBy).toBe('max-units');
    expect((await finalizeRefresh(client, 'run-4', { attempt: '1' })).outcome).toBe('incomplete');
    const two = await joinRefresh(client, 'run-4', { participant: 'capture', attempt: '2' });
    const rest = await collectCatalog({ store: client, catalog, ...two.collect, capture: passing });
    expect(rest.units.collected).toBe(4);
    const status = await finalizeRefresh(client, 'run-4', { attempt: '2' });
    expect(status.outcome).toBe('complete');
    expect(status.capture.satisfied).toBe(6);
    expect(status.health.attempts.map(item => item.shard)).toEqual(['capture#1', 'capture#2']);
    expect(status.health.missing).toEqual(['other']);
    expect(status.health.status).toBe('degraded');
    expect(status.refresh!.finalizations.map(item => [item.attempt, item.outcome])).toEqual([['1', 'incomplete'], ['2', 'complete']]);
    // Attempt 2 collected only 4 units: the other 2 are still satisfied by what attempt 1 published.
    expect(rest.units.collected + partial.units.collected).toBe(status.capture.satisfied);
  });

  test('5: an unreadable backend, a missing receipt or a server that is down is unknown, and the command exits 1', async () => {
    const broken = memoryStore();
    const failing = { ...broken, listKeys: async () => { throw new Error('down'); }, withPrefix: () => failing } as unknown as ReturnType<typeof memoryStore>;
    const { client, url } = await serve([{ id: 'data', store: memoryStore() }, { id: 'other', store: failing }]);
    const catalog = await resolveCatalog(definition(1));
    await beginRefresh(client, { id: 'run-5', catalog, staleBeforeMs: 0 });
    const unreadable = await finalizeRefresh(client, 'run-5');
    expect(unreadable).toMatchObject({ outcome: 'unknown', ok: false });
    expect(unreadable.health.status).toBe('unknown');
    const missing = await refreshStatus(client, 'never-begun');
    expect(missing).toMatchObject({ outcome: 'unknown', ok: false, refresh: null });
    expect(missing.reasons[0]).toMatch(/could not be found/);
    const down = await refreshStatus(httpStore({ url: 'http://127.0.0.1:1', token: TOKEN }), 'run-5');
    expect(down.outcome).toBe('unknown');
    const lines: string[] = [];
    const code = await uiCatalogMain(['refresh', 'finalize', '--id', 'never-begun', '--store', url, '--format', 'json'], { out: text => lines.push(text), env: { ATLAS_TOKEN: TOKEN } });
    expect(code).toBe(1);
    expect(JSON.parse(lines.join(''))).toMatchObject({ outcome: 'unknown', ok: false });
  });

  test('the command line: begin, collect --refresh --journal, finalize', async () => {
    const { url } = await serve();
    const dir = await mkdtemp(path.join(tmpdir(), 'atlas-refresh-cli-'));
    try {
      await Bun.write(path.join(dir, 'atlas.catalog.mjs'), "export default { name: 'cli', matrix: { dimensions: { scheme: { values: ['light', 'dark'] } } }, states: [{ id: 'home' }] };\n");
      await Bun.write(path.join(dir, 'collector.mjs'), "import { readFileSync, writeFileSync } from 'node:fs';\nconst batch = JSON.parse(readFileSync(process.env.ATLAS_UI_BATCH, 'utf8'));\nwriteFileSync(process.env.ATLAS_UI_CAPTURES, JSON.stringify({ states: batch.states.map(state => ({ item: state.item })) }));\n");
      const run = async (...args: string[]) => {
        const out: string[] = [];
        const code = await uiCatalogMain([...args, '--store', url, '--format', 'json'], { out: text => out.push(text), cwd: dir, env: { ATLAS_TOKEN: TOKEN }, git: () => null });
        return { code, json: JSON.parse(out.join('')) as Record<string, unknown> };
      };
      const begun = await run('refresh', 'begin', '--id', 'cli-1', '--catalog', 'atlas.catalog.mjs', '--participant', 'capture-a', '--stale-before', '0');
      expect(begun.code).toBe(0);
      expect(begun.json).toMatchObject({ ok: true, created: true });
      const collected = await run('collect', '--catalog', 'atlas.catalog.mjs', '--exec', `"${process.execPath}" collector.mjs`, '--refresh', 'cli-1', '--participant', 'capture-a', '--attempt', '3', '--journal', 'bundle');
      expect(collected.code).toBe(0);
      expect(collected.json).toMatchObject({ shard: 'capture-a#3', refresh: { id: 'cli-1', shard: 'capture-a#3' }, journal: { captures: 2, published: 2, failed: 0, pending: 0 } });
      const done = await run('refresh', 'finalize', '--id', 'cli-1');
      expect(done.code).toBe(0);
      expect(done.json).toMatchObject({ outcome: 'complete', health: { status: 'healthy', missing: [] } });
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 30_000);
});
