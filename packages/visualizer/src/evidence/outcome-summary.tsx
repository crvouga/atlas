/**
 * @module Outcome summary
 *
 * What the selected result says, stated apart from the other current sources, and the failure explained before its
 * raw output: the heading names the selected source's outcome and what the other scoped sources recorded (each one
 * click away), whether the behavior was reached, the recorded expected and observed values, the closest video and
 * step, the chronology of the source, and who is to blame, which stays unknown unless the producer declared it. The
 * original diagnostics remain below, untouched.
 */
import type { CheckSlot, HistoryEntry } from '@crvouga/atlas/reports/evidence-view';
import type { CheckDetail } from '@crvouga/atlas/reports/evidence-detail';
import { effectiveScope, scopeBadges } from '@crvouga/atlas/reports/evidence-scope';
import { Badge, Button, Code, Group, List, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useState } from 'react';

import { ago, duration, shortSha, statusWord } from './format';
import { StatusMark } from './marks';
import { momentOwner, requestFailureMoment } from './moments';
import {
  chronology,
  failureNote,
  outcomeHeadline,
  passedAfterFailure,
  recordOf,
  type ResultRecord,
  reachOf,
  sourceLabels,
  videosIn,
  type FailurePoint
} from './outcome';

const BLAME: Record<string, string> = {
  product: 'the product',
  'test-harness': 'the test harness',
  environment: 'the environment'
};

/**
 * The outcome of the selected result in words, the other current sources beside it, and, for a failure, where and
 * how it failed. `point` is the failed step found in the recording (undefined when none was recorded); `detail` is the
 * check's full record, for its videos and scope. `choose` selects one of the other current sources; `showHeadline`
 * is false when the page already shows the heading.
 */
export function OutcomeSummary({
  slot,
  selected,
  history,
  point,
  detail,
  now,
  choose,
  showHeadline = true
}: {
  slot: CheckSlot;
  selected: HistoryEntry;
  history: readonly ResultRecord[];
  point: FailurePoint | undefined;
  detail: CheckDetail | undefined;
  now: number;
  choose: (layerId: string) => void;
  showHeadline?: boolean;
}) {
  const headline = outcomeHeadline(selected, slot);
  const failed = selected.row.status === 'failed';
  const reach = failed ? reachOf(point) : undefined;
  const note = point?.note ?? failureNote(detail?.check.extensions);
  const every = sourceLabels(slot.outcomes, now);
  const labels = headline.others.map((outcome) => every[slot.outcomes.indexOf(outcome)]!);
  const video = point?.videos[0] ?? videosIn(detail?.check)[0];
  const scope = video ? effectiveScope(video.scope, detail?.check.scope, detail?.inheritedScope) : undefined;
  const timeline = chronology(recordOf(selected), history);
  const [jumped, setJumped] = useState<string | null>(null);
  return (
    <Paper component="section" aria-label="Outcome summary" data-outcome={selected.row.status} withBorder radius="md" p="md">
      <Stack gap="sm" miw={0}>
        {showHeadline && (
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <Group pt={3} lh={1} gap={0}>
              <StatusMark status={selected.row.status} size={16} />
            </Group>
            <Title order={3} data-outcome-headline flex={1} miw={0}>
              {headline.text}
            </Title>
          </Group>
        )}
        {reach && (
          <Group gap="xs" align="center" wrap="wrap" data-reach={reach.state}>
            <Badge variant={reach.state === 'setup-failed' ? 'filled' : 'light'} color={reach.state === 'unknown' ? 'gray' : 'red'}>
              {reach.state === 'setup-failed'
                ? 'Behavior not verified'
                : reach.state === 'expectation-failed'
                  ? 'Expectation not met'
                  : 'Failure point unknown'}
            </Badge>
            <Text span flex={1} miw="12rem">
              {reach.text}
            </Text>
          </Group>
        )}
        {failed && (note?.expected !== undefined || note?.actual !== undefined) && (
          <SimpleGrid component="dl" aria-label="Expected and observed" cols={{ base: 1, sm: 2 }} spacing="sm" m={0}>
            {note?.expected !== undefined && (
              <Stack gap={4} miw={0}>
                <Text component="dt" size="xs" c="dimmed" fw={500}>
                  Expected
                </Text>
                <Code component="dd" block m={0}>
                  {note.expected}
                </Code>
              </Stack>
            )}
            {note?.actual !== undefined && (
              <Stack gap={4} miw={0}>
                <Text component="dt" size="xs" c="dimmed" fw={500}>
                  Observed
                </Text>
                <Code component="dd" block m={0} c="red.7">
                  {note.actual}
                </Code>
              </Stack>
            )}
          </SimpleGrid>
        )}
        {failed && (point || video) && (
          <Stack gap={4} component="section" aria-label="Closest evidence">
            {point && (
              <Text component="div">
                <Text span inherit c="dimmed">
                  Closest step:{' '}
                </Text>
                <Text span inherit fw={600}>
                  {point.name}
                </Text>
                {point.offsetMs !== undefined && (
                  <Text span inherit c="dimmed">
                    {' '}
                    at {duration(point.offsetMs) || '0 ms'} into the check
                  </Text>
                )}
              </Text>
            )}
            {video && (
              <Text component="div">
                <Text span inherit c="dimmed">
                  Closest video:{' '}
                </Text>
                <Text span inherit fw={600}>
                  {video.description ?? video.name}
                </Text>
                <Text span inherit c="dimmed">
                  {' '}
                  {point?.videos.length ? 'attached to that step' : 'recorded for the whole check'}
                  {' · '}
                  {scopeBadges(scope)
                    .map((badge) => badge.text)
                    .join(', ')}
                </Text>
              </Text>
            )}
            {video && point && (
              <Group gap="xs" align="center" wrap="wrap" mt={4}>
                <Button
                  type="button"
                  variant="light"
                  color="red"
                  size="compact-sm"
                  leftSection={<IconAlertTriangle size={14} aria-hidden="true" />}
                  onClick={() =>
                    setJumped(
                      requestFailureMoment(momentOwner(selected.layer.id, selected.row.kind, selected.row.id))?.text ??
                        'The recording of this result is not on screen yet. It is in the evidence below.'
                    )
                  }
                >
                  Jump to the failing moment in the recording
                </Button>
                {jumped && (
                  <Text span role="status" c="dimmed" size="xs" data-jump-result>
                    {jumped}
                  </Text>
                )}
              </Group>
            )}
          </Stack>
        )}
        {failed && (
          <Text component="div" c="dimmed" size="xs" data-attribution={note?.attribution ?? 'unknown'}>
            Cause:{' '}
            {note?.attribution
              ? `${BLAME[note.attribution]}, as declared by the producer`
              : 'unknown. Nothing recorded says whether the product, the test harness or the environment is at fault.'}
          </Text>
        )}
        {headline.others.length > 0 && (
          <Stack gap={4} component="section" aria-label="Other current sources">
            <Text component="div" c="dimmed" size="xs" fw={500}>
              Other current sources of this check
            </Text>
            <List listStyleType="none" spacing={2}>
              {headline.others.map((outcome, index) => (
                <List.Item key={outcome.key}>
                  <Button
                    type="button"
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => choose(outcome.layer.id)}
                    aria-label={`Open ${labels[index]!.text}`}
                    leftSection={<StatusMark status={outcome.row.status} size={12} />}
                  >
                    {labels[index]!.text}
                  </Button>
                </List.Item>
              ))}
            </List>
          </Stack>
        )}
        {timeline.length > 0 && (
          <Stack gap={4} component="section" aria-label="Chronology of this source">
            <Text component="div" c="dimmed" size="xs" fw={500}>
              Records of this source, oldest first
            </Text>
            <List listStyleType="none" spacing={4} type="ordered">
              {timeline.map(({ record, selected: current }) => (
                <List.Item key={`${record.layer}|${record.kind}`} aria-current={current || undefined} data-status={record.status}>
                  <Group gap="xs" align="center" wrap="wrap">
                    <StatusMark status={record.status} size={12} />
                    <Text span fw={current ? 600 : undefined}>
                      {statusWord(record.status)}
                    </Text>
                    <Text span c="dimmed" size="xs">
                      {ago(record.at, now)} · {shortSha(record.sha) ?? 'revision not recorded'}
                      {current ? ' · selected' : ''}
                    </Text>
                  </Group>
                </List.Item>
              ))}
            </List>
            {passedAfterFailure(timeline) && (
              <Text component="div" role="status" c="dimmed" size="xs">
                The latest run passed after an earlier failure. Nothing recorded shows that the failure was fixed or why it passed.
              </Text>
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
