// @vitest-environment happy-dom
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, useParams, useSearch } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadFixture } from '../data/testing/load-fixture';
import { JourneyNavigator } from './JourneyNavigator';

const { view } = loadFixture('full');
const journey = view.journeys.find((j) => j.name === 'Orders a drink and pays by card')!;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function mount(step?: number, chartId = 'Coffee order') {
  const route = createRootRoute();
  const chart = createRoute({
    getParentRoute: () => route,
    path: '/chart/$chartId',
    validateSearch: (search: Record<string, unknown>) => ({
      journey: String(search.journey),
      step: search.step === undefined ? undefined : Number(search.step)
    }),
    component: () => {
      const selection = useSearch({ strict: false });
      const params = useParams({ strict: false });
      return <JourneyNavigator view={view} chartId={params.chartId!} journey={journey} selection={selection} />;
    }
  });
  const router = createRouter({
    routeTree: route.addChildren([chart]),
    history: createMemoryHistory({
      initialEntries: [`/chart/${encodeURIComponent(chartId)}?journey=${journey.id}${step === undefined ? '' : `&step=${step}`}`]
    })
  });
  await act(async () => {
    await router.load();
    root.render(<RouterProvider router={router} />);
  });
  return router;
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label);
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
  });
}

describe('journey player', () => {
  it('moves from overview through steps and restores overview with Previous', async () => {
    const router = await mount();
    expect(container.querySelector('button[aria-label="Previous journey step"]')?.hasAttribute('disabled')).toBe(true);
    await click('Next journey step');
    expect(router.state.location.search.step).toBe(0);
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Picks a drink');
    await click('Next journey step');
    expect(router.state.location.search.step).toBe(1);
    await click('Previous journey step');
    await click('Previous journey step');
    expect(router.state.location.search.step).toBeUndefined();
  });

  it('supports random access and event inspection without losing the journey or step', async () => {
    const router = await mount();
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Picks card'))!;
    await act(async () => button.click());
    expect(router.state.location.search.step).toBe(5);
    const inspect = container.querySelector<HTMLAnchorElement>('a[class*="inspectStep"]')!;
    expect(inspect.getAttribute('href')).toContain('step=5');
    expect(inspect.getAttribute('href')).toContain(`journey=${journey.id}`);
    expect(inspect.getAttribute('href')).toContain('event=');
  });

  it('plays sequentially, pauses, and stops automatically on the final step', async () => {
    const router = await mount(journey.steps.length - 2);
    vi.useFakeTimers();
    await click('Play journey');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2200);
    });
    expect(router.state.location.search.step).toBe(journey.steps.length - 1);
    expect(container.querySelector('button[aria-label="Play journey"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Next journey step"]')?.hasAttribute('disabled')).toBe(true);
    await click('Play journey');
    expect(router.state.location.search.step).toBe(0);
    await click('Pause journey');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(router.state.location.search.step).toBe(0);
  });

  it('keeps playing when a hand-off returns from a child chart to its composed root', async () => {
    const handOff = journey.steps.findIndex((step) => step.handOff);
    const router = await mount(handOff - 1, 'Checkout');
    vi.useFakeTimers();
    await click('Play journey');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2200);
    });
    expect(router.state.location.pathname).toBe('/chart/Coffee order');
    expect(router.state.location.search.step).toBe(handOff);
    expect(container.querySelector('button[aria-label="Pause journey"]')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2200);
    });
    expect(router.state.location.search.step).toBe(handOff + 1);
  });

  it('preserves ordinary keyboard input while supporting arrow navigation on the canvas', async () => {
    const router = await mount();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(router.state.location.search.step).toBe(0);
    const select = container.querySelector('select')!;
    await act(async () => select.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(router.state.location.search.step).toBe(0);
  });
});
