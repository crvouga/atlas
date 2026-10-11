import type { ReportTestStatus } from './report-types';
export function suiteStatus(
  tests: readonly { readonly status: ReportTestStatus }[]
): ReportTestStatus {
  if (tests.some((t) => t.status === 'failed')) return 'failed';
  if (tests.length > 0 && tests.every((t) => t.status === 'skipped')) {
    return 'skipped';
  }
  return 'passed';
}

