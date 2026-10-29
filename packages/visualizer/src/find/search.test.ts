import { describe, expect, test } from 'bun:test';
import type { RunResult, RunSummary, TestSummary } from '@crvouga/atlas/reports/test-catalog';

import { behaviorDocs, behaviorId, describeHit, forRuns, resultDoc, runDoc, testHasVideo } from './behaviors';
import { buildCorpus } from './corpus';
import { searchList } from './doc-search';
import { hasFilters, isBlank, parseSearch, passesFilters, withoutToken } from './query';
import { indexCorpus, rankIndex, type FindDoc } from './rank';
import { embedQuery, EMBED_CAP, provideEmbedder, semanticNote } from './semantic-search';
import { applySemantic, type Embedder } from './semantic';

const stats = { results: 1, passed: 1, failed: 0, passRate: 1, flaky: false, flakyReason: '', flips: 0, durations: null, firstSeenMs: null, lastSeenMs: null, lastPassedAtMs: null, lastFailedAtMs: null, runs: 1, branches: ['main'] };

type Options = { id: string; title: string; spec?: string; domain?: string; env?: string[]; tags?: string[]; status?: TestSummary['status']; video?: boolean; flaky?: boolean; detail?: string; producer?: string };
function behavior(options: Options): TestSummary {
  const folder = options.id.split('/')[0]!;
  const spec = options.spec ?? `specs/${folder}/${folder}.feature`;
  const status = options.status ?? 'passed';
  const videos = options.video ? [{ name: 'run.webm', owner: 'check' as const, recording: `rec-${options.id}`, available: true }] : undefined;
  const environments = options.env ?? ['desktop-web'];
  return {
    key: JSON.stringify([spec, options.id]),
    id: options.id,
    title: options.title,
    specPath: spec,
    spec: { path: spec, title: `The ${folder} flows`, domain: options.domain ?? 'answers', kind: 'gherkin' },
    status,
    environments,
    producers: [options.producer ?? 'web'],
    outcomes: environments.map((environment) => ({
      at: 1, status, durationMs: 10, environment, producer: options.producer ?? 'web', kind: 'checks', parameters: {}, branch: 'main', sha: null, runUrl: null, run: 'r1', layer: 'l1', backend: 'b', detail: options.detail ?? '',
      evidence: { attachments: videos ? 1 : 0, steps: 0, annotations: 0, attempts: 0, links: 0, tags: [], labels: {}, roles: videos ? ['video'] : [], ...(videos ? { videos } : {}) }
    })),
    stats: { ...stats, flaky: options.flaky ?? false },
    tags: options.tags ?? [],
    labels: {},
    evidence: { attachments: 0, steps: 0, attempts: 0, roles: [] },
    lastRecordedAtMs: 1,
    live: false
  } as unknown as TestSummary;
}

const ANSWER = behavior({ id: 'memory/keep', title: 'Keep a saved answer', domain: 'checkout', env: ['ios'], video: true });
const OTHERS = [
  behavior({ id: 'memory/forget', title: 'Forget a saved note', domain: 'checkout', env: ['ios'], status: 'failed', detail: 'Expected the note to be gone' }),
  behavior({ id: 'rooms/video', title: 'Join the product video room', domain: 'rooms', env: ['desktop-web'] }),
  behavior({ id: 'checkout/pay', title: 'Pay for the order', domain: 'checkout', env: ['android'], tags: ['smoke'] }),
  behavior({ id: 'billing/refund', title: 'Refund a payment', domain: 'billing', env: ['desktop-web'], flaky: true }),
  behavior({ id: 'profile/photo', title: 'Change a profile photo', domain: 'profile', env: ['ios', 'android'] })
];
const TESTS = [ANSWER, ...OTHERS];

function listIds(query: string, tests: readonly TestSummary[] = TESTS): string[] {
  const docs = [...behaviorDocs(tests).values()];
  const parsed = parseSearch(query);
  const hits = searchList(indexCorpus(docs), parsed);
  return docs.filter((doc) => (!hits || hits.has(doc.id)) && passesFilters(doc.facets, parsed.filters)).map((doc) => doc.id);
}

describe('the query language', () => {
  test('reads words, quoted phrases, identifiers and filters apart', () => {
    const parsed = parseSearch('domain:checkout has:video platform:ios status:failed "saved answer" lists/add.feature keep');
    expect(parsed.words).toBe('keep');
    expect(parsed.phrases).toEqual(['saved answer']);
    expect(parsed.identifiers).toEqual(['lists/add.feature']);
    expect(parsed.filters).toEqual({ status: ['failed'], env: ['ios'], producer: [], domain: ['checkout'], spec: [], tag: [], branch: [], video: true });
    expect(parsed.issues).toEqual([]);
    expect(parsed.tokens.map((token) => token.key)).toEqual(['domain', 'video', 'env', 'status']);
  });

  test('several values and repeated fields are alternatives; a quoted value keeps its spaces', () => {
    const parsed = parseSearch('status:failed,flaky env:ios env:android domain:"user account" tag:#smoke');
    expect(parsed.filters.status).toEqual(['failed', 'flaky']);
    expect(parsed.filters.env).toEqual(['ios', 'android']);
    expect(parsed.filters.domain).toEqual(['user account']);
    expect(parsed.filters.tag).toEqual(['smoke']);
  });

  test('what cannot be used is reported, never dropped silently, and filters nothing', () => {
    const parsed = parseSearch('colour:red status:great has:smell domain: "" "never closed');
    expect(parsed.issues.map((issue) => issue.token)).toEqual(['colour:red', 'status:great', 'has:smell', 'domain:', '""', '"never']);
    expect(parsed.issues.every((issue) => issue.message.includes('has:video'))).toBe(true);
    expect(hasFilters(parsed.filters)).toBe(false);
    expect(parsed.words).toContain('closed');
  });

  test('prose with a colon is a word, and a blank query is blank', () => {
    expect(parseSearch('Done: all').words).toBe('Done all');
    expect(isBlank(parseSearch('   '))).toBe(true);
    expect(isBlank(parseSearch('has:video'))).toBe(false);
  });

  test('removing a filter leaves the rest of the text as typed', () => {
    const parsed = parseSearch('keep status:failed answer');
    expect(withoutToken(parsed.raw, parsed.tokens[0]!)).toBe('keep answer');
  });
});

describe('one matching rule everywhere', () => {
  const index = indexCorpus([...behaviorDocs(TESTS).values()]);

  test('a misspelling finds the behavior in the finder, the list and the results of a run', () => {
    // The finder: the corpus of a project (its runs group holds the same behaviors).
    const corpus = buildCorpus({
      charts: [], states: [], transitions: [], journeys: [], files: [], texts: new Map(), explorer: true,
      tests: new Map(TESTS.map((test) => [test.key, test])),
      slots: TESTS.map((test) => ({ key: test.key, id: test.id, title: test.title, specPath: test.specPath, status: test.status, detail: '', recording: false }))
    });
    const finder = rankIndex(indexCorpus(corpus), 'savde answer', Infinity).filter((hit) => !hit.partial && !hit.related).map((hit) => hit.doc.id);
    expect(finder).toContain(behaviorId(ANSWER.key));

    // The list.
    const list = [...searchList(index, parseSearch('savde answer'))!.keys()];
    expect(list).toContain(behaviorId(ANSWER.key));

    // The results of a run: the same index, narrowed to what the run recorded.
    const results: RunResult[] = [ANSWER, OTHERS[0]!].map((test) => ({ key: test.key, id: test.id, title: test.title, specPath: test.specPath, environment: 'ios', producer: 'web', status: test.status, durationMs: 5, at: 1, layer: 'l1', detail: '' }));
    const inRun = results.filter((result) => list.includes(behaviorId(result.key))).map((result) => behaviorId(result.key));
    expect(inRun).toEqual([behaviorId(ANSWER.key)]);

    // Identical eligible identities, not merely overlapping ones.
    expect([...list].sort()).toEqual([...finder].sort());
  });

  test('every distinctive word must be found; a typed prefix finds the word being typed', () => {
    expect(listIds('saved answer')).toEqual([behaviorId(ANSWER.key)]);
    expect(listIds('refu')).toEqual([behaviorId(OTHERS[3]!.key)]);
    expect(listIds('nothing like it')).toEqual([]);
  });

  test('metadata is searchable: domain, tags, environment and the first line of a failure', () => {
    expect(listIds('smoke')).toEqual([behaviorId(OTHERS[2]!.key)]);
    expect(listIds('android')).toEqual([behaviorId(OTHERS[2]!.key), behaviorId(OTHERS[4]!.key)].sort((a, b) => TESTS.findIndex((t) => behaviorId(t.key) === a) - TESTS.findIndex((t) => behaviorId(t.key) === b)));
    expect(listIds('expected gone')).toEqual([behaviorId(OTHERS[0]!.key)]);
  });
});

describe('media availability is a filter, not a word', () => {
  test('has:video keeps only behaviors with a playable recording, whatever their titles say', () => {
    expect(testHasVideo(ANSWER)).toBe(true);
    expect(listIds('has:video')).toEqual([behaviorId(ANSWER.key)]);
    // The word finds the title that says it, and not the recording.
    expect(listIds('video')).toEqual([behaviorId(OTHERS[1]!.key)]);
    expect(listIds('video has:video')).toEqual([]);
  });

  test('a video reference that names no file is not a recording', () => {
    const gone = behavior({ id: 'x/gone', title: 'Gone', video: true });
    (gone.outcomes[0]!.evidence!.videos as unknown as { available: boolean; recording?: string }[])[0] = { available: false } as never;
    expect(testHasVideo(gone)).toBe(false);
  });
});

describe('filters combine over the whole dataset', () => {
  const many = Array.from({ length: 300 }, (_, at) =>
    behavior({ id: `bulk/${at}`, title: `Bulk invoice ${at}`, domain: at % 2 ? 'billing' : 'checkout', env: at % 3 === 0 ? ['ios'] : ['android'], status: at % 5 === 0 ? 'failed' : 'passed', video: at % 7 === 0, spec: `specs/bulk/${at}.feature` })
  );

  test('different fields are ANDed, several values of one field are ORed, and nothing is paged away', () => {
    expect(listIds('invoice', many)).toHaveLength(300);
    const expected = (check: (at: number) => boolean) => many.filter((_, at) => check(at)).length;
    expect(listIds('invoice domain:billing', many)).toHaveLength(expected((at) => at % 2 === 1));
    expect(listIds('invoice domain:billing,checkout', many)).toHaveLength(300);
    expect(listIds('invoice domain:billing env:ios', many)).toHaveLength(expected((at) => at % 2 === 1 && at % 3 === 0));
    expect(listIds('invoice env:ios env:android status:failed has:video', many)).toHaveLength(expected((at) => at % 5 === 0 && at % 7 === 0));
  });

  test('counts can leave one filter out, to say what a button would add', () => {
    const docs = [...behaviorDocs(many).values()];
    const parsed = parseSearch('status:failed env:ios');
    const both = docs.filter((doc) => passesFilters(doc.facets, parsed.filters));
    const withoutStatus = docs.filter((doc) => passesFilters(doc.facets, parsed.filters, new Set(['status'])));
    expect(withoutStatus.length).toBeGreaterThan(both.length);
    expect(withoutStatus.every((doc) => doc.facets!.env.includes('ios'))).toBe(true);
  });

  test('a document that carries no facets satisfies no filter', () => {
    expect(passesFilters(undefined, parseSearch('status:failed').filters)).toBe(false);
    expect(passesFilters(undefined, parseSearch('plain words').filters)).toBe(true);
  });
});

describe('exact matches are distinguishable and explained', () => {
  const index = indexCorpus([...behaviorDocs(TESTS).values()]);

  test('a quoted phrase must appear as written and is reported as exact', () => {
    const hits = searchList(index, parseSearch('"saved answer"'))!;
    expect([...hits.keys()]).toEqual([behaviorId(ANSWER.key)]);
    const hit = hits.get(behaviorId(ANSWER.key))!;
    expect(hit.exact).toBe(true);
    expect(describeHit(hit)).toContain('Exact: “saved answer”');
    expect(searchList(index, parseSearch('"answer saved"'))!.size).toBe(0);
  });

  test('an identifier is matched literally, and exact results rank before fuzzy ones', () => {
    const hits = searchList(index, parseSearch('memory/keep'))!;
    expect([...hits.keys()]).toEqual([behaviorId(ANSWER.key)]);
    expect(hits.get(behaviorId(ANSWER.key))!.exact).toBe(true);
    const mixed = searchList(index, parseSearch('saved "keep a saved"'))!;
    expect([...mixed.keys()][0]).toBe(behaviorId(ANSWER.key));
  });

  test('a fuzzy hit says which fields matched and that the spelling was close', () => {
    const hit = searchList(index, parseSearch('savde answer'))!.get(behaviorId(ANSWER.key))!;
    expect(hit.exact).toBeUndefined();
    expect(hit.fuzzy).toBe(true);
    expect(describeHit(hit)).toBe('Matches title (close spelling)');
    const meta = searchList(index, parseSearch('smoke'))!.get(behaviorId(OTHERS[2]!.key))!;
    expect(describeHit(meta)).toBe('Matches tags and details');
    const failure = searchList(index, parseSearch('expected gone'))!.get(behaviorId(OTHERS[0]!.key))!;
    expect(describeHit(failure)).toBe('Matches description');
  });
});

describe('runs and their results', () => {
  const run = (key: string, extra: Partial<RunSummary> = {}): RunSummary =>
    ({ key, runUrl: null, branch: 'main', sha: 'abcdef1234', startedAtMs: 1, endedAtMs: 2, spanMs: 1, producers: ['web'], environments: ['ios'], layers: 1, tests: 2, counts: { passed: 1, failed: 1, running: 0, 'not-run': 0 }, totalDurationMs: null, failing: [{ key: 'k', title: 'Keep a saved answer', environment: 'ios', detail: 'Expected tea' }], ...extra }) as RunSummary;

  test('a run is found by the behavior that failed in it, and run filters apply to its facets', () => {
    const failing = runDoc(run('run:1'), 'Run 1');
    const green = runDoc(run('run:2', { counts: { passed: 2, failed: 0, running: 0, 'not-run': 0 }, failing: [], videos: { references: 1, recordings: 1, unavailable: 0 } }), 'Run 2');
    const index = indexCorpus([failing, green]);
    expect([...searchList(index, parseSearch('savde answer'))!.keys()]).toEqual([failing.id]);
    expect(passesFilters(failing.facets, parseSearch('status:failed').filters)).toBe(true);
    expect(passesFilters(green.facets, parseSearch('status:failed').filters)).toBe(false);
    expect(passesFilters(green.facets, parseSearch('has:video env:ios').filters)).toBe(true);
    expect(passesFilters(failing.facets, parseSearch('has:video').filters)).toBe(false);
  });

  test('filters a run does not have are said so rather than emptying the list', () => {
    const parsed = forRuns(parseSearch('domain:checkout status:failed'));
    expect(parsed.issues.map((issue) => issue.token)).toEqual(['domain:checkout']);
    expect(parsed.issues[0]!.message).toContain('does not apply to runs');
    expect(hasFilters({ ...parsed.filters, status: [] })).toBe(false);
    expect(parsed.tokens.map((token) => token.key)).toEqual(['status']);
  });

  test('a result of a run takes the status, environment and videos of that run, with the behavior’s own words', () => {
    const result: RunResult = { key: ANSWER.key, id: ANSWER.id, title: ANSWER.title, specPath: ANSWER.specPath, environment: 'android', producer: 'api', status: 'failed', durationMs: 1, at: 1, layer: 'l', detail: '' };
    const doc = resultDoc(result, ANSWER);
    expect(doc.id).toBe(behaviorId(ANSWER.key));
    expect(doc.facets).toMatchObject({ status: ['failed'], env: ['android'], producer: ['api'], video: false, domain: ['checkout'] });
    expect(doc.fields).toEqual(behaviorDocs(TESTS).get(ANSWER.key)!.fields);
    const orphan = resultDoc(result, undefined);
    expect(orphan.title).toBe(ANSWER.title);
    expect(orphan.facets!.env).toEqual(['android']);
  });
});

describe('meaning-based search', () => {
  /** A fake model: the words of a text vote for a topic. */
  const TOPICS: Record<string, number> = { keep: 0, saved: 0, remember: 0, reply: 0, answer: 0, pay: 1, refund: 1, payment: 1, photo: 2 };
  const fake: Embedder = {
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Float32Array(3);
        for (const word of text.toLowerCase().split(/[^a-z]+/)) if (word in TOPICS) vector[TOPICS[word]!]! += 1;
        return vector;
      });
    }
  };
  const docs = [...behaviorDocs(TESTS).values()];
  const index = indexCorpus(docs);

  async function semanticList(query: string, provider: Embedder) {
    const parsed = parseSearch(query);
    const vectors = new Map<string, Float32Array>();
    let queryVector: Float32Array | null = null;
    await embedQuery(provider, parsed.words, docs, {
      cancelled: () => false,
      onQuery: (vector) => (queryVector = vector),
      onBatch: () => {}
    });
    const { cachedVectors } = await import('./semantic-search');
    for (const [id, vector] of cachedVectors(docs)) vectors.set(id, vector);
    return searchList(index, parsed, { queryVector, vectors, docs });
  }

  test('a behavior with no word in common is returned when a provider is available', async () => {
    provideEmbedder(null);
    expect(searchList(index, parseSearch('remember reply'))?.size ?? 0).toBe(0);
    const hits = await semanticList('remember reply', fake);
    expect([...hits!.keys()]).toContain(behaviorId(ANSWER.key));
    const hit = hits!.get(behaviorId(ANSWER.key))!;
    expect(hit.semantic).toBe(true);
    expect(describeHit(hit)).toBe('Similar meaning');
    // Unrelated behaviors stay out.
    expect(hits!.has(behaviorId(OTHERS[4]!.key))).toBe(false);
  });

  test('a provider that fails rejects, and the lexical results are what is left', async () => {
    const broken: Embedder = { embed: async () => Promise.reject(new Error('model offline')) };
    await expect(semanticList('keep answer', broken)).rejects.toThrow('model offline');
    const lexical = searchList(index, parseSearch('keep answer'))!;
    expect([...lexical.keys()]).toContain(behaviorId(ANSWER.key));
    expect(semanticNote('failed')).toContain('words and spellings only');
    expect(semanticNote('unavailable')).toContain('not available');
    expect(semanticNote('working')).toContain('Refining');
    expect(semanticNote('ready')).toBeNull();
  });

  test('an exact phrase is never replaced by a paraphrase', async () => {
    const hits = await semanticList('"remember reply"', fake);
    expect(hits!.size).toBe(0);
  });

  test('applySemantic keeps exact hits ahead of semantic ones', () => {
    const first: FindDoc = docs[0]!;
    const second: FindDoc = docs[1]!;
    const ranked = applySemantic([first, second], [{ doc: second, score: 1, snippet: '', exact: true }, { doc: first, score: 50, snippet: '' }], Float32Array.of(1, 0, 0), new Map(), 10);
    expect(ranked[0]!.doc.id).toBe(second.id);
  });

  test('only the best candidates are embedded', async () => {
    const seen: string[][] = [];
    const counting: Embedder = { embed: async (texts) => { seen.push([...texts]); return texts.map(() => Float32Array.of(1)); } };
    const crowd: FindDoc[] = Array.from({ length: EMBED_CAP + 50 }, (_, at) => ({ ...docs[0]!, id: `d${at}`, title: `Title ${at}`, fields: [{ name: 'title', text: `Title ${at}` }] }));
    provideEmbedder(null);
    await embedQuery(counting, 'q', crowd, { cancelled: () => false, onQuery: () => {}, onBatch: () => {} });
    expect(seen.flat().length).toBeLessThanOrEqual(EMBED_CAP + 1);
  });
});
