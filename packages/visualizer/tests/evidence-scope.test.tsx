import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';

import { createNode } from '../../server/tests/node-compat';
import { FEATURE, memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const SPEC = 'specs/lists/add.feature';
const bytes = (...values: number[]) => new Uint8Array(values);
const clip = (name: string, n: number, scope?: Record<string, unknown>) => ({ id: name, name, role: 'video', data: bytes(n), contentType: 'video/webm', ...(scope ? { scope } : {}) });

async function seed() {
  const store = memoryStore();
  await publishChecks(store, {
    producer: 'e2e',
    environment: 'ios',
    recordedAtMs: 5,
    checks: [
      {
        id: `${SPEC} > Add an item`,
        title: 'Add an item',
        status: 'passed',
        specPath: SPEC,
        attachments: [
          clip('script.webm', 1, { surface: 'browser', syntheticData: true, dependencies: 'scripted', audioCaptured: false, pacing: 'paced', asserted: ['the item is listed'], limitations: ['Replies are scripted'], declaredBy: 'e2e suite', provenance: [{ url: 'https://ci.example/run/1', name: 'CI run' }] }),
          clip('sim.webm', 2, { deviceKind: 'simulator', audioCaptured: false }),
          clip('phone.webm', 3, { deviceKind: 'physical', audioCaptured: true, verified: ['deviceKind'], verifiedBy: 'device farm' }),
          clip('mystery.webm', 4)
        ]
      }
    ]
  });
  return store;
}

async function open() {
  const node = createNode({ stores: [{ id: 'shared', store: await seed() }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature', deps: {}, specs: { 'lists/add.feature': FEATURE }, node });
  await atlas.sees('1 passed');
  await atlas.click('button', 'Add an item');
  await atlas.sees('script.webm');
  return { view: atlas, node };
}

const card = (name: string) => [...document.body.querySelectorAll('li[data-role]')].find((item) => item.textContent?.includes(name)) as HTMLElement;
const notice = (name: string) => document.body.querySelector<HTMLElement>(`[aria-label="Evidence scope of ${name}"]`)!;
const badgeText = (name: string) => [...notice(name).querySelectorAll('[data-basis]')].map((badge) => badge.textContent);

test('each recording shows its qualifications before it is played, and nothing is assumed for one that declared none', async () => {
  const { node } = await open();

  expect(badgeText('script.webm')).toEqual(['Surface: Browser', 'Synthetic data', 'Scripted dependencies', 'Silent', 'Paced']);
  // The qualification is above the player in the same card.
  const player = card('script.webm').querySelector('video')!;
  expect(player).not.toBeNull();
  expect(notice('script.webm').compareDocumentPosition(player) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  // A simulator and a physical phone stay distinct, and only the checked fact is marked verified.
  expect(badgeText('sim.webm')).toEqual(['Device: Simulator', 'Silent']);
  expect(badgeText('phone.webm')).toEqual(['Device: Physical (verified)', 'Audio recorded']);

  // Nothing declared: the scope is unknown, not live, physical or audible.
  expect(badgeText('mystery.webm')).toEqual(['Scope unknown']);
  expect(notice('mystery.webm').getAttribute('data-scope')).toBe('unknown');
  expect(notice('mystery.webm').textContent).not.toMatch(/Device: Physical|Audio recorded|Live dependencies/);
  node.close();
});

test('the exact declaration, its caveats, what was asserted and its provenance open on demand, apart from what was checked', async () => {
  const { view, node } = await open();
  const control = notice('script.webm').querySelector<HTMLButtonElement>('button')!;
  expect(control.textContent).toBe('Scope details');
  await act(async () => control.click());
  await view.sees('Only these were asserted: the item is listed');
  const text = notice('script.webm').textContent ?? '';
  expect(text).toContain('Other activity visible in the recording is not verified');
  expect(text).toContain('Replies are scripted');
  expect(text).toContain('Declared by e2e suite');
  expect(notice('script.webm').querySelector<HTMLAnchorElement>('a[href="https://ci.example/run/1"]')?.textContent).toBe('CI run');

  const phone = notice('phone.webm');
  await act(async () => phone.querySelector<HTMLButtonElement>('button')!.click());
  await view.sees('Verified by device farm: deviceKind');
  const rows = [...phone.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));
  expect(rows).toContainEqual(['Device', 'Physical', 'Verified']);
  expect(rows).toContainEqual(['Audio', 'Recorded', 'Declared']);
  expect(rows).toContainEqual(['Dependencies', 'Not declared', 'Not declared']);
  node.close();
});

test('the explorer narrows to physical, audible evidence and never includes the unknown or simulated ones', async () => {
  const node = createNode({ stores: [{ id: 'shared', store: await seed() }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at: '/?scope=device:physical,audio:recorded', deps: {}, specs: { 'lists/add.feature': FEATURE }, node });
  await atlas.sees('Add an item');
  expect(atlas.text()).toContain('Scope: device:physical');
  expect(atlas.text()).toContain('Scope: audio:recorded');

  await atlas.close();
  atlas = await openAtlas({ at: '/?scope=device:physical,device:simulator', deps: {}, specs: { 'lists/add.feature': FEATURE }, node });
  // One recording cannot be both: the list is empty rather than combining evidence from two devices.
  await atlas.sees('No test matches these filters.');
  node.close();
});
