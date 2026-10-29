import type { TestResultEntry } from '@crvouga/atlas/reports/test-catalog';
import { expect, test } from 'bun:test';

import { entriesInScope, scopedFigures } from './scoped-summary';

const entry = (i: number, over: Partial<TestResultEntry> = {}): TestResultEntry => ({
  at: 1_000 + i, status: 'passed', durationMs: 9_000, environment: 'desktop-web', producer: 'web', kind: 'checks', parameters: {}, branch: 'main',
  sha: 'a'.repeat(40), runUrl: null, run: `run:r${i}`, layer: `l${i}`, backend: 'one', detail: '', ...over
});
const KEY = '["specs/a.feature","a"]';
const latency = (value: number, over: Record<string, unknown> = {}) => ({ name: 'save', kind: 'product-latency', unit: 'ms', value, from: 'tap', to: 'saved', ...over });

test('no history leaves reliability and product latency unknown, never good', () => {
  const figures = scopedFigures(KEY, [], { environment: 'desktop-web' });
  expect(figures.reliability.tone).toBe('unknown');
  expect(figures.reliability.headline).toContain('unknown');
  expect(figures.latency).toHaveLength(1);
  expect(figures.latency[0]!.headline).toContain('unknown');
  // The duration of the test is not a stand-in for the product's response time.
  expect(figures.latency[0]!.qualifiers.join(' ')).toContain('not product latency');
});

test('a rate always names its independent executions and a small sample is insufficient evidence', () => {
  const figures = scopedFigures(KEY, [entry(0), entry(1), entry(2, { status: 'failed' })], { environment: 'desktop-web' });
  expect(figures.reliability.headline).toBe('2 of 3 independent executions passed in the end (66.7%).');
  expect(figures.reliability.tone).toBe('weak');
  expect(figures.reliability.qualifiers.join(' ')).toContain('Insufficient evidence');
  expect(figures.reliability.qualifiers.join(' ')).toContain('First-try success is unknown');
});

test('the scope is the shown result\'s environment: another environment is not pooled into it', () => {
  const history = [entry(0), entry(1, { environment: 'ios', status: 'failed' }), entry(2, { environment: 'ios', status: 'failed' })];
  expect(entriesInScope(history, { environment: 'desktop-web' })).toHaveLength(1);
  expect(entriesInScope(history, { environment: null })).toHaveLength(3);
  const scoped = scopedFigures(KEY, history, { environment: 'desktop-web' });
  expect(scoped.reliability.headline).toContain('1 of 1 independent execution passed');
  expect(scoped.reliability.qualifiers[0]).toContain('desktop-web');
  // With no environment named the executions are pooled, and the figure says so.
  const pooled = scopedFigures(KEY, history, { environment: null });
  expect(pooled.reliability.qualifiers.join(' ')).toMatch(/environments are pooled/i);
});

test('product latency is read only from named measurements, with withheld percentiles explained', () => {
  const history = [entry(0, { latency: [latency(300)] }), entry(1, { latency: [latency(500, { limit: 400 })] }), entry(2)];
  const [line] = scopedFigures(KEY, history, { environment: 'desktop-web' }).latency;
  expect(line!.headline).toContain('save');
  expect(line!.headline).toContain('no percentile can be stated');
  expect(line!.tone).toBe('weak');
  const text = line!.qualifiers.join(' ');
  expect(text).toContain('2 observations');
  expect(text).toContain('1 observation over it');
  expect(text).toContain('p50 needs 5 observations');
});

test('enough observations state p50 and p95 with the budget and its breaches', () => {
  const history = Array.from({ length: 20 }, (_, i) => entry(i, { latency: [latency(100 + i * 10, { limit: 250 })] }));
  const [line] = scopedFigures(KEY, history, { environment: 'desktop-web' }).latency;
  expect(line!.headline).toContain('p50');
  expect(line!.headline).toContain('p95');
  expect(line!.tone).toBe('figure');
  expect(line!.qualifiers.join(' ')).toContain('20 observations');
});
