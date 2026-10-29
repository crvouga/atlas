import { afterEach, expect, test } from 'bun:test';
import { layerKey } from '@crvouga/atlas/reports/layer-store';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { act } from 'react';

import { createAtlasServer, type AtlasServer } from '../../server/src/app';
import { memoryStore, openAtlas, type Atlas } from './atlas';

class FinderResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FinderResizeObserver as unknown as typeof ResizeObserver;

let atlas: Atlas | null = null;
let server: AtlasServer | null = null;
afterEach(async () => {
  await atlas?.close();
  server?.close();
  atlas = null;
  server = null;
});

const bytes = (...values: number[]) => new Uint8Array(values);
const SPEC = 'specs/checkout/pay.feature';
const specs = [{ path: SPEC, domain: 'checkout', kind: 'feature', title: 'Pay' }];
const run = (n: number) => `https://github.com/acme/app/actions/runs/${n}`;

/** Two executions of the same behavior: a failed one (retried), then a later passing replay from another run. */
async function seed() {
  const store = memoryStore();
  const failed = await publishChecks(store, {
    specs, producer: 'web', environment: 'desktop-web', branch: 'main', sha: 'a'.repeat(40), runUrl: run(1), recordedAtMs: 1_000,
    checks: [{ id: 'pay', title: 'Pay with a card', specPath: SPEC, status: 'failed', attempts: [{ index: 0, status: 'failed' }, { index: 1, status: 'failed' }], attachments: [{ id: 'take', name: 'take-one.webm', contentType: 'video/webm', data: bytes(1, 1) }] }]
  });
  const replay = await publishChecks(store, {
    specs, producer: 'web', environment: 'desktop-web', branch: 'main', sha: 'b'.repeat(40), runUrl: run(2), recordedAtMs: 2_000,
    checks: [{ id: 'pay', title: 'Pay with a card', specPath: SPEC, status: 'passed', attachments: [{ id: 'take', name: 'take-two.webm', contentType: 'video/webm', data: bytes(2, 2) }] }]
  });
  return { store, failed, replay };
}

let clock = 10_000;
async function open(options: { tokens?: boolean } = {}) {
  const seeded = await seed();
  server = createAtlasServer({
    backends: [{ id: 'shared', store: seeded.store }], write: 'shared', refreshMs: 60_000, now: () => clock,
    ...(options.tokens ? { tokens: [{ name: 'eyes', role: 'read' as const, token: 'read-token-1234567' }], anonymousRead: true } : {})
  });
  await server.ready;
  atlas = await openAtlas({ at: '/?tab=artifacts', specs: {}, deps: {}, node: server });
  await atlas.until(() => document.querySelectorAll('section[aria-label="Artifacts"] tbody tr').length === 2, 'the two results');
  return { view: atlas, ...seeded };
}

const type = (label: string, value: string, within: ParentNode = document.body) =>
  act(async () => {
    const named = [...within.querySelectorAll<HTMLLabelElement>('label')].find((item) => item.textContent?.startsWith(label));
    const field = (named ? document.getElementById(named.htmlFor) : null) as HTMLInputElement | HTMLTextAreaElement;
    expect(field, label).toBeDefined();
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
const entry = (n: number) => document.querySelector<HTMLElement>(`section[data-entry="e${n}"]`)!;
const text = () => document.body.textContent ?? '';

/** Filters nothing: freezes the two results as the Artifacts tab lists them (newest first). */
async function freeze(view: Atlas, title = 'Checkout takes') {
  await view.click('button', 'Freeze as review collection');
  await view.sees('2 results from 2 runs, in the order listed');
  await type('Title', title);
  await type('Purpose', 'Show the declined card and the replay');
  await type('Tags', 'demo');
  await view.click('button', /Freeze 2 results/);
  await view.until(() => document.querySelector('section[aria-label="Review collection"]') !== null, 'the collection page');
}

test('freezing the filtered Artifacts view publishes a collection that says it is not one execution, keeps the failed take and the later pass in order, and has no status of its own', async () => {
  const { view } = await open();
  await freeze(view);
  expect(text()).toContain('Frozen, revision 1 of 1');
  expect(text()).toContain('This is a review collection, not a test run');
  expect(text()).toContain('recorded in 2 runs and are not one execution');
  expect(text()).toContain('Show the declined card and the replay');
  // Newest first, as the tab listed them: the passing replay, then the failed take with both of its tries.
  expect(entry(1).getAttribute('data-status')).toBe('passed');
  expect(entry(2).getAttribute('data-status')).toBe('failed');
  expect(entry(1).textContent).toContain('Passed as recorded');
  expect(entry(2).textContent).toContain('Failed as recorded');
  expect(entry(2).textContent).toContain('Tries, in order: Failed, then Failed');
  expect(entry(1).textContent).toContain('run #2');
  expect(entry(2).textContent).toContain('run #1');
  expect(document.querySelectorAll('section[aria-label="Review collection"] > [data-status]')).toHaveLength(0);
  // The list names it, with who and when.
  await view.click('a', 'All review collections');
  await view.until(() => document.querySelector('table[data-collections]') !== null, 'the list');
  expect(document.querySelector('table[data-collections]')!.textContent).toContain('Checkout takes');
  expect(document.querySelector('table[data-collections]')!.textContent).toContain('#demo');
});

test('a reviewer marks an entry reviewed and adds a time-coded gap note: both show who and when, and the recorded status stays as it was', async () => {
  const { view } = await open();
  await freeze(view);
  const before = entry(2).querySelector('[data-tries]')!.textContent;
  await act(async () => entry(2).querySelector<HTMLInputElement>('input[role="switch"]')!.click());
  await view.until(() => entry(2).textContent!.includes('Marked reviewed by open'), 'the reviewed mark');
  expect(entry(2).textContent).toContain('not an outcome or an approval');
  expect(entry(2).getAttribute('data-status')).toBe('failed');

  const form = entry(2).querySelector('form')!;
  await type('Note', 'The decline message never appears', form);
  await type('Time in the recording', '1:15', form);
  await act(async () => [...form.querySelectorAll<HTMLInputElement>('input[role="switch"]')].find((item) => item.closest('div')?.textContent?.includes('This is a gap'))!.click());
  await act(async () => form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  await view.until(() => entry(2).querySelector('[data-note="gap"]') !== null, 'the gap note');
  const note = entry(2).querySelector('[data-note="gap"]')!.textContent!;
  expect(note).toContain('1:15');
  expect(note).toContain('The decline message never appears');
  expect(note).toContain('open');
  expect(entry(2).querySelector('[data-tries]')!.textContent).toBe(before);
  expect(entry(2).getAttribute('data-status')).toBe('failed');

  // A bad time is said, not guessed at.
  await type('Time in the recording', 'soon', form);
  expect(text()).toContain('Use m:ss, like 1:15, or seconds.');
});

test('when a source disappears the entry stays in its place with the reason and what it was when frozen', async () => {
  const { view, store, failed } = await open();
  await freeze(view);
  expect(entry(2).getAttribute('data-availability')).toBe('available');
  // The layer that recorded the failed take is deleted (collected). The server keeps the "is it held" answer for a moment.
  await store.delete(layerKey(failed.id));
  clock += 120_000;
  await view.go('/?tab=collections');
  await view.until(() => document.querySelector('table[data-collections] a') !== null, 'the list');
  await view.click('a', 'Checkout takes');
  await view.until(() => entry(2)?.getAttribute('data-availability') === 'unavailable', 'the unavailable source');
  expect(entry(2).textContent).toContain('Source unavailable');
  expect(entry(2).textContent).toContain('no longer in any backend');
  expect(entry(2).textContent).toContain('Pay with a card');
  expect(entry(2).textContent).toContain('Failed as recorded');
  expect(entry(2).textContent).toContain('Recording not available');
  expect(entry(1).getAttribute('data-availability')).toBe('available');
});

test('a read-only visitor can look but is refused when freezing, with the server\'s reason shown', async () => {
  const { view } = await open({ tokens: true });
  await view.click('button', 'Freeze as review collection');
  await view.sees('Freeze as review collection');
  await type('Title', 'Not allowed');
  await view.click('button', /Freeze 2 results/);
  await view.until(() => document.querySelector('[role="alert"]') !== null, 'the refusal');
  expect(document.querySelector('[role="alert"]')!.textContent).toMatch(/publish|token/i);
});
