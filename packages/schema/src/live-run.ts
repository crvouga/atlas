/** @module Live run protocol
 * A live run is a producer lease, separate from immutable report layers. Server receipt times determine liveness.
 * Expiration means interrupted, never passed; completed check results retain the stable layer contract.
 */
import { z } from 'zod/v4';

/** Small progress messages: no attachment bytes, bounded step history and text. */
export const LiveCheckSchema = z.object({
  id: z.string().min(1).max(16384), title: z.string().min(1).max(2048),
  status: z.enum(['running', 'passed', 'failed', 'not-run']), detail: z.string().max(8000).default(''),
  specPath: z.string().max(2048).optional(), durationMs: z.number().finite().nonnegative().optional(),
  steps: z.array(z.object({ name: z.string().max(2048), status: z.string().max(100).optional() })).max(20).optional()
});
/** The producer starts one UUID-named run. Identity stays fixed for its lifetime. */
export const LiveRunStartSchema = z.object({
  id: z.string().uuid(), producer: z.string().min(1).max(200), title: z.string().max(2048).optional(),
  environment: z.string().max(200).optional(), branch: z.string().max(500).optional(), sha: z.string().max(200).optional(),
  plannedChecks: z.number().int().nonnegative().max(1_000_000).optional()
});
/** Ordered deltas. A retried sequence must have identical content; terminal runs never accept more progress. */
export const LiveRunUpdateSchema = z.object({
  sequence: z.number().int().positive(), checks: z.array(LiveCheckSchema).max(1000).refine(checks => new Set(checks.map(check => check.id)).size === checks.length, 'Check ids must be unique in a batch').default([]),
  finish: z.enum(['completed', 'interrupted']).optional(), reason: z.string().max(2000).optional()
});
/** The bounded live feed response; completed and interrupted runs remain visible as recent history. */
export const LiveRunSchema = LiveRunStartSchema.extend({
  status: z.enum(['running', 'completed', 'interrupted']), startedAtMs: z.number(), lastHeartbeatAtMs: z.number(), lastProgressAtMs: z.number(),
  finishedAtMs: z.number().optional(), reason: z.string().optional(), sequence: z.number(),
  completed: z.number(), passed: z.number(), failed: z.number(), notRun: z.number(), running: z.number(),
  current: z.array(LiveCheckSchema), recent: z.array(LiveCheckSchema)
});
/** The shape a producer uses for a progress check. */
export type LiveCheck = z.input<typeof LiveCheckSchema>;
/** A server's live run snapshot. */
export type LiveRun = z.output<typeof LiveRunSchema>;
