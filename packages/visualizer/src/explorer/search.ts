/**
 * @module Explorer address
 *
 * Everything the test explorer shows is in the address of the `/` route, so a link reproduces the view: the open test,
 * the words searched, the filters, the grouping, the order, and the Runs tab with the run opened in it. Filters that
 * take several values are comma-separated (`status=failed,flaky`). Anything unreadable is dropped, never an error.
 */
import { TEST_SORTS, type TestQuery, type TestSort } from '@crvouga/atlas/reports/test-catalog';
import { z } from 'zod/v4';

/** How the explorer groups its tests. `spec` is the default. */
export const TEST_GROUPS = ['spec', 'domain', 'environment', 'status', 'producer', 'none'] as const;
/** One of {@link TEST_GROUPS}. */
export type TestGroup = (typeof TEST_GROUPS)[number];

/** A search value as text: the router reads `123` as a number and `["a"]` as an array, both of which are meant as text here. */
const text = z
  .preprocess((value) => (typeof value === 'number' || typeof value === 'boolean' ? String(value) : value !== null && typeof value === 'object' ? JSON.stringify(value) : value), z.string().min(1))
  .optional()
  .catch(undefined);

/** The explorer's part of the `/` route's search: see the module comment. */
export const ExplorerSearchFields = {
  /** The open test, a `TestSummary.key`. */
  test: text,
  q: text,
  status: text,
  env: text,
  producer: text,
  domain: text,
  spec: text,
  tag: text,
  /** Only the tests a CI run recorded (a `RunSummary.key`). Not `run`, which already names a recorded statechart run. */
  inRun: text,
  group: z.enum(TEST_GROUPS).optional().catch(undefined),
  sort: z.enum(TEST_SORTS).optional().catch(undefined),
  tab: z.enum(['runs']).optional().catch(undefined),
  /** The run opened in the Runs tab. */
  openRun: text
};

/** The explorer's search parameters as the route holds them. */
export type ExplorerSearch = {
  readonly test?: string;
  readonly q?: string;
  readonly status?: string;
  readonly env?: string;
  readonly producer?: string;
  readonly domain?: string;
  readonly spec?: string;
  readonly tag?: string;
  readonly inRun?: string;
  readonly group?: TestGroup;
  readonly sort?: TestSort;
  readonly tab?: 'runs';
  readonly openRun?: string;
};

/** The values of a comma-separated filter, empty when it is not set. */
export function values(value: string | undefined): string[] {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

/** A list of values as one comma-separated parameter, or undefined (left out of the address) when empty. */
export function joined(list: readonly string[]): string | undefined {
  return list.length ? list.join(',') : undefined;
}

/** Adds a value to a comma-separated filter, or removes it when it is there. */
export function toggled(value: string | undefined, item: string): string | undefined {
  const list = values(value);
  return joined(list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]);
}

/** The catalog query an address asks for, without the run (it is matched separately) and without paging. */
export function queryOf(search: ExplorerSearch): TestQuery {
  return {
    ...(search.q ? { q: search.q } : {}),
    status: values(search.status),
    environment: values(search.env),
    producer: values(search.producer),
    domain: values(search.domain),
    spec: values(search.spec),
    tag: values(search.tag),
    sort: search.sort ?? 'spec'
  };
}

/** Only the explorer's own fields of a route's search, so other routes' parameters are not carried along. */
export function explorerSearch(search: Record<string, unknown>): ExplorerSearch {
  return z.object(ExplorerSearchFields).parse(search) as ExplorerSearch;
}

/** True when any filter or search narrows the list. */
export function narrowed(search: ExplorerSearch): boolean {
  return !!(search.q || search.status || search.env || search.producer || search.domain || search.spec || search.tag || search.inRun);
}
