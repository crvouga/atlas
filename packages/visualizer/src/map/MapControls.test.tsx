// @vitest-environment happy-dom
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, useSearch } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { loadFixture } from '../data/testing/load-fixture';
import type { ChartLayout } from '../layout/layout';
import { useUiStore } from '../state/ui-store';
import { MapControls } from './MapControls';

const flow = vi.hoisted(() => ({ viewportInitialized: true, setViewport: vi.fn(), getViewport: () => ({ x: 0, y: 0, zoom: 1 }) }));
const camera = { moveTo: flow.setViewport, cancel: vi.fn(), isMoving: () => false };
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  useReactFlow: () => flow,
  useViewport: () => ({ zoom: 1 })
}));

const { view } = loadFixture('full');
const journey = view.journeys.find((j) => j.name === 'Orders a drink and pays by card')!;
const index = journey.steps.findIndex((step) => step.handOff);
const layout: ChartLayout = {
  key: 'offscreen-layout',
  width: 50000,
  height: 50000,
  pinned: false,
  nodes: [
    { id: 'Order in progress', kind: 'parallel', parent: null, width: 50000, height: 50000, x: 0, y: 0, absX: 0, absY: 0 },
    { id: 'Paid, waiting for the barista', kind: 'screen', parent: 'Order in progress', width: 156, height: 372, x: 9000, y: 9000, absX: 9000, absY: 9000 },
    { id: 'Updates on', kind: 'screen', parent: 'Order in progress', width: 156, height: 372, x: 9300, y: 9000, absX: 9300, absY: 9000 }
  ],
  edges: []
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  flow.setViewport.mockClear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  useUiStore.setState({ viewports: {}, details: {}, compact: false, pathOnly: false });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mount(exploration = false) {
  const rootRoute = createRootRoute();
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chart/$chartId',
    validateSearch: (search: Record<string, unknown>) => ({ journey: String(search.journey), step: Number(search.step) }),
    component: () => (
      <MapControls
        view={view}
        chartId="Coffee order"
        layout={layout}
        selection={{ ...useSearch({ strict: false }), ...(exploration ? { journey: undefined, step: undefined, active: ['Paid, waiting for the barista', 'Updates on'] } : {}) }}
        busy={false}
        hadSavedViewport={false}
        camera={camera}
      />
    )
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [`/chart/Coffee%20order?journey=${journey.id}&step=${index}`] })
  });
  await act(async () => {
    await router.load();
    root.render(<RouterProvider router={router} />);
  });
  return router;
}

it('focuses offscreen parallel destinations from known layout bounds without waiting for node DOM measurements', async () => {
  await mount();
  expect(flow.setViewport).toHaveBeenCalled();
  const [viewport] = flow.setViewport.mock.calls.at(-1)!;
  expect(viewport.zoom).toBeGreaterThan(0.4);
  for (const node of layout.nodes.slice(1)) {
    const x = (node.absX + node.width / 2) * viewport.zoom + viewport.x;
    const y = (node.absY + node.height / 2) * viewport.zoom + viewport.y;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(1200);
    expect(y).toBeGreaterThan(40);
    expect(y).toBeLessThan(700);
  }
});

it('does not hijack a manually panned viewport when run data refreshes', async () => {
  const router = await mount();
  flow.setViewport.mockClear();
  await act(async () => router.invalidate());
  expect(flow.setViewport).not.toHaveBeenCalled();
});

it('focuses all active parallel model states during free exploration', async () => {
  await mount(true);
  const [viewport] = flow.setViewport.mock.calls.at(-1)!;
  expect(viewport.zoom).toBeGreaterThan(0.4);
  for (const node of layout.nodes.slice(1)) {
    const x = (node.absX + node.width / 2) * viewport.zoom + viewport.x;
    const y = (node.absY + node.height / 2) * viewport.zoom + viewport.y;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(1200);
    expect(y).toBeGreaterThan(40);
    expect(y).toBeLessThan(700);
  }
  expect(container.querySelector('a')?.getAttribute('href')).toContain('explore=true');
});
