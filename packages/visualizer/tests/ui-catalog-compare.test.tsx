import { afterEach, expect, test } from 'bun:test';
import { layerKey } from '@crvouga/atlas/reports/layer-store';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { uiStateLayer, type UiStateCapture } from '@crvouga/atlas/reports/ui-catalog-publish';
import { act } from 'react';

import { createNode } from '../../server/tests/node-compat';
import { memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const OLD = 'a1'.repeat(20), NEW = 'b2'.repeat(20);
const desktop = { environment: 'desktop-web', profile: { viewport: '1280x800' } } as const;
const phone = { environment: 'mobile-web', profile: { viewport: '390x844' } } as const;
const shot = (id: string, picture: string | null, extra: Partial<UiStateCapture> = {}): UiStateCapture => ({ id, title: `Screen ${id}`, ...(picture ? { screenshot: { data: new TextEncoder().encode(`png:${picture}`) } } : {}), ...extra });
/** Clicks the checkbox or radio whose visible label is this. */
const choose = async (label: string) => {
  const control = [...document.querySelectorAll('label')].find((item) => item.textContent === label);
  const input = document.getElementById(control?.getAttribute('for') ?? '');
  expect(input, label).not.toBeNull();
  await act(async () => input!.click());
};
const entries = () => Object.fromEntries([...document.querySelectorAll<HTMLElement>('[role="list"][aria-label="Differences"] [role="listitem"]')].map((item) => [item.dataset.state, item.dataset.change]));

async function open(stores: ReturnType<typeof memoryStore>[], at: string) {
  const node = createNode({ stores: stores.map((store, i) => ({ id: `backend-${i}`, store, label: `Store ${i}` })), refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at, deps: {}, specs: {}, node });
  return node;
}

/** Chooses an option of the select with this label, by its value or by the words it shows. */
const select = async (label: string, choice: string) => {
  const control = [...document.querySelectorAll('label')].find((item) => item.textContent?.startsWith(label));
  const element = document.getElementById(control?.getAttribute('for') ?? '') as HTMLSelectElement;
  expect(element, label).toBeDefined();
  const value = [...element.options].find((option) => option.textContent === choice)?.value ?? choice;
  await act(async () => {
    Object.getOwnPropertyDescriptor((window as unknown as { HTMLSelectElement: typeof HTMLSelectElement }).HTMLSelectElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

async function twoCommits(store = memoryStore()) {
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 100, sha: OLD, branch: 'main', ...desktop, states: [shot('same', 'a'), shot('moved', 'b'), shot('gone', 'c'), shot('broke', 'd')] }));
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 200, sha: NEW, branch: 'main', ...desktop, states: [shot('same', 'a'), shot('moved', 'b2'), shot('fresh', 'e'), shot('broke', null, { status: 'failed', detail: 'timed out' })] }));
  return store;
}

test('two commits are compared from the layers of each, though the report holds only the newest capture of every state', async () => {
  const node = await open([await twoCommits()], `/catalog?compare=commit&from=${OLD}&to=${NEW}`);
  await atlas!.sees('Screen moved');
  // Differences are listed; what did not change is not, until asked for.
  expect(entries()).toEqual({ broke: 'coverage', fresh: 'added', gone: 'removed', moved: 'picture' });
  const frames = [...document.querySelectorAll<HTMLElement>('[aria-label="Differences"] [role="group"][aria-label$=": image frame"]')];
  expect(frames).toHaveLength(8);
  expect(frames.filter(frame => frame.textContent?.includes('Not on this side'))).toHaveLength(2);
  expect(frames.some(frame => frame.textContent?.includes('Capture failed'))).toBe(true);

  expect(atlas!.text()).toContain('Captured → Capture failed');
  expect(atlas!.text()).toContain('1 picture changed');
  // A picture that differs says what that means, and that it is not about pixels.
  expect(atlas!.text()).toContain('not how many pixels differ');
  // The picture of each side is the one recorded at its commit.
  const sources = [...document.querySelectorAll<HTMLImageElement>('[data-state="moved"] img')].map((image) => image.getAttribute('src'));
  expect(sources).toHaveLength(2);
  expect(new Set(sources).size).toBe(2);
  expect(sources.every((source) => source!.includes('/blobs/attachments/'))).toBe(true);
  await choose('Show unchanged');
  await atlas!.until(() => entries().same === 'unchanged', 'the unchanged state');
  node.close();
});

test('the commits to choose from are the ones the catalog was recorded at, and choosing is the address', async () => {
  const node = await open([await twoCommits()], '/catalog?compare=commit');
  await atlas!.sees('Compare the two newest commits');
  expect(document.querySelector('[role="list"][aria-label="Differences"]')).toBeNull();
  await atlas!.click('button', 'Compare the two newest commits');
  await atlas!.sees('Screen moved');
  expect(entries().moved).toBe('picture');
  await select('After', OLD);
  await atlas!.sees('The same commit is on both sides');
  node.close();
});

test('a layer that cannot be read is named, and what it held is not taken to be unchanged', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 100, sha: OLD, ...desktop, states: [shot('a', 'a'), shot('b', 'b')] }));
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 150, sha: NEW, ...desktop, states: [shot('a', 'a')] }));
  const broken = await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 160, sha: NEW, ...phone, states: [shot('b', 'b')] }));
  await store.put(layerKey(broken.id), new TextEncoder().encode('not a layer'), 'application/json');
  const node = await open([store], `/catalog?compare=commit&from=${OLD}&to=${NEW}`);
  await atlas!.sees('Some results could not be read');
  await atlas!.until(() => Object.keys(entries()).length > 0, 'the comparison');
  // The state the broken layer held is only on the before side: it is not shown as the same on both.
  expect(entries()).toEqual({ b: 'removed' });
  expect(atlas!.text()).toContain('may be incomplete');
  node.close();
});

test('two profiles of the report are set beside each other', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 100, sha: NEW, ...desktop, states: [shot('both', 'a'), shot('wide', 'b'), shot('split', 'c')] }));
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 100, sha: NEW, ...phone, states: [shot('both', 'a'), shot('narrow', 'd'), shot('split', 'c2')] }));
  const node = await open([store], '/catalog?compare=profile');
  await atlas!.sees('Two profiles');
  await select('Before', 'Desktop web · 1280x800');
  await select('After', 'Mobile web · 390x844');
  await atlas!.until(() => Object.keys(entries()).length > 0, 'the comparison');
  expect(entries()).toEqual({ narrow: 'added', split: 'picture', wide: 'removed' });
  expect(atlas!.text()).toContain('Desktop web · 1280x800');
  expect(atlas!.text()).toContain('Mobile web · 390x844');
  node.close();
});

test('a catalog with one profile or one commit says there is nothing to compare', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 100, sha: NEW, ...desktop, states: [shot('a', 'a')] }));
  const node = await open([store], '/catalog?compare=commit');
  await atlas!.sees('Only one commit has recorded layers');
  await choose('Two profiles');
  await atlas!.sees('This catalog has one profile');
  node.close();
});

test('the catalog page offers the comparison and the comparison goes back', async () => {
  const node = await open([await twoCommits()], '/catalog');
  await atlas!.sees('Screen moved');
  await atlas!.click('button', 'Compare');
  await atlas!.sees('Compare the two newest commits');
  await atlas!.click('button', 'Back to the catalog');
  await atlas!.until(() => document.querySelector('[role="list"][aria-label="States"]') !== null, 'the catalog');
  node.close();
});

test('rich term chips narrow both sides of a comparison and survive returning to the catalog', async () => {
  const store = memoryStore();
  for (const [sha, recordedAtMs] of [[OLD, 1], [NEW, 2]] as const) {
    await publishChecks(store, uiStateLayer({ producer: 'capture', sha, recordedAtMs, ...desktop, states: [
      shot('booking/error', sha, { title: 'Booking unavailable', kind: 'error' }),
      shot('billing/error', sha, { title: 'Billing unavailable', kind: 'error' })
    ] }));
  }
  const find = encodeURIComponent('appointment error');
  const node = await open([store], `/catalog?compare=commit&from=${OLD}&to=${NEW}&find=${find}`);
  await atlas!.until(() => entries()['booking/error'] === 'picture', 'matching changed appointment screen');
  expect(entries()).toEqual({ 'booking/error': 'picture' });
  await atlas!.click('button', 'Back to the catalog');
  await atlas!.until(() => !!document.querySelector('[role="list"][aria-label="States"] [data-state="booking/error"]'), 'filtered catalog');
  expect(document.querySelector('[role="list"][aria-label="States"] [data-state="billing/error"]')).toBeNull();
  expect(atlas!.router.state.location.search).toMatchObject({ find: 'appointment error' });
  node.close();
});
