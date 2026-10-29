/**
 * @module Searchable behaviors, results and runs
 *
 * The documents every search surface matches against, built from one place so they cannot disagree. A recorded
 * behavior (`TestSummary`) is searched by the same fields wherever it appears: the finder's Runs group, the test list
 * and the results of an opened run all call {@link testFields} and {@link testFacets}. They differ only in what the
 * structured filters say about this particular appearance (a run's result has the status, environment and videos of
 * that run, not of the latest combined evidence), so the same words always give the same eligible behaviors.
 */
import { videoCounts } from '@crvouga/atlas/reports/evidence-detail';
import type { RunResult, RunSummary, TestSummary } from '@crvouga/atlas/reports/test-catalog';

import type { DocFacets, ParsedSearch, SearchIssue, SearchFilters } from './query';
import { NO_FILTERS, SYNTAX_HELP } from './query';
import type { FieldName, FindDoc, FindField, FindStatus, Ranked } from './rank';

/** True when a behavior's current results reference at least one playable video recording. */
export function testHasVideo(test: Pick<TestSummary, 'outcomes'>): boolean {
  return test.outcomes.some((outcome) => (videoCounts(outcome.evidence?.videos)?.recordings ?? 0) > 0);
}

/** The id of the finder document of a behavior (`run:` followed by its `TestSummary.key`): the identity every surface shares. */
export function behaviorId(key: string): string {
  return `run:${key}`;
}

/** What the filters read about a behavior: its current status, where it ran, its domain, spec, tags and branches, and its videos. */
export function testFacets(test: TestSummary): DocFacets {
  return {
    status: [test.status, ...(test.stats.flaky ? ['flaky'] : [])],
    env: test.environments.length ? test.environments : ['(none)'],
    producer: test.producers,
    domain: [test.spec?.domain || '(no spec)'],
    spec: test.specPath ? [test.specPath] : [],
    tag: [...test.tags, ...(test.artifactTags ?? []), ...(test.inheritedArtifactTags ?? [])].map((tag) => tag.replace(/^#/, '')),
    branch: test.stats.branches,
    video: testHasVideo(test)
  };
}

/** The first line of a failure, for finding a behavior by what went wrong. */
function failureLines(test: TestSummary): string[] {
  return test.outcomes.filter((outcome) => outcome.status === 'failed' && outcome.detail).map((outcome) => outcome.detail.split('\n')[0]!);
}

/** The searchable texts of a behavior: title, path and identifier, spec and failures, and metadata. Every surface uses these. */
export function testFields(test: TestSummary): FindField[] {
  const fields: FindField[] = [{ name: 'title', text: test.title }];
  fields.push({ name: 'path', text: [test.specPath ?? '', test.id].filter(Boolean).join('\n') });
  const description = [test.spec?.title ?? '', ...failureLines(test)].filter(Boolean).join('\n');
  if (description) fields.push({ name: 'description', text: description });
  const metadata = [
    test.spec?.domain ?? '',
    ...test.tags,
    ...(test.artifactTags ?? []),
    ...Object.entries(test.labels).flatMap(([key, value]) => [key, value]),
    ...test.environments,
    ...test.producers
  ].filter(Boolean);
  if (metadata.length) fields.push({ name: 'metadata', text: metadata.join('\n') });
  return fields;
}

function findStatus(status: TestSummary['status']): FindStatus {
  return status;
}

/** A behavior as a document. Its id is {@link behaviorId}. */
export function testDoc(test: TestSummary): FindDoc {
  return {
    id: behaviorId(test.key),
    group: 'Runs',
    kind: 'run',
    title: test.title,
    subtitle: test.specPath ?? '',
    fields: testFields(test),
    status: findStatus(test.status),
    related: [],
    target: { to: '/', search: { test: test.key } },
    recording: null,
    facets: testFacets(test)
  };
}

const documents = new WeakMap<readonly TestSummary[], ReadonlyMap<string, FindDoc>>();

/**
 * The documents of every behavior of a report by `TestSummary.key`, built once per list of tests. Every surface that
 * searches behaviors (the test list, the results of a run) searches this same set, so the same words are judged against
 * the same vocabulary and the same behaviors are eligible.
 */
export function behaviorDocs(tests: readonly TestSummary[]): ReadonlyMap<string, FindDoc> {
  let found = documents.get(tests);
  if (!found) {
    found = new Map(tests.map((test) => [test.key, testDoc(test)] as const));
    documents.set(tests, found);
  }
  return found;
}

/**
 * The result of a behavior within one run as a document: the behavior's own fields (so it matches exactly when the
 * behavior does), with the status, environment, producer and videos of this result for the filters. Without the
 * behavior in the report any more, its title, spec and environment are all there is to match.
 */
export function resultDoc(result: RunResult, test: TestSummary | undefined): FindDoc {
  const base: FindDoc = test
    ? testDoc(test)
    : {
        id: behaviorId(result.key),
        group: 'Runs',
        kind: 'run',
        title: result.title,
        subtitle: result.specPath ?? '',
        fields: [
          { name: 'title', text: result.title },
          { name: 'path', text: [result.specPath ?? '', result.id].filter(Boolean).join('\n') },
          { name: 'metadata', text: [result.environment ?? '', result.producer].filter(Boolean).join('\n') }
        ],
        status: findStatus(result.status),
        related: [],
        target: { to: '/', search: { test: result.key } },
        recording: null
      };
  const facets = base.facets;
  return {
    ...base,
    status: findStatus(result.status),
    facets: {
      status: [result.status, ...(facets?.status.includes('flaky') ? ['flaky'] : [])],
      env: [result.environment ?? '(none)'],
      producer: [result.producer],
      domain: facets?.domain ?? ['(no spec)'],
      spec: result.specPath ? [result.specPath] : [],
      tag: facets?.tag ?? [],
      branch: facets?.branch ?? [],
      video: (videoCounts(result.videos)?.recordings ?? 0) > 0
    }
  };
}

/** What a run is searched by: its label, commit and branch, environments, producers, and the tests that failed in it. */
export function runDoc(run: RunSummary, label: string): FindDoc {
  const status = run.counts.failed > 0 ? 'failed' : run.counts.running > 0 ? 'running' : run.counts['not-run'] > 0 ? 'not-run' : 'passed';
  return {
    id: `runs:${run.key}`,
    group: 'Runs',
    kind: 'run',
    title: label,
    subtitle: [run.branch, run.sha?.slice(0, 7)].filter(Boolean).join(' @ '),
    fields: [
      { name: 'title', text: label },
      { name: 'path', text: [run.key, run.branch ?? '', run.sha ?? '', run.runId ?? ''].filter(Boolean).join('\n') },
      { name: 'description', text: run.failing.flatMap((failure) => [failure.title, failure.detail.split('\n')[0] ?? '']).filter(Boolean).join('\n') },
      { name: 'metadata', text: [...run.environments, ...run.producers].join('\n') }
    ],
    status,
    related: [],
    target: { to: '/', search: {} },
    recording: null,
    facets: {
      status: [...(run.counts.failed > 0 ? ['failed'] : []), ...(run.counts.running > 0 ? ['running'] : []), ...(run.counts['not-run'] > 0 ? ['not-run'] : []), ...(run.counts.passed > 0 ? ['passed'] : [])],
      env: run.environments.length ? run.environments : ['(none)'],
      producer: run.producers,
      domain: [],
      spec: [],
      tag: [],
      branch: run.branch ? [run.branch] : [],
      video: (run.videos?.recordings ?? 0) > 0
    }
  };
}

/**
 * A search for a list that has no domain, spec or tag (the runs): those filters are removed and said so, instead of
 * silently emptying the list or pretending to filter.
 */
export function forRuns(parsed: ParsedSearch): ParsedSearch {
  const issues: SearchIssue[] = [...parsed.issues];
  const dropped = parsed.tokens.filter((token) => token.key === 'domain' || token.key === 'spec' || token.key === 'tag');
  for (const token of dropped) issues.push({ token: token.text, message: `does not apply to runs, so it filters nothing here. Open a run to filter its tests by ${token.key}:. ${SYNTAX_HELP}` });
  const filters: SearchFilters = { ...parsed.filters, domain: NO_FILTERS.domain, spec: NO_FILTERS.spec, tag: NO_FILTERS.tag };
  return { ...parsed, filters, tokens: parsed.tokens.filter((token) => !dropped.includes(token)), issues };
}

const FIELD_WORD: Record<FieldName, string> = {
  title: 'title',
  steps: 'steps',
  description: 'description',
  metadata: 'tags and details',
  path: 'path or identifier'
};

/**
 * Why a document is in the results, for a person: an exact phrase or identifier, the fields the words were found
 * in, and whether a close spelling or only the meaning brought it. Empty for a hit that carries no reason (a browse).
 */
export function describeHit(hit: Pick<Ranked, 'fields' | 'exact' | 'literals' | 'fuzzy' | 'partial' | 'semantic' | 'related'>): string {
  const parts: string[] = [];
  if (hit.exact && hit.literals?.length) parts.push(`Exact: ${hit.literals.map((literal) => `“${literal}”`).join(', ')}`);
  if (hit.semantic) parts.push('Similar meaning');
  else if (hit.fields?.length) parts.push(`${hit.partial ? 'Some words in' : 'Matches'} ${hit.fields.map((field) => FIELD_WORD[field]).join(', ')}${hit.fuzzy ? ' (close spelling)' : ''}`);
  if (hit.related && !parts.length) parts.push('Related to a match');
  return parts.join(' · ');
}
