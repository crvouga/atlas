import { describe, expect, test } from 'bun:test';

import { calibrate, gateDecision, relativeVerdict, type Calibration, type LabelledExample } from '../src/index';

const critic = { name: 'uiclip', version: '1.0.0' };

describe('state-aware verdicts', () => {
  const population = [
    ...[0.1, 0.2, 0.3, 0.4].map(score => ({ stateKind: 'loading', score })),
    ...[0.6, 0.7, 0.8, 0.9].map(score => ({ stateKind: 'screen', score }))
  ];

  test('the same raw score is reported relative to its own state kind', () => {
    const loading = relativeVerdict({ score: 0.4, stateKind: 'loading', population });
    const screen = relativeVerdict({ score: 0.4, stateKind: 'screen', population });
    expect(loading).toMatchObject({ stateKind: 'loading', sampleSize: 4, percentile: 87.5 });
    expect(screen).toMatchObject({ stateKind: 'screen', sampleSize: 4, percentile: 0 });
  });

  test('records the change against the same entry\'s previous image', () => {
    expect(relativeVerdict({ score: 0.5, stateKind: 'screen', population, previousScore: 0.7 })).toMatchObject({ previousScore: 0.7, delta: -0.2 });
  });

  test('says nothing about a percentile when no score of that state kind is known', () => {
    const relative = relativeVerdict({ score: 0.5, stateKind: 'error', population });
    expect(relative).toEqual({ stateKind: 'error', sampleSize: 0 });
  });
});

describe('calibrate', () => {
  const examples = (kind: string, good: number[], bad: number[], heldOut?: boolean): LabelledExample[] => [
    ...good.map(score => ({ score, stateKind: kind, bad: false, ...(heldOut ? { heldOut } : {}) })),
    ...bad.map(score => ({ score, stateKind: kind, bad: true, ...(heldOut ? { heldOut } : {}) }))
  ];

  test('reports precision and recall per state kind with sample sizes, and says the figures are in-sample', () => {
    const result = calibrate(critic, [...examples('screen', [0.8, 0.9, 0.7], [0.2, 0.3, 0.4]), ...examples('loading', [0.3, 0.4], [0.1, 0.2])]);
    expect(result.critic).toEqual(critic);
    expect(result.kinds.map(kind => kind.stateKind)).toEqual(['loading', 'screen']);
    const screen = result.kinds.find(kind => kind.stateKind === 'screen')!;
    expect(screen).toMatchObject({ samples: 6, positives: 3, negatives: 3, precision: 1, recall: 1, inSample: true, evaluatedOn: 'fit' });
    expect(screen.threshold).toBeGreaterThan(0.4);
    expect(screen.threshold).toBeLessThanOrEqual(0.7);
    const loading = result.kinds.find(kind => kind.stateKind === 'loading')!;
    expect(loading).toMatchObject({ samples: 4, positives: 2, negatives: 2 });
    expect(loading.threshold).toBeGreaterThan(0.2);
    expect(loading.threshold).toBeLessThanOrEqual(0.3);
  });

  test('with held-out examples the figures are measured on them, and are not in-sample', () => {
    const result = calibrate(critic, [...examples('screen', [0.8, 0.9], [0.2, 0.3]), ...examples('screen', [0.75, 0.35], [0.6, 0.25], true)]);
    const screen = result.kinds[0]!;
    expect(screen).toMatchObject({ inSample: false, evaluatedOn: 'held-out', samples: 8 });
    // On the held-out set a good 0.35 is flagged and a bad 0.6 is missed, so the figures are not perfect.
    expect(screen.precision).toBeLessThan(1);
    expect(screen.recall).toBeLessThan(1);
  });

  test('a state kind with only one class has no threshold, and says so', () => {
    const result = calibrate(critic, examples('error', [0.9, 0.8], []));
    expect(result.kinds[0]).toMatchObject({ threshold: null, precision: null, recall: null });
  });

  test('is deterministic', () => {
    const input = examples('screen', [0.8, 0.5, 0.9], [0.2, 0.6, 0.4]);
    expect(calibrate(critic, input)).toEqual(calibrate(critic, [...input].reverse()));
  });
});

describe('modes', () => {
  const scores = [
    { entryKey: 'home', stateKind: 'screen', score: 0.3 },
    { entryKey: 'spinner', stateKind: 'loading', score: 0.9 },
    { entryKey: 'broken', stateKind: 'screen', score: null }
  ];
  const sufficient = (heldOut: boolean): Calibration => ({
    schema: 1, critic,
    kinds: ['screen', 'loading'].map(stateKind => ({ stateKind, threshold: 0.5, samples: 40, positives: 20, negatives: 20, precision: 0.9, recall: 0.8, inSample: !heldOut, evaluatedOn: heldOut ? 'held-out' as const : 'fit' as const }))
  });

  test('report mode exits 0 when a critique is below the threshold', () => {
    const decision = gateDecision({ mode: 'report', critic, scores, thresholds: { screen: 0.5 } });
    expect(decision.exitCode).toBe(0);
    expect(decision.below).toEqual([{ entryKey: 'home', stateKind: 'screen', score: 0.3, threshold: 0.5 }]);
    expect(decision.warnings).toEqual([]);
    expect(decision.unjudged).toEqual(['broken']);
  });

  test('warn mode surfaces a warning and still exits 0', () => {
    const decision = gateDecision({ mode: 'warn', critic, scores, thresholds: { screen: 0.5 } });
    expect(decision.exitCode).toBe(0);
    expect(decision.warnings).toEqual(['home (screen) scored 0.3, below 0.5']);
  });

  test('gate mode exits 1 when a threshold is crossed on a calibration with enough held-out evidence', () => {
    const decision = gateDecision({ mode: 'gate', critic, scores, calibration: sufficient(true) });
    expect(decision.exitCode).toBe(1);
    expect(decision.refusal).toEqual([]);
    expect(decision.below.map(item => item.entryKey)).toEqual(['home']);
  });

  test('gate mode exits 0 when nothing is below its threshold', () => {
    expect(gateDecision({ mode: 'gate', critic, scores: [{ entryKey: 'ok', stateKind: 'screen', score: 0.9 }], calibration: sufficient(true) }).exitCode).toBe(0);
  });

  test('gate mode refuses without a calibration, and says why', () => {
    const decision = gateDecision({ mode: 'gate', critic, scores, thresholds: { screen: 0.5, loading: 0.5 } });
    expect(decision.exitCode).toBe(2);
    expect(decision.below).toEqual([]);
    expect(decision.refusal.join('\n')).toContain('No calibration for state kind "screen"');
  });

  test('gate mode refuses an in-sample calibration, too little evidence, and a calibration of another version', () => {
    expect(gateDecision({ mode: 'gate', critic, scores, calibration: sufficient(false) }).refusal.join('\n')).toContain('in-sample');
    const thin: Calibration = { ...sufficient(true), kinds: sufficient(true).kinds.map(kind => ({ ...kind, positives: 3 })) };
    expect(gateDecision({ mode: 'gate', critic, scores, calibration: thin }).refusal.join('\n')).toContain('3 bad and 20 good');
    const other = gateDecision({ mode: 'gate', critic: { ...critic, version: '2.0.0' }, scores, calibration: sufficient(true) });
    expect(other.exitCode).toBe(2);
    expect(other.refusal[0]).toContain('uiclip@1.0.0');
  });

  test('an explicit threshold never waives the evidence', () => {
    const decision = gateDecision({ mode: 'gate', critic, scores, calibration: sufficient(false), thresholds: { screen: 0.9 } });
    expect(decision.exitCode).toBe(2);
  });
});
