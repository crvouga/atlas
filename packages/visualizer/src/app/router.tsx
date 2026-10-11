import { createHashHistory, createRootRoute, createRoute, createRouter, type RouterHistory } from '@tanstack/react-router';
import { z } from 'zod/v4';

import { SpecPage } from '../evidence/spec-page';
import { ChartPage } from '../views/ChartPage';
import { ProductPage } from '../views/ProductPage';
import { AppShell } from './AppShell';

const RootSearch = z.object({ run: z.string().min(1).optional().catch(undefined) });

const ChartSearch = RootSearch.extend({
  screen: z.string().min(1).optional().catch(undefined),
  event: z.string().min(1).optional().catch(undefined),
  journey: z.string().min(1).optional().catch(undefined),
  group: z.string().min(1).optional().catch(undefined),
  t: z.coerce.number().nonnegative().optional().catch(undefined)
});

export type ChartSearch = z.infer<typeof ChartSearch>;

/** A spec document, the check opened in it, one layer's record of that check, and a recorded moment. */
const SpecSearch = RootSearch.extend({
  spec: z.string().min(1).optional().catch(undefined),
  check: z.string().min(1).optional().catch(undefined),
  layer: z.string().min(1).optional().catch(undefined),
  view: z.enum(['recording']).optional().catch(undefined),
  moment: z.coerce.number().int().positive().optional().catch(undefined)
});

export type SpecSearch = z.infer<typeof SpecSearch>;

/** A fresh route tree per router, so a test can run its own viewer beside the page's. */
function routeTree() {
  const rootRoute = createRootRoute({
    validateSearch: (search) => RootSearch.parse(search),
    component: AppShell
  });
  const productRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: ProductPage
  });
  const chartRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chart/$chartId',
    validateSearch: (search) => ChartSearch.parse(search),
    component: ChartPage
  });
  const specRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/specs/$kind',
    validateSearch: (search) => SpecSearch.parse(search),
    component: SpecPage
  });
  return rootRoute.addChildren([productRoute, chartRoute, specRoute]);
}

export function createAtlasRouter(history: RouterHistory) {
  return createRouter({ routeTree: routeTree(), history, defaultPreload: false, scrollRestoration: true });
}

/** Addresses use the hash, so a built site deep-links without server rewrites. */
export const router = createAtlasRouter(createHashHistory());

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
