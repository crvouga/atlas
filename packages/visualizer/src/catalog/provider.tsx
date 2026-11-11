/**
 * @module UI catalog data
 *
 * The UI catalog for the catalog page, read the cheapest way the page's source allows.
 *
 * - **Through a server** that announces `catalogIndex` in the page config (and no source is excluded): the compact index the
 *   server builds (`server-catalog.ts`). The first page draws at once, the whole index follows, and results that arrive are
 *   read as a delta. The report's evidence (`/evidence/effective`) and the test catalog are not read for this page at all,
 *   and each card's pictures are read for the states on screen only ({@link useUiCatalogStates}).
 * - **Otherwise** (a static export, a store read directly, an older server, or sources left out): computed here from the
 *   layers the rest of the viewer holds (`uiCatalog` from `@crvouga/atlas/reports/ui-catalog`), as layers and `?since=` deltas
 *   arrive.
 *
 * Both give the same {@link UiCatalog} to {@link useUiCatalog}, so search, filters and sorting mean the same in both; through
 * a server, a state's cells carry their status and time but not their pictures until {@link useUiCatalogStates} reads them.
 */
import type { BackendInfo } from '@crvouga/atlas/reports/evidence-types';
import { uiCatalog, type UiCatalog, type UiCatalogState } from '@crvouga/atlas/reports/ui-catalog';
import { uiCatalogFromIndex, type UiCatalogIndex } from '@crvouga/atlas/reports/ui-catalog-index';
import { Alert, Button, Group, Text } from '@mantine/core';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useDeferredValue, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { effectiveEvidence, reportJson, staticEvidence } from '../evidence/api';
import { useEvidence } from '../evidence/evidence-context';
import { plural } from '../evidence/format';
import { liveInvalidator } from '../live/live-query';
import { eventsAddress, listenLive, useLiveStatus } from '../live/live-stream';
import { runtimeConfig } from '../runtime';
import { useUiStore } from '../state/ui-store';
import { readFirstIndexPage, readFullCatalog, readIndex, readStates, STATES_PER_READ, withEvidence } from './server-catalog';

/** How the catalog page's data stands, in the terms the page shows. */
export type UiCatalogStatus = {
  /** `server`: read through the server's index. `local`: composed in the browser from the layers held. */
  readonly source: 'server' | 'local';
  /** Something of the catalog has been read. */
  readonly ready: boolean;
  /** Why nothing of the catalog can be read, when nothing can. */
  readonly unavailable: string | null;
  readonly retry: () => void;
  /** Layers still being read (local only). */
  readonly pending: number;
  readonly backends: readonly BackendInfo[];
  readonly notices: readonly string[];
  /** While only part of the catalog is held (the first page, or the rest could not be read): how much. Counts and search then cover only that part. */
  readonly partial: { readonly loaded: number; readonly total: number; readonly error: string | null } | null;
  /** The catalog held could not be brought up to date; it is shown as last read. */
  readonly stale: string | null;
};

type CatalogValue = { readonly catalog: UiCatalog | null; readonly status: UiCatalogStatus; readonly fingerprints: ReadonlyMap<string, string> | null };

const CatalogContext = createContext<CatalogValue | null>(null);

/** The effective report is revalidated cheaply; as often as the evidence of other pages is. */
const POLL_MS = 5_000;
/** While the server's stream is open it says when to read again; this is only the safety net behind it. */
const LIVE_SAFETY_POLL_MS = 60_000;
/** At most this often is the index read again because the server said the report changed. */
const LIVE_REREAD_MS = 250;
const INDEX_KEY = ['ui-catalog-index'] as const;

/**
 * Whether the catalog page reads its catalog through the server: the server announced the index (`catalogIndex` in the page
 * config, so an older server is never asked for it), the viewer reads the effective report, and no source is left out (which
 * needs the history behind it, composed in the browser).
 */
export function useServerCatalog(): boolean {
  const excluded = useUiStore((s) => s.excluded);
  return runtimeConfig()?.catalogIndex === true && effectiveEvidence() && !staticEvidence && !Object.values(excluded).some((list) => list.length > 0);
}

function useServerIndex(enabled: boolean) {
  const client = useQueryClient();
  const streaming = useLiveStatus() === 'live';
  useEffect(() => {
    const url = eventsAddress();
    if (!enabled || !url) return;
    const refresh = liveInvalidator(client, INDEX_KEY, LIVE_REREAD_MS);
    const stop = listenLive(url, (event) => {
      if (event.type === 'report' || event.type === 'open' || (event.type === 'change' && event.change.scope === 'runs' && !event.change.liveRunId)) refresh();
    });
    return () => { stop(); refresh.cancel(); };
  }, [client, enabled]);
  const whole = useQuery({
    queryKey: INDEX_KEY,
    enabled,
    queryFn: ({ signal }) => readIndex(reportJson, client.getQueryData<UiCatalogIndex>(INDEX_KEY), signal),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: 'always',
    refetchInterval: streaming ? LIVE_SAFETY_POLL_MS : POLL_MS
  });
  // The first page draws the first cards while the whole index is read; once that is held, it is not asked for again.
  const first = useQuery({ queryKey: ['ui-catalog-index-first'], enabled: enabled && whole.data === undefined, queryFn: ({ signal }) => readFirstIndexPage(reportJson, signal), staleTime: Number.POSITIVE_INFINITY, retry: false });
  return { whole, first };
}

/** Provides the catalog to its children, only while `enabled` (the catalog page is open): other pages pay nothing. */
export function UiCatalogProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const server = useServerCatalog();
  const held = useEvidence();
  const { whole, first } = useServerIndex(enabled && server);
  const index = whole.data ?? first.data;
  const fromServer = useMemo(() => (index ? uiCatalogFromIndex(index) : null), [index]);
  const fingerprints = useMemo(() => (index ? new Map(index.states.map((state) => [state.id, state.fingerprint])) : null), [index]);

  const local = enabled && !server;
  const { backends, notices, version } = held;
  // While layers stream in, the catalog is rebuilt for the newest layers only when the page has nothing more urgent to do, so typing a
  // filter or scrolling is never held up by a layer that has just arrived.
  const evidence = useDeferredValue(held.evidence);
  const composed = useMemo(() => (local ? uiCatalog(evidence, { backends, notices, ...(version ? { version } : {}) }) : null), [local, evidence, backends, notices, version]);

  const value = useMemo((): CatalogValue => {
    if (!server) return {
      catalog: composed, fingerprints: null,
      status: { source: 'local', ready: held.ready, unavailable: held.unavailable, retry: held.retry, pending: held.pending, backends, notices, partial: null, stale: null }
    };
    const failed = whole.error && !whole.data ? whole.error.message : null;
    return {
      catalog: enabled ? fromServer : null, fingerprints,
      status: {
        source: 'server', ready: !!index, pending: 0,
        unavailable: !index && (whole.error ?? first.error) ? (whole.error ?? first.error)!.message : null,
        retry: () => { void whole.refetch(); if (!whole.data) void first.refetch(); },
        backends: index?.sources.backends ?? [], notices: index?.sources.notices ?? [],
        partial: index && !whole.data ? { loaded: index.states.length, total: index.total, error: failed } : null,
        stale: whole.data && whole.error ? whole.error.message : null
      }
    };
  }, [server, enabled, composed, held.ready, held.unavailable, held.retry, held.pending, backends, notices, whole, first, index, fromServer, fingerprints]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

/** The whole catalog (before the address's filters), or null when the catalog page is not open. */
export function useUiCatalog(): UiCatalog | null {
  return useContext(CatalogContext)?.catalog ?? null;
}

const NO_STATUS: UiCatalogStatus = { source: 'local', ready: false, unavailable: null, retry: () => {}, pending: 0, backends: [], notices: [], partial: null, stale: null };

/** How the catalog's data stands: read, partly read, unavailable or out of date, and what could not be read. */
export function useUiCatalogStatus(): UiCatalogStatus {
  return useContext(CatalogContext)?.status ?? NO_STATUS;
}

/**
 * The states with their evidence (pictures, attachments, origins, plans), for the states a page draws. Composed in the
 * browser, a state already has it. Through a server, it is read for these states only, a few at a time, and read again when
 * a state changes; `get` gives a state as it can be drawn now, and `pending` says its evidence is still being read.
 */
export function useUiCatalogStates(states: readonly UiCatalogState[]): { readonly get: (state: UiCatalogState) => UiCatalogState; readonly pending: (state: UiCatalogState) => boolean; readonly failed: number; readonly retry: () => void } {
  const value = useContext(CatalogContext);
  const fingerprints = value?.fingerprints ?? null;
  const ids = useMemo(() => (fingerprints ? states.map((state) => state.id) : []), [fingerprints, states]);
  const chunks = useMemo(() => {
    const groups: string[][] = [];
    for (let at = 0; at < ids.length; at += STATES_PER_READ) groups.push(ids.slice(at, at + STATES_PER_READ));
    return groups;
  }, [ids]);
  const reads = useQueries({
    queries: chunks.map((chunk) => ({
      // A state's fingerprint is in the key, so one that changed is read again and one that did not is not.
      queryKey: ['ui-catalog-states', chunk.map((id) => `${id}\u0000${fingerprints?.get(id) ?? ''}`)],
      queryFn: ({ signal }: { signal: AbortSignal }) => readStates(reportJson, chunk, signal),
      staleTime: Number.POSITIVE_INFINITY,
      retry: 1
    })),
    combine: (results) => ({ maps: results.map((result) => result.data), failed: results.filter((result) => result.isError && !result.data).length, stamp: results.map((result) => result.dataUpdatedAt).join(','), retry: () => results.forEach((result) => { if (result.isError) void result.refetch(); }) })
  });
  // A state that changed is read again; until it arrives, its last evidence stays on screen rather than a placeholder.
  const last = useRef(new Map<string, UiCatalogState>());
  return useMemo(() => {
    if (!fingerprints) return { get: (state) => state, pending: () => false, failed: 0, retry: () => {} };
    const loaded = new Map<string, UiCatalogState>();
    for (const map of reads.maps) for (const [id, state] of map ?? []) loaded.set(id, state);
    for (const [id, state] of loaded) last.current.set(id, state);
    const known = (id: string) => loaded.get(id) ?? last.current.get(id);
    return { get: (state) => withEvidence(state, known(state.id)), pending: (state) => !known(state.id) && reads.failed === 0, failed: reads.failed, retry: reads.retry };
    // `stamp` changes exactly when a read does.
  }, [fingerprints, reads.stamp, reads.failed]);
}

/** What the page says while only part of the catalog is held, or what is held could not be brought up to date. */
export function CatalogLoadNotice() {
  const status = useUiCatalogStatus();
  const { partial, stale } = status;
  return (
    <>
      {partial && !partial.error && (
        <Text role="status" c="dimmed" size="sm" data-catalog-partial>
          Showing what has arrived: {partial.loaded} of {plural(partial.total, 'state', 'states')} so far. Counts and search cover only these until the rest is read.
        </Text>
      )}
      {partial?.error && (
        <Alert role="alert" color="orange" title="Part of the catalog could not be read" data-catalog-partial>
          <Group gap="sm">
            <Text span inherit>Counts and search cover only the {partial.loaded} of {plural(partial.total, 'state', 'states')} that were read. {partial.error}</Text>
            <Button type="button" variant="subtle" onClick={status.retry}>Try again</Button>
          </Group>
        </Alert>
      )}
      {stale && (
        <Alert role="status" color="orange" title="The catalog could not be brought up to date">
          <Group gap="sm">
            <Text span inherit>It is shown as it was last read. {stale}</Text>
            <Button type="button" variant="subtle" onClick={status.retry}>Try again</Button>
          </Group>
        </Alert>
      )}
    </>
  );
}

/**
 * A catalog with every state's evidence, for what compares pictures across the whole of it (a comparison of two profiles).
 * Composed in the browser, that is the catalog itself. Through a server, the full document is read once, only while
 * `enabled`, and narrowed to the states and cells of `shown`; `catalog` is null until it arrives.
 */
export function useFullUiCatalog(shown: UiCatalog, enabled = true): { readonly catalog: UiCatalog | null; readonly error: string | null; readonly retry: () => void } {
  const server = useContext(CatalogContext)?.status.source === 'server';
  const read = useQuery({
    queryKey: ['ui-catalog-full', shown.version ?? '', shown.scope?.kind ?? '', shown.scope?.definition?.version ?? '', shown.states.length],
    enabled: server && enabled,
    queryFn: ({ signal }) => readFullCatalog(reportJson, shown, signal),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
  if (!server) return { catalog: shown, error: null, retry: () => {} };
  return { catalog: read.data ?? null, error: read.error ? read.error.message : null, retry: () => void read.refetch() };
}
