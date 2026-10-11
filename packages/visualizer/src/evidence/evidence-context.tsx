import type { ActiveRun, BackendInfo, EvidencePage, LayerEvidence, LayerHeader, LayerRows } from '@crvouga/atlas-reports/evidence-types';
import { contributes, evidenceView, type EvidenceView, type SourceSelection } from '@crvouga/atlas-reports/evidence-view';
import type { SpecEntry } from '@crvouga/atlas-reports/explorer-types';
import { combineEvidence, distinctHeaders } from '@crvouga/atlas-reports/layer-merge';
import type { ReportOutline } from '@crvouga/atlas-reports/layer-types';
import { SpecIndexSchema } from '@crvouga/atlas-schema';
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { keys, useAdapter } from '../data/queries';
import { fileName, folderOf, kindOfFile, outlinePath } from '../spec-kind';
import { useUiStore } from '../state/ui-store';
import { reportJson, staticEvidence } from './api';

/** How often the layer list is asked for while a spec run is writing results, and while nothing is. */
const LIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 15_000;

export type EvidenceState = {
  /** The layer list has been read at least once. */
  readonly ready: boolean;
  /** Why recorded results cannot be read at all, when they cannot. */
  readonly unavailable: string | null;
  readonly retry: () => void;
  /** Layers whose checks are still arriving. */
  readonly pending: number;
  /** Every distinct layer, whether or not it contributes. */
  readonly layers: readonly LayerHeader[];
  /** The layers that contribute, with their checks, once read. */
  readonly evidence: readonly LayerEvidence[];
  readonly backends: readonly BackendInfo[];
  readonly active: readonly ActiveRun[];
  readonly notices: readonly string[];
  readonly view: EvidenceView;
  /** Spec documents under the specs folder, relative to it. */
  readonly files: readonly string[];
  readonly filesPending: boolean;
  readonly filesError: boolean;
  readonly titleOf: (file: string) => string;
  readonly excluded: SourceSelection;
  readonly setExcluded: (excluded: SourceSelection) => void;
};

const EvidenceContext = createContext<EvidenceState | null>(null);

export function useEvidence() {
  const state = useContext(EvidenceContext);
  if (!state) throw new Error('useEvidence needs an EvidenceProvider');
  return state;
}

function immutable(id: string) {
  return /^[0-9a-f]{64}$/.test(id);
}

function rowsKey(layer: LayerHeader) {
  return ['evidence-rows', layer.backend, layer.id, immutable(layer.id) ? '' : layer.execution] as const;
}

/** A spec list is enough of an outline to file results under their specs when the server has none. */
function outlineOf(files: readonly string[]): ReportOutline {
  const specs: SpecEntry[] = files.map((file) => ({ path: outlinePath(file), domain: folderOf(file).split('/')[0] || 'Overview', kind: kindOfFile(file)?.id ?? 'document', title: fileName(file) }));
  return { specs, sha: null, changedFiles: [] };
}

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const adapter = useAdapter();
  const excluded = useUiStore((s) => s.excluded);
  const setExcluded = useUiStore((s) => s.setExcluded);

  const specIndex = useQuery({ queryKey: keys.specIndex, queryFn: adapter.specIndex, retry: false });
  const files = useMemo(() => {
    const parsed = SpecIndexSchema.safeParse(specIndex.data);
    return parsed.success ? parsed.data.files : [];
  }, [specIndex.data]);

  const index = useInfiniteQuery({
    queryKey: ['evidence-index'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => reportJson<EvidencePage>(`/evidence${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`, signal),
    getNextPageParam: (page) => page.cursor,
    staleTime: 0,
    retry: false,
    refetchInterval: (query) => (staticEvidence ? false : query.state.data?.pages[0]?.active.length ? LIVE_POLL_MS : IDLE_POLL_MS)
  });
  // Show the newest layers at once, then read the older pages behind them.
  const { hasNextPage, isFetching, isError, fetchNextPage } = index;
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError) void fetchNextPage();
  }, [hasNextPage, isFetching, isError, fetchNextPage]);

  const pages = index.data?.pages;
  const layers = useMemo(() => distinctHeaders(pages?.flatMap((page) => page.layers) ?? []), [pages]);
  const first = pages?.[0];
  const notices = useMemo(() => [...new Set(pages?.flatMap((page) => page.notices) ?? [])], [pages]);

  const serverOutline = useQuery({ queryKey: ['evidence-outline'], queryFn: ({ signal }) => reportJson<ReportOutline>('/outline', signal), staleTime: 30_000, retry: false });
  const outline = useMemo(() => serverOutline.data ?? outlineOf(files), [serverOutline.data, files]);

  const wanted = useMemo(() => layers.filter((layer) => contributes(layer, excluded)), [layers, excluded]);
  const rows = useQueries({
    queries: wanted.map((layer) => ({
      queryKey: rowsKey(layer),
      queryFn: ({ signal }: { signal: AbortSignal }) => reportJson<LayerRows>(`/evidence/rows/${encodeURIComponent(layer.backend)}/${encodeURIComponent(layer.id)}`, signal),
      staleTime: Number.POSITIVE_INFINITY,
      retry: 1
    })),
    combine: (results) => ({ data: results.map((result) => result.data), stamp: results.map((result) => result.dataUpdatedAt).join(',') })
  });

  // A running suite's layer is re-read as tests finish. Its last read stays on screen meanwhile.
  const last = useRef(new Map<string, LayerRows>());
  const evidence = useMemo(() => {
    const kept = new Map<string, LayerRows>();
    const loaded: LayerEvidence[] = [];
    wanted.forEach((layer, i) => {
      const key = `${layer.backend}|${layer.id}`;
      const read = rows.data[i] ?? last.current.get(key);
      if (!read) return;
      kept.set(key, read);
      loaded.push({ ...read, layer });
    });
    last.current = kept;
    return loaded;
    // `stamp` changes exactly when a layer's rows do.
  }, [wanted, rows.stamp]);

  const view = useMemo(() => evidenceView(combineEvidence(outline, evidence)), [outline, evidence]);
  const titles = useMemo(() => new Map(outline.specs.map((spec) => [spec.path, spec.title])), [outline]);

  const state: EvidenceState = {
    ready: pages !== undefined,
    unavailable: pages === undefined && index.error ? index.error.message : null,
    retry: () => {
      void reportJson<EvidencePage>('/evidence?retry=1')
        .catch(() => null)
        .then(() => Promise.all([index.refetch(), serverOutline.refetch()]));
    },
    pending: wanted.length - evidence.length,
    layers,
    evidence,
    backends: first?.backends ?? [],
    active: first?.active ?? [],
    notices,
    view,
    files,
    filesPending: specIndex.isPending,
    filesError: specIndex.isError,
    titleOf: (file) => {
      const title = titles.get(outlinePath(file));
      const name = fileName(file);
      return title && title !== name ? title : name.replace(/\.[^.]+$/, '').replace(/\.openslo$/, '');
    },
    excluded,
    setExcluded
  };
  return <EvidenceContext.Provider value={state}>{children}</EvidenceContext.Provider>;
}
