/**
 * @module UI catalog history
 *
 * What a comparison of two commits needs and the report the viewer holds does not: the layers of an earlier commit. A newer layer
 * replaces the older one of its slot, so the effective report keeps only the newest capture of every state. The layer list
 * (`/evidence`) and a layer's rows (`/evidence/rows/<backend>/<id>`) still hold the rest, and are read here only while a
 * comparison is open: the list once, and the rows of the layers of the commits being compared. The rows share their cache with the
 * rest of the viewer, so a layer is never read twice.
 */
import type { EvidencePage, LayerEvidence, LayerHeader, LayerRows } from '@crvouga/atlas/reports/evidence-types';
import { distinctHeaders } from '@crvouga/atlas/reports/layer-merge';
import { uiCatalog, type UiCatalog } from '@crvouga/atlas/reports/ui-catalog';
import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { reportJson } from '../evidence/api';
import { rowsKey } from '../evidence/evidence-context';

/** Every layer header the stores hold (superseded layers included), read page by page while `enabled`. */
export function useLayerHeaders(enabled: boolean): { readonly headers: readonly LayerHeader[]; readonly loading: boolean; readonly error: string | null; readonly retry: () => void } {
  const index = useInfiniteQuery({
    queryKey: ['catalog-layers'],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => reportJson<EvidencePage>(`/evidence${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`, signal),
    getNextPageParam: (page) => page.cursor,
    staleTime: 30_000,
    retry: false
  });
  const { hasNextPage, isFetching, isError, fetchNextPage } = index;
  useEffect(() => {
    if (enabled && hasNextPage && !isFetching && !isError) void fetchNextPage();
  }, [enabled, hasNextPage, isFetching, isError, fetchNextPage]);
  const pages = index.data?.pages;
  const headers = useMemo(() => distinctHeaders(pages?.flatMap((page) => page.layers) ?? []), [pages]);
  return { headers, loading: enabled && (index.isPending || hasNextPage), error: index.error ? index.error.message : null, retry: () => void index.refetch() };
}

/** The catalog recorded at one commit, from the rows of that commit's layers. `pending` layers are still being read; `failed` ones could not be read and are absent from the catalog. */
export function useCommitCatalog(headers: readonly LayerHeader[], sha: string | undefined): { readonly catalog: UiCatalog | null; readonly pending: number; readonly failed: readonly LayerHeader[] } {
  const wanted = useMemo(() => (sha ? headers.filter((layer) => layer.sha === sha && layer.freshness !== 'modified') : []), [headers, sha]);
  const rows = useQueries({
    queries: wanted.map((layer) => ({
      queryKey: rowsKey(layer),
      queryFn: ({ signal }: { signal: AbortSignal }) => reportJson<LayerRows>(`/evidence/rows/${encodeURIComponent(layer.backend)}/${encodeURIComponent(layer.id)}`, signal),
      staleTime: Number.POSITIVE_INFINITY,
      retry: 1
    })),
    combine: (results) => ({ data: results.map((result) => result.data), failed: results.map((result) => result.isError && result.data === undefined), stamp: results.map((result) => result.dataUpdatedAt).join(',') })
  });
  return useMemo(() => {
    const loaded: LayerEvidence[] = [];
    wanted.forEach((layer, i) => {
      const read = rows.data[i];
      if (read) loaded.push({ ...read, layer });
    });
    const failed = wanted.filter((_, i) => rows.failed[i]);
    return { catalog: sha ? uiCatalog(loaded) : null, pending: Math.max(0, wanted.length - loaded.length - failed.length), failed };
    // `stamp` changes exactly when a layer's rows do.
  }, [wanted, rows.stamp, sha]);
}
