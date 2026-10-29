import { expect, test } from 'bun:test';
import { uiCatalog } from '../../../reports/src/ui-catalog';
import { ReportIndex } from '../../../reports/src/report-index';
import { publishChecks } from '../../../reports/src/publish-checks';
import { uiStateLayer } from '../../../reports/src/ui-catalog-publish';
import { memoryStore } from '../../../reports/tests/memory-store';
import { addCatalogTokens, catalogExpression, catalogToken, catalogTokens, searchCatalog, suggestCatalog } from './query';

async function example() {
  const store = memoryStore();
  const png = { data: new Uint8Array([137, 80, 78, 71]) };
  await publishChecks(store, uiStateLayer({ producer: 'test', recordedAtMs: 1, environment: 'desktop-web', states: [
    { id: 'book/failed', title: 'Booking unavailable', area: 'Patient visits', kind: 'error', fixture: 'api-down', screenshot: png },
    { id: 'book/ready', title: 'Appointment details', area: 'Patient visits', kind: 'screen', screenshot: png },
    { id: 'billing/failed', title: 'Billing unavailable', kind: 'error', screenshot: png },
    { id: 'book/not-captured', title: 'Appointment confirmation', kind: 'success', status: 'failed', detail: 'Could not take a picture' }
  ] }));
  await publishChecks(store, uiStateLayer({ producer: 'mobile', recordedAtMs: 20, environment: 'mobile-web', states: [
    { id: 'book/failed', title: 'Booking unavailable', area: 'Patient visits', kind: 'error', screenshot: png }
  ] }));
  const index = new ReportIndex([{ id: 'local', store }]);
  await index.refresh();
  return uiCatalog(index.snapshot().layers);
}
const ids = (result: ReturnType<typeof searchCatalog>) => result.catalog.states.map(state => state.id);

test('appointment + error is an intersection across related wording, not a union or a failed-capture filter', async () => {
  const catalog = await example();
  expect(ids(searchCatalog(catalog, 'appointment error'))).toEqual(['book/failed']);
  expect(ids(searchCatalog(catalog, 'appontment eror'))).toEqual(['book/failed']);
  expect(ids(searchCatalog(catalog, 'kind:error appointment'))).toEqual(['book/failed']);
  expect(ids(searchCatalog(catalog, 'coverage:failed appointment'))).toEqual(['book/not-captured']);
  expect(ids(searchCatalog(catalog, 'appointment unknownword'))).toEqual([]);
  expect(ids(searchCatalog(catalog, '予約'))).toEqual([]);
  const localized = { ...catalog, states: [{ ...catalog.states[0]!, title: '予約の確認' }] };
  expect(searchCatalog(localized, '予約').catalog.states).toHaveLength(1);
});

test('recorded facts, quoted phrases and old facet links survive expression round trips', async () => {
  const catalog = await example();
  const expression = catalogExpression({ area: 'Patient visits', q: 'appointment', coverage: 'captured', state: 'book/failed' });
  expect(expression).toContain('area:"Patient visits"');
  expect(ids(searchCatalog(catalog, expression))).toEqual(['book/ready', 'book/failed']);
  expect(ids(searchCatalog(catalog, '"Booking unavailable"'))).toEqual(['book/failed']);
  const profile = catalog.profiles.find(profile => profile.environment === 'mobile-web')!;
  expect(catalogTokens(catalogToken('profile', profile.key))[0]!.value).toBe(profile.key);
  expect(searchCatalog(catalog, catalogToken('profile', profile.key)).catalog.summary.cells).toBe(1);
  expect(searchCatalog(catalog, 'appointment bogus:value').issues).toHaveLength(1);
  expect(searchCatalog(catalog, 'coverage:unknown').issues).toHaveLength(1);
  expect(searchCatalog(catalog, 'sort:__proto__').issues).toHaveLength(1);
});

test('sort is stable, chip replacement keeps a single order and summaries count only the kept cells', async () => {
  const catalog = await example();
  const expression = addCatalogTokens(catalogTokens('appointment sort:title'), 'sort:recent error');
  expect(expression).toBe('appointment sort:recent error');
  const result = searchCatalog(catalog, expression);
  expect(result.catalog.summary).toMatchObject({ states: 1, cells: 2, coverage: { captured: 2, failed: 0 } });
  expect(ids(searchCatalog(catalog, 'sort:recent'))[0]).toBe('book/failed');
  expect(ids(searchCatalog(catalog, 'sort:title'))[0]).toBe('book/not-captured');
  expect(ids(searchCatalog(catalog, 'sort:coverage'))[0]).toBe('book/not-captured');
  expect(catalog.states).toHaveLength(4);
});

test('autocomplete forgives typos, discovers related recorded kinds, excludes selected values and offers sorting', async () => {
  const catalog = await example();
  expect(suggestCatalog(catalog, 'eror', []).some(option => option.value === 'kind:error')).toBe(true);
  expect(suggestCatalog(catalog, 'appointment', []).some(option => option.label.includes('booking'))).toBe(true);
  expect(suggestCatalog(catalog, 'kind:', catalogTokens('kind:error')).some(option => option.value === 'kind:error')).toBe(false);
  expect(suggestCatalog(catalog, 'sort:', []).map(option => option.value)).toContain('sort:recent');
  expect(suggestCatalog(catalog, '', []).length).toBeLessThanOrEqual(12);
});
