/**
 * @module Pinned result
 *
 * Opening a test from a run, or choosing an earlier run in its history, pins the detail to one exact layer: the
 * `layer` parameter of the explorer's address. This finds that layer's own record of the open check, wherever the
 * viewer holds it: in the evidence it already read, or, on a server that sends only the winners, from the layer
 * itself. A layer that cannot be found is reported as missing, never replaced by another result.
 */
import { checkHistory, type HistoryEntry } from '@crvouga/atlas/reports/evidence-view';
import type { EvidencePage, LayerHeader, LayerRows } from '@crvouga/atlas/reports/evidence-types';
import { isDiagnosticKind, slotKey } from '@crvouga/atlas/reports/layer-merge';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { reportJson } from '../evidence/api';
import { useEvidence } from '../evidence/evidence-context';

/** What the viewer knows of the pinned result. `none` when nothing is pinned. */
export type PinnedResult =
  | { readonly state: 'none' }
  | { readonly state: 'loading' }
  | { readonly state: 'missing'; readonly reason: string }
  | { readonly state: 'ready'; readonly entry: HistoryEntry };

/** The most layer-header pages read looking for a pinned layer on a server. */
const MAX_PAGES = 200;

/** A test key (`TestSummary.key`) as the spec path and check id it names, or null when it is not one. */
export function checkOfKey(key: string): { path: string | null; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') return { path: parsed[0] || null, id: parsed[1] };
  } catch {
    /* not a check key */
  }
  return null;
}

/** One layer's record of one check, preferring a verdict over a timing, as `checkHistory` does. */
function recordOf(layer: LayerHeader, rows: LayerRows, key: string): HistoryEntry | null {
  const own = rows.rows.filter((row) => slotKey(row.specPath ?? '', row.id) === key);
  const row = own.find((candidate) => !isDiagnosticKind(candidate.kind)) ?? own[0];
  return row ? { layer, row } : null;
}

async function readLayer(layerId: string, key: string, signal: AbortSignal): Promise<HistoryEntry> {
  let cursor: string | null = null;
  let header: LayerHeader | undefined;
  for (let page = 0; page < MAX_PAGES && !header; page++) {
    const read: EvidencePage = await reportJson<EvidencePage>(`/evidence${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, signal);
    header = read.layers.find((layer) => layer.id === layerId);
    cursor = read.cursor;
    if (!cursor) break;
  }
  if (!header) throw new Error('That run is not in the report any more. Its source may be switched off or have expired.');
  const rows = await reportJson<LayerRows>(`/evidence/rows/${encodeURIComponent(header.backend)}/${encodeURIComponent(header.id)}`, signal);
  const entry = recordOf(header, rows, key);
  if (!entry) throw new Error('That run no longer holds a result for this test.');
  return entry;
}

/**
 * The record of the check `testKey` made by the layer `layerId`.
 *
 * @param layerId - The pinned layer (the `layer` address parameter), or undefined for the latest combined evidence.
 * @param testKey - The open test's key.
 * @returns `none` without a layer, `loading` while it is being found, `ready` with its entry, or `missing` with why.
 */
export function usePinnedResult(layerId: string | undefined, testKey: string): PinnedResult {
  const { evidence, effective, ready, pending, unavailable } = useEvidence();
  const check = useMemo(() => checkOfKey(testKey), [testKey]);
  const local = useMemo(
    () => (layerId && check ? checkHistory(evidence, check.path, check.id).find((entry) => entry.layer.id === layerId) : undefined),
    [evidence, layerId, check]
  );
  const remote = useQuery({
    queryKey: ['pinned-result', layerId ?? '', testKey],
    queryFn: ({ signal }) => readLayer(layerId!, testKey, signal),
    enabled: !!layerId && !local && effective && ready,
    staleTime: 5 * 60_000,
    retry: false
  });
  if (!layerId) return { state: 'none' };
  if (local) return { state: 'ready', entry: local };
  if (unavailable) return { state: 'missing', reason: unavailable };
  if (!ready) return { state: 'loading' };
  if (!effective) return pending > 0 ? { state: 'loading' } : { state: 'missing', reason: 'That run is not in the report any more. Its source may be switched off or have expired.' };
  if (remote.data) return { state: 'ready', entry: remote.data };
  if (remote.isError) return { state: 'missing', reason: remote.error.message };
  return { state: 'loading' };
}
