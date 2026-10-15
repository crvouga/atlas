import { afterEach, expect, test } from 'bun:test';

import { openAtlas, SPECS, type Atlas } from './atlas';
import { act } from 'react';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

test('the header has one project picker and keeps project discovery errors inside view options', async () => {
  atlas = await openAtlas({ at: '/', deps: {}, specs: { ...SPECS, 'order.machine.json': CHART }, projects: () => Response.json({ error: 'Not found' }, { status: 404 }) });
  await atlas.sees('Project switching is unavailable.');
  const header = atlas.host.querySelector('header')!;
  const pickers = [...header.querySelectorAll<HTMLSelectElement>('select')].filter(select => select.labels?.[0]?.textContent?.startsWith('Project'));
  expect(pickers).toHaveLength(1);
  expect(pickers[0]!.disabled).toBe(true);
  const notice = header.querySelector('[role="alert"]')!;
  expect(notice.textContent).toContain('Restart the Atlas server');
  expect(notice.closest('details')?.open).toBe(false);
  expect(header.querySelector('[aria-label="Project breadcrumb"]')).toBeNull();
  const menu = header.querySelector<HTMLDetailsElement>('details[data-tools]')!;
  await act(async () => { menu.open = true; });
  expect(menu.textContent).toContain('Settings');
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(menu.open).toBe(false);
});

test('the single project picker lists the available projects and spec menus close on outside interaction', async () => {
  atlas = await openAtlas({ at: '/', deps: {}, specs: { ...SPECS, 'order.machine.json': CHART }, projects: () => Response.json({ projects: [{ slug: 'default', name: 'Default' }, { slug: 'shop', name: 'Shop' }] }) });
  await atlas.until(() => atlas!.host.querySelector('header select option[value="shop"]') !== null, 'project options');
  const picker = atlas.host.querySelector<HTMLSelectElement>('header label[data-project] select')!;
  expect([...picker.options].map(option => option.text)).toEqual(['Default', 'Shop']);
  expect(picker.disabled).toBe(false);
  const menu = atlas.host.querySelector<HTMLDetailsElement>('header details:not([data-tools])')!;
  await act(async () => { menu.open = true; });
  await act(async () => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  expect(menu.open).toBe(false);
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
