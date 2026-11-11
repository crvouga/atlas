/**
 * @module UI catalog index route tests
 *
 * Issue #94: `GET /api/reports/ui-catalog?view=index` is a compact projection of the same catalog, `?since=` answers with only
 * what changed (or the whole index when the version is not remembered), `?id=` reads the full documents of a few states,
 * and a client that asks none of this gets the document it always got.
 */
import { describe, expect, test } from 'bun:test';

import { publishChecks } from '../../reports/src/publish-checks';
import { uiCatalog, type UiCatalog } from '../../reports/src/ui-catalog';
import { applyUiCatalogIndexDelta, uiCatalogFromIndex, uiCatalogIndexOf, UiCatalogIndexes, type UiCatalogIndex } from '../../reports/src/ui-catalog-index';
import { uiStateLayer } from '../../reports/src/ui-catalog-publish';
import { memoryStore } from '../../reports/tests/memory-store';
import { UiCatalogIndexSchema } from '../../schema/src/api';
import { createAtlasServer } from '../src/app';

const light = { environment: 'desktop-web', profile: { viewport: '1280x800' } } as const;
const phone = { environment: 'mobile-web', profile: { viewport: '390x844' } } as const;
const shot = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Screen ${id}`, route: `/${id}`, covers: [id], screenshot: { data: new TextEncoder().encode(`png:${id}:${JSON.stringify(extra)}`), width: 10, height: 10 }, ...extra });

async function start() {
  const store = memoryStore();
  const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', refreshMs: 60_000 });
  await server.ready;
  const get = async <T>(path: string) => (await server.fetch(new Request(`http://atlas.test/api/reports${path}`))).json() as Promise<T>;
  return { store, server, get };
}

const ids = (catalog: { states: readonly { id: string }[] }) => catalog.states.map(state => state.id);

describe('the UI catalog index', () => {
  test('is the same catalog without the evidence a card draws, and much smaller', async () => {
    const { store, server, get } = await start();
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [shot('a'), shot('b', { status: 'failed', detail: 'never ready' }), shot('c')] }));
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 2, ...phone, states: [shot('a'), shot('c')] }));
    await server.index.refresh();
    const full = await get<UiCatalog>('/ui-catalog');
    const index = await get<UiCatalogIndex>('/ui-catalog?view=index');
    expect(index.view).toBe('index');
    expect(UiCatalogIndexSchema.safeParse(index).success).toBe(true);
    expect(index.summary).toEqual(full.summary);
    expect(index.facets).toEqual(full.facets);
    expect(ids(index)).toEqual(ids(full));
    expect(index.states[1]!.cells[0]).toMatchObject({ coverage: 'failed', status: 'failed', detail: 'never ready', producer: 'capture' });
    expect(JSON.stringify(index)).not.toContain('/blobs/attachments/');
    // Projected in the browser it searches, filters and counts like the full document.
    const hydrated = uiCatalogFromIndex(index);
    expect(hydrated.states.map(state => state.cells.map(cell => [cell.profile.label, cell.coverage, cell.expected]))).toEqual(full.states.map(state => state.cells.map(cell => [cell.profile.label, cell.coverage, cell.expected])));
    // A client that asks for none of this gets the document it always got.
    expect(full).not.toHaveProperty('view');
    expect(full.states[0]!.cells[0]!.capture!.image!.path).toContain('/blobs/attachments/');
    server.close();
  });

  test('?id= reads the full documents of exactly those states', async () => {
    const { store, server, get } = await start();
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: ['a', 'b', 'c', 'd'].map(id => shot(id)) }));
    await server.index.refresh();
    const page = await get<UiCatalog>('/ui-catalog?id=d,b&limit=2');
    expect(ids(page)).toEqual(['b', 'd']);
    expect(page.states[0]!.cells[0]!.capture!.image!.path).toContain('/blobs/attachments/');
    server.close();
  });

  test('2. ?since= answers with only the states that changed, and the whole index when that version is not remembered', async () => {
    const { store, server, get } = await start();
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: ['a', 'b', 'c'].map(id => shot(id)) }));
    await server.index.refresh();
    const held = await get<UiCatalogIndex>('/ui-catalog?view=index&limit=1000');
    // A new capture of one state, and a state that did not exist.
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 2, ...light, states: [shot('b', { title: 'Screen b, again' }), shot('e')] }));
    await server.index.refresh();
    const delta = await get<UiCatalogIndex>(`/ui-catalog?view=index&limit=1000&since=${held.version}`);
    expect(delta.since).toEqual({ requested: held.version!, honored: true });
    expect(ids(delta)).toEqual(['b', 'e']);
    expect(delta.removed).toEqual([]);
    const applied = applyUiCatalogIndexDelta(held, delta);
    const fresh = await get<UiCatalogIndex>('/ui-catalog?view=index&limit=1000');
    expect(applied.states).toEqual(fresh.states);
    expect(applied.summary).toEqual(fresh.summary);
    // Nothing changed since the current version: nothing is sent, and what is held is kept as it is.
    const none = await get<UiCatalogIndex>(`/ui-catalog?view=index&limit=1000&since=${fresh.version}`);
    expect(none.states).toEqual([]);
    expect(applyUiCatalogIndexDelta(fresh, none)).toBe(fresh);
    // A version the server never answered for: the whole index, said so.
    const unknown = await get<UiCatalogIndex>('/ui-catalog?view=index&limit=1000&since=not-a-version');
    expect(unknown.since).toEqual({ requested: 'not-a-version', honored: false });
    expect(ids(unknown)).toEqual(['a', 'b', 'c', 'e']);
    expect(applyUiCatalogIndexDelta(held, unknown)).toBe(unknown);
    server.close();
  });

  test('a delta is only ever against the same question, and removed states are named', () => {
    const indexes = new UiCatalogIndexes(4);
    const empty = uiCatalog([]);
    const catalog = (states: number[]): UiCatalog => ({ ...empty, states: states.map(n => ({ id: `s${n}`, title: `S${n}`, route: `/${n}`, fixture: null, cohort: null, area: null, kind: null, flags: [], covers: [], attributes: {}, producers: ['capture'], cells: [] })) });
    const first = indexes.answer(catalog([1, 2, 3]), { version: 'v1', scope: 'all', limit: 100, offset: 0 });
    expect(first.states.map(state => state.id)).toEqual(['s1', 's2', 's3']);
    const later = indexes.answer(catalog([1, 3, 4]), { version: 'v2', scope: 'all', since: 'v1', limit: 100, offset: 0 });
    expect(later.states.map(state => state.id)).toEqual(['s4']);
    expect(later.removed).toEqual(['s2']);
    expect(applyUiCatalogIndexDelta(first, later).states.map(state => state.id)).toEqual(['s1', 's3', 's4']);
    // Another question (other filters, another definition) never takes a delta against this one.
    expect(indexes.answer(catalog([1]), { version: 'v3', scope: 'q=s1', since: 'v1', limit: 100, offset: 0 }).since).toEqual({ requested: 'v1', honored: false });
  });

  test('random sequences of results: the index held through deltas always equals the index read from scratch', async () => {
    const { store, server, get } = await start();
    let random = 7;
    const next = (n: number) => (random = (random * 1103515245 + 12345) % 2147483648) % n;
    let held: UiCatalogIndex | undefined;
    for (let round = 0; round < 12; round++) {
      const profile = next(2) ? light : phone;
      const states = Array.from({ length: 1 + next(4) }, () => shot(`s${next(8)}`, next(3) ? {} : { status: 'failed', detail: `round ${round}` }));
      await publishChecks(store, uiStateLayer({ producer: `capture-${next(2)}`, recordedAtMs: 10 + round, ...profile, states }));
      await server.index.refresh();
      const answer = await get<UiCatalogIndex>(`/ui-catalog?view=index&limit=1000${held ? `&since=${held.version}` : ''}`);
      held = held ? applyUiCatalogIndexDelta(held, answer) : answer;
      const fresh = await get<UiCatalogIndex>('/ui-catalog?view=index&limit=1000');
      expect(held.states).toEqual(fresh.states);
      expect(uiCatalogIndexOf(uiCatalog((await get<{ layers: never[] }>('/evidence/effective')).layers)).states.map(state => state.fingerprint)).toEqual(fresh.states.map(state => state.fingerprint));
    }
    server.close();
  });
});
