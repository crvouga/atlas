/**
 * @module Behavior panel
 *
 * How a product reader meets one behavior of a feature: Read (the promise and what is expected, with an outline's
 * concrete example filled in), Watch (the matched recording beside what it should show) and Inspect (the technical
 * record: run, environment, source, attempts). Also the coverage summary of the whole feature. A recording is always
 * labelled as illustrative evidence with its own status, provenance and revision; it never stands for approval.
 */
import type { EvidenceHolder } from '@crvouga/atlas/reports/evidence-detail';
import { isVideoAttachment } from '@crvouga/atlas/reports/evidence-detail';
import { effectiveScope } from '@crvouga/atlas/reports/evidence-scope';
import type { EvidenceResult } from '@crvouga/atlas/reports/layer-merge';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import type { Attachment } from '@crvouga/atlas/schema';
import { Alert, Badge, Box, Group, List, Paper, Stack, Tabs, Text, Title } from '@mantine/core';
import { useMemo, type ReactNode } from 'react';

import { attachmentSource, useCheckDetail } from './artifacts';
import { COVERAGE, COVERAGE_ORDER, type Behavior, type CoverageCounts, type CoverageState, type Revision } from './behavior';
import { PlainSteps } from './check-detail';
import { useEvidence } from './evidence-context';
import { ScopeNotice } from './evidence-scope';
import { plural, statusWord, useNow } from './format';
import { exampleIndexFor, exampleRows, fillExample, type FeatureStep } from './gherkin';
import { Origin, StatusMark } from './marks';

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

/**
 * The promise and the evidence side by side, each with its own revision. A mismatch is stated, not hidden; a missing
 * fingerprint is stated as unknown rather than treated as a match.
 */
export function RevisionLine({ revision }: { revision: Revision }) {
  return (
    <Stack gap="xs" data-revision={revision.match}>
      <Group gap="md" wrap="wrap" c="dimmed">
        <Text span inherit>
          Promise revision:{' '}
          <Text span inherit fw={600}>
            {revision.promise ? shortRevision(revision.promise) : 'not recorded'}
          </Text>
        </Text>
        <Text span inherit>
          Evidence revision:{' '}
          <Text span inherit fw={600}>
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
        <Text component="div" c="dimmed">
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

function videosIn(holder: EvidenceHolder | undefined): Attachment[] {
  if (!holder) return [];
  const own = (holder.attachments ?? []).filter(isVideoAttachment);
  return [
    ...own,
    ...(holder.steps ?? []).flatMap((step) => (step.attachments ?? []).filter(isVideoAttachment)),
    ...(holder.attempts ?? []).flatMap((attempt) => [
      ...(attempt.attachments ?? []).filter(isVideoAttachment),
      ...(attempt.steps ?? []).flatMap((step) => (step.attachments ?? []).filter(isVideoAttachment))
    ])
  ];
}

/** The recording of one result, read only when this is on screen. */
function Player({ result }: { result: EvidenceResult }) {
  const detail = useCheckDetail(result.layer, result.row);
  const videos = useMemo(() => videosIn(detail.data?.check), [detail.data]);
  const sources = videos.flatMap((attachment) => {
    const { url } = attachmentSource(attachment, result.layer.id);
    return url ? [{ attachment, url }] : [];
  });
  if (detail.isLoading) {
    return (
      <Text role="status" component="div" c="dimmed">
        Loading the recording…
      </Text>
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
      <Text component="div" c="dimmed">
        This result names a recording, but no file can be played from here.
      </Text>
    );
  }
  return (
    <Stack gap="sm">
      {sources.slice(0, 1).map(({ attachment, url }) => (
        <Stack key={url} gap="xs">
          {/* What the recording does and does not show, as its producer declared it; undeclared says unknown. */}
          <ScopeNotice
            scope={effectiveScope(attachment.scope, detail.data?.check.scope, detail.data?.inheritedScope)}
            name={attachment.name}
          />
          <Box
            component="video"
            src={url}
            controls
            preload="metadata"
            aria-label={`Recording: ${attachment.description ?? attachment.name}`}
            maw="100%"
            w="100%"
            mah="70vh"
          />
        </Stack>
      ))}
      {sources.length > 1 && (
        <Text component="div" c="dimmed">
          {plural(sources.length - 1, 'more recording', 'more recordings')} in Inspect.
        </Text>
      )}
    </Stack>
  );
}

/** Read, Watch and Inspect for one behavior. `inspect` is the technical record, shown only under Inspect. */
export function BehaviorPanel({
  behavior,
  inspect,
  start
}: {
  behavior: Behavior;
  inspect: ReactNode;
  /** The tab to open on; by default Watch when there is something to watch, Inspect while a run is in progress (its progress lives there), else Read. */ start?:
    'read' | 'watch' | 'inspect';
}) {
  const { backends } = useEvidence();
  const now = useNow();
  const { scenario, example, demo, subject, revision, state } = behavior;
  const at = example === null ? -1 : exampleIndexFor(scenario, example);
  const entry = at < 0 ? null : exampleRows(scenario)[at]!;
  const steps = useMemo(() => (entry ? fillExample(scenario.steps, entry) : scenario.steps), [scenario, entry]);
  const expected = expectedSteps(steps);
  const named = example !== null && entry === null;
  return (
    <Tabs
      defaultValue={start ?? (demo ? 'watch' : state === 'running' || behavior.slot?.live ? 'inspect' : 'read')}
      keepMounted={false}
      aria-label={`${scenario.name}${example ? `: ${example}` : ''}`}
    >
      <Tabs.List mb="sm">
        <Tabs.Tab value="read">Read</Tabs.Tab>
        <Tabs.Tab value="watch">Watch</Tabs.Tab>
        <Tabs.Tab value="inspect">Inspect</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="read">
        <Stack gap="sm" miw={0}>
          <Group gap="sm">
            <CoverageBadge state={state} />
            <Text component="span" c="dimmed">
              {COVERAGE[state].meaning}
            </Text>
          </Group>
          {example !== null && (
            <Text component="div" c="dimmed">
              Example: {example}
            </Text>
          )}
          <PlainSteps steps={steps} examples={entry ? [] : scenario.examples} />
          {named && (
            <Text component="div" c="dimmed">
              The recorded example name does not match one row of the examples, so the values are not filled in.
            </Text>
          )}
        </Stack>
      </Tabs.Panel>
      <Tabs.Panel value="watch">
        <Stack gap="sm" miw={0}>
          <Group gap="sm">
            <CoverageBadge state={state} />
            {behavior.representative && <Badge variant="outline">Representative demo</Badge>}
          </Group>
          {expected.length > 0 && (
            <Box component="section" aria-label="Expected outcome">
              <Title order={4} mb="xs">
                Expected
              </Title>
              <PlainSteps steps={expected} />
            </Box>
          )}
          {demo ? (
            <>
              <Player result={demo} />
              <Text component="div" c="dimmed">
                Illustrative recording of one run. It shows what happened in that run and does not approve the behavior for production.
              </Text>
            </>
          ) : (
            <Text component="div" c="dimmed">
              Nothing to watch. {COVERAGE[state].meaning}
            </Text>
          )}
          {subject && (
            <Group gap="xs" wrap="wrap" align="center">
              <StatusMark status={subject.row.status} size={14} />
              <Text span inherit fw={600}>
                {statusWord(subject.row.status)}
              </Text>
              <Text span inherit c="dimmed">
                in {environmentLabel(subject.layer.environment)}
              </Text>
              <Origin layer={subject.layer} backends={backends} now={now} />
            </Group>
          )}
          <RevisionLine revision={revision} />
        </Stack>
      </Tabs.Panel>
      <Tabs.Panel value="inspect">
        <Stack gap="sm" miw={0}>
          <RevisionLine revision={revision} />
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
    <Paper component="section" aria-label="Coverage" withBorder p="md" my="md">
      <Stack gap="xs">
        <Title order={2}>Coverage</Title>
        <Text component="div">
          {counts.demonstrated} of {plural(total, 'behavior', 'behaviors')} demonstrated with a recording of the current spec.
        </Text>
        <List listStyleType="none" spacing="xs">
          {COVERAGE_ORDER.filter((state) => state === 'demonstrated' || counts[state] > 0).map((state) => (
            <List.Item key={state} data-coverage={state}>
              <Group gap="sm" wrap="wrap">
                <CoverageBadge state={state} />
                <Text span inherit fw={600}>
                  {counts[state]}
                </Text>
                <Text span inherit c="dimmed">
                  {COVERAGE[state].meaning}
                </Text>
              </Group>
            </List.Item>
          ))}
        </List>
        <Text component="div" c="dimmed">
          A recording shows one run. It is illustrative evidence and does not mean the behavior is live or ready for production.
        </Text>
      </Stack>
    </Paper>
  );
}
