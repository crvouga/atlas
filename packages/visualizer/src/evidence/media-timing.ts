/**
 * @module Recording timing
 *
 * Where a check's steps are in its recording. A step says when it started on the check's own clock (`offsetMs`, after
 * the check started); a recording has its own clock, which starts when the recorder did. The two are never assumed to
 * agree. A producer that wants a step to be placed in a recording says how the clocks relate under the `atlas.media`
 * extension of the video attachment:
 *
 * ```json
 * { "name": "run.webm", "role": "video", "durationMs": 9000,
 *   "extensions": { "atlas.media": {
 *     "checkStartMs": 1200,                                  // the check started 1.2 s into the recording
 *     "pauses": [{ "atMs": 900, "durationMs": 2000, "reason": "title card" }],  // delay put into the recording, not into the check
 *     "marks": [{ "step": "pay", "mediaMs": 4100 }]          // a step's own moment, when the producer knows it exactly
 *   } } }
 * ```
 *
 * Every field is optional and nothing here decides a status, a slot or a winner. Without a mark or a `checkStartMs` a
 * step is not placed: it is never guessed from the step's name, from the recording starting with the check, or from
 * another recording's timing. A marker outside the recording, or timing that cannot be read, is reported as
 * unavailable with the reason. Pure functions; the player is `moments.tsx`.
 */
import type { Attachment, Step } from '@crvouga/atlas/schema';

/** The extension key under which a producer may relate a recording's clock to its check's. */
export const MEDIA_EXTENSION = 'atlas.media';

/** Time added to the recording and not to the check, such as a title card or a deliberate pause for a viewer. */
export type MediaPause = {
  /** Where on the check's clock the delay was inserted: steps that started at or after it are later in the recording by `durationMs`. */
  readonly atMs: number;
  readonly durationMs: number;
  readonly reason: string | undefined;
};

/** What a recording says about its own clock. */
export type MediaTiming = {
  /** Where on the recording's clock the check started (its `offsetMs` 0). Undefined: not said, so steps are not placed by offset. */
  readonly checkStartMs: number | undefined;
  /** Delays inserted into the recording, in the order they occur. */
  readonly pauses: readonly MediaPause[];
  /** Steps whose moment in the recording is stated outright, by step `id`. */
  readonly marks: ReadonlyMap<string, number>;
  /** Set when the declaration could not be read as a whole; no step is then placed from it. */
  readonly problem: string | undefined;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The timing a video attachment declares under {@link MEDIA_EXTENSION}. Undefined when it declares none. A declaration
 * with a field that cannot be read is kept with a `problem`, so it is reported instead of being half-applied.
 */
export function mediaTimingOf(attachment: Pick<Attachment, 'extensions'>): MediaTiming | undefined {
  const raw = attachment.extensions?.[MEDIA_EXTENSION];
  if (raw === undefined) return undefined;
  const empty = { checkStartMs: undefined, pauses: [], marks: new Map<string, number>() };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...empty, problem: `The ${MEDIA_EXTENSION} declaration is not an object.` };
  const { checkStartMs, pauses, marks } = raw as Record<string, unknown>;
  let problem: string | undefined;
  if (checkStartMs !== undefined && !finite(checkStartMs)) problem = '`checkStartMs` is not a number.';
  const pauseList: MediaPause[] = [];
  if (pauses !== undefined) {
    if (!Array.isArray(pauses)) problem ??= '`pauses` is not a list.';
    else
      for (const pause of pauses as unknown[]) {
        const { atMs, durationMs, reason } = (pause !== null && typeof pause === 'object' ? pause : {}) as Record<string, unknown>;
        if (finite(atMs) && atMs >= 0 && finite(durationMs) && durationMs >= 0)
          pauseList.push({ atMs, durationMs, reason: typeof reason === 'string' ? reason : undefined });
        else problem ??= 'A pause needs a non-negative `atMs` and `durationMs`.';
      }
  }
  const markMap = new Map<string, number>();
  if (marks !== undefined) {
    if (!Array.isArray(marks)) problem ??= '`marks` is not a list.';
    else
      for (const mark of marks as unknown[]) {
        const { step, mediaMs } = (mark !== null && typeof mark === 'object' ? mark : {}) as Record<string, unknown>;
        if (typeof step === 'string' && step !== '' && finite(mediaMs)) markMap.set(step, mediaMs);
        else problem ??= 'A mark needs a step `id` and a `mediaMs`.';
      }
  }
  pauseList.sort((a, b) => a.atMs - b.atMs);
  return { checkStartMs: finite(checkStartMs) ? checkStartMs : undefined, pauses: pauseList, marks: markMap, problem };
}

/** The total length of the delays put into a recording. */
export function pausedMs(timing: MediaTiming | undefined): number {
  return (timing?.pauses ?? []).reduce((sum, pause) => sum + pause.durationMs, 0);
}

/** Where a step is in a recording, or why it is not placed. */
export type Alignment =
  | { readonly state: 'aligned'; readonly mediaMs: number; readonly source: 'mark' | 'offset'; readonly pausedMs: number }
  | { readonly state: 'unavailable'; readonly reason: string };

/** The reasons a step cannot be placed, in words. */
export const UNALIGNED = {
  noTiming:
    'This recording carries no timing metadata, so its steps cannot be placed in it. Atlas does not assume the check started when the recording did, and does not guess from step names.',
  noOrigin: 'This recording does not say where the check starts in it, so a step is not placed by its offset.',
  noOffset: 'This step recorded no start offset and no recording mark, so it cannot be placed.'
} as const;

/**
 * Where `step` is in a recording that declared `timing`, with `durationMs` the recording's length when known. A mark for
 * the step wins; otherwise the recording's clock at the check's start, plus the step's offset, plus the delays inserted
 * before it. A moment before the recording starts or after it ends is unavailable, never clamped.
 */
export function alignStep(step: Pick<Step, 'id' | 'offsetMs'>, timing: MediaTiming | undefined, durationMs: number | undefined): Alignment {
  if (!timing) return { state: 'unavailable', reason: UNALIGNED.noTiming };
  if (timing.problem) return { state: 'unavailable', reason: `The timing metadata of this recording cannot be used: ${timing.problem}` };
  const marked = step.id === undefined ? undefined : timing.marks.get(step.id);
  let mediaMs: number;
  let source: 'mark' | 'offset';
  let paused = 0;
  if (marked !== undefined) {
    mediaMs = marked;
    source = 'mark';
  } else {
    if (timing.checkStartMs === undefined) return { state: 'unavailable', reason: UNALIGNED.noOrigin };
    if (step.offsetMs === undefined) return { state: 'unavailable', reason: UNALIGNED.noOffset };
    paused = timing.pauses.filter((pause) => pause.atMs <= step.offsetMs!).reduce((sum, pause) => sum + pause.durationMs, 0);
    mediaMs = timing.checkStartMs + step.offsetMs + paused;
    source = 'offset';
  }
  if (mediaMs < 0)
    return { state: 'unavailable', reason: `This step is placed ${clock(-mediaMs)} before the recording starts, so it is not in the recording.` };
  if (durationMs !== undefined && durationMs > 0 && mediaMs > durationMs)
    return { state: 'unavailable', reason: `This step is placed at ${clock(mediaMs)}, after the recording ends at ${clock(durationMs)}.` };
  return { state: 'aligned', mediaMs, source, pausedMs: paused };
}

/**
 * The index of the step playing at `timeMs`: the latest placed step that started at or before it (the last of them when
 * several started together, which is the innermost). Null before the first placed step. `placed` are `[index, mediaMs]`.
 */
export function activeIndex(placed: readonly (readonly [number, number])[], timeMs: number): number | null {
  let found: readonly [number, number] | null = null;
  for (const entry of placed) if (entry[1] <= timeMs && (found === null || entry[1] >= found[1])) found = entry;
  return found === null ? null : found[0];
}

/** A position in a recording as `m:ss.s`: `0:04.2`. */
export function clock(ms: number): string {
  const tenths = Math.round(Math.max(0, ms) / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths % 600) / 10;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds.toFixed(1)}`;
}
