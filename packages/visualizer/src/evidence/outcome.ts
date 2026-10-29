/**
 * @module Outcome explanation
 *
 * Pure reading of what one selected result says, set beside everything else recorded for the same check, so a
 * detail never leads with a summary that contradicts its evidence. The selected source's outcome, the other current
 * sources, where a failure happened, whether the behavior was reached, and the chronology of one source are all
 * stated separately. Nothing here changes a status or a winner: it only words what was recorded, and anything that
 * was not recorded stays unknown. In particular a failure is never attributed to the product, the test harness or
 * the environment from the wording of its message; only a producer's own `atlas.failure` declaration is shown.
 */
import type { HistoryEntry, CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import { isVideoAttachment, type EvidenceHolder } from '@crvouga/atlas/reports/evidence-detail';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import type { EvidenceResult } from '@crvouga/atlas/reports/layer-merge';
import type { ReportStep, RunReport } from '@crvouga/atlas/reports/report-types';
import type { Attachment, Step } from '@crvouga/atlas/schema';
import { ago, shortSha, statusWord } from './format';

/** The extension key under which a producer may declare why and where a check failed. */
export const FAILURE_EXTENSION = 'atlas.failure';

/** Who a producer declared a failure to be the fault of. Absent is unknown, never inferred. */
export type Attribution = 'product' | 'test-harness' | 'environment';

const ATTRIBUTIONS: readonly string[] = ['product', 'test-harness', 'environment'];

/** What a producer declared about a failure: the expectation, what was observed, and optionally whose fault it was. */
export type FailureNote = {
  readonly expected?: string;
  readonly actual?: string;
  readonly attribution?: Attribution;
};

/** Whether the failed step belongs to getting ready for the behavior, to the behavior itself, or is not known to be either. */
export type Phase = 'setup' | 'behavior' | 'unspecified';

/** Step kinds (an open vocabulary) that are preparation, not the behavior under test. */
const SETUP_KINDS = new Set(['hook', 'setup', 'fixture', 'before', 'beforeall', 'beforeeach', 'given']);
/** Step kinds that are the behavior being exercised or an expectation about it. */
const BEHAVIOR_KINDS = new Set(['when', 'then', 'assertion', 'expect']);

/**
 * Which phase a step of this `kind` belongs to. Decided by the recorded kind only, never by a step's name or message;
 * a kind that is not recognized, or none, is `unspecified`.
 */
export function phaseOf(kind: string | undefined): Phase {
  const key = kind?.toLowerCase();
  if (!key) return 'unspecified';
  return SETUP_KINDS.has(key) ? 'setup' : BEHAVIOR_KINDS.has(key) ? 'behavior' : 'unspecified';
}

/** The step at which a result failed, as far as the recording says. */
export type FailurePoint = {
  readonly name: string;
  readonly kind: string | undefined;
  readonly phase: Phase;
  /** The step's own message, as recorded. */
  readonly detail: string | undefined;
  /** How long after the check started it began, when recorded. */
  readonly offsetMs: number | undefined;
  readonly note: FailureNote | undefined;
  /** The videos on the step itself, if it has any. */
  readonly videos: readonly Attachment[];
};

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * The failure a producer declared under {@link FAILURE_EXTENSION} in `extensions`: `expected`, `actual` and an
 * `attribution` of `product`, `test-harness` or `environment`. Anything else is ignored; undefined when nothing usable is there.
 */
export function failureNote(extensions: Readonly<Record<string, unknown>> | undefined): FailureNote | undefined {
  const raw = extensions?.[FAILURE_EXTENSION];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { expected, actual, attribution } = raw as Record<string, unknown>;
  const note: { expected?: string; actual?: string; attribution?: Attribution } = {};
  const e = text(expected);
  const a = text(actual);
  if (e !== undefined) note.expected = e;
  if (a !== undefined) note.actual = a;
  if (typeof attribution === 'string' && ATTRIBUTIONS.includes(attribution)) note.attribution = attribution as Attribution;
  return Object.keys(note).length ? note : undefined;
}

/**
 * The first failed step of a recorded check, preferring the innermost one (a failed action inside a failed group is
 * the action). Steps are ordered by their start offset, else by their position. Undefined when no step failed or none
 * was recorded.
 */
export function failedStepOf(steps: readonly Step[] | undefined): Step | undefined {
  if (!steps?.length) return undefined;
  const failedParents = new Set(steps.filter((step) => step.status === 'failed' && step.parentId).map((step) => step.parentId));
  const order = steps.map((step, index) => ({ step, index }));
  order.sort((a, b) => (a.step.offsetMs ?? 0) - (b.step.offsetMs ?? 0) || a.index - b.index);
  return order.find(({ step }) => step.status === 'failed' && !(step.id !== undefined && failedParents.has(step.id)))?.step;
}

/** {@link failedStepOf} described as the point a failure happened at: its kind and phase, message, offset and own videos. */
export function failedStep(steps: readonly Step[] | undefined): FailurePoint | undefined {
  const found = failedStepOf(steps);
  if (!found) return undefined;
  return {
    name: found.name,
    kind: found.kind,
    phase: phaseOf(found.kind),
    detail: found.detail,
    offsetMs: found.offsetMs,
    note: failureNote(found.extensions),
    videos: (found.attachments ?? []).filter(isVideoAttachment)
  };
}

/** The first innermost failed step of an Atlas run's own timeline (see {@link failedStep}). */
export function failedReportStep(report: RunReport | undefined): FailurePoint | undefined {
  if (!report) return undefined;
  const walk = (steps: readonly ReportStep[]): ReportStep | undefined => {
    for (const step of steps) {
      if (step.status !== 'failed') continue;
      return walk(step.steps) ?? step;
    }
    return undefined;
  };
  const found = walk(report.steps);
  if (!found) return undefined;
  return {
    name: found.title,
    kind: found.kind,
    phase: phaseOf(found.kind),
    detail: found.error,
    offsetMs: Math.max(0, found.startedAtMs - report.meta.startedAtMs),
    note: undefined,
    videos: []
  };
}

/** The recorded videos a holder carries on itself, its steps and its attempts. */
export function videosIn(holder: EvidenceHolder | undefined): Attachment[] {
  if (!holder) return [];
  return [
    ...(holder.attachments ?? []).filter(isVideoAttachment),
    ...(holder.steps ?? []).flatMap((step) => (step.attachments ?? []).filter(isVideoAttachment)),
    ...(holder.attempts ?? []).flatMap((attempt) => [
      ...(attempt.attachments ?? []).filter(isVideoAttachment),
      ...(attempt.steps ?? []).flatMap((step) => (step.attachments ?? []).filter(isVideoAttachment))
    ])
  ];
}

/** The one-line statement of what the failure point says about the behavior. */
export function reachOf(point: FailurePoint | undefined): { readonly state: 'setup-failed' | 'expectation-failed' | 'unknown'; readonly text: string } {
  if (!point) return { state: 'unknown', text: 'Where it failed was not recorded, so whether the behavior was reached is unknown.' };
  if (point.phase === 'setup')
    return { state: 'setup-failed', text: `Behavior not verified: setup failed at “${point.name}”. The execution is still recorded as failed.` };
  if (point.phase === 'behavior')
    return { state: 'expectation-failed', text: `The behavior was reached and an expectation was not met at “${point.name}”.` };
  return { state: 'unknown', text: `Failed at “${point.name}”. Whether the behavior was reached is not recorded.` };
}

const WORD = { passed: 'passed', failed: 'failed', running: 'is still running', 'not-run': 'was not run' } as const;

/** Counts of results by status, in words: `1 passed, 2 failed`. */
function tally(results: readonly EvidenceResult[]): string {
  const counts = new Map<string, number>();
  for (const { row } of results) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  return (['passed', 'failed', 'running', 'not-run'] as const)
    .filter((status) => counts.has(status))
    .map((status) => `${counts.get(status)} ${status === 'not-run' ? 'not run' : status}`)
    .join(', ');
}

/** What the selected result says, and the current results of the other sources it must be read beside. */
export type Headline = {
  readonly text: string;
  /** The current results from other sources than the selected one, newest first. */
  readonly others: readonly EvidenceResult[];
  /** False when the selected result is an earlier one that a newer run has replaced in the combined report. */
  readonly current: boolean;
};

/**
 * The heading for a selected result: its own outcome first, then what the other current sources recorded. A passing
 * selection beside a failing source says both; an earlier result says it is earlier and names the combined status.
 * Never reads the selected outcome as the check's status.
 */
export function outcomeHeadline(selected: HistoryEntry, slot: CheckSlot): Headline {
  const current = slot.outcomes.some((outcome) => outcome.layer.id === selected.layer.id);
  const others = slot.outcomes.filter((outcome) => outcome.layer.id !== selected.layer.id);
  const own = WORD[selected.row.status];
  if (!current) {
    return {
      current,
      others,
      text: `This earlier result ${own}; the combined report now shows ${statusWord(slot.status).toLowerCase()} across ${others.length === 1 ? 'its current source' : `its ${others.length} current sources`}`
    };
  }
  const failed = others.filter((outcome) => outcome.row.status === 'failed').length;
  let text = `Selected result ${own}`;
  if (selected.row.status === 'passed' && failed > 0) text += `; ${failed === 1 ? 'another scoped source' : `${failed} other scoped sources`} failed`;
  else if (others.length > 0) text += `; ${others.length === 1 ? 'the other scoped source' : 'other scoped sources'}: ${tally(others)}`;
  return { current, others, text };
}

/**
 * The result a detail shows: the run the address pins, else the current result of the source it names, else the newest.
 * Undefined only for a check with no result.
 */
export function selectedResult(slot: CheckSlot, pinned?: HistoryEntry, source?: string): HistoryEntry | undefined {
  if (pinned) return pinned;
  const found = (source ? slot.outcomes.find((outcome) => outcome.layer.id === source) : undefined) ?? slot.outcomes[0];
  return found ? { layer: found.layer, row: found.row } : undefined;
}

/** How a choosable source is told apart from its siblings without reading opaque producer ids. */
export type SourceLabel = {
  /** The environment and parameters, or the producer when neither is named. */
  readonly name: string;
  /** Status in words. */
  readonly status: string;
  /** When it was recorded, relative. */
  readonly when: string;
  /** The commit, or the branch, or `revision not recorded`. */
  readonly revision: string;
  /** Present when other sources share the same name: its place among them, newest first, and its producer. */
  readonly attempt: string | undefined;
  /** All of the above in one line. */
  readonly text: string;
};

/**
 * Labels for the current results of a check so each can be told from the others by status, time, revision and,
 * when several share a name, its place among them. `now` is epoch milliseconds.
 */
export function sourceLabels(outcomes: readonly EvidenceResult[], now: number): SourceLabel[] {
  const names = outcomes.map((outcome) => {
    const environment = outcome.layer.environment ? environmentLabel(outcome.layer.environment) : '';
    const parameters = Object.entries(outcome.parameters)
      .map(([name, value]) => `${name}: ${value}`)
      .join(', ');
    return [environment, parameters].filter(Boolean).join(' · ') || outcome.layer.producer;
  });
  return outcomes.map((outcome, index) => {
    const name = names[index]!;
    const siblings = names.flatMap((each, at) => (each === name ? [at] : []));
    const attempt =
      siblings.length > 1 ? `result ${siblings.indexOf(index) + 1} of ${siblings.length} from ${outcome.layer.producer}` : undefined;
    const revision = shortSha(outcome.layer.sha) ?? outcome.layer.branch ?? 'revision not recorded';
    const status = statusWord(outcome.row.status);
    const when = ago(outcome.layer.recordedAtMs, now);
    return { name, status, when, revision, attempt, text: [name, status, when, revision, attempt].filter(Boolean).join(' · ') };
  });
}

/** What the chronology needs to know of one recorded result, whether it came from the held layers or from a test's history. */
export type ResultRecord = {
  /** The id of the layer that recorded it. */
  readonly layer: string;
  readonly kind: string;
  readonly status: HistoryEntry['row']['status'];
  readonly at: number;
  readonly sha: string | null;
  readonly producer: string;
  readonly environment: string | null;
  readonly parameters: Readonly<Record<string, string>>;
};

/** The record of a layer's result. */
export function recordOf(entry: HistoryEntry): ResultRecord {
  const { layer, row } = entry;
  return {
    layer: layer.id,
    kind: row.kind,
    status: row.status,
    at: layer.recordedAtMs,
    sha: layer.sha,
    producer: layer.producer,
    environment: layer.environment,
    parameters: layer.parameters
  };
}

/** One record of the selected result's own source, for the chronology. */
export type ChronologyEntry = { readonly record: ResultRecord; readonly selected: boolean };

function samePlace(a: ResultRecord, b: ResultRecord): boolean {
  return (
    a.producer === b.producer &&
    a.environment === b.environment &&
    JSON.stringify(Object.entries(a.parameters).sort()) === JSON.stringify(Object.entries(b.parameters).sort())
  );
}

/**
 * The records of the selected result's own source (same producer, environment and parameters), oldest first, one per
 * layer. Empty when there is only one, or when they all have the same outcome, so there is no chronology to tell.
 */
export function chronology(selected: ResultRecord, history: readonly ResultRecord[]): ChronologyEntry[] {
  const seen = new Set<string>();
  const own = history
    .filter((record) => samePlace(record, selected) && !seen.has(`${record.layer}|${record.kind}`) && seen.add(`${record.layer}|${record.kind}`))
    .sort((a, b) => a.at - b.at);
  if (own.length < 2 || new Set(own.map((record) => record.status)).size < 2) return [];
  return own.map((record) => ({ record, selected: record.layer === selected.layer && record.kind === selected.kind }));
}

/** Whether the newest record of a chronology passed after an earlier one failed. */
export function passedAfterFailure(entries: readonly ChronologyEntry[]): boolean {
  const last = entries.at(-1);
  return last !== undefined && last.record.status === 'passed' && entries.slice(0, -1).some((each) => each.record.status === 'failed');
}
