/**
 * @module Report retention
 *
 * The plan for what cleanup may remove from a store. There is none: Atlas never deletes a layer or a commit's evidence
 * by itself (the contract is deletion-free), so the plan always retains everything and lists no key to delete.
 * Retention is the operator's choice, made outside Atlas.
 *
 * @see docs/report-contract.md#guarantees
 */
import type { ObjectStore } from './object-store';
import type { CommitRecord } from './protocol';
import { readCommit } from './read';

/** What a retention pass would keep and delete. */
export type ReportRetentionPlan = {
  /** The commit records found, all of them. */
  readonly retained: readonly CommitRecord[];
  /** Keys to delete. Always empty: automatic cleanup never discards evidence. */
  readonly deleteKeys: readonly string[];
};

/**
 * Lists the commits recorded in `index/` with their records, and no key to delete. Report evidence outlives branch
 * heads: automatic cleanup never discards a layer. A listed commit with no readable record is left out of `retained`.
 */
export async function planReportRetention(store: ObjectStore): Promise<ReportRetentionPlan> {
  const keys = await store.listKeys('index/');
  const shas = new Set(keys.flatMap(key => /([0-9a-f]{40})\.json$/.exec(key)?.[1] ?? []));
  const retained: CommitRecord[] = [];
  for (const sha of shas) { const commit = await readCommit(store, sha); if (commit) retained.push(commit); }
  return { retained, deleteKeys: [] };
}

/** Same as `planReportRetention`. Despite the name it deletes nothing, and `deleteKeys` is always empty. */
export async function pruneReports(store: ObjectStore): Promise<ReportRetentionPlan> {
  return planReportRetention(store);
}
