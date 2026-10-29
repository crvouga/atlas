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
import { catalogEntries, type CatalogEntry, type EntryCritique } from '@crvouga/atlas/reports/ui-catalog-entries';
import type { LayerEvidence } from '@crvouga/atlas/reports/evidence-types';

/** One entry and the critic's newest critique of it. */
export type RankedEntry = { readonly entry: CatalogEntry; readonly found: EntryCritique };

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
  const inScope = entries.filter((entry) => !choice.kind || entry.state === choice.kind);
  const ranked: RankedEntry[] = [], unranked: RankedEntry[] = [];
  let unjudged = 0;
  for (const entry of inScope) {
    const found = critic ? entry.critiques.filter((item) => item.critique.critic.name === critic) : [];
    // The newest critique that judged the current picture decides; failing that, the newest of any.
    const current = found.find((item) => item.currency === 'current');
    const pick = current ?? found[0];
    if (!pick) { unjudged += 1; continue; }
    if (current && current.critique.verdict?.score !== undefined && !current.critique.failure) ranked.push({ entry, found: current });
    else unranked.push({ entry, found: pick });
  }
  const standing = (item: RankedEntry) => item.found.critique.verdict?.relative?.percentile;
  const byStanding = ranked.length > 0 && ranked.every((item) => standing(item) !== undefined);
  const key = (item: RankedEntry) => (byStanding ? standing(item)! : item.found.critique.verdict!.score!);
  ranked.sort((a, b) => key(a) - key(b) || (a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0));
  unranked.sort((a, b) => (a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0));
  return { critics, critic, kinds, ranked, rankedBy: byStanding ? 'standing-within-kind' : 'score', unranked, unjudged, unjudgeable };
}
