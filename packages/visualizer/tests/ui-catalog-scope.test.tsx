import { afterEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { expandCatalog, resolveCatalog, type CatalogDefinition } from '@crvouga/atlas/reports/ui-catalog-definition';
import { uiStateLayer, type UiStateCapture } from '@crvouga/atlas/reports/ui-catalog-publish';
import { act } from 'react';

import { createNode } from '../../server/tests/node-compat';
import { memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const A: CatalogDefinition = { name: 'web', matrix: { dimensions: { device: { values: ['mobile', 'desktop'] }, scheme: { values: ['light', 'dark'] } } }, states: [{ id: 'cart' }, { id: 'home' }, { id: 'legacy' }] };
const B: CatalogDefinition = { name: 'web', matrix: { dimensions: { device: { values: ['phone', 'tablet'] }, scheme: { values: ['light', 'dark'] }, density: { values: ['1x', '2x'] } } }, states: [{ id: 'cart' }, { id: 'home' }, { id: 'search' }] };
const cards = () => [...document.querySelectorAll<HTMLElement>('[role="list"][aria-label="States"] [role="listitem"]')].map(card => card.dataset.state);

/** A node where A was captured (its `legacy` state failing with one fingerprint) and then B replaced it and was partly captured. */
async function migrated() {
  const store = memoryStore();
  const a = await resolveCatalog(A), b = await resolveCatalog(B);
  const capture = async (profiles: ReturnType<typeof expandCatalog>['profiles'], at: number, states: UiStateCapture[]) => {
    for (const profile of profiles) await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: at, ...(profile.environment ? { environment: profile.environment } : {}), profile: profile.parameters, states }));
  };
  await capture(expandCatalog(a.document, a.version).profiles, 1_000, [{ id: 'cart', title: 'Cart' }, { id: 'home', title: 'Home' }, { id: 'legacy', title: 'Legacy', status: 'failed', detail: 'GET https://api.example/old?token=abc failed', labels: { fingerprint: 'legacy-gone', phase: 'load' } }]);
  await capture(expandCatalog(b.document, b.version).profiles.slice(0, 2), 2_000, [{ id: 'cart', title: 'Cart' }, { id: 'home', title: 'Home', status: 'failed', detail: 'timeout' }, { id: 'search', title: 'Search' }]);
  const node = createNode({ stores: [{ id: 'data', store, label: 'Shared store' }], refreshMs: 60_000 });
  await node.ready;
  for (const resolved of [a, b]) {
    const response = await node.fetch(new Request(`http://atlas.test/api/ui-catalog/definitions/${resolved.version}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(resolved.document) }));
    expect(response.status).toBe(201);
  }
  return { node, a, b };
}

async function choose(label: string, value: string) {
  const select = [...document.querySelectorAll<HTMLSelectElement>('select')].find(element => element.labels?.[0]?.textContent?.includes(label))!;
  expect(select, label).toBeDefined();
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('#87: latest is pinned to its version in the address, counts exactly that definition, and all history is a separate choice', async () => {
  const { node, b } = await migrated();
  atlas = await openAtlas({ at: '/catalog?definition=latest', deps: {}, specs: {}, node, queue: true });
  await atlas.sees('3 states × 8 profiles = 24 expected cells');
  // 3: the link now names the version, so it keeps meaning B after another definition is published.
  await atlas.until(() => (atlas!.router.state.location.search as { definition?: string }).definition === b.version, 'definition pinned');
  await atlas.until(() => cards().length === 3, 'B\'s states');
  expect(cards()).toEqual(['cart', 'home', 'search']);
  // 1: the history B leaves out is counted, not hidden.
  expect(atlas.text()).toContain('History outside it is not counted: 1 state, 4 profiles, 12 cells');
  // 2: under all history the removed state is still there.
  await choose('Count', 'all');
  await atlas.until(() => cards().includes('legacy'), 'all history');
  expect((atlas.router.state.location.search as { definition?: string }).definition).toBeUndefined();
  // Choosing the active definition again pins its version once more.
  await choose('Count', 'latest');
  await atlas.until(() => (atlas!.router.state.location.search as { definition?: string }).definition === b.version, 'pinned again');
  await atlas.until(() => cards().length === 3, 'B\'s states again');
  node.close();
});

test('#87: a definition the server does not hold is shown as unavailable, never as all history', async () => {
  const { node } = await migrated();
  atlas = await openAtlas({ at: `/catalog?definition=${'d'.repeat(64)}`, deps: {}, specs: {}, node, queue: true });
  await atlas.sees('This definition is unavailable');
  expect(cards()).toEqual([]);
  expect(atlas.text()).not.toContain('No UI states have been recorded yet');
  await atlas.click('button', 'Count all history instead');
  await atlas.until(() => cards().includes('legacy'), 'all history');
  node.close();
});

test('#93: failure groups follow the scope, say when grouping is inferred, redact the sample and link to every affected cell', async () => {
  const { node, b } = await migrated();
  atlas = await openAtlas({ at: '/catalog', deps: {}, specs: {}, node, queue: true });
  await atlas.until(() => cards().includes('legacy'), 'catalog');
  await atlas.click('button', 'Failure groups');
  await atlas.sees('Fingerprint legacy-gone');
  expect(atlas.text()).toContain('6 failed cells in 2 groups: 4 grouped by the producer’s fingerprint, 2 by message only.');
  expect(atlas.text()).toContain('inferred grouping, not a shared cause');
  expect(atlas.text()).not.toContain('token=abc');
  const group = document.querySelector('[data-failure-group="fingerprint:capture:legacy-gone"]')!;
  expect(group.querySelectorAll('li a')).toHaveLength(4);
  await act(async () => (group.querySelector('li a') as HTMLElement).click());
  await atlas.until(() => (atlas!.router.state.location.search as { state?: string }).state === 'legacy', 'drilled down');
  // Under B's scope, only B's failure is counted, and its drilldown keeps the scope.
  await atlas.go(`/catalog?definition=${b.version}`);
  await atlas.sees('24 expected cells');
  await atlas.click('button', 'Failure groups');
  await atlas.sees('2 failed cells in 1 group');
  expect(atlas.text()).not.toContain('legacy-gone');
  node.close();
});
