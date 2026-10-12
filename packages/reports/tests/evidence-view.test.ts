import { expect, test } from 'bun:test';
import { ALL_SOURCES, checkHistory, checkSlots, contributes, evidenceView, sourceFacets } from '../src/evidence-view';
import { combineEvidence, layerEvidence, textFingerprint } from '../src/layer-merge';
import type { LayerSummary, ReportOutline } from '../src/layer-types';

const spec = { path: 'specs/list.feature', title: 'List', domain: 'list', kind: 'feature', fingerprint: textFingerprint('Feature: List') };
const empty = { ...spec, path: 'specs/empty.feature', title: 'Empty' };
const outline: ReportOutline = { specs: [spec, empty], sha: 'a'.repeat(40), changedFiles: [] };
type Check = { id: string; status: 'passed' | 'failed' | 'running' | 'not-run'; kind?: string; specPath?: string };
function layer(id: string, at: number, checks: Check[], branch = 'main'): LayerSummary {
  const kinds = [...new Set(checks.map(check => check.kind ?? 'behavior'))];
  return { id, recordedAtMs: at, producer: 'list', sha: 'a'.repeat(40), branch, runUrl: null, parameters: {}, specs: [spec], source: null, recording: null,
    parts: kinds.map(kind => ({ sha: 'a'.repeat(40), id: `list-${kind}`, kind, title: kind, recordedAtMs: at,
      checks: checks.filter(check => (check.kind ?? 'behavior') === kind).map(check => ({ id: check.id, status: check.status, title: check.id, specPath: check.specPath ?? spec.path, detail: '', measurements: kind === 'performance' ? [{ name: 'Longest own action', value: 80, unit: 'ms', limit: 50 }] : [] })) })) };
}
function view(layers: readonly LayerSummary[], backend = 'local') {
  return evidenceView(combineEvidence(outline, layers.map(summary => layerEvidence(summary, backend))));
}

test('a recorded timing over its allowance qualifies a check and never fails it', () => {
  const report = view([layer('one', 1, [{ id: 'join', status: 'passed' }, { id: 'join', status: 'failed', kind: 'performance' }])]);
  const slot = report.specs.get(spec.path)!.slots[0]!;
  expect(slot.status).toBe('passed');
  expect(slot.outcomes).toHaveLength(1);
  expect(slot.diagnostics[0]!.row.measurements[0]).toMatchObject({ value: 80, limit: 50 });
  expect(slot.diagnostics[0]!.row.status).toBe('failed');
  expect(report.specs.get(spec.path)!.summary).toMatchObject({ status: 'passed', total: 1 });
});

test('a timing that nothing else checked is its own measured outcome', () => {
  const report = view([layer('one', 1, [{ id: 'paint', status: 'failed', kind: 'performance' }])]);
  const slot = report.specs.get(spec.path)!.slots[0]!;
  expect(slot.status).toBe('failed');
  expect(slot.diagnostics).toEqual([]);
  expect(slot.outcomes[0]!.row.measurements).toHaveLength(1);
});

test('a spec without a recorded check has no outcome, and a layer counts only what it checked', () => {
  const summary = layer('one', 1, [{ id: 'join', status: 'passed' }, { id: 'join', status: 'failed', kind: 'performance' }, { id: 'leave', status: 'failed' }]);
  const report = view([summary]);
  expect(report.specs.get(empty.path)!.summary).toMatchObject({ status: 'none', total: 0, latestAtMs: null });
  expect(report.total).toMatchObject({ status: 'failed', total: 2 });
  expect(report.total.counts).toMatchObject({ passed: 1, failed: 1 });
  expect(layerEvidence(summary, 'local').layer.counts).toMatchObject({ passed: 1, failed: 1 });
});

test('a result for a spec outside the outline stays readable as unassigned', () => {
  const report = view([layer('one', 1, [{ id: 'gone', status: 'passed', specPath: 'specs/removed.feature' }])]);
  expect(report.unassigned.map(slot => slot.id)).toEqual(['gone']);
  expect(report.total.total).toBe(0);
});

test('leaving a branch, a backend or one layer out is how earlier evidence is read', () => {
  const layers = [layer('new', 2, [{ id: 'join', status: 'failed' }], 'feat/list'), layer('old', 1, [{ id: 'join', status: 'passed' }])].map(summary => layerEvidence(summary, summary.id === 'new' ? 'local' : 'shared'));
  const headers = layers.map(entry => entry.layer);
  expect(sourceFacets(headers).branches.map(facet => facet.id)).toEqual(['feat/list', 'main']);
  expect(sourceFacets(headers).backends.map(facet => [facet.id, facet.layers])).toEqual([['local', 1], ['shared', 1]]);
  const status = (excluded: typeof ALL_SOURCES) => checkSlots(combineEvidence(outline, layers.filter(entry => contributes(entry.layer, excluded))).specs[0]!.results)[0]?.status;
  expect(status(ALL_SOURCES)).toBe('failed');
  expect(status({ ...ALL_SOURCES, branches: ['feat/list'] })).toBe('passed');
  expect(status({ ...ALL_SOURCES, backends: ['local'] })).toBe('passed');
  expect(status({ ...ALL_SOURCES, layers: ['new'] })).toBe('passed');
  expect(status({ ...ALL_SOURCES, layers: ['new', 'old'] })).toBeUndefined();
});

test('a superseded result remains readable in its own layer', () => {
  const layers = [layer('new', 2, [{ id: 'join', status: 'failed' }, { id: 'join', status: 'failed', kind: 'performance' }], 'feat/list'), layer('old', 1, [{ id: 'join', status: 'passed' }, { id: 'leave', status: 'passed' }])].map(summary => layerEvidence(summary, 'local'));
  const history = checkHistory(layers, spec.path, 'join');
  expect(history.map(entry => [entry.layer.id, entry.layer.branch, entry.row.status, entry.row.kind])).toEqual([['new', 'feat/list', 'failed', 'behavior'], ['old', 'main', 'passed', 'behavior']]);
});
