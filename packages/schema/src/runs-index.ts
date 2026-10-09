import { z } from 'zod/v4';

import { CountSchema } from './common';
import { RunInfoSchema } from './manifest';

export const RUN_PROGRESS = ['running', 'complete'] as const;

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
export type RunSummary = z.infer<typeof RunSummarySchema>;

/** `runs/index.json`: the runs a host serves, newest first. */
export const RunsIndexSchema = z.object({
  generatedAt: z.string().optional(),
  runs: z.array(z.unknown()),
  excluded: z.array(z.string()).optional()
});
