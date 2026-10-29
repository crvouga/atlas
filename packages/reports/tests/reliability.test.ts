import { describe, expect, test } from 'bun:test';

import { publishChecks } from '../src/publish-checks';
import { MIN_EXECUTIONS, parseReliabilityScope, reliability, reliabilityMarkdown } from '../src/reliability';
import { ReportIndex } from '../src/report-index';
import { HISTORY_PER_TEST, type TestResultEntry } from '../src/test-catalog';
import { memoryStore } from './memory-store';

const SHA = 'a'.repeat(40);
const SPEC = 'specs/pay.feature';
const KEY = JSON.stringify([SPEC, 'pay']);
const SPEC_ENTRY = (fingerprint?: string) => ({ path: SPEC, domain: 'payments', kind: 'feature', title: 'Pay', ...(fingerprint ? { fingerprint } : {}) });

type Status = 'passed' | 'failed' | 'running' | 'not-run';
type Input = { at: number; run: string; status: Status; environment?: string; producer?: string; branch?: string; fingerprint?: string; attempts?: Status[]; parameters?: Record<string, string> };

async function historyOf(inputs: readonly Input[]) {
  const store = memoryStore();
  for (const input of inputs) {
    await publishChecks(store, {
      producer: input.producer ?? 'web', environment: input.environment ?? 'desktop-web', recordedAtMs: input.at, sha: SHA, branch: input.branch ?? 'main', runUrl: null,
      run: { id: input.run }, parameters: input.parameters ?? {}, specs: input.fingerprint ? [SPEC_ENTRY(input.fingerprint)] : [],
      checks: [{ id: 'pay', title: 'Pay', specPath: SPEC, status: input.status, ...(input.attempts ? { attempts: input.attempts.map((status, index) => ({ index, status })) } : {}) }],
    });
  }
  const index = new ReportIndex([{ id: 'one', store }]);
  await index.refresh();
  return index.history.of(KEY);
}

/** `n` executions of a synthetic history, each its own run, passing except where `fails` says. */
function executions(n: number, fails: (i: number) => boolean = () => false): TestResultEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    at: 1_000 + i, status: fails(i) ? 'failed' : 'passed', durationMs: null, environment: 'desktop-web', producer: 'web', kind: 'checks', parameters: {},
    branch: 'main', sha: SHA, runUrl: null, run: `run:r${i}`, layer: `l${i}`, backend: 'one', detail: '',
  }));
}

describe('reliability of a test', () => {
  test('1: one execution published as several snapshots is one execution with its recorded tries', async () => {
    const history = await historyOf([
      { at: 1_000, run: 'r1', status: 'running' },
      { at: 2_000, run: 'r1', status: 'passed' },
      { at: 3_000, run: 'r1', status: 'passed', attempts: ['passed'] },
    ]);
    const document = reliability(KEY, history);
    expect(document.eventual).toMatchObject({ executions: 1, passed: 1, failed: 0 });
    expect(document.executions).toHaveLength(1);
    // The raw snapshots stay inspectable and are not weighted as trials.
    expect(document.executions[0]).toMatchObject({ snapshots: 2, counted: true, attempts: ['passed'], firstAttempt: 'passed' });
    expect(document.snapshots).toBe(2);
    expect(document.attempts).toEqual({ total: 1, retried: 0, recovered: 0 });
  });

  test('2: a failed first try followed by a passing retry separates first-try from eventual success, and both tries are inspectable', async () => {
    const history = await historyOf([
      { at: 1_000, run: 'r1', status: 'passed', attempts: ['failed', 'passed'] },
      { at: 2_000, run: 'r2', status: 'passed', attempts: ['passed'] },
    ]);
    const document = reliability(KEY, history);
    expect(document.eventual).toMatchObject({ executions: 2, passed: 2, rate: 1 });
    expect(document.firstAttempt).toMatchObject({ executions: 2, passed: 1, failed: 1, rate: 0.5 });
    expect(document.attempts).toEqual({ total: 3, retried: 1, recovered: 1 });
    expect(document.executions.find(execution => execution.run === 'run:r1')!.attempts).toEqual(['failed', 'passed']);
  });

  test('2: an execution with no recorded tries is not assumed to have passed first time', async () => {
    const document = reliability(KEY, await historyOf([{ at: 1_000, run: 'r1', status: 'passed' }]));
    expect(document.firstAttempt).toMatchObject({ executions: 0, rate: null });
    expect(document.unrecordedAttempts).toBe(1);
    expect(document.notes.map(note => note.code)).toContain('attempts-not-recorded');
  });

  test('3: choosing phone leaves desktop observations out of its rate and its sample size', async () => {
    const history = await historyOf([
      ...[1, 2, 3, 4].map(i => ({ at: i * 1_000, run: `d${i}`, status: 'passed' as const, environment: 'desktop-web' })),
      ...[5, 6].map(i => ({ at: i * 1_000, run: `p${i}`, status: 'failed' as const, environment: 'phone' })),
    ]);
    const pooled = reliability(KEY, history);
    expect(pooled.eventual).toMatchObject({ executions: 6, passed: 4 });
    expect(pooled.notes.map(note => note.code)).toContain('pooled-environments');
    expect(pooled.cohorts.map(cohort => [cohort.environment, cohort.executions, cohort.rate]).sort()).toEqual([['desktop-web', 4, 1], ['phone', 2, 0]]);
    const phone = reliability(KEY, history, { environment: ['phone'] });
    expect(phone.eventual).toMatchObject({ executions: 2, passed: 0, failed: 2, rate: 0 });
    expect(phone.outsideScope).toBe(4);
    expect(phone.executions.every(execution => execution.environment === 'phone')).toBe(true);
    expect(phone.notes.map(note => note.code)).not.toContain('pooled-environments');
  });

  test('4: only the current spec revision counts; earlier revisions are shown as historical context', async () => {
    const history = await historyOf([
      { at: 1_000, run: 'old1', status: 'failed', fingerprint: 'rev-1' },
      { at: 2_000, run: 'old2', status: 'passed', fingerprint: 'rev-1' },
      { at: 3_000, run: 'new1', status: 'passed', fingerprint: 'rev-2' },
    ]);
    const current = reliability(KEY, history);
    expect(current.currentRevision).toBe('rev-2');
    expect(current.eventual).toMatchObject({ executions: 1, passed: 1 });
    expect(current.historical).toMatchObject({ executions: 2, passed: 1, failed: 1, revisions: [{ specRevision: 'rev-1', executions: 2 }] });
    expect(current.excluded['historical-revision']).toBe(2);
    expect(current.executions.filter(execution => !execution.counted).map(execution => execution.excluded)).toEqual(['historical-revision', 'historical-revision']);
    // Pooling every revision is a choice the document names.
    const every = reliability(KEY, history, { revision: 'any' });
    expect(every.eventual.executions).toBe(3);
    expect(every.notes.map(note => note.code)).toContain('pooled-revisions');
    // A revision can be named.
    expect(reliability(KEY, history, { specRevision: ['rev-1'] }).eventual).toMatchObject({ executions: 2, passed: 1, failed: 1 });
  });

  test('4: a result that records no revision is not assumed to match the current one', async () => {
    const history = await historyOf([
      { at: 1_000, run: 'a', status: 'passed' },
      { at: 2_000, run: 'b', status: 'passed', fingerprint: 'rev-2' },
    ]);
    const document = reliability(KEY, history);
    expect(document.eventual.executions).toBe(1);
    expect(document.excluded['revision-not-recorded']).toBe(1);
    // With no revision recorded anywhere the history is pooled, and the document says so.
    const none = reliability(KEY, await historyOf([{ at: 1_000, run: 'a', status: 'passed' }]));
    expect(none.eventual.executions).toBe(1);
    expect(none.notes.map(note => note.code)).toContain('revision-not-recorded');
  });

  test('5: one passing observation is not established reliability, and no observation has no rate', () => {
    const one = reliability(KEY, executions(1));
    expect(one).toMatchObject({ sample: 'insufficient', minimumExecutions: MIN_EXECUTIONS, eventual: { executions: 1, rate: 1 } });
    const note = one.notes.find(candidate => candidate.code === 'insufficient-sample')!;
    expect(note.severity).toBe('warning');
    expect(note.message).toContain('Only 1 independent execution');
    expect(note.message).toContain('not evidence that the next one will');
    const none = reliability(KEY, []);
    expect(none).toMatchObject({ sample: 'none', eventual: { executions: 0, rate: null }, interval: null });
    expect(none.notes.map(candidate => candidate.code)).toContain('no-observations');
    expect(reliability(KEY, executions(MIN_EXECUTIONS)).sample).toBe('sufficient');
    // The interval states what it assumes and is wide for a small sample.
    expect(one.interval!.assumptions).toContain('independent');
    expect(one.interval!.lower).toBeLessThan(0.5);
  });

  test('6: a failed case published again is flagged, and the figure is not called representative', async () => {
    const history = await historyOf([
      { at: 1_000, run: 'r1', status: 'failed' },
      { at: 2_000, run: 'r1', status: 'passed' },
    ]);
    const document = reliability(KEY, history);
    expect(document.eventual).toMatchObject({ executions: 1, passed: 1 });
    expect(document.executions[0]).toMatchObject({ republished: true, snapshots: 2 });
    expect(document.notes.find(note => note.code === 'selected-reruns')).toMatchObject({ severity: 'warning' });
  });

  test('6: bounded history and a window that reaches past it are said', () => {
    const document = reliability(KEY, executions(HISTORY_PER_TEST), { since: 0 });
    const codes = document.notes.map(note => note.code);
    expect(codes).toContain('history-bounded');
    expect(codes).toContain('window-incomplete');
    expect(reliability(KEY, executions(HISTORY_PER_TEST - 1)).notes.map(note => note.code)).not.toContain('history-bounded');
    // A window that begins inside what is kept is not incomplete.
    expect(reliability(KEY, executions(HISTORY_PER_TEST), { since: 5_000 }).notes.map(note => note.code)).not.toContain('window-incomplete');
  });

  test('7: not-run and unfinished executions are named and never counted as passes', async () => {
    const history = await historyOf([
      { at: 1_000, run: 'a', status: 'passed' },
      { at: 2_000, run: 'b', status: 'not-run' },
      { at: 3_000, run: 'c', status: 'running' },
    ]);
    const document = reliability(KEY, history);
    expect(document.eventual).toMatchObject({ executions: 1, passed: 1 });
    expect(document.excluded['not-run']).toBe(1);
    expect(document.executions.find(execution => execution.status === 'not-run')).toMatchObject({ counted: false, excluded: 'not-run' });
    expect(document.notes.find(note => note.code === 'excluded')!.message).toContain('1 not run');
    // Only unfinished or not-run results: no rate at all.
    const only = reliability(KEY, await historyOf([{ at: 1_000, run: 'x', status: 'not-run' }]));
    expect(only).toMatchObject({ sample: 'none', eventual: { executions: 0, rate: null } });
  });

  test('7: a status this reader does not know is excluded, not passed', () => {
    const entries = [...executions(2), { ...executions(1)[0]!, status: 'skipped' as never, run: 'run:odd', layer: 'odd', at: 9_000 }];
    const document = reliability(KEY, entries);
    expect(document.eventual.executions).toBe(2);
    expect(document.excluded['unknown-status']).toBe(1);
  });

  test('8: the denominator lists each included execution, and the same scope gives the same figures', async () => {
    const history = await historyOf([
      { at: 1_000, run: 'a', status: 'passed', environment: 'phone' },
      { at: 2_000, run: 'b', status: 'failed', environment: 'phone' },
      { at: 3_000, run: 'c', status: 'passed', environment: 'desktop-web' },
    ]);
    const scope = parseReliabilityScope(new URLSearchParams('environment=phone&since=1970-01-01'));
    expect(scope).toEqual({ environment: ['phone'], since: 0 });
    const document = reliability(KEY, history, scope);
    expect(document.executions.filter(execution => execution.counted).map(execution => [execution.run, execution.status, execution.layer.length])).toEqual([['run:b', 'failed', 64], ['run:a', 'passed', 64]]);
    expect(reliability(KEY, [...history].reverse(), scope)).toEqual(document);
    expect(reliabilityMarkdown(document)).toContain('| run:b |');
    expect(reliabilityMarkdown(document)).toContain('Independent executions counted: 2');
  });

  test('time window selects by when the last word was recorded', async () => {
    const history = await historyOf([1, 2, 3, 4].map(i => ({ at: i * 1_000, run: `r${i}`, status: 'passed' as const })));
    expect(reliability(KEY, history, { since: 2_000, until: 3_000 }).eventual.executions).toBe(2);
  });

  test('parameters, branch and commit narrow the selection', async () => {
    const history = await historyOf([
      { at: 1_000, run: 'a', status: 'passed', parameters: { device: 'small' }, branch: 'main' },
      { at: 2_000, run: 'b', status: 'failed', parameters: { device: 'large' }, branch: 'next' },
    ]);
    expect(reliability(KEY, history, { parameter: ['device=large'] }).eventual).toMatchObject({ executions: 1, failed: 1 });
    expect(reliability(KEY, history, { branch: ['main'] }).eventual).toMatchObject({ executions: 1, passed: 1 });
    expect(reliability(KEY, history, { sha: [SHA.slice(0, 7)] }).eventual.executions).toBe(2);
    expect(reliability(KEY, history, { sha: ['bbbbbbb'] }).eventual.executions).toBe(0);
  });
});
