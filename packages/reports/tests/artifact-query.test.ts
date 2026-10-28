import { describe, expect, test } from 'bun:test';

import { facetsOf, filterParams, joinList, matchesFilter, parseArtifactFilter, splitList, usedFilters } from '../src/artifact-query';
import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { artifactList, artifactsMarkdown, parseTestQuery, runList } from '../src/test-catalog';
import { memoryStore } from './memory-store';

const bytes = (text: string) => new TextEncoder().encode(text);
const video = (name: string, text: string, extra: Record<string, unknown> = {}) => ({ name, contentType: 'video/webm', data: bytes(text), ...extra });
const shot = (name: string, extra: Record<string, unknown> = {}) => ({ name, contentType: 'image/png', data: bytes(name), ...extra });
const RUN = (n: number) => `https://ci.example/runs/${n}`;
const PAY = 'specs/checkout/pay.feature';
const FIND = 'specs/support/find.feature';

/**
 * Demo videos tagged `demo` under several producers and environments, an untagged recording, a tagged screenshot beside an
 * untagged video, and a history where the latest attempt of a test is untagged while an older one was tagged.
 */
async function fixture() {
  const store = memoryStore();
  const pay = { id: 'pay', title: 'Pay with a card', specPath: PAY };
  const find = { id: 'find', title: 'Find by email', specPath: FIND };
  const specs = [{ path: PAY, domain: 'checkout', kind: 'feature', title: 'Pay' }, { path: FIND, domain: 'support', kind: 'feature', title: 'Find' }];
  const base = { specs, branch: 'main' };
  // 1: an old, failed attempt with a tagged demo video on iOS, from a producer spelled one way.
  await publishChecks(store, { ...base, producer: 'Demo-Recorder', environment: 'ios', sha: '1'.repeat(40), runUrl: RUN(1), recordedAtMs: 1_000, checks: [{ ...pay, status: 'failed', labels: { device: 'iPhone' }, attachments: [video('a.webm', 'one', { tags: ['#Demo'] })] }] });
  // 2: a demo on the web by a producer spelled another way.
  await publishChecks(store, { ...base, producer: 'checkout-demos', environment: 'desktop-web', sha: '2'.repeat(40), runUrl: RUN(2), recordedAtMs: 2_000, checks: [{ ...find, status: 'passed', attachments: [video('b.webm', 'two', { tags: ['demo'] })] }] });
  // 3: the latest attempt of "pay" on iOS: a recording nobody tagged.
  await publishChecks(store, { ...base, producer: 'Demo-Recorder', environment: 'ios', sha: '3'.repeat(40), runUrl: RUN(3), recordedAtMs: 3_000, checks: [{ ...pay, status: 'passed', labels: { device: 'iPhone' }, attachments: [video('c.webm', 'three')] }] });
  // 4: a tagged screenshot beside an untagged video: not a tagged video.
  await publishChecks(store, { ...base, producer: 'checkout-demos', environment: 'desktop-web', sha: '4'.repeat(40), runUrl: RUN(4), recordedAtMs: 4_000, checks: [{ ...find, status: 'passed', attachments: [shot('s.png', { tags: ['demo'] }), video('d.webm', 'four')] }] });
  // 5: no evidence at all.
  await publishChecks(store, { ...base, producer: 'plain', environment: 'api', sha: '5'.repeat(40), runUrl: RUN(5), recordedAtMs: 5_000, checks: [{ ...find, status: 'passed' }] });
  const index = new ReportIndex([{ id: 'one', store }]);
  await index.refresh();
  return index.history;
}

const titles = (history: Awaited<ReturnType<typeof fixture>>, query: Parameters<typeof artifactList>[2]) =>
  artifactList(history, 'v', query).results.map(result => `${result.title}@${result.sha?.[0]}`);

describe('splitList and joinList', () => {
  test('a comma or backslash inside a value survives the address', () => {
    for (const values of [['demo', 'release candidate'], ['note=a,b', 'x\\y'], ['#odd,,', 'a\\,b']]) expect(splitList(joinList(values)!)).toEqual(values);
    expect(joinList([])).toBeUndefined();
    expect(splitList(' a , ,b ')).toEqual(['a', 'b']);
  });

  test('both the test query and the artifact query read them', () => {
    const params = new URLSearchParams([['artifactTag', 'a\\,b,c'], ['label', 'k=v'], ['label', 'z']]);
    expect(parseArtifactFilter(params)).toEqual({ artifactTag: ['a,b', 'c'], label: ['k=v', 'z'] });
    expect(parseTestQuery(params).artifactTag).toEqual(['a,b', 'c']);
  });

  test('times are epoch milliseconds or dates; nothing unreadable becomes a filter', () => {
    const filter = parseArtifactFilter(new URLSearchParams('since=2026-01-02&until=1700000000000&video=true&inherited=1'));
    expect(filter).toEqual({ since: Date.UTC(2026, 0, 2), until: 1_700_000_000_000, video: true, inherited: true });
    expect(parseArtifactFilter(new URLSearchParams('since=soon&video=maybe'))).toEqual({});
    expect(usedFilters(filter)).toEqual(['inherited', 'since', 'until', 'video']);
  });
});

describe('artifactList', () => {
  test('finds tagged videos whatever the producer is called (behavior 1)', async () => {
    const history = await fixture();
    expect(titles(history, { artifactTag: ['demo'], type: ['video'] })).toEqual(['Find by email@2', 'Pay with a card@1']);
    expect(titles(history, { artifactTag: ['#DEMO'], type: ['video'] })).toEqual(['Find by email@2', 'Pay with a card@1']);
  });

  test('a tagged screenshot beside an untagged video is not a tagged video, but is a tagged image', async () => {
    const history = await fixture();
    expect(titles(history, { artifactTag: ['demo'], type: ['video'] })).not.toContain('Find by email@4');
    expect(titles(history, { artifactTag: ['demo'], type: ['image'] })).toEqual(['Find by email@4']);
    expect(titles(history, { artifactTag: ['demo'] })).toEqual(['Find by email@4', 'Find by email@2', 'Pay with a card@1']);
  });

  test('combines dimensions with AND and values within one with OR (behavior 2)', async () => {
    const history = await fixture();
    expect(titles(history, { artifactTag: ['demo'], type: ['video'], environment: ['ios'], label: ['device=iPhone'], domain: ['checkout'] })).toEqual(['Pay with a card@1']);
    expect(titles(history, { artifactTag: ['demo'], type: ['video'], environment: ['ios', 'desktop-web'] })).toHaveLength(2);
    expect(titles(history, { artifactTag: ['demo'], type: ['video'], environment: ['ios'], domain: ['support'] })).toEqual([]);
    expect(titles(history, { label: ['device'] })).toEqual(['Pay with a card@3', 'Pay with a card@1']);
  });

  test('facet counts use the list\'s scope, counting each dimension without its own filter', async () => {
    const history = await fixture();
    const list = artifactList(history, 'v', { artifactTag: ['demo'], type: ['video'], environment: ['ios'] });
    expect(list.total).toBe(1);
    // The environments offered are those of every tagged video: choosing the other would add one.
    expect(list.facets.environments).toEqual([{ value: 'desktop-web', count: 1 }, { value: 'ios', count: 1 }]);
    // Types are counted with the tag and environment applied but not the type.
    expect(list.facets.types).toEqual([{ value: 'video', count: 1 }]);
    expect(list.facets.artifactTags).toEqual([{ value: 'demo', count: 1 }]);
    expect(list.facets.outcomes).toEqual([{ value: 'failed', count: 1 }]);
    // A chosen value nothing has stays listed, so it can be removed.
    expect(artifactList(history, 'v', { environment: ['watch'] }).facets.environments.find(facet => facet.value === 'watch')).toEqual({ value: 'watch', count: 0 });
  });

  test('finds a historical recording with its original run, revision and status though the latest attempt is untagged (behavior 3)', async () => {
    const history = await fixture();
    const [found] = artifactList(history, 'v', { artifactTag: ['demo'], environment: ['ios'] }).results;
    expect(found).toMatchObject({ title: 'Pay with a card', status: 'failed', run: RUN(1), runUrl: RUN(1), branch: 'main', sha: '1'.repeat(40), environment: 'ios', domain: 'checkout' });
    expect(found!.layer).toMatch(/^[0-9a-f]{64}$/);
    // The latest result of that test is the untagged one.
    expect(artifactList(history, 'v', { environment: ['ios'] }).results[0]).toMatchObject({ sha: '3'.repeat(40), artifactTags: [] });
  });

  test('narrows by outcome, revision prefix, branch, producer, time and words, and pages', async () => {
    const history = await fixture();
    expect(titles(history, { outcome: ['failed'] })).toEqual(['Pay with a card@1']);
    expect(titles(history, { sha: ['2222222'] })).toEqual(['Find by email@2']);
    expect(titles(history, { sha: ['22'] })).toEqual([]);
    expect(titles(history, { branch: ['release'] })).toEqual([]);
    expect(titles(history, { producer: ['checkout-demos'] })).toEqual(['Find by email@4', 'Find by email@2']);
    expect(titles(history, { since: 2_000, until: 3_000 })).toEqual(['Pay with a card@3', 'Find by email@2']);
    expect(titles(history, { q: 'find email' })).toEqual(['Find by email@4', 'Find by email@2']);
    const page = artifactList(history, 'v', {}, { limit: 1, offset: 1 });
    expect([page.total, page.results.length, page.offset]).toEqual([4, 1, 1]);
    expect(page.filters).toEqual([]);
  });

  test('the result without evidence is not an artifact, and Markdown lists the match', async () => {
    const history = await fixture();
    expect(artifactList(history, 'v').total).toBe(4);
    expect(artifactsMarkdown(artifactList(history, 'v', { artifactTag: ['demo'], type: ['video'] }))).toContain('# Artifacts (2 of 2)');
  });
});

describe('runList filters', () => {
  test('narrows runs by tag, type, label, environment, outcome and time before the limit, and says what it applied', async () => {
    const history = await fixture();
    const demos = runList(history, 'v', 1, { artifactTag: ['demo'], type: ['video'] });
    expect(demos.total).toBe(3);
    expect(demos.runs).toHaveLength(1);
    expect(demos.filters).toEqual(['artifactTag', 'type']);
    expect(runList(history, 'v', 100, { artifactTag: ['demo'], type: ['image'] }).runs.map(run => run.key)).toEqual([RUN(4)]);
    expect(runList(history, 'v', 100, { label: ['device=iPhone'] }).runs.map(run => run.key)).toEqual([RUN(3), RUN(1)]);
    expect(runList(history, 'v', 100, { environment: ['ios'], outcome: ['failed'] }).runs.map(run => run.key)).toEqual([RUN(1)]);
    expect(runList(history, 'v', 100, { since: 4_000 }).runs.map(run => run.key)).toEqual([RUN(5), RUN(4)]);
    expect(runList(history, 'v', 100, { video: true }).total).toBe(4);
    // Domain and spec do not apply to runs, and are not reported as applied.
    expect(runList(history, 'v', 100, { domain: ['support'] }).filters).toEqual([]);
  });

  test('facets count every run, each dimension without its own filter', async () => {
    const history = await fixture();
    const list = runList(history, 'v', 100, { environment: ['ios'] });
    expect(list.facets!.environments.map(facet => [facet.value, facet.count])).toEqual([['desktop-web', 2], ['ios', 2], ['api', 1]]);
    expect(list.facets!.artifactTags).toEqual([{ value: 'demo', count: 1 }]);
    expect(list.runs.find(run => run.key === RUN(1))).toMatchObject({ artifactTags: ['demo'], types: ['video'], labels: ['device=iPhone'] });
  });
});

describe('matchesFilter', () => {
  test('inherited tags only count when asked', async () => {
    const store = memoryStore();
    await publishChecks(store, { producer: 'p', runUrl: RUN(9), recordedAtMs: 1, checks: [{ id: 'a', title: 'A', status: 'passed', tags: ['nightly'], attachments: [shot('s.png')] }] });
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    expect(artifactList(index.history, 'v', { artifactTag: ['nightly'] }).total).toBe(0);
    expect(artifactList(index.history, 'v', { artifactTag: ['nightly'], inherited: true }).total).toBe(1);
    const fields = { text: '', artifactTags: [], tags: [], types: [], media: [], labels: [], environments: [], producers: [], branches: [], shas: [], outcomes: [], at: 0 };
    expect(matchesFilter(fields, {})).toBe(true);
    expect(facetsOf([fields], {}).types).toEqual([]);
  });
});

describe('filterParams', () => {
  test('reads back as the same query, whatever the values contain', () => {
    const filter = { q: 'pay card', artifactTag: ['release,2', 'my tag#1'], type: ['video'], label: ['note=a,b'], since: 1_700_000_000_000, until: 1_800_000_000_000, video: true, inherited: true };
    expect(parseArtifactFilter(new URLSearchParams(filterParams(filter).toString()))).toEqual(filter);
  });
});
