/**
 * @module Behavior coverage
 *
 * Reads a feature the way a product reader does: each scenario (or each concrete example of an outline) is one
 * behavior, and each behavior is in exactly one coverage state. The states keep apart what a green count would blur:
 * a passing test with a playable recording of the current promise is `demonstrated`; a passing test with no
 * recording, with a recording of an older revision of the spec, or only in API environments is not. Nothing here
 * decides an outcome: statuses and winners come from the combined report, and a state is a reading of them.
 * A missing fingerprint, recording or result is unknown or missing, never a pass.
 */
import type { CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import type { EvidenceResult } from '@crvouga/atlas/reports/layer-merge';

import { exampleIndexFor, exampleRows, scenarioLabel, type FeatureScenario } from './gherkin';

/** Where a behavior stands, from the most reassuring to the least. */
export type CoverageState =
  | 'demonstrated'
  | 'outdated-recording'
  | 'recording-missing'
  | 'no-recording'
  | 'api-only'
  | 'failed'
  | 'running'
  | 'skipped'
  | 'parked'
  | 'unexecuted';

/** What each state is called and why, in the order a summary lists them. */
export const COVERAGE: Readonly<Record<CoverageState, { readonly label: string; readonly meaning: string; readonly color: string }>> = {
  demonstrated: {
    label: 'Demonstrated',
    meaning: 'A passing result with a recording of the current promise.',
    color: 'green'
  },
  'outdated-recording': {
    label: 'Recording is older',
    meaning: 'A passing result, but the recording is of an earlier revision of the spec.',
    color: 'orange'
  },
  'recording-missing': {
    label: 'Recording missing',
    meaning: 'A passing result whose expected recording was not published or cannot be played.',
    color: 'orange'
  },
  'no-recording': {
    label: 'No recording',
    meaning: 'A passing result with nothing to watch.',
    color: 'gray'
  },
  'api-only': {
    label: 'API only',
    meaning: 'A passing result recorded only through the API, so there is no screen to watch.',
    color: 'gray'
  },
  failed: {
    label: 'Failed',
    meaning: 'The latest result failed.',
    color: 'red'
  },
  running: {
    label: 'Running',
    meaning: 'A run is checking it now.',
    color: 'blue'
  },
  skipped: {
    label: 'Skipped',
    meaning: 'It was reported as skipped or not run.',
    color: 'gray'
  },
  parked: {
    label: 'Parked',
    meaning: 'The scenario is tagged as parked or work in progress, and has no result.',
    color: 'gray'
  },
  unexecuted: {
    label: 'Not executed',
    meaning: 'No test reported a result for it.',
    color: 'gray'
  }
};

/** The order a coverage summary lists states in. */
export const COVERAGE_ORDER = Object.keys(COVERAGE) as CoverageState[];

/** How the spec the evidence was recorded against compares with the spec now. */
export type Revision = {
  /** Fingerprint of the spec now (the promise). Null when the outline has none. */
  readonly promise: string | null;
  /** Fingerprint of the spec when the evidence was recorded. Null when the layer did not record one. */
  readonly evidence: string | null;
  /** `same`, `different`, or `unknown` when either side is missing. */
  readonly match: 'same' | 'different' | 'unknown';
};

/** Compares two fingerprints: unknown unless both are there. */
export function compareRevisions(promise: string | null | undefined, evidence: string | null | undefined): Revision {
  const now = promise || null;
  const then = evidence || null;
  return {
    promise: now,
    evidence: then,
    match: now === null || then === null ? 'unknown' : now === then ? 'same' : 'different'
  };
}

/** The tags that mark a scenario as deliberately not running, and the state each gives it. */
const TAG_STATE: Readonly<Record<string, CoverageState>> = {
  parked: 'parked',
  wip: 'parked',
  pending: 'parked',
  skip: 'skipped',
  skipped: 'skipped',
  ignore: 'skipped'
};

/** The tags that say a recording was picked to stand for a behavior. */
const REPRESENTATIVE = new Set(['demo', 'representative']);

/** Whether a recorded result or its scenario is tagged as the representative demo. */
export function isRepresentative(tags: readonly string[]): boolean {
  return tags.some((tag) => REPRESENTATIVE.has(tag.replace(/^[#@]/, '').toLowerCase()));
}

/** A result's playable video references: those that name bytes. */
function playable(result: EvidenceResult): number {
  return result.row.evidence?.videos?.filter((video) => video.available).length ?? 0;
}

/** Environments a reader cannot watch: a result recorded only through these has no screen. */
function isApi(environment: string | null): boolean {
  return environment !== null && /^(api|http|rest|graphql|service|backend)(-|$)/.test(environment);
}

/** What is known about one behavior. */
export type Behavior = {
  /** Stable within the page: the scenario and its example. */
  readonly key: string;
  readonly scenario: FeatureScenario;
  /** The example label of an outline's row (what the producer named it), or null for a plain scenario. */
  readonly example: string | null;
  /** The recorded check, or null when nothing reported on it. */
  readonly slot: CheckSlot | null;
  readonly state: CoverageState;
  /** The result to watch: the newest of those with a playable recording, preferring one of the current revision. */
  readonly demo: EvidenceResult | null;
  /** The result the revision line and provenance describe: the demo, else the newest. */
  readonly subject: EvidenceResult | null;
  readonly revision: Revision;
  /** Whether the scenario or the recorded result is tagged as the representative demo. */
  readonly representative: boolean;
};

/** What the page knows about the spec as it is now and as each layer recorded it. */
export type RevisionSource = {
  /** The spec's fingerprint now. */
  readonly current: string | null;
  /** The fingerprint a layer recorded for this spec, if it did. */
  readonly recorded: (layerId: string) => string | undefined;
};

/**
 * The state of one behavior from its recorded check (or none). A failing, running or skipped result is that, whatever
 * recordings exist. A pass is `demonstrated` only with a playable recording that is not known to be of another
 * revision; a recording whose revision cannot be compared is still shown, with the revision stated as unknown.
 */
export function behaviorOf(
  scenario: FeatureScenario,
  slot: CheckSlot | null,
  example: string | null,
  revisions: RevisionSource,
  key: string
): Behavior {
  const outcomes = slot?.outcomes ?? [];
  const revisionOf = (result: EvidenceResult | null) =>
    compareRevisions(revisions.current, result ? revisions.recorded(result.layer.id) : undefined);
  const withVideo = outcomes.filter((result) => result.row.status === 'passed' && playable(result) > 0);
  const demo = withVideo.find((result) => revisionOf(result).match !== 'different') ?? withVideo[0] ?? null;
  const subject = demo ?? outcomes[0] ?? null;
  const revision = revisionOf(subject);
  const representative =
    isRepresentative(scenario.tags) ||
    outcomes.some((result) => isRepresentative([...(result.row.evidence?.tags ?? []), ...(result.row.evidence?.artifactTags ?? [])]));
  const base = {
    key,
    scenario,
    example,
    slot,
    demo,
    subject,
    revision,
    representative
  };
  if (!slot || outcomes.length === 0) {
    const tagged = scenario.tags.map((tag) => TAG_STATE[tag.toLowerCase()]).find((state) => state !== undefined);
    return { ...base, state: tagged ?? 'unexecuted' };
  }
  if (slot.status === 'failed') return { ...base, state: 'failed' };
  if (slot.status === 'running') return { ...base, state: 'running' };
  if (slot.status === 'not-run') return { ...base, state: 'skipped' };
  if (demo)
    return {
      ...base,
      state: revision.match === 'different' ? 'outdated-recording' : 'demonstrated'
    };
  const passed = outcomes.filter((result) => result.row.status === 'passed');
  // A recording was promised and is not here, or is referenced without bytes: that is a gap, not an API test.
  if (
    passed.some((result) => result.row.recording && !['uploaded', 'referenced', 'not-applicable'].includes(result.row.recording.state)) ||
    passed.some((result) => (result.row.evidence?.videos?.length ?? 0) > 0)
  ) {
    return { ...base, state: 'recording-missing' };
  }
  if (passed.length > 0 && passed.every((result) => isApi(result.layer.environment))) return { ...base, state: 'api-only' };
  return { ...base, state: 'no-recording' };
}

/**
 * Every behavior of a scenario. A plain scenario is one. An outline is one per example row, never the template as an
 * extra: a recorded example is filed under the row it names; a row nothing reported on is `unexecuted` (or parked);
 * a recorded example whose label names no row is kept as its own behavior and the unclaimed rows are counted against
 * the recorded results that remain, so the total never exceeds the rows by inventing a template.
 */
export function scenarioBehaviors(
  scenario: FeatureScenario,
  slots: readonly CheckSlot[],
  feature: string,
  revisions: RevisionSource
): Behavior[] {
  const rows = exampleRows(scenario);
  if (rows.length === 0) {
    // A scenario with no examples fills one slot per environment/parameter set, which the slot already groups.
    const slot = slots[0] ?? null;
    if (slots.length <= 1) return [behaviorOf(scenario, slot, null, revisions, scenario.name)];
    return slots.map((each) => behaviorOf(scenario, each, null, revisions, each.key));
  }
  const claimed = new Map<number, CheckSlot[]>();
  const loose: CheckSlot[] = [];
  for (const slot of slots) {
    const label = scenarioLabel(feature, slot.title).slice(scenario.name.length + 3);
    const at = exampleIndexFor(scenario, label);
    if (at < 0) loose.push(slot);
    else claimed.set(at, [...(claimed.get(at) ?? []), slot]);
  }
  const behaviors: Behavior[] = [];
  const unmatched = rows.map((_, at) => at).filter((at) => !claimed.has(at));
  // Results whose wording matches no row stand in for the rows nothing claimed, in order, before any row is called unexecuted.
  const spare = [...loose];
  rows.forEach((entry, at) => {
    const found = claimed.get(at) ?? (unmatched.includes(at) && spare.length ? [spare.shift()!] : []);
    const label = found[0] ? scenarioLabel(feature, found[0].title).slice(scenario.name.length + 3) : entry.row.join(', ');
    if (found.length === 0) behaviors.push(behaviorOf(scenario, null, label, revisions, `${scenario.name}:${at}`));
    for (const slot of found) behaviors.push(behaviorOf(scenario, slot, label, revisions, slot.key));
  });
  for (const slot of spare)
    behaviors.push(behaviorOf(scenario, slot, scenarioLabel(feature, slot.title).slice(scenario.name.length + 3), revisions, slot.key));
  return behaviors;
}

/** Behaviors counted by state. Every state is present, so an absent one reads as zero, not as unknown. */
export type CoverageCounts = Readonly<Record<CoverageState, number>>;

/** Counts behaviors by coverage state; only `demonstrated` is a demonstrated pass. */
export function coverageCounts(behaviors: readonly Behavior[]): CoverageCounts {
  const counts = Object.fromEntries(COVERAGE_ORDER.map((state) => [state, 0])) as Record<CoverageState, number>;
  for (const behavior of behaviors) counts[behavior.state] += 1;
  return counts;
}
