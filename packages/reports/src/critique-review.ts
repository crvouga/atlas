/**
 * @module Reading critiques together
 *
 * What a person or a command wants to know after critics have spoken: which states need polish first (`rankCritiques`), do the
 * critics agree (`critiqueAgreement`), and what did people decide about the opinions (`markStanding`). These are readings of
 * evidence that is already in the report. They count nothing toward a test total and decide no status, slot or gate: an
 * opinion is an opinion, and so is a person's mark of it. Everything here is pure, so the viewer and `atlas critic review`
 * read the same way.
 *
 * @see docs/critics.md
 */
import type { Critique } from '../../schema/src/critique';
import type { CatalogEntry, EntryCritique, EntryMark } from './ui-catalog-entries';

/** One entry and the critic's newest critique of it. */
export type RankedEntry<E extends Pick<CatalogEntry, 'key' | 'state' | 'critiques'> = CatalogEntry> = { readonly entry: E; readonly found: EntryCritique };

/** The ranking of the entries one critic judged. */
export type CritiqueRanking<E extends Pick<CatalogEntry, 'key' | 'state' | 'critiques'> = CatalogEntry> = {
  /** Entries judged at their current picture with a score, lowest first. */
  readonly ranked: readonly RankedEntry<E>[];
  /** How the list was ranked: by standing within the state kind (when every score has one), or by raw score. */
  readonly rankedBy: 'standing-within-kind' | 'score';
  /** Entries whose newest critique judged an earlier picture, or that the critic could not judge: listed, never ranked. */
  readonly unranked: readonly RankedEntry<E>[];
  /** Entries in scope the critic has not judged at all. */
  readonly unjudged: number;
};

const byKey = (a: { entry: { key: string } }, b: { entry: { key: string } }) => (a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0);

/**
 * Ranks the entries a critic judged, lowest first, so the likeliest problems are reviewed first. A score is read as
 * higher-is-better (the convention of the critique format). When every ranked score also carries its standing among the scores
 * of the same state kind (`verdict.relative.percentile`) that standing ranks them instead, because a loading overlay is not
 * compared with a full screen. An entry whose picture changed since it was judged, or that the critic could not judge, is not
 * ranked but is returned; an entry the critic never saw is only counted.
 *
 * @param entries the entries in view.
 * @param critic the critic whose critiques rank them.
 * @param kind when given, only entries of this state kind.
 */
export function rankCritiques<E extends Pick<CatalogEntry, 'key' | 'state' | 'critiques'>>(entries: readonly E[], critic: string | null, kind?: string): CritiqueRanking<E> {
  const ranked: RankedEntry<E>[] = [], unranked: RankedEntry<E>[] = [];
  let unjudged = 0;
  for (const entry of entries) {
    if (kind && entry.state !== kind) continue;
    const found = critic ? entry.critiques.filter(item => item.critique.critic.name === critic) : [];
    // The newest critique that judged the current picture decides; failing that, the newest of any.
    const current = found.find(item => item.currency === 'current');
    const pick = current ?? found[0];
    if (!pick) { unjudged += 1; continue; }
    if (current && current.critique.verdict?.score !== undefined && !current.critique.failure) ranked.push({ entry, found: current });
    else unranked.push({ entry, found: pick });
  }
  const standing = (item: RankedEntry<E>) => item.found.critique.verdict?.relative?.percentile;
  const byStanding = ranked.length > 0 && ranked.every(item => standing(item) !== undefined);
  const key = (item: RankedEntry<E>) => (byStanding ? standing(item)! : item.found.critique.verdict!.score!);
  ranked.sort((a, b) => key(a) - key(b) || byKey(a, b));
  unranked.sort(byKey);
  return { ranked, rankedBy: byStanding ? 'standing-within-kind' : 'score', unranked, unjudged };
}

/** What a critic's opinion amounts to for a reader who wants to know whether it flags the UI: it does, it does not, or it gives no view. */
export type Stance = 'flags' | 'clear' | 'no-view';

/** A score at or below this standing within its state kind (the lowest quarter) counts as flagging, when the critic gave no label. */
export const FLAGGING_PERCENTILE = 25;

/**
 * Whether a critique flags the UI. A failed critique, or one with nothing to go on, gives no view and is never read as fine.
 * Otherwise the critic's own label decides (`needs-polish` flags, `ok` clears); with no label, findings flag; with neither, a score
 * in the lowest quarter of its state kind (`relative.percentile` at most {@link FLAGGING_PERCENTILE}) flags and a higher one clears. A bare
 * score with no standing gives no view, because a raw score is not absolute.
 */
export function critiqueStance(critique: Critique): Stance {
  if (critique.failure) return 'no-view';
  const label = critique.verdict?.label;
  if (label === 'needs-polish') return 'flags';
  if (label === 'ok') return 'clear';
  if ((critique.findings ?? []).length > 0) return 'flags';
  const percentile = critique.verdict?.relative?.percentile;
  if (percentile !== undefined) return percentile <= FLAGGING_PERCENTILE ? 'flags' : 'clear';
  return 'no-view';
}

/** How the critics who judged an entry at its current picture stand together. */
export type AgreementOutcome = 'agree-flag' | 'agree-clear' | 'disagree' | 'unclear';

/** One critic's view of an entry. */
export type CriticView = {
  readonly critic: string;
  readonly version: string;
  readonly stance: Stance;
  readonly score?: number;
  readonly percentile?: number;
  readonly label?: string;
};

/** An entry judged at its current picture by two or more critics, and whether they agree. */
export type AgreementRow<E extends Pick<CatalogEntry, 'key' | 'state' | 'critiques'> = CatalogEntry> = {
  readonly entry: E;
  readonly views: readonly CriticView[];
  readonly outcome: AgreementOutcome;
};

/** The agreement of critics over some entries. */
export type CritiqueAgreement<E extends Pick<CatalogEntry, 'key' | 'state' | 'critiques'> = CatalogEntry> = {
  /** Entries judged by two or more critics at their current picture, those every critic flags first, then those they disagree on. */
  readonly rows: readonly AgreementRow<E>[];
  /** Entries only one critic has judged at the current picture: there is nothing to compare. */
  readonly single: number;
  /** The critics that have judged at least one entry at its current picture. */
  readonly critics: readonly string[];
};

const ORDER: Readonly<Record<AgreementOutcome, number>> = { 'agree-flag': 0, disagree: 1, unclear: 2, 'agree-clear': 3 };

/**
 * Compares what the critics think of the same pictures. Only critiques of an entry's current picture count, and only each critic's
 * newest. Critics that give no view ({@link critiqueStance}) are shown but do not make an entry agree or disagree: with fewer than
 * two views the outcome is `unclear`, never agreement. An agreement is a reading for people; it is not a verdict, a status or a gate.
 */
export function critiqueAgreement<E extends Pick<CatalogEntry, 'key' | 'state' | 'critiques'>>(entries: readonly E[], kind?: string): CritiqueAgreement<E> {
  const rows: AgreementRow<E>[] = [];
  const critics = new Set<string>();
  let single = 0;
  for (const entry of entries) {
    if (kind && entry.state !== kind) continue;
    const newest = new Map<string, EntryCritique>();
    for (const found of entry.critiques) if (found.currency === 'current' && !newest.has(found.critique.critic.name)) newest.set(found.critique.critic.name, found);
    for (const name of newest.keys()) critics.add(name);
    if (newest.size < 2) { if (newest.size === 1) single += 1; continue; }
    const views: CriticView[] = [...newest.values()].map(({ critique }) => ({
      critic: critique.critic.name, version: critique.critic.version, stance: critiqueStance(critique),
      ...(critique.verdict?.score === undefined ? {} : { score: critique.verdict.score }),
      ...(critique.verdict?.relative?.percentile === undefined ? {} : { percentile: critique.verdict.relative.percentile }),
      ...(critique.verdict?.label ? { label: critique.verdict.label } : {})
    })).sort((a, b) => (a.critic < b.critic ? -1 : 1));
    const decided = views.filter(view => view.stance !== 'no-view');
    const outcome: AgreementOutcome = decided.length < 2 ? 'unclear' : decided.every(view => view.stance === 'flags') ? 'agree-flag' : decided.every(view => view.stance === 'clear') ? 'agree-clear' : 'disagree';
    rows.push({ entry, views, outcome });
  }
  rows.sort((a, b) => ORDER[a.outcome] - ORDER[b.outcome] || byKey(a, b));
  return { rows, single, critics: [...critics].sort() };
}

/** What people decided about one opinion (a critic's critique of an entry, or one of its findings). */
export type MarkStanding = {
  /** `accepted`: only accepts. `dismissed`: only dismissals. `disputed`: reviewers disagree. `unmarked`: nobody has marked it at the current picture. */
  readonly state: 'accepted' | 'dismissed' | 'disputed' | 'unmarked';
  /** Reviewers who accepted it (their name, or the producer when they gave none). */
  readonly accepted: readonly string[];
  /** Reviewers who dismissed it. */
  readonly dismissed: readonly string[];
  /** Marks made about an earlier picture, which count for nothing now. */
  readonly earlier: number;
  /** The notes reviewers left, newest first. */
  readonly notes: readonly string[];
};

/** The decision a mark records: `accept`, `dismiss`, or `null` for a word this reader does not know (shown as written, counted as neither). */
export function markDecision(mark: Pick<EntryMark['mark'], 'decision'>): 'accept' | 'dismiss' | null {
  return mark.decision === 'accept' || mark.decision === 'dismiss' ? mark.decision : null;
}

/**
 * What reviewers decided about a critic's opinion of an entry. Only marks made about the picture the entry has now count; those
 * about an earlier picture are tallied apart. Each reviewer's newest mark is the one that is held (the slot rule); a reviewer who
 * accepted and later dismissed has dismissed. Marks with a decision this reader does not know count as neither.
 *
 * @param marks the entry's marks (`CatalogEntry.marks`).
 * @param target the critic whose opinion is marked; `finding` names one finding, and without it the critique as a whole.
 */
export function markStanding(marks: readonly EntryMark[], target: { readonly critic: string; readonly finding?: string | undefined }): MarkStanding {
  const mine = marks.filter(item => item.mark.critic.name === target.critic && (target.finding === undefined ? item.mark.finding === undefined : item.mark.finding === target.finding));
  const current = mine.filter(item => item.currency === 'current');
  const who = (item: EntryMark) => item.mark.reviewer ?? item.producer;
  const accepted = [...new Set(current.filter(item => markDecision(item.mark) === 'accept').map(who))].sort();
  const dismissed = [...new Set(current.filter(item => markDecision(item.mark) === 'dismiss').map(who))].sort();
  return {
    state: accepted.length && dismissed.length ? 'disputed' : accepted.length ? 'accepted' : dismissed.length ? 'dismissed' : 'unmarked',
    accepted, dismissed,
    earlier: mine.length - current.length,
    notes: current.filter(item => item.mark.note).sort((a, b) => b.recordedAtMs - a.recordedAtMs).map(item => item.mark.note!)
  };
}
