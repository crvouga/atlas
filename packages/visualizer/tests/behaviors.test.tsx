import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { textFingerprint } from '@crvouga/atlas/reports/layer-merge';

import { createNode } from '../../server/tests/node-compat';
import { memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
  sessionStorage.clear();
});

const LISTS = 'Feature: Share a list\n  Scenario: Add an item\n    Given a list\n    When adding tea\n    Then the list includes tea\n\n  Scenario: Remove an item\n    Given a list with tea\n    When removing tea\n    Then the list is empty\n';
const BILLING =
  'Feature: Pay an invoice\n  Rule: Cards\n    Scenario: Pay by card\n      Given an invoice\n      When paying by card\n      Then the invoice is paid\n\n    Scenario: Refund a card payment\n      Given a paid invoice\n      When refunding\n      Then the money returns\n';
const SPECS = { 'lists/add.feature': LISTS, 'billing/pay.feature': BILLING };
const video = { id: 'tour', name: 'tour.webm', role: 'video', data: new Uint8Array([1, 2, 3]), contentType: 'video/webm' };
const spec = (path: string, title: string, text: string) => ({ path, domain: path.split('/')[1]!, kind: 'gherkin', title, fingerprint: textFingerprint(text) });
const SPEC_ROWS = [spec('specs/lists/add.feature', 'Share a list', LISTS), spec('specs/billing/pay.feature', 'Pay an invoice', BILLING)];

/** Two features: one behavior demonstrated, one passing without a recording, one failing, one never reported. */
async function open(at = '/behaviors') {
  const store = memoryStore();
  await publishChecks(store, {
    producer: 'e2e',
    environment: 'desktop-web',
    recordedAtMs: 5,
    branch: 'main',
    specs: SPEC_ROWS,
    checks: [
      { id: 'specs/lists/add.feature > Add an item', title: 'Share a list: Add an item', status: 'passed', specPath: 'specs/lists/add.feature', attachments: [video] },
      { id: 'specs/billing/pay.feature > Pay by card', title: 'Pay an invoice: Pay by card', status: 'passed', specPath: 'specs/billing/pay.feature' },
      { id: 'specs/billing/pay.feature > Refund a card payment', title: 'Pay an invoice: Refund a card payment', status: 'failed', specPath: 'specs/billing/pay.feature', detail: 'The refund was refused' }
    ]
  });
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at, deps: {}, specs: SPECS, node });
  return atlas;
}

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-behavior-row]')];
const row = (title: string) => rows().find((element) => element.textContent?.includes(title));
const type = async (label: string, value: string) => {
  const field = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

let scrolls: number[] = [];
beforeEach(() => {
  scrolls = [];
  Object.defineProperty(window, 'scrollY', { value: 640, configurable: true });
  (window as unknown as { scrollTo: (x: number, y: number) => void }).scrollTo = (_x, y) => void scrolls.push(y);
});

test('one list holds the behaviors of every feature, each in its own coverage state, and the states are counted apart', async () => {
  const view = await open();
  await view.until(() => rows().length === 4, 'the four behaviors of both features');
  expect(rows().map((element) => element.getAttribute('data-coverage')).sort()).toEqual(['demonstrated', 'failed', 'no-recording', 'unexecuted']);
  const text = view.text();
  expect(text).toContain('1 of 4 behaviors demonstrated');
  // Features are told apart by their declared domain; a feature and rule locate each behavior.
  expect(text).toContain('billing');
  expect(text).toContain('Pay an invoice › Cards');
  // Each state is a filter, with its own count.
  const pressed = (label: string) => [...document.querySelectorAll<HTMLElement>('button[aria-pressed]')].find((button) => button.textContent?.startsWith(label))!;
  expect(pressed('Failed').textContent).toContain('1');
  await act(async () => pressed('Failed').click());
  await view.until(() => rows().length === 1, 'only the failed behavior');
  expect(row('Refund a card payment')).toBeDefined();
  expect(view.router.state.location.search).toMatchObject({ coverage: 'failed' });
});

test('search narrows the project by the words of a behavior and says what it has not read', async () => {
  const view = await open();
  await view.until(() => rows().length === 4, 'the behaviors');
  await type('Search behaviors', 'refunding');
  await view.until(() => rows().length === 1, 'the match');
  expect(row('Refund a card payment')).toBeDefined();
  expect(view.router.state.location.search).toMatchObject({ q: 'refunding' });
  await type('Search behaviors', 'zzzzqq');
  await view.sees('No behavior matches this search.');
});

test('selecting a behavior opens Read, Watch and Inspect beside the list, with the scoped outcome, reliability and performance', async () => {
  const view = await open();
  await view.until(() => rows().length === 4, 'the behaviors');
  await act(async () => row('Add an item')!.click());
  await view.until(() => document.querySelector('video') !== null, 'the recording');
  expect(view.router.state.location.search.behavior).toBe('lists/add.feature#Add an item');
  expect(row('Add an item')!.getAttribute('aria-current')).not.toBeNull();
  await view.until(() => document.querySelector('[aria-label="Scoped summary"] [aria-label="Reliability"]') !== null, 'the scoped summary');
  const summary = document.querySelector('[aria-label="Scoped summary"]')!.textContent!;
  // The outcome is the shown result's own, the reliability names the executions it rests on, and an unmeasured latency is unknown.
  expect(summary).toContain('Selected result passed');
  expect(summary).toContain('1 of 1 independent execution passed');
  expect(summary).toContain('Insufficient evidence');
  expect(summary).toContain('Product latency is unknown');
  expect(summary).toContain('not production');
  expect([...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(['Read', 'Watch', 'Inspect']);
});

test('a behavior nothing reported on says every figure is unknown instead of showing none', async () => {
  const view = await open();
  await view.until(() => rows().length === 4, 'the behaviors');
  await act(async () => row('Remove an item')!.click());
  await view.until(() => document.querySelector('[role="tab"]') !== null, 'the panel');
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.textContent === 'Watch')!.click());
  await view.sees('Nothing has been recorded for this behavior, so its outcome, reliability and product latency are unknown');
});

test('the workspace puts what should happen beside the recording, and leaving it restores the search, the selection, the scroll and the focus', async () => {
  const view = await open();
  await view.until(() => rows().length === 4, 'the behaviors');
  await type('Search behaviors', 'invoice');
  await view.until(() => rows().length === 2, 'the narrowed list');
  await act(async () => row('Pay by card')!.click());
  await view.until(() => document.querySelector('[aria-label="Selected behavior"]') !== null, 'the selection');
  const expand = [...document.querySelectorAll<HTMLElement>('a')].find((link) => link.textContent === 'Read and watch')!;
  await act(async () => expand.click());
  await view.until(() => document.querySelector('h1')?.textContent === 'Pay by card', 'the workspace');
  expect(view.router.state.location.search).toMatchObject({ workspace: true, q: 'invoice' });
  // Keyboard focus is on the heading; the expectation and the recording are in the same view, in that order.
  expect(document.activeElement?.tagName).toBe('H1');
  const headings = [...document.querySelectorAll('h2')].map((heading) => heading.textContent);
  expect(headings.indexOf('What should happen')).toBeGreaterThanOrEqual(0);
  expect(headings.indexOf('What should happen')).toBeLessThan(headings.indexOf('Recording'));
  expect(view.text()).toContain('Then the invoice is paid');
  expect(view.text()).toContain('Nothing to watch');
  await view.until(() => document.querySelector('[aria-label="Scoped summary"] [aria-label="Reliability"]') !== null, 'the scoped summary');
  // Neighbours in the same search are one step away.
  expect(view.text()).toContain('1 of 2');
  expect([...document.querySelectorAll('a')].some((link) => link.textContent === 'Next behavior')).toBe(true);
  // Leaving the workspace gives the list back as it was.
  await act(async () => [...document.querySelectorAll<HTMLElement>('a')].find((link) => link.textContent === 'Back to behaviors')!.click());
  await view.until(() => rows().length === 2, 'the list');
  expect(view.router.state.location.search).toMatchObject({ q: 'invoice', behavior: expect.any(String) });
  expect(view.router.state.location.search.workspace).toBeUndefined();
  await view.until(() => scrolls.length > 0, 'the scroll position restored');
  expect(scrolls.at(-1)).toBe(640);
  expect((document.querySelector<HTMLInputElement>('input[aria-label="Search behaviors"]')!).value).toBe('invoice');
  await view.until(() => document.activeElement?.getAttribute('data-behavior-row')?.includes('Pay by card') === true, 'focus on the open behavior');
  expect(row('Pay by card')!.getAttribute('aria-current')).not.toBeNull();
});

test('the workspace plays the recording of a demonstrated behavior beside its steps and says it is illustrative', async () => {
  const view = await open();
  await view.until(() => rows().length === 4, 'the behaviors');
  const id = rows().find((element) => element.textContent?.includes('Add an item'))!.getAttribute('data-behavior-row')!;
  await view.go(`/behaviors?behavior=${encodeURIComponent(id)}&workspace=true`);
  await view.until(() => document.querySelector('video') !== null, 'the recording in the workspace');
  expect(view.text()).toContain('Illustrative recording of one run');
  expect(view.text()).toContain('Then the list includes tea');
  // The record behind the behavior is one disclosure away and is not read until opened.
  expect(document.querySelector('[aria-label="Outcome summary"]')).toBeNull();
  await view.click('button', 'Inspect: runs, environments');
  await view.until(() => document.querySelector('[aria-label="Outcome summary"]') !== null, 'the technical record');
});

test('a link to a behavior that is not in the project says so instead of waiting forever or showing another', async () => {
  const view = await open('/behaviors?behavior=nope.feature%23gone&workspace=true');
  await view.sees('That behavior is not in the project now');
  expect(view.text()).not.toContain('Pay by card');
  await act(async () => [...document.querySelectorAll<HTMLElement>('a')].find((link) => link.textContent === 'Back to behaviors')!.click());
  await view.until(() => rows().length === 4, 'the list');
});
