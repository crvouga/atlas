/**
 * @module Scoped behavior summary view
 *
 * A compact outcome, reliability and performance summary for one behavior, shown beside its recording. The three
 * answers are kept apart and each is qualified: the outcome is what the shown result says (never the combined status),
 * reliability names the independent executions it rests on, and product latency is only what a producer measured as such.
 * Where there is no evidence the section says it is unknown. It reads the check's history only when it is on screen.
 */
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { Alert, Anchor, Badge, Box, Group, List, Paper, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { useTestHistory } from '../explorer/catalog';
import type { Behavior } from './behavior';
import { outcomeHeadline } from './outcome';
import { scopedFigures, type SummaryLine } from './scoped-summary';

function Line({ line }: { line: SummaryLine }) {
  return (
    <Stack gap={0} data-tone={line.tone}>
      <Group gap="xs" wrap="wrap">
        <Text span inherit fw={600}>
          {line.headline}
        </Text>
        {line.tone === 'weak' && (
          <Badge color="orange" variant="light">
            Read with care
          </Badge>
        )}
      </Group>
      <List listStyleType="none" c="dimmed">
        {line.qualifiers.map((qualifier) => (
          <List.Item key={qualifier}>{qualifier}</List.Item>
        ))}
      </List>
    </Stack>
  );
}

/**
 * The scoped summary of a behavior: the outcome of the result shown, and the reliability and product latency of the
 * same check in the same environment. `behavior` supplies the result and check; with no recorded check the summary says
 * every figure is unknown.
 */
export function ScopedSummary({ behavior }: { behavior: Behavior }) {
  const { slot, subject } = behavior;
  const history = useTestHistory(slot?.key);
  const environment = subject?.layer.environment ?? null;
  const figures = useMemo(
    () => (history.data ? scopedFigures(slot!.key, history.data.history, { environment }) : null),
    [history.data, slot, environment]
  );
  if (!slot || !subject) {
    return (
      <Paper component="section" aria-label="Scoped summary" withBorder p="md">
        <Title order={4} mb="xs">
          Outcome, reliability and performance
        </Title>
        <Text component="div" c="dimmed">
          Nothing has been recorded for this behavior, so its outcome, reliability and product latency are unknown.
        </Text>
      </Paper>
    );
  }
  return (
    <Paper component="section" aria-label="Scoped summary" withBorder p="md">
      <Stack gap="sm" miw={0}>
        <Group gap="xs" wrap="wrap" justify="space-between">
          <Title order={4}>Outcome, reliability and performance</Title>
          <Text span c="dimmed">
            {environment === null ? 'All environments pooled' : `In ${environmentLabel(environment)}`}
          </Text>
        </Group>
        <Box>
          <Text c="dimmed">Outcome</Text>
          <Text component="div" fw={600} data-outcome-headline>
            {outcomeHeadline({ layer: subject.layer, row: subject.row }, slot).text}
          </Text>
        </Box>
        {history.isError ? (
          <Alert role="alert" color="red">
            The history of this behavior could not be read, so its reliability and product latency are unknown.
          </Alert>
        ) : !figures ? (
          <Text role="status" component="div" c="dimmed">
            Reading the history…
          </Text>
        ) : (
          <>
            <Box aria-label="Reliability" component="section">
              <Text c="dimmed">Reliability</Text>
              <Line line={figures.reliability} />
            </Box>
            <Box aria-label="Product latency" component="section">
              <Text c="dimmed">Performance</Text>
              {figures.latency.map((line) => (
                <Line key={line.headline} line={line} />
              ))}
            </Box>
          </>
        )}
        <Text component="div" c="dimmed">
          These describe the checks Atlas holds, not production. A passing recording is one clip of one run and does not approve the behavior.{' '}
          <Anchor renderRoot={(props) => <Link {...props} to="/" search={{ view: 'tests', test: slot.key, layer: subject.layer.id }} />}>See reliability and latency detail</Anchor>
        </Text>
      </Stack>
    </Paper>
  );
}
