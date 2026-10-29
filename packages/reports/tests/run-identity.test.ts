import { describe, expect, test } from 'bun:test';

import { parseLayerDocument } from '../../schema/src/layer';
import { layerExecutionKey } from '../src/layer-merge';
import { readLayer } from '../src/layer-store';
import { publishChecks } from '../src/publish-checks';
import { reportMain } from '../src/report-cli';
import { ReportIndex } from '../src/report-index';
import { runDetail, runKey, runList, runMarkdown, runsMarkdown, type RunSummary } from '../src/test-catalog';
import { memoryStore } from './memory-store';

const SHA = 'a'.repeat(40);
const where = { sha: SHA, branch: 'main', runUrl: null };
const pay = (status: 'passed' | 'failed', extra: Record<string, unknown> = {}) => ({ id: 'pay', title: 'Pay', specPath: 'specs/pay.feature', status, ...extra });
const find = (status: 'passed' | 'failed') => ({ id: 'find', title: 'Find', specPath: 'specs/find.feature', status });

async function runsOf(store: ReturnType<typeof memoryStore>) {
  const index = new ReportIndex([{ id: 'one', store }]);
  await index.refresh();
  return { index, runs: runList(index.history, 'v').runs };
}

describe('execution identity of a run', () => {
  test('1: two demo invocations at one branch and commit are two runs, each with its own timestamps and results', async () => {
    const store = memoryStore();
    await publishChecks(store, { ...where, producer: 'demo', recordedAtMs: 1_000, run: { id: 'demo-1', title: 'Morning demo' }, checks: [pay('failed', { detail: 'timed out' })] });
    await publishChecks(store, { ...where, producer: 'demo', recordedAtMs: 9_000, run: { id: 'demo-2' }, checks: [pay('passed')] });
    const { index, runs } = await runsOf(store);
    expect(runs.map(run => [run.key, run.runId, run.startedAtMs, run.counts.passed, run.counts.failed])).toEqual([
      ['run:demo-2', 'demo-2', 9_000, 1, 0],
      ['run:demo-1', 'demo-1', 1_000, 0, 1],
    ]);
    expect(runs.every(run => run.branch === 'main' && run.sha === SHA)).toBe(true);
    // The first run still tells what failed in it; the second run's pass did not rewrite it.
    expect(runDetail(index.history, 'v', 'run:demo-1')!.results.map(result => [result.status, result.detail])).toEqual([['failed', 'timed out']]);
    expect(runDetail(index.history, 'v', 'run:demo-2')!.results.map(result => result.status)).toEqual(['passed']);
    // The report as a whole is unchanged by the grouping: the newest completed result still wins the one slot.
    expect(index.snapshot().layers.map(item => item.rows.map(row => row.status))).toEqual([['passed']]);
  });

  test('1: the same invocations without ids keep their documented branch@sha grouping (they merge)', async () => {
    const store = memoryStore();
    await publishChecks(store, { ...where, producer: 'demo', recordedAtMs: 1_000, checks: [pay('failed')] });
    await publishChecks(store, { ...where, producer: 'demo', recordedAtMs: 9_000, checks: [pay('passed')] });
    const { runs } = await runsOf(store);
    expect(runs.map(run => [run.key, run.layers])).toEqual([[`main@${SHA}`, 2]]);
  });

  test('2: shards and batches that share an execution id are one run, with no duplicated checks', async () => {
    const store = memoryStore();
    const run = { id: 'demo-7', title: 'Release demo', startedAtMs: 500, endedAtMs: 12_000 };
    await publishChecks(store, { ...where, producer: 'web', environment: 'desktop-web', recordedAtMs: 1_000, run, checks: [pay('passed'), find('failed')] });
    await publishChecks(store, { ...where, producer: 'web', environment: 'desktop-web', recordedAtMs: 2_000, run, checks: [find('passed')] });
    await publishChecks(store, { ...where, producer: 'api', environment: 'api', recordedAtMs: 3_000, run, checks: [pay('passed')] });
    // The same upload twice is one layer.
    await publishChecks(store, { ...where, producer: 'api', environment: 'api', recordedAtMs: 3_000, run, checks: [pay('passed')] });
    const { index, runs } = await runsOf(store);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ key: 'run:demo-7', runId: 'demo-7', title: 'Release demo', layers: 3, producers: ['api', 'web'], environments: ['api', 'desktop-web'], startedAtMs: 500, endedAtMs: 12_000, spanMs: 11_500 });
    // Three slots (web/pay, web/find, api/pay): each counted once, find by its later pass.
    expect(runs[0]!.counts).toEqual({ passed: 3, failed: 0, running: 0, 'not-run': 0 });
    expect(runDetail(index.history, 'v', 'run:demo-7')!.results).toHaveLength(3);
  });

  test('2: the order shards arrive in does not change the run', async () => {
    const store = memoryStore();
    const run = { id: 'demo-7', title: 'First name' };
    await publishChecks(store, { ...where, producer: 'web', recordedAtMs: 1_000, run, checks: [pay('failed')] });
    await publishChecks(store, { ...where, producer: 'api', recordedAtMs: 2_000, run: { id: 'demo-7', title: 'Second name' }, checks: [find('passed')] });
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    const layers = index.snapshot().layers;
    const { TestHistory } = await import('../src/test-catalog');
    const forward = new TestHistory(), backward = new TestHistory();
    for (const item of layers) forward.add(item.layer, item.rows);
    for (const item of [...layers].reverse()) backward.add(item.layer, item.rows);
    expect(forward.runs()).toEqual(backward.runs());
    expect(forward.runs()[0]!.title).toBe('Second name');
  });

  test('3: the same execution id in two projects stays in each project', async () => {
    // A project is its own store: its history is never combined with another's.
    const alpha = memoryStore(), beta = memoryStore();
    await publishChecks(alpha, { ...where, producer: 'demo', recordedAtMs: 1_000, run: { id: 'shared' }, checks: [pay('failed')] });
    await publishChecks(beta, { ...where, producer: 'demo', recordedAtMs: 2_000, run: { id: 'shared' }, checks: [pay('passed')] });
    const a = await runsOf(alpha), b = await runsOf(beta);
    expect(a.runs).toHaveLength(1);
    expect(b.runs).toHaveLength(1);
    expect(a.runs[0]!.counts).toMatchObject({ failed: 1, passed: 0 });
    expect(b.runs[0]!.counts).toMatchObject({ failed: 0, passed: 1 });
  });

  test('4: a legacy layer with only a run URL, or only a branch and commit, is grouped and linked as before', async () => {
    const store = memoryStore();
    await publishChecks(store, { producer: 'ci', recordedAtMs: 1_000, sha: SHA, branch: 'main', runUrl: 'https://ci.example/runs/9', checks: [pay('passed')] });
    await publishChecks(store, { producer: 'ci', recordedAtMs: 2_000, sha: 'b'.repeat(40), branch: 'dev', runUrl: null, checks: [find('passed')] });
    const { runs } = await runsOf(store);
    expect(runs.map(run => [run.key, run.runUrl])).toEqual([[`dev@${'b'.repeat(40)}`, null], ['https://ci.example/runs/9', 'https://ci.example/runs/9']]);
    for (const run of runs) expect(run).not.toHaveProperty('runId');
    expect(runKey({ runUrl: 'https://ci/1', branch: 'main', sha: SHA })).toBe('https://ci/1');
    expect(runKey({ runUrl: null, branch: null, sha: null })).toBe('local');
  });

  test('4: an execution id wins the grouping but a CI run URL given beside it is still linked', async () => {
    const store = memoryStore();
    await publishChecks(store, { ...where, runUrl: 'https://ci.example/runs/3', producer: 'ci', recordedAtMs: 1_000, run: { id: 'nightly' }, checks: [pay('passed')] });
    const { runs } = await runsOf(store);
    expect(runs[0]).toMatchObject({ key: 'run:nightly', runUrl: 'https://ci.example/runs/3' });
  });

  test('5: a locally modified run says so beside its commit, and a title cannot hide it', async () => {
    const store = memoryStore();
    await publishChecks(store, { ...where, producer: 'demo', recordedAtMs: 1_000, freshness: 'modified', run: { id: 'demo-1', title: 'Clean release build' }, checks: [pay('passed')] });
    await publishChecks(store, { ...where, producer: 'api', recordedAtMs: 2_000, run: { id: 'demo-1' }, checks: [find('passed')] });
    await publishChecks(store, { ...where, producer: 'demo', recordedAtMs: 3_000, run: { id: 'demo-2' }, checks: [pay('passed')] });
    const { index, runs } = await runsOf(store);
    const byKey = Object.fromEntries(runs.map(run => [run.key, run]));
    // One modified layer qualifies the whole run, even though the newest layer is clean.
    expect(byKey['run:demo-1']).toMatchObject({ title: 'Clean release build', freshness: 'modified', sha: SHA });
    expect(byKey['run:demo-2']).not.toHaveProperty('freshness');
    const list = { schemaVersion: 1 as const, version: 'v', total: runs.length, runs };
    expect(runsMarkdown(list)).toContain(`${SHA.slice(0, 10)} (modified: local changes)`);
    expect(runMarkdown(runDetail(index.history, 'v', 'run:demo-1')!)).toContain(`commit ${SHA} (modified: local changes)`);
    // A legacy run is qualified the same way.
    const legacy = memoryStore();
    await publishChecks(legacy, { ...where, producer: 'demo', recordedAtMs: 1_000, freshness: 'unknown', checks: [pay('passed')] });
    expect((await runsOf(legacy)).runs[0]!.freshness).toBe('unknown');
  });

  test('6: renaming a run (a layer with its id and another title) changes the title and nothing else', async () => {
    const store = memoryStore();
    await publishChecks(store, { ...where, producer: 'demo', recordedAtMs: 1_000, run: { id: 'demo-1', title: 'Draft' }, checks: [pay('failed', { detail: 'boom' })] });
    const before = await runsOf(store);
    const stripped = (run: RunSummary) => { const { title: _title, layers: _layers, tags: _tags, ...rest } = run; return rest; };
    // The rename is a later layer of the same execution: it names a title and a tag, and records no result.
    await publishChecks(store, { ...where, producer: 'demo', recordedAtMs: 1_500, run: { id: 'demo-1', title: 'Customer demo' }, tags: ['demo'], checks: [] });
    const after = await runsOf(store);
    expect(after.runs).toHaveLength(1);
    expect(after.runs[0]!.title).toBe('Customer demo');
    expect(after.runs[0]!.key).toBe('run:demo-1');
    expect({ ...stripped(after.runs[0]!), endedAtMs: 0, spanMs: 0 }).toEqual({ ...stripped(before.runs[0]!), endedAtMs: 0, spanMs: 0 });
    expect(runDetail(after.index.history, 'v', 'run:demo-1')!.results.map(result => [result.status, result.detail])).toEqual([['failed', 'boom']]);
    // The recorded result is the same layer, byte for byte.
    expect(after.index.snapshot().layers.find(item => item.layer.producer === 'demo' && item.rows.length)!.layer.id)
      .toBe(before.index.snapshot().layers[0]!.layer.id);
  });
});

describe('the run in the layer document', () => {
  test('survives publishing and reading back, and changes the layer only when present', async () => {
    const store = memoryStore();
    const run = { id: 'demo-1', title: 'Demo', startedAtMs: 1, endedAtMs: 2, extra: { kept: true } };
    const named = await publishChecks(store, { ...where, producer: 'demo', recordedAtMs: 1_000, run, checks: [pay('passed')] });
    const plain = await publishChecks(store, { ...where, producer: 'demo', recordedAtMs: 1_000, checks: [pay('passed')] });
    expect(named.id).not.toBe(plain.id);
    expect((await readLayer(store, named.id))!.run).toEqual(run);
    expect((await readLayer(store, plain.id))!).not.toHaveProperty('run');
    expect(layerExecutionKey(named)).not.toBe(layerExecutionKey(plain));
    // Without a run the key is what it has always been: four parts. A named run adds its id.
    expect(JSON.parse(layerExecutionKey(plain))).toHaveLength(4);
    expect(JSON.parse(layerExecutionKey(named)).at(-1)).toBe('demo-1');
  });

  test('a producer is refused an empty or oversized id, but a reader treats a malformed run as absent, never refusing the layer', async () => {
    const store = memoryStore();
    await expect(publishChecks(store, { producer: 'demo', recordedAtMs: 1, run: { id: '' }, checks: [] } as never)).rejects.toThrow();
    await expect(publishChecks(store, { producer: 'demo', recordedAtMs: 1, run: { id: 'x'.repeat(257) }, checks: [] })).rejects.toThrow();
    const layer = await publishChecks(store, { producer: 'demo', recordedAtMs: 1, run: { id: 'ok' }, checks: [pay('passed')] });
    const document = JSON.parse(JSON.stringify({ schemaVersion: 1, ...layer, run: { id: 7 } }));
    const parsed = parseLayerDocument(document);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.layer.run).toBeUndefined();
    expect(parsed.ok && parsed.layer.parts[0]!.checks[0]!.status).toBe('passed');
  });

  test('never decides a result: the winner of a slot is the same with or without execution ids', async () => {
    const withIds = memoryStore(), without = memoryStore();
    for (const [store, ids] of [[withIds, true], [without, false]] as const) {
      await publishChecks(store, { ...where, producer: 'demo', recordedAtMs: 1_000, ...(ids ? { run: { id: 'a' } } : {}), checks: [pay('failed')] });
      await publishChecks(store, { ...where, producer: 'demo', recordedAtMs: 2_000, ...(ids ? { run: { id: 'b' } } : {}), checks: [pay('passed')] });
    }
    const a = await runsOf(withIds), b = await runsOf(without);
    const winners = (index: ReportIndex) => index.snapshot().layers.map(item => item.rows.map(row => [row.id, row.status]));
    expect(winners(a.index)).toEqual([[['pay', 'passed']]]);
    expect(winners(a.index)).toEqual(winners(b.index));
    expect(a.index.stats().slots).toBe(b.index.stats().slots);
    expect(a.runs.reduce((sum, run) => sum + run.counts.passed, 0)).toBe(1);
    expect(b.runs.reduce((sum, run) => sum + run.counts.passed, 0)).toBe(1);
  });
});

describe('naming a run from the command line', () => {
  async function publishWith(argv: string[], env: Record<string, string> = {}) {
    const output: string[] = [];
    return { code: await reportMain(argv, { out: text => output.push(text), env: { ...env }, git: () => null, clock: () => 5_000 }), output: output.join('') };
  }

  test('rejects a title without an id, and reads the id from the environment', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = await mkdtemp(path.join(tmpdir(), 'atlas-run-'));
    const file = path.join(dir, 'checks.json');
    await writeFile(file, JSON.stringify({ producer: 'demo', recordedAtMs: 1_000, checks: [pay('passed')] }));
    const store = path.join(dir, 'store');
    await expect(publishWith(['publish', '--store', store, '--checks', file, '--run-title', 'Orphan'])).rejects.toThrow('--run-id');
    const flagged = await publishWith(['publish', '--store', store, '--checks', file, '--run-id', 'demo-1', '--run-title', 'Demo', '--run-started-at', '100', '--run-ended-at', '2026-01-01T00:00:00Z']);
    expect(flagged.code).toBe(0);
    const env = await publishWith(['publish', '--store', store, '--checks', file, '--recorded-at', '2000'], { ATLAS_RUN_ID: 'demo-2', ATLAS_RUN_TITLE: 'From env' });
    expect(env.code).toBe(0);
    const { openStore } = await import('../src/store-url');
    const opened = openStore(store, { base: dir, env: {} }).store;
    const index = new ReportIndex([{ id: 'one', store: opened }]);
    await index.refresh();
    const runs = runList(index.history, 'v').runs;
    expect(runs.map(run => [run.key, run.title])).toEqual([['run:demo-1', 'Demo'], ['run:demo-2', 'From env']]);
    // It declared it ended in 2026, so it ended after the run recorded at 2000.
    expect(runs[0]).toMatchObject({ startedAtMs: 100, endedAtMs: Date.parse('2026-01-01T00:00:00Z') });
  });
});
