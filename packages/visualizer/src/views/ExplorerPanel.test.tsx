// @vitest-environment happy-dom
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, useSearch } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSpec } from '../data/parse/spec';
import { buildAtlasView } from '../data/model/build';
import { ExplorerPanel } from './ExplorerPanel';
import { RuleCards } from './RuleCards';

const contract = { id: 'payment', name: 'A refused payment can be retried', source: 'specs/payment.feature:8', steps: [
  { keyword: 'Given', text: 'a person paying', table: [['person', 'state'], ['A', 'paying']] },
  { keyword: 'When', text: 'payment is refused', docString: 'The payment method can be corrected.' },
  { keyword: 'Then', text: 'the person can retry' }
] };
const doc = parseSpec({ ref: null, files: [{ path: 'product.machine.json', text: JSON.stringify({
  id: 'Product', initial: 'Home', meta: { contracts: [contract], eventKinds: { 'Opens payment': 'user', 'Payment is refused': 'system', 'Deadline passes': 'time' } }, states: {
    Home: { meta: { description: 'Choose a payment.' }, on: { 'Opens payment': '#Card' } },
    Card: { meta: { description: 'Supply the payment method.' }, on: { 'Payment is refused': '#Error', 'Deadline passes': '#Expired' } },
    Error: { meta: { description: 'Correct the method and retry.' }, on: { Retry: '#Card' } },
    Expired: { on: { Restart: '#Home' } },
    Missing: {}
  }
}) }] });
const view = buildAtlasView({ spec: doc, specIssues: [], runs: [], run: null, runIssues: [], resolveMedia: () => '' });
const simulation = view.simulation('Product');
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

async function mount(choices: string[] = [], cursor = choices.length) {
  const route = createRootRoute();
  const chart = createRoute({ getParentRoute: () => route, path: '/chart/$chartId', validateSearch: (search) => ({
    explore: Boolean(search.explore), choices: Array.isArray(search.choices) ? search.choices as string[] : [], cursor: Number(search.cursor ?? 0)
  }), component: () => {
    const search = useSearch({ strict: false });
    const choices = search.choices ?? [];
    const cursor = search.cursor ?? choices.length;
    return <ExplorerPanel view={view} chartId="Product" simulation={simulation} result={simulation.replay(choices.slice(0, cursor))} choices={choices} cursor={cursor} />;
  } });
  const router = createRouter({ routeTree: route.addChildren([chart]), history: createMemoryHistory({ initialEntries: [`/chart/Product?explore=true&choices=${encodeURIComponent(JSON.stringify(choices))}&cursor=${cursor}`] }) });
  await act(async () => { await router.load(); root.render(<RouterProvider router={router} />); });
  return router;
}

async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label || b.querySelector('strong')?.textContent === label);
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.click());
}

async function search(text: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('free explorer controls and replay links', () => {
  it('takes real enabled model choices and supports undo, redo and reset through the URL', async () => {
    const router = await mount();
    expect(container.querySelector('[aria-label="Current model states"]')?.textContent).toContain('Home');
    await click('Opens payment');
    expect(container.querySelector('[aria-label="Available model events"]')?.textContent).toContain('Outside outcome');
    expect(container.querySelector('[aria-label="Available model events"]')?.textContent).toContain('Time passes');
    await click('Payment is refused');
    expect(router.state.location.search.choices).toEqual(['Opens payment', 'Payment is refused']);
    expect(container.querySelector('[aria-label="Current model states"]')?.textContent).toContain('Error');
    expect(container.querySelector('[aria-label="Last model outcome"]')?.textContent).toContain('LeftCard');
    await click('Undo');
    expect(router.state.location.search.cursor).toBe(1);
    expect(container.querySelector('[aria-label="Current model states"]')?.textContent).toContain('Card');
    await click('Redo');
    expect(router.state.location.search.cursor).toBe(2);
    await click('Reset');
    expect(router.state.location.search.choices).toEqual([]);
    expect(container.querySelector('[aria-label="Current model states"]')?.textContent).toContain('Home');
  });

  it('branches after undo by discarding the old future, and reloads an exact shared history', async () => {
    const router = await mount(['Opens payment', 'Payment is refused'], 1);
    expect(container.querySelector('[aria-label="Current model states"]')?.textContent).toContain('Card');
    await click('Deadline passes');
    expect(router.state.location.search.choices).toEqual(['Opens payment', 'Deadline passes']);
    expect(container.querySelector('[aria-label="Current model states"]')?.textContent).toContain('Expired');
    await act(async () => router.history.back());
    expect(container.querySelector('[aria-label="Current model states"]')?.textContent).toContain('Card');
  });

  it('makes stale or tampered replay events an explicit error, then reset recovers', async () => {
    const router = await mount(['Payment is refused']);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('unavailable');
    expect(container.querySelector('[aria-label="Available model events"]')?.textContent).not.toContain('Opens payment');
    await click('Reset');
    expect(router.state.location.search.choices).toEqual([]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('finds and follows a shortest route without teleporting, and explains unreachable states', async () => {
    const router = await mount();
    await search('Error');
    await click('Error');
    expect(container.querySelector('[aria-label="Route search result"]')?.textContent).toContain('2 choices from here');
    expect(router.state.location.search.choices).toEqual([]);
    await click('Follow this route');
    expect(router.state.location.search.choices).toEqual(['Opens payment', 'Payment is refused']);
    await search('Missing');
    await click('Missing');
    expect(container.querySelector('[aria-label="Route search result"]')?.textContent).toContain('No route exists');
  });

  it('renders the exact rule steps, table and doc string as an expandable capability catalog', async () => {
    await act(async () => root.render(<RuleCards contracts={[contract]} owner="Payments" />));
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    details.open = true;
    expect(details.textContent).toContain('Given a person paying');
    expect(details.textContent).toContain('When payment is refused');
    expect(details.textContent).toContain('Then the person can retry');
    expect(details.querySelector('table')?.textContent).toContain('Apaying');
    expect(details.querySelector('pre')?.textContent).toBe('The payment method can be corrected.');
    expect(details.textContent).toContain('specs/payment.feature:8');
    expect(container.textContent).toContain('does not execute their checks');
  });
});
