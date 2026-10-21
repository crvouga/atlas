import { catalogModel, TestHistory } from '@crvouga/atlas/reports/test-catalog';
import type { LayerEvidence, LayerHeader, LayerRow } from '@crvouga/atlas/reports/evidence-types';
import { expect, test } from 'bun:test';

import { modelFromCatalog, withLiveProgress } from './catalog';
import { environmentStatuses, environmentTally, groupTests } from './groups';
import { explorerSearch, queryOf, toggled, values } from './search';
import { testCatalog } from '@crvouga/atlas/reports/test-catalog';
import type { EvidenceView } from '@crvouga/atlas/reports/evidence-view';

function layer(id: string, environment: string, at: number, rows: Partial<LayerRow>[]): LayerEvidence {
  const header: LayerHeader = {
    id: id.padEnd(64, '0'), backend: 'local', producer: `p-${environment}`, packageDir: null, recordedAtMs: at, sha: 'a', branch: 'main', environment, runUrl: `run-${at}`,
    parameters: {}, recording: null, live: false, counts: { passed: 0, failed: 0, running: 0, 'not-run': 0 }, execution: id
  };
  return {
    id: header.id,
    layer: header,
    fingerprints: {},
    rows: rows.map((row) => ({ kind: 'checks', id: 'x', title: 'X', status: 'passed', specPath: null, detail: '', measurements: [], testId: null, variant: {}, durationMs: null, ...row }))
  };
}

const LAYERS = [
  layer('a', 'api', 10, [
    { id: 'find', title: 'Find', status: 'failed', specPath: 'specs/support/find.feature', durationMs: 100 },
    { id: 'pay', title: 'Pay', status: 'passed', specPath: 'specs/billing/pay.feature', durationMs: 50 }
  ]),
  layer('b', 'desktop-web', 11, [{ id: 'find', title: 'Find', status: 'passed', specPath: 'specs/support/find.feature', durationMs: 900 }])
];

function model() {
  const history = new TestHistory();
  for (const entry of LAYERS) history.add(entry.layer, entry.rows);
  return catalogModel(LAYERS, { history });
}

test('groups by spec in domain order, and by environment with each test counted by how it went there', () => {
  const { tests } = testCatalog(model(), { limit: 100 });
  const bySpec = groupTests(tests, 'spec');
  expect(bySpec.map((group) => [group.parent, group.label])).toEqual([['billing', 'Pay'], ['support', 'Find']]);
  const byEnv = groupTests(tests, 'environment');
  const web = byEnv.find((group) => group.key === 'desktop-web')!;
  expect(web.counts).toMatchObject({ passed: 1, failed: 0 });
  expect(web.avgMs).toBe(900);
  expect(byEnv.find((group) => group.key === 'api')!.counts).toMatchObject({ passed: 1, failed: 1 });
  expect(environmentTally(tests, 'api').avgMs).toBe(75);
  expect(groupTests(tests, 'status').map((group) => group.key)).toEqual(['failed', 'passed']);
  const find = tests.find((test) => test.id === 'find')!;
  expect(environmentStatuses(find)).toEqual([{ environment: 'api', status: 'failed' }, { environment: 'desktop-web', status: 'passed' }]);
});

test('a server catalog is queried like a model built in the page', () => {
  const built = model();
  const read = modelFromCatalog(testCatalog(built, { limit: 20_000 }));
  expect(testCatalog(read, { q: 'billing' }).tests.map((test) => test.id)).toEqual(['pay']);
  expect(testCatalog(read, { environment: ['desktop-web'] }).tests.map((test) => test.id)).toEqual(['find']);
});

test('live progress shows a test as running without rewriting recorded results', () => {
  const built = model();
  const pay = built.tests.find((test) => test.id === 'pay')!;
  const view: EvidenceView = {
    specs: new Map(),
    unassigned: [
      { key: pay.key, id: 'pay', title: 'Pay', specPath: pay.specPath, status: 'running', outcomes: [], diagnostics: [], latestAtMs: 20, live: true },
      { key: JSON.stringify(['specs/new.feature', 'new']), id: 'new', title: 'New', specPath: 'specs/new.feature', status: 'running', outcomes: [], diagnostics: [], latestAtMs: 20, live: true }
    ],
    total: { status: 'none', counts: { passed: 0, failed: 0, running: 0, 'not-run': 0 }, total: 0, latestAtMs: 0 } as unknown as EvidenceView['total']
  };
  const live = withLiveProgress(built, view);
  expect(live.byKey.get(pay.key)?.status).toBe('running');
  expect(live.byKey.get(pay.key)?.outcomes).toEqual(pay.outcomes);
  expect(live.tests.map((test) => test.id).sort()).toEqual(['find', 'new', 'pay']);
  expect(live.summary.counts.running).toBe(2);
  expect(withLiveProgress(built, { ...view, unassigned: [] })).toBe(built);
});

test('the address keeps filters as comma-separated text and drops what it cannot read', () => {
  expect(explorerSearch({ q: 123, status: 'failed,flaky', group: 'nope', sort: 'slowest', test: ['specs/a.feature', 'a'] })).toEqual({
    q: '123', status: 'failed,flaky', sort: 'slowest', test: JSON.stringify(['specs/a.feature', 'a'])
  } as never);
  expect(values(' api, desktop-web ,')).toEqual(['api', 'desktop-web']);
  expect(toggled('api', 'ios')).toBe('api,ios');
  expect(toggled('api', 'api')).toBeUndefined();
  expect(queryOf({ env: 'api', status: 'failed' })).toMatchObject({ environment: ['api'], status: ['failed'], sort: 'spec' });
});
