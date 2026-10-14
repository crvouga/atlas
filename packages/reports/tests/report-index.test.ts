import { describe, expect, test } from 'bun:test';

import { combineBackends, type BackendInput } from '../src/compose';
import { combineEvidence } from '../src/layer-merge';
import { ReportIndex } from '../src/report-index';
import { memoryStore } from './memory-store';
import { plans, publish, random } from './plans';

const SEEDS = [1, 2, 3, 7, 42, 99];

/** What the report says: the winning result of every slot. */
function winners(results: readonly { key: string; row: { status: string }; layer: { id: string } }[]) {
  return results.map(result => [result.key, result.row.status, result.layer.id]).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
}

describe('the incremental report equals combining everything', () => {
  test.each(SEEDS)('seed %i: folding layers as they arrive, in batches, across backends, gives the same winners', async seed => {
    const all = plans(seed, 60);
    const r = random(seed * 13);
    const stores = [memoryStore(), memoryStore(), memoryStore()];
    const backends: BackendInput[] = stores.map((store, i) => ({ id: `node-${i}`, store }));
    const index = new ReportIndex(backends);
    for (let from = 0; from < all.length;) {
      const batch = all.slice(from, from += 1 + Math.floor(r.next() * 9));
      for (const plan of batch) for (const home of new Set([Math.floor(r.next() * 3), ...(r.next() < 0.25 ? [Math.floor(r.next() * 3)] : [])])) await publish(stores[home]!, plan);
      await index.refresh();
    }
    const expected = await combineBackends(backends);
    const reference = winners([...expected.combined.specs.flatMap(entry => entry.results), ...expected.combined.unassigned]);

    const snapshot = index.snapshot();
    const folded = combineEvidence({ specs: [], sha: null, changedFiles: [] }, snapshot.layers);
    expect(winners(folded.unassigned)).toEqual(reference);
    expect(snapshot.totalLayers).toBe(expected.layers.length);
    expect(snapshot.notices).toEqual([]);
  });

  test('only layers that win something are kept, each with only its winning rows', async () => {
    const store = memoryStore();
    const base = { producer: 'e2e', environment: 'ios', branch: 'main', sha: 'a'.repeat(40) };
    for (let at = 1; at <= 20; at++) await publish(store, { ...base, recordedAtMs: at, checks: [{ id: 'join', status: 'passed' }, { id: 'leave', status: at === 20 ? 'failed' : 'passed' }] });
    await publish(store, { ...base, recordedAtMs: 5, checks: [{ id: 'rename', status: 'passed' }] });
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    const snapshot = index.snapshot();
    expect(snapshot.totalLayers).toBe(21);
    expect(snapshot.layers.length).toBe(2);
    expect(snapshot.layers.map(layer => layer.rows.map(row => row.id).sort())).toEqual([['join', 'leave'], ['rename']]);
    expect(index.stats()).toMatchObject({ layers: 21, slots: 3, holding: 2 });
  });

  test('an immutable layer in two backends is one layer, attributed to the backend that sorts first, whichever was read first', async () => {
    const a = memoryStore(), z = memoryStore();
    const plan = plans(1, 1)[0]!;
    await publish(a, plan); await publish(z, plan);
    for (const order of [['a', 'z'], ['z', 'a']]) {
      const index = new ReportIndex(order.map(id => ({ id, store: id === 'a' ? a : z })));
      await index.refresh();
      expect(index.snapshot().layers.map(layer => layer.layer.backend)).toEqual(['a']);
      expect(index.snapshot().totalLayers).toBe(1);
    }
  });

  test('a refresh with nothing new changes nothing and says so; version changes only with the report', async () => {
    const store = memoryStore();
    const index = new ReportIndex([{ id: 'one', store }]);
    await publish(store, { producer: 'p', environment: null, branch: 'main', sha: 'a'.repeat(40), recordedAtMs: 1, checks: [{ id: 'a', status: 'passed' }] });
    expect(await index.refresh()).toBe(true);
    const version = index.snapshot().version;
    expect(await index.refresh()).toBe(false);
    expect(index.snapshot().version).toBe(version);
    await publish(store, { producer: 'p', environment: null, branch: 'main', sha: 'a'.repeat(40), recordedAtMs: 2, checks: [{ id: 'a', status: 'failed' }] });
    expect(await index.refresh()).toBe(true);
    expect(index.snapshot().version).not.toBe(version);
  });

  test('each layer is read once: a second refresh reads only the catalog', async () => {
    const store = memoryStore();
    for (const plan of plans(3, 15)) await publish(store, plan);
    let reads = 0;
    const counting = { ...store, get: async (key: string) => { reads += 1; return store.get(key); } };
    const index = new ReportIndex([{ id: 'one', store: counting as typeof store }]);
    await index.refresh();
    const first = reads;
    await index.refresh();
    expect(first).toBeGreaterThan(0);
    expect(reads).toBe(first);
  });

  test('a backend that goes down keeps what was folded, says so, and recovers', async () => {
    const up = memoryStore(), flaky = memoryStore();
    await publish(up, plans(1, 1)[0]!);
    await publish(flaky, plans(1, 2)[1]!);
    const index = new ReportIndex([{ id: 'up', store: up, label: 'CI' }, { id: 'lab', store: flaky, label: 'Device lab' }]);
    await index.refresh();
    const before = index.snapshot().layers.length;
    flaky.down = true;
    await index.refresh();
    expect(index.snapshot().layers.length).toBe(before);
    expect(index.snapshot().backends.find(backend => backend.id === 'lab')!.available).toBe(false);
    expect(index.snapshot().notices.join(' ')).toContain('Device lab is unavailable');
    flaky.down = false;
    await index.refresh();
    expect(index.snapshot().backends.find(backend => backend.id === 'lab')!.available).toBe(true);
    expect(index.snapshot().notices).toEqual([]);
  });

  test('a layer that cannot be read is a notice, not a crash, and is tried again later', async () => {
    const store = memoryStore();
    const layer = await publish(store, plans(1, 1)[0]!);
    const key = `layers/manifests/${layer.id}.json`;
    const good = await new Response((await store.get(key))!.body).text();
    await store.put(key, new TextEncoder().encode('{"schemaVersion": 9}'), 'application/json');
    let clock = 0;
    const index = new ReportIndex([{ id: 'one', store }], { now: () => clock });
    await index.refresh();
    expect(index.snapshot().layers).toEqual([]);
    expect(index.snapshot().notices.join(' ')).toContain('Upgrade @crvouga/atlas');
    await store.put(key, new TextEncoder().encode(good), 'application/json');
    await index.refresh();
    expect(index.snapshot().layers).toEqual([]);
    clock += 6 * 60_000;
    await index.refresh();
    expect(index.snapshot().layers.length).toBe(1);
    expect(index.snapshot().notices).toEqual([]);
  });

  test('concurrent refreshes share one pass', async () => {
    const store = memoryStore();
    for (const plan of plans(5, 10)) await publish(store, plan);
    const before = store.lists;
    const index = new ReportIndex([{ id: 'one', store }]);
    await Promise.all([index.refresh(), index.refresh(), index.refresh()]);
    expect(store.lists - before).toBe(1);
  });

  test('layers left out never reach the report, and the rest is unchanged', async () => {
    const store = memoryStore();
    const base = { producer: 'e2e', environment: 'ios', sha: 'a'.repeat(40) };
    await publish(store, { ...base, branch: 'main', recordedAtMs: 1, checks: [{ id: 'join', status: 'passed' }] });
    await publish(store, { ...base, branch: 'feat/x', recordedAtMs: 2, checks: [{ id: 'join', status: 'failed' }] });
    const all = new ReportIndex([{ id: 'one', store }]);
    const onlyMain = new ReportIndex([{ id: 'one', store }], { include: layer => layer.branch === 'main' });
    await Promise.all([all.refresh(), onlyMain.refresh()]);
    expect(all.snapshot().layers[0]!.rows[0]!.status).toBe('failed');
    expect(onlyMain.snapshot().layers[0]!.rows[0]!.status).toBe('passed');
  });
});

describe('looking only at what is new', () => {
  const publishAt = (store: ReturnType<typeof memoryStore>, at: number, id = 'a') => publish(store, { producer: 'p', environment: null, branch: 'main', sha: 'a'.repeat(40), recordedAtMs: at, checks: [{ id, status: 'passed' }] });

  test('a refresh with nothing new is one request, and a new layer is found by looking at the newest end', async () => {
    const store = memoryStore();
    for (let at = 10; at < 30; at++) await publishAt(store, at, `c${at}`);
    const index = new ReportIndex([{ id: 'one', store }], { fullListEvery: 100 });
    await index.refresh();
    const afterFirst = store.lists;
    expect(await index.refresh()).toBe(false);
    expect(store.lists - afterFirst).toBe(1);
    await publishAt(store, 40, 'fresh');
    expect(await index.refresh()).toBe(true);
    expect(index.snapshot().totalLayers).toBe(21);
  });

  test('a layer that arrives with an old time sorts behind the known ones: the next full listing finds it', async () => {
    const store = memoryStore();
    for (let at = 10; at < 20; at++) await publishAt(store, at, `c${at}`);
    const small = { ...store, listPage: (prefix: string, options?: { after?: string; limit?: number }) => store.listPage(prefix, { ...options, limit: 3 }) };
    const index = new ReportIndex([{ id: 'one', store: small as typeof store }], { fullListEvery: 3 });
    await index.refresh();
    await publishAt(store, 5, 'late');
    await index.refresh();
    expect(index.snapshot().totalLayers).toBe(10);
    await index.refresh();
    await index.refresh();
    expect(index.snapshot().totalLayers).toBe(11);
  });

  test('more new layers than fit on a page are all found', async () => {
    const store = memoryStore();
    const index = new ReportIndex([{ id: 'one', store }], { fullListEvery: 100 });
    await publishAt(store, 1, 'first');
    await index.refresh();
    const paged = { ...store, listPage: (prefix: string, options?: { after?: string; limit?: number }) => store.listPage(prefix, { ...options, limit: 3 }) };
    const small = new ReportIndex([{ id: 'one', store: paged as typeof store }], { fullListEvery: 100 });
    await small.refresh();
    for (let at = 2; at <= 9; at++) await publishAt(store, at, `n${at}`);
    await small.refresh();
    expect(small.snapshot().totalLayers).toBe(9);
  });
});

describe('the version of the report', () => {
  test('a notice that changes its words changes the version, and the same report has one version wherever it is built', async () => {
    const store = memoryStore();
    await publish(store, { producer: 'p', environment: null, branch: 'main', sha: 'a'.repeat(40), recordedAtMs: 1, checks: [{ id: 'a', status: 'passed' }] });
    const [a, b] = [new ReportIndex([{ id: 'one', store }]), new ReportIndex([{ id: 'one', store }])];
    await Promise.all([a.refresh(), b.refresh()]);
    expect(a.snapshot().version).toBe(b.snapshot().version);
    const withLabel = new ReportIndex([{ id: 'one', label: 'Renamed', store }]);
    await withLabel.refresh();
    expect(withLabel.snapshot().version).not.toBe(a.snapshot().version);
    expect(a.snapshot()).toBe(a.snapshot());
  });
});
