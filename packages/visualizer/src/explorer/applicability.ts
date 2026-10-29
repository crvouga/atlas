/**
 * @module Explorer evidence applicability
 *
 * The explorer's part of evidence applicability: the release a reader names and the stale-or-unverified filter, held in
 * the explorer's address (`release`, `releaseSha`, `releasePlatform`, `evidence=stale`, the same names a spec page uses),
 * and the reading of every test of the catalog against them. The reading is the one a feature page makes
 * (`evidence/applicability.ts`); it never changes a test's status.
 */
import { useMemo } from 'react';
import type { TestSummary } from '@crvouga/atlas/reports/test-catalog';

import { assessTest, type Assessment, type ReleaseIdentity } from '../evidence/applicability';
import type { ApplicabilityState } from '../evidence/applicability-view';
import { useExplorerNavigate, useExplorerSearch } from './navigate';
import type { ExplorerSearch } from './search';

/** The release an explorer address names; every part is optional. */
export function releaseOf(search: ExplorerSearch): ReleaseIdentity {
  return {
    ...(search.release ? { build: search.release } : {}),
    ...(search.releaseSha ? { sha: search.releaseSha } : {}),
    ...(search.releasePlatform ? { platform: search.releasePlatform } : {})
  };
}

/** Each test's evidence read against the promise and the release, by test key. */
export function assessTests(tests: readonly TestSummary[], release: ReleaseIdentity): ReadonlyMap<string, Assessment> {
  return new Map(tests.map((test) => [test.key, assessTest(test, release)] as const));
}

/** The release and the evidence filter of the explorer's address, with the ways to change them. */
export function useExplorerApplicability(): ApplicabilityState {
  const search = useExplorerSearch();
  const go = useExplorerNavigate();
  const { release: build, releaseSha: sha, releasePlatform: platform } = search;
  const release = useMemo(() => releaseOf({ release: build, releaseSha: sha, releasePlatform: platform }), [build, sha, platform]);
  return {
    release,
    onlyStale: search.evidence === 'stale',
    setRelease: (next) => go({ release: next.build || undefined, releaseSha: next.sha || undefined, releasePlatform: next.platform || undefined }, { replace: true }),
    setOnlyStale: (on) => go({ evidence: on ? 'stale' : undefined }, { replace: true })
  };
}
