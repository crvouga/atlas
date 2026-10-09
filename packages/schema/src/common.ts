import { z } from 'zod/v4';

export const RUN_STATUSES = ['passed', 'failed', 'flaky', 'not-reached'] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * Who or what sends an event: a person using the product (`user`), another system (`system`), the
 * passage of time (`time`), or a child chart handing control back to its parent (`hand-off`).
 * `member` is read as `user`, for specs written before the kinds were renamed.
 */
export const EVENT_KINDS = ['user', 'system', 'time', 'hand-off'] as const;
export const EventKindSchema = z.preprocess(
  (value) => (value === 'member' ? 'user' : value),
  z.enum(EVENT_KINDS)
);
export type EventKind = z.infer<typeof EventKindSchema>;

export const CONFIDENCES = ['confirmed', 'assumed'] as const;
export const ConfidenceSchema = z.enum(CONFIDENCES);
export type Confidence = z.infer<typeof ConfidenceSchema>;

const ScreenSchema = z.object({
  png: z.string().min(1),
  webp: z.string().min(1).describe('About 400 px wide, for the map'),
  client: z.string().optional().describe('Which client\'s screen it is, in a multi-client run')
});

export const ImageSchema = ScreenSchema.extend({
  also: z.array(ScreenSchema.partial({ webp: true })).optional().describe("The other clients' screens at the same moment")
});
export type Image = z.infer<typeof ImageSchema>;

export const CountSchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  flaky: z.number().int().nonnegative(),
  notReached: z.number().int().nonnegative()
});
export type Count = z.infer<typeof CountSchema>;

export const ISSUE_SEVERITIES = ['error', 'warning', 'info'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export type DataIssue = {
  severity: IssueSeverity;
  file: string;
  path: string;
  message: string;
};

export const TRANSITION_ID_SEPARATOR = ' :: ';

export function transitionId(source: string, event: string) {
  return `${source}${TRANSITION_ID_SEPARATOR}${event}`;
}
