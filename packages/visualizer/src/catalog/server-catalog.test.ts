import { describe, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { ReportIndex } from '@crvouga/atlas/reports/report-index';
import { uiCatalog, type UiCatalog } from '@crvouga/atlas/reports/ui-catalog';
import { uiCatalogFromIndex, uiCatalogIndexOf } from '@crvouga/atlas/reports/ui-catalog-index';
import { uiPlanLayer, uiStateLayer } from '@crvouga/atlas/reports/ui-catalog-publish';

import { memoryStore } from '../../../reports/tests/memory-store';
import { searchCatalog } from './query';
import { readIndex, readStates, withEvidence } from './server-catalog';

async function composed(): Promise<UiCatalog> {
  const store = memoryStore();
  const where = [
    { environment: 'desktop-web', profile: { viewport: '1280x800', scheme: 'light' } },
    { environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'dark' } }
  ] as const;
  const titles = ['Book an appointment', 'Appointment booked', 'Checkout payment failed', 'Empty cart', 'Sign in', 'Loading settings', 'Ошибка оплаты', 'Billing preferences'];
  for (const [n, profile] of where.entries()) {
    await publishChecks(store, uiPlanLayer({ producer: 'plan', recordedAtMs: 1, ...profile, states: titles.map((_, i) => ({ id: `area${i % 3}/s${i}`, covers: [`surface${i % 2}`] })).concat([{ id: 'never/captured', covers: ['ghost'] }]) }));
    await publishChecks(store, uiStateLayer({
      producer: `capture-${n}`, recordedAtMs: 10 + n, ...profile,
      states: titles.map((title, i) => ({ id: `area${i % 3}/s${i}`, title, route: `/r/${i}`, area: `area${i % 3}`, kind: i % 2 ? 'screen' : 'error', flags: [`flag${i % 2}`], covers: [`surface${i % 2}`], fixture: i % 2 ? 'signed-in' : 'guest', attributes: { locale: i % 2 ? 'en' : 'ru' }, status: i === 2 ? 'failed' as const : 'passed' as const, ...(i === 2 ? { detail: 'card declined' } : {}), screenshot: { data: new TextEncoder().encode(`png:${i}:${n}`), width: 10, height: 10 } }))
    }));
  }
  const index = new ReportIndex([{ id: 'test', store }]);
  await index.refresh();
  const snapshot = index.snapshot();
  return uiCatalog(snapshot.layers, { version: snapshot.version });
}

const view = (catalog: UiCatalog) => ({ ids: catalog.states.map(state => state.id), cells: catalog.states.map(state => state.cells.map(cell => `${cell.profile.key}:${cell.coverage}`)), summary: catalog.summary });

describe('the catalog read through a server (#94)', () => {
  test('3. search, facets and sorts give the same states in the same order over the index as over the composed catalog', async () => {
    const whole = await composed();
    const fromIndex = uiCatalogFromIndex(uiCatalogIndexOf(whole));
    for (const expression of ['', 'appointment', 'apointment', 'booking', 'payment failed', 'error', 'ошибка', 'coverage:failed', 'coverage:missing', 'kind:error', 'fixture:guest', 'attribute:locale=ru', 'surface:surface1 sort:title-desc', 'sort:recent', 'sort:coverage', 'profile:"mobile-web|[[\\"scheme\\",\\"dark\\"],[\\"viewport\\",\\"390x844\\"]]" settings', 'area:area1 flag:flag1', 'status:nonsense']) {
      const a = searchCatalog(whole, expression), b = searchCatalog(fromIndex, expression);
      expect(view(b.catalog), expression).toEqual(view(a.catalog));
      expect(b.issues, expression).toEqual(a.issues);
    }
  });

  test('a card draws the full evidence of the cells the page shows, and nothing the index alone would invent', async () => {
    const whole = await composed();
    const fromIndex = uiCatalogFromIndex(uiCatalogIndexOf(whole));
    const listed = searchCatalog(fromIndex, 'coverage:failed').catalog.states[0]!;
    expect(listed.cells[0]!.capture!.image).toBeNull();
    const full = whole.states.find(state => state.id === listed.id)!;
    const drawn = withEvidence(listed, full);
    expect(drawn.cells.map(cell => cell.profile.key)).toEqual(listed.cells.map(cell => cell.profile.key));
    expect(drawn.cells[0]!.capture!.image!.path).toContain('/blobs/attachments/');
  });

  test('1. the requests a reader makes: the index once, then deltas, and evidence by id', async () => {
    const whole = await composed();
    const paths: string[] = [];
    const read = async (path: string) => {
      paths.push(path);
      const params = new URLSearchParams(path.split('?')[1]);
      if (params.get('view') === 'index') return params.has('since') ? { ...uiCatalogIndexOf(whole), states: [], since: { requested: params.get('since')!, honored: true }, removed: [] } : uiCatalogIndexOf(whole);
      const wanted = new Set(params.get('id')!.split(','));
      return { ...whole, states: whole.states.filter(state => wanted.has(state.id)) };
    };
    const held = await readIndex(read, undefined);
    expect(await readIndex(read, held)).toBe(held);
    expect((await readStates(read, held.states.slice(0, 2).map(state => state.id))).size).toBe(2);
    expect(paths).toEqual([
      '/ui-catalog?view=index&limit=1000000',
      `/ui-catalog?view=index&limit=1000000&since=${encodeURIComponent(held.version!)}`,
      `/ui-catalog?id=${encodeURIComponent(`${held.states[0]!.id},${held.states[1]!.id}`)}&limit=2`
    ]);
  });
});
