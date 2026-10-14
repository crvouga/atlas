/**
 * @module Shared statechart vocabulary
 *
 * Small schemas and types used by both the run manifest (`manifest.ts`) and the spec formats (`spec.ts`): the status
 * of a run result, who sends an event, how sure a spec is, screenshot references, status tallies, the shape of a
 * reading problem, and the transition id convention. The statuses and kinds are written by `atlas run` and read by
 * the visualizer.
 *
 * @see docs/statecharts.md
 */
import { z } from 'zod/v4';

/**
 * Outcome of a state, transition, path or journey in a statechart run: `passed`, `failed`, `flaky` (failed on the
 * first attempt and passed on the retry) or `not-reached` (no path got there, or the path was blocked before it).
 */
export const RUN_STATUSES = ['passed', 'failed', 'flaky', 'not-reached'] as const;
/** Zod enum over `RUN_STATUSES`. */
export const RunStatusSchema = z.enum(RUN_STATUSES);
/** One of `RUN_STATUSES`. */
export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * Who or what sends an event: a person using the product (`user`), another system (`system`), the
 * passage of time (`time`), or a child chart handing control back to its parent (`hand-off`).
 * `member` is read as `user`, for specs written before the kinds were renamed.
 */
export const EVENT_KINDS = ['user', 'system', 'time', 'hand-off'] as const;
/**
 * Zod schema for an `EVENT_KINDS` value that first rewrites the legacy value `member` to `user`, so specs written
 * before the kinds were renamed still parse.
 */
export const EventKindSchema = z.preprocess(
  (value) => (value === 'member' ? 'user' : value),
  z.enum(EVENT_KINDS)
);
/** One of `EVENT_KINDS`. */
export type EventKind = z.infer<typeof EventKindSchema>;

/**
 * How sure a spec is about a state's description (`meta.confidence`): `confirmed` or `assumed`. A run records
 * `assumed` for a state whose spec does not say.
 */
export const CONFIDENCES = ['confirmed', 'assumed'] as const;
/** Zod enum over `CONFIDENCES`. */
export const ConfidenceSchema = z.enum(CONFIDENCES);
/** One of `CONFIDENCES`. */
export type Confidence = z.infer<typeof ConfidenceSchema>;

const ScreenSchema = z.object({
  png: z.string().min(1),
  webp: z.string().min(1).optional().describe('About 400 px wide, for the map; the original image is used while a thumbnail is unavailable'),
  client: z.string().optional().describe('Which client\'s screen it is, in a multi-client run')
});

/**
 * A screenshot of a state in a run manifest: `png` and an optional `webp` thumbnail, as paths relative to the run
 * directory (the folder holding `manifest.json`), plus the other clients' screens at the same moment in a
 * multi-client run.
 */
export const ImageSchema = ScreenSchema.extend({
  also: z.array(ScreenSchema.partial({ webp: true })).optional().describe("The other clients' screens at the same moment")
});
/** A parsed `ImageSchema` value. */
export type Image = z.infer<typeof ImageSchema>;

/**
 * Tally of states or transitions by status: `total` and one count per `RUN_STATUSES` value (`notReached` for
 * `not-reached`). Used by manifest coverage and run summaries.
 */
export const CountSchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  flaky: z.number().int().nonnegative(),
  notReached: z.number().int().nonnegative()
});
/** A parsed `CountSchema` value. */
export type Count = z.infer<typeof CountSchema>;

/** Severities of a `DataIssue`, most serious first: `error`, `warning`, `info`. */
export const ISSUE_SEVERITIES = ['error', 'warning', 'info'] as const;
/** One of `ISSUE_SEVERITIES`. */
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

/**
 * A problem found while reading a spec or manifest file, in words a non-engineer can read: how serious it is, which
 * file, where in the file (path segments joined with ` › `), and what is wrong. The visualizer shows these instead of
 * failing to load.
 */
export type DataIssue = {
  severity: IssueSeverity;
  file: string;
  path: string;
  message: string;
};

/**
 * Separator inside a transition id (`<source state> :: <event>`). Ids are not escaped, so a state name containing it
 * makes an id ambiguous. The same value as core's `TRANSITION_SEPARATOR`.
 */
export const TRANSITION_ID_SEPARATOR = ' :: ';

/**
 * Builds the id of a transition, the key of `transitions` in a manifest: the source state's name,
 * `TRANSITION_ID_SEPARATOR`, then the event name.
 */
export function transitionId(source: string, event: string) {
  return `${source}${TRANSITION_ID_SEPARATOR}${event}`;
}
