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
import { Badge, Box, Button, Flex, List, Paper, Stack, Text, Title } from '@mantine/core';
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
    <Paper component="section" aria-label="Outcome summary" data-outcome={selected.row.status} withBorder p="md">
      <Stack gap="sm" miw={0}>
        {showHeadline && (
          <Title order={3} data-outcome-headline>
            {headline.text}
          </Title>
        )}
        {headline.others.length > 0 && (
          <Stack gap="xs" component="section" aria-label="Other current sources">
            <Text component="div" c="dimmed">
              Other current sources of this check
            </Text>
            <List listStyleType="none" spacing="xs">
              {headline.others.map((outcome, index) => (
                <List.Item key={outcome.key}>
                  <Button type="button" variant="light" onClick={() => choose(outcome.layer.id)} aria-label={`Open ${labels[index]!.text}`}>
                    <StatusMark status={outcome.row.status} size={12} />
                    <Text span inherit>
                      {labels[index]!.text}
                    </Text>
                  </Button>
                </List.Item>
              ))}
            </List>
          </Stack>
        )}
        {reach && (
          <Flex gap="xs" align="center" wrap="wrap" data-reach={reach.state}>
            <Badge variant={reach.state === 'setup-failed' ? 'filled' : 'light'} color={reach.state === 'unknown' ? 'gray' : 'red'}>
              {reach.state === 'setup-failed'
                ? 'Behavior not verified'
                : reach.state === 'expectation-failed'
                  ? 'Expectation not met'
                  : 'Failure point unknown'}
            </Badge>
            <Text span inherit>
              {reach.text}
            </Text>
          </Flex>
        )}
        {failed && (note?.expected !== undefined || note?.actual !== undefined) && (
          <Box component="dl" aria-label="Expected and observed" m={0}>
            {note?.expected !== undefined && (
              <>
                <Text component="dt" fw={600}>
                  Expected
                </Text>
                <Text component="dd" m={0}>
                  {note.expected}
                </Text>
              </>
            )}
            {note?.actual !== undefined && (
              <>
                <Text component="dt" fw={600}>
                  Observed
                </Text>
                <Text component="dd" m={0}>
                  {note.actual}
                </Text>
              </>
            )}
          </Box>
        )}
        {failed && (point || video) && (
          <Stack gap="xs" component="section" aria-label="Closest evidence">
            {point && (
              <Text component="div">
                Closest step:{' '}
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
                Closest video:{' '}
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
              <Flex gap="xs" align="center" wrap="wrap">
                <Button
                  type="button"
                  variant="light"
                  color="red"
                  leftSection={<IconAlertTriangle size={16} aria-hidden="true" />}
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
                  <Text span inherit role="status" c="dimmed" data-jump-result>
                    {jumped}
                  </Text>
                )}
              </Flex>
            )}
          </Stack>
        )}
        {failed && (
          <Text component="div" c="dimmed" data-attribution={note?.attribution ?? 'unknown'}>
            Cause:{' '}
            {note?.attribution
              ? `${BLAME[note.attribution]}, as declared by the producer`
              : 'unknown. Nothing recorded says whether the product, the test harness or the environment is at fault.'}
          </Text>
        )}
        {timeline.length > 0 && (
          <Stack gap="xs" component="section" aria-label="Chronology of this source">
            <Text component="div" c="dimmed">
              Records of this source, oldest first
            </Text>
            <List listStyleType="none" spacing="xs" type="ordered">
              {timeline.map(({ record, selected: current }) => (
                <List.Item key={`${record.layer}|${record.kind}`} aria-current={current || undefined} data-status={record.status}>
                  <Flex gap="xs" align="center" wrap="wrap">
                    <StatusMark status={record.status} size={12} />
                    <Text span inherit fw={current ? 600 : undefined}>
                      {statusWord(record.status)}
                    </Text>
                    <Text span inherit c="dimmed">
                      {ago(record.at, now)} · {shortSha(record.sha) ?? 'revision not recorded'}
                      {current ? ' · selected' : ''}
                    </Text>
                  </Flex>
                </List.Item>
              ))}
            </List>
            {passedAfterFailure(timeline) && (
              <Text component="div" role="status">
                The latest run passed after an earlier failure. Nothing recorded shows that the failure was fixed or why it passed.
              </Text>
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
