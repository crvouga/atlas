import { Alert, Anchor, Button, Container, Stack, Text, Title } from '@mantine/core';
import {
  Link,
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouterHistory
} from '@tanstack/react-router';
import { z } from 'zod/v4';
import { SpecPage } from '../evidence/spec-page';
import { ExplorerSearchFields } from '../explorer/search';
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
/** The project home: the test explorer's filters, grouping, order, open test and open run (see `explorer/search.ts`). */
const HomeSearch = RootSearch.extend(ExplorerSearchFields);
/** A spec document, the check opened in it, one layer's record of that check, and a recorded moment. */
const SpecSearch = RootSearch.extend({
  spec: z.string().min(1).optional().catch(undefined),
  check: z.string().min(1).optional().catch(undefined),
  layer: z.string().min(1).optional().catch(undefined),
  view: z.enum(['recording']).optional().catch(undefined),
  moment: z.coerce.number().int().positive().optional().catch(undefined),
  /** The release evidence is read against: its build, commit and platform, and the evidence filter (see `evidence/applicability.ts`). A build such as `90` is read from a typed link as a number: coerced back to its text. */
  release: z.coerce.string().min(1).optional().catch(undefined),
  releaseSha: z.coerce.string().min(1).optional().catch(undefined),
  releasePlatform: z.coerce.string().min(1).optional().catch(undefined),
  evidence: z.enum(['stale']).optional().catch(undefined)
});
export type SpecSearch = z.infer<typeof SpecSearch>;
/** A fresh route tree per router, so a test can run its own viewer beside the page's. */
function routeTree() {
  const rootRoute = createRootRoute({
    validateSearch: (search) => RootSearch.parse(search),
    component: AppShell,
    errorComponent: ({ error, reset }) => (
      <Container py="xl">
        <Alert color="red" title="The page couldn’t be loaded">
          <Stack>
            <Text>{error instanceof Error ? error.message : String(error)}</Text>
            <Button onClick={reset}>Try again</Button>
            <Anchor renderRoot={(props) => <Link {...props} to="/" search={{}} />}>Back to reports</Anchor>
          </Stack>
        </Alert>
      </Container>
    ),
    notFoundComponent: () => (
      <Container py="xl">
        <Stack>
          <Title order={1}>Page not found</Title>
          <Text c="dimmed">This address is not part of the report viewer.</Text>
          <Anchor renderRoot={(props) => <Link {...props} to="/" search={{}} />}>Back to reports</Anchor>
        </Stack>
      </Container>
    )
  });
  const productRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    validateSearch: (search) => HomeSearch.parse(search),
    component: ProductPage
  });
  const chartRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chart/$chartId',
    validateSearch: (search) => ChartSearch.parse(search),
    // The map (the graph, its layout and its renderer) is the largest part of the page and only this route needs it.
    component: lazyRouteComponent(() => import('../views/ChartPage'), 'ChartPage')
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
/**
 * Addresses in the hash, so a built site deep-links without server rewrites. The page's own query (`?project=geviti`)
 * selects the project and is not part of the address: TanStack's hash history appends it to the hash, which turned
 * `#/?group=domain` into a `group` of `domain?project=geviti`. This one reads the hash alone and keeps the query in links.
 */
export function createProjectHashHistory(win: Window = window): RouterHistory {
  return createBrowserHistory({
    window: win,
    parseLocation: () => {
      const hash = win.location.hash;
      const second = hash.indexOf('#', 1);
      const at = second < 0 ? hash.length : second;
      const parsed = createMemoryHistory({ initialEntries: [`${hash.slice(1, at) || '/'}${hash.slice(at)}`] }).location;
      return win.history.state ? { ...parsed, state: win.history.state } : parsed;
    },
    createHref: (href) => `${win.location.pathname}${win.location.search}#${href}`
  });
}
export const router = createAtlasRouter(createProjectHashHistory());
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
