/**
 * @module Evidence applicability view
 *
 * Shows whether the evidence behind a behavior applies to it: a compact summary (verdict, when the checks ran, the
 * promise, the release), the controls that name a release and filter to stale or unverified evidence, and the
 * address state that keeps both shareable. A verdict is a reading of the evidence and never changes an outcome.
 */
import { Alert, Badge, Button, Collapse, Group, List, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';

import { hasRelease, VERDICTS, type Assessment, type ReleaseIdentity, type ReleaseMatch, type Verdict } from './applicability';
import { exactTime, ago, plural, shortSha, useNow } from './format';

/** The release and the evidence filter the address holds, with the ways to change them. */
export type ApplicabilityState = {
  readonly release: ReleaseIdentity;
  /** True when only behaviors with stale or unverified evidence are listed. */
  readonly onlyStale: boolean;
  readonly setRelease: (next: ReleaseIdentity) => void;
  readonly setOnlyStale: (on: boolean) => void;
};

/** The address fields the release and the evidence filter are held in, shared by the spec route and the behaviors route. */
type ReleaseAddress = { release?: string; releaseSha?: string; releasePlatform?: string; evidence?: 'stale' };

/**
 * The release (`release` build, `releaseSha`, `releasePlatform`) and evidence filter (`evidence=stale`) of the address of a
 * spec page or of the behaviors page. They are held in the address, so a shared link shows the same reading.
 */
export function useApplicabilityState(): ApplicabilityState {
  const search = useSearch({ strict: false }) as ReleaseAddress;
  const navigate = useNavigate();
  const release = useMemo<ReleaseIdentity>(
    () => ({
      ...(search.release ? { build: search.release } : {}),
      ...(search.releaseSha ? { sha: search.releaseSha } : {}),
      ...(search.releasePlatform ? { platform: search.releasePlatform } : {})
    }),
    [search.release, search.releaseSha, search.releasePlatform]
  );
  const setRelease = useCallback(
    (next: ReleaseIdentity) =>
      void navigate({
        to: '.',
        search: ((prev: Record<string, unknown>) => ({
          ...prev,
          release: next.build || undefined,
          releaseSha: next.sha || undefined,
          releasePlatform: next.platform || undefined
        })) as never,
        replace: true
      }),
    [navigate]
  );
  const setOnlyStale = useCallback(
    (on: boolean) => void navigate({ to: '.', search: ((prev: Record<string, unknown>) => ({ ...prev, evidence: on ? 'stale' : undefined })) as never, replace: true }),
    [navigate]
  );
  return { release, onlyStale: search.evidence === 'stale', setRelease, setOnlyStale };
}

/** A verdict in words, with its reason on hover. */
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <Badge data-applicability={verdict} color={VERDICTS[verdict].color} variant="light" title={VERDICTS[verdict].meaning}>
      {VERDICTS[verdict].label}
    </Badge>
  );
}

const RELEASE_WORDS: Record<ReleaseMatch, string> = {
  'not-selected': 'No release named',
  exact: 'Exact match of the release',
  asserted: 'Asserted to hold for the release',
  other: 'Recorded against another build',
  unknown: 'Not known to apply to the release'
};

/** One recorded fact of the evidence: a quiet label and its value. */
function Fact({ label, children, ...rest }: { label: string; children: ReactNode; 'data-published'?: boolean; 'data-enriched'?: boolean }) {
  return (
    <Text span inherit {...rest}>
      {label}:{' '}
      <Text span inherit fw={600} c="var(--mantine-color-text)">
        {children}
      </Text>
    </Text>
  );
}

/** A moment, exact and relative. */
function When({ at, now }: { at: number; now: number }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={exactTime(at)}>
      {exactTime(at)} ({ago(at, now)})
    </time>
  );
}

/**
 * A compact reading of one behavior's evidence: the verdict; when the checks ran (the age of the evidence, whatever
 * was uploaded or enriched since); what it ran against; and why. Stale evidence is stated first and prominently, and
 * the recorded outcome is never described as changed.
 */
export function ApplicabilitySummary({ assessment, release }: { assessment: Assessment; release: ReleaseIdentity }) {
  const now = useNow();
  const { verdict, facts, reasons } = assessment;
  if (verdict === 'none' || !facts) {
    return (
      <Text component="div" size="xs" c="dimmed" data-applicability="none">
        No completed result, so there is no evidence to apply.
      </Text>
    );
  }
  const named = hasRelease(release);
  return (
    <Stack gap="xs" component="section" aria-label="Applicability of this evidence" data-applicability={verdict} data-release={assessment.release}>
      <Group gap="xs" wrap="wrap">
        <VerdictBadge verdict={verdict} />
        <Text span c="dimmed">
          {VERDICTS[verdict].meaning}
        </Text>
      </Group>
      {assessment.release === 'other' && (
        <Alert color="orange" role="status">
          This recording is not proof of the named release. Its recorded outcome is unchanged.
        </Alert>
      )}
      <Group gap="md" wrap="wrap" c="dimmed" fz="xs">
        <Fact label="Checks ran">
          <When at={facts.executedAtMs} now={now} />
        </Fact>
        {facts.publishedAtMs !== null && (
          <Fact label="Published" data-published>
            <When at={facts.publishedAtMs} now={now} />
          </Fact>
        )}
        {facts.enrichedAtMs !== null && (
          <Fact label="Enriched" data-enriched>
            <When at={facts.enrichedAtMs} now={now} />
          </Fact>
        )}
        <Fact label="Build">{facts.build ?? 'not recorded'}</Fact>
        <Fact label="Commit">
          {shortSha(facts.sha) ?? 'not recorded'}
          {facts.provenance === 'modified' ? ' with local changes' : facts.provenance === 'unknown' ? ' (origin not captured)' : ''}
        </Fact>
        <Fact label="Platform">{facts.platform ?? 'not recorded'}</Fact>
      </Group>
      {named && (
        <Text component="div" c="dimmed">
          Release {[release.build && `build ${release.build}`, release.sha && `commit ${release.sha.slice(0, 7)}`, release.platform].filter(Boolean).join(', ')}:{' '}
          <Text span inherit fw={600} c="var(--mantine-color-text)">
            {RELEASE_WORDS[assessment.release]}
          </Text>
        </Text>
      )}
      {assessment.assertion && (
        <Text component="div" c="dimmed" data-assertion={assessment.assertion.by ? 'policy' : 'unattributed'}>
          Asserts it still holds for {assessment.assertion.builds.join(', ')}
          {assessment.assertion.by ? ` (by ${assessment.assertion.by})` : ', with no policy stated'}.
        </Text>
      )}
      {reasons.length > 0 && (
        <List spacing={4} size="sm">
          {reasons.map((reason) => (
            <List.Item key={reason}>{reason}</List.Item>
          ))}
        </List>
      )}
      <Text component="div" size="xs" c="dimmed">
        Its age counts from when the checks ran, not from when it was uploaded or annotated.
        {assessment.others > 0 ? ` Best of ${plural(assessment.others + 1, 'completed result', 'completed results')}.` : ''}
      </Text>
    </Stack>
  );
}

/**
 * Names the release evidence is read against (build, commit and platform, each optional) and filters a feature to
 * its behaviors with stale or unverified evidence. Both live in the address. A branch name or a passing run never
 * names a release.
 */
export function ApplicabilityControls({
  state,
  stale = 0,
  total = 0,
  filter = true,
  compact = false
}: {
  state: ApplicabilityState;
  /** How many behaviors (or tests) have stale or unverified evidence. Only shown with the filter. */
  stale?: number;
  /** How many behaviors (or tests) there are. Only shown with the filter. */
  total?: number;
  /** Whether to offer the stale-or-unverified filter here; a caller that offers it elsewhere sets this false. */
  filter?: boolean;
  /** Disclose optional release fields while keeping evidence filters visible. */
  compact?: boolean;
}) {
  const { release, setRelease, onlyStale, setOnlyStale } = state;
  const named = hasRelease(release) || !!release.platform;
  const [open, setOpen] = useState(named);
  const fieldsId = useId();
  const Chevron = open ? IconChevronUp : IconChevronDown;
  const fields = (
    <Stack gap="sm">
      <Text component="div" size="xs" c="dimmed">
        Name the release you care about to see whether each recording was made against it. Without one, evidence is read against the current promise only.
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <TextInput
          label="Release build"
          description="Compared with each result's build label"
          value={release.build ?? ''}
          onChange={(event) => setRelease({ ...release, build: event.currentTarget.value })}
        />
        <TextInput
          label="Release commit"
          description="Compared with the commit the checks ran at"
          value={release.sha ?? ''}
          onChange={(event) => setRelease({ ...release, sha: event.currentTarget.value })}
        />
        <TextInput
          label="Release platform"
          description="For example ios, android or desktop-web"
          value={release.platform ?? ''}
          onChange={(event) => setRelease({ ...release, platform: event.currentTarget.value })}
        />
      </SimpleGrid>
      {release.platform && !hasRelease(release) && (
        <Text role="status" component="div" c="dimmed">
          A platform alone does not name a release. Add its build or commit.
        </Text>
      )}
    </Stack>
  );
  return (
    <Stack component="section" aria-label="Evidence applicability" gap="xs" miw={0}>
      {(filter || compact) && (
        <Group gap="xs" wrap="wrap">
          {filter && (
            <Group role="group" aria-label="Evidence filter" gap={4}>
              <Button type="button" size="compact-sm" aria-pressed={!onlyStale} onClick={() => setOnlyStale(false)} variant={onlyStale ? 'subtle' : 'light'} rightSection={<Text span inherit c="dimmed">{total}</Text>}>
                All evidence{' '}
              </Button>
              <Button type="button" size="compact-sm" aria-pressed={onlyStale} onClick={() => setOnlyStale(true)} variant={onlyStale ? 'light' : 'subtle'} rightSection={<Text span inherit c="dimmed">{stale}</Text>}>
                Stale or unverified{' '}
              </Button>
            </Group>
          )}
          {compact && (
            <Button type="button" size="compact-sm" variant={named ? 'light' : 'subtle'} aria-expanded={open} aria-controls={fieldsId} onClick={() => setOpen(!open)} rightSection={<Chevron size={14} aria-hidden="true" />}>
              {named ? `Release: ${[release.build, release.sha, release.platform].filter(Boolean).join(' · ')}` : 'Compare with a release (optional)'}
            </Button>
          )}
        </Group>
      )}
      {compact ? (
        <Collapse expanded={open} id={fieldsId} keepMountedMode="display-none">
          {fields}
        </Collapse>
      ) : (
        fields
      )}
      {filter && onlyStale && stale === 0 && (
        <Text role="status" component="div" c="dimmed">
          Every behavior has evidence that applies.
        </Text>
      )}
    </Stack>
  );
}
