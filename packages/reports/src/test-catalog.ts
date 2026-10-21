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
 * - `testHistory`, `runList` and `runDetail` answer for one test, every run, and one run.
 * - `catalogMarkdown`, `historyMarkdown`, `runsMarkdown` and `runMarkdown` say the same in Markdown, for an agent or a
 *   terminal.
 *
 * A test is a check identity (its spec path and id) regardless of producer, environment and parameters; each of those
 * combinations is one of its results. A result that is not `passed` is never counted as a pass, and a test with no
 * completed result has no pass rate.
 *
 * @see docs/server.md#reading-the-report-as-an-agent
 */
import type { EvidenceStatus, SpecEntry } from './explorer-types';
import type { EvidenceSummary, LayerEvidence, LayerHeader, LayerRow, StatusCounts } from './evidence-types';
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
  /** What it carried beyond its outcome (attachments, steps, retries, tags, labels), when anything. */
  readonly evidence?: EvidenceSummary;
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

/** A CI run (or any group of layers sharing a run URL, else a branch and commit): when, where, and how its tests went. */
export type RunSummary = {
  /** Stable key: the run URL, or `branch@sha`. */
  readonly key: string;
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
};

/** `GET /api/reports/runs`: runs, newest first. */
export type RunList = {
  readonly schemaVersion: typeof TEST_CATALOG_VERSION;
  readonly version: string;
  readonly total: number;
  readonly runs: readonly RunSummary[];
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
};

/** `GET /api/reports/runs/detail`: one run and every result it recorded. */
export type RunDetail = {
  readonly schemaVersion: typeof TEST_CATALOG_VERSION;
  readonly version: string;
  readonly run: RunSummary;
  readonly results: readonly RunResult[];
};

/** The run a layer belongs to: its run URL, else `branch@sha`, else `local`. Layers with the same key are one run. */
export function runKey(layer: Pick<LayerHeader, 'runUrl' | 'branch' | 'sha'>): string {
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

function entryOf(layer: LayerHeader, row: LayerRow, backend: string): TestResultEntry {
  return materialize({ o: originOf(layer, backend), s: row.status, d: row.durationMs, k: row.kind, t: row.detail, e: row.evidence });
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
type Held = { readonly o: Origin; readonly s: EvidenceStatus; readonly d: number | null; readonly k: string; readonly t: string; readonly e: EvidenceSummary | undefined };

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
    ...(held.e ? { evidence: held.e } : {}),
  };
}

/** Newest first; at the same time the more severe, then the larger layer id, so the order is total. */
function newer(a: Held, b: Held): number {
  return b.o.at - a.o.at || FAILURE_RANK[b.s] - FAILURE_RANK[a.s] || (a.o.layer < b.o.layer ? 1 : a.o.layer > b.o.layer ? -1 : a.o.place < b.o.place ? 1 : a.o.place > b.o.place ? -1 : a.k < b.k ? 1 : a.k > b.k ? -1 : 0);
}

/** What a run is told by, kept per run: small, whatever how many results it recorded. */
type RunAcc = {
  key: string; runUrl: string | null; branch: string | null; sha: string | null;
  start: number; end: number; first: string; producers: Set<string>; environments: Set<string>; layers: number;
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
  readonly #seen = new Set<string>();
  #rev = 0;
  #cells: { rev: number; byRun: Map<string, RunCell[]> } | null = null;

  /** Changes each time a layer is added. */
  get rev(): number {
    return this.#rev;
  }

  /** The specs the added layers recorded. */
  get specs(): RecordedSpecs {
    return this.#specs;
  }

  /** How many layers were added. */
  get layers(): number {
    return this.#seen.size;
  }

  /** Takes in one layer: its header, its rows, the specs it recorded and the backend it was read from. A layer id already added is ignored. */
  add(layer: LayerHeader, rows: readonly LayerRow[], specs: readonly SpecEntry[] = [], backend = layer.backend): void {
    if (this.#seen.has(layer.id)) return;
    this.#seen.add(layer.id);
    this.#rev += 1;
    this.#specs.add(specs, layer.recordedAtMs);
    const key = runKey(layer);
    let run = this.#runs.get(key);
    if (!run) {
      run = { key, runUrl: layer.runUrl, branch: layer.branch, sha: layer.sha, start: layer.recordedAtMs, end: layer.recordedAtMs, first: layer.id, producers: new Set(), environments: new Set(), layers: 0 };
      this.#runs.set(key, run);
    }
    // A run is told by its first layer (by time, then id), whatever order its layers arrive in.
    if (layer.recordedAtMs < run.start || (layer.recordedAtMs === run.start && layer.id < run.first)) {
      run.start = layer.recordedAtMs;
      run.first = layer.id;
      run.branch = layer.branch;
      run.sha = layer.sha;
    }
    run.end = Math.max(run.end, layer.recordedAtMs);
    run.producers.add(layer.producer);
    if (layer.environment) run.environments.add(layer.environment);
    run.layers += 1;
    const origin = originOf(layer, backend);
    for (const row of rows) {
      // "Still running" is progress, not history: a test running now shows it as its current outcome.
      if (row.status === 'running') continue;
      const slot = slotKey(row.specPath ?? '', row.id);
      let ident = this.#idents.get(slot);
      if (!ident) this.#idents.set(slot, ident = { slot, id: row.id, title: row.title, titledAt: layer.recordedAtMs, specPath: row.specPath });
      else if (layer.recordedAtMs > ident.titledAt || (layer.recordedAtMs === ident.titledAt && row.title > ident.title)) { ident.title = row.title; ident.titledAt = layer.recordedAtMs; }
      this.#remember(slot, { o: origin, s: row.status, d: row.durationMs, k: row.kind, t: row.detail, e: row.evidence });
    }
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
  run(key: string): { readonly run: RunSummary; readonly results: RunResult[] } | null {
    const run = this.#runs.get(key);
    if (!run) return null;
    const cells = this.#runCells().get(key) ?? [];
    const results = cells.map(({ i, r }) => ({
      key: i.slot, id: i.id, title: i.title, specPath: i.specPath, environment: r.o.environment, producer: r.o.producer,
      status: r.s, durationMs: r.d, at: r.o.at, layer: r.o.layer, detail: shortDetail(r.t),
    }));
    results.sort((a, b) => FAILURE_RANK[b.status] - FAILURE_RANK[a.status] || compareText(a.specPath ?? '', b.specPath ?? '') || compareText(a.title, b.title) || compareText(a.environment ?? '', b.environment ?? '') || compareText(a.producer, b.producer) || compareText(a.key, b.key));
    return { run: runSummary(run, cells), results };
  }

  /** The keys of the tests one run recorded. */
  testsIn(key: string): ReadonlySet<string> {
    return new Set((this.#runCells().get(key) ?? []).map(cell => cell.i.slot));
  }
}

function runSummary(run: RunAcc, cells: readonly RunCell[]): RunSummary {
  const counts = emptyCounts();
  const tests = new Set<string>();
  let total = 0, measured = false;
  const failed: RunCell[] = [];
  for (const cell of cells) {
    counts[cell.r.s] += 1;
    tests.add(cell.i.slot);
    if (cell.r.d !== null) { total += cell.r.d; measured = true; }
    if (cell.r.s === 'failed') failed.push(cell);
  }
  failed.sort((a, b) => compareText(a.i.slot, b.i.slot) || compareText(a.r.o.place, b.r.o.place) || compareText(a.r.k, b.r.k));
  const failing = failed.slice(0, 20).map(cell => ({ key: cell.i.slot, title: cell.i.title, environment: cell.r.o.environment, detail: (cell.r.t.split('\n')[0] ?? '').slice(0, 500) }));
  return {
    key: run.key, runUrl: run.runUrl, branch: run.branch, sha: run.sha,
    startedAtMs: run.start, endedAtMs: run.end, spanMs: run.end - run.start,
    producers: [...run.producers].sort(), environments: [...run.environments].sort(),
    layers: run.layers, tests: tests.size, counts, totalDurationMs: measured ? total : null, failing,
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
};

function summaryOf(slot: CheckSlot, history: TestHistory | null, known: (path: string) => SpecEntry | undefined): TestSummary {
  const outcomes = slot.outcomes.map(outcomeOf);
  const tags = new Set<string>();
  const labels: Record<string, string> = {};
  let attachments = 0, steps = 0, attempts = 0;
  const roles = new Set<string>();
  for (const outcome of outcomes) {
    const evidence = outcome.evidence;
    if (!evidence) continue;
    for (const tag of evidence.tags) tags.add(tag);
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
    labels,
    evidence: { attachments, steps, attempts, roles: [...roles].sort() },
    lastRecordedAtMs: slot.latestAtMs,
    live: slot.live,
  };
}

/** The lowercase text a search matches a test against: title, id, spec, domain, tags, labels, environments and producers. */
export function haystackOf(test: TestSummary): string {
  return [
    test.title, test.id, test.specPath ?? '', test.spec?.title ?? '', test.spec?.domain ?? '', ...test.tags,
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
    branches: facet(tests, test => test.stats.branches),
    labels: Object.fromEntries([...labelKeys].sort().map(key => [key, facet(tests, test => (test.labels[key] === undefined ? [] : [test.labels[key]!]))])),
  };
  return { version: sources.version ?? '', generatedAtMs: sources.now ?? Date.now(), tests, byKey, summary, facets, haystacks, history };
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

/** Every run the history knows of, newest first, `limit` at most (default 100). */
export function runList(history: TestHistory, version: string, limit = 100): RunList {
  const runs = history.runs();
  return { schemaVersion: TEST_CATALOG_VERSION, version, total: runs.length, runs: runs.slice(0, Math.max(0, limit)) };
}

/** One run with every result it recorded, or null when no run has that key. */
export function runDetail(history: TestHistory, version: string, key: string): RunDetail | null {
  const found = history.run(key);
  return found ? { schemaVersion: TEST_CATALOG_VERSION, version, ...found } : null;
}

/** Reads a `TestQuery` from URL search parameters: `q`, `sort`, `offset`, `limit`, `run`, and repeatable or comma-separated `status`, `environment`, `producer`, `domain`, `spec`, `tag`. */
export function parseTestQuery(params: URLSearchParams): TestQuery {
  const many = (name: string) => params.getAll(name).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
  const number = (name: string) => { const value = params.get(name); return value !== null && /^\d+$/.test(value) ? Number(value) : undefined; };
  const sort = params.get('sort');
  const query: Record<string, unknown> = {};
  const q = params.get('q');
  if (q) query.q = q;
  for (const name of ['status', 'environment', 'producer', 'domain', 'spec', 'tag']) { const values = many(name); if (values.length) query[name] = values; }
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

/** The run list as Markdown. */
export function runsMarkdown(list: RunList): string {
  return `${[
    `# Runs (${list.runs.length} of ${list.total})`,
    '',
    '| Ended | Branch | Commit | Environments | Tests | Passed | Failed | Not run | Span | Run |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---|',
    ...list.runs.map(r => `| ${iso(r.endedAtMs)} | ${cell(r.branch ?? '—')} | ${r.sha?.slice(0, 10) ?? '—'} | ${r.environments.join(', ') || '—'} | ${r.tests} | ${r.counts.passed} | ${r.counts.failed} | ${r.counts['not-run']} | ${formatMs(r.spanMs)} | ${cell(r.key)} |`),
  ].join('\n')}\n`;
}

/** One run as Markdown. */
export function runMarkdown(detail: RunDetail): string {
  const { run } = detail;
  return `${[
    `# Run ${run.key}`,
    '',
    `- Branch ${run.branch ?? '—'}, commit ${run.sha ?? '—'}`,
    `- ${iso(run.startedAtMs)} to ${iso(run.endedAtMs)} (${formatMs(run.spanMs)}); ${run.layers} layers from ${run.producers.join(', ')}`,
    `- Environments: ${run.environments.join(', ') || '—'}`,
    `- ${run.tests} tests: ${counted(run.counts)}${run.totalDurationMs === null ? '' : `; ${formatMs(run.totalDurationMs)} of test time`}`,
    '',
    '| Status | Test | Spec | Environment | Duration | Detail |',
    '|---|---|---|---|---:|---|',
    ...detail.results.map(r => `| ${r.status} | ${cell(r.title)} | ${cell(r.specPath ?? '—')} | ${r.environment ?? '—'} | ${formatMs(r.durationMs)} | ${cell(r.detail.split('\n')[0] ?? '')} |`),
  ].join('\n')}\n`;
}
