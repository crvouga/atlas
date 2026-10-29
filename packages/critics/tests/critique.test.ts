import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseLayerDocument } from '../../schema/src/layer';
import { combineBackends } from '../../reports/src/compose';
import { publishChecks } from '../../reports/src/publish-checks';
import { reportStatus } from '../../reports/src/report-status';
import { memoryStore } from '../../reports/tests/memory-store';
import {
  buildCritique, CritiqueSchema, critiqueCheckId, critiqueChecks, critiqueCurrency, critiqueLayer, critiquesOfLayer, criticProducer,
  defineCritic, publishCritiques, readCritique, type CritiqueOutcome, type JudgeableEntry
} from '../src/index';

const golden = JSON.parse(readFileSync(path.join(import.meta.dir, 'fixtures', 'critique-v1.json'), 'utf8')) as Record<string, unknown>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sha = (digit: string) => digit.repeat(64);
const entry = (key: string, imageSha256 = sha('a'), state = 'screen'): JudgeableEntry => ({ key, title: key, state, imageSha256 });
const critic = defineCritic({ name: 'uiclip', version: '2.1.0', kind: 'model', describe: () => ({ sendsImagesTo: null, needsSetup: false, model: { id: 'uiclip-onnx' } }), evaluate: async () => ({ verdict: { score: 0.5 } }) });
const outcome = (e: JudgeableEntry, answer: Parameters<typeof buildCritique>[3]): CritiqueOutcome => ({ entry: e, critique: buildCritique(critic, critic.describe(), e, answer) });
const test1 = (id: string, status: 'passed' | 'failed' = 'passed') => ({ id, title: id, status });
const base = { recordedAtMs: 100, sha: 'a'.repeat(40), branch: 'main' };

describe('the atlas.critique evidence', () => {
  test('the golden critique parses and keeps every field, known or not', () => {
    const parsed = CritiqueSchema.parse(golden);
    expect(parsed).toEqual(golden as never);
  });

  test('a score alone is a valid critique (UIClip)', () => {
    const critique = buildCritique(critic, critic.describe(), entry('home'), { verdict: { score: 0.4, scale: '0..1, higher is better' } });
    expect(CritiqueSchema.safeParse(critique).success).toBe(true);
    expect(critique.findings).toBeUndefined();
    expect(critique.model).toEqual({ id: 'uiclip-onnx' });
  });

  test('an unknown field, category or severity is preserved, never rejected', () => {
    const critique = readCritique({ extensions: { 'atlas.critique': golden } })!;
    expect(critique).not.toBeNull();
    expect((critique as Record<string, unknown>)['com.example.future']).toBe('kept');
    expect(critique.findings![0]!['com.example.future']).toEqual({ kept: true });
    expect(critique.findings![1]).toMatchObject({ category: 'vibes', severity: 'catastrophic-but-fun' });
  });

  test.each([
    ['no subject', (c: Record<string, unknown>) => { delete c.subject; }],
    ['a score that is not a number', (c: Record<string, unknown>) => { (c.verdict as Record<string, unknown>).score = 'high'; }],
    ['a region without a unit', (c: Record<string, unknown>) => { ((c.findings as Record<string, unknown>[])[0]!.region as Record<string, unknown>).unit = ''; }],
    ['a version this release does not know', (c: Record<string, unknown>) => { c.schema = 2; }]
  ])('a critique with %s is dropped by a reader, and the check and its status are kept', async (_, damage) => {
    const bad = clone(golden);
    damage(bad);
    expect(readCritique({ extensions: { 'atlas.critique': bad } })).toBeNull();
    const store = memoryStore();
    const layer = await publishChecks(store, { ...base, producer: 'critic.vision-llm', kind: 'critique', checks: [{ ...test1('critique/x'), extensions: { 'atlas.critique': bad } }] });
    const parsed = parseLayerDocument({ ...layer, schemaVersion: 1 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.layer.parts[0]!.checks[0]!.status).toBe('passed');
    expect(critiquesOfLayer(parsed.layer)).toEqual([]);
  });

  test('an atlas.critique extension on a check that is not in a critique part is not an opinion', async () => {
    const layer = await publishChecks(memoryStore(), { ...base, producer: 'e2e', checks: [{ ...test1('pay'), extensions: { 'atlas.critique': golden } }] });
    expect(critiquesOfLayer(layer)).toEqual([]);
  });
});

describe('publishing critiques as a layer', () => {
  const finding = { id: 'f1', category: 'spacing', severity: 'minor', confidence: 0.7, region: { unit: 'px', x: 1, y: 2, w: 3, h: 4 }, rationale: 'Cramped', suggestion: 'Pad it' };

  test('findings round-trip through the layer unchanged and each is also a standard annotation; the score is a measurement', async () => {
    const store = memoryStore();
    const layer = await publishCritiques(store, { critic, outcomes: [outcome(entry('home'), { verdict: { score: 0.62, label: 'needs-polish' }, findings: [finding, { id: 'f2', severity: 'major', rationale: 'No contrast' }] })], recordedAtMs: 5 });
    expect(layer).not.toBeNull();
    const [found] = critiquesOfLayer(layer!);
    expect(found!.critique.findings![0]).toEqual(finding);
    expect(found!.critique.verdict).toEqual({ score: 0.62, label: 'needs-polish' });
    const check = layer!.parts[0]!.checks[0]!;
    expect(check.annotations!.map(a => [a.type, a.level])).toEqual([['critique', 'warning'], ['critique', 'error']]);
    expect(check.annotations![0]!.message).toContain('Cramped');
    expect(check.measurements).toEqual([{ name: 'polish', value: 0.62, unit: 'score' }]);
    expect(layer!.producer).toBe('critic.uiclip');
    expect(layer!.parts[0]!.kind).toBe('critique');
  });

  test('a score alone is shown by a viewer that knows nothing of critics: a measurement and a label', async () => {
    const [check] = critiqueChecks([outcome(entry('home'), { verdict: { score: 0.4 } })], { threshold: 0.5 });
    expect(check!.measurements).toEqual([{ name: 'polish', value: 0.4, unit: 'score', limit: 0.5 }]);
    expect(check!.status).toBe('passed');
    expect(check!.labels).toEqual({ critic: 'uiclip', 'critic-version': '2.1.0', model: 'uiclip-onnx' });
    expect(check!.id).toBe(critiqueCheckId('home'));
  });

  test('publishing the same outcomes again is the same layer', async () => {
    const args = { critic, outcomes: [outcome(entry('home'), { verdict: { score: 0.4 } })], recordedAtMs: 5 };
    const one = await publishCritiques(memoryStore(), args);
    const two = await publishCritiques(memoryStore(), args);
    expect(two!.id).toBe(one!.id);
  });

  test('nothing to publish writes nothing', async () => {
    expect(await publishCritiques(memoryStore(), { critic, outcomes: [], recordedAtMs: 1 })).toBeNull();
  });

  test('a newer version of the critic replaces the older version\'s critique of the same entry', async () => {
    const store = memoryStore();
    await publishCritiques(store, { critic, outcomes: [outcome(entry('home'), { verdict: { score: 0.2 } })], recordedAtMs: 1 });
    const newer = defineCritic({ ...critic, version: '3.0.0' });
    await publishCritiques(store, { critic: newer, outcomes: [{ entry: entry('home'), critique: buildCritique(newer, newer.describe(), entry('home'), { verdict: { score: 0.9 } }) }], recordedAtMs: 2 });
    const report = await combineBackends([{ id: 'ci', store }]);
    const winners = report.combined.unassigned.filter(result => result.row.kind === 'critique');
    expect(winners.length).toBe(1);
    expect(winners[0]!.row.measurements[0]!.value).toBe(0.9);
  });

  test('a critique of an entry whose image changed is shown as judging an earlier image', () => {
    const critique = buildCritique(critic, critic.describe(), entry('home', sha('a')), { verdict: { score: 0.4 } });
    expect(critiqueCurrency(critique, sha('a'))).toBe('current');
    expect(critiqueCurrency(critique, sha('b'))).toBe('earlier-image');
  });

  test('the producer of a critic\'s layers is critic.<name>', () => {
    expect(criticProducer('uiclip')).toBe('critic.uiclip');
  });
});

describe('critiques never change the gate', () => {
  const tests = [{ ...test1('join'), specPath: 'specs/join.feature' }, test1('leave', 'failed')];

  async function statusWith(critiques: boolean, extra: 'low' | 'crash' | 'none' = 'low') {
    const store = memoryStore();
    await publishChecks(store, { ...base, producer: 'e2e', environment: 'ios', checks: tests });
    if (critiques) {
      const outcomes = [
        outcome(entry('a'), { verdict: { score: 0.01, label: 'needs-polish' } }),
        ...(extra === 'crash' ? [outcome(entry('b'), { failure: { reason: 'error', message: 'boom' } })] : []),
        ...(extra === 'none' ? [] : [])
      ];
      await publishCritiques(store, { critic, outcomes, recordedAtMs: 500 });
    }
    return reportStatus(await combineBackends([{ id: 'ci', store }]));
  }

  test('low scores and a crashed critic leave `atlas report status` exactly as it was', async () => {
    const without = await statusWith(false);
    // `layers` counts every layer that was read, a layer of critiques included; nothing that decides the gate changes.
    const same = (status: typeof without) => ({ ...status, layers: without.layers });
    expect(same(await statusWith(true, 'low'))).toEqual(without);
    expect(same(await statusWith(true, 'crash'))).toEqual(without);
  });

  test('a crashed critic is a failed critique with a reason code, and not a failed check of the report', async () => {
    const store = memoryStore();
    const layer = await publishCritiques(store, { critic, outcomes: [outcome(entry('b'), { failure: { reason: 'timeout', message: 'slow' } })], recordedAtMs: 1 });
    const [found] = critiquesOfLayer(layer!);
    expect(found!.status).toBe('failed');
    expect(found!.critique.failure).toEqual({ reason: 'timeout', message: 'slow' });
    expect(found!.critique.verdict).toBeUndefined();
    const status = reportStatus(await combineBackends([{ id: 'ci', store }]));
    expect(status.failing).toEqual([]);
    expect(status.checks.failed).toBe(0);
  });

  test('critiques are not counted in test totals, not even when they are all there is', async () => {
    const store = memoryStore();
    await publishCritiques(store, { critic, outcomes: [outcome(entry('a'), { verdict: { score: 0.9 } })], recordedAtMs: 1 });
    const status = reportStatus(await combineBackends([{ id: 'ci', store }]));
    expect(status.checks.total).toBe(0);
    expect(status.ok).toBe(false);
    expect(status.reasons).toContain('No checks were found in any layer');
  });

  test('a report with tests and critiques counts only the tests', async () => {
    const status = await statusWith(true, 'low');
    expect(status.checks).toMatchObject({ passed: 1, failed: 1, total: 2 });
  });
});
