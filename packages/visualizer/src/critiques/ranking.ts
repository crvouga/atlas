/**
 * @module Needs-polish ranking
 *
 * Reads the critiques the viewer holds into a ranked list for one critic. A critique is an opinion, never a result: nothing
 * here counts toward a test total or changes a status. The list ranks the entries a critic judged at their current picture, lowest
 * first (a score is read as higher-is-better, which is the convention of the critique format); when every ranked score also
 * carries its standing among the scores of the same state kind (`relative.percentile`), that standing ranks them instead, because a
 * loading overlay is not compared with a full screen. An entry whose picture changed since it was judged, or whose critic
 * could not judge it, is listed apart and is never ranked, and an entry the critic never saw is only counted.
 */
import { critiqueAgreement, rankCritiques, type CritiqueAgreement, type RankedEntry } from '@crvouga/atlas/reports/critique-review';
import { catalogEntries, type CatalogEntry } from '@crvouga/atlas/reports/ui-catalog-entries';
import type { LayerEvidence } from '@crvouga/atlas/reports/evidence-types';

export type { RankedEntry } from '@crvouga/atlas/reports/critique-review';

/** What the page shows for one critic and (optionally) one kind of UI state. */
export type PolishList = {
  /** Critics that have a critique of any entry, most critiques first. */
  readonly critics: readonly { readonly name: string; readonly critiques: number }[];
  /** The critic whose scores rank the list; null when no critic has judged anything. */
  readonly critic: string | null;
  /** The state kinds of the entries that are in scope, for the filter. */
  readonly kinds: readonly string[];
  /** Entries judged at their current picture with a verdict, lowest first. */
  readonly ranked: readonly RankedEntry[];
  /** How the list was ranked: by standing within the state kind, or by raw score. */
  readonly rankedBy: 'standing-within-kind' | 'score';
  /** Entries whose newest critique judged an earlier picture, or could not judge: not ranked. */
  readonly unranked: readonly RankedEntry[];
  /** Entries in scope the critic has not judged at all. */
  readonly unjudged: number;
  /** Captured states that are not entries because no stored picture backs them. */
  readonly unjudgeable: number;
  /** Every captured state with a stored picture, for the readings that look across critics. */
  readonly entries: readonly CatalogEntry[];
  /** Whether the critics agree on the pictures two or more of them judged (state kind applied). */
  readonly agreement: CritiqueAgreement;
};

/**
 * The list for a critic and state kind over the layers the viewer holds. With no `critic` the one with most critiques is used.
 */
export function polishList(layers: readonly LayerEvidence[], choice: { readonly critic?: string | undefined; readonly kind?: string | undefined } = {}): PolishList {
  const { entries, unjudgeable } = catalogEntries(layers);
  const tally = new Map<string, number>();
  for (const entry of entries) for (const found of entry.critiques) tally.set(found.critique.critic.name, (tally.get(found.critique.critic.name) ?? 0) + 1);
  const critics = [...tally].map(([name, critiques]) => ({ name, critiques })).sort((a, b) => b.critiques - a.critiques || (a.name < b.name ? -1 : 1));
  const critic = choice.critic && tally.has(choice.critic) ? choice.critic : critics[0]?.name ?? null;
  const kinds = [...new Set(entries.map((entry) => entry.state))].sort();
  const { ranked, rankedBy, unranked, unjudged } = rankCritiques(entries, critic, choice.kind);
  const agreement = critiqueAgreement(entries, choice.kind);
  return { critics, critic, kinds, ranked, rankedBy, unranked, unjudged, unjudgeable, entries, agreement };
}
