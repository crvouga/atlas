import { afterAll, describe, expect, test } from 'bun:test';

import { publishChecks } from '../../reports/src/publish-checks';
import { memoryStore } from '../../reports/tests/memory-store';
import { RunDetailSchema, RunListSchema, TestCatalogSchema, TestHistorySchema } from '../../schema/src/api';
import { ReportStatusSchema } from '../../schema/src/layer';
import { createNode, type Node } from './node-compat';

const nodes: Node[] = [];
afterAll(() => nodes.forEach(node => node.close()));

const PAY = 'specs/checkout/pay.feature';
const FIND = 'specs/support/find.feature';
const RUN_A = 'https://ci.example/runs/1';
const RUN_B = 'https://ci.example/runs/2';

/**
 * A project shaped like the one that reported the bug: no spec set, two producers on two environments, every check
 * naming its spec and every layer recording the specs' titles and domains.
 */
async function project() {
  const store = memoryStore();
  const specs = [
    { path: PAY, domain: 'checkout', kind: 'feature', title: 'Pay for an order' },
    { path: FIND, domain: 'support', kind: 'feature', title: "Finding a person's trouble" },
  ];
  const card = { id: `${PAY}#Pay with a card`, title: 'Pay with a card', specPath: PAY };
  const find = { id: `${FIND}#Find by email`, title: 'Find by email', specPath: FIND };
  await publishChecks(store, { producer: 'gherkin-web', environment: 'desktop-web', branch: 'main', sha: 'a'.repeat(40), runUrl: RUN_A, recordedAtMs: 1_000, specs, checks: [{ ...card, status: 'failed', detail: 'Timed out waiting for the receipt', durationMs: 4_000 }] });
  await publishChecks(store, { producer: 'gherkin-web', environment: 'desktop-web', branch: 'main', sha: 'a'.repeat(40), runUrl: RUN_A, recordedAtMs: 2_000, specs, checks: [{ ...card, status: 'passed', durationMs: 2_000, labels: { browser: 'chromium', device: 'Desktop Chrome' } }] });
  await publishChecks(store, { producer: 'gherkin-api', environment: 'api', branch: 'feature/x', sha: 'b'.repeat(40), runUrl: RUN_B, recordedAtMs: 3_000, specs, checks: [{ ...card, status: 'passed', durationMs: 100 }, { ...find, status: 'not-run' }] });
  const node = createNode({ stores: [{ id: 'main', label: 'Main', store }], refreshMs: 60_000 });
  nodes.push(node);
  await node.ready;
  return { node, store };
}
const get = (node: Node, pathname: string, headers: Record<string, string> = {}) => node.fetch(new Request(`http://atlas${pathname}`, { headers }));

describe('without a published spec set', () => {
  test('the gate groups checks under the specs their layers recorded, not "No spec"', async () => {
    const { node } = await project();
    const status = ReportStatusSchema.parse(await (await get(node, '/api/status')).json());
    expect(status.specs.map(spec => [spec.path, spec.title, spec.kind])).toEqual([
      [PAY, 'Pay for an order', 'feature'],
      [FIND, "Finding a person's trouble", 'feature'],
    ]);
    expect(status.specs.some(spec => spec.kind === 'unassigned')).toBe(false);
  });

  test('the outline is the recorded specs', async () => {
    const { node } = await project();
    const outline = await (await get(node, '/api/reports/outline')).json() as { specs: { path: string; domain: string }[] };
    expect(outline.specs.map(spec => [spec.path, spec.domain])).toEqual([[PAY, 'checkout'], [FIND, 'support']]);
  });
});

describe('GET /api/reports/tests', () => {
  test('lists every test with its environments, history, durations and spec', async () => {
    const { node } = await project();
    const response = await get(node, '/api/reports/tests');
    expect(response.status).toBe(200);
    const catalog = TestCatalogSchema.parse(await response.json());
    expect(catalog.summary.tests).toBe(2);
    expect(catalog.summary.counts).toEqual({ passed: 1, failed: 0, running: 0, 'not-run': 1 });
    expect(catalog.summary.environments.map(group => [group.name, group.tests])).toEqual([['api', 2], ['desktop-web', 1]]);
    expect(catalog.summary.domains.map(group => group.name).sort()).toEqual(['checkout', 'support']);
    expect(catalog.summary.runs).toBe(2);
    const pay = catalog.tests.find(item => item.specPath === PAY)!;
    expect(pay.spec).toEqual({ path: PAY, title: 'Pay for an order', domain: 'checkout', kind: 'feature' });
    expect(pay.environments).toEqual(['api', 'desktop-web']);
    expect(pay.outcomes.map(outcome => [outcome.environment, outcome.status, outcome.durationMs])).toEqual([['api', 'passed', 100], ['desktop-web', 'passed', 2_000]]);
    expect(pay.stats.results).toBe(3);
    expect(pay.stats.passed).toBe(2);
    expect(pay.stats.failed).toBe(1);
    expect(pay.stats.flaky).toBe(true);
    expect(pay.stats.flakyReason).toBe('Passed and failed on the same commit');
    expect(pay.stats.durations).toMatchObject({ count: 3, minMs: 100, maxMs: 4_000, lastMs: 100 });
    expect(pay.stats.branches).toEqual(['feature/x', 'main']);
    expect(pay.labels).toEqual({ browser: 'chromium', device: 'Desktop Chrome' });
  });

  test('filters, searches, sorts and pages', async () => {
    const { node } = await project();
    const titles = async (query: string) => TestCatalogSchema.parse(await (await get(node, `/api/reports/tests?${query}`)).json()).tests.map(item => item.title);
    expect(await titles('environment=desktop-web')).toEqual(['Pay with a card']);
    expect(await titles('status=not-run')).toEqual(['Find by email']);
    expect(await titles('status=flaky')).toEqual(['Pay with a card']);
    expect(await titles('q=EMAIL%20find')).toEqual(['Find by email']);
    expect(await titles('domain=support')).toEqual(['Find by email']);
    expect(await titles(`spec=${encodeURIComponent(PAY)}`)).toEqual(['Pay with a card']);
    expect(await titles(`run=${encodeURIComponent(RUN_A)}`)).toEqual(['Pay with a card']);
    expect(await titles('sort=slowest')).toEqual(['Pay with a card', 'Find by email']);
    const page = TestCatalogSchema.parse(await (await get(node, '/api/reports/tests?limit=1&offset=1')).json());
    expect([page.total, page.tests.length, page.offset]).toEqual([2, 1, 1]);
  });

  test('answers Markdown for an agent, and is the same for a project-scoped address', async () => {
    const { node } = await project();
    const markdown = await (await get(node, '/api/reports/tests?format=markdown')).text();
    expect(markdown).toContain('# Tests');
    expect(markdown).toContain('| desktop-web | 1 | 1 | 0 | 0 | 0 |');
    expect(markdown).toContain('Pay with a card');
    const negotiated = await get(node, '/api/reports/tests', { accept: 'text/markdown' });
    expect(negotiated.headers.get('content-type')).toContain('text/markdown');
  });

  test('is revalidated by ETag and changes when a layer arrives, even one that wins nothing', async () => {
    const { node, store } = await project();
    const first = await get(node, '/api/reports/tests');
    const etag = first.headers.get('etag')!;
    expect((await get(node, '/api/reports/tests', { 'if-none-match': etag })).status).toBe(304);
    // An older result wins no slot, but it is history: the catalog's statistics change.
    await publishChecks(store, { producer: 'gherkin-api', environment: 'api', runUrl: RUN_B, recordedAtMs: 500, checks: [{ id: `${PAY}#Pay with a card`, title: 'Pay with a card', specPath: PAY, status: 'passed', durationMs: 50 }] });
    await node.index.refresh();
    const after = await get(node, '/api/reports/tests', { 'if-none-match': etag });
    expect(after.status).toBe(200);
    const pay = TestCatalogSchema.parse(await after.json()).tests.find(item => item.specPath === PAY)!;
    expect(pay.stats.results).toBe(4);
    expect(pay.outcomes.find(outcome => outcome.environment === 'api')!.durationMs).toBe(100);
  });
});

describe('GET /api/reports/tests/history', () => {
  test('holds every recorded result of one test, newest first', async () => {
    const { node } = await project();
    const key = JSON.stringify([PAY, `${PAY}#Pay with a card`]);
    const response = await get(node, `/api/reports/tests/history?key=${encodeURIComponent(key)}`);
    const document = TestHistorySchema.parse(await response.json());
    expect(document.test.key).toBe(key);
    expect(document.history.map(entry => [entry.at, entry.environment, entry.status, entry.run])).toEqual([
      [3_000, 'api', 'passed', RUN_B],
      [2_000, 'desktop-web', 'passed', RUN_A],
      [1_000, 'desktop-web', 'failed', RUN_A],
    ]);
    expect(document.history[2]!.detail).toBe('Timed out waiting for the receipt');
    expect(await (await get(node, `/api/reports/tests/history?key=${encodeURIComponent(key)}&format=markdown`)).text()).toContain('## History');
  });

  test('says what is wrong with a missing or unknown key', async () => {
    const { node } = await project();
    const missing = await get(node, '/api/reports/tests/history');
    expect(missing.status).toBe(400);
    expect(missing.headers.get('content-type')).toContain('application/problem+json');
    expect((await get(node, `/api/reports/tests/history?key=${encodeURIComponent('["nope","nope"]')}`)).status).toBe(404);
  });
});

describe('GET /api/reports/runs', () => {
  test('lists runs newest first with what each recorded, and one run in full', async () => {
    const { node } = await project();
    const list = RunListSchema.parse(await (await get(node, '/api/reports/runs')).json());
    expect(list.runs.map(run => [run.key, run.branch, run.environments, run.tests, run.layers])).toEqual([
      [RUN_B, 'feature/x', ['api'], 2, 1],
      [RUN_A, 'main', ['desktop-web'], 1, 2],
    ]);
    // A run's last word on a test is its newest completed result.
    expect(list.runs[1]!.counts).toEqual({ passed: 1, failed: 0, running: 0, 'not-run': 0 });
    expect(list.runs[1]!.spanMs).toBe(1_000);
    const detail = RunDetailSchema.parse(await (await get(node, `/api/reports/runs/detail?key=${encodeURIComponent(RUN_B)}`)).json());
    expect(detail.results.map(result => [result.title, result.status])).toEqual([['Find by email', 'not-run'], ['Pay with a card', 'passed']]);
    expect((await get(node, `/api/reports/runs/detail?key=nope`)).status).toBe(404);
    expect(await (await get(node, '/api/reports/runs?format=markdown')).text()).toContain('# Runs (2 of 2)');
  });
});

describe('GET /api/reports/runs?video=true', () => {
  test('lists only runs with a playable recording, counted over every run before the limit', async () => {
    const store = memoryStore();
    const movie = (name: string, text: string) => ({ name, contentType: 'video/webm', data: new TextEncoder().encode(text) });
    const check = { id: 'a', title: 'A', status: 'passed' as const };
    await publishChecks(store, { producer: 'web', runUrl: RUN_A, recordedAtMs: 1_000, checks: [{ ...check, attachments: [movie('a.webm', 'one')] }] });
    await publishChecks(store, { producer: 'web', runUrl: RUN_B, recordedAtMs: 2_000, checks: [check] });
    await publishChecks(store, { producer: 'web', runUrl: 'https://ci.example/runs/3', recordedAtMs: 3_000, checks: [{ ...check, attachments: [{ name: 'shot.png', contentType: 'image/png', data: new Uint8Array([1]) }] }] });
    const node = createNode({ stores: [{ id: 'main', label: 'Main', store }], refreshMs: 60_000 });
    nodes.push(node);
    await node.ready;
    const all = RunListSchema.parse(await (await get(node, '/api/reports/runs')).json());
    expect(all.total).toBe(3);
    expect(all.withVideo).toBe(1);
    expect(all.runs.find(run => run.key === RUN_A)!.videos).toEqual({ references: 1, recordings: 1, unavailable: 0 });
    expect(all.runs.find(run => run.key === RUN_B)!.videos).toBeUndefined();
    // Filtered before `limit`: the one match is found though two newer runs come first.
    const filtered = RunListSchema.parse(await (await get(node, '/api/reports/runs?video=true&limit=1')).json());
    expect(filtered.runs.map(run => run.key)).toEqual([RUN_A]);
    expect(filtered.total).toBe(1);
    expect(filtered.withVideo).toBe(1);
    expect(await (await get(node, '/api/reports/runs?video=true&format=markdown')).text()).toContain('# Runs (1 of 1)');
  });
});
