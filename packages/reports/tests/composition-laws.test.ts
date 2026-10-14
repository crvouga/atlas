import { describe, expect, test } from 'bun:test';

import { combineBackends, type BackendInput, type CombinedReport } from '../src/compose';
import { copyStore } from '../src/copy-store';
import type { EvidenceStatus } from '../src/explorer-types';
import { combineEvidence, layerEvidence } from '../src/layer-merge';
import type { LayerSummary } from '../src/layer-types';
import type { ObjectStore } from '../src/object-store';
import { reportStatus } from '../src/report-status';
import { publishChecks } from '../src/publish-checks';
import { memoryStore } from './memory-store';
import { plans, publish, random, type Plan } from './plans';

/** What a report says, independent of which backend held a layer or how backends were named. */
function essence(report: CombinedReport) {
  const results = [...report.combined.specs.flatMap(entry => entry.results), ...report.combined.unassigned];
  return {
    results: results.map(result => [result.key, result.row.status, result.layer.id]).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    summary: report.summary,
    layers: report.layers.map(layer => layer.id).sort(),
    notices: report.notices
  };
}

async function reference(all: readonly Plan[]) {
  const store = memoryStore();
  for (const plan of all) await publish(store, plan);
  return essence(await combineBackends([{ id: 'one', store }]));
}

const SEEDS = [1, 2, 3, 7, 11, 42, 99, 2026];

describe('layers compose the same way however they arrive', () => {
  test.each(SEEDS)('seed %i: splitting layers across any number of backends, in any order, with overlap, changes nothing', async seed => {
    const all = plans(seed);
    const expected = await reference(all);
    const r = random(seed * 31);
    for (let round = 0; round < 4; round++) {
      const stores = Array.from({ length: 1 + Math.floor(r.next() * 5) }, () => memoryStore());
      for (const plan of all) {
        // Each layer lands on one backend, and on a second one a fifth of the time: nodes that both kept a copy.
        const homes = new Set([Math.floor(r.next() * stores.length), ...(r.next() < 0.2 ? [Math.floor(r.next() * stores.length)] : [])]);
        for (const home of homes) await publish(stores[home]!, plan);
      }
      const backends: BackendInput[] = r.shuffle(stores.map((store, i) => ({ id: `node-${i}`, store })));
      expect(essence(await combineBackends(backends))).toEqual(expected);
    }
  });

  test.each(SEEDS)('seed %i: which backend a result is attributed to does not depend on the order backends are read in', async seed => {
    const all = plans(seed);
    const r = random(seed * 17);
    const stores = [memoryStore(), memoryStore(), memoryStore()];
    // Every layer is held by every backend, as when nodes sync to a shared store.
    for (const store of stores) for (const plan of all) await publish(store, plan);
    const named = stores.map((store, i) => ({ id: `node-${i}`, store }));
    const attribution = async (backends: BackendInput[]) => {
      const report = await combineBackends(backends);
      return [...report.combined.specs.flatMap(entry => entry.results), ...report.combined.unassigned].map(result => [result.key, result.layer.id, result.layer.backend]).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    };
    const expected = await attribution(named);
    for (let round = 0; round < 3; round++) expect(await attribution(r.shuffle(named))).toEqual(expected);
  });

  test.each(SEEDS)('seed %i: copying stores together is the aggregate, and copying again changes nothing', async seed => {
    const all = plans(seed);
    const expected = await reference(all);
    const r = random(seed + 5);
    const parts = [memoryStore(), memoryStore(), memoryStore()];
    for (const plan of all) await publish(parts[Math.floor(r.next() * parts.length)]!, plan);
    for (const order of [[0, 1, 2], [2, 0, 1], [1, 1, 2, 0, 0]]) {
      const merged = memoryStore();
      for (const index of order) await copyStore(parts[index]!, merged);
      expect(essence(await combineBackends([{ id: 'merged', store: merged }]))).toEqual(expected);
    }
    await copyStore(parts[0]!, parts[1]!);
    expect(await copyStore(parts[0]!, parts[1]!)).toEqual({ copied: 0, skipped: (await parts[0]!.listKeys('layers/')).length, ignored: 0 });
  });

  test.each(SEEDS)('seed %i: each slot is filled by the newest completed result; running never erases a completed one; ties fail', async seed => {
    const all = plans(seed);
    const store = memoryStore();
    for (const plan of all) await publish(store, plan);
    const report = await combineBackends([{ id: 'one', store }]);
    const results = [...report.combined.specs.flatMap(entry => entry.results), ...report.combined.unassigned];
    for (const result of results) {
      const environment = result.layer.environment;
      const competing = all.filter(plan => plan.producer === result.layer.producer && (plan.environment ?? null) === environment && plan.checks.some(check => check.id === result.row.id)).map(plan => ({ at: plan.recordedAtMs, status: plan.checks.find(check => check.id === result.row.id)!.status }));
      const completed = competing.filter(item => item.status === 'passed' || item.status === 'failed');
      if (completed.length) {
        const newest = Math.max(...completed.map(item => item.at));
        const atNewest = completed.filter(item => item.at === newest).map(item => item.status);
        expect(result.layer.recordedAtMs).toBe(newest);
        expect(result.row.status).toBe(atNewest.includes('failed') ? 'failed' : 'passed');
      }
    }
    // Every slot anyone filled appears exactly once.
    const slots = new Set(all.flatMap(plan => plan.checks.map(check => `${plan.producer}|${plan.environment ?? ''}|${check.id}`)));
    expect(results.length).toBe(slots.size);
  });

  test('a backend that is down is named, and every other backend is still combined', async () => {
    const up = memoryStore(), down = memoryStore();
    await publish(up, plans(1)[0]!);
    await publish(down, plans(1)[1]!);
    down.down = true;
    const report = await combineBackends([{ id: 'up', store: up, label: 'CI' }, { id: 'lab', store: down, label: 'Device lab' }]);
    expect(report.notices.join(' ')).toContain('Device lab is unavailable');
    expect(report.backends.map(backend => [backend.id, backend.available])).toEqual([['lab', false], ['up', true]]);
    expect(report.summary.checks.total).toBeGreaterThan(0);
  });

  test('backend ids are unique and plain, because results are attributed to them', async () => {
    await expect(combineBackends([{ id: 'A b', store: memoryStore() }])).rejects.toThrow('Invalid report backend id');
    await expect(combineBackends([{ id: 'a', store: memoryStore() }, { id: 'a', store: memoryStore() }])).rejects.toThrow('Invalid report backend id');
  });

  test('leaving a layer out reveals the one before it', async () => {
    const store = memoryStore();
    const old = await publish(store, { producer: 'e2e', environment: 'ios', branch: 'main', sha: 'a'.repeat(40), recordedAtMs: 1, checks: [{ id: 'join', status: 'passed' }] });
    const fresh = await publish(store, { producer: 'e2e', environment: 'ios', branch: 'feat', sha: 'b'.repeat(40), recordedAtMs: 2, checks: [{ id: 'join', status: 'failed' }] });
    const status = async (include?: (id: string) => boolean) => (await combineBackends([{ id: 'one', store }], include ? { include: layer => include(layer.id) } : {})).summary.checks;
    expect(await status()).toMatchObject({ failed: 1, passed: 0 });
    expect(await status(id => id !== fresh.id)).toMatchObject({ failed: 0, passed: 1 });
    expect(old.id).not.toBe(fresh.id);
  });
});

describe('combineEvidence on its own', () => {
  const summary = (id: string): LayerSummary => ({ id, recordedAtMs: 5, producer: 'e2e', sha: null, branch: null, runUrl: null, parameters: {}, specs: [], source: null, recording: null, parts: [{ sha: '', id: 'e2e', kind: 'checks', title: 'e2e', recordedAtMs: 5, checks: [{ id: 'join', title: 'join', status: 'passed', detail: '', measurements: [] }] }] });
  const outline = { specs: [], sha: null, changedFiles: [] };

  test('one immutable layer held by two backends is one result, attributed the same way in every input order', () => {
    const id = 'a'.repeat(64);
    const copies = ['shared', 'local', 'lab'].map(backend => layerEvidence(summary(id), backend));
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0], [1, 0, 2]]) {
      const results = combineEvidence(outline, order.map(i => copies[i]!)).unassigned;
      expect(results.map(result => result.layer.backend)).toEqual(['lab']);
    }
  });

  test('two different mutable layers that share an address in different backends are both kept, and tie the same way in any order', () => {
    const a = layerEvidence(summary('source-x'), 'one');
    const b = layerEvidence({ ...summary('source-x'), parts: [{ ...summary('x').parts[0]!, checks: [{ id: 'join', title: 'join', status: 'failed', detail: '', measurements: [] }] }] }, 'two');
    for (const order of [[a, b], [b, a]]) {
      const results = combineEvidence(outline, order).unassigned;
      expect(results.map(result => [result.row.status, result.layer.backend])).toEqual([['failed', 'two']]);
    }
  });
});

describe('reports that are read and shown', () => {
  test('the failing list is in one order however layers were read', async () => {
    const stores = [memoryStore(), memoryStore(), memoryStore()];
    for (const [i, store] of stores.entries()) await publishChecks(store, { producer: `suite-${i}`, environment: 'ios', recordedAtMs: 5, checks: [{ id: 'join', title: 'join', status: 'failed', specPath: 'specs/x.feature' }] });
    const failing = async (order: number[]) => reportStatus(await combineBackends(order.map(i => ({ id: `n${i}`, store: stores[i]! })), { concurrency: 1 })).failing.map(item => [item.producer, item.backend]);
    const expected = await failing([0, 1, 2]);
    for (const order of [[2, 1, 0], [1, 2, 0], [1, 0, 2]]) expect(await failing(order)).toEqual(expected);
    expect(expected.length).toBe(3);
  });

  test('leaving a layer out also leaves out the specs only that layer knew', async () => {
    const store = memoryStore();
    const spec = (path: string) => ({ path, domain: 'd', kind: 'gherkin', title: path });
    await publishChecks(store, { producer: 'p', branch: 'main', recordedAtMs: 1, specs: [spec('specs/a.feature')], checks: [{ id: 'a', title: 'a', status: 'passed', specPath: 'specs/a.feature' }] });
    await publishChecks(store, { producer: 'p', branch: 'experiment', recordedAtMs: 2, specs: [spec('specs/a.feature'), spec('specs/only-on-experiment.feature')], checks: [{ id: 'a', title: 'a', status: 'passed', specPath: 'specs/a.feature' }] });
    const everything = await combineBackends([{ id: 'one', store }]);
    expect(everything.combined.specs.map(entry => entry.spec.path)).toEqual(['specs/a.feature', 'specs/only-on-experiment.feature']);
    const main = await combineBackends([{ id: 'one', store }], { include: layer => layer.branch === 'main' });
    expect(main.combined.specs.map(entry => entry.spec.path)).toEqual(['specs/a.feature']);
    expect(main.summary.specsWithoutEvidence).toEqual([]);
  });
});

describe('copying carries every catalog last, and every document after its files', () => {
  test('no catalog entry, of layers, spec sets or runs, is written before what it names', async () => {
    const from = memoryStore();
    await publishChecks(from, { producer: 'p', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed' }] });
    const { publishSpecSet } = await import('../src/spec-set');
    await publishSpecSet(from, { files: [{ path: 'specs/a.feature', text: 'Feature: A' }], branch: 'main', sha: null, recordedAtMs: 1 });
    await from.put('layers/runs/r1/manifest.json', new Uint8Array([1]), 'application/json');
    await from.put('layers/runs/index/0000000000000001-r1.json', new Uint8Array([1]), 'application/json');
    const order: string[] = [];
    const to = memoryStore();
    const recording = { ...to, put: async (key: string, bytes: Uint8Array, type: string) => { order.push(key); return to.put(key, bytes, type); } };
    await copyStore(from, recording as typeof to);
    const firstCatalog = order.findIndex(key => key.includes('/index/'));
    expect(firstCatalog).toBeGreaterThan(0);
    expect(order.slice(firstCatalog).every(key => key.includes('/index/'))).toBe(true);
    expect(order.filter(key => key.includes('/index/')).length).toBe(3);
  });

  test('a layer\'s manifest and a spec set come after the files they name, which a server that checks insists on', async () => {
    const from = memoryStore();
    for (let i = 0; i < 12; i++) await publishChecks(from, { producer: 'p', recordedAtMs: i + 1, checks: [{ id: 'a', title: 'a', status: 'passed', attachments: [{ name: `f${i}.txt`, data: new TextEncoder().encode(`file ${i}`.repeat(50)) }] }] });
    const { publishSpecSet } = await import('../src/spec-set');
    await publishSpecSet(from, { files: [{ path: 'specs/a.feature', text: 'Feature: A' }, { path: 'specs/b.feature', text: 'Feature: B' }], branch: 'main', sha: null, recordedAtMs: 1 });
    const order: string[] = [];
    const to = memoryStore();
    const recording = { ...to, put: async (key: string, bytes: Uint8Array, type: string) => { order.push(key); return to.put(key, bytes, type); } };
    await copyStore(from, recording as typeof to, { concurrency: 64 });
    const isDocument = (key: string) => /^layers\/(manifests|specs\/sets)\//.test(key);
    const firstDocument = order.findIndex(isDocument);
    expect(firstDocument).toBeGreaterThan(0);
    expect(order.slice(0, firstDocument).every(key => !key.includes('/index/') && !isDocument(key))).toBe(true);
    expect(order.slice(firstDocument).some(key => key.includes('/blobs/'))).toBe(false);
  });
});
