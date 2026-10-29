import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { UiCatalogDiffResultSchema, UiCatalogExportResultSchema, UiCatalogPublishResultSchema, UiCatalogStatusSchema } from '../../schema/src/cli-results';
import { UI_CATALOG_USAGE, uiCatalogMain } from '../src/ui-catalog-cli';

const OLD = 'a'.repeat(40), NEW = 'b'.repeat(40);
const png = (tail: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tail]);
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function project() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ui-catalog-cli-'));
  dirs.push(dir);
  const write = (name: string, content: string | Uint8Array) => { mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); writeFileSync(path.join(dir, name), content); };
  const run = async (...argv: string[]) => {
    let out = '';
    const code = await uiCatalogMain([...argv, '--store', path.join(dir, 'store')], { out: text => { out += text; }, cwd: dir, env: {}, git: () => null, clock: () => 5 });
    return { code, out };
  };
  const json = async (...argv: string[]) => { const { code, out } = await run(...argv, '--format', 'json'); return { code, doc: JSON.parse(out) as unknown }; };
  return { dir, write, run, json };
}
const profile = ['--environment', 'desktop-web', '--param', 'viewport=1280x800'];
const at = (sha: string, time: number) => ['--sha', sha, '--recorded-at', String(time)];

describe('atlas ui-catalog plan and publish', () => {
  test('publish stores the picture beside the file by content and the document says what was written', async () => {
    const p = project();
    p.write('home.png', png(1));
    p.write('captures.json', JSON.stringify({ states: [{ id: 'home', title: 'Home', route: '/', covers: ['home'], screenshot: 'home.png' }, { id: 'about', screenshot: { path: 'home.png', width: 1, height: 1 } }] }));
    const { code, doc } = await p.json('publish', '--captures', 'captures.json', '--producer', 'capture', ...profile, ...at(OLD, 1), '--shard', '2/8');
    expect(code).toBe(0);
    expect(UiCatalogPublishResultSchema.parse(doc)).toMatchObject({ ok: true, layer: { kind: 'ui-state', producer: 'capture', environment: 'desktop-web', parameters: { viewport: '1280x800' }, states: 2, captured: 2, failed: 0, pictures: 2, shard: '2/8' } });
    // The same input is the same layer.
    expect(((await p.json('publish', '--captures', 'captures.json', '--producer', 'capture', ...profile, ...at(OLD, 1), '--shard', '2/8')).doc as { layer: { id: string } }).layer.id).toBe((doc as { layer: { id: string } }).layer.id);
  });

  test('plan writes the expected set; nothing in it counts as captured', async () => {
    const p = project();
    p.write('plan.json', JSON.stringify([{ id: 'home', covers: ['home'] }, { id: 'billing', inventory: true }]));
    const { code, doc } = await p.json('plan', '--states', 'plan.json', '--producer', 'planner', ...profile, ...at(NEW, 1));
    expect(code).toBe(0);
    expect(UiCatalogPublishResultSchema.parse(doc)).toMatchObject({ layer: { kind: 'ui-plan', states: 2, captured: 0 } });
    const status = await p.json('status');
    expect(status.code).toBe(1);
    expect(UiCatalogStatusSchema.parse(status.doc)).toMatchObject({ ok: false, summary: { planned: true, coverage: { captured: 0, missing: 1 } }, problems: [{ kind: 'missing', state: 'home' }] });
  });

  test('a passed state whose picture cannot be read is published as failed, never as captured without it', async () => {
    const p = project();
    p.write('secret/.hidden.png', png(9));
    p.write('captures.json', JSON.stringify({ states: [{ id: 'missing', screenshot: 'nowhere.png' }, { id: 'hidden', screenshot: 'secret/.hidden.png' }, { id: 'already-failed', status: 'failed', detail: 'boom', screenshot: 'nowhere.png' }] }));
    const { code, doc } = await p.json('publish', '--captures', 'captures.json', '--producer', 'capture', ...profile, ...at(OLD, 1));
    expect(code).toBe(0);
    const result = UiCatalogPublishResultSchema.parse(doc);
    expect(result.layer).toMatchObject({ captured: 0, failed: 3, pictures: 0 });
    expect(result.warnings).toHaveLength(3);
    const status = UiCatalogStatusSchema.parse((await p.json('status')).doc);
    expect(status.summary.coverage).toMatchObject({ captured: 0, failed: 3 });
    expect(status.problems.find(problem => problem.state === 'missing')!.detail).toContain('The picture could not be read');
    expect(status.problems.find(problem => problem.state === 'already-failed')!.detail).toBe('boom');
  });

  test('a picture that leads out of the folders it may be read from is not read', async () => {
    const p = project();
    const outside = mkdtempSync(path.join(tmpdir(), 'ui-catalog-outside-'));
    dirs.push(outside);
    writeFileSync(path.join(outside, 'secret.png'), png(7));
    mkdirSync(path.join(p.dir, 'in'));
    symlinkSync(path.join(outside, 'secret.png'), path.join(p.dir, 'in', 'link.png'));
    p.write('in/captures.json', JSON.stringify([{ id: 'link', screenshot: 'link.png' }, { id: 'absolute', screenshot: path.join(outside, 'secret.png') }, { id: 'up', screenshot: '../../../../etc/hosts' }]));
    const result = UiCatalogPublishResultSchema.parse((await p.json('publish', '--captures', 'in/captures.json', '--producer', 'capture', ...profile, ...at(OLD, 1))).doc);
    expect(result.layer).toMatchObject({ pictures: 0, failed: 3 });
    // The person can allow a folder.
    const allowed = UiCatalogPublishResultSchema.parse((await p.json('publish', '--captures', 'in/captures.json', '--producer', 'capture2', ...profile, ...at(OLD, 1), '--attach-root', outside)).doc);
    expect(allowed.layer.pictures).toBe(2);
  });

  test('a mistake in the file or the flags is a message naming it, and nothing is written', async () => {
    const p = project();
    p.write('typo.json', JSON.stringify([{ id: 'home', cover: ['home'] }]));
    p.write('twice.json', JSON.stringify([{ id: 'home' }, { id: 'home' }]));
    p.write('notjson.json', '{');
    await expect(p.run('publish', '--captures', 'typo.json', '--producer', 'c')).rejects.toThrow(/typo\.json:.*cover/);
    await expect(p.run('publish', '--captures', 'twice.json', '--producer', 'c')).rejects.toThrow('appears twice');
    await expect(p.run('publish', '--captures', 'notjson.json', '--producer', 'c')).rejects.toThrow('is not JSON');
    await expect(p.run('publish', '--captures', 'absent.json', '--producer', 'c')).rejects.toThrow('Cannot read absent.json');
    await expect(p.run('publish', '--producer', 'c')).rejects.toThrow('needs --captures');
    await expect(p.run('publish', '--captures', 'twice.json')).rejects.toThrow('--producer');
    await expect(p.run('plan', '--states', 'typo.json', '--producer', 'c', '--param', 'novalue')).rejects.toThrow('--param takes key=value');
    await expect(p.run('status', '--format', 'xml')).rejects.toThrow('--format takes');
  });

  test('help is the usage text, and an unknown command is a mistake', async () => {
    const p = project();
    for (const argv of [[], ['--help'], ['-h']]) {
      let out = '';
      expect(await uiCatalogMain(argv, { out: text => { out += text; }, cwd: p.dir, env: {} })).toBe(0);
      expect(out).toBe(UI_CATALOG_USAGE);
    }
    expect((await p.run('nonsense')).code).toBe(2);
  });
});

describe('atlas ui-catalog status', () => {
  test('is complete only when something is captured and nothing needs attention', async () => {
    const p = project();
    mkdirSync(path.join(p.dir, 'store'));
    expect((await p.json('status')).code).toBe(1);
    expect(UiCatalogStatusSchema.parse((await p.json('status')).doc).problems).toEqual([{ kind: 'empty', detail: 'No UI states have been recorded' }]);
    p.write('plan.json', JSON.stringify([{ id: 'a' }, { id: 'b' }]));
    p.write('c.json', JSON.stringify([{ id: 'a' }]));
    await p.run('plan', '--states', 'plan.json', '--producer', 'planner', ...profile, ...at(NEW, 1));
    await p.run('publish', '--captures', 'c.json', '--producer', 'capture', ...profile, ...at(NEW, 2));
    const incomplete = await p.run('status');
    expect(incomplete.code).toBe(1);
    expect(incomplete.out).toContain('1 captured');
    expect(incomplete.out).toContain('! missing: b (Desktop web · 1280x800)');
    expect(incomplete.out).toContain('Needs attention.');
    // The other shard publishes: complete, whatever the order they arrived in.
    p.write('c2.json', JSON.stringify([{ id: 'b' }]));
    await p.run('publish', '--captures', 'c2.json', '--producer', 'capture', ...profile, ...at(NEW, 3), '--shard', '2/2');
    const complete = await p.run('status');
    expect(complete.code).toBe(0);
    expect(complete.out).toContain('Complete.');
    expect((await p.run('status', '--format', 'markdown')).out).toContain('# UI catalog');
    // Filters narrow what is read, and a profile may be named by its label.
    expect(UiCatalogStatusSchema.parse((await p.json('status', '--profile', 'Desktop web · 1280x800', '--q', 'b')).doc).summary.states).toBe(1);
    await expect(p.run('status', '--profile', 'phone')).rejects.toThrow('is not a profile of this catalog');
    await expect(p.run('status', '--coverage', 'nearly')).rejects.toThrow('--coverage takes');
  });

  test('a store that cannot be read is not complete', async () => {
    const p = project();
    p.write('c.json', JSON.stringify([{ id: 'a' }]));
    await p.run('publish', '--captures', 'c.json', '--producer', 'capture', ...profile, ...at(NEW, 1));
    const { code, out } = await (async () => {
      let text = '';
      const exit = await uiCatalogMain(['status', '--store', path.join(p.dir, 'store'), '--store', 'lab=' + path.join(p.dir, 'not-there'), '--format', 'json'], { out: value => { text += value; }, cwd: p.dir, env: {}, git: () => null }).catch((error: Error) => error);
      return exit instanceof Error ? { code: 2, out: exit.message } : { code: exit, out: text };
    })();
    // A mistyped directory is an error, never an empty store.
    expect(code).toBe(2);
    expect(out).toContain('Store directory not found');
  });
});

describe('atlas ui-catalog diff', () => {
  async function twoCommits() {
    const p = project();
    p.write('old.png', png(1));
    p.write('new.png', png(2));
    p.write('old.json', JSON.stringify([{ id: 'home', screenshot: 'old.png' }, { id: 'same', screenshot: 'old.png' }, { id: 'gone', screenshot: 'old.png' }]));
    p.write('new.json', JSON.stringify([{ id: 'home', screenshot: 'new.png' }, { id: 'same', screenshot: 'old.png' }, { id: 'fresh', screenshot: 'new.png' }]));
    await p.run('publish', '--captures', 'old.json', '--producer', 'capture', ...profile, ...at(OLD, 1000));
    await p.run('publish', '--captures', 'new.json', '--producer', 'capture', ...profile, ...at(NEW, 2000));
    return p;
  }

  test('sets one commit against another, naming what changed and what only one side has', async () => {
    const p = await twoCommits();
    const { code, doc } = await p.json('diff', '--from', OLD.slice(0, 8), '--to', NEW.slice(0, 8));
    expect(code).toBe(0);
    const result = UiCatalogDiffResultSchema.parse(doc);
    expect(result).toMatchObject({ ok: true, from: { sha: OLD, states: 3 }, to: { sha: NEW, states: 3 }, summary: { picture: 1, added: 1, removed: 1, unchanged: 1, total: 4 } });
    expect(result.changes.map(change => [change.state, change.change]).sort()).toEqual([['fresh', 'added'], ['gone', 'removed'], ['home', 'picture']]);
    const text = await p.run('diff', '--from', OLD, '--to', NEW);
    expect(text.out).toContain('1 picture, 0 unverified, 1 added, 1 removed, 1 unchanged');
    expect((await p.run('diff', '--from', OLD, '--to', NEW, '--format', 'markdown')).out).toContain('- **home** (home, Desktop web · 1280x800): picture');
  });

  test('a difference fails only when asked to, and a commit that is not there says which are', async () => {
    const p = await twoCommits();
    expect((await p.run('diff', '--from', OLD, '--to', NEW, '--fail-on-change')).code).toBe(1);
    expect((await p.run('diff', '--from', NEW, '--to', NEW, '--fail-on-change')).code).toBe(0);
    await expect(p.run('diff', '--from', 'deadbee', '--to', NEW)).rejects.toThrow(/No layer was recorded at commit deadbee\. Commits with layers: b{12}, a{12}/);
    await expect(p.run('diff', '--from', OLD)).rejects.toThrow('--from <commit> and --to <commit>');
    expect(UiCatalogDiffResultSchema.parse((await p.json('diff', '--from', OLD, '--to', NEW, '--q', 'home')).doc).summary.total).toBe(1);
  });
});

describe('atlas ui-catalog export', () => {
  test('writes one HTML file with the pictures in it, and the manifest beside it when asked', async () => {
    const p = project();
    p.write('home.png', png(1));
    p.write('c.json', JSON.stringify([{ id: 'home', title: 'Home', screenshot: 'home.png' }, { id: 'broken', status: 'failed', detail: 'never ready' }]));
    await p.run('publish', '--captures', 'c.json', '--producer', 'capture', ...profile, ...at(NEW, 1));
    const { code, doc } = await p.json('export', '--out', 'out/catalog.html', '--manifest', 'out/catalog.json', '--title', 'Our product');
    expect(code).toBe(0);
    const result = UiCatalogExportResultSchema.parse(doc);
    expect(result).toMatchObject({ out: 'out/catalog.html', states: 2, cells: 2, pictures: { embedded: 1, left: 0 }, manifest: 'out/catalog.json' });
    const html = readFileSync(path.join(p.dir, 'out/catalog.html'), 'utf8');
    expect(result.bytes).toBe(Buffer.byteLength(html));
    expect(html).toContain('<title>Our product</title>');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('never ready');
    expect(JSON.parse(readFileSync(path.join(p.dir, 'out/catalog.json'), 'utf8')).summary.states).toBe(2);
  });

  test('--images none and --max-mb leave pictures out and say so, in the page and in the result', async () => {
    const p = project();
    p.write('home.png', png(1));
    p.write('c.json', JSON.stringify([{ id: 'home', screenshot: 'home.png' }]));
    await p.run('publish', '--captures', 'c.json', '--producer', 'capture', ...profile, ...at(NEW, 1));
    const none = UiCatalogExportResultSchema.parse((await p.json('export', '--out', 'a.html', '--images', 'none')).doc);
    expect(none.pictures).toMatchObject({ embedded: 0, left: 1 });
    expect(readFileSync(path.join(p.dir, 'a.html'), 'utf8')).not.toContain('data:image');
    expect(readFileSync(path.join(p.dir, 'a.html'), 'utf8')).toContain('--images none');
    const zero = UiCatalogExportResultSchema.parse((await p.json('export', '--out', 'b.html', '--max-mb', '0')).doc);
    expect(zero.pictures).toMatchObject({ embedded: 0, left: 1 });
    expect(zero.warnings.join()).toContain('size limit');
    expect(readFileSync(path.join(p.dir, 'b.html'), 'utf8')).toContain('would pass the export');
    await expect(p.run('export')).rejects.toThrow('--out');
    await expect(p.run('export', '--out', 'x.html', '--images', 'some')).rejects.toThrow('--images takes');
  });
});
