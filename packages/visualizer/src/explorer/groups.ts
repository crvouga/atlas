/**
 * @module Explorer groups
 *
 * The explorer's list in groups (by spec, domain, environment, status or producer) with what each group's header says:
 * how many tests, by current status, and their average duration. A test checked on two environments is in both
 * environment groups. Groups keep the order of the sorted tests (the group holding the first test comes first), except
 * when sorted by spec, where they are in domain and title order, and by status, where failures come first.
 */
import type { StatusCounts } from '@crvouga/atlas/reports/evidence-types';
import type { EvidenceStatus } from '@crvouga/atlas/reports/explorer-types';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import type { TestSummary } from '@crvouga/atlas/reports/test-catalog';

import type { TestGroup } from './search';

/** One group of tests and its tally. */
export type TestGroupView = {
  /** Stable within a grouping: what is remembered as open or closed. */
  readonly key: string;
  readonly label: string;
  /** A second, quieter line: the spec's path. */
  readonly detail: string | null;
  /** The domain a spec group belongs to, for a heading above it. */
  readonly parent: string | null;
  /** What to filter by to see only this group: the filter and its value. */
  readonly filter: { readonly field: 'spec' | 'domain' | 'env' | 'status' | 'producer'; readonly value: string } | null;
  readonly tests: readonly TestSummary[];
  readonly counts: StatusCounts;
  /** The average of its tests' average durations, ms, or null when none was measured. */
  readonly avgMs: number | null;
};

/** Order of statuses when grouping by status: what needs attention first. */
export const STATUS_ORDER: readonly EvidenceStatus[] = ['failed', 'running', 'not-run', 'passed'];

const NO_SPEC = '(no spec)';

/** Counts by current status, and the mean of measured average durations. */
export function tally(tests: readonly TestSummary[]): { counts: StatusCounts; avgMs: number | null } {
  const counts: Record<EvidenceStatus, number> = { passed: 0, failed: 0, running: 0, 'not-run': 0 };
  let total = 0, measured = 0;
  for (const test of tests) {
    counts[test.status] += 1;
    if (test.stats.durations) { total += test.stats.durations.avgMs; measured += 1; }
  }
  return { counts, avgMs: measured ? Math.round(total / measured) : null };
}

/**
 * The tally of one environment: each test counted by how it went there (a test failing on the API and passing on the
 * web counts as passed for the web), and the mean of the durations of its current results there.
 */
export function environmentTally(tests: readonly TestSummary[], environment: string): { counts: StatusCounts; avgMs: number | null } {
  const counts: Record<EvidenceStatus, number> = { passed: 0, failed: 0, running: 0, 'not-run': 0 };
  let total = 0, measured = 0;
  const env = environment === '(none)' ? null : environment;
  for (const test of tests) {
    const own = environmentStatuses(test).find((entry) => entry.environment === env);
    counts[own?.status ?? test.status] += 1;
    for (const outcome of test.outcomes) {
      if (outcome.environment === env && outcome.durationMs !== null) { total += outcome.durationMs; measured += 1; }
    }
  }
  return { counts, avgMs: measured ? Math.round(total / measured) : null };
}

type Keyed = { key: string; label: string; detail: string | null; parent: string | null; filter: TestGroupView['filter'] };

function keysOf(test: TestSummary, by: TestGroup): Keyed[] {
  switch (by) {
    case 'spec':
      return [test.spec
        ? { key: test.spec.path, label: test.spec.title, detail: test.spec.path, parent: test.spec.domain || NO_SPEC, filter: { field: 'spec', value: test.spec.path } }
        : { key: NO_SPEC, label: 'Tests without a spec', detail: null, parent: NO_SPEC, filter: null }];
    case 'domain': {
      const domain = test.spec?.domain || NO_SPEC;
      return [{ key: domain, label: domain === NO_SPEC ? 'No spec' : domain, detail: null, parent: null, filter: { field: 'domain', value: domain } }];
    }
    case 'environment':
      return test.environments.length
        ? test.environments.map((env) => ({ key: env, label: environmentLabel(env), detail: env === environmentLabel(env) ? null : env, parent: null, filter: { field: 'env', value: env } }))
        : [{ key: '(none)', label: 'No environment', detail: null, parent: null, filter: { field: 'env', value: '(none)' } }];
    case 'status':
      return [{ key: test.status, label: { passed: 'Passed', failed: 'Failed', running: 'Running', 'not-run': 'Not run' }[test.status], detail: null, parent: null, filter: { field: 'status', value: test.status } }];
    case 'producer':
      return test.producers.length
        ? test.producers.map((producer) => ({ key: producer, label: producer, detail: null, parent: null, filter: { field: 'producer', value: producer } }))
        : [{ key: '(none)', label: 'No producer', detail: null, parent: null, filter: null }];
    case 'none':
      return [{ key: 'all', label: 'All tests', detail: null, parent: null, filter: null }];
  }
}

const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The tests (already filtered and sorted) in groups. `bySpecOrder` keeps groups in domain and title order. */
export function groupTests(tests: readonly TestSummary[], by: TestGroup, bySpecOrder = by === 'spec'): TestGroupView[] {
  const groups = new Map<string, Keyed & { tests: TestSummary[] }>();
  for (const test of tests) {
    for (const keyed of keysOf(test, by)) {
      const group = groups.get(keyed.key);
      if (group) group.tests.push(test);
      else groups.set(keyed.key, { ...keyed, tests: [test] });
    }
  }
  let list = [...groups.values()];
  if (by === 'status') list.sort((a, b) => STATUS_ORDER.indexOf(a.key as EvidenceStatus) - STATUS_ORDER.indexOf(b.key as EvidenceStatus));
  else if (bySpecOrder && (by === 'spec' || by === 'domain')) {
    const last = (value: string | null) => (value === NO_SPEC ? '￿' : (value ?? '').toLowerCase());
    list = list.sort((a, b) => text(last(a.parent), last(b.parent)) || text(a.key === NO_SPEC ? '￿' : a.label.toLowerCase(), b.key === NO_SPEC ? '￿' : b.label.toLowerCase()));
  }
  return list.map((group) => ({ ...group, ...(by === 'environment' ? environmentTally(group.tests, group.key) : tally(group.tests)) }));
}

/** The worst current status per environment of a test, in the order its environments are listed. */
export function environmentStatuses(test: TestSummary): { environment: string | null; status: EvidenceStatus }[] {
  const rank: Record<EvidenceStatus, number> = { passed: 0, 'not-run': 1, running: 2, failed: 3 };
  const seen = new Map<string | null, EvidenceStatus>();
  for (const outcome of test.outcomes) {
    const prior = seen.get(outcome.environment);
    if (prior === undefined || rank[outcome.status] > rank[prior]) seen.set(outcome.environment, outcome.status);
  }
  // Live progress may say running where no recorded result does.
  if (test.status === 'running' && ![...seen.values()].includes('running')) return [{ environment: null, status: 'running' }, ...[...seen].map(([environment, status]) => ({ environment, status }))];
  return [...seen].map(([environment, status]) => ({ environment, status })).sort((a, b) => text(a.environment ?? '', b.environment ?? ''));
}
