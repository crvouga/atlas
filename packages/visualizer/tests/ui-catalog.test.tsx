import { afterEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { uiPlanLayer, uiStateLayer, type UiStateCapture } from '@crvouga/atlas/reports/ui-catalog-publish';
import { act } from 'react';

import { createNode } from '../../server/tests/node-compat';
import { REPORTS_URL } from './preload';
import { memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const light = { environment: 'desktop-web', profile: { viewport: '1280x800', scheme: 'light' } } as const;
const phone = { environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'dark' } } as const;
const shot = (id: string, extra: Partial<UiStateCapture> = {}): UiStateCapture => ({ id, title: `Screen ${id}`, route: `/${id}`, covers: [id], screenshot: { data: new TextEncoder().encode(`png:${id}`), width: 100, height: 50 }, ...extra });
const cards = () => [...document.querySelectorAll<HTMLElement>('[role="list"][aria-label="States"] [role="listitem"]')].map((card) => card.dataset.state);

async function open(stores = [memoryStore()], at = '/catalog') {
  const node = createNode({ stores: stores.map((store, i) => ({ id: `backend-${i}`, store, label: i === 0 ? 'Shared store' : 'Device lab' })), refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at, deps: {}, specs: {}, node });
  return { node, stores };
}

test('the catalog lists captured states with their pictures loaded lazily, and says which are expected but not captured', async () => {
  const store = memoryStore();
  await publishChecks(store, uiPlanLayer({ producer: 'planner', recordedAtMs: 1, ...light, states: [{ id: 'home', covers: ['home'] }, { id: 'cart', covers: ['cart'] }, { id: 'admin', inventory: true }] }));
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 2, ...light, states: [shot('home')] }));
  const { node } = await open([store]);
  await atlas!.sees('Screen home');
  expect(cards()).toEqual(['cart', 'home']);
  await atlas!.sees('Not captured yet');
  const image = document.querySelector<HTMLImageElement>('[data-state="home"] img')!;
  expect(image.getAttribute('loading')).toBe('lazy');
  expect(image.getAttribute('src')).toMatch(new RegExp(`^${REPORTS_URL}/layers/[0-9a-f]{64}/blobs/attachments/[0-9a-f]{64}$`));
  expect(document.querySelector('[data-state="cart"] img')).toBeNull();
  expect(atlas!.text()).toContain('1 captured');
  expect(atlas!.text()).toContain('1 not captured yet');
  // The inventory names a surface nothing covers, and one whose state is not captured yet.
  expect(atlas!.text()).toContain('2 without one');
  // Only the pictures of what is on screen were asked for.
  expect(atlas!.requests.filter((request) => request.includes('/blobs/')).length).toBe(0);
  node.close();
});

test('5. a capture produced while the catalog is open appears without a reload; 7. what is not produced yet is not shown as captured', async () => {
  const store = memoryStore();
  await publishChecks(store, uiPlanLayer({ producer: 'planner', recordedAtMs: 1, ...light, states: [{ id: 'a' }, { id: 'b' }] }));
  const { node } = await open([store]);
  await atlas!.sees('Not captured yet');
  expect(atlas!.text()).not.toContain('Captured');
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 2, ...light, shard: '1/2', states: [shot('a')] }));
  await node.index.refresh();
  await atlas!.pollReport();
  await atlas!.until(() => document.querySelector('[data-state="a"]')?.textContent?.includes('Captured') ?? false, 'state a captured');
  expect(document.querySelector('[data-state="b"]')?.textContent).toContain('Not captured yet');
  node.close();
});

test('8. without the event stream the catalog still shows everything that exists', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [shot('a'), shot('b')] }));
  const { node } = await open([store]);
  await atlas!.sees('Screen b');
  expect(cards()).toEqual(['a', 'b']);
  node.close();
});

test('1 and 4. two backends are one catalog; an unavailable one is named and nothing that depended on it shows as captured', async () => {
  const shared = memoryStore(), lab = memoryStore();
  await publishChecks(shared, uiPlanLayer({ producer: 'planner', recordedAtMs: 1, ...phone, states: [{ id: 'home' }, { id: 'cart' }] }));
  await publishChecks(shared, uiStateLayer({ producer: 'capture', recordedAtMs: 2, ...phone, states: [shot('home')] }));
  await publishChecks(lab, uiStateLayer({ producer: 'devices', recordedAtMs: 3, ...phone, states: [shot('cart')] }));
  lab.down = true;
  const { node } = await open([shared, lab]);
  await atlas!.sees('Screen home');
  await atlas!.sees('Device lab');
  expect(atlas!.text()).toContain('not available');
  expect(document.querySelector('[data-state="cart"]')?.textContent).toContain('Not captured yet');
  expect(document.querySelector('[data-state="home"]')?.textContent).toContain('Captured');
  // The lab answers: its capture arrives, and the notice goes.
  lab.down = false;
  await node.index.refresh();
  await atlas!.pollReport();
  await atlas!.until(() => document.querySelector('[data-state="cart"]')?.textContent?.includes('Captured') ?? false, 'cart captured');
  node.close();
});

test('filters are the address: a link shows the same view, and clearing them shows everything', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [shot('home'), shot('cart'), shot('pay', { status: 'failed', detail: 'ready check never became true' })] }));
  await open([store], '/catalog?coverage=failed');
  await atlas!.sees('Screen pay');
  expect(cards()).toEqual(['pay']);
  await atlas!.go('/catalog?q=nothing-like-it');
  await atlas!.sees('Nothing matches these filters');
  await atlas!.click('button', 'Clear filters');
  await atlas!.until(() => cards().length === 3, 'every state');
});

test('an opened state shows its profiles side by side with the layer and backend each picture came from, and why a capture failed', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, shard: '2/4', states: [shot('pay')] }));
  await publishChecks(store, uiStateLayer({ producer: 'devices', recordedAtMs: 2, ...phone, states: [shot('pay', { status: 'failed', detail: 'timed out waiting for #total', screenshot: undefined })] }));
  await open([store], '/catalog?state=pay');
  await atlas!.sees('Profiles side by side');
  await atlas!.sees('Desktop web · light · 1280x800');
  await atlas!.sees('Mobile web · dark · 390x844');
  expect(atlas!.text()).toContain('timed out waiting for #total');
  expect(atlas!.text()).toMatch(/From layer [0-9a-f]{12} in backend backend-0, producer capture, shard 2\/4/);
  expect(atlas!.text()).toContain('Capture failed');
  await act(async () => document.querySelector<HTMLElement>('button[aria-label="Close the state"]')!.click());
  await atlas!.until(() => !document.body.textContent?.includes('Profiles side by side'), 'closed');
});

test('an address that names a state nobody has recorded says so instead of waiting forever', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [shot('home')] }));
  await open([store], '/catalog?state=ghost');
  await atlas!.sees('That state is not in the catalog');
});

test('a project with no UI states says how one is recorded', async () => {
  await open([memoryStore()]);
  await atlas!.sees('No UI states have been recorded yet');
});

test('attributes a producer declared are filterable from the address and shown with the state, with no change to the viewer for a new name', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [shot('home', { attributes: { locale: 'de-DE' } }), shot('cart', { attributes: { locale: 'en-US', 'brand-new-dimension': 'x' } }), shot('pay')] }));
  await open([store], '/catalog?attribute=locale%3Dde-DE');
  await atlas!.sees('Screen home');
  expect(cards()).toEqual(['home']);
  await atlas!.go('/catalog?state=cart');
  await atlas!.sees('Profiles side by side');
  expect(atlas!.text()).toContain('brand-new-dimension');
  expect(atlas!.text()).toContain('en-US');
});

async function editCatalogSearch(value: string) {
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Search catalog"]')!;
  await act(async () => {
    field.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return field;
}
async function catalogKey(field: HTMLInputElement, key: string) {
  await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true })); });
}

test('keyboard users combine two chips with AND, discover related wording, edit and remove chips, and restore a shared URL', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [
    shot('booking/error', { title: 'Booking unavailable', kind: 'error' }),
    shot('booking/ready', { title: 'Appointment details', kind: 'screen' }),
    shot('billing/error', { title: 'Billing unavailable', kind: 'error' })
  ] }));
  await open([store]);
  await atlas!.sees('Booking unavailable');
  const field = await editCatalogSearch('appontment');
  await atlas!.until(() => cards().length === 2, 'forgiving live results');
  await catalogKey(field, 'Enter');
  await atlas!.until(() => !!document.querySelector('button[aria-label="Remove appontment"]'), 'first chip');
  await editCatalogSearch('error');
  await catalogKey(field, 'Enter');
  await atlas!.until(() => cards().join() === 'booking/error', 'intersection of both chips');
  expect(atlas!.router.state.location.search).toMatchObject({ find: 'appontment error' });
  const shared = atlas!.router.history.location.href;
  await catalogKey(field, 'Backspace');
  expect(field.value).toBe('error');
  await catalogKey(field, 'Enter');
  await atlas!.click('button', 'Remove appontment');
  await atlas!.until(() => cards().length === 2, 'only error states');
  await atlas!.go('/catalog');
  await atlas!.until(() => cards().length === 3, 'all states');
  await atlas!.go(shared);
  await atlas!.until(() => cards().join() === 'booking/error', 'shared search restored');
  expect(document.querySelector('button[aria-label="Remove error"]')).not.toBeNull();
});

test('keyboard autocomplete selects facets and sorting, Tab commits, Escape dismisses, and invalid filters are explained', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [
    shot('a', { title: 'A screen', kind: 'error' }), shot('z', { title: 'Z screen', kind: 'screen' })
  ] }));
  await open([store]);
  await atlas!.sees('A screen');
  const field = await editCatalogSearch('kind:');
  expect(field.getAttribute('role')).toBe('combobox');
  await atlas!.sees('UI state kind');
  await catalogKey(field, 'ArrowDown'); // The free expression choice.
  await catalogKey(field, 'ArrowDown'); // First recorded kind, error.
  expect(field.getAttribute('aria-activedescendant')).toBeTruthy();
  await catalogKey(field, 'Enter');
  await atlas!.until(() => cards().join() === 'a', 'selected recorded kind');
  await atlas!.click('button', 'Clear catalog search');
  await editCatalogSearch('sort:');
  await catalogKey(field, 'ArrowDown');
  await catalogKey(field, 'ArrowDown'); // Best matches.
  await catalogKey(field, 'ArrowUp'); // Free expression.
  await catalogKey(field, 'Escape');
  expect(field.getAttribute('aria-expanded')).toBe('false');
  await editCatalogSearch('sort:title-desc');
  await catalogKey(field, 'Tab');
  await atlas!.until(() => cards().join() === 'z,a', 'descending title sort');
  await editCatalogSearch('unknown:thing');
  await catalogKey(field, 'Enter');
  await atlas!.sees('is not a supported filter');
  expect(cards()).toEqual(['z', 'a']);
});
