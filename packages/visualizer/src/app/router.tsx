import { createHashHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { z } from 'zod/v4';

import { ChartPage } from '../views/ChartPage';
import { ProductPage } from '../views/ProductPage';
import { AppShell } from './AppShell';

const RootSearch = z.object({ run: z.string().min(1).optional().catch(undefined) });

const ChartSearch = RootSearch.extend({
  screen: z.string().min(1).optional().catch(undefined),
  event: z.string().min(1).optional().catch(undefined),
  journey: z.string().min(1).optional().catch(undefined),
  t: z.coerce.number().nonnegative().optional().catch(undefined)
});

export type ChartSearch = z.infer<typeof ChartSearch>;

const rootRoute = createRootRoute({
  validateSearch: (search) => RootSearch.parse(search),
  component: AppShell
});

const productRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ProductPage
});

export const chartRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chart/$chartId',
  validateSearch: (search) => ChartSearch.parse(search),
  component: ChartPage
});

const routeTree = rootRoute.addChildren([productRoute, chartRoute]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: false,
  scrollRestoration: true
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
