/**
 * @module Query cache persistence
 *
 * Persists the viewer's TanStack query cache into a `ReportCache` (IndexedDB in the browser) so a reload starts from
 * what was already fetched. Frame-file queries stay out of this document: those bytes live in `ReportCache` on their
 * own keys.
 */

import {
  type Persister,
  persistQueryClient,
} from '@tanstack/query-persist-client-core';
import type { QueryClient } from '@tanstack/solid-query';

import type { ReportCache } from './fetcher';

const CACHE_KEY = 'reports-query-cache';
const WEEK = 7 * 24 * 60 * 60 * 1000;

/** A TanStack `Persister` that keeps the whole query client as one JSON string under one key in `cache`. A stored value that is not valid JSON is removed and treated as no cache. */
export function reportPersister(cache: ReportCache): Persister {
  return {
    persistClient: (client) => cache.set(CACHE_KEY, JSON.stringify(client)),
    restoreClient: async () => {
      const raw = await cache.get(CACHE_KEY);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as Awaited<
          ReturnType<Persister['restoreClient']>
        >;
      } catch {
        await cache.remove(CACHE_KEY);
        return undefined;
      }
    },
    removeClient: () => cache.remove(CACHE_KEY),
  };
}

function keepQuery(query: {
  readonly queryKey: readonly unknown[];
  readonly state: { readonly status: string };
}): boolean {
  return query.state.status === 'success' && query.queryKey[1] !== 'blob';
}

/**
 * Restores the query client from `cache`, then keeps writing it back as queries change. Returns
 * `[unsubscribe, restored]`: the function that stops writing, and a promise that settles when the restore is done.
 * Only successful queries are stored, never `blob` queries (those are the frame files); a stored cache older than a
 * week, or from a different cache version, is discarded.
 */
export function attachReportCache(
  client: QueryClient,
  cache: ReportCache
): [() => void, Promise<void>] {
  return persistQueryClient({
    queryClient: client,
    persister: reportPersister(cache),
    maxAge: WEEK,
    buster: 'reports-v2',
    dehydrateOptions: { shouldDehydrateQuery: keepQuery },
  });
}
