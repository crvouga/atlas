import { describe, expect, test } from 'bun:test';

import { publishChecks } from '../src/publish-checks';
import { reliability } from '../src/reliability';
import { ReportIndex } from '../src/report-index';
import { alignSteps, compareProductLatency, compareReliability, compareRuns, reliabilityScopeAt, type CompareGroup } from '../src/run-compare';
import { runDetail, type TestResultEntry } from '../src/test-catalog';
import { memoryStore } from './memory-store';

const SHA = 'a'.repeat(40);
const SPEC = 'specs/pay.feature';
const key = (id: string) => JSON.stringify([SPEC, id]);

type Status = 'passed' | 'failed' | 'running' | 'not-run';
type Check = { id: string; title?: string; status: Status };
type Run = { run: string; at: number; checks: Check[]; revision?: string; environment?: string; branch?: string; parameters?: Record<string, string> };

/** Two (or more) runs published as layers and read back the way the server reads them. */
async function runsOf(inputs: readonly Run[]) {
  const store = memoryStore();
  for (const input of inputs) {
    await publishChecks(store, {
      producer: 'web', environment: input.environment ?? 'desktop-web', recordedAtMs: input.at, sha: SHA, branch: input.branch ?? 'main', runUrl: null,
      run: { id: input.run }, parameters: input.parameters ?? {},
      specs: [{ path: SPEC, domain: 'payments', kind: 'feature', title: 'Pay', ...(input.revision ? { fingerprint: input.revision } : {}) }],
      checks: input.checks.map(check => ({ id: check.id, title: check.title ?? check.id, specPath: SPEC, status: check.status }))
    });
  }
  const index = new ReportIndex([{ id: 'one', store }]);
  await index.refresh();
  return (name: string) => runDetail(index.history, 'v', `run:${name}`)!;
}

const groupOf = (comparison: ReturnType<typeof compareRuns>, id: string) => comparison.results.find(item => item.key === key(id))!.group as CompareGroup;

describe('comparing two runs', () => {
  test('1: results are reconciled by check identity, not by title, and added, removed and moved behaviors are named', async () => {
    const runs = await runsOf([
      { run: 'base', at: 1_000, revision: 'r1', checks: [{ id: 'pay', title: 'Pay', status: 'passed' }, { id: 'refund', title: 'Refund', status: 'failed' }, { id: 'gone', title: 'Gone', status: 'passed' }, { id: 'same', title: 'Same', status: 'passed' }] },
      // `renamed-id` has the title `Gone`, but it is not the same check as `gone`: a title never pairs two results.
      { run: 'cand', at: 2_000, revision: 'r1', checks: [{ id: 'pay', title: 'Pay', status: 'failed' }, { id: 'refund', title: 'Refund', status: 'passed' }, { id: 'renamed-id', title: 'Gone', status: 'passed' }, { id: 'same', title: 'Same', status: 'passed' }] }
    ]);
    const comparison = compareRuns(runs('base'), runs('cand'));
    expect(groupOf(comparison, 'pay')).toBe('regressed');
    expect(groupOf(comparison, 'refund')).toBe('recovered');
    expect(groupOf(comparison, 'same')).toBe('unchanged');
    expect(groupOf(comparison, 'gone')).toBe('removed');
    expect(groupOf(comparison, 'renamed-id')).toBe('added');
    expect(comparison.counts).toMatchObject({ regressed: 1, recovered: 1, unchanged: 1, removed: 1, added: 1 });
    // Every result of either run is somewhere, and the order is the review order.
    expect(comparison.results).toHaveLength(5);
    expect(comparison.results[0]!.group).toBe('regressed');
  });

  test('a run detail says under which condition and against which spec revision each result was recorded, and what its layer called it', async () => {
    const runs = await runsOf([{ run: 'base', at: 1_000, revision: 'r1', parameters: { locale: 'fr' }, checks: [{ id: 'pay', title: 'Payer', status: 'passed' }] }, { run: 'later', at: 2_000, checks: [{ id: 'pay', title: 'Pay', status: 'passed' }] }]);
    expect(runs('base').results[0]).toMatchObject({ kind: 'checks', parameters: { locale: 'fr' }, specRevision: 'r1', recordedTitle: 'Payer' });
    // Without parameters or a recorded revision those fields are absent, never empty or "the same".
    const later = runs('later').results[0]!;
    expect(later).not.toHaveProperty('parameters');
    expect(later).not.toHaveProperty('specRevision');
    expect(later.recordedTitle).toBe('Pay');
  });

  test('2: a baseline behavior the candidate did not execute is unknown, never regressed or passed', async () => {
    const runs = await runsOf([
      { run: 'base', at: 1_000, revision: 'r1', checks: [{ id: 'pay', status: 'passed' }, { id: 'skipped', status: 'passed' }] },
      { run: 'cand', at: 2_000, revision: 'r1', checks: [{ id: 'skipped', status: 'not-run' }] }
    ]);
    const comparison = compareRuns(runs('base'), runs('cand'));
    expect(groupOf(comparison, 'pay')).toBe('removed');
    expect(groupOf(comparison, 'skipped')).toBe('unknown');
    expect(comparison.counts.regressed).toBe(0);
    expect(comparison.counts.unchanged).toBe(0);
    const pay = comparison.results.find(item => item.key === key('pay'))!;
    expect(pay.candidate).toBeNull();
    expect(pay.summary).toContain('not a regression');
    expect(comparison.results.find(item => item.key === key('skipped'))!.summary).toContain('unknown, not a failure or a pass');
  });

  test('4: a changed promise is shown with both outcomes and is not framed as a regression', async () => {
    const runs = await runsOf([
      { run: 'base', at: 1_000, revision: 'r1', checks: [{ id: 'pay', title: 'Pay with a card', status: 'passed' }, { id: 'refund', title: 'Refund', status: 'passed' }, { id: 'tip', title: 'Tip', status: 'passed' }] },
      { run: 'cand', at: 2_000, revision: 'r2', checks: [{ id: 'pay', title: 'Pay with a card in under a second', status: 'failed' }, { id: 'refund', title: 'Refund', status: 'failed' }, { id: 'tip', title: 'Tip', status: 'passed' }] }
    ]);
    const comparison = compareRuns(runs('base'), runs('cand'));
    const pay = comparison.results.find(item => item.key === key('pay'))!;
    expect(pay.group).toBe('not-comparable');
    expect(pay.promise).toMatchObject({ state: 'changed', baselineTitle: 'Pay with a card', candidateTitle: 'Pay with a card in under a second', baselineRevision: 'r1', candidateRevision: 'r2' });
    expect(pay.baseline!.status).toBe('passed');
    expect(pay.candidate!.status).toBe('failed');
    expect(pay.summary).toContain('Not the same experiment');
    // The spec file's revision differs but this behavior's wording does not: it is still a regression, with the revision disclosed.
    const refund = comparison.results.find(item => item.key === key('refund'))!;
    expect(refund.group).toBe('regressed');
    expect(refund.promise.state).toBe('revision-differs');
    expect(refund.caveats.join(' ')).toContain('does not say that this behavior');
  });

  test('a revision that was not recorded is unknown, never the same', async () => {
    const runs = await runsOf([
      { run: 'base', at: 1_000, checks: [{ id: 'pay', status: 'passed' }] },
      { run: 'cand', at: 2_000, revision: 'r2', checks: [{ id: 'pay', status: 'failed' }] }
    ]);
    const pay = compareRuns(runs('base'), runs('cand')).results[0]!;
    expect(pay.promise.state).toBe('unknown');
    expect(pay.group).toBe('regressed');
    expect(pay.caveats.join(' ')).toContain('recorded no spec revision');
  });

  test('the same check recorded under another environment is paired, marked as different conditions, and not a regression', async () => {
    const runs = await runsOf([
      { run: 'base', at: 1_000, revision: 'r1', environment: 'desktop-web', checks: [{ id: 'pay', status: 'passed' }] },
      { run: 'cand', at: 2_000, revision: 'r1', environment: 'ios', checks: [{ id: 'pay', status: 'failed' }] }
    ]);
    const comparison = compareRuns(runs('base'), runs('cand'));
    expect(comparison.results).toHaveLength(1);
    expect(comparison.results[0]).toMatchObject({ group: 'not-comparable' });
    expect(comparison.results[0]!.conditions).toEqual(['environment desktop-web against ios']);
  });

  test('both pinned runs stay as they are when a newer run arrives', async () => {
    const before = await runsOf([
      { run: 'base', at: 1_000, revision: 'r1', checks: [{ id: 'pay', status: 'passed' }] },
      { run: 'cand', at: 2_000, revision: 'r1', checks: [{ id: 'pay', status: 'failed' }] }
    ]);
    const after = await runsOf([
      { run: 'base', at: 1_000, revision: 'r1', checks: [{ id: 'pay', status: 'passed' }] },
      { run: 'cand', at: 2_000, revision: 'r1', checks: [{ id: 'pay', status: 'failed' }] },
      { run: 'newer', at: 3_000, revision: 'r1', checks: [{ id: 'pay', status: 'passed' }] }
    ]);
    const first = compareRuns(before('base'), before('cand'));
    const second = compareRuns(after('base'), after('cand'));
    expect(second.results.map(item => [item.id, item.group, item.baseline?.layer, item.candidate?.layer])).toEqual(first.results.map(item => [item.id, item.group, item.baseline?.layer, item.candidate?.layer]));
    expect(second.candidate.key).toBe('run:cand');
  });

  test('run-level notes: the same run, other branches and a candidate older than the baseline', async () => {
    const runs = await runsOf([
      { run: 'base', at: 2_000, revision: 'r1', branch: 'main', checks: [{ id: 'pay', status: 'passed' }] },
      { run: 'cand', at: 1_000, revision: 'r1', branch: 'feature', checks: [{ id: 'pay', status: 'passed' }] }
    ]);
    const notes = compareRuns(runs('base'), runs('cand')).notes.join(' ');
    expect(notes).toContain('different branches');
    expect(notes).toContain('ended before');
    expect(compareRuns(runs('base'), runs('base')).notes.join(' ')).toContain('same run is on both sides');
  });
});

const latency = (name: string, value: number, extra: Record<string, unknown> = {}) => ({ name, kind: 'product-latency', unit: 'ms', value, from: 'tap', to: 'paint', ...extra });
const entry = (at: number, measurements: unknown[], over: Partial<TestResultEntry> = {}) =>
  ({ at, environment: 'desktop-web', parameters: {}, sha: SHA, layer: `l${at}`, run: `run:${at}`, latency: measurements, status: 'passed', durationMs: 1, producer: 'web', kind: 'checks', ...over }) as unknown as TestResultEntry;
const many = (start: number, values: number[], over: Partial<TestResultEntry> = {}) => values.map((value, i) => entry(start + i, [latency('checkout', value)], over));

describe('comparing figures', () => {
  test('5: latency is compared like for like, with the change and its disclosures', () => {
    const baseline = many(1_000, [100, 110, 120, 130, 140]);
    const candidate = many(2_000, [200, 210, 220, 230, 240]);
    const [metric] = compareProductLatency(baseline, candidate);
    expect(metric).toMatchObject({ state: 'compared', name: 'checkout' });
    if (metric?.state !== 'compared') throw new Error('expected a comparison');
    expect(metric.change.comparable).toBe(true);
    expect(metric.change.p50?.absolute).toBe(100);
  });

  test('5: another device, environment or condition makes it incompatible and no change is computed', () => {
    const baseline = many(1_000, [100, 110, 120, 130, 140]);
    const candidate = many(2_000, [200, 210, 220, 230, 240], { environment: 'ios', parameters: { device: 'phone' } });
    const [metric] = compareProductLatency(baseline, candidate);
    expect(metric).toMatchObject({ state: 'incompatible', change: null });
    expect(metric!.reasons.join(' ')).toContain('Devices differ');
    expect(compareProductLatency(baseline, many(2_000, [1, 2, 3, 4, 5]), ['environment desktop-web against ios'])[0]).toMatchObject({ state: 'incompatible', change: null });
  });

  test('5: a metric one side lacks is named, and a different interval is not the same measurement', () => {
    const baseline = [entry(1_000, [latency('checkout', 100), latency('search', 40)])];
    const candidate = [entry(2_000, [latency('checkout', 90, { to: 'interactive' }), latency('login', 30)])];
    const result = compareProductLatency(baseline, candidate);
    expect(result.map(item => [item.name, item.state])).toEqual([['checkout', 'baseline-only'], ['search', 'baseline-only'], ['login', 'candidate-only']]);
    expect(result[0]!.reasons.join(' ')).toContain('different interval');
    // A side with no latency at all contributes nothing: it is unknown, not fast.
    expect(compareProductLatency(baseline, [entry(2_000, [])]).every(item => item.state === 'baseline-only')).toBe(true);
  });

  const executions = (n: number, fails: (i: number) => boolean, over: Partial<TestResultEntry> = {}): TestResultEntry[] =>
    Array.from({ length: n }, (_, i) => ({
      at: 1_000 + i, status: fails(i) ? 'failed' : 'passed', durationMs: null, environment: 'desktop-web', producer: 'web', kind: 'checks', parameters: {}, branch: 'main', sha: SHA, runUrl: null,
      run: `run:r${i}`, layer: `l${i}`, backend: 'one', detail: '', specRevision: 'r1', ...over
    }));

  test('5: reliability is compared only when both samples are established on the same revision, and a difference inside the uncertainty is not an improvement', () => {
    const history = executions(40, i => i % 2 === 0);
    const at = (end: number) => reliability(key('pay'), history, { ...reliabilityScopeAt({ environment: 'desktop-web', producer: 'web', parameters: {}, specRevision: 'r1' }, { endedAtMs: end }) });
    const early = at(1_015);
    const late = at(1_039);
    expect(early.eventual.executions).toBe(16);
    const comparison = compareReliability(early, late);
    expect(comparison.comparable).toBe(true);
    expect(comparison.direction).toBe('indistinguishable');
    expect(comparison.reasons.join(' ')).toContain('not shown as an improvement');

    const small = at(1_003);
    const thin = compareReliability(small, late);
    expect(thin.comparable).toBe(false);
    expect(thin).not.toHaveProperty('points');
    expect(thin.reasons.join(' ')).toContain('rests on 4 independent executions');
  });

  test('5: a clear difference is said with its direction and the points', () => {
    const history = [...executions(30, () => true).map((e, i) => ({ ...e, at: 1_000 + i })), ...executions(30, () => false).map((e, i) => ({ ...e, at: 2_000 + i, run: `run:s${i}`, layer: `m${i}` }))];
    const result = { environment: 'desktop-web', producer: 'web', parameters: {}, specRevision: 'r1' };
    const base = reliability(key('pay'), history, reliabilityScopeAt(result, { endedAtMs: 1_029 }));
    const cand = reliability(key('pay'), history, reliabilityScopeAt(result, { endedAtMs: 2_029 }));
    // The earlier figure is of failures only; the later pools everything up to its run, so it is higher.
    const comparison = compareReliability(base, cand);
    expect(comparison.direction).toBe('higher');
    expect(comparison.points).toBeGreaterThan(0);
  });

  test('5: executions against different spec revisions are not compared', () => {
    const history = [...executions(12, () => false, { specRevision: 'r1' }), ...executions(12, () => true, { specRevision: 'r2' }).map((e, i) => ({ ...e, at: 2_000 + i, run: `run:q${i}`, layer: `q${i}` }))];
    const result = { environment: 'desktop-web', producer: 'web', parameters: {} };
    const base = reliability(key('pay'), history, reliabilityScopeAt({ ...result, specRevision: 'r1' }, { endedAtMs: 1_999 }));
    const cand = reliability(key('pay'), history, reliabilityScopeAt({ ...result, specRevision: 'r2' }, { endedAtMs: 2_999 }));
    const comparison = compareReliability(base, cand);
    expect(comparison.comparable).toBe(false);
    expect(comparison.reasons.join(' ')).toContain('different revisions of the spec');
    // A result that recorded no revision is counted across revisions, and that is not compared.
    const unrecorded = reliability(key('pay'), history, reliabilityScopeAt(result, { endedAtMs: 2_999 }));
    expect(compareReliability(base, unrecorded).reasons.join(' ')).toContain('recorded no spec revision');
  });
});

describe('aligning recorded steps', () => {
  test('3: steps shared by name with a time on both sides can be sought, each on its own time origin', () => {
    const alignment = alignSteps(
      [{ name: 'open', offsetMs: 0 }, { name: 'pay', offsetMs: 4_000 }],
      [{ name: 'open', offsetMs: 500 }, { name: 'pay', offsetMs: 9_000 }, { name: 'tip', offsetMs: 12_000 }]
    );
    expect(alignment.state).toBe('aligned');
    expect(alignment.seekable.map(step => [step.name, step.baselineOffsetMs, step.candidateOffsetMs])).toEqual([['open', 0, 500], ['pay', 4_000, 9_000]]);
    expect(alignment.differs).toBe(true);
  });

  test('3: absent alignment is explained', () => {
    expect(alignSteps([], []).explanation).toContain('Neither side recorded steps');
    expect(alignSteps([{ name: 'open', offsetMs: 0 }], []).explanation).toContain('Only the baseline recorded steps');
    expect(alignSteps([{ name: 'open', offsetMs: 0 }], [{ name: 'close', offsetMs: 0 }]).explanation).toContain('share no step name');
    expect(alignSteps([{ name: 'open' }], [{ name: 'open', offsetMs: 3 }]).explanation).toContain('carry no time on both sides');
    expect(alignSteps([{ name: 'open' }], [{ name: 'open', offsetMs: 3 }]).state).toBe('unaligned');
  });

  test('a repeated step name is matched occurrence by occurrence, never by position alone', () => {
    const alignment = alignSteps([{ name: 'tap', offsetMs: 1 }, { name: 'tap', offsetMs: 2 }], [{ name: 'tap', offsetMs: 10 }]);
    expect(alignment.seekable).toHaveLength(1);
    expect(alignment.seekable[0]).toMatchObject({ baselineOffsetMs: 1, candidateOffsetMs: 10 });
    expect(alignment.steps.filter(step => !step.onCandidate)).toHaveLength(1);
  });
});
