import { expect, test } from 'bun:test';
import { normalizeEnvironment } from '../src/layer-axes';
import { combineEvidence, distinctLayers, layerEvidence, textFingerprint } from '../src/layer-merge';
import type { LayerSummary, ReportOutline } from '../src/layer-types';

const spec = { path: 'specs/list.feature', title: 'List', domain: 'list', kind: 'feature', fingerprint: textFingerprint('Feature: List') };
const outline: ReportOutline = { specs: [spec, { ...spec, path: 'specs/empty.feature' }], sha: 'b'.repeat(40), changedFiles: [] };
function layer(id: string, at: number, checks: { id: string; status: 'passed' | 'failed' | 'running' }[], device = 'phone'): LayerSummary {
  return { id, recordedAtMs: at, producer: 'list', sha: 'a'.repeat(40), branch: id, runUrl: null, parameters: { device }, specs: [spec], source: null, recording: null,
    parts: [{ sha: 'a'.repeat(40), id: 'list', kind: 'behavior', title: 'List', recordedAtMs: at, checks: checks.map(check => ({ ...check, title: check.id, specPath: spec.path, detail: '', measurements: [] })) }] };
}
function combine(current: ReportOutline, layers: readonly LayerSummary[]) {
  return combineEvidence(current, layers.map(summary => layerEvidence(summary, 'local')));
}
test('layers from different branches and commits fill the spec skeleton, preserving parameter variants and gaps', () => {
  const old = layer('older-branch', 1, [{ id: 'join', status: 'passed' }, { id: 'leave', status: 'failed' }]);
  const latest = { ...layer('newer-branch', 2, [{ id: 'join', status: 'failed' }]), sha: outline.sha };
  const tablet = layer('tablet', 3, [{ id: 'join', status: 'passed' }], 'tablet');
  const result = combine(outline, [latest, tablet, old]);
  expect(result.specs).toHaveLength(2);
  expect(result.specs[1]!.results).toEqual([]);
  expect(result.specs[0]!.results.map(result => [result.row.id, result.parameters.device, result.row.status]).sort()).toEqual([['join', 'phone', 'failed'], ['join', 'tablet', 'passed'], ['leave', 'phone', 'failed']]);
  expect(result.specs[0]!.results.find(result => result.row.id === 'leave')!.warning).toContain('Potentially outdated');
  expect(result.specs[0]!.results.find(result => result.row.id === 'leave')!.layer.branch).toBe('older-branch');
});
test('newer running evidence never erases completed evidence; equal-time conflicts fail regardless of input order', () => {
  const pass = layer('pass', 10, [{ id: 'join', status: 'passed' }]);
  const fail = layer('fail', 10, [{ id: 'join', status: 'failed' }]);
  const running = layer('running', 20, [{ id: 'join', status: 'running' }]);
  for (const order of [[pass, fail, running], [running, fail, pass], [fail, pass, running]]) expect(combine(outline, order).specs[0]!.results[0]!.row.status).toBe('failed');
});
test('changed specs and related code warn without deleting outcomes; missing fingerprints remain unknown', () => {
  const input = layer('one', 1, [{ id: 'join', status: 'passed' }]);
  const changed = { ...outline, specs: [{ ...spec, fingerprint: textFingerprint('Feature: Changed') }] };
  const result = combine(changed, [input]).specs[0]!.results[0]!;
  expect(result.warning).toBe('Potentially outdated: spec changed');
  expect(result.row.status).toBe('passed');
  expect(combine(outline, [{ ...input, specs: [] }]).specs[0]!.results[0]!.warning).toContain('Freshness unknown');
});
test('excluding a newer layer reveals older evidence; removed specs retain their evidence outside the outline', () => {
  const old = layer('old', 1, [{ id: 'join', status: 'passed' }]);
  expect(combine(outline, [old]).specs[0]!.results[0]!.row.status).toBe('passed');
  expect(combine({ ...outline, specs: [] }, [old]).unassigned).toHaveLength(1);
});

test('archived parameterized execution suppresses its historical address without hiding another run', () => {
  const archived = layer('a'.repeat(64), 1, [{ id: 'join', status: 'passed' }]);
  const historical = { ...archived, id: 'source-old', parameters: {} };
  const another = layer('b'.repeat(64), 1, [{ id: 'join', status: 'passed' }], 'tablet');
  expect(distinctLayers([historical, archived, another])).toEqual([archived, another]);
  expect(combine(outline, [historical, archived, another]).specs[0]!.results).toHaveLength(2);
});

test('environment names the known clients and keeps any other recorded name', () => {
  expect(normalizeEnvironment('Desktop Web')).toBe('desktop-web');
  expect(normalizeEnvironment('iOS')).toBe('ios');
  expect(normalizeEnvironment('Android')).toBe('android');
  expect(normalizeEnvironment('mobile browser')).toBe('mobile-web');
  expect(normalizeEnvironment('  ')).toBeNull();
  expect(normalizeEnvironment('tv')).toBe('tv');
});

test('a focused layer fills one environment and leaves every other check in place', () => {
  const desktop = { ...layer('desktop', 1, [{ id: 'join', status: 'passed' }, { id: 'leave', status: 'passed' }]), environment: 'desktop web', parameters: {} };
  const again = { ...layer('desktop-again', 3, [{ id: 'join', status: 'failed' }]), environment: 'desktop-web', parameters: {}, sha: 'c'.repeat(40) };
  const ios = { ...layer('ios', 2, [{ id: 'join', status: 'passed' }]), environment: 'iOS', parameters: {}, sha: 'd'.repeat(40) };
  const named = { ...layer('phone', 4, [{ id: 'join', status: 'passed' }]), parameters: { environment: 'Android', device: 'phone' } };
  const result = combine(outline, [desktop, ios, again, named]);
  const shown = result.specs[0]!.results.map(item => [item.row.id, item.layer.environment, item.parameters.device ?? '', item.row.status]);
  expect(shown.sort()).toEqual([
    ['join', 'android', 'phone', 'passed'],
    ['join', 'desktop-web', '', 'failed'],
    ['join', 'ios', '', 'passed'],
    ['leave', 'desktop-web', '', 'passed'],
  ]);
  expect(result.specs[0]!.results.find(item => item.layer.environment === 'desktop-web' && item.row.id === 'join')!.layer.sha).toBe('c'.repeat(40));
});

test('modified and unknown origins contribute outcomes without claiming freshness', () => {
  const input = { ...layer('local', 1, [{ id: 'join', status: 'passed' }]), sha: outline.sha };
  for (const freshness of ['modified', 'unknown'] as const) {
    const result = combine(outline, [{ ...input, freshness }]).specs[0]!.results[0]!;
    expect(result.row.status).toBe('passed');
    expect(result.warning).toContain(freshness === 'modified' ? 'modified checkout' : 'origin was not captured');
  }
});
