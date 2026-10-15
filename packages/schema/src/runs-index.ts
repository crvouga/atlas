/**
 * @module Runs index
 *
 * `runs/index.json`, the list of statechart runs a host serves, newest first, and the summary the viewer keeps for
 * each. The index lists runs as `unknown` so a reader can validate each summary on its own and drop the ones that do
 * not parse.
 *
 * @see docs/statecharts.md
 */
import { z } from 'zod/v4';

import { CountSchema } from './common.js';
import { RunInfoSchema } from './manifest';

/** Whether a run is still being written (`running`) or finished (`complete`). */
export const RUN_PROGRESS = ['running', 'complete'] as const;

/**
 * One run in the index: its id, start, mode, commit, branch, duration and spec version, whether it is `running` or
 * complete, the planned and completed path counts of a running run, whether its manifest exists yet, and the state,
 * transition and journey tallies.
 */
export const RunSummarySchema = z.object({
  id: z.string().min(1),
  startedAt: z.string(),
  mode: z.string().optional(),
  commit: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  durationMs: z.number().nonnegative().optional(),
  specVersion: z.string().optional(),
  progress: z.enum(RUN_PROGRESS).optional().describe('Absent means complete'),
  execution: RunInfoSchema.shape.progress,
  hasManifest: z.boolean().optional().describe('False while the first snapshot has not arrived'),
  coverage: z.object({ states: CountSchema, transitions: CountSchema }).partial().optional(),
  journeys: CountSchema.optional()
});
/** A parsed `RunSummarySchema` value. */
export type RunSummary = z.infer<typeof RunSummarySchema>;

/** `runs/index.json`: the runs a host serves, newest first. */
export const RunsIndexSchema = z.object({
  generatedAt: z.string().optional(),
  runs: z.array(z.unknown()),
  excluded: z.array(z.string()).optional()
});
