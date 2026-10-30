/**
 * @module UI catalog collection order
 *
 * The order in which a UI catalog's work units are handed out, as a pure function of a definition ({@link ./ui-catalog-definition})
 * and the results the report holds. A unit is as urgent as its most urgent item, and the tiers are, most urgent first:
 *
 * 1. **failed**: the newest result of an item failed (a readiness timeout is a failed capture);
 * 2. **empty**: expected and never captured, skipped (`not-run`), or claimed by a shard that let its claim end without a result;
 * 3. **unknown**: no readable result while a backend or a layer could not be read, so it may have one: never called empty;
 * 4. **stale**: captured, and the result was recorded before the cutoff a claim names; oldest first.
 *
 * A captured unit newer than the cutoff is **fresh**: it is not due and is never handed out. Ties break by unit key, so
 * two servers given the same data produce the same order. A result is matched to an item by state id and catalog profile
 * key, the same way a catalog cell is, so the queue and `/catalog` always agree on what an item holds.
 *
 * @see docs/ui-catalog.md#collecting-with-a-queue
 */
import type { UiQueueTier } from '../../schema/src/ui-catalog-queue';
import type { LayerEvidence } from './evidence-types';
import type { EvidenceStatus } from './explorer-types';
import { replaces, type EvidenceResult } from './layer-merge';
import { uiProfile } from './ui-catalog';
import { unitMatches, uiItemKey, type ExpandedCatalog } from './ui-catalog-definition';
import { UI_STATE_KIND } from './ui-state';

/** The check label a collector puts on a capture to say which claim it answers, so the server can close that claim. Provenance only: a label never splits a slot. */
export const UI_CLAIM_LABEL = 'atlas.claim';

/** The newest result of one item. */
export type UiItemResult = {
  readonly status: EvidenceStatus;
  readonly recordedAtMs: number;
  /** The layer that holds it. */
  readonly layer: string;
  /** The claim it answers (its {@link UI_CLAIM_LABEL} label), or null. */
  readonly claim: string | null;
};

/** A unit's place in the queue. `captured` units are `stale` or `fresh` depending on a claim's cutoff. */
export type RankedUnit = {
  readonly unit: number;
  readonly tier: 'failed' | 'empty' | 'unknown' | 'captured';
  /** For a captured unit, when its oldest item was recorded; otherwise 0. */
  readonly recordedAtMs: number;
};

const RANK = { failed: 0, empty: 1, unknown: 2, captured: 3 } as const;

/**
 * The newest `ui-state` result of every item in some layers (the effective report's, normally), keyed by {@link uiItemKey}.
 * "Newest" is the report contract's own order (`replaces`), as for a catalog cell, so the queue agrees with `/catalog`.
 */
export function latestUiResults(layers: readonly LayerEvidence[]): Map<string, UiItemResult> {
  const best = new Map<string, EvidenceResult>();
  for (const entry of layers) {
    let profileKey: string | null = null;
    for (const row of entry.rows) {
      if (row.kind !== UI_STATE_KIND) continue;
      profileKey ??= uiProfile(entry.layer).key;
      const key = uiItemKey(row.id, profileKey);
      const result = { key: '', slot: '', layer: entry.layer, row } as EvidenceResult;
      const prior = best.get(key);
      if (!prior || replaces(result, prior)) best.set(key, result);
    }
  }
  const out = new Map<string, UiItemResult>();
  for (const [key, result] of best) out.set(key, { status: result.row.status, recordedAtMs: result.layer.recordedAtMs, layer: result.layer.id, claim: result.row.evidence?.labels[UI_CLAIM_LABEL] ?? null });
  return out;
}

/** What a unit's items hold now, as one string: it changes exactly when any of them gets a new result. */
export function unitFingerprint(expanded: ExpandedCatalog, unit: number, results: ReadonlyMap<string, UiItemResult>): string {
  return expanded.units[unit]!.items.map(i => results.get(expanded.items[i]!.key)?.layer ?? '-').join(',');
}

/** What decides the order besides the definition. */
export type RankOptions = {
  /** A backend or layer could not be read: an item with no result is `unknown`, not `empty`. */
  readonly incomplete?: boolean;
  /** Units a claim let go of without a result, by unit key, with their {@link unitFingerprint} at the time. A unit whose items got no new result since is `empty`, unless one failed. */
  readonly abandoned?: ReadonlyMap<string, string>;
};

/** Every unit in queue order: failed, empty, unknown, then captured (oldest first); ties by unit key. */
export function rankUnits(expanded: ExpandedCatalog, results: ReadonlyMap<string, UiItemResult>, options: RankOptions = {}): RankedUnit[] {
  const ranked: RankedUnit[] = new Array(expanded.units.length);
  for (let u = 0; u < expanded.units.length; u++) {
    let tier: RankedUnit['tier'] = 'captured';
    let oldest = Number.POSITIVE_INFINITY;
    for (const i of expanded.units[u]!.items) {
      const result = results.get(expanded.items[i]!.key);
      const item: RankedUnit['tier'] = !result ? (options.incomplete ? 'unknown' : 'empty') : result.status === 'failed' ? 'failed' : result.status === 'passed' ? 'captured' : 'empty';
      if (item === 'captured') oldest = Math.min(oldest, result!.recordedAtMs);
      if (RANK[item] < RANK[tier]) tier = item;
    }
    if (tier !== 'failed' && options.abandoned?.size) {
      const at = options.abandoned.get(expanded.units[u]!.key);
      if (at !== undefined && at === unitFingerprint(expanded, u, results)) tier = 'empty';
    }
    ranked[u] = { unit: u, tier, recordedAtMs: tier === 'captured' ? oldest : 0 };
  }
  // Units are already in key order, so the index is the deterministic tie-break.
  return ranked.sort((a, b) => RANK[a.tier] - RANK[b.tier] || a.recordedAtMs - b.recordedAtMs || a.unit - b.unit);
}

/** The tier a ranked unit is handed out (or counted) as, given a claim's cutoff. */
export function tierOf(ranked: RankedUnit, staleBeforeMs: number | undefined): UiQueueTier {
  if (ranked.tier !== 'captured') return ranked.tier;
  return staleBeforeMs !== undefined && ranked.recordedAtMs < staleBeforeMs ? 'stale' : 'fresh';
}

/** What a batch is picked by. */
export type PickOptions = {
  readonly batchSize: number;
  readonly staleBeforeMs?: number;
  readonly where?: Readonly<Record<string, readonly string[]>>;
  /** Units that may not be handed out now: held by a live claim, or past the retry limit. */
  readonly skip?: (unit: number) => boolean;
};

/** The first `batchSize` units of a queue order that are due, match `where` and are not skipped. Fresh units are never picked. */
export function pickUnits(expanded: ExpandedCatalog, ranked: readonly RankedUnit[], options: PickOptions): { readonly unit: number; readonly tier: UiQueueTier }[] {
  const picked: { unit: number; tier: UiQueueTier }[] = [];
  for (const entry of ranked) {
    if (picked.length >= options.batchSize) break;
    const tier = tierOf(entry, options.staleBeforeMs);
    // Captured units come last and oldest first, so the first fresh one means nothing after it is due.
    if (tier === 'fresh') break;
    if (options.skip?.(entry.unit) || !unitMatches(expanded, expanded.units[entry.unit]!, options.where)) continue;
    picked.push({ unit: entry.unit, tier });
  }
  return picked;
}

/** One item of a unit as a claim carries it: its key, its state with the declared facts, and its profile. */
export function claimedItem(expanded: ExpandedCatalog, index: number) {
  const item = expanded.items[index]!;
  const profile = expanded.profiles[item.profile]!;
  return { key: item.key, state: expanded.document.states[item.state]!, profile: { key: profile.key, values: profile.values, environment: profile.environment, parameters: profile.parameters } };
}
