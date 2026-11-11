import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { UiCatalogExportResultSchema, UiCatalogFailuresResultSchema, UiCatalogStatusSchema } from '../../schema/src/cli-results';
import { directoryStore } from '../src/directory-store';
import { uiCatalogMain } from '../src/ui-catalog-cli';
import { DEFINITION_B, migrated } from './ui-catalog-scope-fixture';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

async function project() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ui-catalog-scope-'));
  dirs.push(dir);
  const fixture = await migrated(directoryStore(path.join(dir, 'store')));
  writeFileSync(path.join(dir, 'b.json'), JSON.stringify(fixture.b.document));
  writeFileSync(path.join(dir, 'a.json'), JSON.stringify(fixture.a.document));
  writeFileSync(path.join(dir, 'atlas.catalog.mjs'), `export default ${JSON.stringify(DEFINITION_B)};\n`);
  const run = async (...argv: string[]) => {
    let out = '';
    const code = await uiCatalogMain([...argv, '--store', path.join(dir, 'store')], { out: text => { out += text; }, cwd: dir, env: {}, git: () => null, clock: () => 5 });
    return { code, out };
  };
  const json = async (...argv: string[]) => { const { code, out } = await run(...argv, '--format', 'json'); return { code, doc: JSON.parse(out) as Record<string, unknown> }; };
  return { dir, fixture, run, json };
}

describe('#87 atlas ui-catalog --definition', () => {
  test('1, 2: status scoped to B counts exactly B\'s cells and says what history it leaves out; A still has the removed state', async () => {
    const p = await project();
    const underB = await p.json('status', '--definition', 'b.json');
    expect(underB.code).toBe(1);
    const status = UiCatalogStatusSchema.parse(underB.doc);
    expect(status.summary).toMatchObject({ states: 3, profiles: 8, cells: 24, coverage: { captured: 5, failed: 1, missing: 18 } });
    expect(status.profiles).toHaveLength(8);
    expect(status.scope).toMatchObject({ kind: 'definition', status: 'applied', definition: { version: p.fixture.b.version }, excluded: { states: 1, profiles: 4, cells: 12 } });
    expect(status.problems.some(problem => problem.state === 'legacy')).toBe(false);
    const underA = UiCatalogStatusSchema.parse((await p.json('status', '--definition', 'a.json')).doc);
    expect(underA.problems.filter(problem => problem.state === 'legacy')).toHaveLength(4);
    const text = await p.run('status', '--definition', 'b.json');
    expect(text.out).toContain(`Scope: definition "web" ${p.fixture.b.version.slice(0, 12)}: 3 states × 8 profiles = 24 expected cells.`);
  });

  test('--catalog resolves a defineCatalog module to the same scope as its stored document; --definition all is all history', async () => {
    const p = await project();
    const fromModule = UiCatalogStatusSchema.parse((await p.json('status', '--catalog', 'atlas.catalog.mjs')).doc);
    const fromFile = UiCatalogStatusSchema.parse((await p.json('status', '--definition', 'b.json')).doc);
    expect(fromModule.summary).toEqual(fromFile.summary);
    expect(fromModule.scope).toEqual(fromFile.scope);
    const all = UiCatalogStatusSchema.parse((await p.json('status', '--definition', 'all')).doc);
    expect(all.scope).toEqual({ kind: 'all-history', status: 'applied' });
    expect(all.summary.profiles).toBe(12);
    expect(UiCatalogStatusSchema.parse((await p.json('status')).doc).scope).toBeUndefined();
  });

  test('4: a definition that cannot be read is an unavailable scope and exit 1, never all history', async () => {
    const p = await project();
    const { code, doc } = await p.json('status', '--definition', 'c'.repeat(64));
    expect(code).toBe(1);
    const status = UiCatalogStatusSchema.parse(doc);
    expect(status.scope).toMatchObject({ kind: 'definition', status: 'unavailable', definition: { version: 'c'.repeat(64) } });
    expect(status.summary).toMatchObject({ states: 0, cells: 0 });
    expect(status.problems[0]).toMatchObject({ kind: 'unavailable' });
    expect((await p.json('status', '--definition', 'latest')).code).toBe(1);
    // A word that is no version, no file and no keyword is a usage mistake.
    await expect(uiCatalogMain(['status', '--definition', 'nonsense.json', '--store', path.join(p.dir, 'store')], { out: () => {}, cwd: p.dir, env: {} })).rejects.toThrow('--definition takes');
  });

  test('5: status, export and failures give the same totals for the same scope', async () => {
    const p = await project();
    const status = UiCatalogStatusSchema.parse((await p.json('status', '--definition', 'b.json')).doc);
    const exported = UiCatalogExportResultSchema.parse((await p.json('export', '--definition', 'b.json', '--out', 'out.html', '--images', 'none')).doc);
    expect(exported.summary).toEqual(status.summary);
    expect(exported.scope).toEqual(status.scope);
    expect(readFileSync(path.join(p.dir, 'out.html'), 'utf8')).toContain('Scope: definition &quot;web&quot;');
    const failures = UiCatalogFailuresResultSchema.parse((await p.json('failures', '--definition', 'b.json')).doc);
    expect(failures.total.failed).toBe(status.summary.coverage.failed);
    expect(failures.scope).toEqual(status.scope);
  });
});

describe('#93 atlas ui-catalog failures', () => {
  test('prints JSON and Markdown for a CI summary, with viewer links pinned to the scope', async () => {
    const p = await project();
    const { code, doc } = await p.json('failures');
    expect(code).toBe(1);
    const failures = UiCatalogFailuresResultSchema.parse(doc);
    expect(failures).toMatchObject({ ok: false, complete: true, total: { failed: 5, groups: 2, fingerprinted: 0, inferred: 5 } });
    expect(failures.groups.map(group => [group.sample, group.count, group.inferred])).toEqual([['old screen', 4, true], ['timeout', 1, true]]);
    const markdown = await p.run('failures', '--definition', 'b.json', '--format', 'markdown', '--viewer-url', 'https://atlas.example/');
    expect(markdown.out).toContain('# UI catalog failures');
    expect(markdown.out).toContain('inferred grouping, not a shared cause');
    expect(markdown.out).toContain(`https://atlas.example/#/catalog?state=home&image=`);
    expect(markdown.out).toContain(`definition=${p.fixture.b.version}`);
  });
});
