import { describe, expect, test } from 'bun:test';

import { readBackendLayers } from '../src/compose';
import { ReportIndex } from '../src/report-index';
import { publishChecks } from '../src/publish-checks';
import { uiCatalog } from '../src/ui-catalog';
import { changedUiEntries, diffUiCatalogs, diffUiProfiles, layersAtCommit, pictureIdentity, uiCatalogAtCommit, uiCatalogCommits } from '../src/ui-catalog-diff';
import { uiStateLayer, type UiStateCapture } from '../src/ui-catalog-publish';
import { memoryStore } from './memory-store';

const OLD = '1'.repeat(40), NEW = '2'.repeat(40);
const png = (seed: string) => new TextEncoder().encode(`png:${seed}`);
const shot = (id: string, picture: string | null, extra: Partial<UiStateCapture> = {}): UiStateCapture => ({ id, ...(picture ? { screenshot: { data: png(picture) } } : {}), ...extra });
const desktop = { environment: 'desktop-web', profile: { viewport: '1280x800' } } as const;
const phone = { environment: 'mobile-web', profile: { viewport: '390x844' } } as const;

async function layersOf(store: ReturnType<typeof memoryStore>) {
  const read = await readBackendLayers([{ id: 'ci', store }]);
  return read.loaded.map(item => item.evidence);
}

async function publishCommit(store: ReturnType<typeof memoryStore>, sha: string, at: number, states: UiStateCapture[], where: typeof desktop | typeof phone = desktop, extra: { freshness?: 'modified'; branch?: string } = {}) {
  await publishChecks(store, { ...uiStateLayer({ producer: 'capture', recordedAtMs: at, sha, branch: extra.branch ?? 'main', ...where, states }), ...(extra.freshness ? { freshness: extra.freshness } : {}) });
}

describe('comparing the catalog of two commits', () => {
  test('every kind of change is told apart, and an unchanged state is unchanged', async () => {
    const store = memoryStore();
    await publishCommit(store, OLD, 100, [shot('same', 'a'), shot('moved', 'b'), shot('broke', 'c'), shot('gone', 'd'), shot('byaddress', null, { screenshot: { uri: 'https://example.com/x.png' } })]);
    await publishCommit(store, NEW, 200, [shot('same', 'a'), shot('moved', 'b2'), shot('broke', null, { status: 'failed', detail: 'timed out' }), shot('fresh', 'e'), shot('byaddress', null, { screenshot: { uri: 'https://example.com/x.png' } })]);
    const layers = await layersOf(store);
    const diff = diffUiCatalogs(uiCatalogAtCommit(layers, OLD), uiCatalogAtCommit(layers, NEW));
    const by = Object.fromEntries(diff.entries.map(entry => [entry.id, entry.change]));
    expect(by).toEqual({ same: 'unchanged', moved: 'picture', broke: 'coverage', gone: 'removed', fresh: 'added', byaddress: 'unverified' });
    expect(diff.summary).toMatchObject({ unchanged: 1, picture: 1, coverage: 1, removed: 1, added: 1, unverified: 1, total: 6 });
    expect(changedUiEntries(diff).map(entry => entry.id).sort()).toEqual(['broke', 'byaddress', 'fresh', 'gone', 'moved']);
    const broke = diff.entries.find(entry => entry.id === 'broke')!;
    expect([broke.before?.coverage, broke.after?.coverage]).toEqual(['captured', 'failed']);
  });

  test('the effective report forgets the earlier commit, the layers do not', async () => {
    const store = memoryStore();
    await publishCommit(store, OLD, 100, [shot('home', 'a')]);
    await publishCommit(store, NEW, 200, [shot('home', 'b')]);
    const index = new ReportIndex([{ id: 'ci', store }]);
    await index.refresh();
    const held = uiCatalog(index.snapshot().layers);
    expect(held.states[0]!.cells[0]!.capture!.origin.sha).toBe(NEW);
    expect(index.snapshot().layers.some(entry => entry.layer.sha === OLD)).toBe(false);
    const layers = await layersOf(store);
    expect(uiCatalogAtCommit(layers, OLD).states[0]!.cells[0]!.capture!.origin.sha).toBe(OLD);
  });

  test('the same layers in any order are the same comparison', async () => {
    const store = memoryStore();
    await publishCommit(store, OLD, 100, [shot('a', 'a'), shot('b', 'b'), shot('c', 'c')]);
    await publishCommit(store, NEW, 200, [shot('a', 'a'), shot('b', 'b2'), shot('d', 'd')]);
    await publishCommit(store, NEW, 201, [shot('c', null, { status: 'failed' })], phone);
    const layers = await layersOf(store);
    const compared = (list: typeof layers) => JSON.stringify(diffUiCatalogs(uiCatalogAtCommit(list, OLD), uiCatalogAtCommit(list, NEW)).entries.map(entry => [entry.id, entry.profile?.key, entry.change]));
    expect(compared(layers.slice().reverse())).toBe(compared(layers));
  });

  test('a state is only compared in the same profile: another profile is added, not changed', async () => {
    const store = memoryStore();
    await publishCommit(store, OLD, 100, [shot('home', 'a')], desktop);
    await publishCommit(store, NEW, 200, [shot('home', 'a')], desktop);
    await publishCommit(store, NEW, 200, [shot('home', 'a')], phone);
    const layers = await layersOf(store);
    const diff = diffUiCatalogs(uiCatalogAtCommit(layers, OLD), uiCatalogAtCommit(layers, NEW));
    expect(diff.entries.map(entry => [entry.profile?.label, entry.change])).toEqual([['Desktop web · 1280x800', 'unchanged'], ['Mobile web · 390x844', 'added']]);
  });

  test('commits are listed newest first, a prefix names one commit, and a mistake is an error, not the wrong commit', async () => {
    const store = memoryStore();
    await publishCommit(store, OLD, 100, [shot('a', 'a')]);
    await publishCommit(store, NEW, 200, [shot('a', 'b')], desktop, { branch: 'feature' });
    await publishCommit(store, `${NEW.slice(0, 8)}${'f'.repeat(32)}`, 150, [shot('a', 'c')], phone);
    await publishCommit(store, '3'.repeat(40), 300, [shot('a', 'd')], desktop, { freshness: 'modified' });
    const layers = await layersOf(store);
    const commits = uiCatalogCommits(layers.map(entry => entry.layer));
    expect(commits.map(commit => [commit.sha.slice(0, 2), commit.branch])).toEqual([['22', 'feature'], ['22', 'main'], ['11', 'main']]);
    expect(layersAtCommit(layers, OLD.slice(0, 7))).toHaveLength(1);
    expect(() => layersAtCommit(layers, NEW.slice(0, 7))).toThrow('more than one commit');
    expect(() => layersAtCommit(layers, '9999999')).toThrow('No layer was recorded at commit 9999999');
    expect(() => layersAtCommit(layers, 'main')).toThrow('not a commit');
    // A checkout with local changes is not the commit's own result.
    expect(() => layersAtCommit(layers, '3'.repeat(7))).toThrow('No layer was recorded');
  });

  test('a picture is the same when its content is, however it was stored', () => {
    const hash = 'ab'.repeat(32);
    expect(pictureIdentity({ name: 'x', sha256: hash })).toBe(hash);
    expect(pictureIdentity({ name: 'x', bundleKey: `attachments/${hash}` })).toBe(hash);
    expect(pictureIdentity({ name: 'x', bundleKey: 'attachments/not-a-hash' })).toBeNull();
    expect(pictureIdentity({ name: 'x', uri: 'https://example.com/x.png' })).toBeNull();
    expect(pictureIdentity({ name: 'x', sha256: hash, omitted: 'too-large' })).toBeNull();
    expect(pictureIdentity(null)).toBeNull();
  });
});

describe('comparing two profiles of one catalog', () => {
  test('each state in one profile is set beside the same state in the other', async () => {
    const store = memoryStore();
    await publishCommit(store, NEW, 100, [shot('both-same', 'a'), shot('both-differ', 'b'), shot('desktop-only', 'c'), shot('fails-on-phone', 'd')], desktop);
    await publishCommit(store, NEW, 100, [shot('both-same', 'a'), shot('both-differ', 'b2'), shot('phone-only', 'e'), shot('fails-on-phone', null, { status: 'failed' })], phone);
    const catalog = uiCatalog(await layersOf(store));
    const [a, b] = catalog.profiles;
    const diff = diffUiProfiles(catalog, a!.key, b!.key);
    expect(Object.fromEntries(diff.entries.map(entry => [entry.id, entry.change]))).toEqual({ 'both-same': 'unchanged', 'both-differ': 'picture', 'desktop-only': 'removed', 'fails-on-phone': 'coverage', 'phone-only': 'added' });
    expect(diff.entries.every(entry => entry.profile === null)).toBe(true);
    expect(() => diffUiProfiles(catalog, a!.key, a!.key)).toThrow('two different profiles');
  });
});
