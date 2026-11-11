/**
 * @module UI catalog CI matrix plans
 *
 * What `atlas ui-catalog plan-matrix` prints: a CI fan-out for one resolved catalog definition, ready for a GitHub Actions
 * `strategy.matrix` (`fromJSON(…).matrix`). Each row (`job`) covers a distinct combination of the dimensions chosen to
 * split jobs; together the rows cover every allowed profile exactly once. `builds` lists each distinct build (the
 * combinations of the dimensions that change what is built) once, so a build runs once per mode and the capture jobs that
 * need it download it. The definition document is carried whole, so every job collects the same immutable definition.
 *
 * @see docs/ui-catalog.md#a-ci-kit-plan-capture-finalize
 */
import { z } from 'zod/v4';

import { UiCatalogDefinitionSchema } from './ui-catalog-queue';

/** The `schemaVersion` of a matrix plan. */
export const UI_CATALOG_MATRIX_VERSION = 1;

const Count = z.number().int().nonnegative();

/** One capture job of a matrix plan. */
export const UiMatrixJobSchema = z.looseObject({
  job: z.string().describe('A name safe for artifact names and shard ids: unique in the plan'),
  values: z.record(z.string(), z.string()).describe('The values of the job-splitting dimensions'),
  where: z.string().describe('The same as `--where` flags, quoted for a POSIX shell (empty when the job covers every profile)'),
  build: z.string().nullable().describe('The `build` of `builds` this job needs, or null without build dimensions'),
  profiles: Count, items: Count
});

/** `atlas ui-catalog plan-matrix --format json`. */
export const UiMatrixPlanSchema = z.looseObject({
  ok: z.literal(true),
  schemaVersion: z.literal(UI_CATALOG_MATRIX_VERSION),
  definition: z.looseObject({ version: z.string(), name: z.string(), document: UiCatalogDefinitionSchema }),
  dimensions: z.looseObject({ jobs: z.array(z.string()), builds: z.array(z.string()) }),
  matrix: z.looseObject({ include: z.array(UiMatrixJobSchema) }).describe('`strategy.matrix`'),
  builds: z.looseObject({ include: z.array(z.looseObject({ build: z.string(), values: z.record(z.string(), z.string()), jobs: Count })) }).describe('`strategy.matrix` of the build job: each build once'),
  participants: z.array(z.string()).describe('Every job name: pass them to `refresh begin` so a job that never started is named'),
  maxParallel: z.number().int().positive().describe('`strategy.max-parallel`: never more than asked for'),
  jobs: Count, profiles: Count, items: Count
});

/** A matrix plan. */
export type UiMatrixPlan = z.output<typeof UiMatrixPlanSchema>;
