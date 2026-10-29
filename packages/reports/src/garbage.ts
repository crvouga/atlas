/**
 * @module Layer garbage collection
 *
 * Applies a garbage collection policy (`GcPolicy`, chosen by a person in the Atlas UI and kept in the user state) to the
 * layers in a store. Atlas is otherwise deletion-free, so this is deliberately conservative: a layer is deleted only when
 * (1) the caller says the report has read it and every result it carries has been replaced by a newer layer (`eligible`),
 * (2) it was recorded longer ago than the policy allows, and (3) it is not among the newest `keepLatest` layers. Deleting
 * it therefore cannot change the combined report. Its catalog entry goes first, so nothing visible ever points at a
 * missing manifest; its manifest next; then the captured-file blobs that no remaining layer refers to. If any remaining
 * layer cannot be read, no blob is deleted: what cannot be read is unknown, never unused. Specs, runs and commit
 * inventories are not touched.
 *
 * @see docs/server.md#user-state-and-garbage-collection
 */
import { eachLimited } from './completion-order';
import { LAYER_INDEX, layerKey, readLayer } from './layer-store';
import type { ObjectStore } from './object-store';
import type { GcPolicy } from '../../schema/src/user-state';

const DAY_MS = 86_400_000;
const CATALOG = /^layers\/index\/(\d{16})-([0-9a-f]{64})\.json$/;

/** One layer the policy would delete. */
export type GcCandidate = { readonly id: string; readonly catalogKey: string; readonly recordedAtMs: number };

/** What a policy would delete from a store right now. */
export type GcPlan = {
  /** Layers to delete, oldest first. */
  readonly candidates: readonly GcCandidate[];
  /** Layers in the catalog that stay. */
  readonly kept: number;
};

/** The outcome of applying a plan. */
export type GcOutcome = { readonly deletedLayers: number; readonly deletedBlobs: number };

/**
 * Decides which layers a policy deletes, without deleting anything. `eligible` is the set of layer ids the caller has
 * read and knows no longer decide any result (`ReportIndex.superseded()`); a layer not in it is never a candidate.
 * Lists the catalog only. With `policy.enabled === false` the plan is empty.
 *
 * @example
 * const plan = await planGarbage(store, { policy, nowMs: Date.now(), eligible: index.superseded() });
 */
export async function planGarbage(store: ObjectStore, input: { readonly policy: GcPolicy; readonly nowMs: number; readonly eligible: ReadonlySet<string> }): Promise<GcPlan> {
  const entries = (await store.listKeys(LAYER_INDEX)).flatMap(key => {
    const match = CATALOG.exec(key);
    return match ? [{ id: match[2]!, catalogKey: key, recordedAtMs: Number.MAX_SAFE_INTEGER - Number(match[1]) }] : [];
  });
  // Catalog keys sort newest first (the time is inverted), so the layers to always keep are the first `keepLatest`.
  entries.sort((a, b) => b.recordedAtMs - a.recordedAtMs || (a.id < b.id ? -1 : 1));
  if (!input.policy.enabled) return { candidates: [], kept: entries.length };
  const cutoff = input.nowMs - input.policy.maxAgeDays * DAY_MS;
  const candidates = entries.slice(input.policy.keepLatest).filter(entry => entry.recordedAtMs < cutoff && input.eligible.has(entry.id));
  return { candidates: candidates.reverse(), kept: entries.length - candidates.length };
}

/**
 * Deletes the layers of a plan, then the blobs only they used. Store errors throw after whatever was already deleted;
 * running the same plan again finishes the job, because every delete is idempotent and the catalog entry (what
 * makes a layer visible) always goes before the content.
 */
export async function collectGarbage(store: ObjectStore, plan: GcPlan): Promise<GcOutcome> {
  if (!plan.candidates.length) return { deletedLayers: 0, deletedBlobs: 0 };
  const doomed = new Set(plan.candidates.map(candidate => candidate.id));
  // Which blobs the doomed layers used, read before anything is deleted. A layer that cannot be read stays: unknown is not garbage.
  const used = new Map<string, Set<string>>();
  const readable: GcCandidate[] = [];
  await eachLimited(plan.candidates, 16, async candidate => {
    const layer = await readLayer(store, candidate.id).catch(() => null);
    if (!layer) return;
    used.set(candidate.id, new Set(Object.values(layer.bundle).flatMap(file => file.parts.map(part => part.blob))));
    readable.push(candidate);
  });
  if (!readable.length) return { deletedLayers: 0, deletedBlobs: 0 };

  await store.deleteMany(readable.map(candidate => candidate.catalogKey));
  await store.deleteMany(readable.map(candidate => layerKey(candidate.id)));
  const removed = new Set(readable.map(candidate => candidate.id));

  const orphanable = new Set([...removed].flatMap(id => [...used.get(id)!]));
  // Blobs that any remaining layer still points at must stay. If a remaining layer cannot be read, keep every blob.
  const remaining = (await store.listKeys(LAYER_INDEX)).flatMap(key => CATALOG.exec(key)?.[2] ?? []).filter(id => !removed.has(id));
  let unreadable = false;
  await eachLimited(remaining, 16, async id => {
    const layer = await readLayer(store, id).catch(() => null);
    if (!layer) { unreadable = true; return; }
    for (const file of Object.values(layer.bundle)) for (const part of file.parts) orphanable.delete(part.blob);
  });
  if (unreadable) return { deletedLayers: removed.size, deletedBlobs: 0 };
  await store.deleteMany([...orphanable]);
  return { deletedLayers: removed.size, deletedBlobs: orphanable.size };
}
