import { describe, expect, test } from 'bun:test';

import { layerEvidence } from '../src/layer-merge';
import { layerSummary, readLayer } from '../src/layer-store';
import {
  boundaryOf, compareLatency, formatLatency, latencyReview, MIN_P50_SAMPLES, MIN_P95_SAMPLES, productLatency,
  type LatencyEntry, type LatencySummary
} from '../src/latency';
import { publishChecks } from '../src/publish-checks';
import { TestHistory } from '../src/test-catalog';
import { memoryStore } from './memory-store';

const latency = (value: number, extra: Record<string, unknown> = {}) => ({
  name: 'Confirmation', value, unit: 'ms', kind: 'product-latency', from: 'submit pressed', to: 'confirmation visible', ...extra
});
const entry = (at: number, measurement: ReturnType<typeof latency> | undefined, more: Partial<LatencyEntry> = {}): LatencyEntry => ({
  at, environment: 'ios', parameters: {}, sha: null, layer: `layer-${at}`, ...(measurement ? { latency: [measurement] } : {}), ...more
});
const many = (count: number, make: (i: number) => ReturnType<typeof latency>, more: (i: number) => Partial<LatencyEntry> = () => ({})) =>
  Array.from({ length: count }, (_, i) => entry(1_000 + i, make(i), more(i)));
const only = (review: ReturnType<typeof latencyReview>, group = 0): LatencySummary => review.metrics[0]!.groups[group]!;

describe('product latency is not test duration', () => {
  test('a 30 second test with a 500 ms confirmation reads 500 ms, and the duration stays the check\'s own', async () => {
    const store = memoryStore();
    const layer = await publishChecks(store, {
      producer: 'e2e', recordedAtMs: 1, checks: [{
        id: 'specs/pay.feature > Pays', title: 'Pays', status: 'passed', specPath: 'specs/pay.feature', durationMs: 30_000,
        measurements: [{ name: 'Fixture setup', value: 20_000, unit: 'ms' }, latency(500, { limit: 800 })]
      }]
    });
    const summary = layerSummary((await readLayer(store, layer.id))!);
    const { layer: header, rows } = layerEvidence(summary, 'one');
    const history = new TestHistory();
    history.add(header, rows, summary.specs);
    const [result] = history.of(JSON.stringify(['specs/pay.feature', 'specs/pay.feature > Pays']));
    expect(result!.durationMs).toBe(30_000);
    expect(result!.latency!.map(m => [m.name, m.value])).toEqual([['Confirmation', 500]]);
    const review = latencyReview([result!]);
    expect(only(review).last).toBe(500);
    expect(only(review).budget).toBe(800);
    expect(review.metrics.map(m => m.metric.name)).toEqual(['Confirmation']);
  });

  test('a paced demo with a long duration and no named measurement has no product latency, which is unknown, not fast', () => {
    const review = latencyReview([{ ...entry(1, undefined), }]);
    expect(review.metrics).toEqual([]);
    expect(review.unmeasured).toBe(1);
    expect(productLatency([{ name: 'Paced wait', value: 4_000, unit: 'ms' }, { name: 'Video', value: 9_000, unit: 'ms', kind: 'duration' }])).toBeUndefined();
  });
});

describe('boundaries', () => {
  test('partial speech timing that stops at TTS dispatch is partial, not microphone to audible response', () => {
    const boundary = boundaryOf({ from: 'end of speech', to: 'tts dispatch', intended: { from: 'end of speech', to: 'audible response' } });
    expect(boundary.state).toBe('partial');
    expect(boundary.intended).toBe('end of speech to audible response');
    const review = latencyReview(many(30, i => latency(300 + i, { name: 'Speech to answer', from: 'end of speech', to: 'tts dispatch', intended: { to: 'audible response' } })));
    const summary = only(review);
    expect(summary.metric.boundary.label).toBe('end of speech to tts dispatch');
    expect(summary.gaps.join(' ')).toContain('Partial');
    expect(summary.gaps.join(' ')).toContain('not end of speech to audible response');
  });

  test('missing boundaries withhold percentiles and the product claim, and say why', () => {
    const summary = only(latencyReview(many(30, i => latency(100 + i, { from: undefined, to: undefined }))));
    expect(summary.claim).toBe(false);
    expect(summary.p50).toBeUndefined();
    expect(summary.p95).toBeUndefined();
    expect(summary.withheld.join(' ')).toContain('boundaries not declared');
    expect(summary.gaps.join(' ')).toContain('does not say what was timed');
  });
});

describe('percentiles and samples', () => {
  test('one observation shows no percentile, confidence or spread', () => {
    const summary = only(latencyReview([entry(1, latency(420))]));
    expect(summary.samples).toBe(1);
    expect(summary.p50).toBeUndefined();
    expect(summary.p95).toBeUndefined();
    expect(summary.withheld.length).toBe(2);
    expect(summary.gaps.join(' ')).toContain('One observation');
  });

  test('p50 appears at its minimum and p95 at its own, by nearest rank', () => {
    const at = (n: number) => only(latencyReview(many(n, i => latency(100 * (i + 1)))));
    expect(at(MIN_P50_SAMPLES - 1).p50).toBeUndefined();
    expect(at(MIN_P50_SAMPLES).p50).toBe(300);
    expect(at(MIN_P95_SAMPLES - 1).p95).toBeUndefined();
    expect(at(MIN_P95_SAMPLES).p95).toBe(1_900);
    expect(at(MIN_P95_SAMPLES).p50).toBe(1_000);
  });

  test('seconds are read as milliseconds so one metric is never pooled in two units', () => {
    const review = latencyReview([entry(1, latency(2, { unit: 's' })), entry(2, latency(500))]);
    expect(review.metrics.length).toBe(1);
    expect(only(review).max).toBe(2_000);
    expect(formatLatency(2_000, 'ms')).toBe('2 s');
    expect(formatLatency(500, 'ms')).toBe('500 ms');
    expect(formatLatency(undefined, 'ms')).toBe('withheld');
  });
});

describe('budgets and groups', () => {
  test('observations are grouped by device, build or window, each with its own percentiles, samples and breaches', () => {
    const entries = [
      ...many(25, i => latency(i < 5 ? 900 : 300, { limit: 800 }), () => ({ environment: 'ios' })),
      ...many(25, () => latency(200, { limit: 800 }), () => ({ environment: 'android' }))
    ];
    const byDevice = latencyReview(entries, 'device').metrics[0]!.groups;
    const ios = byDevice.find(g => g.group === 'ios')!, android = byDevice.find(g => g.group === 'android')!;
    expect([ios.samples, ios.breaches, android.samples, android.breaches]).toEqual([25, 5, 25, 0]);
    expect(ios.p50).toBe(300);
    expect(android.p95).toBe(200);
    const byBuild = latencyReview([
      entry(1, latency(100, { labels: { build: '41' } })), entry(2, latency(120, { labels: { build: '41' } })), entry(3, latency(900, { labels: { build: '42' } })),
      entry(4, latency(100), { sha: 'abcdef0123456789' }), entry(5, latency(100))
    ], 'build').metrics[0]!.groups.map(g => [g.group, g.samples]);
    expect(byBuild).toEqual([['unknown build', 1], ['abcdef0123', 1], ['42', 1], ['41', 2]]);
    const byDay = latencyReview([entry(Date.UTC(2026, 0, 2), latency(1)), entry(Date.UTC(2026, 0, 1), latency(2))], 'window').metrics[0]!.groups.map(g => g.group);
    expect(byDay).toEqual(['2026-01-02', '2026-01-01']);
  });

  test('a p95 over the budget is visible next to the breach count', () => {
    const summary = only(latencyReview(many(20, i => latency(i < 19 ? 100 : 5_000, { limit: 800 }))));
    expect(summary.breaches).toBe(1);
    expect(summary.p95).toBe(100);
    expect(summary.max).toBe(5_000);
  });
});

describe('timeouts and failed observations', () => {
  test('are counted as samples and breaches, never dropped, and mark the figures as lower bounds', () => {
    const healthy = many(10, () => latency(200, { limit: 800 }));
    const stuck = [
      entry(2_000, latency(5_000, { outcome: 'timeout', limit: 800 })),
      entry(2_001, latency(300, { outcome: 'failed', limit: 800 })),
      entry(2_002, latency(300, { outcome: 'somethingnew', limit: 800 }))
    ];
    const summary = only(latencyReview([...healthy, ...stuck]));
    expect(summary.samples).toBe(13);
    expect([summary.observed, summary.timeouts, summary.failures]).toEqual([10, 1, 2]);
    expect(summary.breaches).toBe(3);
    expect(summary.lowerBound).toBe(true);
    expect(summary.max).toBe(5_000);
    expect(summary.gaps.join(' ')).toContain('lower bounds');
  });
});

describe('comparing a candidate with a baseline', () => {
  const side = (value: number, extra: Record<string, unknown> = {}, more: Partial<LatencyEntry> = {}) =>
    only(latencyReview(many(20, () => latency(value, extra), () => more)));

  test('reports the absolute and relative change of comparable metrics', () => {
    const change = compareLatency(side(400), side(500));
    expect(change.comparable).toBe(true);
    expect(change.basis).toBe('p50');
    expect(change.p50).toEqual({ baseline: 400, candidate: 500, absolute: 100, relative: 0.25 });
    expect(change.p95!.absolute).toBe(100);
    expect(change.disclosures).toEqual([]);
  });

  test('discloses a change of instrumentation, environment, conditions and budget beside the change', () => {
    const change = compareLatency(side(400, { instrumentation: 'spans-v1', limit: 800 }), side(380, { instrumentation: 'spans-v2', limit: 600, labels: { network: '3g' } }, { environment: 'android' }));
    expect(change.comparable).toBe(true);
    const text = change.disclosures.join('\n');
    expect(text).toContain('Instrumentation changed: spans-v1 became spans-v2');
    expect(text).toContain('Environments differ');
    expect(text).toContain('network=3g');
    expect(text).toContain('budget differs');
  });

  test('does not compare different boundaries or different metrics', () => {
    const moved = compareLatency(side(400), side(100, { to: 'spinner hidden' }));
    expect(moved.comparable).toBe(false);
    expect(moved.reasons.join(' ')).toContain('measured interval differs');
    expect(compareLatency(side(400), side(100, { name: 'Other' })).comparable).toBe(false);
    expect(compareLatency(side(400, { from: undefined, to: undefined }), side(400, { from: undefined, to: undefined })).comparable).toBe(false);
  });

  test('without percentiles on both sides only the newest observation is compared, and says so', () => {
    const single = only(latencyReview([entry(1, latency(400))]));
    const change = compareLatency(single, side(500));
    expect(change.basis).toBe('last');
    expect(change.p50).toBeUndefined();
    expect(change.last!.relative).toBeCloseTo(0.25);
    expect(change.disclosures.join(' ')).toContain('not supported on both sides');
  });
});
