import { describe, expect, test } from 'bun:test';

import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { filterUiCatalog, uiCatalog, uiCatalogMarkdown, type UiCatalog } from '../src/ui-catalog';
import { catalogPlanLayers, expandCatalog, resolveCatalog } from '../src/ui-catalog-definition';
import { uiStateLayer } from '../src/ui-catalog-publish';
import { scopeUiCatalog } from '../src/ui-catalog-scope';
import { memoryStore } from './memory-store';
import { DEFINITION_B, migrated } from './ui-catalog-scope-fixture';

const totals = (catalog: UiCatalog) => ({ cells: catalog.summary.cells, ...catalog.summary.coverage });

describe('#87 scoping the catalog to one definition', () => {
  test('1: selecting B, which replaced A\'s four profiles with eight, gives exactly B\'s cells and counts the history it leaves out', async () => {
    const { b, whole } = await migrated();
    expect(whole.summary.profiles).toBe(12);
    const scoped = scopeUiCatalog(whole, { kind: 'definition', version: b.version, document: b.document });
    expect(scoped.summary).toMatchObject({ states: 3, profiles: 8, cells: 24, planned: true, undeclared: 0 });
    expect(scoped.states.map(state => state.id)).toEqual(['cart', 'home', 'search']);
    expect(scoped.states.every(state => state.cells.length === 8 && state.cells.every(cell => cell.expected === 'declared'))).toBe(true);
    // Two of B's profiles captured: 2 × 3 cells, one of them failed; the other 18 are not captured yet.
    expect(scoped.summary.coverage).toMatchObject({ captured: 5, failed: 1, missing: 18 });
    expect(scoped.scope).toMatchObject({
      kind: 'definition', status: 'applied', definition: { version: b.version, name: 'web' }, expected: { states: 3, profiles: 8, cells: 24 },
      // legacy (4 cells in A's profiles) and cart and home in A's four profiles (8 cells).
      excluded: { states: 1, profiles: 4, cells: 12, coverage: { captured: 8, failed: 4 } }
    });
    expect(scoped.profiles.map(profile => profile.key).sort()).toEqual(expandCatalog(b.document, b.version).profiles.map(profile => profile.key).sort());
    expect(uiCatalogMarkdown(scoped)).toContain('Scope: definition "web"');
  });

  test('2: a state removed in B is no gap under B, and stays under A and in all history', async () => {
    const { a, b, whole } = await migrated();
    const underB = scopeUiCatalog(whole, { kind: 'definition', version: b.version, document: b.document });
    expect(underB.states.some(state => state.id === 'legacy')).toBe(false);
    const underA = scopeUiCatalog(whole, { kind: 'definition', version: a.version, document: a.document });
    expect(underA.states.find(state => state.id === 'legacy')!.cells.map(cell => cell.coverage)).toEqual(['failed', 'failed', 'failed', 'failed']);
    expect(underA.summary).toMatchObject({ states: 3, profiles: 4, cells: 12 });
    expect(underA.scope!.excluded).toMatchObject({ states: 1, profiles: 8 });
    const all = scopeUiCatalog(whole, { kind: 'all-history' });
    expect(all.states.some(state => state.id === 'legacy')).toBe(true);
    expect(all.summary).toEqual(whole.summary);
    expect(all.scope).toEqual({ kind: 'all-history', status: 'applied' });
  });

  test('3: a pinned version keeps its counts when another definition is published later', async () => {
    const { a, whole } = await migrated();
    const before = scopeUiCatalog(whole, { kind: 'definition', version: a.version, document: a.document });
    // Publishing B after A did not change what A's version counts: A's projection is the same as on a catalog without B.
    const store = memoryStore();
    const ea = expandCatalog(a.document, a.version);
    for (const plan of catalogPlanLayers(ea, 1_000)) await publishChecks(store, plan);
    for (const profile of ea.profiles) {
      await publishChecks(store, uiStateLayer({
        producer: 'capture', recordedAtMs: 2_000, ...(profile.environment ? { environment: profile.environment } : {}), profile: profile.parameters,
        states: [{ id: 'cart', title: 'Cart' }, { id: 'home', title: 'Home' }, { id: 'legacy', title: 'Legacy', status: 'failed', detail: 'old screen' }]
      }));
    }
    const index = new ReportIndex([{ id: 'ci', store }]);
    await index.refresh();
    const onlyA = scopeUiCatalog(uiCatalog(index.snapshot().layers), { kind: 'definition', version: a.version, document: a.document });
    expect(totals(before)).toEqual(totals(onlyA));
  });

  test('4: an unavailable definition is an explicit unavailable scope, never all history', async () => {
    const { whole } = await migrated();
    const missing = 'f'.repeat(64);
    const scoped = scopeUiCatalog(whole, { kind: 'definition', version: missing, document: null, reason: 'No definition has that version' });
    expect(scoped.scope).toMatchObject({ kind: 'definition', status: 'unavailable', definition: { version: missing }, reason: 'No definition has that version' });
    expect(scoped.states).toEqual([]);
    expect(scoped.summary).toMatchObject({ states: 0, cells: 0, profiles: 0 });
    expect(scoped.scope!.excluded!.cells).toBe(whole.summary.cells);
    expect(scoped.sources.notices.at(-1)).toContain('nothing is counted');
  });

  test('a cell the definition expects that no layer holds is missing; filters narrow within the scope', async () => {
    const { b, whole } = await migrated();
    const scoped = scopeUiCatalog(whole, { kind: 'definition', version: b.version, document: b.document });
    const failed = filterUiCatalog(scoped, { coverage: ['failed'] });
    expect(failed.summary.cells).toBe(1);
    expect(failed.scope).toEqual(scoped.scope);
    // A definition with a state nobody planned or captured.
    const extra = await resolveCatalog({ ...DEFINITION_B, states: [{ id: 'cart' }, { id: 'brand-new', title: 'Brand new', route: '/new' }] });
    const fresh = scopeUiCatalog(whole, { kind: 'definition', version: extra.version, document: extra.document });
    expect(fresh.states.find(state => state.id === 'brand-new')).toMatchObject({ title: 'Brand new', route: '/new', producers: [] });
    expect(fresh.states.find(state => state.id === 'brand-new')!.cells.every(cell => cell.coverage === 'missing' && cell.expected === 'declared')).toBe(true);
  });
});
