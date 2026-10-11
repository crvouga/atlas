import type { ObjectStore } from './object-store';
import type { CommitRecord } from './protocol';
import { readCommit } from './read';

export type ReportRetentionPlan = {
  readonly retained: readonly CommitRecord[];
  readonly deleteKeys: readonly string[];
};

/** Report evidence outlives branch heads. Automatic cleanup never discards a layer. */
export async function planReportRetention(store: ObjectStore): Promise<ReportRetentionPlan> {
  const keys = await store.listKeys('index/');
  const shas = new Set(keys.flatMap(key => /([0-9a-f]{40})\.json$/.exec(key)?.[1] ?? []));
  const retained: CommitRecord[] = [];
  for (const sha of shas) { const commit = await readCommit(store, sha); if (commit) retained.push(commit); }
  return { retained, deleteKeys: [] };
}

export async function pruneReports(store: ObjectStore): Promise<ReportRetentionPlan> {
  return planReportRetention(store);
}
