import { afterEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import type { ObjectStore } from '@crvouga/atlas/reports/object-store';
import { act } from 'react';

import { createNode } from '../../server/tests/node-compat';
import { setFinderOpen } from '../src/find/open';
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
});

const TROUBLE = 'specs/support/finding-a-persons-trouble.feature';
const INVOICE = 'specs/billing/pay-an-invoice.feature';
const FIND = { id: 'support/find', title: 'Find a person’s trouble', specPath: TROUBLE };
const ESCALATE = { id: 'support/escalate', title: 'Escalate a ticket', specPath: TROUBLE };
const PAY = { id: 'billing/pay', title: 'Pay an invoice', specPath: INVOICE, tags: ['smoke'] };
const REFUND = { id: 'billing/refund', title: 'Refund a payment', specPath: INVOICE, tags: ['flaky'] };
const RUN = (n: number) => `https://github.com/acme/app/actions/runs/${n}`;
const KEY = (check: { id: string; specPath: string }) => JSON.stringify([check.specPath, check.id]);

/** Two CI runs of two producers on two environments, with durations, a failure, a flip and a test marked flaky. */
async function publish(store: ObjectStore) {
  const one = { recordedAtMs: 100_000, sha: 'a'.repeat(40), branch: 'main', runUrl: RUN(1) };
  await publishChecks(store, {
    ...one,
    producer: 'gherkin-api',
    environment: 'api',
    checks: [
      { ...FIND, status: 'passed', durationMs: 100 },
      { ...ESCALATE, status: 'failed', durationMs: 300, detail: 'Expected 200, got 500' },
      { ...PAY, status: 'passed', durationMs: 80 }
    ]
  });
  await publishChecks(store, {
    ...one,
    recordedAtMs: 101_000,
    producer: 'gherkin-web',
    environment: 'desktop-web',
    checks: [
      { ...FIND, status: 'passed', durationMs: 2_000 },
      { ...ESCALATE, status: 'passed', durationMs: 2_500 },
      { ...REFUND, status: 'passed', durationMs: 1_500 }
    ]
  });
  await publishChecks(store, {
    recordedAtMs: 200_000,
    sha: 'b'.repeat(40),
    branch: 'main',
    runUrl: RUN(2),
    producer: 'gherkin-api',
    environment: 'api',
    checks: [
      { ...FIND, status: 'failed', durationMs: 140, detail: 'Timed out waiting for the inbox' },
      { ...ESCALATE, status: 'passed', durationMs: 320 }
    ]
  });
}

const rows = () => [...document.querySelectorAll<HTMLElement>('section[aria-label="Tests"] li a')].map((row) => row.textContent ?? '');
const shows = (title: string) => rows().some((row) => row.includes(title));

async function type(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function choose(label: string, value: string) {
  const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  expect(select).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      (window as unknown as { HTMLSelectElement: typeof HTMLSelectElement }).HTMLSelectElement.prototype,
      'value'
    )?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('the project home is a test explorer: insights, groups by spec, search, status and environment filters', async () => {
  const localStore = memoryStore();
  await publish(localStore);
  atlas = await openAtlas({ at: '/', specs: {}, deps: { localStore } });
  await atlas.until(() => shows('Refund a payment'), 'the tests');

  // The insight strip: every test, by outcome, flaky, timing, environments and runs.
  const insights = () => document.querySelector('[aria-label="Insights"]')?.textContent ?? '';
  expect(insights()).toContain('Tests4');
  expect(insights()).toContain('1 failed');
  expect(insights()).toContain('3 passed');
  expect(document.querySelector('[aria-label="1 flaky tests"]')).not.toBeNull();
  expect(insights()).toContain('Api3 tests · 1 failed · 2 passed');
  expect(insights()).toContain('Desktop web3 tests · 0 failed · 3 passed');
  expect(document.querySelector('[aria-label="2 runs"]')).not.toBeNull();
  expect(insights()).toMatch(/average · p95/);

  // Grouped by domain and spec; a row says where it ran, how it went there, and how long it takes.
  const group = (name: string) => document.querySelector<HTMLElement>(`section[aria-label="Tests"] section[aria-label="${name}"]`);
  expect(group('Finding a persons trouble')?.textContent).toContain('Escalate a ticket');
  expect(group('Pay an invoice')?.textContent).toContain('Refund a payment');
  expect(group('Finding a persons trouble')?.textContent).toContain('1 failed');
  expect([...document.querySelectorAll('section[aria-label="Tests"] h3')].map((heading) => heading.textContent)).toEqual([
    'billing',
    'support'
  ]);
  const find = atlas.find('section[aria-label="Tests"] li a', 'Find a person’s trouble')!;
  expect(find.textContent).toContain('Api');
  expect(find.textContent).toContain('Desktop web');
  expect(find.querySelector('[title^="Api"]')?.getAttribute('data-status')).toBe('failed');
  expect(find.querySelector('[title^="Desktop web"]')?.getAttribute('data-status')).toBe('passed');
  expect(find.textContent).toContain('Timed out waiting for the inbox');
  expect(atlas.find('section[aria-label="Tests"] li a', 'Refund a payment')?.textContent).toContain('Flaky');

  // Search filters as you type, across titles, specs, domains, tags and environments.
  await type('Search tests', 'refund');
  await atlas.until(() => rows().length === 1 && shows('Refund a payment'), 'one test for "refund"');
  expect(atlas.router.state.location.search).toMatchObject({ q: 'refund' });
  await type('Search tests', 'smoke');
  await atlas.until(() => rows().length === 1 && shows('Pay an invoice'), 'the test tagged smoke');
  await type('Search tests', 'billing');
  await atlas.until(() => rows().length === 2, 'the billing domain');
  await type('Search tests', '');
  await atlas.until(() => rows().length === 4, 'every test');

  // Status: failed only, then flaky, then all again.
  await atlas.click('[aria-label="Test status"] button', 'Failed');
  await atlas.until(() => rows().length === 1 && shows('Find a person’s trouble'), 'the failing test');
  await atlas.click('[aria-label="Test status"] button', 'Flaky');
  await atlas.until(() => rows().length === 1 && shows('Refund a payment'), 'the flaky test');
  await atlas.click('[aria-label="Test status"] button', 'All');
  await atlas.until(() => rows().length === 4, 'every test');

  // Environment chips (and the strip's environments) filter by where a test ran.
  await atlas.click('[aria-label="Environments"] button', 'Api');
  await atlas.until(() => rows().length === 3 && !shows('Refund a payment'), 'the API tests');
  expect(atlas.router.state.location.search).toMatchObject({ env: 'api' });
  expect(atlas.find('[aria-label="Test status"] button', 'Failed')?.textContent).toContain('1');
  await atlas.click('[aria-label="Environments"] button', 'Api');
  await atlas.until(() => rows().length === 4, 'every test');

  // Group by environment: a test on two environments is in both groups.
  await choose('Group by', 'environment');
  await atlas.until(() => group('Api') !== null && group('Desktop web') !== null, 'environment groups');
  expect(group('Desktop web')?.textContent).toContain('Find a person’s trouble');
  expect(group('Api')?.textContent).toContain('Find a person’s trouble');
  expect(group('Api')?.textContent).not.toContain('Refund a payment');

  // Sort by the slowest first.
  await choose('Group by', 'none');
  await choose('Sort', 'slowest');
  await atlas.until(() => atlas!.router.state.location.search.sort === 'slowest', 'sorted rows');
  expect(rows().map((row) => /Refund|Escalate|Find|Pay/.exec(row)?.[0])).toEqual(['Refund', 'Escalate', 'Find', 'Pay']);
});

test('a link opens one test with its results per environment, statistics, trend and history', async () => {
  const localStore = memoryStore();
  await publish(localStore);
  atlas = await openAtlas({ at: `/?test=${encodeURIComponent(KEY(FIND))}`, specs: {}, deps: { localStore } });
  const detail = () => document.querySelector<HTMLElement>('aside[aria-label="Test detail"]');
  await atlas.until(
    () => (detail()?.querySelectorAll('[aria-label="History"] tbody tr').length ?? 0) === 3,
    'the open test and its history'
  );
  const text = detail()!.textContent!;
  expect(detail()!.querySelector('h2')?.textContent).toBe('Find a person’s trouble');
  expect(text).toContain('Finding a persons trouble');
  expect(text).toContain(TROUBLE);
  // Current result per environment.
  const current = [...detail()!.querySelectorAll('[aria-label="Current results"] tbody tr')].map((row) => row.textContent ?? '');
  expect(current).toHaveLength(2);
  expect(current.find((row) => row.includes('Api'))).toContain('Failed');
  expect(current.find((row) => row.includes('Desktop web'))).toContain('Passed');
  expect(detail()!.querySelector('[aria-label="Current results"] a[href="https://github.com/acme/app/actions/runs/2"]')).not.toBeNull();
  // Statistics: three results, two passed; durations measured.
  const stats = detail()!.querySelector('[aria-label="Statistics"]')!.textContent!;
  expect(stats).toContain('Pass rate67%');
  expect(stats).toContain('Runs2');
  expect(stats).toContain('Flips1');
  expect(detail()!.querySelector('[aria-label^="Outcomes, oldest first"]')?.getAttribute('aria-label')).toBe(
    'Outcomes, oldest first: Passed, Passed, Failed'
  );
  expect(detail()!.querySelector('svg[aria-label^="Durations from"]')).not.toBeNull();
  // The history, newest first.
  const history = [...detail()!.querySelectorAll('[aria-label="History"] tbody tr')].map((row) => row.textContent ?? '');
  expect(history).toHaveLength(3);
  expect(history[0]).toContain('Failed');
  expect(history[0]).toContain('Timed out waiting for the inbox');
  // The row in the list is the open one; closing it clears the address.
  expect(atlas.find('section[aria-label="Tests"] li a[aria-current="true"]', 'Find a person’s trouble')).toBeDefined();
  await atlas.click('a[aria-label="Close the test"]', 'Close');
  await atlas.until(() => detail() === null, 'the closed detail');
  expect(atlas.router.state.location.search).not.toHaveProperty('test');
});

test('the runs view lists CI runs, opens one, and shows its tests in the explorer', async () => {
  const localStore = memoryStore();
  await publish(localStore);
  atlas = await openAtlas({ at: '/', specs: {}, deps: { localStore } });
  await atlas.until(() => shows('Refund a payment'), 'the tests');
  await atlas.click('[role="tablist"] button', 'Runs');
  await atlas.until(() => document.querySelectorAll('section[aria-label="Runs"] tbody tr').length === 2, 'two runs');
  const table = document.querySelector('section[aria-label="Runs"] table')!.textContent!;
  expect(table).toContain('Api, Desktop web');
  expect(table).toContain('1 failed');
  await atlas.click('section[aria-label="Runs"] a', 'Open run #2');
  await atlas.sees('Run #2');
  const results = () => [...document.querySelectorAll('section[aria-label="Run #2"] li')].map((row) => row.textContent ?? '');
  expect(results()).toHaveLength(2);
  expect(results()[0]).toContain('Find a person’s trouble');
  expect(results()[0]).toContain('Timed out waiting for the inbox');
  await atlas.click('a', 'Show these tests in the explorer');
  await atlas.until(() => rows().length === 2, 'the tests of run #2');
  expect(atlas.router.state.location.search).toMatchObject({ inRun: RUN(2) });
  expect(document.querySelector('[aria-label="Find tests"]')?.textContent).toContain('Run: #2');
  await atlas.click('button', 'Remove Run: #2');
  await atlas.until(() => rows().length === 4, 'every test again');
});

test('the left index lists domains and specs from the recorded tests and filters the explorer', async () => {
  const localStore = memoryStore();
  await publish(localStore);
  atlas = await openAtlas({ at: '/', specs: {}, deps: { localStore } });
  await atlas.until(() => !!atlas!.find('nav[aria-label="Project specs"] a', 'Pay an invoice'), 'the spec index');
  expect(atlas.find('nav[aria-label="Project specs"] a', 'support')?.textContent).toContain('1 failed');
  const disclosure = () => document.querySelector<HTMLButtonElement>('button[aria-label$=" support"]')!;
  expect(disclosure().getAttribute('aria-expanded')).toBe('true');
  expect(disclosure().querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  await act(async () => disclosure().click());
  expect(disclosure().getAttribute('aria-label')).toBe('Expand support');
  expect(atlas.find('nav[aria-label="Project specs"] a', 'Find a person’s trouble')).toBeUndefined();
  await act(async () => disclosure().click());
  expect(disclosure().getAttribute('aria-expanded')).toBe('true');

  await atlas.click('nav[aria-label="Project specs"] a', 'Pay an invoice');
  await atlas.until(() => rows().length === 2, 'the tests of one spec');
  expect(atlas.router.state.location.search).toMatchObject({ spec: INVOICE });
  await atlas.click('nav[aria-label="Project specs"] a', 'support');
  await atlas.until(() => rows().length === 2 && shows('Escalate a ticket'), 'the tests of one domain');
  // The header names what this project is made of.
  expect(document.querySelector('header button[aria-label="Spec type"]')?.textContent).toContain('Tests');
});

test('the finder opens a recorded test in the explorer', async () => {
  const localStore = memoryStore();
  await publish(localStore);
  atlas = await openAtlas({ at: '/', specs: {}, deps: { localStore } });
  await atlas.until(() => shows('Refund a payment'), 'the tests');
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
  });
  await atlas.until(() => document.querySelector('input[aria-label="Find a flow"]') !== null, 'the finder');
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Find a flow"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'refund a payment');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await atlas.until(
    () => document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.includes('Refund a payment') ?? false,
    'the test in the finder'
  );
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  });
  await atlas.until(() => atlas!.router.state.location.search.test === KEY(REFUND), 'the test in the address');
  await atlas.until(
    () => document.querySelector('aside[aria-label="Test detail"] h2')?.textContent === 'Refund a payment',
    'the open test'
  );
});

test('on a node the explorer asks the server for the catalog and still works without those routes', async () => {
  const store = memoryStore();
  await publish(store);
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at: `/?test=${encodeURIComponent(KEY(ESCALATE))}`, specs: {}, deps: {}, node });
  await atlas.until(() => shows('Refund a payment'), 'the tests');
  expect(atlas.requests.some((request) => request.startsWith('/tests?limit=20000'))).toBe(true);
  // The whole report came in one request; no layer was read on its own.
  expect(atlas.requests.some((request) => request.startsWith('/evidence/rows/'))).toBe(false);
  await atlas.until(
    () => (document.querySelector('aside[aria-label="Test detail"]')?.textContent ?? '').includes('Current result per environment'),
    'the open test'
  );
  await atlas.click('[aria-label="Test status"] button', 'Failed');
  await atlas.until(() => rows().length === 1, 'the failing test');
  node.close();
});

test('every supported spec has a bundled SVG mark and retains a named navigation link', async () => {
  atlas = await openAtlas({
    at: '/',
    specs: {
      'sample.feature': 'Feature: Sample',
      'sample.qnt': 'module sample {}',
      'sample.dmn': '<definitions />',
      'sample.als': 'module sample',
      'sample.openslo.yaml': 'apiVersion: openslo/v1\nkind: SLO'
    }
  });
  await atlas.until(() => !!atlas!.find('nav[aria-label="Project specs"] a', 'OpenSLO'), 'the spec navigation');
  for (const label of ['Gherkin', 'Quint', 'DMN', 'Alloy', 'OpenSLO']) {
    const link = atlas.find('nav[aria-label="Project specs"] a', label)!;
    const logo = link.querySelector<HTMLImageElement>('img[data-spec-logo]')!;
    expect(logo).not.toBeNull();
    expect(logo.getAttribute('src')).toEndWith('.svg');
    expect(logo.getAttribute('alt')).toBe('');
    expect(logo.getAttribute('aria-hidden')).toBe('true');
    expect(link.textContent).toBe(label);
  }
  await atlas.click('nav[aria-label="Project specs"] a', 'Quint');
  await atlas.until(() => atlas!.router.state.location.pathname === '/specs/quint', 'the Quint route');
  expect(document.querySelector('button[aria-label="Spec type"] img[data-spec-logo="quint"]')).not.toBeNull();
});
