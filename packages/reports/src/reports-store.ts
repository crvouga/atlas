/**
 * @module Choosing between the shared and the local reports store
 *
 * Decides which store answers for a commit or a source when a project has both a shared store and this machine's own,
 * and merges their source records. The local store wins for what it holds, so a remote outage cannot hide a local run.
 */
import type { SourceRecord } from './protocol';
import {
  listSourceRecords,
  readCommit,
} from './read';
import { readStoredSource } from './source-content';
import type { ObjectStore } from './object-store';

/** The stores a reports host reads. */
export type ReportsStores = {
  /** The shared reports store, or `null` when this deployment has no credential for one. */
  readonly store: ObjectStore | null;
  /** This machine's own store, where collected local runs are written. */
  readonly localStore?: ObjectStore;
};

/**
 * The store to read a commit from: the local store when it has that commit's record, else the shared store (`null`
 * when there is none). Collected local runs own their timelines; a remote outage cannot hide them.
 */
export async function reportsStoreForCommit(
  deps: ReportsStores,
  sha: string
): Promise<ObjectStore | null> {
  if (deps.localStore && (await readCommit(deps.localStore, sha)) !== null)
    return deps.localStore;
  return deps.store;
}

/** The store to read one source of a commit from: the local store when it holds that source, else the shared store (`null` when there is none). */
export async function reportsStoreForSource(
  deps: ReportsStores,
  sha: string,
  source: string
): Promise<ObjectStore | null> {
  if (
    deps.localStore &&
    (await readStoredSource(deps.localStore, sha, source)) !== null
  )
    return deps.localStore;
  return deps.store;
}

/**
 * Lists the source records of a commit from the shared and the local store, one per source name. A local source
 * replaces the shared one of the same name only; others from both are kept. A store that fails is skipped, and the
 * error is thrown only when no source was found at all and a store failed.
 */
export async function reportsSources(
  deps: ReportsStores,
  sha: string
): Promise<readonly SourceRecord[]> {
  const stores = [deps.store, deps.localStore].filter((store) => store != null);
  const results = await Promise.allSettled(
    stores.map((store) => listSourceRecords(store, sha))
  );
  const sources = new Map<string, SourceRecord>();
  for (const result of results)
    if (result.status === 'fulfilled')
      for (const source of result.value) sources.set(source.source, source);
  const failure = results.find((result) => result.status === 'rejected');
  if (sources.size === 0 && failure?.status === 'rejected')
    throw failure.reason;
  return [...sources.values()];
}
