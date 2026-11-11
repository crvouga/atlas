/**
 * @module Behavior panel
 *
 * How a product reader meets one behavior of a feature: Read (the promise and what is expected, with an outline's
 * concrete example filled in), Watch (the matched recording beside what it should show) and Inspect (the technical
 * record: run, environment, source, attempts). Also the coverage summary of the whole feature. A recording is always
 * labelled as illustrative evidence with its own status, provenance and revision; it never stands for approval.
 */
import { attachmentIdentity } from '@crvouga/atlas/reports/evidence-detail';
import { effectiveScope } from '@crvouga/atlas/reports/evidence-scope';
import type { EvidenceResult } from '@crvouga/atlas/reports/layer-merge';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { Alert, Badge, Box, Card, Group, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconBook, IconEyeOff, IconPlayerPlay, IconSearch, IconVideo } from '@tabler/icons-react';
import { useMemo, type ReactNode } from 'react';
import type { Attachment } from '@crvouga/atlas/schema';

import type { Assessment, ReleaseIdentity } from './applicability';
import { ApplicabilitySummary } from './applicability-view';
import { attachmentSource, Timeline, useCheckDetail } from './artifacts';
import { COVERAGE, COVERAGE_ORDER, type Behavior, type CoverageCounts, type CoverageState, type Revision } from './behavior';
import { PlainSteps } from './check-detail';
import { useEvidence } from './evidence-context';
import { StateBlock } from './load-state';
import { ScopeNotice, ScopeProvider } from './evidence-scope';
import { plural, statusWord, useNow } from './format';
import { exampleIndexFor, exampleRows, fillExample, type FeatureStep } from './gherkin';
import { Origin, StatusMark } from './marks';
import { MomentPlayback, stepsOfRecording, useMomentVideo, useRequestedMoment } from './moments';
import { outcomeHeadline, videosIn } from './outcome';
import { ScopedSummary } from './scoped-summary-view';

/** The short, readable form of a spec fingerprint (`<length>:<hash>:<hash>`): its length and the start of its hash. */
export function shortRevision(fingerprint: string): string {
  const [length, hash] = fingerprint.split(':');
  return hash ? `${hash.slice(0, 8)} (${length} characters)` : fingerprint.slice(0, 12);
}

/** A behavior's coverage state, always in words. */
export function CoverageBadge({ state }: { state: CoverageState }) {
  return (
    <Badge data-coverage={state} color={COVERAGE[state].color} variant="light" title={COVERAGE[state].meaning}>
      {COVERAGE[state].label}
    </Badge>
  );
}

/** Says, beside a behavior's name, that it has a recording that can be played. */
export function VideoMark() {
  return (
    <Box component="span" display="inline-flex" c="dimmed" title="Has a recording to watch">
      <IconVideo size={16} role="img" aria-label="Has a recording" />
    </Box>
  );
}

/**
 * The promise and the evidence side by side, each with its own revision. A mismatch is stated, not hidden; a missing
 * fingerprint is stated as unknown rather than treated as a match.
 */
export function RevisionLine({ revision }: { revision: Revision }) {
  return (
    <Stack gap="xs" data-revision={revision.match}>
      <Group gap="md" wrap="wrap" c="dimmed" fz="xs">
        <Text span inherit>
          Promise revision:{' '}
          <Text span inherit fw={600} c="var(--mantine-color-text)">
            {revision.promise ? shortRevision(revision.promise) : 'not recorded'}
          </Text>
        </Text>
        <Text span inherit>
          Evidence revision:{' '}
          <Text span inherit fw={600} c="var(--mantine-color-text)">
            {revision.evidence ? shortRevision(revision.evidence) : 'not recorded'}
          </Text>
        </Text>
      </Group>
      {revision.match === 'different' && (
        <Alert color="orange" role="status">
          This evidence was recorded against an earlier revision of the spec. It does not show that the current promise holds.
        </Alert>
      )}
      {revision.match === 'unknown' && (
        <Text component="div" size="xs" c="dimmed">
          The revisions cannot be compared, so this evidence is not tied to the current promise.
        </Text>
      )}
    </Stack>
  );
}

/** The `Then` steps (and the `And`/`But` after them): what should be true when the behavior has run. */
function expectedSteps(steps: readonly FeatureStep[]): FeatureStep[] {
  const at = steps.findIndex((step) => step.keyword === 'Then');
  return at < 0 ? [] : steps.slice(at);
}

/**
 * The steps a behavior reads as: an outline's example with its values filled in, else the scenario's own. `expected` is
 * what should be true afterwards; `named` is true when the recorded example name matches no row, so nothing was filled in.
 */
export function behaviorSteps(behavior: Behavior) {
  const { scenario, example } = behavior;
  const at = example === null ? -1 : exampleIndexFor(scenario, example);
  const entry = at < 0 ? null : exampleRows(scenario)[at]!;
  const steps = entry ? fillExample(scenario.steps, entry) : scenario.steps;
  return { steps, entry, expected: expectedSteps(steps), named: example !== null && entry === null };
}

/** The recording itself: the one player the steps beside it seek, which marks the step playing. */
function WatchVideo({ attachment, url }: { attachment: Attachment; url: string }) {
  const moments = useMomentVideo(attachment);
  return (
    <Box
      component="video"
      src={url}
      controls
      preload="metadata"
      aria-label={`Recording: ${attachment.description ?? attachment.name}`}
      display="block"
      maw="100%"
      w="100%"
      mah="70vh"
      bg="var(--mantine-color-dark-9)"
      bdrs="md"
      {...moments}
    />
  );
}

/** The recording of one result, read only when this is on screen, with the steps beside it that seek it. */
export function Player({ result }: { result: EvidenceResult }) {
  const detail = useCheckDetail(result.layer, result.row);
  const videos = useMemo(() => videosIn(detail.data?.check), [detail.data]);
  const requested = useRequestedMoment();
  const sources = useMemo(
    () =>
      videos.flatMap((attachment) => {
        const { url } = attachmentSource(attachment, result.layer.id);
        return url ? [{ attachment, url, list: [attachment] }] : [];
      }),
    [videos, result.layer.id]
  );
  if (detail.isLoading) {
    return (
      <Card padding="md" shadow="none" bg="var(--mantine-color-default-hover)">
        <StateBlock role="status" icon={<IconPlayerPlay size={22} />}>
          Loading the recording…
        </StateBlock>
      </Card>
    );
  }
  if (detail.isError) {
    return (
      <Alert role="alert" color="red">
        The recording could not be read.
      </Alert>
    );
  }
  if (!sources.length) {
    return (
      <Card padding="md" shadow="none" bg="var(--mantine-color-default-hover)">
        <StateBlock icon={<IconEyeOff size={22} />}>This result names a recording, but no file can be played from here.</StateBlock>
      </Card>
    );
  }
  const shown = sources.find(({ attachment }) => attachmentIdentity(attachment) === requested.clip) ?? sources[0]!;
  const { attachment, url } = shown;
  const check = detail.data!.check;
  const steps = stepsOfRecording(check, attachmentIdentity(attachment));
  return (
    <Stack gap="sm">
      {/* What the recording does and does not show, as its producer declared it; undeclared says unknown. */}
      <ScopeProvider scope={effectiveScope(check.scope, detail.data?.inheritedScope)}>
        <MomentPlayback steps={steps} attachments={shown.list} layer={result.layer.id}>
          <ScopeNotice scope={effectiveScope(attachment.scope, check.scope, detail.data?.inheritedScope)} name={attachment.name} />
          <WatchVideo attachment={attachment} url={url} />
          {steps.length > 0 && <Timeline steps={steps} layer={result.layer.id} />}
        </MomentPlayback>
      </ScopeProvider>
      {sources.length > 1 && (
        <Text component="div" size="xs" c="dimmed">
          {plural(sources.length - 1, 'more recording', 'more recordings')} in Inspect.
        </Text>
      )}
    </Stack>
  );
}

/** What the result shown recorded and where it came from: its status, environment, run, commit and time. */
export function Provenance({ subject }: { subject: EvidenceResult }) {
  const { backends } = useEvidence();
  const now = useNow();
  return (
    <Group gap="xs" wrap="wrap" align="center" fz="sm">
      <StatusMark status={subject.row.status} size={14} />
      <Text span inherit fw={600}>
        {statusWord(subject.row.status)}
      </Text>
      <Text span inherit c="dimmed">
        in {environmentLabel(subject.layer.environment)}
      </Text>
      <Origin layer={subject.layer} backends={backends} now={now} />
    </Group>
  );
}

/** What a behavior with no recording says where the player would be: that there is nothing to watch, and why. */
export function NothingToWatch({ state }: { state: CoverageState }) {
  return (
    <Card padding="md" shadow="none" bg="var(--mantine-color-default-hover)">
      <StateBlock icon={<IconEyeOff size={22} />}>Nothing to watch. {COVERAGE[state].meaning}</StateBlock>
    </Card>
  );
}

/** The sentence under every recording: it shows one run and approves nothing. */
export function Illustrative() {
  return (
    <Text component="div" size="xs" c="dimmed">
      Illustrative recording of one run. It shows what happened in that run and does not approve the behavior for production.
    </Text>
  );
}

/** Read, Watch and Inspect for one behavior. `inspect` is the technical record, shown only under Inspect. */
export function BehaviorPanel({
  behavior,
  inspect,
  start,
  applicability,
  release = {}
}: {
  behavior: Behavior;
  inspect: ReactNode;
  /** How the evidence applies to the promise and the named release, shown with the recording and under Inspect. */
  applicability?: Assessment;
  /** The release the reader named, if any. */
  release?: ReleaseIdentity;
  /** The tab to open on; by default Watch when there is something to watch, Inspect while a run is in progress (its progress lives there), else Read. */ start?:
    'read' | 'watch' | 'inspect';
}) {
  const { scenario, example, demo, subject, revision, state } = behavior;
  const { steps, entry, expected, named } = useMemo(() => behaviorSteps(behavior), [behavior]);
  // The coverage state is the check's combined status; this says what the recording or result shown here recorded, apart from it.
  const outcome =
    subject && behavior.slot ? (
      <Text component="div" fw={600} data-outcome-headline>
        {outcomeHeadline({ layer: subject.layer, row: subject.row }, behavior.slot).text}
      </Text>
    ) : null;
  return (
    <Tabs
      defaultValue={start ?? (demo ? 'watch' : state === 'running' || behavior.slot?.live ? 'inspect' : 'read')}
      keepMounted={false}
      aria-label={`${scenario.name}${example ? `: ${example}` : ''}`}
    >
      <Tabs.List mb="md">
        <Tabs.Tab value="read" leftSection={<IconBook size={16} aria-hidden="true" />}>
          Read
        </Tabs.Tab>
        <Tabs.Tab value="watch" leftSection={<IconPlayerPlay size={16} aria-hidden="true" />}>
          Watch
        </Tabs.Tab>
        <Tabs.Tab value="inspect" leftSection={<IconSearch size={16} aria-hidden="true" />}>
          Inspect
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="read">
        <Stack gap="sm" miw={0}>
          <Group gap="xs">
            <CoverageBadge state={state} />
            <Text component="span" c="dimmed">
              {COVERAGE[state].meaning}
            </Text>
          </Group>
          {outcome}
          {example !== null && (
            <Text component="div" c="dimmed">
              Example: {example}
            </Text>
          )}
          <Box fz="sm">
            <PlainSteps steps={steps} examples={entry ? [] : scenario.examples} />
          </Box>
          {named && (
            <Text component="div" c="dimmed">
              The recorded example name does not match one row of the examples, so the values are not filled in.
            </Text>
          )}
        </Stack>
      </Tabs.Panel>
      <Tabs.Panel value="watch">
        <Stack gap="md" miw={0}>
          <Group gap="xs" wrap="wrap">
            <CoverageBadge state={state} />
            {behavior.representative && <Badge variant="outline">Representative demo</Badge>}
            {subject && <Provenance subject={subject} />}
          </Group>
          {demo ? (
            <Stack gap="xs" miw={0}>
              <Player result={demo} />
              <Illustrative />
            </Stack>
          ) : (
            <NothingToWatch state={state} />
          )}
          {expected.length > 0 && (
            <Card component="section" aria-label="Expected outcome" padding="md" shadow="none">
              <Title order={4} size="xs" c="dimmed" fw={500} mb={6}>
                Expected
              </Title>
              <Box fz="sm">
                <PlainSteps steps={expected} />
              </Box>
            </Card>
          )}
          <ScopedSummary behavior={behavior} />
          <RevisionLine revision={revision} />
          {applicability && <ApplicabilitySummary assessment={applicability} release={release} />}
        </Stack>
      </Tabs.Panel>
      <Tabs.Panel value="inspect">
        <Stack gap="sm" miw={0}>
          <RevisionLine revision={revision} />
          {applicability && <ApplicabilitySummary assessment={applicability} release={release} />}
          {inspect}
        </Stack>
      </Tabs.Panel>
    </Tabs>
  );
}

/**
 * What the feature's behaviors add up to, one count per state. A state with none is left out except
 * `demonstrated`, which is always named so its absence is not mistaken for a pass.
 */
export function CoverageSummary({ counts, total }: { counts: CoverageCounts; total: number }) {
  if (total === 0) return null;
  return (
    <Card component="section" aria-label="Coverage" padding="md">
      <Group justify="space-between" align="center" gap="md">
        <Stack gap={2} flex={1} miw={{ base: '100%', sm: 320 }}>
          <Title order={2}>Coverage</Title>
          <Text component="div">
            {counts.demonstrated} of {plural(total, 'behavior', 'behaviors')} demonstrated with a recording of the current spec.
          </Text>
          <Text component="div" size="xs" c="dimmed">
            A recording shows one run. It is illustrative evidence and does not mean the behavior is live or ready for production.
          </Text>
        </Stack>
        <Group component="ul" gap="xs" m={0} p={0}>
          {COVERAGE_ORDER.filter((state) => state === 'demonstrated' || counts[state] > 0).map((state) => (
            <Card key={state} component="li" data-coverage={state} padding="xs" shadow="none" title={COVERAGE[state].meaning}>
              <Group gap="xs" wrap="nowrap">
                <CoverageBadge state={state} />
                <Text span fw={600}>
                  {counts[state]}
                </Text>
              </Group>
            </Card>
          ))}
        </Group>
      </Group>
    </Card>
  );
}
