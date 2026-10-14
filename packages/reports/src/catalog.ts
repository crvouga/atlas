/**
 * @module Catalog search, filter, group and sort
 *
 * The pure view logic behind the viewer's list of reports (and of the tests inside one): given entities and a
 * query (text, status, grouping, sort), it returns the groups to draw. It owns no data and does no I/O; the
 * caller maps its own records to {@link CatalogEntity}. Input is never mutated.
 */

/** A status filter: one of the four result statuses as the list names them (`skipped` is a check that was `not-run`), or `all`. */
export type CatalogStatus = 'all' | 'passed' | 'failed' | 'skipped' | 'running';

/** What the list is grouped by; `none` gives one group named `All`. */
export type CatalogGroup = 'none' | 'file' | 'status' | 'package' | 'runtime';

/** How entities are ordered inside a group: `recent` keeps the input order, `name` is by title, `duration` is longest first, `status` is failed first then by title. */
export type CatalogSort = 'recent' | 'name' | 'duration' | 'status';

/** How the list is drawn. */
export type CatalogLayout = 'list' | 'grid';

/** The user's current choices, mirrored in the URL (see {@link catalogParams}). */
export type CatalogQuery = {
  /** Free text; matched case-insensitively as a substring of each entity's `search` text. Blank matches everything. */
  readonly q: string;
  readonly status: CatalogStatus;
  readonly group: CatalogGroup;
  readonly sort: CatalogSort;
  readonly layout: CatalogLayout;
};

/** One row of the list: a report or a test, flattened to what the list needs. */
export type CatalogEntity = {
  /** Stable identifier of the row. */
  readonly id: string;
  readonly title: string;
  /** A status string; only `passed`, `failed`, `skipped` and `running` are counted and ranked, any other sorts after them. */
  readonly status: string;
  /** Duration in milliseconds, or null when unknown (sorted last by `duration`, counted as 0 in a group's total). */
  readonly durationMs: number | null;
  /** Group label for `file` (a source file, or a branch). */
  readonly file: string;
  /** Group label for `package`; empty groups under `Other`. */
  readonly packageName: string;
  /** Group label for `runtime`; empty groups under `Other`. */
  readonly runtime: string;
  /** One muted line under the title: a failure, or a date. */
  readonly detail: string;
  /** Everything the text query may match (title, ids, paths, ...), built by the caller. */
  readonly search: string;
  /** Where selecting the row navigates, or null when it is not a link. */
  readonly href: string | null;
};

/** One drawn group of the list. */
export type CatalogGroupView = {
  readonly name: string;
  /** Sum of the members' durations in milliseconds; unknown durations count as 0. */
  readonly durationMs: number;
  /** How many members have status `failed`. */
  readonly failed: number;
  readonly entities: readonly CatalogEntity[];
};

const STATUS_RANK: Readonly<Record<string, number>> = {
  failed: 0,
  running: 1,
  skipped: 2,
  passed: 3,
};

/** Counts entities per status filter (`all` is the total); a status the list does not know is counted only in `all`. */
export function catalogCounts(
  entities: readonly CatalogEntity[]
): Record<CatalogStatus, number> {
  const counts: Record<CatalogStatus, number> = {
    all: entities.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    running: 0,
  };
  for (const entity of entities) {
    if (
      entity.status === 'passed' ||
      entity.status === 'failed' ||
      entity.status === 'skipped' ||
      entity.status === 'running'
    ) {
      counts[entity.status] += 1;
    }
  }
  return counts;
}

function matches(entity: CatalogEntity, query: CatalogQuery): boolean {
  if (query.status !== 'all' && entity.status !== query.status) return false;
  const q = query.q.trim().toLowerCase();
  return q.length === 0 || entity.search.toLowerCase().includes(q);
}

function compare(
  a: CatalogEntity,
  b: CatalogEntity,
  sort: CatalogSort
): number {
  if (sort === 'duration') return (b.durationMs ?? -1) - (a.durationMs ?? -1);
  if (sort === 'status') {
    const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (rank !== 0) return rank;
  }
  if (a.title < b.title) return -1;
  if (a.title > b.title) return 1;
  return 0;
}

function groupKey(entity: CatalogEntity, group: CatalogGroup): string {
  if (group === 'file') return entity.file || 'Other';
  if (group === 'status') return entity.status;
  if (group === 'package') return entity.packageName || 'Other';
  if (group === 'runtime') return entity.runtime || 'Other';
  return 'All';
}

function groupRank(name: string, group: CatalogGroup): number {
  if (group === 'status') return STATUS_RANK[name] ?? 9;
  return 0;
}

function compareGroups(
  a: CatalogGroupView,
  b: CatalogGroupView,
  group: CatalogGroup
): number {
  const rank = groupRank(a.name, group) - groupRank(b.name, group);
  if (rank !== 0) return rank;
  if (a.name === 'Other') return 1;
  if (b.name === 'Other') return -1;
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

const LIST_KEYS = [
  'q',
  'status',
  'group',
  'sort',
  'layout',
  'spec',
  'tab',
  'partq',
] as const;

/** Keeps only the list's own URL search params (`q`, `status`, `group`, `sort`, `layout`, `spec`, `tab`, `partq`) and drops empty ones, so a test route's frame and zoom params do not leak into a link back to the list. */
export function catalogParams(
  params: Readonly<Record<string, string>>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of LIST_KEYS) {
    const value = params[key];
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Filters entities by the query's status and text, sorts them, then splits them into one group per value of the
 * chosen key. `recent` keeps input order.
 *
 * Group order: for `status`, failed, running, skipped, passed; otherwise alphabetical by name with `Other` (the
 * label for an empty file, package or runtime) last. With `none` there is a single group named `All`. When
 * nothing matches, no group is returned.
 */
export function arrangeCatalog(
  entities: readonly CatalogEntity[],
  query: CatalogQuery
): readonly CatalogGroupView[] {
  const shown = entities.filter((entity) => matches(entity, query));
  const sorted =
    query.sort === 'recent'
      ? shown
      : [...shown].sort((a, b) => compare(a, b, query.sort));
  const order: string[] = [];
  const map = new Map<string, CatalogEntity[]>();
  for (const entity of sorted) {
    const key = groupKey(entity, query.group);
    const list = map.get(key);
    if (list === undefined) {
      map.set(key, [entity]);
      order.push(key);
    } else {
      list.push(entity);
    }
  }
  const groups = order.map((name) => {
    const list = map.get(name) ?? [];
    return {
      name,
      durationMs: list.reduce(
        (sum, entity) => sum + (entity.durationMs ?? 0),
        0
      ),
      failed: list.filter((entity) => entity.status === 'failed').length,
      entities: list,
    };
  });
  if (query.group === 'none') return groups;
  return [...groups].sort((a, b) => compareGroups(a, b, query.group));
}
