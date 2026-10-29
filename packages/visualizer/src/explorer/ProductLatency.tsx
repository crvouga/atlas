/**
 * @module Product latency view
 *
 * How quickly the product responded to a user, apart from how long the test took. It reads only the measurements a
 * producer named as product latency (see `@crvouga/atlas/reports/latency`) and shows, for each, its boundaries, unit,
 * source, group (device, build or day), sample count, budget and breaches, p50 and p95 when enough observations
 * support them, and a comparison with a chosen baseline that names every difference in instrumentation or
 * conditions. What the evidence cannot support is withheld with the reason. A test with no named measurement says its
 * product latency is unknown; its execution time is never shown here.
 */
import {
  compareLatency, formatLatency, latencyReview, LATENCY_GROUPINGS, type LatencyChange, type LatencyGrouping, type LatencyReview, type LatencySummary
} from '@crvouga/atlas/reports/latency';
import type { TestResultEntry } from '@crvouga/atlas/reports/test-catalog';
import { Badge, Box, Code, Flex, List, NativeSelect, Stack, Table, Text, Title } from '@mantine/core';
import { useMemo, useState } from 'react';

import { plural } from '../evidence/format';

const GROUPING_LABEL: Record<LatencyGrouping, string> = { none: 'Not grouped', device: 'Device', build: 'Build', window: 'Day recorded' };

const sign = (value: number) => (value > 0 ? '+' : value < 0 ? '−' : '');

/** A change as words: `+100 ms (+25%) in p50`. */
function changeText(change: LatencyChange, unit: string): string {
  const delta = change.p50 ?? change.p95 ?? change.last;
  if (!change.comparable || !delta) return 'Not compared';
  const relative = delta.relative === null ? 'baseline was 0' : `${sign(delta.relative)}${Math.abs(Math.round(delta.relative * 1000) / 10)}%`;
  const basis = change.basis === 'last' ? 'in the newest observation, not a percentile' : `in ${change.basis}`;
  return `${sign(delta.absolute)}${formatLatency(Math.abs(delta.absolute), unit)} (${relative}) ${basis}`;
}

function Figure({ value, unit, summary }: { value: number | undefined; unit: string; summary: LatencySummary }) {
  return value === undefined ? (
    <Text span inherit c="dimmed">
      Withheld{summary.claim ? '' : ' (no boundaries)'}
    </Text>
  ) : (
    <>
      {summary.lowerBound ? '≥ ' : ''}
      {formatLatency(value, unit)}
    </>
  );
}

function MetricTable({ summaries, baseline }: { summaries: readonly LatencySummary[]; baseline: LatencySummary | undefined }) {
  const unit = summaries[0]!.metric.unit;
  const changes = new Map(summaries.map((summary) => [summary.group, baseline && summary !== baseline ? compareLatency(baseline, summary) : undefined]));
  return (
    <Table.ScrollContainer minWidth={560}>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th scope="col">Group</Table.Th>
            <Table.Th scope="col">Observations</Table.Th>
            <Table.Th scope="col">p50</Table.Th>
            <Table.Th scope="col">p95</Table.Th>
            <Table.Th scope="col">Budget</Table.Th>
            <Table.Th scope="col">Over budget</Table.Th>
            {baseline && <Table.Th scope="col">Against baseline</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {summaries.map((summary) => {
            const change = changes.get(summary.group);
            return (
              <Table.Tr key={summary.group}>
                <Table.Th scope="row">{summary.group}</Table.Th>
                <Table.Td>
                  {summary.samples}
                  {summary.timeouts + summary.failures > 0 && (
                    <Text span inherit c="dimmed">
                      {' '}
                      ({summary.timeouts + summary.failures} did not complete)
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Figure value={summary.p50} unit={unit} summary={summary} />
                </Table.Td>
                <Table.Td>
                  <Figure value={summary.p95} unit={unit} summary={summary} />
                </Table.Td>
                <Table.Td>{summary.budget === undefined ? <Text span inherit c="dimmed">None set</Text> : formatLatency(summary.budget, unit)}</Table.Td>
                <Table.Td>
                  {summary.budget === undefined ? (
                    '—'
                  ) : summary.breaches > 0 ? (
                    <Badge color="red" variant="light">
                      {summary.breaches} of {summary.samples} over
                    </Badge>
                  ) : (
                    `0 of ${summary.samples}`
                  )}
                </Table.Td>
                {baseline && <Table.Td>{summary === baseline ? 'Baseline' : change ? changeText(change, unit) : '—'}</Table.Td>}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

/** What a reader must not assume, per group and per comparison, as one list. */
function Notes({ summaries, baseline }: { summaries: readonly LatencySummary[]; baseline: LatencySummary | undefined }) {
  const lines: string[] = [];
  for (const summary of summaries) {
    const name = summaries.length > 1 ? `${summary.group}: ` : '';
    for (const line of [...summary.gaps, ...summary.withheld]) lines.push(`${name}${line}`);
    if (baseline && summary !== baseline) {
      const change = compareLatency(baseline, summary);
      for (const reason of change.reasons) lines.push(`${summary.group} against ${baseline.group}: ${reason}`);
      for (const disclosure of change.disclosures) lines.push(`${summary.group} against ${baseline.group}: ${disclosure}`);
    }
  }
  if (!lines.length) return null;
  return (
    <List aria-label="What these figures do not show" size="sm" c="dimmed">
      {lines.map((line, index) => (
        <List.Item key={index}>{line}</List.Item>
      ))}
    </List>
  );
}

function Metric({ metric, groups, baselineGroup }: { metric: LatencyReview['metrics'][number]['metric']; groups: readonly LatencySummary[]; baselineGroup: string | undefined }) {
  const baseline = groups.length > 1 ? (groups.find((summary) => summary.group === baselineGroup) ?? groups[1]) : undefined;
  const first = groups[0]!;
  const source = [...new Set(groups.map((summary) => summary.metric.boundary.label))];
  return (
    <Stack gap="xs" aria-label={metric.name} role="group">
      <Flex gap="xs" align="center" wrap="wrap">
        <Text span inherit fw={600}>
          {metric.name}
        </Text>
        <Text span inherit c="dimmed">
          {source.join(', ')} · {metric.unit}
        </Text>
        {metric.boundary.state === 'partial' && <Badge color="orange" variant="light">Partial interval</Badge>}
        {metric.boundary.state === 'undeclared' && <Badge color="gray" variant="light">Boundaries not declared</Badge>}
        {first.lowerBound && <Badge color="orange" variant="light">Includes timeouts or failures</Badge>}
      </Flex>
      <MetricTable summaries={groups} baseline={baseline} />
      <Notes summaries={groups} baseline={baseline} />
    </Stack>
  );
}

/**
 * The product latency of one test, from its recorded results (newest first, as the history lists them). Grouping and
 * the baseline are the viewer's own choices and are not saved. With nothing recorded it says product latency is
 * unknown and how a producer records it.
 */
export function ProductLatency({ entries }: { entries: readonly TestResultEntry[] }) {
  const [by, setBy] = useState<LatencyGrouping>('none');
  const [baseline, setBaseline] = useState<string | undefined>(undefined);
  const review = useMemo(() => latencyReview(entries, by), [entries, by]);
  const groups = [...new Set(review.metrics.flatMap((item) => item.groups.map((summary) => summary.group)))];
  return (
    <Box aria-label="Product latency" component="section" mb="lg">
      <Title order={3} mb="sm" c="dimmed">
        Product latency
      </Title>
      <Text component="div" c="dimmed" mb="sm">
        How quickly the product responded to a user, between two events the producer named. It is not the test's duration, which includes setup,
        waits, retries and any demo pacing.
      </Text>
      {review.metrics.length === 0 ? (
        <Text component="div" role="status">
          No product latency was recorded for this test, so it is unknown, not fast. A producer records one as a measurement with{' '}
          <Code>kind: "product-latency"</Code>, a <Code>from</Code> and a <Code>to</Code>, and optionally a <Code>limit</Code> as the budget.
        </Text>
      ) : (
        <Stack gap="md">
          <Flex gap="md" wrap="wrap" align="flex-end">
            <NativeSelect
              label="Group latency by"
              value={by}
              onChange={(event) => {
                setBy(event.target.value as LatencyGrouping);
                setBaseline(undefined);
              }}
            >
              {LATENCY_GROUPINGS.map((option) => (
                <option key={option} value={option}>
                  {GROUPING_LABEL[option]}
                </option>
              ))}
            </NativeSelect>
            {groups.length > 1 && (
              <NativeSelect label="Baseline to compare against" value={baseline ?? ''} onChange={(event) => setBaseline(event.target.value || undefined)}>
                <option value="">Second newest group</option>
                {groups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Flex>
          {review.metrics.map(({ metric, groups: summaries }) => (
            <Metric key={metric.key} metric={metric} groups={summaries} baselineGroup={baseline} />
          ))}
          <Text component="div" c="dimmed">
            {plural(review.measured, 'recorded result carries', 'recorded results carry')} product latency
            {review.unmeasured > 0 ? `; ${plural(review.unmeasured, 'result records', 'results record')} none, which is unknown, not fast` : ''}.
          </Text>
        </Stack>
      )}
    </Box>
  );
}
