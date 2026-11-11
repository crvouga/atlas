/**
 * @module Scoped behavior summary view
 *
 * A compact outcome, reliability and performance summary for one behavior, shown beside its recording. The three
 * answers are kept apart and each is qualified: the outcome is what the shown result says (never the combined status),
 * reliability names the independent executions it rests on, and product latency is only what a producer measured as such.
 * Where there is no evidence the section says it is unknown. It reads the check's history only when it is on screen.
 */
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { Alert, Anchor, Badge, Card, Group, List, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useMemo, type ReactNode } from 'react';

import { useTestHistory } from '../explorer/catalog';
import type { Behavior } from './behavior';
import { outcomeHeadline } from './outcome';
import { scopedFigures, type SummaryLine } from './scoped-summary';

function Line({ line }: { line: SummaryLine }) {
  return (
    <Stack gap={4} data-tone={line.tone}>
      <Group gap="xs" wrap="wrap">
        <Text span fw={600}>
          {line.headline}
        </Text>
        {line.tone === 'weak' && (
          <Badge color="orange" variant="light">
            Read with care
          </Badge>
        )}
      </Group>
      <List listStyleType="none" c="dimmed" size="xs" spacing={2}>
        {line.qualifiers.map((qualifier) => (
          <List.Item key={qualifier}>{qualifier}</List.Item>
        ))}
      </List>
    </Stack>
  );
}

/** One of the three answers, as a tile: its quiet label above what the evidence says. */
function Tile({ label, children, ...rest }: { label: string; children: ReactNode; 'aria-label'?: string }) {
  return (
    <Card component="section" padding="md" shadow="none" {...rest}>
      <Stack gap={6}>
        <Text size="xs" c="dimmed" fw={500}>
          {label}
        </Text>
        {children}
      </Stack>
    </Card>
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
      <Stack component="section" aria-label="Scoped summary" gap="xs">
        <Title order={3}>Outcome, reliability and performance</Title>
        <Text component="div" c="dimmed">
          Nothing has been recorded for this behavior, so its outcome, reliability and product latency are unknown.
        </Text>
      </Stack>
    );
  }
  return (
    <Stack component="section" aria-label="Scoped summary" gap="sm" miw={0}>
      <Group gap="xs" wrap="wrap" justify="space-between" align="baseline">
        <Title order={3}>Outcome, reliability and performance</Title>
        <Text span size="xs" c="dimmed">
          {environment === null ? 'All environments pooled' : `In ${environmentLabel(environment)}`}
        </Text>
      </Group>
      {history.isError && (
        <Alert role="alert" color="red">
          The history of this behavior could not be read, so its reliability and product latency are unknown.
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: history.isError ? 1 : 3 }} spacing="sm">
        <Tile label="Outcome">
          <Text component="div" fw={600} data-outcome-headline>
            {outcomeHeadline({ layer: subject.layer, row: subject.row }, slot).text}
          </Text>
        </Tile>
        {history.isError ? null : !figures ? (
          <Tile label="Reliability and performance">
            <Text role="status" component="div" c="dimmed">
              Reading the history…
            </Text>
          </Tile>
        ) : (
          <>
            <Tile label="Reliability" aria-label="Reliability">
              <Line line={figures.reliability} />
            </Tile>
            <Tile label="Performance" aria-label="Product latency">
              {figures.latency.map((line) => (
                <Line key={line.headline} line={line} />
              ))}
            </Tile>
          </>
        )}
      </SimpleGrid>
      <Text component="div" size="xs" c="dimmed">
        These describe the checks Atlas holds, not production. A passing recording is one clip of one run and does not approve the behavior.{' '}
        <Anchor size="xs" underline="always" renderRoot={(props) => <Link {...props} to="/" search={{ view: 'tests', test: slot.key, layer: subject.layer.id }} />}>See reliability and latency detail</Anchor>
      </Text>
    </Stack>
  );
}
