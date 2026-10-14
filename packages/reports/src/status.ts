/**
 * @module Suite status
 *
 * The one rule for rolling test outcomes up into a suite or commit outcome, used wherever a recorded run is summarised.
 */
import type { ReportTestStatus } from './report-types';

/**
 * The worst outcome of a set of tests or sources: `failed` if any failed, `skipped` if there is at least one and all
 * were skipped, otherwise `passed`. An empty list is `passed`: callers that need "no evidence" to mean something else
 * (for example `closeCommit`) check for emptiness themselves.
 */
export function suiteStatus(
  tests: readonly { readonly status: ReportTestStatus }[]
): ReportTestStatus {
  if (tests.some((t) => t.status === 'failed')) return 'failed';
  if (tests.length > 0 && tests.every((t) => t.status === 'skipped')) {
    return 'skipped';
  }
  return 'passed';
}

