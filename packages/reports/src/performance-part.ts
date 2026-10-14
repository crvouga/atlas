/**
 * @module Performance part of a report
 *
 * Turns the measured step timings of recorded test runs into a `performance`-kind report part, one check per run,
 * so slow actions show beside the behaviour checks. The part is diagnostic: `performance` is the kind that composition
 * leaves out of counts when anything else was recorded, and a measurement over its limit never fails a check on its
 * own (here only a step over the allowance marks the diagnostic check `failed`).
 *
 * @see docs/report-contract.md#statuses-and-the-gate
 */
import type { RunReport } from './report-types';
import type { ReportPart } from './explorer-types';
import { performanceRows } from './performance';

/**
 * Builds a `performance` part with one check per run report, judging each step's own recorded time against
 * `allowanceMs`. No missing measurement becomes a pass.
 *
 * A check is `failed` when any step's self time is over `allowanceMs`; `not-run` when the run has no steps or any step
 * has no measurement; otherwise `passed`. Its `id` and `title` are the run's `testId` and `title`, its `specPath` the
 * run's `sourceFile` when known, and it carries one measurement, `Longest own action` in ms with the allowance as its
 * `limit`, when anything was measured. The part's id is `recorded-performance`. Throws `Invalid performance allowance`
 * when `allowanceMs` is not a positive finite number.
 *
 * @param args.sha the commit the runs were recorded at.
 * @param args.recordedAtMs when the runs were recorded, epoch milliseconds.
 * @param args.allowanceMs the diagnostic allowance for one step's own time, in milliseconds.
 * @param args.reports the recorded runs.
 */
export function performancePart(args: {
  readonly sha: string;
  readonly recordedAtMs: number;
  readonly allowanceMs: number;
  readonly reports: readonly RunReport[];
}): ReportPart {
  if (!Number.isFinite(args.allowanceMs) || args.allowanceMs <= 0)
    throw new Error('Invalid performance allowance');
  return {
    sha: args.sha,
    id: 'recorded-performance',
    kind: 'performance',
    title: 'Recorded action performance',
    recordedAtMs: args.recordedAtMs,
    checks: args.reports.map((report) => {
      const rows = performanceRows(report.steps, args.allowanceMs);
      const measured = rows.filter((row) => row.band !== 'unmeasured');
      const slow = rows.filter((row) => row.band === 'slow').length;
      const maximum = measured.reduce(
        (max, row) => Math.max(max, row.step.performance!.selfMs),
        0
      );
      return {
        id: report.meta.testId,
        title: report.meta.title,
        status:
          slow > 0
            ? 'failed'
            : rows.length === 0 || rows.length !== measured.length
              ? 'not-run'
              : 'passed',
        detail: `${measured.length} measured steps; ${slow} over the diagnostic allowance. Includes waits and harness work.`,
        ...(report.meta.sourceFile === undefined
          ? {}
          : { specPath: report.meta.sourceFile }),
        measurements:
          measured.length === 0
            ? []
            : [
                {
                  name: 'Longest own action',
                  value: maximum,
                  unit: 'ms',
                  limit: args.allowanceMs,
                },
              ],
      };
    }),
  };
}
