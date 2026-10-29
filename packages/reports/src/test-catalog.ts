/**
 * @module Test catalog, history and runs
 *
 * What a person or an agent asks of a report once it holds more than a handful of checks: every test with where it ran,
 * how it went over time and how long it takes; the specs, domains, environments and producers they fall under; the CI
 * runs that produced them and which tests each one ran.
 *
 * - `TestHistory` keeps every recorded result of every test (bounded per test) and every run's results, folded in one
 *   layer at a time, in any order, with the same outcome. It never decides a status: the current status of a test is
 *   always the report's winner (`combineEvidence`), and history only describes how it got there.
 * - `testCatalog` turns the report's winners (plus a history, when there is one) into a `TestCatalog`: a summary with
 *   insights (slowest, flaky, failing), facets to filter by, and the tests that match a `TestQuery`.
 * - `testHistory`, `runList` and `runDetail` answer for one test, every run, and one run. `runList` and `artifactList`
 *   narrow by tag, label, media type, environment, branch, outcome and time (see `artifact-query.ts`); `artifactList` finds
 *   the recorded results that carry evidence across the whole history, not only the latest winners.
 * - `catalogMarkdown`, `historyMarkdown`, `runsMarkdown` and `runMarkdown` say the same in Markdown, for an agent or a
 *   terminal.
 *
 * A test is a check identity (its spec path and id) regardless of producer, environment and parameters; each of those
 * combinations is one of its results. A result that is not `passed` is never counted as a pass, and a test with no
 * completed result has no pass rate.
 *
 * @see docs/server.md#reading-the-report-as-an-agent
 */
import { displayTag, normalizeTag, normalizeTags } from './artifact-tags';
import { facetsOf, forArtifacts, forRuns, labelList, matchesFilter, outcomeOfCounts, splitList, usedFilters, type ArtifactFilter, type FilterFields, type FilterName, type QueryFacets } from './artifact-query';
import type { EvidenceMeasurement, EvidenceStatus, SpecEntry } from './explorer-types';
import type { EvidenceSummary, LayerEvidence, LayerHeader, LayerRow, RecordingCounts, StatusCounts, VideoCounts, VideoRef } from './evidence-types';
import { runRecordings, type RunRecordings } from './recording-receipt';
import { videoCounts } from './evidence-detail';
import { productLatency } from './latency';
import { matchesScope, scopeTokens, UNKNOWN_SCOPE } from './evidence-scope';
import { checkSlots, type CheckSlot } from './evidence-view';
import { combineEvidence, emptyCounts, slotKey, specPath as normalSpecPath, type EvidenceResult } from './layer-merge';
import { RecordedSpecs } from './recorded-specs';

/** The version of the documents this module writes (`TestCatalog`, `TestHistoryDocument`, `RunList`, `RunDetail`). Only optional fields are added within it. */
export const TEST_CATALOG_VERSION = 1;

/** Recorded results kept per test, newest first. Older ones are counted in no statistic. */
export const HISTORY_PER_TEST = 100;

const FAILURE_RANK = { passed: 0, 'not-run': 1, running: 2, failed: 3 } as const;

/** One recorded result of a test: when, where, how it went and how long it took, and the layer and run it came from. */
export type TestResultEntry = {
  /** When it was recorded, epoch ms. */
  readonly at: number;
  readonly status: EvidenceStatus;
  /** How long it took, ms, or null when the producer did not measure it. */
  readonly durationMs: number | null;
  /** The client it checked (`desktop-web`, `api`, `ios`…), or null. */
  readonly environment: string | null;
  readonly producer: string;
  /** The kind of the part that held it (`checks`, `behavior`, `performance`…). */
  readonly kind: string;
  /** Other choices that made it its own result (a device size, a locale…). */
  readonly parameters: Readonly<Record<string, string>>;
  readonly branch: string | null;
  readonly sha: string | null;
  readonly runUrl: string | null;
  /** The key of the run it belongs to (see `runKey`). */
  readonly run: string;
  /** The id of the layer that recorded it. */
  readonly layer: string;
  readonly backend: string;
  /** Why it has its status: the first 500 characters of the check's detail. */
  readonly detail: string;
  /** The fingerprint of its spec text the layer recorded, when it recorded one: results with different revisions were recorded against different promises. Absent means not recorded, never "the same". */
  readonly specRevision?: string;
  /** What it carried beyond its outcome (attachments, steps, retries, tags, labels), when anything. */
  readonly evidence?: EvidenceSummary;
  /** Its product-latency measurements (`kind: product-latency`), when it recorded any. Separate from `durationMs`, which is how long the test took (setup, waits and pacing included). */
  readonly latency?: readonly EvidenceMeasurement[];
};

/** The current result of a test in one producer, environment and parameter set: the report's winner for that slot. */
export type TestOutcome = TestResultEntry;

/** Durations of a set of results, ms. Only results that recorded one are counted. */
export type DurationStats = {
  readonly count: number;
  readonly totalMs: number;
  readonly avgMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  /** The newest recorded duration. */
  readonly lastMs: number;
};

/** How a test has gone across its recorded history (at most `HISTORY_PER_TEST` results). */
export type TestStats = {
  /** Recorded results: passed, failed and not-run (progress reported as `running` is not history). */
  readonly results: number;
  readonly passed: number;
  readonly failed: number;
  /** passed / (passed + failed), or null with no completed result. */
  readonly passRate: number | null;
  /** True when the same code both passed and failed, a retry was needed to pass, or the producer said so. */
  readonly flaky: boolean;
  /** Why it is flaky, for a person; empty when it is not. */
  readonly flakyReason: string;
  /** How many times the completed outcome changed, per result, newest history first. */
  readonly flips: number;
  readonly durations: DurationStats | null;
  readonly firstSeenMs: number | null;
  readonly lastSeenMs: number | null;
  readonly lastPassedAtMs: number | null;
  readonly lastFailedAtMs: number | null;
  /** Distinct runs it was recorded in. */
  readonly runs: number;
  /** Branches it was recorded on, most recent first, at most ten. */
  readonly branches: readonly string[];
};

/** A spec as the catalog shows it: recorded by a layer or published in a spec set, or derived from the path alone. */
export type CatalogSpec = {
  readonly path: string;
  readonly title: string;
  /** The group it belongs to: the spec's own domain, else the folder under `specs/`. */
  readonly domain: string;
  readonly kind: string;
};

/** One test: what it is, its current status per environment, and how it has gone. */
export type TestSummary = {
  /** The check identity, `JSON.stringify([specPath, id])`. Stable; use it to ask for the test's history. */
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly specPath: string | null;
  readonly spec: CatalogSpec | null;
  /** The worst current outcome across its results (failed, then running, then not-run, then passed). */
  readonly status: EvidenceStatus;
  readonly environments: readonly string[];
  readonly producers: readonly string[];
  /** The current result per producer, environment and parameter set, newest first. */
  readonly outcomes: readonly TestOutcome[];
  readonly stats: TestStats;
  readonly tags: readonly string[];
  /** The normalized tags of the attachments of its current results (`demo`, shown as `#demo`). Never inherited from a check or run; the `tags` above are. Absent in documents of older servers. */
  readonly artifactTags?: readonly string[];
  /** The normalized tags its attachments inherit from their check and run (those of the results that have attachments), apart from `artifactTags`. What an inherited artifact query also matches. */
  readonly inheritedArtifactTags?: readonly string[];
  /** What each distinct playable recording of its current results declares it shows, as filter tokens (`device:physical`, `audio:silent`; see `scopeTokens`). A recording that declared nothing is `['unknown']`. Absent when it has no playable recording. A query's `scope` must hold for one recording, so evidence from two different devices never combines. */
  readonly scopeProfiles?: readonly (readonly string[])[];
  readonly labels: Readonly<Record<string, string>>;
  /** What its current results carry: attachments, steps, retries, and the kinds of attachment. */
  readonly evidence: { readonly attachments: number; readonly steps: number; readonly attempts: number; readonly roles: readonly string[] };
  /** The newest time any of its results was recorded. */
  readonly lastRecordedAtMs: number;
  /** True while one of its results comes from a run still in progress. */
  readonly live: boolean;
};

/** A test named in an insight list, with the number that put it there. */
export type TestRef = {
  readonly key: string;
  readonly title: string;
  readonly specPath: string | null;
  readonly status: EvidenceStatus;
  /** Average duration (ms) for `slowest`, flips for `flaky`, failures for `failing`. */
  readonly value: number;
};

/** A group in the summary (an environment, a producer, a domain, a spec): how many tests, by status (for an environment, by how they went on it), and their timing. */
export type CatalogGroup = {
  readonly name: string;
  readonly tests: number;
  readonly counts: StatusCounts;
  /** Average of its tests' average durations, ms, or null when none was measured. */
  readonly avgMs: number | null;
};

/** The report at a glance: counts, timing and insights over every test (not only those a query matched). */
export type CatalogSummary = {
  readonly tests: number;
  /** Tests by their current status. */
  readonly counts: StatusCounts;
  /** Current results (a test checked on two environments has two). */
  readonly outcomes: number;
  readonly flaky: number;
  /** Over each test's average duration. */
  readonly durations: DurationStats | null;
  /** Tests with at least one measured duration. */
  readonly measured: number;
  readonly withAttachments: number;
  readonly environments: readonly CatalogGroup[];
  readonly producers: readonly CatalogGroup[];
  readonly domains: readonly CatalogGroup[];
  readonly slowest: readonly TestRef[];
  readonly flakiest: readonly TestRef[];
  readonly failing: readonly TestRef[];
  /** Runs the history knows of. */
  readonly runs: number;
  readonly lastRecordedAtMs: number | null;
  /** True when statistics come from recorded history, false when only the current results were available. */
  readonly history: boolean;
};

/** A value to filter by, and how many tests have it. */
export type FacetValue = { readonly value: string; readonly count: number };

/** Everything the tests can be filtered and grouped by, with counts over every test. */
export type CatalogFacets = {
  readonly statuses: readonly FacetValue[];
  readonly environments: readonly FacetValue[];
  readonly producers: readonly FacetValue[];
  readonly domains: readonly FacetValue[];
  readonly specs: readonly (CatalogSpec & { readonly tests: number; readonly counts: StatusCounts })[];
  readonly tags: readonly FacetValue[];
  /** The tags of attachments, normalized. Absent in documents of older servers. */
  readonly artifactTags?: readonly FacetValue[];
  /** The scope tokens of its recordings (`device:simulator`, `audio:recorded`, `unknown`), with how many tests have a recording that states each. Absent in documents of older servers. */
  readonly scopes?: readonly FacetValue[];
  readonly branches: readonly FacetValue[];
  readonly labels: Readonly<Record<string, readonly FacetValue[]>>;
};

/** How tests are ordered. */
export const TEST_SORTS = ['spec', 'title', 'recent', 'slowest', 'failures', 'flaky', 'runs'] as const;
/** One of `TEST_SORTS`. `spec` (the default) orders by domain, spec and title. */
export type TestSort = (typeof TEST_SORTS)[number];

/** Which tests to list. Every field is optional; several values of one field match any of them, and fields combine. */
export type TestQuery = {
  /** Words that must all appear in the title, id, spec, domain, tags, labels, environments or producers. Case does not matter. */
  readonly q?: string;
  /** Current status, or `flaky`. */
  readonly status?: readonly string[];
  readonly environment?: readonly string[];
  readonly producer?: readonly string[];
  readonly domain?: readonly string[];
  /** Spec paths (`specs/...`). */
  readonly spec?: readonly string[];
  readonly tag?: readonly string[];
  /** Only tests with an attachment carrying this tag (`demo` and `#demo` are the same), not counting tags inherited from a check or run: the exact artifact query. `tag` is the inherited one. */
  readonly artifactTag?: readonly string[];
  /** With `artifactTag`: also match the tags an attachment inherits from its check and run (a recording without a tag of its own under a run tagged `demo`). Default false: the exact query. */
  readonly inherited?: boolean;
  /** Only tests with one playable recording that states every one of these (`device:physical`, `audio:recorded`, `data:synthetic`, `dependencies:live`, `surface:browser`, `pacing:paced`; see `scopeTokens`). Evidence that did not declare a value never matches it; `unknown` matches only a recording that declared no scope. */
  readonly scope?: readonly string[];
  /** Only tests recorded in this run (a key from `runList`). */
  readonly run?: string;
  readonly sort?: TestSort;
  readonly offset?: number;
  /** At most this many tests (default 500, at most 20000). */
  readonly limit?: number;
};

/** `GET /api/reports/tests`: the summary, the facets and the tests that match a query. */
export type TestCatalog = {
  readonly schemaVersion: typeof TEST_CATALOG_VERSION;
  /** Changes whenever the report or its history does. */
  readonly version: string;
  readonly generatedAtMs: number;
  readonly summary: CatalogSummary;
  readonly facets: CatalogFacets;
  /** Tests that matched, before `offset` and `limit`. */
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly tests: readonly TestSummary[];
};

/** `GET /api/reports/tests/history`: one test and every result recorded for it, newest first. */
export type TestHistoryDocument = {
  readonly schemaVersion: typeof TEST_CATALOG_VERSION;
  readonly version: string;
  readonly test: TestSummary;
  readonly history: readonly TestResultEntry[];
};

/**
 * A run: the layers that name the same execution (`run.id`), else share a CI run URL, else a branch and commit. When,
 * where, and how its tests went.
 */
export type RunSummary = {
  /** Stable key: `run:<id>` for an execution a producer named, else the run URL, else `branch@sha`. */
  readonly key: string;
  /** The execution id a producer named for it, when it did. Layers that share it are one run, however many uploads they took; another invocation at the same commit has another. */
  readonly runId?: string;
  /** The human title the producer gave the execution (the newest layer's). Presentation only: the key, the commit and `freshness` are unaffected. */
  readonly title?: string;
  /** `modified` when any of its layers was recorded from a checkout with uncommitted changes, else `unknown` when any origin was not captured; absent when every layer is from a clean commit. Advisory; never changes a status. */
  readonly freshness?: 'unknown' | 'modified';
  readonly runUrl: string | null;
  readonly branch: string | null;
  readonly sha: string | null;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  /** From its first to its last recorded result, ms. */
  readonly spanMs: number;
  readonly producers: readonly string[];
  readonly environments: readonly string[];
  readonly layers: number;
  /** Distinct tests it recorded. */
  readonly tests: number;
  /** Its results by status (its last word on each test, environment and producer). */
  readonly counts: StatusCounts;
  /** Sum of its results' durations, ms, when any was measured. */
  readonly totalDurationMs: number | null;
  /** Up to twenty tests that failed in it. */
  readonly failing: readonly { readonly key: string; readonly title: string; readonly environment: string | null; readonly detail: string }[];
  /**
   * Its videos, from the run's layers and from the last result of each test: references, distinct playable recordings
   * and references that cannot be played. Absent when it has none, and in a report that carries no video information.
   */
  readonly videos?: VideoCounts;
  /**
   * Whether the recordings its layers expected were published, apart from its outcomes (see `runRecordings`). Absent when
   * none of its layers declared a recording expectation: its completeness is unknown, never complete. Never changes a status.
   */
  readonly recordings?: RunRecordings;
  /**
   * Files attached to the run itself, in its layers (and their parts), not to any one check: review movies, archives,
   * summaries. All kinds, videos included. Absent when none, and in a report that carries no such information.
   */
  readonly attachments?: number;
  /** The normalized tags of the attachments of its results and layers, sorted and distinct. Absent when none is tagged. */
  readonly artifactTags?: readonly string[];
  /** The tags of its checks and layers, which its attachments inherit (what `inherited=1` also matches), sorted and distinct. Absent when none. */
  readonly tags?: readonly string[];
  /** The media types (roles) of its attachments, sorted and distinct; `video` only for a playable recording. Absent when it has no attachment. */
  readonly types?: readonly string[];
  /** The `key=value` labels of its results and layers, sorted and distinct. Absent when none. */
  readonly labels?: readonly string[];
};

/**
 * What `runList` can be asked: an {@link ArtifactFilter}, of which a run answers every dimension but `domain` and
 * `spec`. `video` keeps only runs that have at least one playable video recording; `total` then counts only those.
 */
export type RunQuery = ArtifactFilter;

/** `GET /api/reports/runs`: runs, newest first. */
export type RunList = {
  readonly schemaVersion: typeof TEST_CATALOG_VERSION;
  readonly version: string;
  /** Runs that matched, before `limit`. */
  readonly total: number;
  readonly runs: readonly RunSummary[];
  /** How many of all runs (whatever was asked, before `limit`) have a playable video recording. */
  readonly withVideo?: number;
  /** The filters of the query that were applied. A viewer that asked for another knows the server ignored it. */
  readonly filters?: readonly FilterName[];
  /** The values each filter dimension offers with counts over every run (see `facetsOf`). */
  readonly facets?: QueryFacets;
};

/** One test's last result within one run. */
export type RunResult = {
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly specPath: string | null;
  readonly environment: string | null;
  readonly producer: string;
  readonly status: EvidenceStatus;
  readonly durationMs: number | null;
  readonly at: number;
  readonly layer: string;
  readonly detail: string;
  /** Every video its evidence references, with who holds it (check, retry attempt or step). Absent when there is none. */
  readonly videos?: readonly VideoRef[];
  /** The kind of the part that held it (`behavior`, `checks`…). With the producer, environment and parameters it is the condition the result was recorded under. Absent from an older server. */
  readonly kind?: string;
  /** The other choices that made it its own result (a device size, a locale…). Absent when there are none, and from an older server. */
  readonly parameters?: Readonly<Record<string, string>>;
  /** The fingerprint of its spec file the layer recorded: results with different ones were recorded against different revisions of the spec. Absent means not recorded, never "the same". */
  readonly specRevision?: string;
  /** The title this run's layer gave the check. `title` is the newest title the check has in the whole history, so a check that was reworded shows its newest wording in both runs; this is the wording as recorded. Absent from an older server. */
  readonly recordedTitle?: string;
};

/**
 * One layer of a run, as the run's artifact hub names it: who recorded it, how many checks it holds (zero is possible
 * and is not a pass) and the files it carries as a whole. Read the files with `GET /evidence/detail/{backend}/{id}`.
 */
export type RunLayer = {
  /** The layer's id: 64 hex digits for an archived layer. */
  readonly id: string;
  /** The backend it was read from, for `GET /evidence/detail/{backend}/{id}`. */
  readonly backend: string;
  readonly producer: string;
  readonly environment: string | null;
  readonly recordedAtMs: number;
  /** How many checks the layer recorded. A layer of zero checks is evidence only: it is not a passing test. */
  readonly checks: number;
  /** Files the layer carries as a whole (not those of its checks). */
  readonly attachments: number;
  /** Its videos, when it has any. */
  readonly videos?: VideoCounts;
};

/** `GET /api/reports/runs/detail`: one run and every result it recorded. */
export type RunDetail = {
  readonly schemaVersion: typeof TEST_CATALOG_VERSION;
  readonly version: string;
  readonly run: RunSummary;
  readonly results: readonly RunResult[];
  /** Every layer of the run, oldest first, so its run-level files can be found even in a layer with no checks. Absent from an older server. */
  readonly layers?: readonly RunLayer[];
};

/**
 * One recorded result that carries evidence (an attachment: a recording, a screenshot, a trace), with where and when it
 * was recorded: the unit `artifactList` finds. It is a result in the history, not only the report's current winner, so
 * a recording tagged `demo` is found with its original run, revision and status even when a later attempt is untagged.
 */
export type ArtifactResult = {
  /** The test's key, as in `TestSummary.key`. */
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly specPath: string | null;
  /** The domain of its spec, or null when it has none. */
  readonly domain: string | null;
  /** When it was recorded, epoch ms. */
  readonly at: number;
  readonly status: EvidenceStatus;
  readonly environment: string | null;
  readonly producer: string;
  /** The kind of the part that held it. */
  readonly kind: string;
  readonly parameters: Readonly<Record<string, string>>;
  readonly branch: string | null;
  readonly sha: string | null;
  /** The key of its run (see `runKey`). */
  readonly run: string;
  readonly runUrl: string | null;
  /** The id of the layer that recorded it: with `key`, the exact result to open. */
  readonly layer: string;
  readonly backend: string;
  /** Attachments on the result, including those on its steps and attempts. */
  readonly attachments: number;
  /** The normalized tags of its attachments. */
  readonly artifactTags: readonly string[];
  /** The tags of its check and run, which its attachments inherit. */
  readonly tags: readonly string[];
  /** The media types (roles) of its attachments; `video` only for a playable recording. */
  readonly types: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly videos?: readonly VideoRef[];
  /** The status of each recorded try in order, when the check was retried. Absent when no try was recorded: a first try is then unknown, never assumed to have passed. */
  readonly attemptStatuses?: readonly EvidenceStatus[];
};

/** `GET /api/reports/artifacts`: the recorded results that carry evidence and match a query, newest first. */
export type ArtifactList = {
  readonly schemaVersion: typeof TEST_CATALOG_VERSION;
  readonly version: string;
  /** Results that matched, before `offset` and `limit`. */
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly results: readonly ArtifactResult[];
  /** The filters of the query that were applied. */
  readonly filters: readonly FilterName[];
  /** The values each dimension offers with disjunctive counts over every result that carries evidence. */
  readonly facets: QueryFacets;
};

/**
 * The run a layer belongs to: the execution its producer named (`run:<id>`), else its run URL, else `branch@sha`, else
 * `local`. Layers with the same key are one run. Only grouping: it is never part of the slot a result fills.
 */
export function runKey(layer: Pick<LayerHeader, 'runUrl' | 'branch' | 'sha'> & { readonly run?: { readonly id: string } }): string {
  if (layer.run?.id) return `run:${layer.run.id}`;
  if (layer.runUrl) return layer.runUrl;
  if (layer.branch || layer.sha) return `${layer.branch ?? ''}@${layer.sha ?? ''}`;
  return 'local';
}

function shortDetail(detail: string): string {
  return detail.length > 500 ? `${detail.slice(0, 497)}...` : detail;
}

function completed(status: EvidenceStatus): boolean {
  return status === 'passed' || status === 'failed';
}

function entryOf(layer: LayerHeader, row: LayerRow, backend: string, fingerprints: Readonly<Record<string, string>> = {}): TestResultEntry {
  return materialize({ o: originOf(layer, backend), s: row.status, d: row.durationMs, k: row.kind, t: row.detail, e: row.evidence, m: productLatency(row.measurements), f: row.specPath ? fingerprints[row.specPath] : undefined });
}

/**
 * History holds a result in two parts, because it holds a great many: what its whole layer shares (made once per
 * layer) and the few facts of its own. `materialize` makes the published `TestResultEntry` when it is asked for.
 */
type Origin = {
  readonly at: number; readonly environment: string | null; readonly producer: string; readonly parameters: Readonly<Record<string, string>>;
  readonly branch: string | null; readonly sha: string | null; readonly runUrl: string | null; readonly run: string; readonly layer: string; readonly backend: string;
  /** Producer, environment and parameters: with a test and a kind, the slot a result fills. */
  readonly place: string;
};
type Held = { readonly o: Origin; readonly s: EvidenceStatus; readonly d: number | null; readonly k: string; readonly t: string; readonly e: EvidenceSummary | undefined; readonly m: readonly EvidenceMeasurement[] | undefined; readonly f?: string | undefined; /** The title this result's layer gave the check (shared, not copied, between results). */ readonly ti?: string };

function originOf(layer: LayerHeader, backend: string): Origin {
  const parameters = Object.keys(layer.parameters).sort().map(key => `${key}=${layer.parameters[key]}`).join('\u0002');
  return {
    at: layer.recordedAtMs, environment: layer.environment, producer: layer.producer, parameters: layer.parameters,
    branch: layer.branch, sha: layer.sha, runUrl: layer.runUrl, run: runKey(layer), layer: layer.id, backend,
    place: `${layer.producer}\u0001${layer.environment ?? ''}\u0001${parameters}`,
  };
}

function materialize(held: Held): TestResultEntry {
  const { o } = held;
  return {
    at: o.at, status: held.s, durationMs: held.d, environment: o.environment, producer: o.producer, kind: held.k, parameters: o.parameters,
    branch: o.branch, sha: o.sha, runUrl: o.runUrl, run: o.run, layer: o.layer, backend: o.backend, detail: shortDetail(held.t),
    ...(held.f ? { specRevision: held.f } : {}),
    ...(held.e ? { evidence: held.e } : {}),
    ...(held.m ? { latency: held.m } : {}),
  };
}

/** Newest first; at the same time the more severe, then the larger layer id, so the order is total. */
function newer(a: Held, b: Held): number {
  return b.o.at - a.o.at || FAILURE_RANK[b.s] - FAILURE_RANK[a.s] || (a.o.layer < b.o.layer ? 1 : a.o.layer > b.o.layer ? -1 : a.o.place < b.o.place ? 1 : a.o.place > b.o.place ? -1 : a.k < b.k ? 1 : a.k > b.k ? -1 : 0);
}

/** What a run is told by, kept per run: small, whatever how many results it recorded. */
type RunAcc = {
  key: string; runUrl: string | null; branch: string | null; sha: string | null;
  /** The earliest and latest times the run is told by: a layer's `recordedAtMs`, or the start and end its execution declared. */
  start: number; end: number;
  /** When its first layer was recorded: which layer tells the branch and commit. */
  firstAt: number; first: string; producers: Set<string>; environments: Set<string>; layers: number;
  runId: string | undefined; title: string | undefined; titledAt: number; titledBy: string; freshness: 'unknown' | 'modified' | undefined;
  /** Videos attached to its layers (not to a check). */
  videos: VideoRef[];
  /** The recording receipt counts of each of its layers, `undefined` for a layer with none. */
  receipts: (RecordingCounts | undefined)[];
  /** Files attached to its layers (not to a check). */
  attachments: number;
  /** Its layers, in the order they arrived. */
  members: RunLayer[];
  /** What its layers' own evidence (their logs, links and labels) carries. */
  evidence: { tags: Set<string>; artifactTags: Set<string>; roles: Set<string>; labels: Set<string> };
};
/** A test as history names it: its key and the newest title seen. */
type Ident = { readonly slot: string; readonly id: string; title: string; titledAt: number; readonly specPath: string | null };
type RunCell = { readonly i: Ident; readonly r: Held };

/** Whether `next` is a run's better last word on a result than `prior`: completed beats unfinished, then newer, then more severe. */
function laterInRun(next: Held, prior: Held): boolean {
  if (completed(next.s) !== completed(prior.s)) return completed(next.s);
  return newer(next, prior) < 0;
}

/**
 * Every recorded result of every test (the newest `HISTORY_PER_TEST` per test, leaving out `running` progress) and the
 * runs they came from. A run's results are read from that history, so memory follows the number of tests and not the age
 * of the project: a run older than a test's last hundred results no longer lists that test. Add each layer once with
 * `add`; the order layers arrive in does not change what it holds. It never decides a status.
 *
 * @example
 * ```ts
 * const history = new TestHistory();
 * for (const { layer, rows } of layers) history.add(layer, rows, specs, layer.backend);
 * const catalog = testCatalog(catalogModel(layers, { history }));
 * ```
 */
export class TestHistory {
  readonly #bySlot = new Map<string, Held[]>();
  readonly #idents = new Map<string, Ident>();
  readonly #runs = new Map<string, RunAcc>();
  readonly #specs = new RecordedSpecs();
  /** Titles seen, so the many results that share one hold one string. */
  readonly #titles = new Map<string, string>();
  readonly #seen = new Set<string>();
  #rev = 0;
  #cells: { rev: number; byRun: Map<string, RunCell[]> } | null = null;
  #evidence: { rev: number; items: { result: ArtifactResult; fields: FilterFields }[] } | null = null;

  /** Changes each time a layer is added. */
  get rev(): number {
    return this.#rev;
  }

  /** The specs the added layers recorded. */
  get specs(): RecordedSpecs {
    return this.#specs;
  }

  /** Every test the history holds a result for (keyed as `TestSummary.key`), including tests the report no longer has a current result for. */
  tests(): readonly { readonly key: string; readonly id: string; readonly specPath: string | null }[] {
    return [...this.#idents.values()].map(({ slot, id, specPath }) => ({ key: slot, id, specPath }));
  }

  /** How many layers were added. */
  get layers(): number {
    return this.#seen.size;
  }

  /**
   * Takes in one layer: its header, its rows, the specs it recorded and the backend it was read from. A layer id already
   * added is ignored. `fingerprints` (spec path to the fingerprint the layer recorded, as `LayerRows.fingerprints`) gives
   * each result its `specRevision`; without it no result has one.
   */
  add(layer: LayerHeader, rows: readonly LayerRow[], specs: readonly SpecEntry[] = [], backend = layer.backend, fingerprints: Readonly<Record<string, string>> = {}): void {
    if (this.#seen.has(layer.id)) return;
    this.#seen.add(layer.id);
    this.#rev += 1;
    this.#specs.add(specs, layer.recordedAtMs);
    const key = runKey(layer);
    let run = this.#runs.get(key);
    if (!run) {
      run = { key, runUrl: layer.runUrl, branch: layer.branch, sha: layer.sha, start: layer.recordedAtMs, end: layer.recordedAtMs, firstAt: layer.recordedAtMs, first: layer.id, producers: new Set(), environments: new Set(), layers: 0, runId: layer.run?.id, title: undefined, titledAt: 0, titledBy: '', freshness: undefined, videos: [], receipts: [], attachments: 0, members: [], evidence: { tags: new Set(), artifactTags: new Set(), roles: new Set(), labels: new Set() } };
      this.#runs.set(key, run);
    }
    // A run is told by its first layer (by time, then id), whatever order its layers arrive in.
    if (layer.recordedAtMs < run.firstAt || (layer.recordedAtMs === run.firstAt && layer.id < run.first)) {
      run.firstAt = layer.recordedAtMs;
      run.first = layer.id;
      run.branch = layer.branch;
      run.sha = layer.sha;
      run.runUrl = layer.runUrl;
    }
    run.start = Math.min(run.start, layer.recordedAtMs, layer.run?.startedAtMs ?? Infinity);
    run.end = Math.max(run.end, layer.recordedAtMs, layer.run?.endedAtMs ?? -Infinity);
    // The newest title wins, so a person can rename a run by sending its id again with another title.
    const title = layer.run?.title;
    if (title && (layer.recordedAtMs > run.titledAt || (layer.recordedAtMs === run.titledAt && layer.id > run.titledBy))) {
      run.title = title;
      run.titledAt = layer.recordedAtMs;
      run.titledBy = layer.id;
    }
    // Local changes are never lost to a clean sibling: the run is as modified as its most modified layer.
    if (layer.freshness === 'modified' || (layer.freshness === 'unknown' && run.freshness !== 'modified')) run.freshness = layer.freshness;
    run.producers.add(layer.producer);
    if (layer.environment) run.environments.add(layer.environment);
    run.layers += 1;
    if (layer.evidence?.videos) run.videos.push(...layer.evidence.videos);
    run.receipts.push(layer.recordings);
    const held = layer.evidence?.attachments ?? 0;
    run.attachments += held;
    const layerVideos = videoCounts(layer.evidence?.videos);
    run.members.push({ id: layer.id, backend, producer: layer.producer, environment: layer.environment, recordedAtMs: layer.recordedAtMs, checks: rows.length, attachments: held, ...(layerVideos ? { videos: layerVideos } : {}) });
    if (layer.evidence) takeEvidence(run.evidence, layer.evidence);
    const origin = originOf(layer, backend);
    for (const row of rows) {
      // "Still running" is progress, not history: a test running now shows it as its current outcome.
      if (row.status === 'running') continue;
      const slot = slotKey(row.specPath ?? '', row.id);
      let ident = this.#idents.get(slot);
      if (!ident) this.#idents.set(slot, ident = { slot, id: row.id, title: row.title, titledAt: layer.recordedAtMs, specPath: row.specPath });
      else if (layer.recordedAtMs > ident.titledAt || (layer.recordedAtMs === ident.titledAt && row.title > ident.title)) { ident.title = row.title; ident.titledAt = layer.recordedAtMs; }
      this.#remember(slot, { o: origin, s: row.status, d: row.durationMs, k: row.kind, t: row.detail, e: row.evidence, m: productLatency(row.measurements), f: row.specPath ? fingerprints[row.specPath] : undefined, ti: this.#title(row.title) });
    }
  }

  #title(title: string): string {
    const held = this.#titles.get(title);
    if (held !== undefined) return held;
    this.#titles.set(title, title);
    return title;
  }

  /** Sorted insert, newest first; past the bound, the oldest is dropped. */
  #remember(slot: string, entry: Held): void {
    const list = this.#bySlot.get(slot);
    if (!list) { this.#bySlot.set(slot, [entry]); return; }
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (newer(list[mid]!, entry) <= 0) lo = mid + 1; else hi = mid; }
    if (lo >= HISTORY_PER_TEST) return;
    list.splice(lo, 0, entry);
    if (list.length > HISTORY_PER_TEST) list.pop();
  }

  /** The recorded results of one test (by `TestSummary.key`), newest first. Empty when none. */
  of(key: string): readonly TestResultEntry[] {
    return (this.#bySlot.get(key) ?? []).map(materialize);
  }

  /** How many runs it knows of. */
  get runCount(): number {
    return this.#runs.size;
  }

  /**
   * Each run's last word on each test, producer, environment, parameter set and kind it recorded, read from history in
   * one pass and kept until a layer arrives.
   */
  #runCells(): Map<string, RunCell[]> {
    if (this.#cells?.rev === this.#rev) return this.#cells.byRun;
    const byRun = new Map<string, RunCell[]>();
    for (const [slot, list] of this.#bySlot) {
      const i = this.#idents.get(slot)!;
      const best = new Map<string, Held>();
      for (const held of list) {
        const cell = `${held.o.run}\u0001${held.o.place}\u0001${held.k}`;
        const prior = best.get(cell);
        if (!prior || laterInRun(held, prior)) best.set(cell, held);
      }
      for (const r of best.values()) {
        const cells = byRun.get(r.o.run);
        if (cells) cells.push({ i, r }); else byRun.set(r.o.run, [{ i, r }]);
      }
    }
    this.#cells = { rev: this.#rev, byRun };
    return byRun;
  }

  /** Every run, newest first. */
  runs(): RunSummary[] {
    const cells = this.#runCells();
    return [...this.#runs.values()].map(run => runSummary(run, cells.get(run.key) ?? [])).sort((a, b) => b.endedAtMs - a.endedAtMs || (a.key < b.key ? -1 : 1));
  }

  /** One run and its results (failed first, then by spec and title), or null. */
  run(key: string): { readonly run: RunSummary; readonly results: RunResult[]; readonly layers: RunLayer[] } | null {
    const run = this.#runs.get(key);
    if (!run) return null;
    const cells = this.#runCells().get(key) ?? [];
    const results = cells.map(({ i, r }) => ({
      key: i.slot, id: i.id, title: i.title, specPath: i.specPath, environment: r.o.environment, producer: r.o.producer,
      status: r.s, durationMs: r.d, at: r.o.at, layer: r.o.layer, detail: shortDetail(r.t),
      ...(r.e?.videos ? { videos: r.e.videos } : {}),
      kind: r.k,
      ...(Object.keys(r.o.parameters).length ? { parameters: r.o.parameters } : {}),
      ...(r.f ? { specRevision: r.f } : {}),
      ...(r.ti !== undefined ? { recordedTitle: r.ti } : {}),
    }));
    results.sort((a, b) => FAILURE_RANK[b.status] - FAILURE_RANK[a.status] || compareText(a.specPath ?? '', b.specPath ?? '') || compareText(a.title, b.title) || compareText(a.environment ?? '', b.environment ?? '') || compareText(a.producer, b.producer) || compareText(a.key, b.key));
    const layers = [...run.members].sort((a, b) => a.recordedAtMs - b.recordedAtMs || compareText(a.id, b.id));
    return { run: runSummary(run, cells), results, layers };
  }

  /**
   * Every recorded result that carries an attachment, newest first, with the values a query looks at. Built once per
   * layer added. The domain is left to the caller (`artifactList`), which may know more specs than the layers recorded.
   */
  evidenceResults(): readonly { readonly result: ArtifactResult; readonly fields: FilterFields }[] {
    if (this.#evidence?.rev === this.#rev) return this.#evidence.items;
    const items: { result: ArtifactResult; fields: FilterFields }[] = [];
    for (const [slot, list] of this.#bySlot) {
      const i = this.#idents.get(slot)!;
      for (const held of list) {
        const e = held.e;
        if (!e || e.attachments < 1) continue;
        const playable = (videoCounts(e.videos)?.recordings ?? 0) > 0;
        const types = typesOf(e.roles, playable);
        const artifactTags = [...(e.artifactTags ?? [])];
        const o = held.o;
        const result: ArtifactResult = {
          key: i.slot, id: i.id, title: i.title, specPath: i.specPath, domain: null, at: o.at, status: held.s, environment: o.environment, producer: o.producer, kind: held.k,
          parameters: o.parameters, branch: o.branch, sha: o.sha, run: o.run, runUrl: o.runUrl, layer: o.layer, backend: o.backend, attachments: e.attachments,
          artifactTags, tags: [...e.tags], types, labels: e.labels, ...(e.videos ? { videos: e.videos } : {}), ...(e.attemptStatuses ? { attemptStatuses: e.attemptStatuses } : {}),
        };
        const media = [
          ...types.filter(type => type !== 'video').map(type => ({ type, tags: artifactTags })),
          ...(e.videos ?? []).filter(video => video.available).map(video => ({ type: 'video', tags: video.tags ?? [] })),
        ];
        const labels = labelList(e.labels);
        items.push({
          result,
          fields: {
            text: [i.title, i.id, i.specPath ?? '', o.branch ?? '', o.producer, o.environment ?? '', ...artifactTags, ...e.tags, ...labels].join('\n').toLowerCase(),
            artifactTags, tags: [...new Set([...e.tags, ...artifactTags])], types, media, labels,
            environments: o.environment ? [o.environment] : [], producers: [o.producer], branches: o.branch ? [o.branch] : [], shas: o.sha ? [o.sha.toLowerCase()] : [],
            outcomes: [held.s], at: o.at,
          },
        });
      }
    }
    items.sort((a, b) => b.result.at - a.result.at || compareText(a.result.layer, b.result.layer) || compareText(a.result.key, b.result.key) || compareText(a.result.kind, b.result.kind) || compareText(a.result.producer, b.result.producer));
    this.#evidence = { rev: this.#rev, items };
    return items;
  }

  /** The keys of the tests one run recorded. */
  testsIn(key: string): ReadonlySet<string> {
    return new Set((this.#runCells().get(key) ?? []).map(cell => cell.i.slot));
  }
}

function takeEvidence(into: RunAcc['evidence'], evidence: EvidenceSummary): void {
  for (const tag of evidence.tags) into.tags.add(tag);
  for (const tag of evidence.artifactTags ?? []) into.artifactTags.add(tag);
  for (const role of evidence.roles) into.roles.add(role);
  for (const label of labelList(evidence.labels)) into.labels.add(label);
}

/** The media types of an evidence summary: its roles, with `video` only when a recording can be played. */
function typesOf(roles: Iterable<string>, playable: boolean): string[] {
  const types = new Set(roles);
  types.delete('video');
  if (playable) types.add('video');
  return [...types].sort();
}

function runSummary(run: RunAcc, cells: readonly RunCell[]): RunSummary {
  const counts = emptyCounts();
  const carried = { tags: new Set(run.evidence.tags), artifactTags: new Set(run.evidence.artifactTags), roles: new Set(run.evidence.roles), labels: new Set(run.evidence.labels) };
  const tests = new Set<string>();
  let total = 0, measured = false;
  const failed: RunCell[] = [];
  const videos = [...run.videos];
  for (const cell of cells) {
    if (cell.r.e?.videos) videos.push(...cell.r.e.videos);
    if (cell.r.e) takeEvidence(carried, cell.r.e);
    counts[cell.r.s] += 1;
    tests.add(cell.i.slot);
    if (cell.r.d !== null) { total += cell.r.d; measured = true; }
    if (cell.r.s === 'failed') failed.push(cell);
  }
  failed.sort((a, b) => compareText(a.i.slot, b.i.slot) || compareText(a.r.o.place, b.r.o.place) || compareText(a.r.k, b.r.k));
  const video = videoCounts(videos);
  const recordings = runRecordings(run.receipts);
  const failing = failed.slice(0, 20).map(cell => ({ key: cell.i.slot, title: cell.i.title, environment: cell.r.o.environment, detail: (cell.r.t.split('\n')[0] ?? '').slice(0, 500) }));
  return {
    key: run.key, ...(run.runId ? { runId: run.runId } : {}), ...(run.title ? { title: run.title } : {}), ...(run.freshness ? { freshness: run.freshness } : {}),
    runUrl: run.runUrl, branch: run.branch, sha: run.sha,
    startedAtMs: run.start, endedAtMs: run.end, spanMs: run.end - run.start,
    producers: [...run.producers].sort(), environments: [...run.environments].sort(),
    layers: run.layers, tests: tests.size, counts, totalDurationMs: measured ? total : null, failing,
    ...(video ? { videos: video } : {}),
    ...(recordings ? { recordings } : {}),
    ...(run.attachments ? { attachments: run.attachments } : {}),
    ...(carried.artifactTags.size ? { artifactTags: [...carried.artifactTags].sort() } : {}),
    ...(carried.roles.size ? { types: typesOf(carried.roles, (video?.recordings ?? 0) > 0) } : {}),
    ...(carried.labels.size ? { labels: [...carried.labels].sort() } : {}),
    ...(carried.tags.size ? { tags: [...carried.tags].sort() } : {}),
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Durations of a list of numbers (ms), or null when empty. `lastMs` is the first value, so give them newest first. */
export function durationStats(values: readonly number[]): DurationStats | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
  return { count: sorted.length, totalMs: total, avgMs: Math.round(total / sorted.length), p50Ms: at(0.5), p95Ms: at(0.95), minMs: sorted[0]!, maxMs: sorted.at(-1)!, lastMs: values[0]! };
}

/** The spec a path names: the recorded one, or one derived from the path (`specs/<domain>/<name>.<ext>`). */
export function catalogSpec(path: string | null, known: (path: string) => SpecEntry | undefined): CatalogSpec | null {
  if (!path) return null;
  const entry = known(path);
  const parts = normalSpecPath(path).split('/');
  const folder = parts.length > 2 && parts[0] === 'specs' ? parts[1]! : parts.length > 1 ? parts.at(-2)! : '';
  const base = (parts.at(-1) ?? path).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  return {
    path: entry?.path ?? normalSpecPath(path),
    title: entry?.title || (base ? base[0]!.toUpperCase() + base.slice(1) : path),
    domain: entry?.domain || folder,
    kind: entry?.kind || (/\.([^./]+)$/.exec(path)?.[1] ?? 'unknown'),
  };
}

function statsOf(history: readonly TestResultEntry[], outcomes: readonly TestOutcome[], tags: readonly string[], labels: Readonly<Record<string, string>>): TestStats {
  // Without history, the current results are all there is.
  const entries = history.length ? history : outcomes;
  let passed = 0, failed = 0, firstSeenMs: number | null = null, lastSeenMs: number | null = null, lastPassedAtMs: number | null = null, lastFailedAtMs: number | null = null;
  const durations: number[] = [];
  const runs = new Set<string>();
  const branches: string[] = [];
  const bySha = new Map<string, Set<EvidenceStatus>>();
  const sequences = new Map<string, EvidenceStatus[]>();
  for (const entry of entries) {
    if (entry.status === 'passed') { passed += 1; lastPassedAtMs ??= entry.at; }
    if (entry.status === 'failed') { failed += 1; lastFailedAtMs ??= entry.at; }
    lastSeenMs ??= entry.at;
    firstSeenMs = entry.at;
    if (entry.durationMs !== null && completed(entry.status)) durations.push(entry.durationMs);
    runs.add(entry.run);
    if (entry.branch && !branches.includes(entry.branch) && branches.length < 10) branches.push(entry.branch);
    if (completed(entry.status)) {
      const place = `${entry.producer}|${entry.environment ?? ''}|${JSON.stringify(entry.parameters)}`;
      if (entry.sha) {
        const sha = `${place}|${entry.sha}`;
        const seen = bySha.get(sha) ?? new Set();
        seen.add(entry.status);
        bySha.set(sha, seen);
      }
      const sequence = sequences.get(place) ?? [];
      sequence.push(entry.status);
      sequences.set(place, sequence);
    }
  }
  let flips = 0;
  for (const sequence of sequences.values()) for (let i = 1; i < sequence.length; i++) if (sequence[i] !== sequence[i - 1]) flips += 1;
  const mixedSha = [...bySha.values()].some(statuses => statuses.size > 1);
  const retried = outcomes.some(outcome => outcome.status === 'passed' && (outcome.evidence?.attempts ?? 0) > 1);
  const said = tags.some(tag => tag.toLowerCase() === 'flaky') || labels.flaky === 'true';
  const flakyReason = mixedSha ? 'Passed and failed on the same commit' : retried ? 'Passed only after a retry' : said ? 'Marked flaky by its producer' : '';
  return {
    results: entries.length, passed, failed, passRate: passed + failed ? passed / (passed + failed) : null,
    flaky: flakyReason !== '', flakyReason, flips, durations: durationStats(durations),
    firstSeenMs, lastSeenMs, lastPassedAtMs, lastFailedAtMs, runs: runs.size, branches,
  };
}

function outcomeOf(result: EvidenceResult): TestOutcome {
  return entryOf(result.layer, result.row, result.layer.backend);
}

/** Where the catalog's statistics and specs come from. */
export type CatalogSources = {
  /** Recorded results; without it, statistics describe only the current results. */
  readonly history?: TestHistory | null;
  /** Specs by path, published or recorded. Defaults to those the history recorded. */
  readonly specs?: readonly SpecEntry[];
  /** The report's version, echoed in the documents. */
  readonly version?: string;
  readonly now?: number;
};

/** The tests of a report, built once and queried many times: what `testCatalog` and `testHistory` read from. */
export type CatalogModel = {
  readonly version: string;
  readonly generatedAtMs: number;
  readonly tests: readonly TestSummary[];
  readonly byKey: ReadonlyMap<string, TestSummary>;
  readonly summary: CatalogSummary;
  readonly facets: CatalogFacets;
  readonly haystacks: ReadonlyMap<string, string>;
  readonly history: TestHistory | null;
  /** The specs the report is laid over, sorted by path: the given ones, else those the layers recorded. What `catalogHealth` calls defined. Absent on a model built from a server's catalog document. */
  readonly specs?: readonly SpecEntry[];
};

function summaryOf(slot: CheckSlot, history: TestHistory | null, known: (path: string) => SpecEntry | undefined): TestSummary {
  const outcomes = slot.outcomes.map(outcomeOf);
  const tags = new Set<string>();
  const artifactTags = new Set<string>();
  const inheritedTags = new Set<string>();
  const labels: Record<string, string> = {};
  let attachments = 0, steps = 0, attempts = 0;
  const roles = new Set<string>();
  const profiles = new Map<string, readonly string[]>();
  for (const [at, outcome] of outcomes.entries()) {
    const evidence = outcome.evidence;
    if (!evidence) continue;
    for (const video of evidence.videos ?? []) if (video.available) { const tokens = scopeTokens(video.scope); profiles.set(tokens.join('\n'), tokens); }
    if (evidence.attachments > 0) for (const tag of normalizeTags([...evidence.tags, ...(slot.outcomes[at]?.layer.evidence?.tags ?? [])])) inheritedTags.add(tag);
    for (const tag of evidence.tags) tags.add(tag);
    for (const tag of evidence.artifactTags ?? []) artifactTags.add(tag);
    Object.assign(labels, evidence.labels);
    attachments += evidence.attachments;
    steps += evidence.steps;
    attempts = Math.max(attempts, evidence.attempts);
    for (const role of evidence.roles) roles.add(role);
  }
  const tagList = [...tags].sort();
  return {
    key: slot.key,
    id: slot.id,
    title: slot.title,
    specPath: slot.specPath,
    spec: catalogSpec(slot.specPath, known),
    status: slot.status,
    environments: [...new Set(outcomes.map(outcome => outcome.environment).filter((env): env is string => !!env))].sort(),
    producers: [...new Set(outcomes.map(outcome => outcome.producer))].sort(),
    outcomes,
    stats: statsOf(history?.of(slot.key) ?? [], outcomes, tagList, labels),
    tags: tagList,
    ...(artifactTags.size ? { artifactTags: [...artifactTags].sort() } : {}),
    ...([...inheritedTags].some(tag => !artifactTags.has(tag)) ? { inheritedArtifactTags: [...inheritedTags].filter(tag => !artifactTags.has(tag)).sort() } : {}),
    ...(profiles.size ? { scopeProfiles: [...profiles.values()] } : {}),
    labels,
    evidence: { attachments, steps, attempts, roles: [...roles].sort() },
    lastRecordedAtMs: slot.latestAtMs,
    live: slot.live,
  };
}

/** The lowercase text a search matches a test against: title, id, spec, domain, tags, labels, environments and producers. */
export function haystackOf(test: TestSummary): string {
  return [
    test.title, test.id, test.specPath ?? '', test.spec?.title ?? '', test.spec?.domain ?? '', ...test.tags, ...(test.artifactTags ?? []).map(displayTag), ...(test.scopeProfiles ?? []).flat().filter(token => token !== UNKNOWN_SCOPE),
    ...Object.entries(test.labels).flatMap(([key, value]) => [key, value]), ...test.environments, ...test.producers,
  ].join('\n').toLowerCase();
}

/** A test's worst current outcome on one environment (`(none)` for results that named none), or its own status when it has no result there. */
function statusOn(test: TestSummary, environment: string | null): EvidenceStatus {
  let status: EvidenceStatus | null = null;
  for (const outcome of test.outcomes) {
    if ((outcome.environment ?? '(none)') !== environment) continue;
    if (status === null || FAILURE_RANK[outcome.status] > FAILURE_RANK[status]) status = outcome.status;
  }
  return status ?? test.status;
}

function group(name: string, tests: readonly TestSummary[], environment: string | null = null): CatalogGroup {
  const counts = emptyCounts();
  const averages: number[] = [];
  for (const test of tests) {
    counts[environment === null ? test.status : statusOn(test, environment)] += 1;
    if (test.stats.durations) averages.push(test.stats.durations.avgMs);
  }
  return { name, tests: tests.length, counts, avgMs: averages.length ? Math.round(averages.reduce((a, b) => a + b, 0) / averages.length) : null };
}

function groupsBy(tests: readonly TestSummary[], keys: (test: TestSummary) => readonly string[], byEnvironment = false): CatalogGroup[] {
  const groups = new Map<string, TestSummary[]>();
  for (const test of tests) for (const key of keys(test)) { const list = groups.get(key); if (list) list.push(test); else groups.set(key, [test]); }
  return [...groups].map(([name, list]) => group(name, list, byEnvironment ? name : null)).sort((a, b) => b.tests - a.tests || compareText(a.name, b.name));
}

function facet(tests: readonly TestSummary[], keys: (test: TestSummary) => readonly string[]): FacetValue[] {
  const counts = new Map<string, number>();
  for (const test of tests) for (const key of new Set(keys(test))) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || compareText(a.value, b.value));
}

function ref(test: TestSummary, value: number): TestRef {
  return { key: test.key, title: test.title, specPath: test.specPath, status: test.status, value };
}

/**
 * Builds the tests of a report from its winners (`layers`, as the effective report holds them: each layer with the rows
 * that win) and, when given, a history. The model is what `testCatalog` and `testHistory` query; build it once per
 * version and reuse it.
 */
export function catalogModel(layers: readonly LayerEvidence[], sources: CatalogSources = {}): CatalogModel {
  const history = sources.history ?? null;
  const recorded = new RecordedSpecs();
  if (history) recorded.add(history.specs.entries(), 0);
  if (sources.specs) recorded.add(sources.specs, 1);
  const known = (path: string) => recorded.get(path);
  const combined = combineEvidence({ specs: [], sha: null, changedFiles: [] }, layers);
  const slots = checkSlots(combined.unassigned);
  const tests = slots.map(slot => summaryOf(slot, history, known));
  const byKey = new Map(tests.map(test => [test.key, test]));
  const haystacks = new Map(tests.map(test => [test.key, haystackOf(test)]));
  const counts = emptyCounts();
  for (const test of tests) counts[test.status] += 1;
  const averages = tests.flatMap(test => (test.stats.durations ? [test.stats.durations.avgMs] : []));
  const lastRecordedAtMs = tests.length ? Math.max(...tests.map(test => test.lastRecordedAtMs)) : null;
  const summary: CatalogSummary = {
    tests: tests.length,
    counts,
    outcomes: tests.reduce((sum, test) => sum + test.outcomes.length, 0),
    flaky: tests.filter(test => test.stats.flaky).length,
    durations: durationStats(averages),
    measured: averages.length,
    withAttachments: tests.filter(test => test.evidence.attachments > 0).length,
    // An environment counts how its own results went, so a failure on one does not show on another.
    environments: groupsBy(tests, test => test.environments.length ? test.environments : ['(none)'], true),
    producers: groupsBy(tests, test => test.producers),
    domains: groupsBy(tests, test => [test.spec?.domain || '(no spec)']),
    slowest: tests.filter(test => test.stats.durations).sort((a, b) => b.stats.durations!.avgMs - a.stats.durations!.avgMs || compareText(a.key, b.key)).slice(0, 10).map(test => ref(test, test.stats.durations!.avgMs)),
    flakiest: tests.filter(test => test.stats.flaky).sort((a, b) => b.stats.flips - a.stats.flips || compareText(a.key, b.key)).slice(0, 10).map(test => ref(test, test.stats.flips)),
    failing: tests.filter(test => test.status === 'failed').sort((a, b) => b.lastRecordedAtMs - a.lastRecordedAtMs || compareText(a.key, b.key)).slice(0, 50).map(test => ref(test, test.stats.failed)),
    runs: history?.runCount ?? new Set(tests.flatMap(test => test.outcomes.map(outcome => outcome.run))).size,
    lastRecordedAtMs,
    history: history !== null,
  };
  const specGroups = new Map<string, TestSummary[]>();
  for (const test of tests) if (test.spec) { const list = specGroups.get(test.spec.path); if (list) list.push(test); else specGroups.set(test.spec.path, [test]); }
  const labelKeys = new Set(tests.flatMap(test => Object.keys(test.labels)));
  const facets: CatalogFacets = {
    statuses: facet(tests, test => [test.status, ...(test.stats.flaky ? ['flaky'] : [])]),
    environments: facet(tests, test => test.environments),
    producers: facet(tests, test => test.producers),
    domains: facet(tests, test => [test.spec?.domain || '(no spec)']),
    specs: [...specGroups].map(([, list]) => { const g = group(list[0]!.spec!.path, list); return { ...list[0]!.spec!, tests: g.tests, counts: g.counts }; }).sort((a, b) => compareText(a.domain, b.domain) || compareText(a.title, b.title)),
    tags: facet(tests, test => test.tags),
    artifactTags: facet(tests, test => test.artifactTags ?? []),
    scopes: facet(tests, test => (test.scopeProfiles ?? []).flat()),
    branches: facet(tests, test => test.stats.branches),
    labels: Object.fromEntries([...labelKeys].sort().map(key => [key, facet(tests, test => (test.labels[key] === undefined ? [] : [test.labels[key]!]))])),
  };
  return { version: sources.version ?? '', generatedAtMs: sources.now ?? Date.now(), tests, byKey, summary, facets, haystacks, history, specs: recorded.entries() };
}

const SORTERS: Record<TestSort, (a: TestSummary, b: TestSummary) => number> = {
  spec: (a, b) => compareText(a.spec?.domain ?? '\uffff', b.spec?.domain ?? '\uffff') || compareText(a.spec?.title ?? '\uffff', b.spec?.title ?? '\uffff') || compareText(a.title, b.title),
  title: (a, b) => compareText(a.title.toLowerCase(), b.title.toLowerCase()),
  recent: (a, b) => b.lastRecordedAtMs - a.lastRecordedAtMs,
  slowest: (a, b) => (b.stats.durations?.avgMs ?? -1) - (a.stats.durations?.avgMs ?? -1),
  failures: (a, b) => FAILURE_RANK[b.status] - FAILURE_RANK[a.status] || b.stats.failed - a.stats.failed || (a.stats.passRate ?? 1) - (b.stats.passRate ?? 1),
  flaky: (a, b) => Number(b.stats.flaky) - Number(a.stats.flaky) || b.stats.flips - a.stats.flips,
  runs: (a, b) => b.stats.runs - a.stats.runs,
};

/** Whether one test matches a query (everything but sorting and paging). */
export function matchesQuery(model: CatalogModel, test: TestSummary, query: TestQuery, inRun?: ReadonlySet<string> | null): boolean {
  const words = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) { const hay = model.haystacks.get(test.key) ?? ''; if (!words.every(word => hay.includes(word))) return false; }
  if (query.status?.length && !query.status.some(status => (status === 'flaky' ? test.stats.flaky : test.status === status))) return false;
  if (query.environment?.length && !query.environment.some(env => test.environments.includes(env) || (env === '(none)' && !test.environments.length))) return false;
  if (query.producer?.length && !query.producer.some(producer => test.producers.includes(producer))) return false;
  if (query.domain?.length && !query.domain.includes(test.spec?.domain || '(no spec)')) return false;
  if (query.spec?.length && !query.spec.some(path => test.specPath !== null && normalSpecPath(path) === test.specPath)) return false;
  if (query.tag?.length && !query.tag.some(tag => test.tags.includes(tag))) return false;
  if (query.artifactTag?.length && !query.artifactTag.some(tag => { const wanted = normalizeTag(tag); return wanted !== null && ((test.artifactTags?.includes(wanted) ?? false) || (query.inherited === true && (test.inheritedArtifactTags?.includes(wanted) ?? false))); })) return false;
  if (query.scope?.length && !(test.scopeProfiles ?? []).some(tokens => matchesScope(tokens, query.scope!))) return false;
  if (inRun && !inRun.has(test.key)) return false;
  return true;
}

/** The catalog document for a query: the model's summary and facets, and the matching tests, sorted and paged. */
export function testCatalog(model: CatalogModel, query: TestQuery = {}): TestCatalog {
  const inRun = query.run && model.history ? model.history.testsIn(query.run) : query.run ? new Set(model.tests.filter(test => test.outcomes.some(outcome => outcome.run === query.run)).map(test => test.key)) : null;
  const matched = model.tests.filter(test => matchesQuery(model, test, query, inRun));
  const sorter = SORTERS[query.sort ?? 'spec'] ?? SORTERS.spec;
  matched.sort((a, b) => sorter(a, b) || compareText(a.key, b.key));
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const limit = Math.min(20_000, Math.max(0, Math.floor(query.limit ?? 500)));
  return { schemaVersion: TEST_CATALOG_VERSION, version: model.version, generatedAtMs: model.generatedAtMs, summary: model.summary, facets: model.facets, total: matched.length, offset, limit, tests: matched.slice(offset, offset + limit) };
}

/** One test and its recorded results, or null when the report has no test with that key. */
export function testHistory(model: CatalogModel, key: string): TestHistoryDocument | null {
  const test = model.byKey.get(key);
  if (!test) return null;
  return { schemaVersion: TEST_CATALOG_VERSION, version: model.version, test, history: model.history?.of(key) ?? test.outcomes };
}

/** Whether a run has at least one playable video recording. */
export function hasVideo(run: Pick<RunSummary, 'videos'>): boolean {
  return (run.videos?.recordings ?? 0) > 0;
}

/**
 * Every run the history knows of, newest first, `limit` at most (default 100). With `query.video` only the runs that
 * have a playable video recording: the filter and `total` apply to every run before `limit`, and nothing is read from
 * any recording's bytes. `withVideo` always counts every run that has one.
 */
export function runList(history: TestHistory, version: string, limit = 100, query: RunQuery = {}): RunList {
  const all = history.runs();
  const withVideo = all.filter(hasVideo).length;
  const filter = forRuns(query);
  const fields = all.map(fieldsOfRun);
  const runs = all.filter((_, at) => matchesFilter(fields[at]!, filter));
  return {
    schemaVersion: TEST_CATALOG_VERSION, version, total: runs.length, runs: runs.slice(0, Math.max(0, limit)), withVideo,
    filters: usedFilters(filter), facets: facetsOf(fields, filter),
  };
}

/** What a query looks at in a run: see {@link ArtifactFilter}. A run's outcome is `failed` when any result failed. */
export function fieldsOfRun(run: RunSummary): FilterFields {
  const artifactTags = run.artifactTags ?? [];
  // A run summary of an older server has no `types`, but it says whether it has a playable video.
  const types = run.types ?? (hasVideo(run) ? ['video'] : []);
  const labels = run.labels ?? [];
  return {
    text: [run.title ?? '', run.key, run.branch ?? '', run.sha ?? '', ...run.producers, ...run.environments, ...artifactTags, ...(run.tags ?? []), ...labels].join('\n').toLowerCase(),
    artifactTags, tags: [...new Set([...(run.tags ?? []), ...artifactTags])], types, media: types.map(type => ({ type, tags: artifactTags })), labels,
    environments: run.environments, producers: run.producers, branches: run.branch ? [run.branch] : [], shas: run.sha ? [run.sha.toLowerCase()] : [],
    outcomes: [outcomeOfCounts(run.counts)], recordings: [run.recordings?.state ?? 'unknown'], at: run.endedAtMs,
  };
}

/**
 * The recorded results that carry evidence and match a query, newest first, across the whole history (`limit` default
 * 100). `total` and the facet counts apply to every match before `offset` and `limit`. `domainOf` tells the domain of a
 * spec path when the caller knows more than the layers recorded (a server with a spec set); otherwise it is the
 * recorded spec's domain, else the folder the path implies.
 *
 * @example
 * ```ts
 * const list = artifactList(history, 'v1', { artifactTag: ['demo'], type: ['video'], environment: ['ios'] });
 * list.results.map(r => [r.title, r.run, r.sha, r.status]);
 * ```
 */
export function artifactList(history: TestHistory, version: string, asked: ArtifactFilter = {}, page: { readonly limit?: number; readonly offset?: number; readonly domainOf?: (specPath: string) => string | undefined } = {}): ArtifactList {
  // Recording completeness is a property of a run: a recorded result is not asked about it.
  const query = forArtifacts(asked);
  const domains = new Map<string, string | null>();
  const domainOf = (path: string | null): string | null => {
    if (path === null) return null;
    if (!domains.has(path)) domains.set(path, (page.domainOf?.(path) ?? catalogSpec(path, known => history.specs.get(known))?.domain) || null);
    return domains.get(path)!;
  };
  const items = history.evidenceResults().map(({ result, fields }) => {
    const domain = domainOf(result.specPath);
    return { result: { ...result, domain }, fields: { ...fields, domains: domain ? [domain] : [], specs: result.specPath ? [normalSpecPath(result.specPath)] : [] } as FilterFields };
  });
  const matched = items.filter(item => matchesFilter(item.fields, query));
  const limit = Math.max(0, page.limit ?? 100);
  const offset = Math.max(0, page.offset ?? 0);
  return {
    schemaVersion: TEST_CATALOG_VERSION, version, total: matched.length, offset, limit,
    results: matched.slice(offset, offset + limit).map(item => item.result), filters: usedFilters(query), facets: facetsOf(items.map(item => item.fields), query),
  };
}

/** One run with every result it recorded, or null when no run has that key. */
export function runDetail(history: TestHistory, version: string, key: string): RunDetail | null {
  const found = history.run(key);
  return found ? { schemaVersion: TEST_CATALOG_VERSION, version, ...found } : null;
}

/** Reads a `TestQuery` from URL search parameters: `q`, `sort`, `offset`, `limit`, `run`, and repeatable or comma-separated `status`, `environment`, `producer`, `domain`, `spec`, `tag`, `artifactTag`, `scope` (every token must hold for one recording), and `inherited=1`. */
export function parseTestQuery(params: URLSearchParams): TestQuery {
  const many = (name: string) => params.getAll(name).flatMap(splitList);
  const number = (name: string) => { const value = params.get(name); return value !== null && /^\d+$/.test(value) ? Number(value) : undefined; };
  const sort = params.get('sort');
  const query: Record<string, unknown> = {};
  const q = params.get('q');
  if (q) query.q = q;
  for (const name of ['status', 'environment', 'producer', 'domain', 'spec', 'tag', 'artifactTag', 'scope']) { const values = many(name); if (values.length) query[name] = values; }
  if (['1', 'true'].includes(params.get('inherited') ?? '')) query.inherited = true;
  const run = params.get('run');
  if (run) query.run = run;
  if (sort && (TEST_SORTS as readonly string[]).includes(sort)) query.sort = sort;
  const offset = number('offset');
  const limit = number('limit');
  if (offset !== undefined) query.offset = offset;
  if (limit !== undefined) query.limit = limit;
  return query as TestQuery;
}

/** A duration for a person: `850 ms`, `12.3 s`, `4m 05s`. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');
const iso = (ms: number | null) => (ms === null ? '—' : new Date(ms).toISOString().replace('.000Z', 'Z'));
const counted = (counts: StatusCounts) => `${counts.passed} passed, ${counts.failed} failed, ${counts.running} running, ${counts['not-run']} not run`;

/** The catalog as Markdown: the summary, insights, groups and the listed tests as a table. */
export function catalogMarkdown(catalog: TestCatalog): string {
  const { summary } = catalog;
  const lines = [
    '# Tests',
    '',
    `${summary.tests} tests (${counted(summary.counts)}); ${summary.flaky} flaky; ${summary.outcomes} current results across ${summary.environments.length} environments; ${summary.runs} runs. Last recorded ${iso(summary.lastRecordedAtMs)}.`,
    summary.durations ? `Average test duration ${formatMs(summary.durations.avgMs)} (p50 ${formatMs(summary.durations.p50Ms)}, p95 ${formatMs(summary.durations.p95Ms)}) over ${summary.measured} measured tests.` : 'No test recorded a duration.',
    '',
    '## By environment',
    '',
    '| Environment | Tests | Passed | Failed | Running | Not run | Avg |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...summary.environments.map(g => `| ${cell(g.name)} | ${g.tests} | ${g.counts.passed} | ${g.counts.failed} | ${g.counts.running} | ${g.counts['not-run']} | ${formatMs(g.avgMs)} |`),
    '',
    '## By domain',
    '',
    '| Domain | Tests | Passed | Failed | Not run | Avg |',
    '|---|---:|---:|---:|---:|---:|',
    ...summary.domains.map(g => `| ${cell(g.name)} | ${g.tests} | ${g.counts.passed} | ${g.counts.failed} | ${g.counts['not-run']} | ${formatMs(g.avgMs)} |`),
  ];
  if (summary.failing.length) lines.push('', '## Failing', '', ...summary.failing.map(t => `- ${cell(t.title)} (${t.specPath ?? 'no spec'})`));
  if (summary.flakiest.length) lines.push('', '## Flaky', '', ...summary.flakiest.map(t => `- ${cell(t.title)}: ${t.value} flips (${t.specPath ?? 'no spec'})`));
  if (summary.slowest.length) lines.push('', '## Slowest', '', ...summary.slowest.map(t => `- ${cell(t.title)}: ${formatMs(t.value)} average (${t.specPath ?? 'no spec'})`));
  lines.push(
    '',
    `## Tests ${catalog.offset + 1}–${catalog.offset + catalog.tests.length} of ${catalog.total}`,
    '',
    '| Status | Test | Spec | Environments | Avg | Pass rate | Runs | Last recorded |',
    '|---|---|---|---|---:|---:|---:|---|',
    ...catalog.tests.map(t => `| ${t.status}${t.stats.flaky ? ' (flaky)' : ''} | ${cell(t.title)} | ${cell(t.spec ? `${t.spec.title} (${t.spec.path})` : '—')} | ${cell(t.outcomes.map(o => `${o.environment ?? '—'}: ${o.status}`).join(', '))} | ${formatMs(t.stats.durations?.avgMs)} | ${t.stats.passRate === null ? '—' : `${Math.round(t.stats.passRate * 100)}%`} | ${t.stats.runs} | ${iso(t.lastRecordedAtMs)} |`),
  );
  if (catalog.total > catalog.offset + catalog.tests.length) lines.push('', `More: ask again with offset=${catalog.offset + catalog.tests.length}.`);
  return `${lines.join('\n')}\n`;
}

/** One test's history as Markdown. */
export function historyMarkdown(document: TestHistoryDocument): string {
  const { test } = document;
  const d = test.stats.durations;
  return `${[
    `# ${test.title}`,
    '',
    `- Status: ${test.status}${test.stats.flaky ? ` (flaky: ${test.stats.flakyReason})` : ''}`,
    `- Spec: ${test.spec ? `${test.spec.title} (${test.spec.path}), domain ${test.spec.domain || '—'}` : 'none'}`,
    `- Id: ${test.id}`,
    `- Environments: ${test.environments.join(', ') || '—'}; producers: ${test.producers.join(', ')}`,
    `- Results: ${test.stats.results} recorded, ${test.stats.passed} passed, ${test.stats.failed} failed${test.stats.passRate === null ? '' : `, pass rate ${Math.round(test.stats.passRate * 100)}%`}, in ${test.stats.runs} runs`,
    `- Duration: ${d ? `avg ${formatMs(d.avgMs)}, p50 ${formatMs(d.p50Ms)}, p95 ${formatMs(d.p95Ms)}, min ${formatMs(d.minMs)}, max ${formatMs(d.maxMs)}, last ${formatMs(d.lastMs)}` : 'not measured'}`,
    ...(test.tags.length ? [`- Tags: ${test.tags.join(', ')}`] : []),
    ...(test.artifactTags?.length ? [`- Artifact tags: ${test.artifactTags.map(displayTag).join(', ')}`] : []),
    ...(test.scopeProfiles?.length ? [`- Recording scope: ${test.scopeProfiles.map(tokens => tokens.join(' ')).join('; ')}`] : []),
    ...(Object.keys(test.labels).length ? [`- Labels: ${Object.entries(test.labels).map(([k, v]) => `${k}=${v}`).join(', ')}`] : []),
    `- Evidence: ${test.evidence.attachments} attachments${test.evidence.roles.length ? ` (${test.evidence.roles.join(', ')})` : ''}, ${test.evidence.steps} steps`,
    '',
    '## Current results',
    '',
    '| Environment | Producer | Status | Duration | Branch | Commit | Recorded | Run |',
    '|---|---|---|---:|---|---|---|---|',
    ...test.outcomes.map(o => `| ${o.environment ?? '—'} | ${cell(o.producer)} | ${o.status} | ${formatMs(o.durationMs)} | ${cell(o.branch ?? '—')} | ${o.sha?.slice(0, 10) ?? '—'} | ${iso(o.at)} | ${o.runUrl ?? '—'} |`),
    '',
    '## History',
    '',
    '| Recorded | Environment | Status | Duration | Branch | Commit | Detail |',
    '|---|---|---|---:|---|---|---|',
    ...document.history.map(e => `| ${iso(e.at)} | ${e.environment ?? '—'} | ${e.status} | ${formatMs(e.durationMs)} | ${cell(e.branch ?? '—')} | ${e.sha?.slice(0, 10) ?? '—'} | ${cell(e.detail.split('\n')[0] ?? '')} |`),
  ].join('\n')}\n`;
}

/** Video counts in a few words: `2 (3 references)`, with how many cannot be played, or `—` when there are none. */
function videosText(videos: VideoCounts | undefined): string {
  if (!videos) return '—';
  return `${videos.recordings}${videos.references !== videos.recordings ? ` (${videos.references} references)` : ''}${videos.unavailable ? `, ${videos.unavailable} unavailable` : ''}`;
}

/** What to say beside a commit that was not recorded from a clean checkout: nothing, ` (modified)` or ` (origin unknown)`. */
function freshnessNote(freshness: 'unknown' | 'modified' | undefined): string {
  return freshness === 'modified' ? ' (modified: local changes)' : freshness === 'unknown' ? ' (origin unknown)' : '';
}

/** The run list as Markdown. */
export function runsMarkdown(list: RunList): string {
  return `${[
    `# Runs (${list.runs.length} of ${list.total})`,
    '',
    '| Ended | Branch | Commit | Environments | Tests | Passed | Failed | Not run | Span | Videos | Run |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---|---|',
    ...list.runs.map(r => `| ${iso(r.endedAtMs)} | ${cell(r.branch ?? '—')} | ${r.sha?.slice(0, 10) ?? '—'}${freshnessNote(r.freshness)} | ${r.environments.join(', ') || '—'} | ${r.tests} | ${r.counts.passed} | ${r.counts.failed} | ${r.counts['not-run']} | ${formatMs(r.spanMs)} | ${videosText(r.videos)} | ${cell(r.title ? `${r.title} (${r.key})` : r.key)} |`),
  ].join('\n')}\n`;
}

/** The artifact results as Markdown, for an agent or a terminal. */
export function artifactsMarkdown(list: ArtifactList): string {
  return `${[
    `# Artifacts (${list.results.length} of ${list.total})`,
    '',
    '| Recorded | Test | Status | Environment | Branch | Commit | Types | Tags | Videos | Run |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...list.results.map(r => `| ${iso(r.at)} | ${cell(r.title)} | ${r.status} | ${r.environment ?? '—'} | ${cell(r.branch ?? '—')} | ${r.sha?.slice(0, 10) ?? '—'} | ${r.types.join(', ') || '—'} | ${r.artifactTags.map(displayTag).join(' ') || '—'} | ${videosText(videoCounts(r.videos))} | ${cell(r.runUrl ?? r.run)} |`),
  ].join('\n')}\n`;
}

/** One run as Markdown. */
export function runMarkdown(detail: RunDetail): string {
  const { run } = detail;
  return `${[
    `# Run ${run.key}`,
    '',
    ...(run.title ? [`- Title: ${run.title}`] : []),
    `- Branch ${run.branch ?? '—'}, commit ${run.sha ?? '—'}${freshnessNote(run.freshness)}`,
    `- ${iso(run.startedAtMs)} to ${iso(run.endedAtMs)} (${formatMs(run.spanMs)}); ${run.layers} layers from ${run.producers.join(', ')}`,
    `- Environments: ${run.environments.join(', ') || '—'}`,
    `- ${run.tests} tests: ${counted(run.counts)}${run.totalDurationMs === null ? '' : `; ${formatMs(run.totalDurationMs)} of test time`}`,
    ...(run.videos ? [`- Videos: ${videosText(run.videos)}`] : []),
    '',
    '| Status | Test | Spec | Environment | Duration | Videos | Detail |',
    '|---|---|---|---|---:|---|---|',
    ...detail.results.map(r => `| ${r.status} | ${cell(r.title)} | ${cell(r.specPath ?? '—')} | ${r.environment ?? '—'} | ${formatMs(r.durationMs)} | ${videosText(videoCounts(r.videos))} | ${cell(r.detail.split('\n')[0] ?? '')} |`),
  ].join('\n')}\n`;
}
