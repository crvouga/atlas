import { afterEach, describe, expect, test } from 'bun:test';

import { httpStore } from '../../reports/src/http-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { collectCatalog } from '../../reports/src/ui-catalog-collect';
import { resolveCatalog, type CatalogDefinition } from '../../reports/src/ui-catalog-definition';
import { uiStateLayer } from '../../reports/src/ui-catalog-publish';
import { UI_CLAIM_LABEL } from '../../reports/src/ui-catalog-queue';
import { memoryStore } from '../../reports/tests/memory-store';
import type { UiClaim, UiQueueSummary } from '../../schema/src/ui-catalog-queue';
import { UiClaimSchema, UiQueueSummarySchema } from '../../schema/src/ui-catalog-queue';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { listen } from '../src/host';

const servers: AtlasServer[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  for (const close of closers.splice(0)) await close();
});

const TOKENS = [{ name: 'ci', role: 'publish' as const, token: 'publish-token-12345' }, { name: 'laptop', role: 'publish' as const, token: 'publish-token-67890' }, { name: 'eyes', role: 'read' as const, token: 'read-token-1234567' }];
const publisher = (token = TOKENS[0]!.token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function start(options: { store?: ReturnType<typeof memoryStore>; clock?: { now: number } } = {}) {
  const store = options.store ?? memoryStore();
  const clock = options.clock ?? { now: 1_000_000 };
  const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', tokens: TOKENS, refreshMs: 60_000, now: () => clock.now });
  servers.push(server);
  await server.ready;
  const call = (path: string, init: RequestInit = {}) => server.fetch(new Request(`http://atlas.test${path}`, init));
  return { store, server, call, clock };
}

const definition = (count: number, extra: Partial<CatalogDefinition> = {}): CatalogDefinition => ({
  name: 'web', states: Array.from({ length: count }, (_, i) => ({ id: `s${String(i).padStart(5, '0')}` })),
  matrix: { dimensions: { device: { values: ['mobile', 'desktop'], profile: device => ({ environment: `${device}-web` }) } } }, ...extra
});

async function publishDefinition(call: Awaited<ReturnType<typeof start>>['call'], catalog: CatalogDefinition, token?: string) {
  const resolved = await resolveCatalog(catalog);
  const response = await call(`/api/ui-catalog/definitions/${resolved.version}`, { method: 'PUT', headers: publisher(token), body: JSON.stringify(resolved.document) });
  return { ...resolved, response, body: await response.json() as { created: boolean; layers: number; items: number; units: number } };
}

async function claim(call: Awaited<ReturnType<typeof start>>['call'], body: Record<string, unknown>, token?: string): Promise<{ status: number; claim: UiClaim | null; text: string }> {
  const response = await call('/api/ui-catalog/claims', { method: 'POST', headers: publisher(token), body: JSON.stringify({ shard: 'ci-1', ...body }) });
  const text = response.status === 204 ? '' : await response.text();
  return { status: response.status, claim: response.status === 200 ? UiClaimSchema.parse(JSON.parse(text)) as UiClaim : null, text };
}

async function summary(call: Awaited<ReturnType<typeof start>>['call']): Promise<UiQueueSummary> {
  return UiQueueSummarySchema.parse(await (await call('/api/ui-catalog/queue', { headers: publisher(TOKENS[2]!.token) })).json()) as UiQueueSummary;
}

/** Publish captures for the items of some units, labelled with the claim, as a collector does. */
async function answer(store: ReturnType<typeof memoryStore>, server: AtlasServer, claimed: UiClaim, at: number, status: (state: string) => 'passed' | 'failed' = () => 'passed') {
  const byProfile = new Map<string, UiClaim['units'][number]['items']>();
  for (const unit of claimed.units) for (const item of unit.items) byProfile.set(item.profile.key, [...(byProfile.get(item.profile.key) ?? []), item]);
  for (const items of byProfile.values()) {
    const profile = items[0]!.profile;
    const layer = await publishChecks(store, uiStateLayer({ producer: 'ui-catalog:web', recordedAtMs: at, ...(profile.environment ? { environment: profile.environment } : {}), profile: profile.parameters, states: items.map(item => ({ id: item.state.id, status: status(item.state.id), labels: { [UI_CLAIM_LABEL]: claimed.claimId } })) }));
    await server.index.accept('data', `layers/index/${String(Number.MAX_SAFE_INTEGER - layer.recordedAtMs).padStart(16, '0')}-${layer.id}.json`, layer);
  }
}

describe('publishing a definition', () => {
  test('1, 9: it is stored once, its plan layers make the catalog expect every item, and publishing it again (even at once) changes nothing', async () => {
    const { call } = await start();
    const resolved = await resolveCatalog(definition(3));
    const put = () => call(`/api/ui-catalog/definitions/${resolved.version}`, { method: 'PUT', headers: publisher(), body: JSON.stringify(resolved.document) });
    const answers = await Promise.all([put(), put(), put()]);
    expect(answers.map(response => response.status).sort()).toEqual([200, 200, 201]);
    const catalog = await (await call('/api/reports/ui-catalog', { headers: publisher() })).json() as { summary: { cells: number; coverage: { missing: number }; planned: boolean } };
    expect(catalog.summary).toMatchObject({ cells: 6, planned: true });
    expect(catalog.summary.coverage.missing).toBe(6);
    const stored = await (await call(`/api/ui-catalog/definitions/${resolved.version}`, { headers: publisher() })).json();
    expect(stored).toEqual(JSON.parse(JSON.stringify(resolved.document)));
  });

  test('a version that is not the hash, a reader and an ambiguous matrix are refused', async () => {
    const { call } = await start();
    const resolved = await resolveCatalog(definition(1));
    expect((await call(`/api/ui-catalog/definitions/${'0'.repeat(64)}`, { method: 'PUT', headers: publisher(), body: JSON.stringify(resolved.document) })).status).toBe(422);
    expect((await call(`/api/ui-catalog/definitions/${resolved.version}`, { method: 'PUT', headers: publisher(TOKENS[2]!.token), body: JSON.stringify(resolved.document) })).status).toBe(403);
    const bad = { ...resolved.document, exclude: [{ colour: 'red' }] };
    const { catalogVersion } = await import('../../reports/src/ui-catalog-definition');
    const refused = await call(`/api/ui-catalog/definitions/${await catalogVersion(bad)}`, { method: 'PUT', headers: publisher(), body: JSON.stringify(bad) });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { detail: string }).detail).toMatch(/colour/);
  });
});

describe('claims', () => {
  test('10, 17: a shard claiming repeatedly gets every unit once, in priority order, then 204', async () => {
    const { call, store, server, clock } = await start();
    const { version } = await publishDefinition(call, definition(3));
    // s00001 failed earlier; s00002 is captured; s00000 was never captured.
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 10, environment: 'mobile-web', profile: { device: 'mobile' }, states: [{ id: 's00001', status: 'failed' }, { id: 's00002' }] }));
    await server.index.refreshNow();
    const seen: string[] = [];
    for (;;) {
      const next = await claim(call, { definition: version, batchSize: 2, staleBeforeMs: clock.now });
      if (next.status === 204) break;
      expect(next.status).toBe(200);
      for (const unit of next.claim!.units) seen.push(`${unit.tier}:${unit.items[0]!.state.id}@${unit.items[0]!.profile.values.device}`);
    }
    expect(seen).toEqual(['failed:s00001@mobile', 'empty:s00000@desktop', 'empty:s00000@mobile', 'empty:s00001@desktop', 'empty:s00002@desktop', 'stale:s00002@mobile']);
  });

  test('12: concurrent shards never hold one unit twice, and together with what is left they cover the queue', async () => {
    const { call } = await start();
    const { version, body } = await publishDefinition(call, definition(60));
    const tokens = [TOKENS[0]!.token, TOKENS[1]!.token];
    const claims = await Promise.all(Array.from({ length: 20 }, (_, i) => claim(call, { definition: version, batchSize: 5, shard: `s${i}` }, tokens[i % 2])));
    const held = claims.flatMap(item => item.claim?.units.map(unit => unit.key) ?? []);
    expect(new Set(held).size).toBe(held.length);
    expect(held).toHaveLength(100);
    const queue = await summary(call);
    expect(queue.held).toBe(100);
    expect(queue.tiers.empty + queue.held).toBe(body.units);
  });

  test('13, 22: an expired or released claim gives its unfinished units back as empty; published results stay', async () => {
    const { call, store, server, clock } = await start();
    const { version } = await publishDefinition(call, definition(2));
    const first = (await claim(call, { definition: version, batchSize: 4, leaseSeconds: 10 })).claim!;
    expect(first.units).toHaveLength(4);
    await answer(store, server, { ...first, units: first.units.slice(0, 1) }, 50);
    clock.now += 11_000;
    await server.fetch(new Request('http://atlas.test/api/ui-catalog/queue', { headers: publisher() }));
    const lost = await call(`/api/ui-catalog/claims/${first.claimId}/heartbeat`, { method: 'POST', headers: publisher() });
    expect(lost.status).toBe(410);
    const second = (await claim(call, { definition: version, batchSize: 10 })).claim!;
    expect(second.units.map(unit => unit.key).sort()).toEqual(first.units.slice(1).map(unit => unit.key).sort());
    expect(second.units.every(unit => unit.tier === 'empty')).toBe(true);
    const released = await call(`/api/ui-catalog/claims/${second.claimId}`, { method: 'DELETE', headers: publisher() });
    expect(await released.json()).toEqual({ released: 3, done: 0 });
    expect((await claim(call, { definition: version, batchSize: 10 })).claim!.units).toHaveLength(3);
    const queue = await summary(call);
    expect(queue.shards.find(shard => shard.shard === 'ci-1')!.status).toBe('active');
  });

  test('a capture labelled with its claim closes the unit, and a claim whose units are all answered completes', async () => {
    const { call, store, server } = await start();
    const { version } = await publishDefinition(call, definition(2));
    const held = (await claim(call, { definition: version, batchSize: 4 })).claim!;
    await answer(store, server, held, 50);
    const beat = await call(`/api/ui-catalog/claims/${held.claimId}/heartbeat`, { method: 'POST', headers: publisher() });
    expect(beat.status).toBe(410);
    expect((await claim(call, { definition: version })).status).toBe(204);
    const queue = await summary(call);
    expect(queue.throughput.unitsPerMinute).toBeGreaterThan(0);
    expect(queue.tiers.fresh).toBe(4);
  });

  test('14: a late shard\'s result and the new shard\'s result are both kept, and the newest wins the cell', async () => {
    const { call, store, server, clock } = await start();
    const { version } = await publishDefinition(call, definition(1, { matrix: undefined }));
    const late = (await claim(call, { definition: version, leaseSeconds: 10 })).claim!;
    clock.now += 11_000;
    const fresh = (await claim(call, { definition: version, shard: 'ci-2' })).claim!;
    expect(fresh.units[0]!.key).toBe(late.units[0]!.key);
    await answer(store, server, fresh, 200, () => 'passed');
    await answer(store, server, late, 100, () => 'failed');
    const catalog = await (await call('/api/reports/ui-catalog', { headers: publisher() })).json() as { states: { cells: { coverage: string; capture: { alternatives: number } }[] }[] };
    expect(catalog.states[0]!.cells[0]!.coverage).toBe('captured');
  });

  test('15: a unit that failed maxAttempts times in a row in one collection is no longer handed out in it', async () => {
    const { call, store, server } = await start();
    const { version } = await publishDefinition(call, definition(1, { matrix: undefined, maxAttempts: 2 }));
    for (let attempt = 0; attempt < 2; attempt++) {
      const held = (await claim(call, { definition: version, collection: 'run-1' })).claim!;
      expect(held.units[0]!.tier).toBe(attempt === 0 ? 'empty' : 'failed');
      await answer(store, server, held, 100 + attempt, () => 'failed');
      await call(`/api/ui-catalog/claims/${held.claimId}`, { method: 'DELETE', headers: publisher() });
    }
    expect((await claim(call, { definition: version, collection: 'run-1' })).status).toBe(204);
    // Another collection starts counting again.
    expect((await claim(call, { definition: version, collection: 'run-2' })).status).toBe(200);
    const queue = await summary(call);
    expect(queue.exhausted).toEqual([{ unit: expect.any(String), attempts: 2, collection: 'run-1' }]);
  });

  test('16: where hands out only matching units, and an unknown dimension or value is 422', async () => {
    const { call } = await start();
    const { version } = await publishDefinition(call, definition(3));
    const mobile = (await claim(call, { definition: version, batchSize: 10, where: { device: ['mobile'] } })).claim!;
    expect(mobile.units).toHaveLength(3);
    expect(mobile.units.every(unit => unit.items[0]!.profile.values.device === 'mobile')).toBe(true);
    expect((await claim(call, { definition: version, where: { device: ['mobile'] } })).status).toBe(204);
    expect((await claim(call, { definition: version, batchSize: 10 })).claim!.units).toHaveLength(3);
    const unknown = await claim(call, { definition: version, where: { device: ['tablet'] } });
    expect(unknown.status).toBe(422);
    expect((JSON.parse(unknown.text) as { detail: string }).detail).toMatch(/where names device="tablet".*"mobile", "desktop"/);
  });

  test('19: after a restart the open claims are restored with their leases, and lapsed ones go back to the queue', async () => {
    const store = memoryStore();
    const clock = { now: 1_000_000 };
    const first = await start({ store, clock });
    const { version } = await publishDefinition(first.call, definition(2));
    const kept = (await claim(first.call, { definition: version, batchSize: 1, leaseSeconds: 600 })).claim!;
    const lapsing = (await claim(first.call, { definition: version, batchSize: 1, leaseSeconds: 10 })).claim!;
    first.server.close();
    clock.now += 20_000;
    const second = await start({ store, clock });
    expect((await second.call(`/api/ui-catalog/claims/${kept.claimId}/heartbeat`, { method: 'POST', headers: publisher() })).status).toBe(200);
    expect((await second.call(`/api/ui-catalog/claims/${lapsing.claimId}/heartbeat`, { method: 'POST', headers: publisher() })).status).toBe(410);
    const next = (await claim(second.call, { definition: version, batchSize: 10 })).claim!;
    expect(next.units.map(unit => unit.key)).not.toContain(kept.units[0]!.key);
    expect(next.units.map(unit => unit.key)).toContain(lapsing.units[0]!.key);
  });

  test('23: a retried claim with the same idempotency key answers the same claim, never a second batch', async () => {
    const { call } = await start();
    const { version } = await publishDefinition(call, definition(5));
    const one = await claim(call, { definition: version, batchSize: 2, idempotencyKey: 'k1' });
    const two = await claim(call, { definition: version, batchSize: 2, idempotencyKey: 'k1' });
    expect(two.claim!.claimId).toBe(one.claim!.claimId);
    expect((await summary(call)).held).toBe(2);
    // Another publisher with the same key gets its own claim.
    expect((await claim(call, { definition: version, batchSize: 2, idempotencyKey: 'k1' }, TOKENS[1]!.token)).claim!.claimId).not.toBe(one.claim!.claimId);
    await call(`/api/ui-catalog/claims/${one.claim!.claimId}`, { method: 'DELETE', headers: publisher() });
    expect((await claim(call, { definition: version, idempotencyKey: 'k1' })).status).toBe(410);
  });

  test('another publisher cannot renew or release a claim, and an unknown definition is 404', async () => {
    const { call } = await start();
    const { version } = await publishDefinition(call, definition(1));
    const held = (await claim(call, { definition: version })).claim!;
    expect((await call(`/api/ui-catalog/claims/${held.claimId}/heartbeat`, { method: 'POST', headers: publisher(TOKENS[1]!.token) })).status).toBe(403);
    expect((await call(`/api/ui-catalog/claims/${held.claimId}`, { method: 'DELETE', headers: publisher(TOKENS[2]!.token) })).status).toBe(403);
    expect((await claim(call, { definition: 'f'.repeat(64) })).status).toBe(404);
  });

  test('21: units without a readable result while a backend cannot be read are unknown, named in the summary', async () => {
    const broken = memoryStore();
    const failing = { ...broken, listKeys: async () => { throw new Error('down'); }, withPrefix: () => failing } as unknown as ReturnType<typeof memoryStore>;
    const store = memoryStore();
    const server = createAtlasServer({ backends: [{ id: 'data', store }, { id: 'other', store: failing }], write: 'data', tokens: TOKENS, refreshMs: 60_000 });
    servers.push(server);
    await server.ready;
    const call = (path: string, init: RequestInit = {}) => server.fetch(new Request(`http://atlas.test${path}`, init));
    await publishDefinition(call, definition(2));
    const queue = await summary(call);
    expect(queue.tiers.empty).toBe(0);
    expect(queue.unknown.count).toBe(4);
    expect(queue.unknown.notices.length).toBeGreaterThan(0);
  });

  test('24: 50 000 items and 100 concurrent shards: no unit held twice, and claiming stays fast', async () => {
    const { call } = await start();
    const { version } = await publishDefinition(call, definition(25_000));
    const latencies: number[] = [];
    const answers = await Promise.all(Array.from({ length: 100 }, async (_, i) => {
      const started = performance.now();
      const result = await claim(call, { definition: version, batchSize: 25, shard: `shard-${i}` }, TOKENS[i % 2]!.token);
      latencies.push(performance.now() - started);
      return result;
    }));
    const held = answers.flatMap(item => item.claim!.units.map(unit => unit.key));
    expect(new Set(held).size).toBe(2500);
    // Claims are answered one after another under one lock; the slowest waits for all the others.
    const sorted = latencies.sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length * 0.99)]!).toBeLessThan(5_000);
    const started = performance.now();
    await claim(call, { definition: version, batchSize: 25, shard: 'after' });
    expect(performance.now() - started).toBeLessThan(500);
  }, 60_000);
});

describe('collectCatalog', () => {
  async function serve() {
    const store = memoryStore();
    const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', tokens: TOKENS, refreshMs: 60_000 });
    servers.push(server);
    await server.ready;
    const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
    closers.push(() => http.close(100));
    return { server, url: `http://127.0.0.1:${http.port}` };
  }

  test('three shards drain the queue together, each unit collected once, and the catalog is complete', async () => {
    const { url, server } = await serve();
    const catalog = definition(12);
    const collected: string[] = [];
    const results = await Promise.all(['a', 'b', 'c'].map(shard => collectCatalog({
      store: httpStore({ url, token: TOKENS[0]!.token }), catalog, shard: { id: shard }, batchSize: 3,
      capture: async unit => unit.items.map(item => { collected.push(item.key); return { item: item.key, screenshot: { data: new TextEncoder().encode(`png:${item.key}`) } }; })
    })));
    expect(new Set(collected).size).toBe(24);
    expect(collected).toHaveLength(24);
    expect(results.every(result => result.ok && result.stoppedBy === 'empty')).toBe(true);
    expect(results.reduce((sum, result) => sum + result.items.captured, 0)).toBe(24);
    const status = await server.fetch(new Request('http://atlas.test/api/reports/ui-catalog', { headers: publisher() }));
    const body = await status.json() as { summary: { coverage: { captured: number; missing: number } } };
    expect(body.summary.coverage).toMatchObject({ captured: 24, missing: 0 });
  });

  test('18, 20: bounds stop claiming; a failing capture is recorded as failed; an unreachable server collects nothing', async () => {
    const { url } = await serve();
    const result = await collectCatalog({
      store: httpStore({ url, token: TOKENS[0]!.token }), catalog: definition(10), shard: { id: 'bounded' }, batchSize: 4, maxUnits: 6,
      capture: async unit => { if (unit.items[0]!.state.id === 's00000') throw new Error('never ready'); return unit.items.map(item => ({ item: item.key })); }
    });
    expect(result.stoppedBy).toBe('max-units');
    expect(result.units.claimed).toBe(6);
    expect(result.ok).toBe(false);
    expect(result.items.failed).toBeGreaterThan(0);
    await expect(collectCatalog({ store: httpStore({ url: 'http://127.0.0.1:9', token: 'x', retries: 0 }), catalog: definition(1), shard: { id: 'x' }, capture: async () => [] })).rejects.toThrow(/cannot reach/);
  });

  test('a stop signal releases the claim, so its units are back in the queue at once', async () => {
    const { url, server } = await serve();
    const stop = new AbortController();
    const result = await collectCatalog({
      store: httpStore({ url, token: TOKENS[0]!.token }), catalog: definition(5), shard: { id: 'interrupted' }, batchSize: 10, signal: stop.signal,
      capture: async unit => { stop.abort(); return unit.items.map(item => ({ item: item.key })); }
    });
    expect(result.stoppedBy).toBe('signal');
    expect(result.units.collected).toBe(1);
    expect(result.units.released).toBe(9);
    const queue = await (await server.fetch(new Request('http://atlas.test/api/ui-catalog/queue', { headers: publisher() }))).json() as UiQueueSummary;
    expect(queue.held).toBe(0);
    expect(queue.tiers.empty).toBe(9);
  });
});
