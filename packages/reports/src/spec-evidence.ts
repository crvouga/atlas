/**
 * @module Matching recorded tests to specs
 *
 * Small lookups from a spec to the recorded tests that ran it, by the source file each test reports. Pure functions
 * over `HtmlReportTest`.
 */
import type { HtmlReportTest } from './recording-bundle';
import type { SpecEntry } from './explorer-types';

/** The tests whose reported `sourceFile` is the spec's path or ends with `/<path>` (so a runner's absolute path matches), after turning backslashes into `/`. A longer name that merely ends with the same letters does not match. */
export function testsForSpec(
  entry: SpecEntry,
  tests: readonly HtmlReportTest[]
): readonly HtmlReportTest[] {
  return tests.filter((test) => {
    const path = test.report.meta.sourceFile?.replaceAll('\\', '/') ?? '';
    return path === entry.path || path.endsWith(`/${entry.path}`);
  });
}

/**
 * Counts recorded tests per spec path in one pass, so large suites never scan all tests per row. A test's path is its
 * `sourceFile` (with backslashes turned into `/`) from the first occurrence of `specs/`, wherever that occurs, or the whole
 * path when there is none; tests with no `sourceFile` are not counted.
 */
export function specEvidenceCounts(
  tests: readonly HtmlReportTest[]
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const test of tests) {
    const source = test.report.meta.sourceFile?.replaceAll('\\', '/');
    if (!source) continue;
    const at = source.indexOf('specs/');
    const path = at < 0 ? source : source.slice(at);
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}
