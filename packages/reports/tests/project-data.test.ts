import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SpecSetSchema } from '../../schema/src/layer';
import { publishRunBundle, listRunSummaries, readRunFile, RunNotShareableError } from '../src/run-bundle';
import { collectSpecFiles, latestSpecSet, publishSpecSet, readSpecBody, readSpecSet } from '../src/spec-set';
import { memoryStore } from './memory-store';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'atlas-project-'));
  await mkdir(path.join(root, 'specs', 'nested'), { recursive: true });
  await mkdir(path.join(root, 'specs', 'node_modules'), { recursive: true });
  await writeFile(path.join(root, 'specs', 'join.feature'), 'Feature: Join a list\n  Scenario: Joins\n');
  await writeFile(path.join(root, 'specs', 'nested', 'book.qnt'), 'module Booking {\n}\n');
  await writeFile(path.join(root, 'specs', 'app.machine.yaml'), 'id: app\n');
  await writeFile(path.join(root, 'specs', 'logo.png'), 'not a spec');
  await writeFile(path.join(root, 'specs', 'node_modules', 'x.feature'), 'Feature: no');
  await writeFile(path.join(root, 'specs', '.hidden.feature'), 'Feature: no');
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('spec sets: the specs are layered too', () => {
  test('a directory becomes spec files by the names checks use, and nothing else', async () => {
    expect((await collectSpecFiles(path.join(root, 'specs'))).map(file => file.path)).toEqual(['specs/app.machine.yaml', 'specs/join.feature', 'specs/nested/book.qnt']);
  });

  test('a set is named by what it holds: publishing the same specs from the same commit twice is one set', async () => {
    const store = memoryStore();
    const files = await collectSpecFiles(path.join(root, 'specs'));
    const input = { files, branch: 'main', sha: 'a'.repeat(40), recordedAtMs: 100 };
    const one = await publishSpecSet(store, input);
    const writes = (await store.listKeys()).length;
    const two = await publishSpecSet(store, input);
    expect(two.id).toBe(one.id);
    expect((await store.listKeys()).length).toBe(writes);
    SpecSetSchema.parse(await readSpecSet(store, one.id));
    const join = one.files.find(file => file.path === 'specs/join.feature')!;
    expect([join.kind, join.title]).toEqual(['gherkin', 'Join a list']);
    expect(await readSpecBody(store, join.digest)).toContain('Scenario: Joins');
    expect(await readSpecBody(store, 'not-a-digest')).toBeNull();
  });

  test('a spec that did not change is not uploaded again', async () => {
    const store = memoryStore();
    const files = [{ path: 'specs/a.feature', text: 'Feature: A' }, { path: 'specs/b.feature', text: 'Feature: B' }];
    await publishSpecSet(store, { files, branch: 'main', sha: '1'.repeat(40), recordedAtMs: 1 });
    const before = (await store.listKeys('layers/specs/blobs/')).length;
    await publishSpecSet(store, { files: [files[0]!, { path: 'specs/b.feature', text: 'Feature: B changed' }], branch: 'main', sha: '2'.repeat(40), recordedAtMs: 2 });
    expect((await store.listKeys('layers/specs/blobs/')).length).toBe(before + 1);
  });

  test('the outline is the newest set of main, wherever it was published, unless another branch is asked for', async () => {
    const shared = memoryStore(), laptop = memoryStore();
    const publish = (store: typeof shared, branch: string, at: number, text: string) => publishSpecSet(store, { files: [{ path: 'specs/a.feature', text }], branch, sha: null, recordedAtMs: at });
    await publish(shared, 'main', 10, 'Feature: Old main');
    await publish(laptop, 'main', 20, 'Feature: New main');
    await publish(laptop, 'feat/x', 30, 'Feature: Experiment');
    expect((await latestSpecSet([shared, laptop]))!.set.files[0]!.title).toBe('New main');
    expect((await latestSpecSet([shared, laptop], 'feat/x'))!.set.files[0]!.title).toBe('Experiment');
    expect(await latestSpecSet([shared, laptop], 'nope')).toBeNull();
    expect(await latestSpecSet([memoryStore()])).toBeNull();
  });

  test("the shared outline does not follow anyone's uncommitted edits, unless nothing else exists", async () => {
    const store = memoryStore();
    const publish = (text: string, at: number, freshness?: 'modified' | 'unknown') => publishSpecSet(store, { files: [{ path: 'specs/a.feature', text }], branch: 'main', sha: 'a'.repeat(40), recordedAtMs: at, ...(freshness ? { freshness } : {}) });
    await publish('Feature: Committed', 10);
    await publish('Feature: Laptop edits', 99, 'modified');
    expect((await latestSpecSet([store]))!.set.files[0]!.title).toBe('Committed');
    const only = memoryStore();
    await publishSpecSet(only, { files: [{ path: 'specs/a.feature', text: 'Feature: Only edits' }], branch: 'main', sha: null, recordedAtMs: 5, freshness: 'unknown' });
    expect((await latestSpecSet([only]))!.set.files[0]!.title).toBe('Only edits');
  });

  test('a project that never publishes from main still has an outline: the newest set', async () => {
    const store = memoryStore();
    await publishSpecSet(store, { files: [{ path: 'specs/a.feature', text: 'Feature: Dev' }], branch: 'develop', sha: null, recordedAtMs: 5 });
    expect((await latestSpecSet([store]))!.set.branch).toBe('develop');
  });
});

describe('runs in the store', () => {
  async function run(id: string, privacyPassed: boolean | undefined) {
    const dir = path.join(root, 'runs', id);
    await mkdir(path.join(dir, 'media', 'paths', 'p1'), { recursive: true });
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ run: { id, startedAt: '2026-10-09T12:00:00.000Z', finishedAt: '2026-10-09T12:01:00.000Z', durationMs: 60_000, mode: 'fast', commit: 'abc', branch: 'main', specVersion: 'v1' }, coverage: { overall: { states: { total: 3, passed: 3, failed: 0, flaky: 0, notReached: 0 } } }, paths: [{ id: 'j1', kind: 'journey', status: 'passed' }, { id: 'j2', kind: 'journey', status: 'failed' }], ...(privacyPassed === undefined ? {} : { privacy: { passed: privacyPassed, findings: [] } }) }));
    await writeFile(path.join(dir, 'media', 'paths', 'p1', '01.png'), new Uint8Array([137, 80, 78, 71]));
    await writeFile(path.join(dir, '.secret'), 'never');
    return dir;
  }

  test('a finished run is uploaded, listed newest first with its summary, and its files are readable', async () => {
    const store = memoryStore();
    const dir = await run('2026-10-09T12-00-00-000Z-fast', true);
    expect(await publishRunBundle(store, dir)).toMatchObject({ id: '2026-10-09T12-00-00-000Z-fast', files: 2, alreadyPublished: false });
    const [summary] = await listRunSummaries(store);
    expect(summary).toMatchObject({ id: '2026-10-09T12-00-00-000Z-fast', commit: 'abc', branch: 'main', progress: 'complete', hasManifest: true, journeys: { total: 2, passed: 1, failed: 1 }, coverage: { states: { total: 3, passed: 3 } } });
    const png = await readRunFile(store, summary!.id, 'media/paths/p1/01.png');
    expect(png!.contentType).toBe('image/png');
    expect(await readRunFile(store, summary!.id, '.secret')).toBeNull();
    expect(await readRunFile(store, summary!.id, '../x')).toBeNull();
    expect(await readRunFile(store, '../escape', 'manifest.json')).toBeNull();
  });

  test('publishing a run again changes nothing', async () => {
    const store = memoryStore();
    const dir = await run('2026-10-09T13-00-00-000Z-fast', true);
    await publishRunBundle(store, dir);
    const keys = await store.listKeys();
    expect(await publishRunBundle(store, dir)).toMatchObject({ alreadyPublished: true });
    expect(await store.listKeys()).toEqual(keys);
  });

  test('a run whose privacy scan did not pass is never shared', async () => {
    const store = memoryStore();
    await expect(publishRunBundle(store, await run('2026-10-09T14-00-00-000Z-fast', false))).rejects.toBeInstanceOf(RunNotShareableError);
    await expect(publishRunBundle(store, await run('2026-10-09T15-00-00-000Z-fast', undefined))).rejects.toThrow('privacy scan');
    expect(await store.listKeys()).toEqual([]);
  });

  test('a half-uploaded run is not listed, and uploading again finishes it', async () => {
    const store = memoryStore();
    const dir = await run('2026-10-09T16-00-00-000Z-fast', true);
    const flaky = { ...store, put: async (key: string, bytes: Uint8Array, type: string) => { if (key.endsWith('manifest.json')) throw new Error('network died'); return store.put(key, bytes, type); } };
    await expect(publishRunBundle(flaky as typeof store, dir)).rejects.toThrow('network died');
    expect(await listRunSummaries(store)).toEqual([]);
    await publishRunBundle(store, dir);
    expect((await listRunSummaries(store)).length).toBe(1);
  });
});

describe('what the review found', () => {
  test('the same specs published clean after a developer published them modified are a set of their own, and win', async () => {
    const store = memoryStore();
    const input = { files: [{ path: 'specs/a.feature', text: 'Feature: Same' }], branch: 'main', sha: 'a'.repeat(40) };
    const edited = await publishSpecSet(store, { ...input, recordedAtMs: 99, freshness: 'modified' });
    const clean = await publishSpecSet(store, { ...input, recordedAtMs: 10 });
    expect(clean.id).not.toBe(edited.id);
    expect((await latestSpecSet([store]))!.set.id).toBe(clean.id);
  });

  test('a store that is down is skipped when looking for the outline; all of them down is an error', async () => {
    const up = memoryStore(), down = memoryStore();
    await publishSpecSet(up, { files: [{ path: 'specs/a.feature', text: 'Feature: A' }], branch: 'main', sha: null, recordedAtMs: 1 });
    down.down = true;
    expect((await latestSpecSet([down, up]))!.set.files[0]!.title).toBe('A');
    await expect(latestSpecSet([down])).rejects.toThrow('store unavailable');
  });

  test('a run whose upload died after the manifest is finished by publishing it again', async () => {
    const store = memoryStore();
    const dir = await (async () => {
      const d = path.join(root, 'runs', '2026-10-09T17-00-00-000Z-fast');
      await mkdir(d, { recursive: true });
      await writeFile(path.join(d, 'manifest.json'), JSON.stringify({ run: { id: 'r', startedAt: '2026-10-09T17:00:00.000Z', finishedAt: '2026-10-09T17:01:00.000Z', durationMs: 1, mode: 'fast' }, paths: [], privacy: { passed: true, findings: [] } }));
      return d;
    })();
    const dying = { ...store, put: async (key: string, bytes: Uint8Array, type: string) => { if (key.includes('/index/')) throw new Error('network died'); return store.put(key, bytes, type); } };
    await expect(publishRunBundle(dying as typeof store, dir)).rejects.toThrow('network died');
    expect(await listRunSummaries(store)).toEqual([]);
    expect(await publishRunBundle(store, dir)).toMatchObject({ alreadyPublished: true });
    expect((await listRunSummaries(store)).map(run => run.id)).toEqual(['2026-10-09T17-00-00-000Z-fast']);
  });
});

describe('what the second review found', () => {
  test('the outline is still found when hundreds of other branches published newer sets, with a handful of reads', async () => {
    const store = memoryStore();
    await publishSpecSet(store, { files: [{ path: 'specs/a.feature', text: 'Feature: Main' }], branch: 'main', sha: 'a'.repeat(40), recordedAtMs: 1 });
    for (let i = 0; i < 260; i++) await publishSpecSet(store, { files: [{ path: 'specs/a.feature', text: `Feature: Branch ${i}` }], branch: `feat/pr-${i}`, sha: null, recordedAtMs: 1000 + i });
    let reads = 0;
    const counting = { ...store, get: async (key: string) => { reads += 1; return store.get(key); } };
    expect((await latestSpecSet([counting as typeof store]))!.set.files[0]!.title).toBe('Main');
    expect(reads).toBeLessThan(6);
    expect((await latestSpecSet([counting as typeof store], 'feat/pr-7'))!.set.files[0]!.title).toBe('Branch 7');
  });

  test('sets already read are not read again', async () => {
    const store = memoryStore();
    await publishSpecSet(store, { files: [{ path: 'specs/a.feature', text: 'Feature: Main' }], branch: 'main', sha: null, recordedAtMs: 1 });
    let reads = 0;
    const counting = { ...store, get: async (key: string) => { reads += 1; return store.get(key); } };
    const cache = new Map();
    await latestSpecSet([counting as typeof store], undefined, cache);
    const first = reads;
    await latestSpecSet([counting as typeof store], undefined, cache);
    expect(reads).toBe(first);
  });

  test('the newest page of runs is all that is listed, and an entry is opened once', async () => {
    const store = memoryStore();
    for (let i = 0; i < 5; i++) {
      const dir = path.join(root, 'runs', `2026-10-1${i}T12-00-00-000Z-fast`);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ run: { id: 'r', startedAt: `2026-10-1${i}T12:00:00.000Z`, finishedAt: `2026-10-1${i}T12:01:00.000Z`, durationMs: 1, mode: 'fast' }, paths: [], privacy: { passed: true, findings: [] } }));
      await publishRunBundle(store, dir);
    }
    let reads = 0;
    const counting = { ...store, get: async (key: string) => { reads += 1; return store.get(key); } };
    const cache = new Map();
    expect((await listRunSummaries(counting as typeof store, 3, cache)).map(run => run.id)).toEqual(['2026-10-14T12-00-00-000Z-fast', '2026-10-13T12-00-00-000Z-fast', '2026-10-12T12-00-00-000Z-fast']);
    expect(reads).toBe(3);
    await listRunSummaries(counting as typeof store, 3, cache);
    expect(reads).toBe(3);
  });

  test('what the outline holds is what is published: one definition of a spec file', async () => {
    const { loadDirectoryOutline } = await import('../src/directory-outline');
    const outline = await loadDirectoryOutline(path.join(root, 'specs'));
    expect(outline.specs.map(spec => spec.path)).toEqual((await collectSpecFiles(path.join(root, 'specs'))).map(file => file.path));
    expect(outline.specs.map(spec => spec.path)).not.toContain('specs/logo.png');
  });
});
