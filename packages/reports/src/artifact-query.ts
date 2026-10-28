/**
 * @module Run and artifact queries
 *
 * One shareable query for the runs of a project and for the recorded results that carry evidence (recordings,
 * screenshots, traces): by artifact tag, label, media type, feature (domain, spec), environment or device, producer,
 * branch, revision, outcome and time. The same rules answer `GET /api/reports/runs`, `GET /api/reports/artifacts`
 * and the viewer's Runs and Artifacts views, so a link means the same thing everywhere.
 *
 * The semantics are fixed, not inferred:
 *
 * - Across dimensions the filters combine with AND: `artifactTag=demo&type=video&environment=ios` is a demo
 *   recording on ios.
 * - Within a dimension the values combine with OR: `environment=ios,android` is either.
 * - When both `artifactTag` and `type` are asked for, one artifact must be both (a `demo`-tagged video, not a demo-tagged
 *   screenshot beside an untagged video) wherever the report says which videos carry which tags; otherwise a result with
 *   an artifact of that type and an artifact with that tag matches.
 * - Facet counts are disjunctive: the count beside a value is how many records the list would hold if that value were
 *   the only choice in its dimension, with every other dimension's filter applied. With a value already chosen, the
 *   other values show what choosing them in addition would add, and the chosen one's count is the list's.
 * - A filter never changes a status. Evidence that is not recorded is unknown, never a match.
 *
 * Lists in the address are comma-separated; a comma or backslash inside a value is written `\,` or `\\`
 * ({@link splitList}, {@link joinList}), so a label such as `note=a,b` survives.
 *
 * @see docs/server.md#reading-the-report-as-an-agent
 */
import { normalizeTag } from './artifact-tags';

/** A value of a dimension and how many records have it. */
export type QueryFacetValue = { readonly value: string; readonly count: number };

/** The dimensions a query narrows by, with their address parameters. */
export const QUERY_DIMENSIONS = ['artifactTag', 'type', 'label', 'environment', 'producer', 'branch', 'sha', 'outcome', 'domain', 'spec'] as const;
/** One of {@link QUERY_DIMENSIONS}. */
export type QueryDimension = (typeof QUERY_DIMENSIONS)[number];

/** What a query asks for. Every field is optional; nothing asked is everything. See the module comment for the semantics. */
export type ArtifactFilter = {
  /** Words (all of them) found in the title, test id, spec, domain, branch, labels, tags, environment or producer; or, for a run, its title. */
  readonly q?: string;
  /** Artifact tags (`demo` and `#demo` are the same). */
  readonly artifactTag?: readonly string[];
  /** Also match the tags an artifact inherits from its check and run. Default false: the exact artifact query. */
  readonly inherited?: boolean;
  /** Media types as roles: `video`, `image`, `audio`, `snapshot`, `text`, `file`, or a producer's own role. `video` means a playable recording. */
  readonly type?: readonly string[];
  /** `key=value`, or `key` for any value. */
  readonly label?: readonly string[];
  /** Environments or devices (`ios`, `desktop-web`). */
  readonly environment?: readonly string[];
  readonly producer?: readonly string[];
  readonly branch?: readonly string[];
  /** Revisions: a full commit id, or a prefix of at least seven characters. */
  readonly sha?: readonly string[];
  /** Statuses (`passed`, `failed`, `running`, `not-run`). A run's outcome is `failed` when any result failed, else `running`, else `passed`, else `not-run`. */
  readonly outcome?: readonly string[];
  /** The feature domain of a result's spec. Not applicable to runs. */
  readonly domain?: readonly string[];
  /** Spec paths. Not applicable to runs. */
  readonly spec?: readonly string[];
  /** Only records at or after this time (epoch ms): a result's recording time, a run's end. */
  readonly since?: number;
  /** Only records at or before this time (epoch ms). */
  readonly until?: number;
  /** Only records with a playable video recording (the same as `type: ['video']`). */
  readonly video?: boolean;
};

/** The filters a query used, as they are named in the address and in `filters` of a response. */
export type FilterName = QueryDimension | 'q' | 'inherited' | 'since' | 'until' | 'video';

/** The values of a record a query looks at: made by {@link fieldsOfRun} or by the artifact search. */
export type FilterFields = {
  /** Lower-cased text a search matches. */
  readonly text: string;
  /** The normalized tags of its artifacts. */
  readonly artifactTags: readonly string[];
  /** The tags its artifacts inherit from checks and runs, and its own. */
  readonly tags: readonly string[];
  /** Distinct media types; `video` only when a recording can be played. */
  readonly types: readonly string[];
  /** Artifacts by type and their own tags. Where the report does not say which artifact carries which tag, every artifact of the record is given the record's artifact tags. */
  readonly media: readonly { readonly type: string; readonly tags: readonly string[] }[];
  /** `key=value`, sorted and distinct. */
  readonly labels: readonly string[];
  readonly environments: readonly string[];
  readonly producers: readonly string[];
  readonly branches: readonly string[];
  readonly shas: readonly string[];
  readonly outcomes: readonly string[];
  /** Absent when the dimension does not apply (runs have no domain). */
  readonly domains?: readonly string[];
  readonly specs?: readonly string[];
  readonly at: number;
};

/** The facets of a query: for each dimension, its values with disjunctive counts (see the module comment). */
export type QueryFacets = {
  readonly artifactTags: readonly QueryFacetValue[];
  readonly types: readonly QueryFacetValue[];
  /** Values are `key=value`. */
  readonly labels: readonly QueryFacetValue[];
  readonly environments: readonly QueryFacetValue[];
  readonly producers: readonly QueryFacetValue[];
  readonly branches: readonly QueryFacetValue[];
  readonly outcomes: readonly QueryFacetValue[];
  readonly domains?: readonly QueryFacetValue[];
};

/**
 * Splits a comma-separated list from an address: `a,b` is two values; `\,` is a comma and `\\` a backslash inside a
 * value. Values are trimmed and empty ones dropped.
 *
 * @example
 * ```ts
 * splitList('demo,release\\,2'); // ['demo', 'release,2']
 * ```
 */
export function splitList(raw: string): string[] {
  const out: string[] = [];
  let current = '';
  for (let at = 0; at < raw.length; at += 1) {
    const char = raw[at]!;
    const next = raw[at + 1];
    if (char === '\\' && (next === ',' || next === '\\')) { current += next; at += 1; }
    else if (char === ',') { out.push(current); current = ''; }
    else current += char;
  }
  out.push(current);
  return out.map(value => value.trim()).filter(Boolean);
}

/** Joins values into one address parameter that {@link splitList} reads back; `undefined` when there are none. */
export function joinList(list: readonly string[]): string | undefined {
  return list.length ? list.map(value => value.replace(/\\/g, '\\\\').replace(/,/g, '\\,')).join(',') : undefined;
}

/** A time from an address: epoch milliseconds, or a date or date-time Date can read (a date alone is UTC). `undefined` when unreadable. */
export function parseTime(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const value = /^\d+$/.test(raw.trim()) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Reads a query from URL search parameters: `q`, `video`, `inherited`, `since`, `until` and the repeatable or
 * comma-separated {@link QUERY_DIMENSIONS}. Unreadable values are left out, never an error.
 */
export function parseArtifactFilter(params: URLSearchParams): ArtifactFilter {
  const many = (name: string) => params.getAll(name).flatMap(splitList);
  const filter: Record<string, unknown> = {};
  const q = params.get('q')?.trim();
  if (q) filter.q = q;
  for (const name of QUERY_DIMENSIONS) { const values = many(name); if (values.length) filter[name] = values; }
  const truthy = (name: string) => ['1', 'true'].includes(params.get(name) ?? '');
  if (truthy('inherited')) filter.inherited = true;
  if (truthy('video')) filter.video = true;
  const since = parseTime(params.get('since'));
  if (since !== undefined) filter.since = since;
  const until = parseTime(params.get('until'));
  if (until !== undefined) filter.until = until;
  return filter as ArtifactFilter;
}

/** A query as URL search parameters, the form {@link parseArtifactFilter} reads back. */
export function filterParams(filter: ArtifactFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  for (const name of QUERY_DIMENSIONS) { const joined = joinList(filter[name] ?? []); if (joined) params.set(name, joined); }
  if (filter.inherited) params.set('inherited', '1');
  if (filter.since !== undefined) params.set('since', String(filter.since));
  if (filter.until !== undefined) params.set('until', String(filter.until));
  if (filter.video) params.set('video', 'true');
  return params;
}

/** Which filters a query uses, by the names an address gives them. */
export function usedFilters(filter: ArtifactFilter): FilterName[] {
  const used: FilterName[] = [];
  if (filter.q) used.push('q');
  for (const name of QUERY_DIMENSIONS) if (filter[name]?.length) used.push(name);
  if (filter.inherited) used.push('inherited');
  if (filter.since !== undefined) used.push('since');
  if (filter.until !== undefined) used.push('until');
  if (filter.video) used.push('video');
  return used;
}

/** Whether a query narrows anything. */
export function isFiltered(filter: ArtifactFilter): boolean {
  return usedFilters(filter).some(name => name !== 'inherited');
}

/** Every filter in `filter` that may be applied to a record with these fields, as the runs query applies them (no domain or spec). */
export function forRuns(filter: ArtifactFilter): ArtifactFilter {
  const { domain: _domain, spec: _spec, ...rest } = filter;
  return rest;
}

function hasTag(tags: readonly string[], wanted: readonly string[]): boolean {
  return wanted.some(tag => { const normal = normalizeTag(tag); return normal !== null && tags.includes(normal); });
}

function labelMatches(labels: readonly string[], wanted: string): boolean {
  return wanted.includes('=') ? labels.includes(wanted) : labels.some(label => label.startsWith(`${wanted}=`));
}

/**
 * Whether a record satisfies a query. `skip` leaves one dimension out: what {@link facetsOf} uses to count the values of
 * that dimension, and nothing else should need.
 */
export function matchesFilter(fields: FilterFields, filter: ArtifactFilter, skip?: QueryDimension): boolean {
  if (filter.q) {
    for (const term of filter.q.toLowerCase().split(/\s+/).filter(Boolean)) if (!fields.text.includes(term)) return false;
  }
  const tags = skip === 'artifactTag' ? [] : filter.artifactTag ?? [];
  const types = skip === 'type' ? [] : [...(filter.type ?? []), ...(filter.video ? ['video'] : [])];
  if (tags.length && types.length) {
    if (!fields.media.some(item => types.includes(item.type) && (hasTag(item.tags, tags) || (filter.inherited === true && hasTag(fields.tags, tags))))) return false;
  } else {
    if (tags.length && !hasTag(fields.artifactTags, tags) && !(filter.inherited === true && hasTag(fields.tags, tags))) return false;
    if (types.length && !types.some(type => fields.types.includes(type))) return false;
  }
  if (skip !== 'label' && filter.label?.length && !filter.label.some(wanted => labelMatches(fields.labels, wanted))) return false;
  if (skip !== 'environment' && filter.environment?.length && !filter.environment.some(value => fields.environments.includes(value))) return false;
  if (skip !== 'producer' && filter.producer?.length && !filter.producer.some(value => fields.producers.includes(value))) return false;
  if (skip !== 'branch' && filter.branch?.length && !filter.branch.some(value => fields.branches.includes(value))) return false;
  if (skip !== 'sha' && filter.sha?.length && !filter.sha.some(value => value.length >= 7 && fields.shas.some(sha => sha.startsWith(value.toLowerCase())))) return false;
  if (skip !== 'outcome' && filter.outcome?.length && !filter.outcome.some(value => fields.outcomes.includes(value))) return false;
  if (skip !== 'domain' && filter.domain?.length && fields.domains && !filter.domain.some(value => fields.domains!.includes(value))) return false;
  if (skip !== 'spec' && filter.spec?.length && fields.specs && !filter.spec.some(value => fields.specs!.includes(value))) return false;
  if (filter.since !== undefined && fields.at < filter.since) return false;
  if (filter.until !== undefined && fields.at > filter.until) return false;
  return true;
}

/** Distinct values counted, most first and then alphabetically. */
function tally(values: Iterable<readonly string[]>): QueryFacetValue[] {
  const counts = new Map<string, number>();
  for (const list of values) for (const value of new Set(list)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

/**
 * The facets of a query over every record: for each dimension, the values the records have and how many records
 * would match if that value were chosen in its dimension (see the module comment). A value chosen in the query is
 * listed even when nothing has it, with a count of 0, so it can be removed.
 */
export function facetsOf(records: readonly FilterFields[], filter: ArtifactFilter): QueryFacets {
  const scope = (skip: QueryDimension) => records.filter(record => matchesFilter(record, filter, skip));
  const withChosen = (found: QueryFacetValue[], chosen: readonly string[] | undefined) => [
    ...found, ...(chosen ?? []).filter(value => !found.some(entry => entry.value === value)).map(value => ({ value, count: 0 }))
  ];
  const dimension = (skip: QueryDimension, pick: (fields: FilterFields) => readonly string[], chosen?: readonly string[]) => withChosen(tally(scope(skip).map(pick)), chosen);
  const normalTags = (filter.artifactTag ?? []).map(tag => normalizeTag(tag)).filter((tag): tag is string => tag !== null);
  const domains = records.some(record => record.domains);
  return {
    artifactTags: dimension('artifactTag', fields => fields.artifactTags, normalTags),
    types: dimension('type', fields => fields.types, filter.type),
    labels: dimension('label', fields => fields.labels, (filter.label ?? []).filter(value => value.includes('='))),
    environments: dimension('environment', fields => fields.environments, filter.environment),
    producers: dimension('producer', fields => fields.producers, filter.producer),
    branches: dimension('branch', fields => fields.branches, filter.branch),
    outcomes: dimension('outcome', fields => fields.outcomes, filter.outcome),
    ...(domains ? { domains: dimension('domain', fields => fields.domains ?? [], filter.domain) } : {})
  };
}

/** The outcome of a run from its results by status: `failed`, else `running`, else `passed`, else `not-run`. */
export function outcomeOfCounts(counts: Readonly<Record<string, number>>): string {
  return (counts.failed ?? 0) > 0 ? 'failed' : (counts.running ?? 0) > 0 ? 'running' : (counts.passed ?? 0) > 0 ? 'passed' : 'not-run';
}

/** The `key=value` labels of a record, sorted and distinct. */
export function labelList(labels: Readonly<Record<string, string>> | undefined): string[] {
  return Object.entries(labels ?? {}).map(([key, value]) => `${key}=${value}`).sort();
}
