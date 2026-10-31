import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';

import { setFinderOpen } from '../src/find/open';
import { LoadError } from '../src/data/adapters';
import { loadingPolicy } from '../src/evidence/load-state';
import { FEATURE, memoryStore, openAtlas, publishRun, SPECS, step, type Atlas } from './atlas';

let atlas: Atlas | null = null;
const normalStall = loadingPolicy.stallMs;
beforeEach(() => {
  // The bound is seconds in the viewer; a test needs it to pass quickly.
  loadingPolicy.stallMs = 40;
});
afterEach(async () => {
  await act(async () => setFinderOpen(false));
  loadingPolicy.stallMs = normalStall;
  await atlas?.close();
  atlas = null;
});

const FOREVER = () => new Promise<never>(() => {});
const ADD = {
  test: 'add',
  title: 'Share a list: Add an item',
  status: 'passed' as const,
  steps: [step(1, 'Given a list'), step(2, 'When adding tea'), step(3, 'Then the list includes tea')]
};

/** A catalog of hundreds of specs, every one of them slow, beside the one a link names. */
function catalog(count: number): Record<string, string> {
  const bulk: Record<string, string> = {};
  for (let at = 0; at < count; at++) bulk[`bulk/spec-${at}.feature`] = `Feature: Bulk ${at}\n  Scenario: Case ${at}\n    When doing ${at}\n`;
  return { ...SPECS, ...bulk };
}

test('a known link renders its source without waiting for a slow catalog, within a request budget', async () => {
  // regression: focused-navigation-large-catalog
  const specs = catalog(300);
  const localStore = memoryStore();
  await publishRun(localStore, { at: 20, checks: [ADD], fingerprint: false });
  atlas = await openAtlas({
    at: '/specs/gherkin?spec=lists/add.feature',
    deps: { localStore },
    specs,
    // Every other spec would take forever; the linked one answers.
    readSpec: (path, text) => (path === 'lists/add.feature' ? Promise.resolve(text!) : FOREVER())
  });
  await atlas.sees('Add an item');
  await atlas.sees('1 passed');
  // Budgets: one spec file for a link to one spec, and the index, the outline and one layer's rows, however many specs there are.
  expect(atlas.specReads).toEqual(['lists/add.feature']);
  expect(atlas.requests.length).toBeLessThanOrEqual(4);
  expect(atlas.text()).not.toContain('Loading');
});

test('a spec that is not there says so with its source context and the ways on', async () => {
  atlas = await openAtlas({ at: '/specs/gherkin?run=abc&spec=lists/gone.feature', deps: {} });
  await atlas.sees('This feature is not available');
  expect(atlas.text()).toContain('specs/lists/gone.feature is not in this spec set');
  expect(atlas.text()).not.toContain('Loading specs/');
  const back = atlas.find('a', 'Back to Gherkin');
  expect(back?.getAttribute('href')).toContain('run=abc');
  expect(atlas.find('button', 'Try again')).toBeDefined();
});

test('a server that answers 404 is a missing spec, and a failing one is a failure to read it', async () => {
  const mode = { error: new LoadError('x', 404, 'The file is not there.') as Error };
  atlas = await openAtlas({
    at: '/specs/gherkin?spec=lists/add.feature',
    deps: {},
    readSpec: async () => {
      throw mode.error;
    }
  });
  await atlas.sees('This feature is not available');
  expect(atlas.text()).toContain('The file is not there.');
  mode.error = new LoadError('x', 500, 'The server answered with an error (500).');
  await atlas.click('button', 'Try again');
  await atlas.sees('The feature could not be read');
  expect(atlas.text()).toContain('The server answered with an error (500).');
  expect(atlas.text()).not.toContain('is not available');
});

test('a link naming a spec by another form of its path opens the listed spec, and a near miss offers it', async () => {
  atlas = await openAtlas({ at: '/specs/gherkin?spec=specs/Lists/Add.feature', deps: {} });
  await atlas.sees('Owners add items');
  expect(atlas.text()).not.toContain('not available');
  await atlas.go('/specs/gherkin?spec=./empty.feature');
  await atlas.sees('Empty the list');
  await atlas.go('/specs/gherkin?spec=other/add.feature');
  await atlas.sees('This feature is not available');
  await atlas.sees('Did you mean');
  expect(atlas.find('a', 'lists/add.feature')?.getAttribute('href')).toContain('spec=lists%2Fadd.feature');
});

test('a source request that stalls explains what is affected and retries or goes back in place', async () => {
  const calls: Array<(text: string) => void> = [];
  atlas = await openAtlas({
    at: '/specs/gherkin?run=abc&spec=lists/add.feature',
    deps: {},
    readSpec: (_, text) =>
      new Promise<string>((resolve) => {
        calls.push(() => resolve(text!));
      })
  });
  await atlas.sees('Loading specs/lists/add.feature');
  await atlas.sees('Reading the feature is taking longer than expected');
  expect(atlas.text()).toContain('Recorded results for other specs are not affected');
  expect(atlas.find('a', 'Back to Gherkin')?.getAttribute('href')).toContain('run=abc');
  await atlas.click('button', 'Try again');
  await atlas.until(() => calls.length === 2, 'a second attempt');
  await act(async () => calls[1]!(''));
  await atlas.sees('Owners add items');
  // The scope was kept throughout.
  expect(atlas.router.state.location.search).toMatchObject({ run: 'abc', spec: 'lists/add.feature' });
});

test('work that finishes after the selection changed does not replace the newer selection', async () => {
  const pending = new Map<string, (text: string) => void>();
  atlas = await openAtlas({
    at: '/specs/gherkin?spec=lists/add.feature',
    deps: {},
    readSpec: (path, text) =>
      path === 'lists/add.feature'
        ? new Promise<string>((resolve) => pending.set(path, () => resolve(text!)))
        : Promise.resolve(text!)
  });
  await atlas.sees('Loading specs/lists/add.feature');
  await atlas.go('/specs/gherkin?spec=lists/empty.feature');
  await atlas.sees('Empty the list');
  await act(async () => pending.get('lists/add.feature')!(FEATURE));
  expect(atlas.text()).toContain('Empty the list');
  expect(atlas.text()).not.toContain('Owners add items');
});

test('when one layer cannot be read the others stay usable and the page says its results may be incomplete', async () => {
  const localStore = memoryStore();
  await publishRun(localStore, { at: 20, producer: 'alpha', checks: [ADD] });
  await publishRun(localStore, { at: 30, producer: 'beta', checks: [{ ...ADD, test: 'add-beta', title: 'Share a list: Add several — Tea' }] });
  const broken = { path: null as string | null, on: true };
  atlas = await openAtlas({
    at: '/specs/gherkin?spec=lists/add.feature',
    deps: { localStore },
    intercept: (path) => {
      if (!path.startsWith('/evidence/rows/')) return undefined;
      broken.path ??= path;
      return broken.on && path === broken.path ? new Response('{"error":"boom"}', { status: 500 }) : undefined;
    }
  });
  await atlas.sees('1 layer could not be read');
  expect(atlas.text()).toContain('may be incomplete');
  expect(atlas.text()).not.toContain('Loading recorded results');
  expect(atlas.text()).toContain('1 passed');
  broken.on = false;
  await atlas.click('button', 'Try again');
  await atlas.until(() => !atlas!.text().includes('could not be read'), 'the layer to be read again');
});

test('recorded results that never arrive leave the spec readable and offer another attempt', async () => {
  atlas = await openAtlas({
    at: '/specs/gherkin?spec=lists/add.feature',
    deps: {},
    intercept: (path) => (path.startsWith('/evidence') ? FOREVER() : undefined)
  });
  await atlas.sees('Owners add items');
  await atlas.sees('Recorded results are taking longer than expected');
  expect(atlas.text()).toContain('The feature below is readable.');
  expect(atlas.find('button', 'Try again')).toBeDefined();
});

test('a recording whose result never arrives says so, with a way back and another attempt', async () => {
  atlas = await openAtlas({
    at: '/specs/gherkin?spec=lists/add.feature&check=lists/add&view=recording',
    deps: {},
    intercept: (path) => (path.startsWith('/evidence') ? FOREVER() : undefined)
  });
  await atlas.sees('Recorded results are taking longer than expected');
  expect(atlas.find('button', 'Share a list')).toBeDefined();
  expect(atlas.find('button', 'Try again')).toBeDefined();
});

test('a link to a layer the report does not hold says it shows the current result instead', async () => {
  const localStore = memoryStore();
  await publishRun(localStore, { at: 20, checks: [ADD] });
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature&check=lists/add&layer=nothing', deps: { localStore } });
  await atlas.sees('The layer this link names is not among the results held for this check');
});

async function search(value: string) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
  });
  await atlas!.until(() => document.querySelector('input[aria-label="Search and commands"]') !== null, 'the finder');
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search and commands"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const dialog = () => document.querySelector('[aria-label="Find"]')?.textContent ?? '';

test('a search with no matches says it is not final while specs are still being read, and what could not be read after', async () => {
  const release: Array<() => void> = [];
  const failing = { on: false };
  atlas = await openAtlas({
    at: '/specs/gherkin?spec=lists/add.feature',
    deps: {},
    readSpec: (path, text) =>
      path === 'lists/add.feature'
        ? Promise.resolve(text!)
        : new Promise<string>((resolve, reject) => release.push(() => (failing.on ? reject(new Error('gone')) : resolve(text!))))
  });
  await atlas.sees('Owners add items');
  // Nothing but the focused spec was read for search before search was asked for.
  expect(atlas.specReads).toEqual(['lists/add.feature']);
  await search('zzzunmatchable');
  await atlas.until(() => dialog().includes('No match yet'), 'the not-yet-indexed answer');
  expect(dialog()).toContain('specs are still being read, so this is not the final answer');
  expect(dialog()).not.toContain('Nothing close to that');
  failing.on = true;
  await act(async () => release.forEach((settle) => settle()));
  await atlas.until(() => dialog().includes('could not be read, so search may miss'), 'the incomplete-coverage answer');
  expect(dialog()).toContain('Nothing close to that');
});
