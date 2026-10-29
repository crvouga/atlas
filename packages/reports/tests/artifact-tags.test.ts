import { describe, expect, test } from 'bun:test';

import { parseLayerDocument } from '../../schema/src/layer';
import { artifactRef, artifactTagsOf, displayTag, foldArtifactTags, hasArtifactTag, normalizeTag, normalizeTags, targetKey, type ArtifactTagEntry } from '../src/artifact-tags';
import { ArtifactTagError, readArtifactTagEntries, recordArtifactTags } from '../src/artifact-tag-store';
import { summarizeEvidence, summarizeStoredEvidence } from '../src/evidence-detail';
import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { catalogModel, parseTestQuery, testCatalog, type TestQuery } from '../src/test-catalog';
import { memoryStore } from './memory-store';

const LAYER = 'a'.repeat(64);
const target = { layer: LAYER, check: 'c1', artifact: 'id:video' };

describe('normalizing a tag', () => {
  test('demo and #demo are the same tag, whatever the case or the spacing', () => {
    for (const raw of ['demo', '#demo', '##Demo', ' #DEMO ', '# demo']) expect(normalizeTag(raw)).toBe('demo');
    expect(normalizeTag('release candidate')).toBe('release-candidate');
    expect(displayTag('demo')).toBe('#demo');
  });

  test('empty and over-long tags are not tags; any other text stays valid', () => {
    for (const raw of ['', '   ', '#', '###', 'x'.repeat(65)]) expect(normalizeTag(raw)).toBeNull();
    for (const raw of ['team/payments', 'release=2', 'ünïcode', '日本語', 'a.b_c']) expect(normalizeTag(raw)).toBe(raw.toLowerCase());
  });

  test('a list loses its repeats and its non-tags, and keeps the order of the first of each', () => {
    expect(normalizeTags(['#Demo', 'smoke', 'demo', '', '#', 'SMOKE', 'zeta'])).toEqual(['demo', 'smoke', 'zeta']);
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

describe('the tags an attachment shows', () => {
  test('its own, its reviewers, and what it inherits, once each and in that order of precedence', () => {
    const shown = artifactTagsOf({ tags: ['#Demo'] }, { reviewer: [{ tag: 'demo', by: 'ana', atMs: 5 }, { tag: 'review', by: 'ana', atMs: 6 }], inherited: ['demo', 'review', 'nightly'] });
    expect(shown).toEqual([
      { tag: 'demo', source: 'artifact' },
      { tag: 'review', source: 'reviewer', by: 'ana', atMs: 6 },
      { tag: 'nightly', source: 'inherited' }
    ]);
  });

  test('an exact query differs from an inherited one for a recording that is untagged under a tagged run', () => {
    const shown = artifactTagsOf({}, { inherited: ['demo'] });
    expect(shown).toEqual([{ tag: 'demo', source: 'inherited' }]);
    expect(hasArtifactTag(shown, '#demo')).toBe(false);
    expect(hasArtifactTag(shown, '#demo', { inherited: true })).toBe(true);
    expect(hasArtifactTag(artifactTagsOf({ tags: ['demo'] }), 'DEMO')).toBe(true);
    expect(hasArtifactTag(shown, '#')).toBe(false);
  });

  test('an attachment is named by its id, else its bytes, else its name', () => {
    expect(artifactRef({ id: 'v', bundleKey: 'attachments/x', name: 'a.webm' })).toBe('id:v');
    expect(artifactRef({ bundleKey: 'attachments/x', name: 'a.webm' })).toBe('key:attachments/x');
    expect(artifactRef({ name: 'a.webm' })).toBe('name:a.webm');
  });
});

describe('folding the edits of reviewers', () => {
  const entry = (id: string, atMs: number, add: string[], remove: string[], by = 'ana', t = target): ArtifactTagEntry => ({ id, atMs, add, remove, by, target: t });

  test('the last edit of a tag wins, whatever order the entries arrive in, with the author and time of the last add', () => {
    const entries = [entry('3', 30, ['demo'], [], 'bo'), entry('1', 10, ['demo', 'wip'], [], 'ana'), entry('2', 20, [], ['demo'])];
    const folded = foldArtifactTags(entries);
    expect(folded.get(targetKey(target))).toEqual([{ tag: 'wip', by: 'ana', atMs: 10 }, { tag: 'demo', by: 'bo', atMs: 30 }]);
    expect(foldArtifactTags([...entries].reverse())).toEqual(folded);
  });

  test('a target whose tags were all removed is absent, and targets are kept apart', () => {
    const other = { ...target, artifact: 'id:other' };
    const folded = foldArtifactTags([entry('1', 1, ['demo'], []), entry('2', 2, [], ['demo']), entry('3', 3, ['x'], [], 'ana', other)]);
    expect(folded.has(targetKey(target))).toBe(false);
    expect(folded.get(targetKey(other))?.map(item => item.tag)).toEqual(['x']);
  });
});

describe('recording edits in a store', () => {
  test('an edit is a new immutable object with its author and time, and the list reads back oldest first', async () => {
    const store = memoryStore();
    const first = await recordArtifactTags(store, { target, add: ['#Demo', 'demo'] }, 'ana', 100);
    const second = await recordArtifactTags(store, { target, remove: ['DEMO'], add: ['wip'] }, 'bo', 200);
    expect(first).toMatchObject({ add: ['demo'], remove: [], by: 'ana', atMs: 100, target });
    expect(second).toMatchObject({ add: ['wip'], remove: ['demo'], by: 'bo' });
    const read = await readArtifactTagEntries(store);
    expect(read.map(item => item.id)).toEqual([first.id, second.id]);
    expect((await store.listKeys('curation/artifact-tags/')).length).toBe(2);
    expect(await store.listKeys('layers/')).toEqual([]);
  });

  test('a bad edit is refused by name: a bad target, an empty tag, nothing to change', async () => {
    const store = memoryStore();
    for (const body of [null, {}, { target: { ...target, layer: 'nope' }, add: ['x'] }, { target, add: ['#'] }, { target, add: [] }, { target, add: ['x'], remove: ['x'] }, { target, add: ['y'.repeat(65)] }]) {
      await expect(recordArtifactTags(store, body, 'ana', 1)).rejects.toBeInstanceOf(ArtifactTagError);
    }
    expect(await store.listKeys('curation/')).toEqual([]);
  });

  test('an object that is not an edit is skipped, never guessed at', async () => {
    const store = memoryStore();
    await store.put('curation/artifact-tags/0000000000000001-x.json', new TextEncoder().encode('{"hello":1}'), 'application/json');
    await store.put('curation/artifact-tags/0000000000000002-y.json', new TextEncoder().encode('not json'), 'application/json');
    expect(await readArtifactTagEntries(store)).toEqual([]);
  });
});

describe('in a layer', () => {
  const layer = (tags: unknown) => ({
    schemaVersion: 1, id: LAYER, producer: 'e2e', recordedAtMs: 1, sha: null, branch: null, runUrl: null, tags: ['demo'], environment: 'web',
    parts: [{ id: 'p', kind: 'behavior', title: 'p', recordedAtMs: 1, checks: [{ id: 'c1', title: 'Checkout', status: 'passed', attachments: [{ name: 'checkout.webm', role: 'video', ...(tags === undefined ? {} : { tags }) }, { name: 'poster.png' }] }] }]
  });

  test('an attachment carries tags and everything else about old layers is read as before', () => {
    const parsed = parseLayerDocument(layer(['demo']));
    expect(parsed.ok && parsed.layer.parts[0]!.checks[0]!.attachments![0]!.tags).toEqual(['demo']);
    const old = parseLayerDocument(layer(undefined));
    expect(old.ok && old.layer.parts[0]!.checks[0]!.attachments!.map(item => item.tags)).toEqual([undefined, undefined]);
    expect(old.ok && old.layer.tags).toEqual(['demo']);
  });

  test('tags that cannot be read are dropped and the attachment, the check and the layer stay', () => {
    const parsed = parseLayerDocument(layer(['ok', 7, null]));
    expect(parsed.ok && parsed.layer.parts[0]!.checks[0]!.attachments![0]!.tags).toEqual(['ok']);
    const bad = parseLayerDocument(layer('demo'));
    expect(bad.ok && bad.layer.parts[0]!.checks[0]!.attachments!.map(item => [item.name, item.tags])).toEqual([['checkout.webm', undefined], ['poster.png', undefined]]);
    expect(bad.ok && bad.layer.parts[0]!.checks[0]!.status).toBe('passed');
  });

  test('the summary of a result lists the normalized artifact tags apart from the check and run tags, and nothing changes the status', () => {
    const summary = summarizeEvidence({ tags: ['nightly'], attachments: [{ name: 'a.webm', tags: ['#Demo', 'demo'] }], steps: [{ name: 's', attachments: [{ name: 'b.png', tags: ['shot'] }] }] });
    expect(summary).toMatchObject({ tags: ['nightly'], artifactTags: ['demo', 'shot'], attachments: 2 });
    expect(summarizeEvidence({ attachments: [{ name: 'a.webm' }] })?.artifactTags).toBeUndefined();
  });
});

describe('hints to recognise a recording before it is opened', () => {
  test('a video reference carries its declared length and the bundle key of the image it names as its poster', () => {
    const summary = summarizeEvidence({
      attachments: [
        { name: 'pay.webm', id: 'v', durationMs: 4_000, poster: 'p', bundleKey: 'attachments/v' },
        { name: 'pay.png', id: 'p', contentType: 'image/png', bundleKey: 'attachments/p' }
      ]
    });
    expect(summary?.videos).toEqual([{ name: 'pay.webm', owner: 'check', recording: 'attachments/v', available: true, durationMs: 4_000, poster: 'attachments/p' }]);
  });

  test('a hint nobody declared is absent, and a poster that is not an image, is not a sibling or is not stored is left out', () => {
    const plain = summarizeEvidence({ attachments: [{ name: 'a.webm', bundleKey: 'attachments/a' }] })?.videos?.[0];
    expect(plain && 'durationMs' in plain).toBe(false);
    expect(plain && 'poster' in plain).toBe(false);
    const text = summarizeEvidence({ attachments: [{ name: 'a.webm', poster: 'p' }, { name: 'p.txt', id: 'p', bundleKey: 'attachments/p' }] })?.videos?.[0];
    expect(text?.poster).toBeUndefined();
    const stranger = summarizeEvidence({ attachments: [{ name: 'a.webm', poster: 'x' }], steps: [{ name: 's', attachments: [{ name: 'x.png', id: 'x', bundleKey: 'attachments/x' }] }] })?.videos?.[0];
    expect(stranger?.poster).toBeUndefined();
    const lost = summarizeStoredEvidence(undefined, new Set(['attachments/p']), { attachments: [{ name: 'a.webm', poster: 'p', bundleKey: 'attachments/a' }, { name: 'p.png', id: 'p', bundleKey: 'attachments/p' }] })?.videos?.[0];
    expect(lost?.poster).toBeUndefined();
    // The hints never change what is available.
    expect(lost?.available).toBe(true);
  });
});

describe('finding tagged recordings in the report', () => {
  async function model() {
    const store = memoryStore();
    await publishChecks(store, { producer: 'e2e', environment: 'web', recordedAtMs: 10, tags: ['demo-run'], checks: [
      { id: 'tagged', title: 'Tagged', status: 'passed', specPath: 'specs/a.feature', attachments: [{ name: 'a.webm', data: new Uint8Array([1]), contentType: 'video/webm', tags: ['#Demo'] }] },
      { id: 'untagged', title: 'Untagged', status: 'failed', specPath: 'specs/a.feature', attachments: [{ name: 'b.webm', data: new Uint8Array([2]), contentType: 'video/webm' }] }
    ] });
    await publishChecks(store, { producer: 'other', environment: 'web', recordedAtMs: 11, tags: ['demo'], checks: [
      { id: 'inherits', title: 'Inherits', status: 'passed', specPath: 'specs/a.feature', attachments: [{ name: 'c.webm', data: new Uint8Array([3]), contentType: 'video/webm' }] }
    ] });
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    return catalogModel(index.snapshot().layers, { history: index.history, version: 'v', now: 20 });
  }

  test('an exact artifact query finds the tagged recording only; an inherited one also finds what inherits the run tag', async () => {
    const found = await model();
    const ids = (query: TestQuery) => testCatalog(found, query).tests.map(test => test.id).sort();
    expect(ids({ artifactTag: ['demo'] })).toEqual(['tagged']);
    expect(ids({ artifactTag: ['#DEMO'] })).toEqual(['tagged']);
    expect(ids({ artifactTag: ['demo'], inherited: true })).toEqual(['inherits', 'tagged']);
    expect(ids({ artifactTag: ['demo-run'] })).toEqual([]);
    expect(ids({ artifactTag: ['demo-run'], inherited: true })).toEqual(['tagged', 'untagged']);
    expect(ids({ q: '#demo' })).toEqual(['tagged']);
    expect(ids({ artifactTag: ['#'] })).toEqual([]);
    expect(testCatalog(found).facets.artifactTags).toEqual([{ value: 'demo', count: 1 }]);
    expect(testCatalog(found).tests.find(test => test.id === 'tagged')?.artifactTags).toEqual(['demo']);
    expect(parseTestQuery(new URLSearchParams('artifactTag=%23demo,x&inherited=1'))).toEqual({ artifactTag: ['#demo', 'x'], inherited: true });
  });
});
