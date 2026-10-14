/**
 * @module Resilient report cache
 *
 * Wraps a persistent `ReportCache` (IndexedDB, which a browser may deny or corrupt) so a failure of the cache never
 * blocks reports: everything is also kept in memory and every storage error is swallowed.
 */
import type { ReportCache } from './fetcher';
import { memoryReportCache } from './fetcher';

/**
 * Returns a cache that reads and writes `cache` and also keeps every value in memory. Storage is an optimization. A
 * denied or corrupt persistent cache cannot block reports.
 *
 * `get` answers from `cache`, falling back to memory when it has no value or throws. `set` and `remove` always apply
 * to memory first, then try `cache` and ignore its errors, so a value written while storage is failing is still
 * readable for the life of this wrapper (but not after a reload).
 */
export function resilientReportCache(cache: ReportCache): ReportCache {
  const fallback = memoryReportCache();
  return {
    async get(key) {
      try {
        return (await cache.get(key)) ?? (await fallback.get(key));
      } catch {
        return fallback.get(key);
      }
    },
    async set(key, value) {
      await fallback.set(key, value);
      try {
        await cache.set(key, value);
      } catch {
        /* memory remains usable */
      }
    },
    async remove(key) {
      await fallback.remove(key);
      try {
        await cache.remove(key);
      } catch {
        /* optional persistent storage */
      }
    },
  };
}
