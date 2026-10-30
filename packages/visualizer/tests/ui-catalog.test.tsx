import { afterEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { uiPlanLayer, uiStateLayer, type UiStateCapture } from '@crvouga/atlas/reports/ui-catalog-publish';
import { act } from 'react';

import { createNode } from '../../server/tests/node-compat';
import { screenViewerLink } from '../src/catalog/handoff';
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

test('populated UI states expose the catalog in the spec-type menu from a spec page', async () => {
  const store = memoryStore();
  await publishChecks(store, uiPlanLayer({ producer: 'todo-plan', recordedAtMs: 1, ...light, states: [{ id: 'welcome' }] }));
  await publishChecks(store, uiStateLayer({ producer: 'todo-capture', recordedAtMs: 2, ...light, states: [shot('welcome')] }));
  const { node } = await open([store], '/specs/gherkin');
  await atlas!.until(() => document.querySelector('button[aria-label="Spec type"]') !== null, 'spec menu loaded');
  await atlas!.click('button', 'Spec type');
  await atlas!.until(() => !!atlas!.find('[role="menuitem"]', 'UI catalog'), 'UI catalog menu item');
  await atlas!.click('[role="menuitem"]', 'UI catalog');
  await atlas!.sees('Screen welcome');
  expect(atlas!.router.state.location.pathname).toBe('/catalog');
  node.close();
});

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
  // Operational tables stay out of the browsing page until explicitly requested.
  expect(document.querySelector('table[aria-label="Surfaces"]')).toBeNull();
  expect(atlas!.text()).not.toContain('2 without one');
  await atlas!.click('button', 'Surface coverage');
  await atlas!.sees('2 without one');
  await atlas!.click('button', 'Close catalog details');
  await atlas!.until(() => !document.querySelector('table[aria-label="Surfaces"]'), 'details closed');
  expect(cards()).toEqual(['cart', 'home']);
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

test('an opened state integrates its profiles with the layer and backend each picture came from, and why a capture failed', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, shard: '2/4', states: [shot('pay')] }));
  await publishChecks(store, uiStateLayer({ producer: 'devices', recordedAtMs: 2, ...phone, states: [shot('pay', { status: 'failed', detail: 'timed out waiting for #total', screenshot: undefined })] }));
  await open([store], '/catalog?state=pay');
  await atlas!.sees('Image profile');
  await atlas!.click('button', 'Capture details');
  await atlas!.sees('Desktop web · light · 1280x800');
  await atlas!.sees('Mobile web · dark · 390x844');
  expect(atlas!.text()).toContain('timed out waiting for #total');
  expect(atlas!.text()).toMatch(/From layer [0-9a-f]{12} in backend backend-0, producer capture, shard 2\/4/);
  expect(atlas!.text()).toContain('Capture failed');
  await atlas!.click('button', 'Close screen details');
  await act(async () => document.querySelector<HTMLElement>('section[aria-label="Catalog details gallery"] button')!.click());
  await atlas!.until(() => !document.querySelector('section[aria-label="Catalog details gallery"]'), 'closed');
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

const gallery = () => document.querySelector<HTMLElement>('nav[aria-label="Catalog item navigation"]')!;
const galleryButton = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
async function galleryKey(key: string, target: HTMLElement = gallery(), extra: KeyboardEventInit = {}) {
  await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })));
}

test('gallery arrows and numbered pagination navigate the filtered order, preserve scope, and stop at both ends', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [shot('a'), shot('b', { status: 'failed' }), shot('c'), shot('d')] }));
  await open([store], '/catalog?coverage=captured&state=a');
  await atlas!.sees('Item 1 of 3: Screen a');
  expect(document.querySelector('section[aria-label="Catalog details gallery"]')).not.toBeNull();
  expect(document.querySelector('input[aria-label="Search catalog"]')).toBeNull();
  expect(galleryButton('Previous catalog item').disabled).toBe(true);
  await galleryKey('ArrowLeft');
  expect(atlas!.router.state.location.search.state).toBe('a');
  await atlas!.click('button', 'Next catalog item');
  await atlas!.sees('Item 2 of 3: Screen c');
  expect(document.activeElement).toBe(gallery());
  expect(atlas!.router.state.location.search.coverage).toBe('captured');
  await atlas!.click('button', 'Go to item 3: Screen d');
  await atlas!.sees('Item 3 of 3: Screen d');
  expect(galleryButton('Next catalog item').disabled).toBe(true);
  expect(galleryButton('Go to item 3: Screen d').getAttribute('aria-current')).toBe('page');
  await galleryKey('ArrowRight');
  expect(atlas!.router.state.location.search.state).toBe('d');
  await galleryKey('ArrowLeft');
  await atlas!.sees('Item 2 of 3: Screen c');
  await galleryKey('ArrowRight', gallery(), { altKey: true });
  expect(atlas!.router.state.location.search.state).toBe('c');
  // Native editing keeps its arrow keys.
  const input = document.createElement('input');
  gallery().append(input);
  await galleryKey('ArrowRight', input);
  expect(atlas!.router.state.location.search.state).toBe('c');
  input.remove();
  await galleryKey('ArrowRight');
  await atlas!.sees('Item 3 of 3: Screen d');
  await galleryKey('Escape');
  await atlas!.until(() => !gallery(), 'gallery closed by Escape');
  expect(atlas!.router.state.location.search.state).toBeUndefined();
  expect(atlas!.router.state.location.search.coverage).toBe('captured');
  await galleryKey('ArrowRight', document.body);
  expect(atlas!.router.state.location.search.state).toBeUndefined();
});

test('a single-item gallery disables both arrows, and an item outside the filters keeps its deep link without a false position', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [shot('a'), shot('b', { status: 'failed' })] }));
  await open([store], '/catalog?coverage=captured&state=a');
  await atlas!.sees('Item 1 of 1: Screen a');
  expect(galleryButton('Previous catalog item').disabled).toBe(true);
  expect(galleryButton('Next catalog item').disabled).toBe(true);
  await atlas!.go('/catalog?coverage=captured&state=b');
  await atlas!.sees('Screen b is outside the current filters.');
  expect(document.querySelector('button[aria-label="Next catalog item"]')).toBeNull();
  await galleryKey('ArrowLeft');
  expect(atlas!.router.state.location.search.state).toBe('b');
  await galleryKey('Escape');
  await atlas!.until(() => !gallery(), 'outside-filter gallery closed');
});

test('keyboard navigation works from the return button, reaches items beyond the card limit, and restores focus on exit', async () => {
  const store = memoryStore();
  await publishChecks(store, uiPlanLayer({ producer: 'planner', recordedAtMs: 1, ...light, states: Array.from({ length: 50 }, (_, i) => ({ id: `state-${String(i).padStart(2, '0')}` })) }));
  await open([store]);
  await atlas!.sees('state-00');
  expect(cards()).toHaveLength(24);
  const opener = atlas!.find('a', 'Open state-00')!;
  await act(async () => { opener.focus(); opener.click(); });
  await atlas!.sees('Item 1 of 50: state-00');
  await galleryKey('ArrowRight', atlas!.find('button', 'Back to catalog')!);
  await atlas!.sees('Item 2 of 50: state-01');
  await atlas!.click('button', 'Go to item 50: state-49');
  await atlas!.sees('Item 50 of 50: state-49');
  expect(cards()).toHaveLength(0);
  await galleryKey('Escape');
  await atlas!.until(() => !gallery(), 'gallery closed');
  await atlas!.until(() => document.activeElement === atlas!.find('a', 'Open state-00'), 'focus restored to opener');
  expect(cards()).toHaveLength(24);
});

test('attributes a producer declared are filterable from the address and shown with the state, with no change to the viewer for a new name', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [shot('home', { attributes: { locale: 'de-DE' } }), shot('cart', { attributes: { locale: 'en-US', 'brand-new-dimension': 'x' } }), shot('pay')] }));
  await open([store], '/catalog?attribute=locale%3Dde-DE');
  await atlas!.sees('Screen home');
  expect(cards()).toEqual(['home']);
  await atlas!.go('/catalog?state=cart');
  await atlas!.sees('Image profile');
  await atlas!.click('button', 'Item details');
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

test('browse controls filter by area and profile, sort, and preserve a shareable URL', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [shot('home', { area: 'account' }), shot('cart', { area: 'checkout' })] }));
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 2, ...phone, states: [shot('home', { area: 'account' })] }));
  await open([store]);
  await atlas!.sees('Screen home');
  const select = async (label: string, value: string) => {
    const input = [...document.querySelectorAll('select')].find(input => input.labels?.[0]?.textContent === label)!;
    expect(input).toBeDefined();
    await act(async () => {
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  await select('Area', 'account');
  expect(cards()).toEqual(['home']);
  const profile = [...document.querySelectorAll('select')].find(input => input.labels?.[0]?.textContent === 'Profile')!;
  await select('Profile', [...profile.options].find(option => option.value.includes('mobile-web'))!.value);
  await select('Sort by', 'recent');
  const url = atlas!.router.state.location.href;
  expect(decodeURIComponent(url)).toContain('profile:');
  expect(decodeURIComponent(url)).toContain('sort:recent');
  await atlas!.go(url);
  expect(cards()).toEqual(['home']);
  expect(document.querySelector('[data-state="home"]')!.textContent).not.toContain('desktop-web');
});

test('pictures open an image gallery with zoom, bounded navigation and recoverable image errors', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 2, ...light, states: [shot('alpha'), shot('beta')] }));
  await publishChecks(store, uiStateLayer({ producer: 'phone', recordedAtMs: 3, ...phone, states: [shot('alpha')] }));
  const { node } = await open([store]);
  await atlas!.sees('Screen alpha');
  const trigger = document.querySelector<HTMLButtonElement>('[data-state="alpha"] button[aria-label^="Inspect"]')!;
  await act(async () => trigger.click());
  await atlas!.sees('Image profile');
  expect(cards()).toEqual([]);
  await atlas!.click('button', 'Open full-screen');
  await atlas!.sees('Image gallery');
  const dialog = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(el => el.textContent?.includes('Image gallery')).at(-1)!;
  expect(dialog().textContent).toContain('Image 1 of 2');
  const button = (name: string) => [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name)!;
  expect(button('Previous image').disabled).toBe(true);
  const image = dialog().querySelector<HTMLImageElement>('img')!;
  const imageFrame = dialog().querySelector<HTMLElement>('[role="group"][aria-label$=": image frame"]')!;
  const frameStyle = imageFrame.getAttribute('style');
  Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } });
  await act(async () => image.dispatchEvent(new Event('load')));
  await act(async () => button('Actual size').click());
  expect(dialog().textContent).toContain('100%');
  expect(parseFloat(image.style.width)).toBeGreaterThan(0);
  await act(async () => button('Zoom in').click());
  expect(dialog().textContent).toContain('125%');
  await act(async () => dialog().querySelector('[aria-label="Close image gallery"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true })));
  expect(dialog().textContent).toContain('100%');
  await act(async () => button('Next image').click());
  expect(dialog().textContent).toContain('Image 2 of 2');
  expect(dialog().querySelector('img')!.alt).toContain('Mobile web');
  expect(button('Next image').disabled).toBe(true);
  await act(async () => dialog().querySelector('img')!.dispatchEvent(new Event('error')));
  expect(dialog().textContent).toContain('Image could not be loaded');
  expect(dialog().querySelector('[role="group"][aria-label$=": image frame"]')!.getAttribute('style')).toBe(frameStyle);
  await act(async () => button('Try again').click());
  expect(dialog().textContent).toContain('Loading image');
  await act(async () => dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(dialog().textContent).toContain('Image 1 of 2');
  await act(async () => dialog().querySelector<HTMLButtonElement>('[aria-label="Close image gallery"]')!.click());
  await atlas!.until(() => !dialog(), 'gallery closed');
  expect(cards()).toEqual([]);
  await atlas!.click('button', 'Back to catalog');
  expect(cards()).toEqual(['alpha', 'beta']);
  node.close();
});

test('full-screen image navigation stays in the item and closing it preserves the focused details view', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'desktop', recordedAtMs: 2, ...light, states: [shot('alpha'), shot('beta')] }));
  await publishChecks(store, uiStateLayer({ producer: 'phone', recordedAtMs: 3, ...phone, states: [shot('alpha')] }));
  const { node } = await open([store], '/catalog?state=alpha');
  await atlas!.sees('Image profile');
  await atlas!.click('button', 'Open full-screen');
  const dialog = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(el => el.textContent?.includes('Image gallery')).at(-1)!;
  await atlas!.until(() => !!dialog(), 'image gallery');
  await act(async () => dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(atlas!.router.state.location.search.state).toBe('alpha');
  expect(dialog().textContent).toContain('Image 2 of 2');
  await act(async () => dialog().querySelector<HTMLButtonElement>('[aria-label="Close image gallery"]')!.click());
  await atlas!.until(() => !dialog(), 'full-screen closed over details');
  expect(document.querySelector('section[aria-label="Catalog details gallery"]')).not.toBeNull();
  expect(cards()).toEqual([]);
  expect(document.querySelector<HTMLSelectElement>('section[aria-label="Catalog details gallery"] select')!.value).toStartWith('mobile-web');
  node.close();
});

test('surface diagnostics are bounded inside details and choosing a surface returns to the grid', async () => {
  const store = memoryStore();
  await publishChecks(store, uiPlanLayer({ producer: 'planner', recordedAtMs: 1, ...light, states: [
    ...Array.from({ length: 30 }, (_, index) => ({ id: `surface-${index}`, inventory: true })),
    { id: 'home', covers: ['surface-0'] }
  ] }));
  await open([store]);
  await atlas!.sees('Surface coverage');
  expect(document.querySelector('[data-surface]')).toBeNull();
  await atlas!.click('button', 'Surface coverage');
  expect(document.querySelectorAll('[data-surface]')).toHaveLength(20);
  await atlas!.click('button', 'Show more surfaces');
  expect(document.querySelectorAll('[data-surface]')).toHaveLength(30);
  await act(async () => document.querySelector<HTMLAnchorElement>('[data-surface="surface-0"] a')!.click());
  await atlas!.until(() => !document.querySelector('[data-surface]'), 'surface selection closes details');
  expect(cards()).toEqual(['home']);
  expect(atlas!.router.state.location.search).toMatchObject({ surface: 'surface-0' });
});

test('grid/list links and focused item navigation preserve filtered sort order and return focus to the index', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'desktop', recordedAtMs: 2, ...light, states: [
    shot('a', { title: 'Alpha checkout', area: 'checkout' }),
    shot('z', { title: 'Zulu checkout', area: 'checkout' }),
    shot('hidden', { title: 'Account', area: 'account' })
  ] }));
  await open([store], '/catalog?find=area%3Acheckout%20sort%3Atitle-desc');
  await atlas!.sees('Zulu checkout');
  expect(cards()).toEqual(['z', 'a']);
  const list = document.querySelector<HTMLInputElement>('input[value="list"]')!;
  await act(async () => list.click());
  await atlas!.until(() => atlas!.router.state.location.search.layout === 'list', 'list layout in address');
  const indexUrl = atlas!.router.state.location.href;
  const opener = document.querySelector<HTMLButtonElement>('[data-state="z"] button[aria-label^="Inspect"]')!;
  await act(async () => { opener.focus(); opener.click(); });
  await atlas!.sees('Item 1 of 2: Zulu checkout');
  expect(cards()).toEqual([]);
  expect(document.querySelector('input[aria-label="Search catalog"]')).toBeNull();
  expect(document.querySelector('h1')!.textContent).toBe('Zulu checkout');
  await atlas!.click('button', 'Next catalog item');
  await atlas!.sees('Item 2 of 2: Alpha checkout');
  const detailsUrl = atlas!.router.state.location.href;
  await atlas!.go(detailsUrl);
  await atlas!.sees('Item 2 of 2: Alpha checkout');
  expect(atlas!.router.state.location.search).toMatchObject({ layout: 'list', find: 'area:checkout sort:title-desc' });
  await atlas!.click('button', 'Back to catalog');
  await atlas!.until(() => cards().join() === 'z,a', 'filtered index restored');
  expect(atlas!.router.state.location.href).toBe(indexUrl);
  expect(document.querySelector<HTMLInputElement>('input[value="list"]')!.checked).toBe(true);
  expect(document.activeElement).toBe(document.querySelector('[data-state="z"] button[aria-label^="Inspect"]'));
  await act(async () => document.querySelector<HTMLInputElement>('input[value="grid"]')!.click());
  expect(cards()).toEqual(['z', 'a']);
  expect(atlas!.router.state.location.search.layout).toBe('grid');
});

test('opening a live search result commits the draft so gallery links retain the exact index scope', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [shot('cart'), shot('home')] }));
  await open([store], '/catalog?q=Screen');
  await atlas!.sees('Screen cart');
  await editCatalogSearch('cart');
  await atlas!.until(() => cards().join() === 'cart', 'live search narrowed');
  await atlas!.click('a', 'Open Screen cart');
  await atlas!.sees('Item 1 of 1: Screen cart');
  expect(atlas!.router.state.location.search.find).toBe('Screen cart');
  expect(atlas!.router.state.location.search.q).toBeUndefined();
  await atlas!.go(atlas!.router.state.location.href);
  await atlas!.sees('Item 1 of 1: Screen cart');
  await atlas!.click('button', 'Back to catalog');
  expect(cards()).toEqual(['cart']);
});

test('profile-filtered details open the matching profile and retain missing-image and failure evidence', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'desktop', recordedAtMs: 1, ...light, states: [shot('pay'), shot('desktop-only')] }));
  await publishChecks(store, uiStateLayer({ producer: 'phone', recordedAtMs: 2, ...phone, states: [shot('pay', { status: 'failed', detail: 'Payment confirmation never appeared', screenshot: undefined })] }));
  await open([store], '/catalog?state=pay');
  await atlas!.sees('Image profile');
  const profile = document.querySelector<HTMLSelectElement>('section[aria-label="Catalog details gallery"] select')!;
  const mobileKey = [...profile.options].find(option => option.value.startsWith('mobile-web'))!.value;
  const search = `profile:${JSON.stringify(mobileKey)}`;
  await atlas!.go(`/catalog?state=pay&find=${encodeURIComponent(search)}&layout=list`);
  await atlas!.sees('Item 1 of 1: Screen pay');
  const selected = document.querySelector<HTMLSelectElement>('section[aria-label="Catalog details gallery"] select')!;
  expect(selected.value).toBe(mobileKey);
  expect(document.querySelector('section[aria-label="Catalog details gallery"] img')).toBeNull();
  expect(atlas!.text()).toContain('Payment confirmation never appeared');
  expect(atlas!.text()).toContain('Capture failed');
  await act(async () => { selected.value = [...selected.options].find(option => option.value.startsWith('desktop-web'))!.value; selected.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(document.querySelector('section[aria-label="Catalog details gallery"] img')).not.toBeNull();
  const shared = atlas!.router.state.location.href;
  await atlas!.go(shared);
  expect(document.querySelector('section[aria-label="Catalog details gallery"] img')).not.toBeNull();
  await atlas!.click('button', 'Back to catalog');
  expect(cards()).toEqual(['pay']);
  expect(atlas!.router.state.location.search).toMatchObject({ find: search, layout: 'list' });
  expect(document.activeElement).toBe(document.querySelector('h1'));
});

test('grid and list previews reserve the same frame for loading, empty, failed and retried images', async () => {
  const store = memoryStore();
  await publishChecks(store, uiPlanLayer({ producer: 'plan', recordedAtMs: 1, ...light, states: [{ id: 'missing' }] }));
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 2, ...light, states: [shot('ready'), shot('omitted', { screenshot: undefined }), shot('failed', { status: 'failed', screenshot: undefined })] }));
  const { node } = await open([store]);
  await atlas!.sees('Screen ready');
  const frameOf = (id: string) => document.querySelector<HTMLElement>(`[data-state="${id}"] [role="group"][aria-label$=": image frame"]`)!;
  const frame = frameOf('ready');
  for (const id of ['missing', 'omitted', 'failed']) expect(frameOf(id).querySelector('[role="img"]')).not.toBeNull();
  expect(frame.textContent).toContain('Loading image');
  await act(async () => frame.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(frame.textContent).toContain('Image could not be loaded');
  expect(frameOf('ready')).toBe(frame);
  const source = frame.querySelector('img')!.getAttribute('src');
  await act(async () => frame.querySelector<HTMLButtonElement>('button:not([aria-label])')!.click());
  expect(frame.textContent).toContain('Loading image');
  expect(frame.querySelector('img')!.getAttribute('src')).toBe(source);
  await act(async () => frame.querySelector('img')!.dispatchEvent(new Event('load')));
  expect(frame.textContent).not.toContain('Loading image');
  expect(frame.querySelector('img')!.getAttribute('aria-hidden')).toBe('false');
  await act(async () => document.querySelector<HTMLInputElement>('input[value="list"]')!.click());
  expect(frameOf('ready')).toBe(frame);
  for (const id of ['missing', 'omitted', 'failed']) expect(frameOf(id).querySelector('[role="img"]')).not.toBeNull();
  const oldSource = frame.querySelector('img')!.getAttribute('src');
  await act(async () => frame.querySelector('img')!.dispatchEvent(new Event('error')));
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 3, ...light, states: [shot('ready', { screenshot: { data: new TextEncoder().encode('updated picture') } })] }));
  await node.index.refresh();
  await atlas!.pollReport();
  await atlas!.until(() => frameOf('ready').querySelector('img')?.getAttribute('src') !== oldSource, 'replacement picture');
  expect(frameOf('ready')).toBe(frame);
  expect(frame.textContent).toContain('Loading image');
  expect(frame.querySelector('[role="alert"]')).toBeNull();
  node.close();
});

test('focused inspection keeps a fixed stage across image load, error, retry and an empty profile', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'desktop', recordedAtMs: 1, ...light, states: [shot('home')] }));
  await publishChecks(store, uiStateLayer({ producer: 'phone', recordedAtMs: 2, ...phone, states: [shot('home', { screenshot: undefined })] }));
  const { node } = await open([store], '/catalog?state=home');
  await atlas!.sees('Image profile');
  const stage = document.querySelector<HTMLElement>('[role="group"][aria-label="Selected image"]')!;
  const height = stage.style.height;
  const frame = stage.querySelector<HTMLElement>('[role="group"][aria-label$=": image frame"]')!;
  const area = frame.querySelector('[role="region"]')!;
  expect(area.textContent).not.toContain('Loading image');
  expect(frame.textContent).toContain('Loading image');
  frame.getBoundingClientRect = () => new window.DOMRect(0, 0, 400, 300);
  const image = frame.querySelector('img')!;
  Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } });
  await act(async () => image.dispatchEvent(new Event('load')));
  expect(document.querySelector('[aria-label="Zoom level"]')!.textContent).toBe('40%');
  expect(stage.style.height).toBe(height);
  await act(async () => image.dispatchEvent(new Event('error')));
  expect(frame.querySelector('[role="alert"]')!.textContent).toContain('Image could not be loaded');
  expect(area.contains(frame.querySelector('[role="alert"]'))).toBe(false);
  expect(stage.style.height).toBe(height);
  await act(async () => frame.querySelector<HTMLButtonElement>('button')!.click());
  expect(frame.textContent).toContain('Loading image');
  expect(stage.style.height).toBe(height);
  const profile = document.querySelector<HTMLSelectElement>('section[aria-label="Catalog details gallery"] select')!;
  await act(async () => { profile.value = [...profile.options].find(option => option.value.startsWith('mobile-web'))!.value; profile.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(document.querySelector('[aria-label="Selected image"]')).toBe(stage);
  expect(stage.querySelector('img')).toBeNull();
  expect(stage.textContent).toContain('Captured without a picture');
  expect(stage.style.height).toBe(height);
  node.close();
});

test('screen sharing copies actionable Markdown and opens exact profile links without navigating the gallery behind a dialog', async () => {
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const written: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { written.push(value); } } });
  try {
    const store = memoryStore();
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [shot('pay', { route: '/checkout', fixture: 'signed-in' }), shot('next')] }));
    await open([store], '/catalog?state=pay&find=sort%3Atitle-desc&layout=list');
    await atlas!.sees('Screen pay');
    await atlas!.click('button', 'Copy as Markdown');
    await atlas!.sees('Copied to clipboard');
    expect(written[0]).toContain('State ID: ` pay `');
    expect(written[0]).toContain('/checkout');
    expect(written[0]).toContain('signed-in');
    expect(written[0]).toContain('/blobs/attachments/');
    await atlas!.click('button', 'Share screen');
    const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(el => el.textContent?.includes('Agent Markdown link'))!;
    expect(dialog).toBeDefined();
    const inputs = [...dialog.querySelectorAll<HTMLInputElement>('input')];
    const viewer = inputs.find(input => input.value.includes('#/catalog'))!.value;
    const agent = inputs.find(input => input.value.includes('/ui-catalog/detail'))!.value;
    expect(new URL(agent).searchParams.get('state')).toBe('pay');
    expect(new URL(agent).searchParams.get('image')).toStartWith('desktop-web');
    expect(viewer).toContain('layout=list');
    await galleryKey('ArrowRight', dialog);
    expect(atlas!.router.state.location.search.state).toBe('pay');
    await galleryKey('Escape', dialog);
    await atlas!.until(() => !document.querySelector('[aria-label="Close screen sharing"]'), 'share dialog closed');
    expect(atlas!.router.state.location.search.state).toBe('pay');
    await atlas!.go(new URL(viewer).hash.slice(1));
    await atlas!.sees('Image profile');
    expect(atlas!.router.state.location.search.image).toStartWith('desktop-web');
  } finally {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard); else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

test('clipboard denial has a manual Markdown fallback and screen dialogs keep their selection', async () => {
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied'); } } });
  try {
    const store = memoryStore();
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...light, states: [shot('home', { attributes: { component: 'src/Home.tsx' } })] }));
    await open([store], '/catalog?state=home');
    await atlas!.sees('Screen home');
    await atlas!.click('button', 'Copy as Markdown');
    await atlas!.sees('Clipboard unavailable');
    await atlas!.click('button', 'Select Markdown manually');
    const markdown = document.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(markdown.readOnly).toBe(true);
    expect(markdown.value).toContain('src/Home.tsx');
    await atlas!.click('button', 'Close screen sharing');
    await atlas!.click('button', 'Item details');
    await atlas!.until(() => !!document.querySelector('table[aria-label="Declared facts"]'), 'screen facts dialog');
    const dialog = document.querySelector('[aria-label="Close screen details"]')!.closest('[role="dialog"]') as HTMLElement;
    await galleryKey('Escape', dialog);
    expect(atlas!.router.state.location.search.state).toBe('home');
    expect(atlas!.router.state.location.search.panel).toBeUndefined();
  } finally {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard); else Reflect.deleteProperty(navigator, 'clipboard');
  }
});


test('share URLs retain project and opaque profile keys while excluding credentials and transient dialogs', () => {
  const profile = 'mobile|[["locale","pt-BR"],["viewport","390x844"]]';
  const link = new URL(screenViewerLink('https://user:password@atlas.test/view/?project=shop&token=secret#/catalog', { find: 'area:"Patient visits" sort:recent', layout: 'list', panel: 'captures' }, 'visit/new & pending', profile));
  expect(link.username).toBe('');
  expect(link.password).toBe('');
  expect(link.searchParams.get('project')).toBe('shop');
  expect(link.searchParams.has('token')).toBe(false);
  expect(link.pathname).toBe('/view/');
  const query = new URLSearchParams(link.hash.split('?')[1]);
  expect(query.get('state')).toBe('visit/new & pending');
  expect(query.get('image')).toBe(profile);
  expect(query.get('find')).toBe('area:"Patient visits" sort:recent');
  expect(query.has('panel')).toBe(false);
});
