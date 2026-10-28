/**
 * @module Test catalog source
 *
 * One way for the explorer to read the tests, wherever the viewer runs:
 *
 * - On an Atlas server (the effective report) it asks the server, which holds every layer's history:
 *   `GET {reports}/tests`, `/tests/history`, `/runs` and `/runs/detail`. The catalog is read whole (`limit=20000`)
 *   once per report version, so filtering and searching happen in the page, as you type.
 * - Anywhere else (local folders, a static site), or while the server is starting, or when it is an older one without
 *   those routes, the same documents are built here from the layers the viewer already read (`TestHistory` and
 *   `catalogModel` from `@crvouga/atlas/reports/test-catalog`).
 *
 * The UI only sees {@link useTestCatalog}, {@link useTestHistory}, {@link useRunList} and {@link useRunDetail}.
 * Tests a producer reports as running right now (live progress) are shown as running on top of either source.
 */
import type { EvidenceStatus } from '@crvouga/atlas/reports/explorer-types';
import type { LayerEvidence, LayerRows, StatusCounts } from '@crvouga/atlas/reports/evidence-types';
import type { CheckSlot, EvidenceView } from '@crvouga/atlas/reports/evidence-view';
import {
  facetsOf,
  filterParams,
  forRuns,
  matchesFilter,
  usedFilters,
  type ArtifactFilter,
  type FilterName,
  type QueryFacets
} from '@crvouga/atlas/reports/artifact-query';
import {
  artifactList,
  catalogModel,
  fieldsOfRun,
  haystackOf,
  runDetail,
  runList,
  testHistory,
  TestHistory,
  type ArtifactList,
  type CatalogModel,
  type RunDetail,
  type RunList,
  type TestCatalog,
  type TestHistoryDocument,
  type TestSummary
} from '@crvouga/atlas/reports/test-catalog';
import { isStatechartFile } from '@crvouga/atlas/schema';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { reportJson, ReportsError } from '../evidence/api';
import { useEvidence } from '../evidence/evidence-context';

/** How many runs the Runs tab lists. */
export const RUNS_SHOWN = 500;
/** How many recorded results the Artifacts tab lists. */
export const ARTIFACTS_SHOWN = 200;
/** The server's catalog is read again at most this often while results keep arriving. */
const SERVER_REREAD_MS = 5_000;
/** Layers read one after another are folded into the page's catalog at most this often. */
const PAGE_REBUILD_MS = 300;

/** What the explorer reads its tests from. */
export type CatalogState = {
  /** Every test, with live progress applied; null until there is something to show. */
  readonly model: CatalogModel | null;
  /** `server`: the server's catalog and history. `page`: built from the layers this page read. */
  readonly source: 'server' | 'page';
  /** Changes whenever the catalog does; part of every query key that depends on it. */
  readonly version: string;
  /** Why the server's catalog could not be read, when it could not (the page's own is shown meanwhile). */
  readonly notice: string | null;
};

const CatalogContext = createContext<CatalogState | null>(null);

/** The tests of the report, from the server or from the page. Needs a {@link TestCatalogProvider}. */
export function useTestCatalog(): CatalogState {
  const state = useContext(CatalogContext);
  if (!state) throw new Error('useTestCatalog needs a TestCatalogProvider');
  return state;
}

/** A value that follows `value`, at most once per `ms` (always ending on the newest). */
function useThrottled<T>(value: T, ms: number): T {
  const [held, setHeld] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    if (Object.is(held, value)) return;
    const wait = Math.max(0, last.current + ms - Date.now());
    const timer = setTimeout(() => {
      last.current = Date.now();
      setHeld(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, held, ms]);
  return held;
}

/** A server's catalog document as a model the page can query (`matchesQuery`, `testCatalog`). It has no history of its own. */
export function modelFromCatalog(catalog: TestCatalog): CatalogModel {
  return {
    version: catalog.version,
    generatedAtMs: catalog.generatedAtMs,
    tests: catalog.tests,
    byKey: new Map(catalog.tests.map((test) => [test.key, test])),
    summary: catalog.summary,
    facets: catalog.facets,
    haystacks: new Map(catalog.tests.map((test) => [test.key, haystackOf(test)])),
    history: null
  };
}

function allSlots(view: EvidenceView): CheckSlot[] {
  return [...[...view.specs.values()].flatMap((entry) => entry.slots), ...view.unassigned];
}

function liveOnly(slot: CheckSlot, model: CatalogModel): TestSummary {
  const spec = slot.specPath ? model.facets.specs.find((entry) => entry.path === slot.specPath) ?? null : null;
  return {
    key: slot.key, id: slot.id, title: slot.title, specPath: slot.specPath,
    spec: spec ? { path: spec.path, title: spec.title, domain: spec.domain, kind: spec.kind } : null,
    status: slot.status, environments: [], producers: [], outcomes: [],
    stats: { results: 0, passed: 0, failed: 0, passRate: null, flaky: false, flakyReason: '', flips: 0, durations: null, firstSeenMs: null, lastSeenMs: null, lastPassedAtMs: null, lastFailedAtMs: null, runs: 0, branches: [] },
    tags: [], labels: {}, evidence: { attachments: 0, steps: 0, attempts: 0, roles: [] }, lastRecordedAtMs: slot.latestAtMs, live: slot.live
  };
}

/**
 * The model with live progress applied: a test a producer is running right now shows as running (and one that only
 * exists as live progress is listed), as the rest of the viewer shows it. Recorded results are not changed.
 */
export function withLiveProgress(model: CatalogModel, view: EvidenceView): CatalogModel {
  const changed = new Map<string, TestSummary>();
  const added: TestSummary[] = [];
  for (const slot of allSlots(view)) {
    const test = model.byKey.get(slot.key);
    if (!test) {
      if (!slot.outcomes.length && (slot.status === 'running' || slot.live)) added.push(liveOnly(slot, model));
      continue;
    }
    if ((slot.status === 'running') !== (test.status === 'running') || slot.live !== test.live) {
      // Live progress can only say "running now" or that a run was cut short; a recorded result is never rewritten otherwise.
      if (slot.status === 'running' || test.status === 'running') changed.set(test.key, { ...test, status: slot.status === 'running' ? 'running' : slot.status, live: slot.live });
    }
  }
  if (!changed.size && !added.length) return model;
  const tests = [...model.tests.map((test) => changed.get(test.key) ?? test), ...added];
  const counts: Record<EvidenceStatus, number> = { passed: 0, failed: 0, running: 0, 'not-run': 0 };
  for (const test of tests) counts[test.status] += 1;
  return {
    ...model,
    tests,
    byKey: new Map(tests.map((test) => [test.key, test])),
    haystacks: added.length ? new Map([...model.haystacks, ...added.map((test) => [test.key, haystackOf(test)] as const)]) : model.haystacks,
    summary: { ...model.summary, tests: tests.length, counts: counts as StatusCounts }
  };
}

type PageHistory = { readonly history: TestHistory; readonly stamp: string };
let generation = 0;

/**
 * The history of the layers this page read. Layers that arrive later are added to the same history; when a layer
 * was dropped (a source left out) or re-read (a running suite), it is built again.
 */
function usePageHistory(layers: readonly LayerEvidence[] | null): PageHistory | null {
  const held = useRef<{ history: TestHistory; rows: Map<string, LayerRows['rows']>; gen: number } | null>(null);
  return useMemo(() => {
    if (!layers) return null;
    let current = held.current;
    const next = new Map(layers.map((entry) => [`${entry.layer.backend}|${entry.layer.id}`, entry.rows]));
    const keeps = current !== null && [...current.rows].every(([key, rows]) => next.get(key) === rows);
    if (!current || !keeps) {
      current = { history: new TestHistory(), rows: new Map(), gen: ++generation };
      held.current = current;
    }
    for (const entry of layers) {
      const key = `${entry.layer.backend}|${entry.layer.id}`;
      if (current.rows.has(key)) continue;
      current.rows.set(key, entry.rows);
      current.history.add(entry.layer, entry.rows, [], entry.layer.backend);
    }
    return { history: current.history, stamp: `page:${current.gen}:${current.history.rev}` };
  }, [layers]);
}

/** Reads the catalog for everything below it: from the server when it has one, else from the page. */
export function TestCatalogProvider({ children }: { children: ReactNode }) {
  const evidence = useEvidence();
  const enabled = evidence.ready && !evidence.files.some(isStatechartFile);
  const version = useThrottled(evidence.version, SERVER_REREAD_MS);
  // A server without the catalog routes (an older one) answers 404: stop asking until the page is reloaded.
  const [unsupported, setUnsupported] = useState(false);
  const server = useQuery({
    queryKey: ['test-catalog', version],
    queryFn: ({ signal }) => reportJson<TestCatalog>('/tests?limit=20000', signal),
    enabled: enabled && evidence.effective && version !== null && !unsupported,
    placeholderData: keepPreviousData,
    staleTime: Number.POSITIVE_INFINITY,
    // A server still starting answers 503: ask again shortly. Any other answer (an older server has no such route) is final.
    retry: (count, error) => error instanceof ReportsError && error.status === 503 && count < 30,
    retryDelay: 2_000
  });
  useEffect(() => {
    if (server.error instanceof ReportsError && server.error.status === 404) setUnsupported(true);
  }, [server.error]);
  const fromServer = evidence.effective && !unsupported && server.data !== undefined;
  const layers = useThrottled(evidence.evidence, PAGE_REBUILD_MS);
  const page = usePageHistory(enabled && !fromServer ? layers : null);
  const serverModel = useMemo(() => (server.data ? modelFromCatalog(server.data) : null), [server.data]);
  const pageModel = useMemo(
    () => (page ? catalogModel(layers, { history: page.history, specs: evidence.specs, version: page.stamp }) : null),
    // `page.stamp` changes exactly when the history (and so the layers in it) does.
    [page?.stamp, evidence.specs]
  );
  const base = fromServer ? serverModel : pageModel;
  const model = useMemo(() => (base ? withLiveProgress(base, evidence.view) : null), [base, evidence.view]);
  const state: CatalogState = {
    model,
    source: fromServer ? 'server' : 'page',
    version: fromServer ? `server:${server.data!.version}:${version ?? ''}` : page?.stamp ?? 'none',
    notice: evidence.effective && server.isError && !(server.error instanceof ReportsError && server.error.status === 404) ? server.error.message : null
  };
  return <CatalogContext.Provider value={state}>{children}</CatalogContext.Provider>;
}

const notFound = (error: unknown) => error instanceof ReportsError && error.status === 404;

/** One test and its recorded results (newest first), or null when the report has no such test. */
export function useTestHistory(key: string | undefined) {
  const catalog = useTestCatalog();
  return useQuery({
    queryKey: ['test-history', catalog.version, key ?? ''],
    queryFn: async ({ signal }): Promise<TestHistoryDocument | null> => {
      const model = catalog.model!;
      if (catalog.source === 'page') return testHistory(model, key!);
      try {
        return await reportJson<TestHistoryDocument>(`/tests/history?key=${encodeURIComponent(key!)}`, signal);
      } catch (error) {
        // A test only seen as live progress has no recorded history on the server yet.
        if (notFound(error)) return testHistory(model, key!);
        throw error;
      }
    },
    enabled: !!key && catalog.model !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
}

/** The runs a query matched, and what this server could not do about it. */
export type RunsAnswer = RunList & {
  /** What the viewer's query asks for that the answer does not reflect: filters an older server ignores and the viewer cannot apply itself (tags, types, labels need data it does not send). Say so; never present the list as narrowed by them. */
  readonly notApplied: readonly FilterName[];
  /** The values each dimension offers, from the server or worked out from the runs it sent. */
  readonly facets: QueryFacets;
};

/** What an older server's run summary can answer by itself: the viewer filters its complete list for these. */
const ANSWERABLE_HERE: ReadonlySet<FilterName> = new Set(['q', 'environment', 'producer', 'branch', 'sha', 'outcome', 'since', 'until', 'video']);

/**
 * Makes a server's answer honest about the filters it did not apply (an older server ignores parameters it does not know
 * and answers with every run). Those the run summary can answer are applied here, to the complete list; the rest are
 * reported in `notApplied` so the page can say the list is not narrowed by them.
 */
export function runsAnswer(list: RunList, filter: ArtifactFilter): RunsAnswer {
  const asked = usedFilters(forRuns(filter)).filter((name) => name !== 'inherited');
  // A server that predates `filters` but has `withVideo` already filtered by `video`.
  const applied = new Set<FilterName>(list.filters ?? (list.withVideo !== undefined ? ['video'] : []));
  const missing = asked.filter((name) => !applied.has(name));
  if (!missing.length && list.facets) return { ...list, facets: list.facets, notApplied: [] };
  const here = missing.filter((name) => ANSWERABLE_HERE.has(name));
  const sub = Object.fromEntries(here.map((name) => [name, filter[name]])) as ArtifactFilter;
  const runs = here.length ? list.runs.filter((run) => matchesFilter(fieldsOfRun(run), sub)) : list.runs;
  return {
    ...list,
    total: here.length ? runs.length : list.total,
    runs,
    facets: list.facets ?? facetsOf(list.runs.map(fieldsOfRun), sub),
    notApplied: missing.filter((name) => !ANSWERABLE_HERE.has(name))
  };
}

/**
 * CI runs, newest first, narrowed by a query (see `artifact-query.ts`). The server filters every run before it pages
 * them, so counts are the whole dataset's; a server that does not know a filter is handled by {@link runsAnswer}.
 */
export function useRunList(enabled = true, filter: ArtifactFilter = {}) {
  const catalog = useTestCatalog();
  const query = forRuns(filter);
  const key = filterParams(query).toString();
  return useQuery({
    queryKey: ['test-runs', catalog.version, key],
    queryFn: async ({ signal }): Promise<RunsAnswer> => {
      if (catalog.source === 'server') {
        const params = filterParams(query);
        params.set('limit', String(RUNS_SHOWN));
        return runsAnswer(await reportJson<RunList>(`/runs?${params}`, signal), query);
      }
      const history = catalog.model?.history;
      const list = history ? runList(history, catalog.version, RUNS_SHOWN, query) : { schemaVersion: 1 as const, version: catalog.version, total: 0, runs: [] };
      return runsAnswer(list, query);
    },
    enabled: enabled && catalog.model !== null,
    placeholderData: keepPreviousData,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
}

/** The recorded results that carry evidence and match a query, or `unsupported` when the server has no artifact search. */
export type ArtifactsAnswer = { readonly unsupported: false; readonly list: ArtifactList } | { readonly unsupported: true };

/**
 * Recorded results that carry evidence (recordings, screenshots, traces) across the whole history, newest first. A
 * server without `/artifacts` (an older one) answers `unsupported`, and the page says so instead of showing an empty list.
 */
export function useArtifactList(filter: ArtifactFilter, enabled = true) {
  const catalog = useTestCatalog();
  const key = filterParams(filter).toString();
  return useQuery({
    queryKey: ['test-artifacts', catalog.version, key],
    queryFn: async ({ signal }): Promise<ArtifactsAnswer> => {
      if (catalog.source === 'server') {
        const params = filterParams(filter);
        params.set('limit', String(ARTIFACTS_SHOWN));
        try {
          return { unsupported: false, list: await reportJson<ArtifactList>(`/artifacts?${params}`, signal) };
        } catch (error) {
          if (notFound(error)) return { unsupported: true };
          throw error;
        }
      }
      const model = catalog.model!;
      const domains = new Map(model.facets.specs.map((spec) => [spec.path, spec.domain]));
      const history = model.history;
      if (!history) return { unsupported: true };
      return { unsupported: false, list: artifactList(history, catalog.version, filter, { limit: ARTIFACTS_SHOWN, domainOf: (path) => domains.get(path) }) };
    },
    enabled: enabled && catalog.model !== null,
    placeholderData: keepPreviousData,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
}

/** One CI run and every result it recorded, or null when no run has that key. */
export function useRunDetail(key: string | undefined) {
  const catalog = useTestCatalog();
  return useQuery({
    queryKey: ['test-run', catalog.version, key ?? ''],
    queryFn: async ({ signal }): Promise<RunDetail | null> => {
      if (catalog.source === 'page') {
        const history = catalog.model?.history;
        return history ? runDetail(history, catalog.version, key!) : null;
      }
      try {
        return await reportJson<RunDetail>(`/runs/detail?key=${encodeURIComponent(key!)}`, signal);
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    enabled: !!key && catalog.model !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
}
