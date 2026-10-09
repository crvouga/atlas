import { createHashHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { z } from 'zod/v4';

import { ChartPage } from '../views/ChartPage';
import { JourneysPage, ScreensPage } from '../views/CatalogPage';
import { ProductPage } from '../views/ProductPage';
import { ReportsPage } from '../views/ReportsPage';
import { SourcesPage } from '../views/SourcesPage';
import { ITEM_STATUSES } from '../data/model';
import { AppShell } from './AppShell';

const RootSearch = z.object({
  run: z.string().min(1).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  context: z.string().optional().catch(undefined),
  status: z.enum(ITEM_STATUSES).optional().catch(undefined),
  source: z.string().optional().catch(undefined),
  phase: z.enum(['running', 'complete']).optional().catch(undefined)
});

const ChartSearch = RootSearch.extend({
  screen: z.string().min(1).optional().catch(undefined),
  event: z.string().min(1).optional().catch(undefined),
  journey: z.string().min(1).optional().catch(undefined),
  step: z.coerce.number().int().nonnegative().optional().catch(undefined),
  t: z.coerce.number().nonnegative().optional().catch(undefined),
  explore: z.boolean().optional().catch(undefined),
  choices: z.array(z.string().min(1)).max(1000).optional().catch(undefined),
  cursor: z.coerce.number().int().nonnegative().optional().catch(undefined)
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

const screensRoute = createRoute({ getParentRoute: () => rootRoute, path: '/screens', component: ScreensPage });
const journeysRoute = createRoute({ getParentRoute: () => rootRoute, path: '/journeys', component: JourneysPage });
const reportsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/runs', component: ReportsPage });
const sourcesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sources', component: SourcesPage });
const routeTree = rootRoute.addChildren([productRoute, chartRoute, screensRoute, journeysRoute, reportsRoute, sourcesRoute]);

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
