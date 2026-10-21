import { describe, expect, test } from 'bun:test';

import type { LayerEvidence } from '../src/evidence-types';
import { layerEvidence } from '../src/layer-merge';
import { layerSummary, readLayer } from '../src/layer-store';
import { ReportIndex } from '../src/report-index';
import { catalogMarkdown, catalogModel, durationStats, formatMs, runKey, testCatalog, TestHistory, HISTORY_PER_TEST } from '../src/test-catalog';
import { memoryStore } from './memory-store';
import { plans, publish, random } from './plans';
import { publishChecks } from '../src/publish-checks';

const SEEDS = [1, 2, 3, 7, 42, 99];

/** Everything a history says, without the backend a layer happened to be read from. */
function described(history: TestHistory, keys: readonly string[]) {
  return {
    entries: keys.map(key => history.of(key).map(({ backend: _backend, ...entry }) => entry)),
    runs: history.runs(),
    details: history.runs().map(run => history.run(run.key)),
    specs: history.specs.entries(),
  };
}

describe('test history', () => {
  test.each(SEEDS)('seed %i: is the same whatever order layers arrive in', async seed => {
    const store = memoryStore();
    const layers: { evidence: LayerEvidence; specs: readonly { path: string; domain: string; kind: string; title: string }[] }[] = [];
    for (const plan of plans(seed, 80)) {
      const layer = await publish(store, plan);
      const summary = layerSummary((await readLayer(store, layer.id))!);
      layers.push({ evidence: layerEvidence(summary, 'one'), specs: summary.specs });
    }
    const keys = [...new Set(layers.flatMap(item => item.evidence.rows.map(row => JSON.stringify([row.specPath ?? '', row.id]))))];
    const r = random(seed * 7);
    let reference: ReturnType<typeof described> | null = null;
    for (let round = 0; round < 4; round++) {
      const history = new TestHistory();
      for (const { evidence, specs } of r.shuffle(layers)) history.add(evidence.layer, evidence.rows, specs);
      // A layer offered twice is one layer.
      history.add(layers[0]!.evidence.layer, layers[0]!.evidence.rows);
      const now = described(history, keys);
      if (reference) expect(now).toEqual(reference);
      else reference = now;
      expect(history.layers).toBe(layers.length);
    }
  });

  test('the server index keeps the same history as adding every layer directly', async () => {
    const store = memoryStore();
    const history = new TestHistory();
    for (const plan of plans(5, 50)) {
      const layer = await publish(store, plan);
      const summary = layerSummary((await readLayer(store, layer.id))!);
      const evidence = layerEvidence(summary, 'one');
      history.add(evidence.layer, evidence.rows, summary.specs);
    }
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    const keys = [...new Set(index.snapshot().layers.flatMap(item => item.rows.map(row => JSON.stringify([row.specPath ?? '', row.id]))))];
    expect(described(index.history, keys)).toEqual(described(history, keys));
  });

  test(`keeps the newest ${HISTORY_PER_TEST} results of a test`, async () => {
    const store = memoryStore();
    const index = new ReportIndex([{ id: 'one', store }]);
    for (let at = 1; at <= HISTORY_PER_TEST + 20; at++) await publishChecks(store, { producer: 'e2e', recordedAtMs: at, checks: [{ id: 'join', title: 'Join', status: 'passed', durationMs: at }] });
    await index.refresh();
    const entries = index.history.of(JSON.stringify(['', 'join']));
    expect(entries.length).toBe(HISTORY_PER_TEST);
    expect(entries[0]!.at).toBe(HISTORY_PER_TEST + 20);
    expect(entries.at(-1)!.at).toBe(21);
  });
});

describe('progress', () => {
  test('a result reported as running is not history, nor a run\'s last word', async () => {
    const store = memoryStore();
    const base = { producer: 'web', runUrl: 'https://ci/1' };
    await publishChecks(store, { ...base, recordedAtMs: 1, checks: [{ id: 'pay', title: 'Pay', status: 'running' }, { id: 'find', title: 'Find', status: 'running' }] });
    await publishChecks(store, { ...base, recordedAtMs: 2, checks: [{ id: 'pay', title: 'Pay', status: 'passed' }] });
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    expect(index.history.of(JSON.stringify(['', 'pay'])).map(entry => entry.status)).toEqual(['passed']);
    expect(index.history.of(JSON.stringify(['', 'find']))).toEqual([]);
    expect(index.history.runs()[0]!).toMatchObject({ layers: 2, tests: 1, counts: { passed: 1, failed: 0, running: 0, 'not-run': 0 } });
  });
});

describe('the catalog', () => {
  async function report() {
    const store = memoryStore();
    const index = new ReportIndex([{ id: 'one', store }]);
    const base = { producer: 'web', sha: 'a'.repeat(40), branch: 'main' };
    await publishChecks(store, { ...base, environment: 'desktop-web', recordedAtMs: 1, checks: [{ id: 'pay', title: 'Pay', status: 'passed', durationMs: 300, specPath: 'specs/checkout/pay.feature' }] });
    await publishChecks(store, { ...base, environment: 'mobile-web', recordedAtMs: 2, checks: [{ id: 'pay', title: 'Pay', status: 'failed', durationMs: 900, specPath: 'specs/checkout/pay.feature' }, { id: 'retry', title: 'Retried', status: 'passed', attempts: [{ index: 0, status: 'failed' }, { index: 1, status: 'passed' }] }] });
    await index.refresh();
    return catalogModel(index.snapshot().layers, { history: index.history, version: 'v', now: 10 });
  }

  test('counts an environment by how its own results went', async () => {
    const model = await report();
    expect(model.summary.counts.failed).toBe(1);
    const byName = Object.fromEntries(model.summary.environments.map(group => [group.name, group.counts]));
    expect(byName['desktop-web']).toMatchObject({ passed: 1, failed: 0 });
    expect(byName['mobile-web']).toMatchObject({ passed: 1, failed: 1 });
  });

  test('derives a spec from its path when no layer recorded it, and calls a retried pass flaky', async () => {
    const model = await report();
    const pay = model.tests.find(item => item.id === 'pay')!;
    expect(pay.spec).toEqual({ path: 'specs/checkout/pay.feature', title: 'Pay', domain: 'checkout', kind: 'feature' });
    expect(pay.stats.durations).toMatchObject({ avgMs: 600, lastMs: 900 });
    const retried = model.tests.find(item => item.id === 'retry')!;
    expect(retried.spec).toBeNull();
    expect(retried.stats.flakyReason).toBe('Passed only after a retry');
    expect(testCatalog(model, { status: ['flaky'] }).tests.map(item => item.id)).toEqual(['retry']);
    expect(testCatalog(model, { domain: ['(no spec)'] }).tests.map(item => item.id)).toEqual(['retry']);
    expect(catalogMarkdown(testCatalog(model))).toContain('| mobile-web | 2 | 1 | 1 | 0 | 0 |');
  });

  test('without a history, describes the current results only', async () => {
    const model = await report();
    const bare = catalogModel(model.tests.length ? (await (async () => { const store = memoryStore(); await publishChecks(store, { producer: 'p', recordedAtMs: 1, checks: [{ id: 'x', title: 'X', status: 'passed', durationMs: 5 }] }); const index = new ReportIndex([{ id: 'one', store }]); await index.refresh(); return index.snapshot().layers; })()) : []);
    expect(bare.summary.history).toBe(false);
    expect(bare.tests[0]!.stats).toMatchObject({ results: 1, passed: 1, passRate: 1 });
  });
});

describe('formatting', () => {
  test('durations read naturally and never say 60 seconds', () => {
    expect([formatMs(null), formatMs(850), formatMs(1234), formatMs(12_345), formatMs(119_600), formatMs(479_700)]).toEqual(['—', '850 ms', '1.23 s', '12.3 s', '2m 00s', '8m 00s']);
  });

  test('percentiles are of the sorted values, and the last is the newest', () => {
    expect(durationStats([30, 10, 20])).toEqual({ count: 3, totalMs: 60, avgMs: 20, p50Ms: 20, p95Ms: 30, minMs: 10, maxMs: 30, lastMs: 30 });
    expect(durationStats([])).toBeNull();
  });

  test('a run is its URL, else its branch and commit', () => {
    expect(runKey({ runUrl: 'https://ci/1', branch: 'main', sha: 'a' })).toBe('https://ci/1');
    expect(runKey({ runUrl: null, branch: 'main', sha: 'a' })).toBe('main@a');
    expect(runKey({ runUrl: null, branch: null, sha: null })).toBe('local');
  });
});
