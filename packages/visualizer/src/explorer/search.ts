/**
 * @module Explorer address
 *
 * Everything the test explorer shows is in the address of the `/` route, so a link reproduces the view: the open test,
 * the words searched, the filters, the grouping, the order, the Runs tab with the run opened in it, the exact layer a test's detail is pinned to, and the one file of a run's layer its Artifacts select. Filters that
 * take several values are comma-separated (`status=failed,flaky`); a comma or backslash inside a value is written `\,`
 * or `\\`, and the router encodes `#` and spaces. Anything unreadable is dropped, never an error.
 *
 * The Runs and Artifacts tabs share the tests' `q`, `env`, `producer`, `domain` and `spec` and add `artifactTag`,
 * `type`, `label`, `branch`, `outcome`, `since` and `until`, so a link to one tab's filters opens the same query on another.
 */
import { joinList, splitList, type ArtifactFilter } from '@crvouga/atlas/reports/artifact-query';
import type { ReliabilityScope } from '@crvouga/atlas/reports/reliability';
import { TEST_SORTS, type TestQuery } from '@crvouga/atlas/reports/test-catalog';
import { z } from 'zod/v4';

/** How the explorer groups its tests. `spec` is the default. */
export const TEST_GROUPS = ['spec', 'domain', 'environment', 'status', 'producer', 'none'] as const;
/** One of {@link TEST_GROUPS}. */
export type TestGroup = (typeof TEST_GROUPS)[number];

/** The orders the explorer offers: `relevance` (best match first, only with words to match) and those of the catalog. */
export const EXPLORER_SORTS = ['relevance', ...TEST_SORTS] as const;
/** One of {@link EXPLORER_SORTS}. */
export type ExplorerSort = (typeof EXPLORER_SORTS)[number];

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
  /** Only tests with one recording that declares every one of these scope tokens (`device:physical,audio:recorded`). */
  scope: text,
  /** Artifact tags (`demo`, shown `#demo`): tests with an attachment carrying one; runs and artifacts likewise. */
  artifactTag: text,
  /** With `artifactTag`: also the tags attachments inherit from their check and run. */
  inherited: z.preprocess((value) => (value === 'true' ? true : value), z.literal(true)).optional().catch(undefined),
  /** Media types of attachments (`video`, `image`…): runs and artifacts. */
  type: text,
  /** `key=value` labels: runs and artifacts. */
  label: text,
  /** Branches: runs and artifacts. */
  branch: text,
  /** Outcomes of a run or recorded result (`passed`, `failed`…). */
  outcome: text,
  /** Only records from this day (`YYYY-MM-DD`, the viewer's local time). */
  since: text,
  /** Only records until the end of this day (`YYYY-MM-DD`, local time). */
  until: text,
  /** Only the tests a CI run recorded (a `RunSummary.key`). Not `run`, which already names a recorded statechart run. */
  inRun: text,
  group: z.enum(TEST_GROUPS).optional().catch(undefined),
  sort: z.enum(EXPLORER_SORTS).optional().catch(undefined),
  tab: z.enum(['runs', 'artifacts']).optional().catch(undefined),
  /** The run opened in the Runs tab. */
  openRun: text,
  /** Pins the open test's detail to one exact layer (a run's record of it), instead of the latest combined evidence. With `openRun` and `artifact` it names the layer the file is in. */
  layer: text,
  /** With `openRun` and `layer`: the one file of that layer (an `artifactRef`: `id:…`, `key:…` or `name:…`) the run's Artifacts select. */
  artifact: text,
  /** The scope of the open test's reliability figure: environments, producers, branches, `key=value` parameters. */
  relEnv: text,
  relProducer: text,
  relBranch: text,
  relParam: text,
  /** The reliability window, as `since` and `until` (`YYYY-MM-DD`, local time). */
  relSince: text,
  relUntil: text,
  /** `any`: count every spec revision. Otherwise only the current one is counted. */
  relRevision: z.enum(['any']).optional().catch(undefined),
  /** The reliability's independent executions (its denominator) are open. */
  relOpen: z.preprocess((value) => (value === 'true' ? true : value), z.literal(true)).optional().catch(undefined),
  /** Only the runs, and the results of an opened run, that have a playable video recording. */
  video: z.preprocess((value) => (value === 'true' ? true : value), z.literal(true)).optional().catch(undefined)
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
  readonly scope?: string;
  readonly artifactTag?: string;
  readonly inherited?: true;
  readonly type?: string;
  readonly label?: string;
  readonly branch?: string;
  readonly outcome?: string;
  readonly since?: string;
  readonly until?: string;
  readonly inRun?: string;
  readonly group?: TestGroup;
  readonly sort?: ExplorerSort;
  readonly tab?: 'runs' | 'artifacts';
  readonly openRun?: string;
  readonly layer?: string;
  readonly artifact?: string;
  readonly relEnv?: string;
  readonly relProducer?: string;
  readonly relBranch?: string;
  readonly relParam?: string;
  readonly relSince?: string;
  readonly relUntil?: string;
  readonly relRevision?: 'any';
  readonly relOpen?: true;
  readonly video?: true;
};

/** The values of a comma-separated filter, empty when it is not set. */
export function values(value: string | undefined): string[] {
  return value ? splitList(value) : [];
}

/** A list of values as one comma-separated parameter, or undefined (left out of the address) when empty. */
export function joined(list: readonly string[]): string | undefined {
  return joinList(list);
}

/** Adds a value to a comma-separated filter, or removes it when it is there. */
export function toggled(value: string | undefined, item: string): string | undefined {
  const list = values(value);
  return joined(list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]);
}

/** The order a list is in: what the address says, else best match when words are searched, else by spec. */
export function sortOf(search: ExplorerSearch): ExplorerSort {
  return search.sort ?? (search.q ? 'relevance' : 'spec');
}

/** The catalog query an address asks for, without the run (it is matched separately) and without paging. The words in `q` are matched by the shared search, not by the catalog. */
export function queryOf(search: ExplorerSearch): TestQuery {
  return {
    ...(search.q ? { q: search.q } : {}),
    status: values(search.status),
    environment: values(search.env),
    producer: values(search.producer),
    domain: values(search.domain),
    spec: values(search.spec),
    tag: values(search.tag),
    ...(values(search.scope).length ? { scope: values(search.scope) } : {}),
    artifactTag: values(search.artifactTag),
    ...(search.inherited ? { inherited: true } : {}),
    sort: search.sort === 'relevance' || !search.sort ? 'spec' : search.sort
  };
}

/** Only the explorer's own fields of a route's search, so other routes' parameters are not carried along. */
export function explorerSearch(search: Record<string, unknown>): ExplorerSearch {
  return z.object(ExplorerSearchFields).parse(search) as ExplorerSearch;
}

/** True when any filter or search narrows the list. */
export function narrowed(search: ExplorerSearch): boolean {
  return !!(search.q || search.status || search.env || search.producer || search.domain || search.spec || search.tag || search.scope || search.artifactTag || search.inRun || search.video);
}

/** The reliability scope an address asks for, in the shape `reliability` reads: days are the viewer's local days. */
export function reliabilityScopeOf(search: ExplorerSearch): ReliabilityScope {
  const list = (value: string | undefined) => (values(value).length ? values(value) : undefined);
  const parts = {
    environment: list(search.relEnv),
    producer: list(search.relProducer),
    branch: list(search.relBranch),
    parameter: list(search.relParam),
    ...(search.relRevision ? { revision: search.relRevision } : {}),
    since: dayMs(search.relSince, false),
    until: dayMs(search.relUntil, true)
  };
  return Object.fromEntries(Object.entries(parts).filter(([, value]) => value !== undefined)) as ReliabilityScope;
}

/** The filters of the Runs and Artifacts tabs, in the address. */
export const FILTER_FIELDS = ['q', 'artifactTag', 'inherited', 'type', 'label', 'env', 'producer', 'branch', 'outcome', 'domain', 'spec', 'since', 'until', 'video'] as const;

/** A patch that removes every filter of the Runs and Artifacts tabs. */
export const NO_FILTERS = Object.fromEntries(FILTER_FIELDS.map((field) => [field, undefined])) as { [K in (typeof FILTER_FIELDS)[number]]?: undefined };

/** True when an address narrows the Runs and Artifacts tabs. */
export function filtered(search: ExplorerSearch): boolean {
  return FILTER_FIELDS.some((field) => field !== 'inherited' && search[field] !== undefined);
}

/** Midnight at the start (or the last millisecond) of a `YYYY-MM-DD` day in the viewer's local time, or undefined. */
function dayMs(day: string | undefined, end: boolean): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  if (!match) return undefined;
  const [year, month, date] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const value = new Date(year, month, date + (end ? 1 : 0)).getTime() - (end ? 1 : 0);
  return Number.isFinite(value) ? value : undefined;
}

/** The query the Runs and Artifacts tabs ask for: the address's filters in the shape the report API and `matchesFilter` read. */
export function filterOf(search: ExplorerSearch): ArtifactFilter {
  const list = (value: string | undefined) => (values(value).length ? values(value) : undefined);
  const since = dayMs(search.since, false);
  const until = dayMs(search.until, true);
  const parts = {
    q: search.q,
    artifactTag: list(search.artifactTag),
    inherited: search.inherited,
    type: list(search.type),
    label: list(search.label),
    environment: list(search.env),
    producer: list(search.producer),
    branch: list(search.branch),
    outcome: list(search.outcome),
    domain: list(search.domain),
    spec: list(search.spec),
    since,
    until,
    video: search.video
  };
  return Object.fromEntries(Object.entries(parts).filter(([, value]) => value !== undefined)) as ArtifactFilter;
}
