import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { combineBackends } from '../../reports/src/compose';
import { critiqueAgreement, critiqueStance, markStanding, rankCritiques } from '../../reports/src/critique-review';
import { critiqueMarkOf } from '../../reports/src/critique-row';
import { publishChecks } from '../../reports/src/publish-checks';
import { reportStatus } from '../../reports/src/report-status';
import { catalogEntries } from '../../reports/src/ui-catalog-entries';
import { uiStateLayer } from '../../reports/src/ui-catalog-publish';
import { memoryStore } from '../../reports/tests/memory-store';
import { CritiqueMarkSchema } from '../../schema/src/critique';
import { buildCritique, defineCritic, publishCritiques, type CritiqueOutcome, type JudgeableEntry } from '../src/index';
import { criticScopeViolation } from '../src/scope';
import { markCheckId, markLayer, publishMarks, reviewerName, reviewerProducer, type MarkRequest } from '../src/marks';

const golden = JSON.parse(readFileSync(path.join(import.meta.dir, 'fixtures', 'critique-mark-v1.json'), 'utf8')) as Record<string, unknown>;
const png = (id: string) => new TextEncoder().encode(`png:${id}`);
const critic = (name: string, version = '1.0.0') => defineCritic({ name, version, describe: () => ({ sendsImagesTo: null, needsSetup: false }), evaluate: async () => ({ verdict: { score: 0.5 } }) });

async function world() {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: [{ id: 'home', kind: 'screen', screenshot: { data: png('home') } }, { id: 'spinner', kind: 'loading', screenshot: { data: png('spinner') } }] }));
  return { store };
}

async function entriesOf(store: ReturnType<typeof memoryStore>) {
  const { ReportIndex } = await import('../../reports/src/report-index');
  const index = new ReportIndex([{ id: 'data', store }]);
  await index.refresh();
  return catalogEntries(index.snapshot().layers).entries;
}

const judge = async (store: ReturnType<typeof memoryStore>, c: ReturnType<typeof critic>, entry: { key: string; title: string; state: string; image: { sha256: string } }, answer: Parameters<typeof buildCritique>[3], at: number) => {
  const judgeable: JudgeableEntry = { key: entry.key, title: entry.title, state: entry.state, imageSha256: entry.image.sha256 };
  const outcome: CritiqueOutcome = { entry: judgeable, critique: buildCritique(c, c.describe(), judgeable, answer) };
  return publishCritiques(store, { critic: c, outcomes: [outcome], recordedAtMs: at });
};

describe('the atlas.critique-mark evidence', () => {
  test('the golden mark parses and keeps every field, known or not', () => {
    expect(CritiqueMarkSchema.parse(golden)).toEqual(golden as never);
  });

  test.each([
    ['no subject', (m: Record<string, unknown>) => { delete m.subject; }],
    ['no decision', (m: Record<string, unknown>) => { delete m.decision; }],
    ['a version this release does not know', (m: Record<string, unknown>) => { m.schema = 2; }]
  ])('a mark with %s is dropped by a reader, and the check and its status are kept', async (_, damage) => {
    const bad = structuredClone(golden);
    damage(bad);
    expect(critiqueMarkOf('critique', { extensions: { 'atlas.critique-mark': bad } })).toBeUndefined();
    const store = memoryStore();
    const layer = await publishChecks(store, { recordedAtMs: 5, producer: 'critic.review.pat', kind: 'critique', checks: [{ id: 'critique-mark/x', title: 'x', status: 'passed', extensions: { 'atlas.critique-mark': bad } }] });
    expect(layer.parts[0]!.checks[0]!.status).toBe('passed');
  });

  test('only a part of kind critique carries a mark: the same extension in a test result is ignored', () => {
    expect(critiqueMarkOf('behavior', { extensions: { 'atlas.critique-mark': golden } })).toBeUndefined();
    expect(critiqueMarkOf('critique', { extensions: { 'atlas.critique-mark': golden } })).toMatchObject({ decision: 'accept', finding: 'f1' });
  });

  test('an unknown decision word is kept and counts as neither accept nor dismiss', async () => {
    const { store } = await world();
    const entry = (await entriesOf(store))[0]!;
    const c = critic('vision');
    await judge(store, c, entry, { verdict: { score: 0.3 } }, 2);
    const base: MarkRequest = { entry: { key: entry.key, title: entry.title, imageSha256: entry.image.sha256 }, critic: { name: 'vision' }, decision: 'accept' };
    const layer = markLayer({ reviewer: 'pat', marks: [base], recordedAtMs: 3 });
    (layer.checks![0]!.extensions!['atlas.critique-mark'] as Record<string, unknown>).decision = 'maybe-later';
    await publishChecks(store, layer);
    const [found] = (await entriesOf(store))[0]!.marks;
    expect(found!.mark.decision).toBe('maybe-later');
    expect(markStanding((await entriesOf(store))[0]!.marks, { critic: 'vision' }).state).toBe('unmarked');
  });
});

describe('publishing marks', () => {
  test('a mark is a layer of parts of kind critique under critic.review.<reviewer>, within what a critic token may publish', () => {
    const layer = markLayer({ reviewer: 'Pat Q.', recordedAtMs: 1, marks: [{ entry: { key: 'home', title: 'Home', imageSha256: 'a'.repeat(64) }, critic: { name: 'vision', version: '1.0.0' }, finding: 'f1', decision: 'dismiss', note: 'Fine on purpose' }] });
    expect(layer).toMatchObject({ producer: 'critic.review.pat-q', kind: 'critique' });
    expect(criticScopeViolation({ producer: layer.producer, parts: [{ kind: layer.kind }] })).toBeNull();
    expect(layer.checks![0]!.annotations![0]!.message).toBe("pat-q dismissed vision's finding f1: Fine on purpose");
    expect(layer.checks![0]!.status).toBe('passed');
    expect(() => reviewerName('   ')).toThrow(/reviewer name/);
    expect(reviewerProducer('pat')).toBe('critic.review.pat');
  });

  test('the check id names the entry, the critic and the finding, safely', () => {
    expect(markCheckId({ entry: { key: 'a/b@ios;x=1', title: '', imageSha256: '' }, critic: { name: 'vision' }, finding: 'f 1' })).toBe('critique-mark/a%2Fb%40ios%3Bx%3D1/vision/f%201');
    expect(markCheckId({ entry: { key: 'home', title: '', imageSha256: '' }, critic: { name: 'vision' } })).toBe('critique-mark/home/vision/*');
  });

  test('nothing to mark writes nothing', async () => {
    expect(await publishMarks(memoryStore(), { reviewer: 'pat', marks: [], recordedAtMs: 1 })).toBeNull();
  });

  test('marks reach the entry, a reviewer\'s newer mark replaces their older one, and reviewers are told apart', async () => {
    const { store } = await world();
    const entry = (await entriesOf(store)).find(item => item.stateId === 'home')!;
    const c = critic('vision');
    await judge(store, c, entry, { verdict: { score: 0.3, label: 'needs-polish' }, findings: [{ id: 'f1', category: 'spacing' }] }, 2);
    const request = (decision: 'accept' | 'dismiss', finding?: string): MarkRequest => ({ entry: { key: entry.key, title: entry.title, imageSha256: entry.image.sha256 }, critic: { name: 'vision', version: '1.0.0' }, decision, ...(finding ? { finding } : {}) });
    await publishMarks(store, { reviewer: 'pat', marks: [request('accept'), request('accept', 'f1')], recordedAtMs: 10 });
    let marks = (await entriesOf(store)).find(item => item.stateId === 'home')!.marks;
    expect(marks.map(item => [item.producer, item.mark.decision, item.mark.finding ?? null, item.currency]).sort()).toEqual([['critic.review.pat', 'accept', null, 'current'], ['critic.review.pat', 'accept', 'f1', 'current']]);
    // Pat changes their mind about the whole opinion; Sam dismisses the same finding.
    await publishMarks(store, { reviewer: 'pat', marks: [request('dismiss')], recordedAtMs: 20 });
    await publishMarks(store, { reviewer: 'sam', marks: [request('dismiss', 'f1')], recordedAtMs: 21 });
    marks = (await entriesOf(store)).find(item => item.stateId === 'home')!.marks;
    expect(markStanding(marks, { critic: 'vision' })).toMatchObject({ state: 'dismissed', dismissed: ['pat'], accepted: [] });
    expect(markStanding(marks, { critic: 'vision', finding: 'f1' })).toMatchObject({ state: 'disputed', accepted: ['pat'], dismissed: ['sam'] });
    expect(markStanding(marks, { critic: 'other' }).state).toBe('unmarked');
  });

  test('a mark about a picture the entry no longer has counts for nothing now and is shown as about an earlier picture', async () => {
    const { store } = await world();
    const entry = (await entriesOf(store)).find(item => item.stateId === 'home')!;
    await judge(store, critic('vision'), entry, { verdict: { score: 0.3 } }, 2);
    await publishMarks(store, { reviewer: 'pat', marks: [{ entry: { key: entry.key, title: entry.title, imageSha256: entry.image.sha256 }, critic: { name: 'vision' }, decision: 'accept' }], recordedAtMs: 3 });
    // The picture changes.
    await publishChecks(store, uiStateLayer({ producer: 'cap', recordedAtMs: 50, environment: 'ios', states: [{ id: 'home', kind: 'screen', screenshot: { data: png('home v2') } }] }));
    const changed = (await entriesOf(store)).find(item => item.stateId === 'home')!;
    expect(changed.marks[0]!.currency).toBe('earlier-image');
    expect(markStanding(changed.marks, { critic: 'vision' })).toMatchObject({ state: 'unmarked', earlier: 1 });
  });

  test('marks are never counted and never change the gate', async () => {
    const { store } = await world();
    await publishChecks(store, { recordedAtMs: 4, producer: 'e2e', environment: 'ios', checks: [{ id: 'join', title: 'join', status: 'passed' }, { id: 'leave', title: 'leave', status: 'failed' }] });
    const before = reportStatus(await combineBackends([{ id: 'ci', store }]));
    const entry = (await entriesOf(store)).find(item => item.stateId === 'home')!;
    await judge(store, critic('vision'), entry, { verdict: { score: 0.01 } }, 5);
    await publishMarks(store, { reviewer: 'pat', marks: [{ entry: { key: entry.key, title: entry.title, imageSha256: entry.image.sha256 }, critic: { name: 'vision' }, decision: 'accept' }, { entry: { key: entry.key, title: entry.title, imageSha256: entry.image.sha256 }, critic: { name: 'vision' }, decision: 'dismiss', finding: 'x' }], recordedAtMs: 6 });
    const after = reportStatus(await combineBackends([{ id: 'ci', store }]));
    expect({ ...after, layers: before.layers }).toEqual(before);
  });
});

describe('reading critiques together', () => {
  const sha = (digit: string) => digit.repeat(64);
  const critique = (name: string, extra: Record<string, unknown>) => ({ schema: 1, subject: { entryKey: 'x', imageSha256: sha('a') }, critic: { name, version: '1.0.0' }, ...extra }) as never;

  test('stance: the critic\'s label decides, then findings, then a low standing; a bare score or a failure gives no view', () => {
    expect(critiqueStance(critique('c', { verdict: { score: 0.9, label: 'needs-polish' } }))).toBe('flags');
    expect(critiqueStance(critique('c', { verdict: { score: 0.1, label: 'ok' } }))).toBe('clear');
    expect(critiqueStance(critique('c', { findings: [{ id: 'f1' }] }))).toBe('flags');
    expect(critiqueStance(critique('c', { verdict: { score: 0.4, relative: { stateKind: 'screen', percentile: 20 } } }))).toBe('flags');
    expect(critiqueStance(critique('c', { verdict: { score: 0.4, relative: { stateKind: 'screen', percentile: 60 } } }))).toBe('clear');
    expect(critiqueStance(critique('c', { verdict: { score: 0.4 } }))).toBe('no-view');
    expect(critiqueStance(critique('c', { failure: { reason: 'timeout' }, verdict: { label: 'ok' } }))).toBe('no-view');
  });

  const entryOf = (key: string, state: string, critiques: { critic: string; currency?: 'current' | 'earlier-image'; extra: Record<string, unknown>; at?: number }[]) => ({
    key, state,
    critiques: critiques.map(item => ({ layer: `l-${item.critic}`, producer: `critic.${item.critic}`, recordedAtMs: item.at ?? 1, status: 'passed' as const, currency: item.currency ?? 'current', critique: critique(item.critic, item.extra) }))
  });

  test('agreement compares only each critic\'s current critique of the same picture; no view never makes an agreement', () => {
    const entries = [
      entryOf('a', 'screen', [{ critic: 'uiclip', extra: { verdict: { score: 0.2, relative: { stateKind: 'screen', percentile: 10 } } } }, { critic: 'vision', extra: { verdict: { score: 0.3, label: 'needs-polish' } } }]),
      entryOf('b', 'screen', [{ critic: 'uiclip', extra: { verdict: { score: 0.9, relative: { stateKind: 'screen', percentile: 90 } } } }, { critic: 'vision', extra: { verdict: { score: 0.3, label: 'needs-polish' } } }]),
      entryOf('c', 'loading', [{ critic: 'uiclip', extra: { verdict: { score: 0.9, relative: { stateKind: 'loading', percentile: 90 } } } }, { critic: 'vision', extra: { verdict: { label: 'ok' } } }]),
      entryOf('d', 'screen', [{ critic: 'uiclip', extra: { verdict: { score: 0.5 } } }, { critic: 'vision', extra: { verdict: { label: 'ok' } } }]),
      entryOf('e', 'screen', [{ critic: 'uiclip', extra: { verdict: { score: 0.5 } } }, { critic: 'vision', currency: 'earlier-image', extra: { verdict: { label: 'ok' } } }]),
      entryOf('f', 'screen', [{ critic: 'vision', extra: { verdict: { label: 'ok' } } }])
    ];
    const agreement = critiqueAgreement(entries as never);
    expect(agreement.rows.map(row => [row.entry.key, row.outcome])).toEqual([['a', 'agree-flag'], ['b', 'disagree'], ['d', 'unclear'], ['c', 'agree-clear']]);
    expect(agreement.single).toBe(2);
    expect(agreement.critics).toEqual(['uiclip', 'vision']);
    expect(agreement.rows[0]!.views.map(view => [view.critic, view.stance])).toEqual([['uiclip', 'flags'], ['vision', 'flags']]);
    expect(critiqueAgreement(entries as never, 'loading').rows.map(row => row.entry.key)).toEqual(['c']);
  });

  test('ranking: lowest first, standing within the kind when every score has one, earlier pictures and failures listed apart', () => {
    const entries = [
      entryOf('a', 'screen', [{ critic: 'u', extra: { verdict: { score: 0.5, relative: { stateKind: 'screen', percentile: 80 } } } }]),
      entryOf('b', 'loading', [{ critic: 'u', extra: { verdict: { score: 0.9, relative: { stateKind: 'loading', percentile: 5 } } } }]),
      entryOf('c', 'screen', [{ critic: 'u', currency: 'earlier-image', extra: { verdict: { score: 0.1 } } }]),
      entryOf('d', 'screen', [{ critic: 'u', extra: { failure: { reason: 'timeout' } } }]),
      entryOf('e', 'screen', [])
    ];
    const ranking = rankCritiques(entries as never, 'u');
    expect(ranking.rankedBy).toBe('standing-within-kind');
    expect(ranking.ranked.map(item => item.entry.key)).toEqual(['b', 'a']);
    expect(ranking.unranked.map(item => item.entry.key)).toEqual(['c', 'd']);
    expect(ranking.unjudged).toBe(1);
    expect(rankCritiques(entries as never, 'u', 'loading').ranked.map(item => item.entry.key)).toEqual(['b']);
  });
});
