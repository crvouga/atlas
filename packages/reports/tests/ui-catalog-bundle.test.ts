import { afterEach, describe, expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { UiBundleManifestSchema, UI_CATALOG_BUNDLE_MANIFEST } from '../../schema/src/ui-catalog-bundle';
import { captureJournal, findBundles, importBundle, isSafeBundlePath, mergeBundles, validateBundle } from '../src/ui-catalog-bundle';
import { uiCatalogMain } from '../src/ui-catalog-cli';
import { resolveCatalog } from '../src/ui-catalog-definition';
import { uiStateLayer } from '../src/ui-catalog-publish';
import { memoryStore } from './memory-store';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'atlas-bundle-'));
  dirs.push(dir);
  return dir;
}

const catalog = () => resolveCatalog({ name: 'web', states: [{ id: 'home' }, { id: 'settings' }, { id: 'about' }] });
const png = (tail: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tail]);

/** One attempt's bundle: captures of some states, each published or not. */
async function attempt(dir: string, shard: string, number: string, at: number, states: readonly { id: string; status?: 'passed' | 'failed'; picture: number; publication: 'published' | 'failed' | 'pending' }[]) {
  const journal = captureJournal(dir, { shard: `${shard}#${number}`, participant: shard, attempt: number, refresh: 'run-1', now: () => at });
  await journal.open(await catalog());
  for (const state of states) {
    const entry = await journal.record(uiStateLayer({ producer: 'ui-catalog:web', recordedAtMs: at, shard: `${shard}#${number}`, states: [{ id: state.id, ...(state.status ? { status: state.status } : {}), screenshot: { data: png(state.picture), contentType: 'image/png' }, labels: { 'atlas.claim': `claim-${shard}-${number}` } }] }), { claimId: `claim-${shard}-${number}`, units: [state.id] });
    if (state.publication !== 'pending') await entry.settle(state.publication, state.publication === 'failed' ? 'ECONNRESET' : undefined);
  }
  return journal;
}

describe('#89 bundles', () => {
  test('2: bundles and a partial retry merged in any order give the same bundle: earlier captures survive and every attempt is traceable', async () => {
    const root = await scratch();
    await attempt(path.join(root, 'a1'), 'shard-a', '1', 1000, [{ id: 'home', picture: 1, publication: 'published' }, { id: 'settings', status: 'failed', picture: 2, publication: 'published' }]);
    await attempt(path.join(root, 'a2'), 'shard-a', '2', 2000, [{ id: 'settings', picture: 3, publication: 'failed' }]);
    await attempt(path.join(root, 'b1'), 'shard-b', '1', 1500, [{ id: 'about', picture: 4, publication: 'published' }]);
    const found = await findBundles([root]);
    expect(found.map(dir => path.basename(dir))).toEqual(['a1', 'a2', 'b1']);
    const forward = await mergeBundles(found, path.join(root, 'out-1'), { expect: ['shard-a', 'shard-b'] });
    const backward = await mergeBundles([...found].reverse(), path.join(root, 'out-2'), { expect: ['shard-a', 'shard-b'] });
    expect(forward.ok).toBe(true);
    expect(backward.manifest).toEqual(forward.manifest);
    const manifest = UiBundleManifestSchema.parse(JSON.parse(await readFile(path.join(root, 'out-1', UI_CATALOG_BUNDLE_MANIFEST), 'utf8')));
    expect(manifest.attempts.map(item => item.shard)).toEqual(['shard-a#1', 'shard-a#2', 'shard-b#1']);
    expect(manifest.captures.map(item => [item.units[0], item.attempt, item.publication])).toEqual([['home', '1', 'published'], ['settings', '1', 'published'], ['about', '1', 'published'], ['settings', '2', 'failed']]);
    expect((await validateBundle(path.join(root, 'out-1'))).valid).toBe(true);
    // Merging again (incrementally, into the same folder) changes nothing.
    const again = await mergeBundles(found, path.join(root, 'out-1'));
    expect(again.manifest).toEqual(forward.manifest);
    // The later attempt's capture is the newest result once accepted; the earlier ones are still there.
    const store = memoryStore();
    expect((await importBundle(path.join(root, 'out-1'), store, { reconcile: 'accept' })).layers).toBe(manifest.plans.length + 4);
    const out: string[] = [];
    await uiCatalogMain(['status', '--store', path.join(root, 'out-1', 'store'), '--format', 'json'], { out: text => out.push(text), env: {} });
    expect(JSON.parse(out.join('')).summary.coverage).toMatchObject({ captured: 3, failed: 0 });
    // A job whose bundle never arrived is named.
    const short = await mergeBundles(found.slice(0, 1), path.join(root, 'out-3'), { expect: ['shard-a', 'shard-b'] });
    expect(short).toMatchObject({ ok: false, missing: ['shard-b'] });
  });

  test('3: missing bytes, a digest mismatch, an unsafe path and another definition or commit are reported, and nothing is imported or merged', async () => {
    const root = await scratch();
    const good = path.join(root, 'good');
    await attempt(good, 'shard', '1', 1000, [{ id: 'home', picture: 1, publication: 'published' }]);
    const manifest = UiBundleManifestSchema.parse(JSON.parse(await readFile(path.join(good, UI_CATALOG_BUNDLE_MANIFEST), 'utf8')));
    const blob = manifest.objects.find(item => item.path.startsWith('layers/blobs/'))!.path;
    const variant = async (name: string, change: (dir: string) => Promise<void>) => {
      const dir = path.join(root, name);
      await cp(good, dir, { recursive: true });
      await change(dir);
      return dir;
    };
    const missing = await variant('missing', dir => rm(path.join(dir, 'store', blob)));
    const tampered = await variant('tampered', dir => writeFile(path.join(dir, 'store', blob), 'not the picture'));
    const unsafe = await variant('unsafe', async dir => {
      const edited = { ...manifest, objects: [...manifest.objects, { path: 'layers/../../../etc/passwd', sha256: 'a'.repeat(64), bytes: 1 }] };
      await writeFile(path.join(dir, UI_CATALOG_BUNDLE_MANIFEST), JSON.stringify(edited));
    });
    const codes = async (dir: string, expect_ = {}) => (await validateBundle(dir, expect_)).problems.map(problem => problem.code);
    expect(await codes(good)).toEqual([]);
    expect(await codes(missing)).toContain('missing');
    expect(await codes(tampered)).toEqual(['digest']);
    expect(await codes(unsafe)).toEqual(['unsafe-path']);
    expect(await codes(good, { definition: 'f'.repeat(64) })).toEqual(['incompatible']);
    expect(isSafeBundlePath('layers/../x')).toBe(false);
    expect(isSafeBundlePath('/etc/passwd')).toBe(false);
    for (const dir of [missing, tampered, unsafe]) {
      const target = memoryStore();
      const imported = await importBundle(dir, target);
      expect(imported).toMatchObject({ ok: false, layers: 0, copied: 0 });
      expect(await target.listKeys('')).toEqual([]);
    }
    expect((await mergeBundles([good, tampered], path.join(root, 'merged'))).ok).toBe(false);
    expect(await findBundles([path.join(root, 'merged')]).catch(() => [])).toEqual([]);
    // Bundles made for two different commits are not merged into one.
    const other = path.join(root, 'other');
    const journal = captureJournal(other, { shard: 'x', source: { sha: 'b'.repeat(40) } });
    await journal.open(await catalog());
    const first = path.join(root, 'first');
    await (async () => { const j = captureJournal(first, { shard: 'y', source: { sha: 'a'.repeat(40) } }); await j.open(await catalog()); })();
    const crossed = await mergeBundles([other, first], path.join(root, 'crossed'));
    expect(crossed.problems.map(problem => problem.code)).toEqual(['incompatible']);
    // The command says so, and exits 1.
    const lines: string[] = [];
    expect(await uiCatalogMain(['bundle', 'validate', tampered, '--format', 'json'], { out: text => lines.push(text), env: {} })).toBe(1);
    expect(JSON.parse(lines.join(''))).toMatchObject({ ok: false, command: 'validate', bundles: [{ valid: false }] });
  });

  test('4: captures that never reached the server are retained by default and imported only by the explicit accept policy', async () => {
    const root = await scratch();
    await attempt(root, 'shard', '1', 1000, [{ id: 'home', picture: 1, publication: 'published' }, { id: 'settings', picture: 2, publication: 'pending' }, { id: 'about', picture: 3, publication: 'failed' }]);
    const retain = memoryStore();
    const kept = await importBundle(root, retain);
    expect(kept.ok).toBe(true);
    expect(kept.retained.map(capture => [capture.units[0], capture.publication])).toEqual([['settings', 'pending'], ['about', 'failed']]);
    expect(kept.layers).toBe(1 + 1); // the plan and the published capture
    const accept = memoryStore();
    const all = await importBundle(root, accept, { reconcile: 'accept' });
    expect(all).toMatchObject({ ok: true, layers: 4, retained: [] });
  });

  test('a journal resumed in the same folder keeps what is there and adds the attempt; another definition is refused', async () => {
    const root = await scratch();
    await attempt(root, 'shard', '1', 1000, [{ id: 'home', picture: 1, publication: 'published' }]);
    const resumed = await attempt(root, 'shard', '2', 2000, [{ id: 'about', picture: 2, publication: 'published' }]);
    expect(resumed.manifest().attempts.map(item => item.attempt)).toEqual(['1', '2']);
    expect(resumed.manifest().captures).toHaveLength(2);
    expect((await validateBundle(root)).valid).toBe(true);
    const other = await resolveCatalog({ name: 'other', states: [{ id: 'x' }] });
    await expect(captureJournal(root, { shard: 'z' }).open(other)).rejects.toThrow(/another definition/);
  });
});
