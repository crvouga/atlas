import type { LayerHeader, LayerRow } from '@crvouga/atlas/reports/evidence-types';
import type { CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import type { EvidenceResult } from '@crvouga/atlas/reports/layer-merge';
import { expect, test } from 'bun:test';

import type { TestResultEntry, TestSummary } from '@crvouga/atlas/reports/test-catalog';

import { assessBehavior, assessResult, assessTest, attentionRank, hasRelease, needsAttention } from './applicability';
import { behaviorOf, type RevisionSource } from './behavior';
import { featureModel } from './gherkin';

const FEATURE = featureModel('Feature: Lists\n  Scenario: Add\n    When adding tea\n')!;
const ADD = FEATURE.rules[0]!.scenarios[0]!;

type Extra = { layer?: Partial<LayerHeader>; labels?: Record<string, string>; layerLabels?: Record<string, string> };
function result(id: string, { layer = {}, labels, layerLabels }: Extra = {}, status: LayerRow['status'] = 'passed'): EvidenceResult {
  const evidence = (record: Record<string, string> | undefined) =>
    record ? { attachments: 0, steps: 0, annotations: 0, attempts: 0, links: 0, tags: [], labels: record, roles: [] } : undefined;
  return {
    key: id,
    slot: 's',
    layer: {
      id, backend: 'b', producer: 'p', packageDir: null, recordedAtMs: 1_000, sha: null, branch: 'main', environment: 'desktop-web', runUrl: null, parameters: {},
      recording: null, live: false, counts: { passed: 0, failed: 0, running: 0, 'not-run': 0 }, execution: id,
      ...(layerLabels ? { evidence: evidence(layerLabels) } : {}),
      ...layer
    },
    parameters: {},
    warning: null,
    row: { kind: 'behavior', id: 'x', title: 'Lists: Add', status, specPath: 'specs/a.feature', detail: '', measurements: [], testId: null, variant: {}, durationMs: null, ...(labels ? { evidence: evidence(labels) } : {}) }
  };
}
const revisions = (current: string | null, recorded: Record<string, string> = {}): RevisionSource => ({ current, recorded: (id) => recorded[id] });
const same = revisions('f1', { l1: 'f1', l2: 'f1', l3: 'f1' });
const slot = (outcomes: EvidenceResult[], status: CheckSlot['status'] = 'passed'): CheckSlot => ({
  key: 'k', id: 'k', title: 'Lists: Add', specPath: 'specs/a.feature', status, outcomes, diagnostics: [], latestAtMs: 1, live: false
});

test('a changed promise makes the only recording stale, whatever the release', () => {
  const old = assessResult(result('l1'), revisions('f2', { l1: 'f1' }), {});
  expect(old.verdict).toBe('stale');
  expect(old.promise).toBe('different');
  expect(old.reasons[0]).toContain('not proof of the current promise');
  expect(assessResult(result('l1'), revisions('f1', { l1: 'f1' }), {}).verdict).toBe('applies');
});

test('a missing revision is unknown, never a match', () => {
  expect(assessResult(result('l1'), revisions('f1'), {}).verdict).toBe('unknown');
  expect(assessResult(result('l1'), revisions(null, { l1: 'f1' }), {}).verdict).toBe('unknown');
});

test('the age of evidence is when the checks ran, not when it was published or enriched', () => {
  const facts = assessResult(result('l1', { layer: { recordedAtMs: 123_456 } }), same, {}).facts!;
  expect(facts.executedAtMs).toBe(123_456);
});

test('a desktop recording says nothing about a phone release', () => {
  const phone = { build: '90', platform: 'ios' };
  const got = assessResult(result('l1', { labels: { build: '90' } }), same, phone);
  expect(got.release).toBe('unknown');
  expect(got.verdict).toBe('unknown');
  expect(got.reasons.join(' ')).toContain('desktop-web');
  // The same build on the release's platform is an exact match.
  expect(assessResult(result('l1', { layer: { environment: 'ios' }, labels: { build: '90' } }), same, phone).release).toBe('exact');
  // The platform label overrides the environment name.
  expect(assessResult(result('l1', { labels: { build: '90', platform: 'ios' } }), same, phone).release).toBe('exact');
});

test('a mapped release marks evidence for another build, and a branch name or green check never supplies one', () => {
  const release = { build: '91' };
  const other = assessResult(result('l1', { labels: { build: '90' } }), same, release);
  expect(other.release).toBe('other');
  expect(other.verdict).toBe('stale');
  expect(assessResult(result('l1', { labels: { build: '91' } }), same, release).verdict).toBe('applies');
  // Evidence that does not say which build it ran against is unknown, even on the "release" branch with a passing result.
  const unlabelled = assessResult(result('l1', { layer: { branch: 'release/91' } }), same, release);
  expect(unlabelled.release).toBe('unknown');
  expect(unlabelled.verdict).toBe('unknown');
  // A commit is compared when one is named, abbreviated or not.
  const sha = 'a'.repeat(40);
  expect(assessResult(result('l1', { layer: { sha } }), same, { sha: 'aaaaaaa' }).release).toBe('exact');
  expect(assessResult(result('l1', { layer: { sha } }), same, { sha: 'b'.repeat(40) }).release).toBe('other');
  expect(assessResult(result('l1'), same, { sha }).release).toBe('unknown');
});

test('local changes or incomplete provenance can never be an exact build match', () => {
  const sha = 'a'.repeat(40);
  const dirty = assessResult(result('l1', { layer: { sha, freshness: 'modified' }, labels: { build: '91' } }), same, { build: '91', sha });
  expect(dirty.release).toBe('unknown');
  expect(dirty.reasons.join(' ')).toContain('uncommitted changes');
  const unknown = assessResult(result('l1', { layer: { sha, freshness: 'unknown' } }), same, { sha });
  expect(unknown.release).toBe('unknown');
  expect(unknown.reasons.join(' ')).toContain('not captured');
});

test('an assertion of compatibility is accepted only with a stated policy and an unchanged promise', () => {
  const release = { build: '91' };
  const asserted = (labels: Record<string, string>, revs = same) => assessResult(result('l1', { labels: { build: '90', ...labels } }), revs, release);
  const accepted = asserted({ 'applies-to': '91, 92', 'applies-to-by': 'release-policy-7' });
  expect(accepted.release).toBe('asserted');
  expect(accepted.verdict).toBe('applies');
  expect(accepted.assertion).toEqual({ builds: ['91', '92'], by: 'release-policy-7' });
  // No policy: not accepted, and not described as a match either.
  expect(asserted({ 'applies-to': '91' }).release).toBe('unknown');
  // A different promise wins over any assertion.
  expect(asserted({ 'applies-to': '91', 'applies-to-by': 'p' }, revisions('f2', { l1: 'f1' })).verdict).toBe('stale');
  // An assertion about other builds does not cover this one.
  expect(asserted({ 'applies-to': '95', 'applies-to-by': 'p' }).release).toBe('other');
});

test('a platform alone names no release', () => {
  expect(hasRelease({ platform: 'ios' })).toBe(false);
  expect(assessResult(result('l1'), same, { platform: 'ios' }).release).toBe('not-selected');
});

test('a behavior is read by its best completed result and its status is untouched', () => {
  const failing = result('l1', { labels: { build: '91' } }, 'failed');
  const old = result('l2', { layer: { recordedAtMs: 5 }, labels: { build: '90' } });
  const behavior = behaviorOf(ADD, slot([old, failing], 'failed'), null, same, 'k');
  const got = assessBehavior(behavior, same, { build: '91' });
  expect(got.verdict).toBe('applies');
  expect(got.others).toBe(1);
  expect(got.result).toBe(failing);
  expect(behavior.state).toBe('failed');
  // No completed result: no evidence, which is not a failure and is found with the stale ones.
  const none = assessBehavior(behaviorOf(ADD, null, null, same, 'k'), same, {});
  expect(none.verdict).toBe('none');
  expect(needsAttention(none)).toBe(true);
  expect(needsAttention(got)).toBe(false);
  // A running result is not evidence.
  const running = assessBehavior(behaviorOf(ADD, slot([result('l1', {}, 'running')]), null, same, 'k'), same, {});
  expect(running.verdict).toBe('none');
});

type Outcome = Partial<TestResultEntry>;
function testOf(outcomes: Outcome[], fingerprint: string | null = 'f1'): TestSummary {
  return {
    key: 'k', id: 'k', title: 'Lists: Add', specPath: 'specs/a.feature',
    spec: { path: 'specs/a.feature', title: 'Lists', domain: 'lists', kind: 'gherkin', ...(fingerprint ? { fingerprint } : {}) },
    outcomes: outcomes.map((outcome, index) => ({
      at: 1_000, status: 'passed', durationMs: null, environment: 'desktop-web', producer: 'p', kind: 'behavior', parameters: {}, branch: 'main', sha: null, runUrl: null,
      run: 'r', layer: `l${index + 1}`, backend: 'b', detail: '', specRevision: 'f1', ...outcome
    }))
  } as unknown as TestSummary;
}

test('a test whose promise changed after its only result is stale, and the same test read from the catalog agrees with the page', () => {
  const stale = assessTest(testOf([{ specRevision: 'f0' }]), {});
  expect(stale.verdict).toBe('stale');
  expect(stale.reasons[0]).toContain('not proof of the current promise');
  expect(assessTest(testOf([{ specRevision: 'f1' }]), {}).verdict).toBe('applies');
  // The same facts, read from the report, give the same verdict.
  expect(assessResult(result('l1'), revisions('f1', { l1: 'f0' }), {}).verdict).toBe(stale.verdict);
});

test('a test with no recorded revision or no promise fingerprint is unknown, never applying', () => {
  expect(assessTest(testOf([{ specRevision: undefined }]), {}).verdict).toBe('unknown');
  expect(assessTest(testOf([{ specRevision: 'f1' }], null), {}).verdict).toBe('unknown');
});

test('a test with no completed result has none, and its failure is not read at all as stale', () => {
  expect(assessTest(testOf([{ status: 'running' }, { status: 'not-run' }]), {}).verdict).toBe('none');
  expect(assessTest(testOf([]), { build: '9' }).release).toBe('unknown');
  expect(assessTest(testOf([{ status: 'failed' }]), {}).verdict).toBe('applies');
});

test('a test is read against the release from its provenance: build, platform, modified checkout and asserted compatibility', () => {
  const release = { build: '91' };
  expect(assessTest(testOf([{ provenance: { build: '90' } }]), release).release).toBe('other');
  expect(assessTest(testOf([{ provenance: { build: '91' } }]), release).release).toBe('exact');
  expect(assessTest(testOf([{ provenance: { build: '91' } }]), { ...release, platform: 'ios' }).release).toBe('unknown');
  expect(assessTest(testOf([{ provenance: { build: '91' }, freshness: 'modified' }]), release).release).toBe('unknown');
  const asserted = (by: Record<string, string>) => assessTest(testOf([{ provenance: { build: '90', 'applies-to': '91', ...by } }]), release);
  expect(asserted({ 'applies-to-by': 'policy-7' }).release).toBe('asserted');
  expect(asserted({}).release).toBe('unknown');
  // A branch never supplies deployment state.
  expect(assessTest(testOf([{ branch: 'release/91' }]), release).release).toBe('unknown');
});

test('the best of a test\'s current results is kept, and stale evidence sorts before evidence that applies', () => {
  const both = assessTest(testOf([{ specRevision: 'f0', at: 5_000 }, { specRevision: 'f1', at: 1_000 }]), {});
  expect(both.verdict).toBe('applies');
  expect(both.layer).toBe('l2');
  expect(both.others).toBe(1);
  const ranks = [assessTest(testOf([{}]), {}), assessTest(testOf([{ specRevision: 'f0' }]), {}), assessTest(testOf([{ specRevision: undefined }]), {}), assessTest(testOf([]), {})].map(attentionRank);
  expect(ranks).toEqual([3, 0, 1, 2]);
});

test('when evidence was published or enriched is carried apart from when the checks ran, and a time that cannot be read is no time', () => {
  const facts = assessTest(testOf([{ at: 1_000, provenance: { 'published-at': '1700000000000', 'enriched-at': '2026-10-01T00:00:00Z' } }]), {}).facts!;
  expect(facts.executedAtMs).toBe(1_000);
  expect(facts.publishedAtMs).toBe(1_700_000_000_000);
  expect(facts.enrichedAtMs).toBe(Date.parse('2026-10-01T00:00:00Z'));
  const unreadable = assessTest(testOf([{ provenance: { 'published-at': 'yesterday-ish', 'enriched-at': '0' } }]), {}).facts!;
  expect([unreadable.publishedAtMs, unreadable.enrichedAtMs]).toEqual([null, null]);
  // Read from the report, labels at the layer or the check say the same.
  expect(assessResult(result('l1', { layerLabels: { 'published-at': '1700000000000' } }), same, {}).facts!.publishedAtMs).toBe(1_700_000_000_000);
});
