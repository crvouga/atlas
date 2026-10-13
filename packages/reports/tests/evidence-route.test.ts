import { expect, test } from 'bun:test';
import type { EvidencePage, LayerRows } from '../src/evidence-types';
import { recordingPaths } from '../src/evidence-types';
import { evidenceFile, exportEvidence } from '../src/export-evidence';
import { publishLayerBundle } from '../src/layer-store';
import type { LayerSummary } from '../src/layer-types';
import { readUtf8, writeUtf8 } from '../src/object-io';
import type { ObjectStore } from '../src/object-store';
import { createReportsApp } from '../src/reports-route';
import type { RunReport } from '../src/report-types';
import { memoryStore, testClock } from './memory-store';

const SHA = 'a'.repeat(40);
function summary(producer: string, at: number, status: 'passed' | 'failed', branch = 'main'): Omit<LayerSummary, 'id'> {
  return { producer, recordedAtMs: at, sha: SHA, branch, runUrl: null, parameters: {}, specs: [], source: null, recording: null,
    parts: [{ sha: SHA, id: producer, kind: 'behavior', title: producer, recordedAtMs: at, checks: [{ id: 'join', title: 'Join', status, detail: '', specPath: 'specs/list.feature', measurements: [] }] }] };
}
async function page(app: { request: (path: string) => Response | Promise<Response> }, path = '/evidence') {
  const response = await app.request(path);
  expect(response.status).toBe(200);
  return (await response.json()) as EvidencePage;
}
function report(testId: string, status: 'passed' | 'failed'): RunReport {
  return { meta: { testId, runId: 'latest', title: `List: ${testId}`, system: 'list', runtime: 'gherkin', seed: testId, status, actorIds: [], startedAtMs: 0, endedAtMs: 1, durationMs: 1, sourceFile: 'specs/list.feature' }, steps: [] };
}
async function finish(bucket: ObjectStore, testId: string, status: 'passed' | 'failed') {
  await writeUtf8(bucket, `runs/latest/tests/${testId}/report.json`, JSON.stringify(report(testId, status)), 'application/json');
}

test('every backend contributes layers that name where they came from, and each layer is read once', async () => {
  const localStore = memoryStore(), store = memoryStore(), lab = memoryStore();
  const local = await publishLayerBundle(localStore, summary('list', 30, 'failed', 'feat/list'), {});
  const shared = await publishLayerBundle(store, summary('list', 20, 'passed'), {});
  const device = await publishLayerBundle(lab, summary('tablet', 10, 'passed'), {});
  const app = createReportsApp({ store, localStore, backends: [{ id: 'device-lab', label: 'Device lab', store: lab }], ...testClock() });
  const first = await page(app);
  expect(first.layers.map(layer => [layer.id, layer.backend, layer.branch, layer.counts.failed])).toEqual([[local.id, 'local', 'feat/list', 1], [shared.id, 'shared', 'main', 0], [device.id, 'device-lab', 'main', 0]]);
  expect(first.backends).toEqual([{ id: 'local', label: 'This machine', live: true, available: true }, { id: 'shared', label: 'Shared reports', live: false, available: true }, { id: 'device-lab', label: 'Device lab', live: false, available: true }]);
  const rows = await app.request(`/evidence/rows/device-lab/${device.id}`);
  expect(rows.headers.get('cache-control')).toContain('immutable');
  expect(((await rows.json()) as LayerRows).rows.map(row => [row.id, row.status, row.specPath])).toEqual([['join', 'passed', 'specs/list.feature']]);
  expect((await app.request(`/evidence/rows/shared/${device.id}`)).status).toBe(404);
  expect((await app.request(`/evidence/rows/nowhere/${device.id}`)).status).toBe(404);
});

test('an unavailable backend is named, keeps the others usable, and returns when asked again', async () => {
  const localStore = memoryStore(), store = memoryStore();
  await publishLayerBundle(localStore, summary('list', 30, 'passed'), {});
  await publishLayerBundle(store, summary('list', 20, 'passed'), {});
  store.down = true;
  const time = testClock();
  const app = createReportsApp({ store, localStore, ...time });
  const failed = await page(app);
  expect(failed.layers.map(layer => layer.backend)).toEqual(['local']);
  expect(failed.backends.find(backend => backend.id === 'shared')!.available).toBe(false);
  expect(failed.notices).toEqual(['Shared reports is unavailable. Layers already loaded remain usable.']);
  store.down = false;
  expect((await page(app)).layers).toHaveLength(1);
  const restored = await page(app, '/evidence?retry=1');
  expect(restored.layers.map(layer => layer.backend)).toEqual(['local', 'shared']);
  expect(restored.notices).toEqual([]);
});

test('a running suite shows each finished test at once, and stays until its layer is collected', async () => {
  const localStore = memoryStore(), bucket = memoryStore();
  const time = testClock();
  const run = { packageDir: 'libs/list-harness', bucket: 'all', startedAtMs: time.clock.at, plannedChecks: 2 };
  await writeUtf8(localStore, 'active/libs--list-harness-all.json', JSON.stringify(run), 'application/json');
  const app = createReportsApp({ store: null, localStore, live: { bucket: () => bucket, origin: async () => ({ sha: SHA, branch: 'feat/list' }), frameCss: async () => 'button{color:red}' }, ...time });
  expect(await page(app)).toMatchObject({ layers: [], active: [{ source: 'libs-list-harness--all', completed: 0, failed: 0, plannedChecks: 2 }] });
  await finish(bucket, 'join', 'passed');
  await writeUtf8(bucket, 'runs/latest/tests/half-written/report.json', '{"meta":', 'application/json');
  time.clock.at += 2_000;
  const one = await page(app);
  expect(one.active[0]).toMatchObject({ completed: 1, failed: 0 });
  expect(one.layers).toHaveLength(1);
  const live = one.layers[0]!;
  expect(live).toMatchObject({ id: 'live-libs-list-harness--all', backend: 'local', live: true, branch: 'feat/list', sha: SHA, recording: { type: 'live', source: 'libs-list-harness--all' } });
  await finish(bucket, 'leave', 'failed');
  time.clock.at += 2_000;
  const two = await page(app);
  expect(two.active[0]).toMatchObject({ completed: 2, failed: 1 });
  expect(two.layers[0]!.execution).not.toBe(live.execution);
  const rows = (await (await app.request(`/evidence/rows/local/${live.id}`)).json()) as LayerRows;
  expect(rows.rows.map(row => [row.testId, row.status, row.specPath])).toEqual([['join', 'passed', 'specs/list.feature'], ['leave', 'failed', 'specs/list.feature']]);
  const paths = recordingPaths(live.recording!, 'leave');
  expect(((await (await app.request(paths.report)).json()) as RunReport).meta.title).toBe('List: leave');
  expect(await (await app.request(paths.css)).text()).toBe('button{color:red}');
  expect((await app.request(recordingPaths(live.recording!, 'absent').report)).status).toBe(404);

  // The suite ends before its layer is collected: what it recorded stays visible.
  await localStore.delete('active/libs--list-harness-all.json');
  time.clock.at += 2_000;
  const ended = await page(app);
  expect(ended.active).toEqual([]);
  expect(ended.layers.map(layer => layer.id)).toEqual([live.id]);
  const collected = await publishLayerBundle(localStore, summary('libs-list-harness--all', time.clock.at, 'failed', 'feat/list'), {});
  time.clock.at += 2_000;
  expect((await page(app)).layers.map(layer => layer.id)).toEqual([collected.id]);
});

test('a running suite on one environment stays beside a collected layer of another', async () => {
  const localStore = memoryStore(), bucket = memoryStore();
  const time = testClock();
  await writeUtf8(localStore, 'active/ios.json', JSON.stringify({ packageDir: 'libs/list-harness', bucket: 'all', startedAtMs: time.clock.at, environment: 'iOS' }), 'application/json');
  const app = createReportsApp({ store: null, localStore, live: { bucket: () => bucket, origin: async () => ({ sha: SHA, branch: 'main' }) }, ...time });
  await finish(bucket, 'join', 'failed');
  time.clock.at += 1_000;
  await publishLayerBundle(localStore, { ...summary('libs-list-harness--all', time.clock.at, 'passed'), environment: 'desktop-web' }, {});
  time.clock.at += 2_000;
  const shown = await page(app);
  expect(shown.layers.map(layer => [layer.environment, layer.live]).sort()).toEqual([['desktop-web', false], ['ios', true]]);
});

test('a suite nothing collects stops being shown as live', async () => {
  const localStore = memoryStore(), bucket = memoryStore();
  const time = testClock();
  await writeUtf8(localStore, 'active/list.json', JSON.stringify({ packageDir: 'libs/list-harness', bucket: 'all', startedAtMs: time.clock.at }), 'application/json');
  const app = createReportsApp({ store: null, localStore, live: { bucket: () => bucket }, ...time });
  await finish(bucket, 'join', 'passed');
  expect((await page(app)).layers).toHaveLength(1);
  await localStore.delete('active/list.json');
  time.clock.at += 2_000;
  expect((await page(app)).layers).toHaveLength(1);
  time.clock.at += 31_000;
  expect((await page(app)).layers).toEqual([]);
});

test('a static export holds the collected layers, their checks and their recordings, and no running suite', async () => {
  const localStore = memoryStore(), bucket = memoryStore(), target = memoryStore();
  const time = testClock();
  const base = summary('list', 30, 'passed');
  const stored = await publishLayerBundle(localStore, { ...base, recording: { type: 'layer' }, source: { source: 'list', packageDir: 'libs/list-harness', bucket: 'all', status: 'passed', updatedAtMs: 30, tests: [report('join', 'passed').meta] }, parts: [{ ...base.parts[0]!, checks: [{ ...base.parts[0]!.checks[0]!, id: 'list/join' }] }] }, {});
  await writeUtf8(localStore, 'active/list.json', JSON.stringify({ packageDir: 'libs/other-harness', bucket: 'all', startedAtMs: time.clock.at }), 'application/json');
  await finish(bucket, 'leave', 'passed');
  const app = createReportsApp({ store: null, localStore, live: { bucket: () => bucket }, ...time });
  const exported = await exportEvidence({ fetch: async path => app.request(path), target });
  expect(exported.layers).toBe(1);
  const index = JSON.parse((await readUtf8(target, evidenceFile('/evidence')))!) as EvidencePage;
  expect(index.layers.map(layer => layer.id)).toEqual([stored.id]);
  expect(index.active).toEqual([]);
  const rows = JSON.parse((await readUtf8(target, evidenceFile(`/evidence/rows/local/${stored.id}`)))!) as LayerRows;
  expect(rows.rows[0]).toMatchObject({ testId: 'join', variant: { runtime: 'gherkin' } });
  // The layer above has no bundle, so its recording is reported missing instead of invented.
  expect(exported.missing).toContain(recordingPaths({ type: 'layer', layer: stored.id }, 'join').report);
});
