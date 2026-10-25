import { afterEach, expect, test } from 'bun:test';

import { openAtlas, SPECS, type Atlas } from './atlas';
import { act } from 'react';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

test('the header has one project picker and keeps project discovery errors inside view options', async () => {
  atlas = await openAtlas({
    at: '/',
    deps: {},
    specs: { ...SPECS, 'order.machine.json': CHART },
    projects: () => Response.json({ error: 'Not found' }, { status: 404 })
  });
  await atlas.sees('Project switching is unavailable.');
  const header = atlas.host.querySelector('header')!;
  const pickers = header.querySelectorAll<HTMLSelectElement>('select[aria-label="Project"]');
  expect(pickers).toHaveLength(1);
  expect(pickers[0]!.disabled).toBe(true);
  expect(atlas.find('button', 'View options')!.getAttribute('aria-expanded')).toBe('false');
  await atlas.click('button', 'View options');
  expect(atlas.find('[role="alert"]', 'Project switching is unavailable')?.textContent).toContain('Restart the Atlas server');
  expect(atlas.find('a', 'Settings')).toBeDefined();
  await act(async () => {
    atlas!.find('button', 'Retry projects')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(atlas.find('button', 'View options')!.getAttribute('aria-expanded')).toBe('false');
});

test('the single project picker lists available projects and spec menus close on outside interaction', async () => {
  atlas = await openAtlas({
    at: '/',
    deps: {},
    specs: { ...SPECS, 'order.machine.json': CHART },
    projects: () =>
      Response.json({
        projects: [
          { slug: 'default', name: 'Default' },
          { slug: 'shop', name: 'Shop' }
        ]
      })
  });
  await atlas.until(() => atlas!.host.querySelector('header select option[value="shop"]') !== null, 'project options');
  const picker = atlas.host.querySelector<HTMLSelectElement>('select[aria-label="Project"]')!;
  expect([...picker.options].map((option) => option.text)).toEqual(['Default', 'Shop']);
  expect(picker.disabled).toBe(false);
  await atlas.click('button', 'Spec type');
  expect(atlas.find('button', 'Spec type')!.getAttribute('aria-expanded')).toBe('true');
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  expect(atlas.find('button', 'Spec type')!.getAttribute('aria-expanded')).toBe('false');
});

test('opening Sources removes its parent popover and restores focus to View options after closing the drawer', async () => {
  atlas = await openAtlas({ at: '/specs/gherkin', deps: {}, specs: SPECS });
  await atlas.until(() => !!atlas!.find('button', 'Sources'), 'the Sources action');
  const trigger = atlas.find('button', 'View options')!;
  await atlas.click('button', 'View options');
  const optionsId = trigger.getAttribute('aria-controls')!;
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(optionsId)).not.toBeNull();
  await atlas.click('button', 'Sources');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.getElementById(optionsId)).toBeNull();
  const drawer = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!;
  expect(drawer).not.toBeNull();
  expect(drawer.textContent).toContain('Sources');
  await act(async () => drawer.querySelector<HTMLButtonElement>('button[aria-label="Close sources"]')!.click());
  await atlas.until(() => document.activeElement === trigger, 'focus returning to View options');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await atlas.click('button', 'View options');
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
});

const CHART = JSON.stringify({
  id: 'order',
  initial: 'Browsing the menu',
  states: { 'Browsing the menu': { on: { 'Customer pays': 'Order complete' } }, 'Order complete': { type: 'final' } }
});

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
