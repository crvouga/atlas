/**
 * @module Evidence applicability
 *
 * Whether recorded evidence applies to a behavior as it is written now and, when a release is named, to that
 * release. Four facts stay apart: the promise's revision (the spec now) against the revision the evidence recorded,
 * when the checks ran (never when they were published or enriched), what the evidence ran against (build, commit,
 * platform, and whether the checkout was clean), and the release a reader named. Nothing here decides an outcome:
 * statuses and winners come from the combined report, and a verdict is a reading of them that never turns a pass
 * into a failure. What cannot be compared is `unknown`, never `applies`. A branch name, a green check or a run's
 * recency never supply deployment state.
 *
 * Producers state what they know with the open vocabulary of `labels` (see docs/extending.md): `build` (the build
 * the app under test was), `platform` (the client family; the environment when absent), `applies-to` (a comma
 * separated list of builds or commits the producer asserts the evidence is still good for) and `applies-to-by`
 * (the policy, person or tool that makes the assertion). An assertion without `applies-to-by` is not accepted.
 * `published-at` and `enriched-at` say when the evidence was published or enriched (epoch milliseconds or an ISO date).
 * Layers carry no publication time of their own, because a layer's id is the digest of its content and a time of
 * upload in it would make a retried publish a different layer; a producer that knows states it as a label. It is shown
 * apart from when the checks ran and is never the age of the evidence.
 *
 * The same reading serves a feature page (from the report's results, {@link assessBehavior}) and the test explorer (from
 * the catalog's current results, {@link assessTest}).
 */
import type { EvidenceResult } from '@crvouga/atlas/reports/layer-merge';
import type { TestResultEntry, TestSummary } from '@crvouga/atlas/reports/test-catalog';

import { compareRevisions, type Behavior, type Revision, type RevisionSource } from './behavior';

/** The release a reader names: the build and/or commit that was deployed, on a platform. Every part is optional. */
export type ReleaseIdentity = {
  /** The deployed build (`4821`, `2.4.1`), compared with the `build` label of the evidence. */
  readonly build?: string;
  /** The deployed commit, full or abbreviated, compared with the layer's commit. */
  readonly sha?: string;
  /** The platform of the release (`ios`, `android`, `desktop-web`), compared with the evidence's `platform` label or environment. */
  readonly platform?: string;
};

/** Whether a release is named: a build or a commit is needed to compare against, a platform alone selects nothing. */
export function hasRelease(release: ReleaseIdentity): boolean {
  return Boolean(release.build?.trim() || release.sha?.trim());
}

/**
 * Where evidence stands against the release.
 * `not-selected`: no release was named. `exact`: the build and/or commit match and the checkout was clean.
 * `asserted`: a different build, with an explicit stated policy that the evidence still holds.
 * `other`: a known different build or commit. `unknown`: it cannot be compared (another platform, no build recorded,
 * a modified checkout, an assertion with no policy).
 */
export type ReleaseMatch = 'not-selected' | 'exact' | 'asserted' | 'other' | 'unknown';

/** What a reader should take from the evidence: it applies, it does not (stale), it cannot be told, or there is none. */
export type Verdict = 'applies' | 'stale' | 'unknown' | 'none';

/** What each verdict is called, and why. */
export const VERDICTS: Readonly<Record<Verdict, { readonly label: string; readonly meaning: string; readonly color: string }>> = {
  applies: { label: 'Applies', meaning: 'The evidence was recorded against the current promise and, when a release is named, against that release.', color: 'green' },
  stale: { label: 'Stale', meaning: 'The evidence is of an earlier promise or of another build. It is not proof of what is shown now. The recorded outcome is unchanged.', color: 'orange' },
  unknown: { label: 'Applicability unknown', meaning: 'The evidence cannot be tied to the current promise or the named release. That is not a failure.', color: 'gray' },
  none: { label: 'No evidence', meaning: 'Nothing was recorded for this behavior.', color: 'gray' }
};

/** What the evidence of one result says about what it ran against. Absent facts are null: unknown, never assumed. */
export type EvidenceFacts = {
  /** When the checks ran, epoch milliseconds. The age of evidence counts from here, not from publication or enrichment. */
  readonly executedAtMs: number;
  /** When the evidence was published, from the `published-at` label, or null when the producer did not say. Never the age of the evidence. */
  readonly publishedAtMs: number | null;
  /** When the evidence was enriched (annotated, captioned, re-indexed), from the `enriched-at` label, or null. Never the age of the evidence. */
  readonly enrichedAtMs: number | null;
  readonly build: string | null;
  readonly sha: string | null;
  /** The `platform` label, else the layer's environment. */
  readonly platform: string | null;
  readonly environment: string | null;
  /** `modified` or `unknown` when the checkout was not a clean commit, else null. */
  readonly provenance: 'modified' | 'unknown' | null;
};

/** An assertion by the producer that evidence still holds for other builds, and who stands behind it. */
export type Assertion = {
  readonly builds: readonly string[];
  /** The stated policy or author; null when none was stated (the assertion is then not accepted). */
  readonly by: string | null;
};

/** The reading of one result's evidence against the promise and the named release. */
export type Assessment = {
  readonly verdict: Verdict;
  readonly promise: Revision['match'];
  readonly release: ReleaseMatch;
  readonly facts: EvidenceFacts | null;
  readonly assertion: Assertion | null;
  /** Sentences saying why, in the order a reader needs them. Empty when there is nothing to add. */
  readonly reasons: readonly string[];
  /** The result this reading is of, or null when there is none (or it was read from a test catalog, which holds its layer id instead). */
  readonly result: EvidenceResult | null;
  /** The id of the layer that recorded the result this reading is of, or null when there is none. */
  readonly layer: string | null;
  /** How many other completed results were read and set aside for this one. */
  readonly others: number;
};

const norm = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
};

/** Whether two commits name the same one, allowing either to be abbreviated (at least seven characters). */
function sameCommit(a: string, b: string): boolean {
  const [left, right] = [a.toLowerCase(), b.toLowerCase()];
  const short = left.length <= right.length ? left : right;
  const long = left.length <= right.length ? right : left;
  return short.length >= 7 && long.startsWith(short);
}

/** The labels that apply to a result: the layer's, then the check's own. */
function labelsOf(result: EvidenceResult): Readonly<Record<string, string>> {
  return { ...(result.layer.evidence?.labels ?? {}), ...(result.row.evidence?.labels ?? {}) };
}

/** A time a label states: epoch milliseconds or an ISO date. Anything else is no time. */
function labelTime(value: string | undefined): number | null {
  const text = value?.trim();
  if (!text) return null;
  const at = /^\d{9,}$/.test(text) ? Number(text) : /^\d{4}-\d{2}-\d{2}/.test(text) ? Date.parse(text) : Number.NaN;
  return Number.isFinite(at) && at > 0 ? at : null;
}

/** What one result recorded about itself, whether read from the report or from the test catalog. */
type Recorded = {
  readonly labels: Readonly<Record<string, string>>;
  readonly executedAtMs: number;
  readonly sha: string | null;
  readonly environment: string | null;
  readonly freshness: 'modified' | 'unknown' | null;
};

function factsFrom(recorded: Recorded): EvidenceFacts {
  const { labels } = recorded;
  return {
    executedAtMs: recorded.executedAtMs,
    publishedAtMs: labelTime(labels['published-at']),
    enrichedAtMs: labelTime(labels['enriched-at']),
    build: labels.build?.trim() || null,
    sha: recorded.sha,
    platform: labels.platform?.trim() || recorded.environment,
    environment: recorded.environment,
    provenance: recorded.freshness
  };
}

function assertionFrom(labels: Readonly<Record<string, string>>): Assertion | null {
  const builds = (labels['applies-to'] ?? '')
    .split(',')
    .map((each) => each.trim())
    .filter(Boolean);
  return builds.length ? { builds, by: labels['applies-to-by']?.trim() || null } : null;
}

const ofResult = (result: EvidenceResult): Recorded => ({
  labels: labelsOf(result),
  executedAtMs: result.layer.recordedAtMs,
  sha: result.layer.sha,
  environment: result.layer.environment,
  freshness: result.layer.freshness ?? null
});

const ofOutcome = (outcome: TestResultEntry): Recorded => ({
  labels: outcome.provenance ?? {},
  executedAtMs: outcome.at,
  sha: outcome.sha,
  environment: outcome.environment,
  freshness: outcome.freshness ?? null
});

/** What a result's layer and labels say it ran against. */
export function evidenceFacts(result: EvidenceResult): EvidenceFacts {
  return factsFrom(ofResult(result));
}

/** The assertion a result's labels make, or null when it makes none. */
export function assertionOf(result: EvidenceResult): Assertion | null {
  return assertionFrom(labelsOf(result));
}

const RANK: Readonly<Record<Verdict, number>> = { applies: 0, unknown: 1, stale: 2, none: 3 };

/** How one result's evidence stands against the release. Never reads a branch or a status. */
function matchRelease(facts: EvidenceFacts, release: ReleaseIdentity, promise: Revision['match'], assertion: Assertion | null): { match: ReleaseMatch; reasons: string[] } {
  if (!hasRelease(release)) return { match: 'not-selected', reasons: [] };
  const wanted = { build: release.build?.trim() || null, sha: release.sha?.trim() || null, platform: norm(release.platform) };
  const reasons: string[] = [];
  const platform = norm(facts.platform);
  if (wanted.platform && platform !== wanted.platform) {
    reasons.push(
      platform
        ? `Recorded on ${facts.platform}, the release is on ${release.platform}, so it is not known to apply.`
        : `The platform it ran on was not recorded, so it is not known to apply to ${release.platform}.`
    );
    return { match: 'unknown', reasons };
  }
  // Each part of the release is compared where the evidence has an answer; a part it cannot answer is unknown.
  const parts: ('same' | 'different' | 'unknown')[] = [];
  if (wanted.build) {
    if (!facts.build) {
      parts.push('unknown');
      reasons.push(`The build it ran against was not recorded, so it cannot be compared with build ${wanted.build}.`);
    } else if (norm(facts.build) === norm(wanted.build)) parts.push('same');
    else {
      parts.push('different');
      reasons.push(`Recorded against build ${facts.build}, not build ${wanted.build}.`);
    }
  }
  if (wanted.sha) {
    if (!facts.sha) {
      parts.push('unknown');
      reasons.push(`The commit it ran against was not recorded, so it cannot be compared with ${wanted.sha.slice(0, 7)}.`);
    } else if (sameCommit(facts.sha, wanted.sha)) parts.push('same');
    else {
      parts.push('different');
      reasons.push(`Recorded at commit ${facts.sha.slice(0, 7)}, not ${wanted.sha.slice(0, 7)}.`);
    }
  }
  if (parts.includes('different')) {
    const named = [wanted.build, wanted.sha].filter((each): each is string => each !== null);
    const covered = assertion?.builds.some((each) => named.some((name) => norm(each) === norm(name) || sameCommit(each, name))) ?? false;
    if (covered && promise === 'same') {
      if (assertion!.by) {
        return { match: 'asserted', reasons: [`${assertion!.by} asserts this evidence still holds for the release. That is a stated policy, not a match of builds.`] };
      }
      reasons.push('It is asserted to hold for this release, but no policy or author stands behind the assertion, so it is not accepted.');
      return { match: 'unknown', reasons };
    }
    return { match: 'other', reasons };
  }
  if (parts.includes('unknown')) return { match: 'unknown', reasons };
  if (facts.provenance) {
    reasons.push(
      facts.provenance === 'modified'
        ? 'It was recorded from a checkout with uncommitted changes, so it cannot be an exact match of the release.'
        : 'Where it was recorded from was not captured, so it cannot be an exact match of the release.'
    );
    return { match: 'unknown', reasons };
  }
  return { match: 'exact', reasons };
}

/** One recorded result against the promise (current and recorded fingerprints) and the release. */
function read(recorded: Recorded, revision: Revision, release: ReleaseIdentity, source: { result: EvidenceResult | null; layer: string }): Assessment {
  const facts = factsFrom(recorded);
  const assertion = assertionFrom(recorded.labels);
  const { match, reasons } = matchRelease(facts, release, revision.match, assertion);
  const promiseReason =
    revision.match === 'different'
      ? 'The promise changed after this evidence was recorded. It is not proof of the current promise.'
      : revision.match === 'unknown'
        ? 'The revision of the promise it was recorded against was not captured, so it is not tied to the current promise.'
        : null;
  const stale = revision.match === 'different' || match === 'other';
  const unknown = revision.match === 'unknown' || match === 'unknown';
  return {
    verdict: stale ? 'stale' : unknown ? 'unknown' : 'applies',
    promise: revision.match,
    release: match,
    facts,
    assertion,
    reasons: [...(promiseReason ? [promiseReason] : []), ...reasons],
    result: source.result,
    layer: source.layer,
    others: 0
  };
}

/** One result against the promise and the release. */
export function assessResult(result: EvidenceResult, revisions: RevisionSource, release: ReleaseIdentity): Assessment {
  const revision = compareRevisions(revisions.current, revisions.recorded(result.layer.id));
  return read(ofResult(result), revision, release, { result, layer: result.layer.id });
}

const NOTHING = (release: ReleaseIdentity): Assessment => ({
  verdict: 'none',
  promise: 'unknown',
  release: hasRelease(release) ? 'unknown' : 'not-selected',
  facts: null,
  assertion: null,
  reasons: [],
  result: null,
  layer: null,
  others: 0
});

/** The reading that best applies (applies, then unknown, then stale; the newest execution among equals), with how many were set aside. */
function best(readings: Assessment[]): Assessment {
  readings.sort((a, b) => RANK[a.verdict] - RANK[b.verdict] || b.facts!.executedAtMs - a.facts!.executedAtMs);
  return { ...readings[0]!, others: readings.length - 1 };
}

/**
 * The reading of a behavior's evidence: every completed result is read and the one that best applies is kept
 * (applies, then unknown, then stale; the newest execution among equals), so a recording on the release's platform is
 * not hidden by a newer one elsewhere. A behavior with no completed result has `none`. The behavior's coverage state
 * and its results' statuses are unchanged by this.
 */
export function assessBehavior(behavior: Behavior, revisions: RevisionSource, release: ReleaseIdentity): Assessment {
  const completed = (behavior.slot?.outcomes ?? []).filter((result) => result.row.status === 'passed' || result.row.status === 'failed');
  if (completed.length === 0) return NOTHING(release);
  return best(completed.map((result) => assessResult(result, revisions, release)));
}

/**
 * The reading of a test of the catalog from its current results: the spec's fingerprint now (`test.spec.fingerprint`) against
 * the one each result recorded (`specRevision`), and the build, commit, platform and provenance each states. The same
 * rules as {@link assessBehavior}; a result without a recorded revision, or a test whose spec has no fingerprint, is unknown.
 * Only completed results (passed or failed) are read; a test with none has `none`. Statuses are unchanged by this.
 */
export function assessTest(test: TestSummary, release: ReleaseIdentity): Assessment {
  const completed = test.outcomes.filter((outcome) => outcome.status === 'passed' || outcome.status === 'failed');
  if (completed.length === 0) return NOTHING(release);
  const current = test.spec?.fingerprint ?? null;
  return best(completed.map((outcome) => read(ofOutcome(outcome), compareRevisions(current, outcome.specRevision), release, { result: null, layer: outcome.layer })));
}

/**
 * The order the explorer lists tests in when sorted by evidence: what needs a look first (stale, then unknown, then
 * without evidence), evidence that applies last. A rank for sorting only; it is never shown as a status.
 */
export function attentionRank(assessment: Assessment): number {
  return { stale: 0, unknown: 1, none: 2, applies: 3 }[assessment.verdict];
}

/** Whether a behavior belongs under "stale or unverified": anything but evidence that applies. */
export function needsAttention(assessment: Assessment): boolean {
  return assessment.verdict !== 'applies';
}
