import type { LayerHeader, LayerRow } from '@crvouga/atlas/reports/evidence-types';
import type { CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import type { EvidenceResult } from '@crvouga/atlas/reports/layer-merge';
import { expect, test } from 'bun:test';

import {
  chronology,
  failedStep,
  failureNote,
  outcomeHeadline,
  passedAfterFailure,
  phaseOf,
  reachOf,
  recordOf,
  selectedResult,
  sourceLabels,
  type ResultRecord
} from './outcome';

const header = (id: string, at: number, extra: Partial<LayerHeader> = {}): LayerHeader => ({
  id, backend: 'b', producer: 'p', packageDir: null, recordedAtMs: at, sha: null, branch: null, environment: 'desktop-web', runUrl: null,
  parameters: {}, recording: null, live: false, counts: { passed: 0, failed: 0, running: 0, 'not-run': 0 }, execution: id, ...extra
});
const row = (status: LayerRow['status']): LayerRow => ({
  kind: 'checks', id: 'x', title: 'X', status, specPath: null, detail: '', measurements: [], testId: null, variant: {}, durationMs: null
});
const result = (id: string, status: LayerRow['status'], extra: Partial<LayerHeader> = {}): EvidenceResult => ({
  key: id, slot: 's', layer: header(id, 1, extra), parameters: {}, warning: null, row: row(status)
});
const slot = (status: CheckSlot['status'], outcomes: EvidenceResult[]): CheckSlot => ({
  key: 's', id: 'x', title: 'X', specPath: null, status, outcomes, diagnostics: [], latestAtMs: 1, live: false
});
const entry = (r: EvidenceResult) => ({ layer: r.layer, row: r.row });

test('the heading names the selected outcome before the other sources, and never reads it as the combined status', () => {
  const passed = result('a', 'passed');
  const failed = result('b', 'failed', { environment: 'api' });
  const both = slot('failed', [passed, failed]);
  expect(outcomeHeadline(entry(passed), both).text).toBe('Selected result passed; another scoped source failed');
  expect(outcomeHeadline(entry(failed), both).text).toBe('Selected result failed; the other scoped source: 1 passed');
  expect(outcomeHeadline(entry(passed), slot('passed', [passed])).text).toBe('Selected result passed');
  expect(outcomeHeadline(entry(result('c', 'running')), slot('running', [result('c', 'running')])).text).toBe('Selected result is still running');
  expect(outcomeHeadline(entry(passed), slot('failed', [passed, failed, result('d', 'failed')])).text).toContain('2 other scoped sources failed');
});

test('an earlier result says so and names what the combined report now shows', () => {
  const current = result('new', 'passed');
  const old = result('old', 'failed');
  const headline = outcomeHeadline(entry(old), slot('passed', [current]));
  expect(headline.current).toBe(false);
  expect(headline.text).toBe('This earlier result failed; the combined report now shows passed across its current source');
});

test('the selected result is the pinned run, else the named source, else the newest', () => {
  const a = result('a', 'passed');
  const b = result('b', 'failed');
  const both = slot('failed', [a, b]);
  expect(selectedResult(both)?.layer.id).toBe('a');
  expect(selectedResult(both, undefined, 'b')?.layer.id).toBe('b');
  expect(selectedResult(both, undefined, 'unknown')?.layer.id).toBe('a');
  expect(selectedResult(both, entry(b), 'a')?.layer.id).toBe('b');
  expect(selectedResult(slot('passed', []))).toBeUndefined();
});

test('sources that share a name are told apart by status, revision and their place among them', () => {
  const labels = sourceLabels(
    [result('a', 'passed', { sha: 'b'.repeat(40), producer: 'one' }), result('b', 'failed', { sha: 'a'.repeat(40), producer: 'two' }), result('c', 'passed', { environment: 'api' })],
    1_000
  );
  expect(labels.map((label) => label.text)).toEqual([
    'Desktop web · Passed · just now · bbbbbbb · result 1 of 2 from one',
    'Desktop web · Failed · just now · aaaaaaa · result 2 of 2 from two',
    'Api · Passed · just now · revision not recorded'
  ]);
});

test('the phase comes from the recorded kind, never from the wording', () => {
  expect(phaseOf('hook')).toBe('setup');
  expect(phaseOf('Given')).toBe('setup');
  expect(phaseOf('then')).toBe('behavior');
  expect(phaseOf('action')).toBe('unspecified');
  expect(phaseOf(undefined)).toBe('unspecified');
  const point = failedStep([{ name: 'setup failed to connect', status: 'failed', offsetMs: 0 }]);
  expect(point?.phase).toBe('unspecified');
  expect(reachOf(point).state).toBe('unknown');
  expect(reachOf(undefined).state).toBe('unknown');
  expect(reachOf(failedStep([{ name: 'Seed', kind: 'hook', status: 'failed' }])).state).toBe('setup-failed');
  expect(reachOf(failedStep([{ name: 'Check', kind: 'assertion', status: 'failed' }])).state).toBe('expectation-failed');
});

test('the failed step is the first innermost one in time order', () => {
  const point = failedStep([
    { id: 'late', name: 'Late', status: 'failed', offsetMs: 900 },
    { id: 'group', name: 'Group', status: 'failed', offsetMs: 100 },
    { id: 'leaf', parentId: 'group', name: 'Leaf', status: 'failed', offsetMs: 150, detail: 'nope' },
    { name: 'Fine', status: 'passed', offsetMs: 0 }
  ]);
  expect(point?.name).toBe('Leaf');
  expect(point?.detail).toBe('nope');
  expect(failedStep([{ name: 'ok', status: 'passed' }])).toBeUndefined();
  expect(failedStep(undefined)).toBeUndefined();
});

test('only a producer-declared failure is read, and only a known attribution counts', () => {
  expect(failureNote({ 'atlas.failure': { expected: 200, actual: { status: 500 }, attribution: 'environment' } })).toEqual({
    expected: '200',
    actual: '{"status":500}',
    attribution: 'environment'
  });
  expect(failureNote({ 'atlas.failure': { attribution: 'the intern' } })).toBeUndefined();
  expect(failureNote({ other: {} })).toBeUndefined();
  expect(failureNote(undefined)).toBeUndefined();
});

test('a chronology is only told for one source whose outcome changed, oldest first, without declaring a cause', () => {
  const record = (layer: string, status: ResultRecord['status'], at: number, env: string | null = 'desktop-web'): ResultRecord => ({
    ...recordOf(entry(result(layer, status, { environment: env, recordedAtMs: at }))),
    at
  });
  const early = record('1', 'failed', 100);
  const late = record('2', 'passed', 200);
  const timeline = chronology(late, [late, early, record('3', 'passed', 150, 'api')]);
  expect(timeline.map((each) => each.record.layer)).toEqual(['1', '2']);
  expect(timeline[1]!.selected).toBe(true);
  expect(passedAfterFailure(timeline)).toBe(true);
  expect(passedAfterFailure(chronology(early, [early, late]).slice().reverse())).toBe(false);
  expect(chronology(late, [late])).toEqual([]);
  expect(chronology(late, [late, record('4', 'passed', 50)])).toEqual([]);
});
