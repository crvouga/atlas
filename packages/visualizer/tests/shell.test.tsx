import { afterEach, expect, test } from 'bun:test';

import { openAtlas, SPECS, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const CHART = JSON.stringify({ id: 'order', initial: 'Browsing the menu', states: { 'Browsing the menu': { on: { 'Customer pays': 'Order complete' } }, 'Order complete': { type: 'final' } } });

test('the explorer is one header, the open index of places and one plate', async () => {
  // regression: atlas-explorer-old-shell
  atlas = await openAtlas({ at: '/', deps: {}, specs: { ...SPECS, 'order.machine.json': CHART } });
  await atlas.sees('Browsing the menu');
  // Every place is one step away in the index, with no product sidebar or page of cards in between.
  expect(atlas.find('nav[aria-label="Places"] a', 'Browsing the menu')).toBeDefined();
  expect(atlas.find('nav[aria-label="Places"] a', 'Order complete')).toBeDefined();
  expect(atlas.find('nav[aria-label="Spec type"] a', 'Gherkin')).toBeDefined();
  expect(document.querySelectorAll('header').length).toBe(1);
  expect(document.querySelectorAll('aside nav, nav[aria-label="Atlas"], nav[aria-label="Product"]').length).toBe(0);
  expect(atlas.text()).not.toContain('A living map of your product');
});
