import type { LayerHeader, LayerRow } from '@crvouga/atlas/reports/evidence-types';
import type { CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import type { EvidenceResult } from '@crvouga/atlas/reports/layer-merge';
import { expect, test } from 'bun:test';

import { behaviorOf, compareRevisions, coverageCounts, isRepresentative, scenarioBehaviors, type RevisionSource } from './behavior';
import { exampleIndexFor, featureModel, fillExample, exampleRows } from './gherkin';

const FEATURE = featureModel(`Feature: Lists
  @demo
  Scenario: Add
    When adding tea

  @parked
  Scenario: Archive
    When archiving

  Scenario Outline: Several
    When adding "<item>" for <who>
    Examples:
      | item | who |
      | Tea  | Ann |
      | Milk | Bo  |
`)!;
const [ADD, ARCHIVE, SEVERAL] = FEATURE.rules[0]!.scenarios;

const header = (layer: string, environment: string | null = 'desktop-web'): LayerHeader => ({
  id: layer, backend: 'b', producer: 'p', packageDir: null, recordedAtMs: 1, sha: null, branch: null, environment, runUrl: null, parameters: {},
  recording: null, live: false, counts: { passed: 0, failed: 0, running: 0, 'not-run': 0 }, execution: layer
});
function result(layer: string, row: Partial<LayerRow>, environment: string | null = 'desktop-web'): EvidenceResult {
  return {
    key: layer, slot: 's', layer: header(layer, environment), parameters: {}, warning: null,
    row: { kind: 'behavior', id: 'x', title: 'Lists: Add', status: 'passed', specPath: 'specs/a.feature', detail: '', measurements: [], testId: null, variant: {}, durationMs: null, ...row }
  };
}
const slot = (status: CheckSlot['status'], outcomes: EvidenceResult[], title = 'Lists: Add'): CheckSlot => ({
  key: title, id: title, title, specPath: 'specs/a.feature', status, outcomes, diagnostics: [], latestAtMs: 1, live: false
});
const VIDEO = { attachments: 1, steps: 0, annotations: 0, attempts: 0, links: 0, tags: [], labels: {}, roles: ['video'], videos: [{ name: 'a.webm', owner: 'check' as const, recording: 'sha256:1', available: true }] };
const revisions = (current: string | null, recorded: Record<string, string> = {}): RevisionSource => ({ current, recorded: (id) => recorded[id] });
const stateOf = (s: CheckSlot | null, rev = revisions('f1', { l1: 'f1', l2: 'f0' }), scenario = ADD!) => behaviorOf(scenario, s, null, rev, 'k').state;

test('revisions compare only when both are known', () => {
  expect(compareRevisions('a', 'a').match).toBe('same');
  expect(compareRevisions('a', 'b').match).toBe('different');
  expect(compareRevisions('a', undefined).match).toBe('unknown');
  expect(compareRevisions(null, 'a').match).toBe('unknown');
});

test('only a passing result with a playable recording of the current promise is demonstrated', () => {
  expect(stateOf(slot('passed', [result('l1', { evidence: VIDEO })]))).toBe('demonstrated');
  // The same recording of an older revision is not proof of the new promise.
  expect(stateOf(slot('passed', [result('l2', { evidence: VIDEO })]))).toBe('outdated-recording');
  // An unplayable reference is a gap, and a pass with nothing to watch says so.
  expect(stateOf(slot('passed', [result('l1', { evidence: { ...VIDEO, videos: [{ ...VIDEO.videos[0]!, available: false }] } })]))).toBe('recording-missing');
  expect(stateOf(slot('passed', [result('l1', { recording: { state: 'skipped', reason: 'too-large' } })]))).toBe('recording-missing');
  expect(stateOf(slot('passed', [result('l1', {})]))).toBe('no-recording');
  expect(stateOf(slot('passed', [result('l1', {}, 'api')]))).toBe('api-only');
  // A video on the API does not turn it into API-only evidence: it can be watched.
  expect(stateOf(slot('passed', [result('l1', { evidence: VIDEO }, 'api')]))).toBe('demonstrated');
});

test('failed, running, skipped, parked and unexecuted stay distinct and never read as passes', () => {
  expect(stateOf(slot('failed', [result('l1', { status: 'failed', evidence: VIDEO })]))).toBe('failed');
  expect(stateOf(slot('running', [result('l1', { status: 'running' })]))).toBe('running');
  expect(stateOf(slot('not-run', [result('l1', { status: 'not-run' })]))).toBe('skipped');
  expect(stateOf(null, undefined, ARCHIVE)).toBe('parked');
  expect(stateOf(null)).toBe('unexecuted');
  // One environment passing with a clip does not hide another that failed.
  expect(stateOf(slot('failed', [result('l1', { evidence: VIDEO }), result('l3', { status: 'failed' })]))).toBe('failed');
});

test('a demo tag marks the scenario as the representative one', () => {
  expect(isRepresentative(['#Demo'])).toBe(true);
  expect(isRepresentative(['smoke'])).toBe(false);
  expect(behaviorOf(ADD!, null, null, revisions(null), 'k').representative).toBe(true);
  expect(behaviorOf(ARCHIVE!, null, null, revisions(null), 'k').representative).toBe(false);
});

test('an outline is one behavior per example, never the template as well', () => {
  const tea = slot('passed', [result('l1', {})], 'Lists: Several — Tea');
  const behaviors = scenarioBehaviors(SEVERAL!, [tea], 'Lists', revisions('f1'));
  expect(behaviors.map((behavior) => [behavior.example, behavior.state])).toEqual([
    ['Tea', 'no-recording'],
    ['Milk, Bo', 'unexecuted']
  ]);
  expect(coverageCounts(behaviors).unexecuted).toBe(1);
  // With nothing recorded there are still only the two examples.
  expect(scenarioBehaviors(SEVERAL!, [], 'Lists', revisions(null))).toHaveLength(2);
});

test('a recorded example is matched to its row by cells or column pairs, and its values are filled in', () => {
  expect(exampleIndexFor(SEVERAL!, 'Milk')).toBe(1);
  expect(exampleIndexFor(SEVERAL!, 'item=Tea, who=Ann')).toBe(0);
  expect(exampleIndexFor(SEVERAL!, 'Unrelated wording')).toBe(-1);
  const filled = fillExample(SEVERAL!.steps, exampleRows(SEVERAL!)[1]!);
  expect(filled[0]!.text).toBe('adding "Milk" for Bo');
});
