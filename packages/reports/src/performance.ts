/**
 * @module Performance heat of recorded steps
 *
 * Classifies each step of a recorded run by how long its own work took against an allowance, ranks hotspots, and
 * indexes steps to a frame for a heatmap. Pure functions over `ReportStep` trees. The allowance is a diagnostic
 * threshold, not a portable CPU or paint-time assertion.
 */
import type { ReportStep } from './report-types';
import { type FlatFrame, type FlatStep, flattenSteps } from './frames';

/** How a step's own time compares with the allowance: `unmeasured` (no valid time), `cool`, `warm` (over a quarter of it) or `slow` (over it). */
export type HeatBand = 'unmeasured' | 'cool' | 'warm' | 'slow';
/** A flattened step with its heat band. */
export type PerformanceRow = FlatStep & {
  /** The step's `performance.selfMs` classified by `heatBand`. */
  readonly band: HeatBand;
};

/**
 * Classifies a duration in milliseconds against `allowanceMs`: `unmeasured` when it is missing, not finite or
 * negative; `slow` when over the allowance; `warm` when over a quarter of it; otherwise `cool`.
 */
export function heatBand(
  ms: number | undefined,
  allowanceMs: number
): HeatBand {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return 'unmeasured';
  if (ms > allowanceMs) return 'slow';
  return ms > allowanceMs / 4 ? 'warm' : 'cool';
}

/** Flattens a step tree depth-first (parents before children) into rows, each banded by its own recorded time (`performance.selfMs`) against `allowanceMs`. */
export function performanceRows(
  steps: readonly ReportStep[],
  allowanceMs: number
): PerformanceRow[] {
  return flattenSteps(steps).map((row) => ({
    ...row,
    band: heatBand(row.step.performance?.selfMs, allowanceMs),
  }));
}

/** The measured rows, longest own time first and earlier rows first on a tie. Self time attributes nested work once, instead of ranking every ancestor as slow. Sorts in place the array it builds, not `rows`. */
export function performanceHotspots(
  rows: readonly PerformanceRow[]
): PerformanceRow[] {
  return rows
    .filter((row) => row.band !== 'unmeasured')
    .sort(
      (a, b) =>
        (b.step.performance?.selfMs ?? 0) - (a.step.performance?.selfMs ?? 0) ||
        a.index - b.index
    );
}

/** Formats a millisecond duration for display with two decimals, like `12.34 ms`. */
export function measuredMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

/**
 * Maps each step to a frame in one linear pass: its own first frame, or failing that the first frame of its first
 * child that has one (found walking `rows` from the end, so deeper steps resolve first). Steps with no frame in their
 * subtree are absent. Meant for a large heatmap where a per-step search would be quadratic.
 */
export function performanceFrameIndex(
  rows: readonly PerformanceRow[],
  frames: readonly FlatFrame[]
): ReadonlyMap<ReportStep, FlatFrame> {
  const byStep = new Map<ReportStep, FlatFrame>();
  for (const frame of frames) {
    if (!byStep.has(frame.step)) byStep.set(frame.step, frame);
  }
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const step = rows[i]!.step;
    if (byStep.has(step)) continue;
    for (const child of step.steps) {
      const frame = byStep.get(child);
      if (frame === undefined) continue;
      byStep.set(step, frame);
      break;
    }
  }
  return byStep;
}
