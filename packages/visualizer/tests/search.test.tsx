import { afterEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import type { ObjectStore } from '@crvouga/atlas/reports/object-store';
import { act } from 'react';

import { setFinderOpen } from '../src/find/open';
import { provideEmbedder } from '../src/find/semantic-search';
import type { Embedder } from '../src/find/semantic';
import { memoryStore, openAtlas, type Atlas } from './atlas';

class FinderResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FinderResizeObserver as unknown as typeof ResizeObserver;

let atlas: Atlas | null = null;
afterEach(async () => {
  await act(async () => setFinderOpen(false));
  await atlas?.close();
  atlas = null;
  provideEmbedder(null);
});

const bytes = (text: string) => new TextEncoder().encode(text);
const spec = (folder: string) => `specs/${folder}/${folder}.feature`;
const KEEP = { id: 'memory/keep', title: 'Keep a saved answer', specPath: spec('memory') };
const FORGET = { id: 'memory/forget', title: 'Forget a saved note', specPath: spec('memory') };
const ROOM = { id: 'rooms/join', title: 'Join the product video room', specPath: spec('rooms') };
const PAY = { id: 'checkout/pay', title: 'Pay for the order', specPath: spec('checkout') };
const key = (check: { id: string; specPath: string }) => JSON.stringify([check.specPath, check.id]);
const RUN = (n: number) => `https://github.com/acme/app/actions/runs/${n}`;

/** Behaviors across two environments and two CI runs; one has a recording, one failed, and one only talks about video. */
async function publish(store: ObjectStore, extra: readonly { id: string; title: string; specPath: string }[] = []) {
  await publishChecks(store, {
    recordedAtMs: 100_000,
    sha: 'a'.repeat(40),
    branch: 'main',
    runUrl: RUN(1),
    producer: 'mobile',
    environment: 'ios',
    checks: [
      { ...KEEP, status: 'passed', attachments: [{ name: 'keep.webm', contentType: 'video/webm', data: bytes('keep') }] },
      { ...FORGET, status: 'failed', detail: 'Expected the note to be gone' },
      ...extra.map((check) => ({ ...check, status: 'passed' as const }))
    ]
  });
  await publishChecks(store, {
    recordedAtMs: 200_000,
    sha: 'b'.repeat(40),
    branch: 'main',
    runUrl: RUN(2),
    producer: 'web',
    environment: 'desktop-web',
    checks: [
      { ...ROOM, status: 'passed' },
      { ...PAY, status: 'passed', tags: ['smoke'] }
    ]
  });
}

const rows = () => [...document.querySelectorAll<HTMLElement>('section[aria-label="Tests"] li a')].map((row) => row.textContent ?? '');
const titles = () => rows().map((row) => /Keep a saved answer|Forget a saved note|Join the product video room|Pay for the order|Invoice \d+/.exec(row)?.[0] ?? row);
const input = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const status = () => document.querySelector('section[aria-label="Find tests"] [role="status"]')?.textContent ?? '';

async function type(label: string, value: string) {
  const field = input(label);
  expect(field, label).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function openFinder() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
  });
  await atlas!.until(() => document.querySelector('input[aria-label="Search and commands"]') !== null, 'the finder');
}
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]:not([data-command])')];

test('the finder and the test list make the same behaviors eligible for a misspelled query', async () => {
  const store = memoryStore();
  await publish(store);
  atlas = await openAtlas({ at: '/', specs: {}, deps: { localStore: store } });
  await atlas.until(() => titles().includes('Pay for the order'), 'the tests');
  await type('Search tests', 'savde answer');
  await atlas.until(() => titles().length === 1, 'one match');
  expect(titles()).toEqual(['Keep a saved answer']);
  // The reason it matched is on the row, and it says the spelling was close.
  expect(rows()[0]).toContain('Matches title');
  expect(rows()[0]).toContain('close spelling');

  await openFinder();
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Search and commands"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'savde answer');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await atlas.until(() => options().some((option) => option.textContent?.includes('Keep a saved answer')), 'the behavior in the finder');
  // The finder lists the identity the list lists, and not the behavior that only shares one word.
  expect(options().find((option) => option.textContent?.includes('Keep a saved answer'))?.id).toBe(`run:${key(KEEP)}`);
  expect(options().some((option) => option.id === `run:${key(FORGET)}` && !option.textContent?.includes('Partial'))).toBe(false);
});

test('has:video filters by availability; the word video matches text', async () => {
  const store = memoryStore();
  await publish(store);
  atlas = await openAtlas({ at: '/', specs: {}, deps: { localStore: store } });
  await atlas.until(() => titles().length === 4, 'the tests');
  await type('Search tests', 'has:video');
  await atlas.until(() => titles().length === 1, 'the test with a video');
  expect(titles()).toEqual(['Keep a saved answer']);
  expect(atlas.router.state.location.search).toMatchObject({ q: 'has:video' });
  // The filter is a visible chip with its own control, and the same button as the Has video toggle.
  expect(document.querySelector('button[aria-label="Remove Has video"]')).not.toBeNull();
  expect(document.querySelector('button[aria-label^="Has video"][aria-pressed="true"]')).not.toBeNull();
  await type('Search tests', 'video');
  await atlas.until(() => titles()[0] === 'Join the product video room', 'the test that says video');
  expect(titles()).toEqual(['Join the product video room']);
  // The control needs no syntax.
  await type('Search tests', '');
  await atlas.until(() => titles().length === 4, 'every test');
  await atlas.click('section[aria-label="Find tests"] button', 'Has video');
  await atlas.until(() => titles().length === 1 && titles()[0] === 'Keep a saved answer', 'only the recording');
  expect(atlas.router.state.location.search).toMatchObject({ video: true });
});

test('filters combine with documented semantics, and the counts describe the whole matching set', async () => {
  const store = memoryStore();
  await publish(store);
  atlas = await openAtlas({ at: '/', specs: {}, deps: { localStore: store } });
  await atlas.until(() => titles().length === 4, 'the tests');
  await type('Search tests', 'env:ios,desktop-web');
  await atlas.until(() => titles().length === 4, 'either environment');
  await type('Search tests', 'env:ios status:failed');
  await atlas.until(() => titles().length === 1, 'failed on ios');
  expect(titles()).toEqual(['Forget a saved note']);
  expect(status()).toContain('1 of 4 tests');
  // Status counts describe what the other filters leave: the failed button counts the ios failures.
  expect(document.querySelector('[aria-label="Test status"]')?.textContent).toContain('Failed 1');
  await type('Search tests', 'domain:memory saved');
  await atlas.until(() => titles().length === 2, 'both memory behaviors');
  await type('Search tests', 'domain:memory domain:rooms');
  await atlas.until(() => titles().length === 3, 'two domains are alternatives');
  // Sorting is explicit: best match is only offered with words to match.
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="Sort"] option[value="relevance"]')).toBeNull();
  await type('Search tests', 'saved');
  await atlas.until(() => document.querySelector('select[aria-label="Sort"] option[value="relevance"]') !== null, 'best match offered');
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="Sort"]')!.value).toBe('relevance');
});

test('a quoted phrase and an identifier are exact, and say so', async () => {
  const store = memoryStore();
  await publish(store);
  atlas = await openAtlas({ at: '/', specs: {}, deps: { localStore: store } });
  await atlas.until(() => titles().length === 4, 'the tests');
  await type('Search tests', '"saved answer"');
  await atlas.until(() => titles().length === 1, 'the phrase');
  expect(rows()[0]).toContain('Exact');
  expect(rows()[0]).toContain('“saved answer”');
  await type('Search tests', 'memory/forget');
  await atlas.until(() => titles()[0] === 'Forget a saved note' && titles().length === 1, 'the identifier');
  expect(document.querySelector('section[aria-label="Tests"] [data-why]')?.textContent).toContain('Exact');
});

test('the address restores query, filters and sort; unsupported operators are explained, not ignored', async () => {
  const store = memoryStore();
  await publish(store);
  atlas = await openAtlas({ at: `/?q=${encodeURIComponent('status:passed colour:red saved')}&sort=title`, specs: {}, deps: { localStore: store } });
  await atlas.until(() => titles().length === 1, 'the restored search');
  expect(input('Search tests').value).toBe('status:passed colour:red saved');
  expect(titles()).toEqual(['Keep a saved answer']);
  expect(document.querySelector<HTMLSelectElement>('select[aria-label="Sort"]')!.value).toBe('title');
  const alert = document.querySelector('section[aria-label="Find tests"] [role="status"].mantine-Alert-root, section[aria-label="Find tests"] [role="status"][class*="Alert"]');
  expect(document.body.textContent).toContain('Part of this search was not understood');
  expect(document.body.textContent).toContain('colour:red is not a filter');
  expect(alert === null || alert.textContent!.includes('has:video')).toBe(true);
  expect(document.querySelector('button[aria-label="Remove Status: passed"]')).not.toBeNull();

  // Back and forward return to each search.
  await atlas.go(`/?q=${encodeURIComponent('pay')}`);
  await atlas.until(() => titles()[0] === 'Pay for the order', 'the next search');
  expect(input('Search tests').value).toBe('pay');
  await act(async () => atlas!.router.history.back());
  await atlas.until(() => input('Search tests').value === 'status:passed colour:red saved', 'back restores the query');
  expect(titles()).toEqual(['Keep a saved answer']);
  await act(async () => atlas!.router.history.forward());
  await atlas.until(() => input('Search tests').value === 'pay', 'forward');
});

test('a quick finder that is bounded says so and opens every result', async () => {
  const store = memoryStore();
  const invoices = Array.from({ length: 45 }, (_, at) => ({ id: `billing/invoice-${at}`, title: `Invoice ${at}`, specPath: spec('billing') }));
  await publish(store, invoices);
  atlas = await openAtlas({ at: '/', specs: {}, deps: { localStore: store } });
  await atlas.until(() => titles().length > 0, 'the tests');
  await openFinder();
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Search and commands"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'invoice');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await atlas.until(() => options().length > 0, 'results');
  expect(options()).toHaveLength(40);
  const footer = () => document.querySelector('[aria-label="Find"]')?.textContent ?? '';
  expect(footer()).toContain('Showing the first 40 of 45 results, not all of them.');
  await atlas.click('[aria-label="Find"] button', 'See all 45 results');
  await atlas.until(() => atlas!.router.state.location.search.q === 'invoice', 'the results page');
  await atlas.until(() => titles().length === 45, 'every match, past the finder’s bound');
  expect(status()).toContain('45 of 49 tests');
});

/** Words as topics: the query "remember reply" has no word in common with "Keep a saved answer". */
function modelWith(topics: Record<string, number>, options: { fail?: boolean; gate?: Promise<void> } = {}): Embedder {
  return {
    async embed(texts) {
      if (options.gate) await options.gate;
      if (options.fail) throw new Error('model offline');
      return texts.map((text) => {
        const vector = new Float32Array(3);
        for (const word of text.toLowerCase().split(/[^a-z]+/)) if (word in topics) vector[topics[word]!]! += 1;
        return vector;
      });
    }
  };
}

test('a paraphrase finds the behavior when a provider is available, and says words only when it fails', async () => {
  const store = memoryStore();
  await publish(store);
  provideEmbedder(() => modelWith({ remember: 0, reply: 0, keep: 0, saved: 0, answer: 0, pay: 1, order: 1, video: 2 }));
  atlas = await openAtlas({ at: `/?q=${encodeURIComponent('remember reply')}`, specs: {}, deps: { localStore: store } });
  await atlas.until(() => titles().includes('Keep a saved answer'), 'the paraphrase');
  expect(rows()[0]).toContain('Similar meaning');
  expect(titles()).not.toContain('Pay for the order');
  await atlas.close();

  provideEmbedder(() => modelWith({}, { fail: true }));
  atlas = await openAtlas({ at: `/?q=${encodeURIComponent('saved')}`, specs: {}, deps: { localStore: store } });
  await atlas.until(() => titles().length === 2, 'the lexical results');
  await atlas.until(() => document.body.textContent!.includes('meaning-based search failed'), 'the lexical-only notice');
  expect(titles()).toContain('Keep a saved answer');
  expect(document.body.textContent).toContain('Matching words and spellings only');
});

test('without any provider the search says it is words only and keeps its results', async () => {
  const store = memoryStore();
  await publish(store);
  atlas = await openAtlas({ at: `/?q=saved`, specs: {}, deps: { localStore: store } });
  await atlas.until(() => titles().length === 2, 'the lexical results');
  expect(document.body.textContent).toContain('meaning-based search is not available here');
});

test('results that re-rank under the cursor keep the selected result selected, and Enter opens it', async () => {
  const store = memoryStore();
  await publish(store);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  // Keep a saved answer is closest to the query once the model answers; lexically Forget a saved note comes first.
  provideEmbedder(() => modelWith({ saved: 0, keep: 0, forget: 1 }, { gate }));
  atlas = await openAtlas({ at: '/', specs: {}, deps: { localStore: store } });
  await atlas.until(() => titles().length === 4, 'the tests');
  await openFinder();
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Search and commands"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'saved');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await atlas.until(() => options().length === 2, 'the lexical results');
  const order = () => options().map((option) => option.id);
  const before = order();
  expect(document.body.textContent).toContain('Refining by meaning');
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
  });
  const selected = () => document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.id;
  await atlas.until(() => selected() === before[1], 'the second result selected');
  const chosen = selected();
  await act(async () => release());
  await atlas.until(() => !document.body.textContent!.includes('Refining by meaning'), 'the model answered');
  // The model changed the order, not the selection.
  expect(order()).not.toEqual(before);
  expect(selected()).toBe(chosen);
  expect(field.getAttribute('aria-activedescendant')).toBe(chosen);
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  });
  await atlas.until(() => atlas!.router.state.location.search.test !== undefined, 'the selected result opened');
  expect(`run:${atlas.router.state.location.search.test}`).toBe(chosen!);
});

test('the runs tab searches every run, sorts explicitly, and the opened run searches its results the same way', async () => {
  const store = memoryStore();
  await publish(store);
  atlas = await openAtlas({ at: `/?tab=runs&q=${encodeURIComponent('savde note')}`, specs: {}, deps: { localStore: store } });
  await atlas.until(() => document.querySelector('section[aria-label="Runs"]') !== null, 'the runs');
  await atlas.until(() => document.querySelectorAll('section[aria-label="Runs"] tbody tr').length === 1, 'the run that failed it');
  // Run 1 recorded "Forget a saved note" as failed: the failure text puts it in the list; run 2 has no such behavior.
  await type('Search runs', 'status:failed');
  await atlas.until(() => document.querySelectorAll('section[aria-label="Runs"] tbody tr').length === 1, 'the failed run');
  expect(document.querySelector('section[aria-label="Runs"]')?.textContent).toContain('1 of 2 runs');
  await type('Search runs', 'domain:memory');
  await atlas.until(() => document.body.textContent!.includes('does not apply to runs'), 'guidance for a filter runs do not have');
  expect(document.querySelectorAll('section[aria-label="Runs"] tbody tr')).toHaveLength(2);

  // The run's results use the behaviors' own search.
  await atlas.go(`/?tab=runs&openRun=${encodeURIComponent(RUN(1))}&q=${encodeURIComponent('savde answer')}`);
  await atlas.until(() => document.querySelector('input[aria-label="Search this run"]') !== null, 'the run');
  await atlas.until(() => document.querySelectorAll('section[aria-label^="Run"] li[data-status]').length === 1, 'the matching result');
  expect(document.querySelector('section[aria-label^="Run"] li[data-status]')?.textContent).toContain('Keep a saved answer');
  expect(document.body.textContent).toContain('1 of 2 results match');
  expect(input('Search this run').value).toBe('savde answer');
});

test('a result that leaves the list under the cursor is announced, and Enter opens what is highlighted', async () => {
  const store = memoryStore();
  await publish(store);
  atlas = await openAtlas({ at: '/', specs: {}, deps: { localStore: store } });
  await atlas.until(() => titles().length === 4, 'the tests');
  await openFinder();
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Search and commands"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'saved');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await atlas.until(() => options().length === 2, 'two results');
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
  });
  const selected = () => document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.id;
  await atlas.until(() => selected() !== undefined && selected() !== options()[0]!.id, 'the second result selected');
  const renamed = selected()!.includes('memory/keep') ? KEEP : FORGET;
  // A newer result for the same behavior renames it, so it no longer matches the words typed.
  await publishChecks(store, { recordedAtMs: 300_000, sha: 'c'.repeat(40), branch: 'main', runUrl: RUN(3), producer: 'mobile', environment: 'ios', checks: [{ ...renamed, title: 'Something else entirely', status: 'passed' }] });
  atlas.time.clock.at += 2_000;
  await atlas.poll();
  await atlas.sees('Something else entirely');
  await atlas.until(() => options().length === 1, 'the renamed behavior left the list');
  expect(document.querySelector('[aria-label="Find"]')?.textContent).toContain('no longer listed');
  // What is highlighted is what is listed, and Enter opens that.
  expect(selected()).toBe(options()[0]!.id);
  expect(options()[0]!.id).not.toBe(`run:${key(renamed)}`);
  const highlighted = selected()!;
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  });
  await atlas.until(() => atlas!.router.state.location.search.test !== undefined, 'the highlighted result opened');
  expect(`run:${atlas.router.state.location.search.test}`).toBe(highlighted);
});
