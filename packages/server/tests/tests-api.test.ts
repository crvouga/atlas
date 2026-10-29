import { afterAll, describe, expect, test } from 'bun:test';

import { publishChecks } from '../../reports/src/publish-checks';
import { memoryStore } from '../../reports/tests/memory-store';
import { ArtifactListSchema, CatalogHealthSchema, RunDetailSchema, RunListSchema, TestCatalogSchema, TestHistorySchema, TestReliabilitySchema } from '../../schema/src/api';
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

describe('GET /api/reports/tests/reliability', () => {
  const key = JSON.stringify([PAY, `${PAY}#Pay with a card`]);
  const reliable = (node: Node, query = '') => get(node, `/api/reports/tests/reliability?key=${encodeURIComponent(key)}${query}`);

  test('counts independent executions, not the snapshots a run published', async () => {
    const { node } = await project();
    const document = TestReliabilitySchema.parse(await (await reliable(node)).json());
    // Desktop web published run A twice (a failure, then a pass): one execution, flagged as published again. The API run is a second.
    expect(document.eventual).toMatchObject({ executions: 2, passed: 2, failed: 0 });
    expect(document.snapshots).toBe(3);
    expect(document.executions.find(execution => execution.environment === 'desktop-web')).toMatchObject({ snapshots: 2, republished: true });
    expect(document.sample).toBe('insufficient');
    expect(document.notes.map(note => note.code)).toEqual(expect.arrayContaining(['insufficient-sample', 'selected-reruns', 'pooled-environments']));
  });

  test('a scope in the address selects the same executions each time, and the document can be read as Markdown', async () => {
    const { node } = await project();
    const api = TestReliabilitySchema.parse(await (await reliable(node, '&environment=api')).json());
    expect(api.eventual.executions).toBe(1);
    expect(api.outsideScope).toBe(1);
    expect(api.executions.map(execution => execution.environment)).toEqual(['api']);
    expect(TestReliabilitySchema.parse(await (await reliable(node, '&environment=api')).json())).toEqual(api);
    expect(await (await reliable(node, '&format=markdown')).text()).toContain('# Reliability');
    const etag = (await reliable(node)).headers.get('etag')!;
    expect((await get(node, `/api/reports/tests/reliability?key=${encodeURIComponent(key)}`, { 'if-none-match': etag })).status).toBe(304);
  });

  test('says what is wrong with a missing or unknown key', async () => {
    const { node } = await project();
    expect((await get(node, '/api/reports/tests/reliability')).status).toBe(400);
    expect((await get(node, `/api/reports/tests/reliability?key=${encodeURIComponent('["nope","nope"]')}`)).status).toBe(404);
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

describe('GET /api/reports/runs?recordings=', () => {
  test('filters runs by recording completeness over every run before the limit, with facet counts, and never reads a recording', async () => {
    const store = memoryStore();
    const movie = (name: string) => ({ name, role: 'video', contentType: 'video/webm', data: new TextEncoder().encode(name) });
    const expected = { recordingExpectation: 'required' as const };
    await publishChecks(store, { producer: 'web', runUrl: 'https://ci.example/runs/1', recordedAtMs: 1_000, checks: [{ id: 'a', title: 'A', status: 'passed', ...expected, attachments: [movie('a.webm')] }] });
    await publishChecks(store, { producer: 'web', runUrl: 'https://ci.example/runs/2', recordedAtMs: 2_000, checks: [{ id: 'a', title: 'A', status: 'passed', ...expected }] });
    await publishChecks(store, { producer: 'web', runUrl: 'https://ci.example/runs/3', recordedAtMs: 3_000, checks: [{ id: 'a', title: 'A', status: 'passed' }] });
    const node = createNode({ stores: [{ id: 'main', label: 'Main', store }], refreshMs: 60_000 });
    nodes.push(node);
    await node.ready;
    const runs = async (query: string) => RunListSchema.parse(await (await get(node, `/api/reports/runs${query}`)).json());
    const all = await runs('');
    expect(Object.fromEntries(all.runs.map(run => [run.key.slice(-1), run.recordings?.state]))).toEqual({ 1: 'complete', 2: 'incomplete', 3: undefined });
    expect(all.facets!.recordings).toEqual(expect.arrayContaining([{ value: 'complete', count: 1 }, { value: 'incomplete', count: 1 }, { value: 'unknown', count: 1 }]));
    // The incomplete run is found though a newer run comes first, and it is still a green run.
    const gaps = await runs('?recordings=incomplete&limit=1');
    expect(gaps.filters).toContain('recordings');
    expect(gaps.total).toBe(1);
    expect(gaps.runs.map(run => [run.key.slice(-1), run.counts.passed, run.recordings])).toEqual([['2', 1, expect.objectContaining({ state: 'incomplete', expected: 1, published: 0, unresolved: 1 })]]);
    // Old runs with no receipt are Unknown, never Complete; values combine with OR.
    expect((await runs('?recordings=unknown')).runs.map(run => run.key.slice(-1))).toEqual(['3']);
    expect((await runs('?recordings=complete,unknown')).runs.map(run => run.key.slice(-1))).toEqual(['3', '1']);
    // A different dimension combines with AND.
    expect((await runs('?recordings=complete&outcome=failed')).total).toBe(0);
    // Recorded results are not asked about it: the artifacts list neither filters by it nor claims to.
    const artifacts = ArtifactListSchema.parse(await (await get(node, '/api/reports/artifacts?recordings=complete')).json());
    expect(artifacts.filters).not.toContain('recordings');
    expect(artifacts.total).toBeGreaterThan(0);
  });
});

describe('GET /api/reports/tests/health', () => {
  /** Results published under `checkout/cart.feature` while the specs are recorded under `specs/`. */
  async function drifted() {
    const store = memoryStore();
    const specs = [{ path: 'specs/checkout/cart.feature', domain: 'checkout', kind: 'feature', title: 'Cart' }];
    await publishChecks(store, { producer: 'gherkin-web', environment: 'desktop-web', recordedAtMs: 1_000, specs, checks: [{ id: 'add', title: 'add', status: 'passed', specPath: 'checkout/cart.feature' }] });
    const node = createNode({ stores: [{ id: 'main', label: 'Main', store }], refreshMs: 60_000 });
    nodes.push(node);
    await node.ready;
    return node;
  }

  test('reports the ambiguity, and joins the paths once a root mapping is declared', async () => {
    const node = await drifted();
    const before = CatalogHealthSchema.parse(await (await get(node, '/api/reports/tests/health')).json());
    expect(before.ok).toBe(false);
    expect(before.findings.map(item => item.code)).toContain('ambiguous-spec-path');
    expect(before.counts.specs).toMatchObject({ files: 1, withTests: 1, withoutExecution: 1 });
    const after = CatalogHealthSchema.parse(await (await get(node, `/api/reports/tests/health?root=${encodeURIComponent('>specs/')}`)).json());
    expect(after.findings.map(item => item.code)).not.toContain('ambiguous-spec-path');
    expect(after.aliases).toEqual([{ path: 'specs/checkout/cart.feature', sources: ['checkout/cart.feature', 'specs/checkout/cart.feature'] }]);
    expect(after.counts.specs).toMatchObject({ files: 1, defined: 1, withTests: 1, executed: 1, withoutExecution: 0 });
  });

  test('answers Markdown and is revalidated by ETag', async () => {
    const node = await drifted();
    const response = await get(node, '/api/reports/tests/health?format=markdown');
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(await response.text()).toContain('# Catalog health');
    const json = await get(node, '/api/reports/tests/health');
    expect((await get(node, '/api/reports/tests/health', { 'if-none-match': json.headers.get('etag')! })).status).toBe(304);
  });
});

describe('filtering runs and artifacts', () => {
  /** Demo videos by two producers on two environments, a tagged screenshot, and a later untagged recording. */
  async function demos() {
    const store = memoryStore();
    const movie = (name: string, text: string, extra: Record<string, unknown> = {}) => ({ name, contentType: 'video/webm', data: new TextEncoder().encode(text), ...extra });
    const specs = [{ path: PAY, domain: 'checkout', kind: 'feature', title: 'Pay for an order' }];
    const card = { id: 'pay', title: 'Pay with a card', specPath: PAY };
    await publishChecks(store, { producer: 'Demo-Recorder', environment: 'ios', branch: 'main', sha: 'a'.repeat(40), runUrl: RUN_A, recordedAtMs: 1_000, specs, checks: [{ ...card, status: 'failed', labels: { device: 'iPhone' }, attachments: [movie('a.webm', 'one', { tags: ['#Demo'] })] }] });
    await publishChecks(store, { producer: 'checkout-demos', environment: 'desktop-web', branch: 'main', sha: 'b'.repeat(40), runUrl: RUN_B, recordedAtMs: 2_000, specs, checks: [{ ...card, status: 'passed', attachments: [movie('b.webm', 'two', { tags: ['demo'] })] }] });
    await publishChecks(store, { producer: 'Demo-Recorder', environment: 'ios', branch: 'main', sha: 'c'.repeat(40), runUrl: 'https://ci.example/runs/3', recordedAtMs: 3_000, specs, checks: [{ ...card, status: 'passed', labels: { device: 'iPhone' }, attachments: [movie('c.webm', 'three')] }] });
    const node = createNode({ stores: [{ id: 'main', label: 'Main', store }], refreshMs: 60_000 });
    nodes.push(node);
    await node.ready;
    return node;
  }

  test('GET /api/reports/artifacts finds tagged videos across producers, ANDs the dimensions and encodes tag values safely', async () => {
    const node = await demos();
    const all = ArtifactListSchema.parse(await (await get(node, '/api/reports/artifacts?artifactTag=%23Demo&type=video')).json());
    expect(all.results.map(result => result.producer).sort()).toEqual(['Demo-Recorder', 'checkout-demos']);
    expect(all.filters).toEqual(['artifactTag', 'type']);
    const ios = ArtifactListSchema.parse(await (await get(node, '/api/reports/artifacts?artifactTag=demo&type=video&environment=ios&label=device%3DiPhone&domain=checkout')).json());
    expect(ios.results).toHaveLength(1);
    expect(ios.results[0]).toMatchObject({ status: 'failed', run: RUN_A, sha: 'a'.repeat(40), domain: 'checkout' });
    // The label still applies to the environment facet, so only the iPhone's environment is offered.
    expect(ios.facets.environments).toEqual([{ value: 'ios', count: 1 }]);
    // A tag with a comma, a space and a hash is one value when its comma is escaped, and matches nothing here.
    const odd = ArtifactListSchema.parse(await (await get(node, `/api/reports/artifacts?artifactTag=${encodeURIComponent('#release\\, candidate')}`)).json());
    expect(odd.total).toBe(0);
    expect(await (await get(node, '/api/reports/artifacts?artifactTag=demo&format=markdown')).text()).toContain('# Artifacts (2 of 2)');
  });

  test('GET /api/reports/runs applies the same filters before the limit and names the ones it applied', async () => {
    const node = await demos();
    const filtered = RunListSchema.parse(await (await get(node, '/api/reports/runs?artifactTag=demo&type=video&limit=1')).json());
    expect(filtered.total).toBe(2);
    expect(filtered.runs.map(run => run.key)).toEqual([RUN_B]);
    expect(filtered.filters).toEqual(['artifactTag', 'type']);
    const failed = RunListSchema.parse(await (await get(node, '/api/reports/runs?outcome=failed&environment=ios')).json());
    expect(failed.runs.map(run => run.key)).toEqual([RUN_A]);
    expect(failed.facets!.artifactTags).toEqual([{ value: 'demo', count: 1 }]);
    expect(RunListSchema.parse(await (await get(node, '/api/reports/runs')).json()).filters).toEqual([]);
  });
});

describe('GET /api/reports/tests?scope=', () => {
  async function recorded() {
    const store = memoryStore();
    const clip = (name: string, scope?: Record<string, unknown>) => ({ name, contentType: 'video/webm', data: new TextEncoder().encode(name), ...(scope ? { scope } : {}) });
    await publishChecks(store, {
      producer: 'mobile', environment: 'ios', recordedAtMs: 1_000, checks: [
        { id: 'sim', title: 'sim', status: 'passed', attachments: [clip('sim.webm', { deviceKind: 'simulator', audioCaptured: false })] },
        { id: 'phone', title: 'phone', status: 'passed', attachments: [clip('phone.webm', { deviceKind: 'physical', audioCaptured: true, verified: ['deviceKind'] })] },
        { id: 'bare', title: 'bare', status: 'passed', attachments: [clip('bare.webm')] },
      ]
    });
    const node = createNode({ stores: [{ id: 'main', label: 'Main', store }], refreshMs: 60_000 });
    nodes.push(node);
    await node.ready;
    return node;
  }
  const ids = async (node: Node, query: string) => TestCatalogSchema.parse(await (await get(node, `/api/reports/tests?${query}`)).json()).tests.map(test => test.id).sort();

  test('narrows to physical or audible evidence and never includes the unknown or the simulated', async () => {
    const node = await recorded();
    expect(await ids(node, 'scope=device:physical')).toEqual(['phone']);
    expect(await ids(node, 'scope=device:simulator')).toEqual(['sim']);
    expect(await ids(node, 'scope=audio:recorded')).toEqual(['phone']);
    expect(await ids(node, 'scope=unknown')).toEqual(['bare']);
    expect(await ids(node, 'scope=device:physical,audio:silent')).toEqual([]);
    expect(await ids(node, '')).toEqual(['bare', 'phone', 'sim']);
  });

  test('the document says what each recording declares', async () => {
    const node = await recorded();
    const catalog = TestCatalogSchema.parse(await (await get(node, '/api/reports/tests')).json());
    expect(catalog.tests.find(test => test.id === 'phone')!.scopeProfiles).toEqual([['device:physical', 'audio:recorded']]);
    expect(catalog.tests.find(test => test.id === 'bare')!.scopeProfiles).toEqual([['unknown']]);
    expect(catalog.facets.scopes!.map(item => item.value)).toContain('device:simulator');
    const detail = await (await get(node, '/api/reports/tests/history?key=' + encodeURIComponent(catalog.tests.find(test => test.id === 'phone')!.key))).json() as { test: { outcomes: { evidence: { videos: { scope: { verified: string[] } }[] } }[] } };
    expect(detail.test.outcomes[0]!.evidence.videos[0]!.scope.verified).toEqual(['deviceKind']);
  });
});
