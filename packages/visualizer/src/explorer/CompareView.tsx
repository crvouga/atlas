/**
 * @module Compare view
 *
 * The Compare tab: two pinned runs, a baseline and a candidate, set side by side. Both are named in the address (`base`
 * and `cand`), so a link reproduces the comparison and a newer run never replaces either; a pinned run that is no longer
 * in the report is said to be missing. Behaviors are paired by the check they record, never by title, and each pair is
 * in one group (newly failing, recovered, still failing, promise or conditions differ, not run, not in one run, same
 * outcome), so a result that did not run is unknown rather than regressed or passed. Opening a behavior shows its promise,
 * outcomes, recordings and figures (`ComparePair`).
 */
import { COMPARE_GROUP_TEXT, COMPARE_GROUPS, compareRuns, type CompareGroup, type ComparedResult } from '@crvouga/atlas/reports/run-compare';
import { formatMs, type RunDetail, type RunSummary } from '@crvouga/atlas/reports/test-catalog';
import { Alert, Anchor, Badge, Box, Button, Code, Drawer, Flex, Group, List, NativeSelect, Paper, SimpleGrid, Stack, Table, Text, Title, VisuallyHidden } from '@mantine/core';
import { IconArrowsExchange } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { ago, duration, exactTime, plural, shortSha, statusWord, useNow } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { useRunDetail, useRunList } from './catalog';
import { ComparePair } from './ComparePair';
import { patched, useExplorerNavigate, useExplorerSearch } from './navigate';
import { runName } from './parts';

const ROWS = 100;

const GROUP_COLOR: Record<CompareGroup, string> = {
  regressed: 'red',
  recovered: 'green',
  'still-failing': 'red',
  'not-comparable': 'orange',
  unknown: 'gray',
  removed: 'gray',
  added: 'blue',
  unchanged: 'gray'
};

/** What a run is called: the title its producer gave it, else its CI run number or `branch@sha`. */
function nameOf(run: RunSummary): string {
  return run.title ?? runName(run.key);
}

function RunPicker({ label, value, runs, onChange }: { label: string; value: string | undefined; runs: readonly RunSummary[]; onChange: (key: string | undefined) => void }) {
  const now = useNow();
  const known = runs.some((run) => run.key === value);
  return (
    <NativeSelect
      label={label}
      value={value ?? ''}
      onChange={(event) => onChange(event.currentTarget.value || undefined)}
      data-compare-picker={label}
    >
      <option value="">Choose a run</option>
      {value && !known && <option value={value}>{runName(value)} (not among the newest runs listed)</option>}
      {runs.map((run) => (
        <option key={run.key} value={run.key}>
          {[nameOf(run), run.branch, shortSha(run.sha), ago(run.endedAtMs, now)].filter(Boolean).join(' · ')}
        </option>
      ))}
    </NativeSelect>
  );
}

function RunCard({ role, run }: { role: string; run: RunSummary }) {
  return (
    <Paper withBorder p="md" component="section" aria-label={`${role} run`} data-compare-run={role.toLowerCase()}>
      <Stack gap="xs">
        <Title order={3}>
          {role}: {nameOf(run)}
        </Title>
        <Text component="div" size="sm">
          {[run.branch, run.sha ? shortSha(run.sha) : null].filter(Boolean).join(' @ ') || 'No branch or commit recorded'}
          {run.freshness && (
            <Text span inherit c="dimmed">
              {' '}
              {run.freshness === 'modified' ? 'with local changes' : 'origin not captured'}
            </Text>
          )}
        </Text>
        <Text component="div" size="sm" c="dimmed" title={exactTime(run.endedAtMs)}>
          Ended {exactTime(run.endedAtMs)} · took {formatMs(run.spanMs)} · {plural(run.layers, 'layer', 'layers')}
        </Text>
        <Text component="div" size="sm">
          {plural(run.tests, 'test', 'tests')}: {run.counts.passed} passed, {run.counts.failed} failed, {run.counts['not-run']} not run
          {run.counts.running > 0 ? `, ${run.counts.running} running` : ''}
        </Text>
        <Anchor renderRoot={(props) => <Link {...props} to="/" search={patched({ tab: 'runs', openRun: run.key, pair: undefined })} resetScroll={false} activeOptions={{ exact: true }} />}>
          Open this run
        </Anchor>
      </Stack>
    </Paper>
  );
}

function Outcome({ result }: { result: ComparedResult['baseline'] }) {
  if (!result)
    return (
      <Text span inherit c="dimmed" data-outcome="none">
        No result
      </Text>
    );
  return (
    <Group gap="xs" wrap="nowrap" data-outcome={result.status}>
      <StatusMark status={result.status} size={14} />
      <Text span inherit>
        {statusWord(result.status)}
      </Text>
      <Text span inherit c="dimmed" size="xs">
        {duration(result.durationMs)}
      </Text>
    </Group>
  );
}

function Row({ item }: { item: ComparedResult }) {
  return (
    <Table.Tr data-group={item.group}>
      <Table.Td>
        <Text component="div">{item.title}</Text>
        {item.specPath && (
          <Text component="div" size="xs" c="dimmed">
            <Code>{item.specPath}</Code>
          </Text>
        )}
        {item.conditions.length > 0 && (
          <Badge variant="light" color="orange" tt="none" mt="xs" title={item.conditions.join('; ')}>
            Conditions differ
          </Badge>
        )}
        {item.promise.state === 'changed' && (
          <Badge variant="light" color="orange" tt="none" mt="xs">
            Promise changed
          </Badge>
        )}
      </Table.Td>
      <Table.Td>
        <Outcome result={item.baseline} />
      </Table.Td>
      <Table.Td>
        <Outcome result={item.candidate} />
      </Table.Td>
      <Table.Td>
        <Badge color={GROUP_COLOR[item.group]} variant="light" tt="none">
          {COMPARE_GROUP_TEXT[item.group].label}
        </Badge>
        <Text component="div" size="xs" c="dimmed" mt="xs">
          {item.summary}
        </Text>
      </Table.Td>
      <Table.Td>
        <Button
          variant="light"
          aria-label={`Compare ${item.title}`}
          renderRoot={(props) => <Link {...props} to="/" search={patched({ pair: item.id })} resetScroll={false} activeOptions={{ exact: true }} />}
        >
          Compare
        </Button>
      </Table.Td>
    </Table.Tr>
  );
}

function Missing({ side, keyed, onRetry }: { side: string; keyed: string; onRetry?: () => void }) {
  return (
    <Alert color="blue" role="status" title={`The ${side} run is not in the report`} data-compare-missing={side}>
      <Stack gap="xs" align="flex-start">
        <Text component="div">
          <Code>{keyed}</Code> is pinned in the address, but the report holds no run with that key any more. Its source may be switched off or have expired. It is not replaced by another run.
        </Text>
        {onRetry && (
          <Button type="button" variant="light" onClick={onRetry}>
            Try again
          </Button>
        )}
      </Stack>
    </Alert>
  );
}

function Comparison({ baseline, candidate }: { baseline: RunDetail; candidate: RunDetail }) {
  const search = useExplorerSearch();
  const go = useExplorerNavigate();
  const comparison = useMemo(() => compareRuns(baseline, candidate), [baseline, candidate]);
  const [shown, setShown] = useState(ROWS);
  const group = COMPARE_GROUPS.find((name) => name === search.change);
  const listed = group ? comparison.results.filter((item) => item.group === group) : comparison.results;
  const opened = search.pair ? comparison.results.find((item) => item.id === search.pair) : undefined;
  const total = comparison.results.length;
  return (
    <Stack gap="md">
      {comparison.notes.length > 0 && (
        <Alert color="blue" role="status" title="Before reading this comparison">
          <List size="sm">
            {comparison.notes.map((note) => (
              <List.Item key={note}>{note}</List.Item>
            ))}
          </List>
        </Alert>
      )}
      <Text role="status" component="div" data-compare-summary>
        {plural(total, 'behavior', 'behaviors')} across the two runs:{' '}
        {COMPARE_GROUPS.filter((name) => comparison.counts[name] > 0)
          .map((name) => `${comparison.counts[name]} ${COMPARE_GROUP_TEXT[name].label.toLowerCase()}`)
          .join(', ') || 'none'}
        .
      </Text>
      <Flex role="group" aria-label="Kind of change" gap="xs" align="center" wrap="wrap">
        <Button type="button" variant="light" aria-pressed={!group} onClick={() => go({ change: undefined })}>
          All {total}
        </Button>
        {COMPARE_GROUPS.filter((name) => comparison.counts[name] > 0).map((name) => (
          <Button key={name} type="button" variant="light" aria-pressed={group === name} title={COMPARE_GROUP_TEXT[name].meaning} onClick={() => go({ change: group === name ? undefined : name })}>
            {COMPARE_GROUP_TEXT[name].label} {comparison.counts[name]}
          </Button>
        ))}
      </Flex>
      {group && (
        <Text component="div" size="sm" c="dimmed">
          {COMPARE_GROUP_TEXT[group].meaning}
        </Text>
      )}
      {total === 0 ? (
        <Text component="div" c="dimmed">
          Neither run recorded a result, so there is nothing to compare.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={720}>
          <Table data-compare-results>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">Behavior</Table.Th>
                <Table.Th scope="col">Baseline</Table.Th>
                <Table.Th scope="col">Candidate</Table.Th>
                <Table.Th scope="col">Change</Table.Th>
                <Table.Th scope="col">
                  <VisuallyHidden>Open</VisuallyHidden>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {listed.slice(0, shown).map((item) => (
                <Row key={item.id} item={item} />
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {listed.length > shown && (
        <Button type="button" variant="subtle" onClick={() => setShown(shown + ROWS)}>
          Show more ({listed.length - shown} more)
        </Button>
      )}
      <Drawer opened={!!search.pair} onClose={() => go({ pair: undefined })} title="Compare a behavior" size="xl">
        {opened ? (
          <ComparePair item={opened} comparison={comparison} layers={{ baseline: baseline.layers, candidate: candidate.layers }} onClose={() => go({ pair: undefined })} />
        ) : (
          <Alert color="blue" role="status">
            That behavior is not in the two compared runs.
          </Alert>
        )}
      </Drawer>
    </Stack>
  );
}

/** The Compare tab. */
export function CompareView() {
  const search = useExplorerSearch();
  const go = useExplorerNavigate();
  const runs = useRunList(true, {});
  const baseline = useRunDetail(search.base);
  const candidate = useRunDetail(search.cand);
  const picked = search.base && search.cand;
  return (
    <Box aria-label="Compare runs" component="section" mb="lg">
      <Title order={2} mb="sm">
        Compare two runs
      </Title>
      <Text component="div" c="dimmed" mb="md">
        Choose a baseline and a candidate run. Behaviors are paired by the check they record, not by title. Both runs are pinned in the address, so a newer run never replaces either, and a link reproduces the comparison.
      </Text>
      <Group align="flex-end" gap="md" wrap="wrap" mb="md">
        <RunPicker label="Baseline run" value={search.base} runs={runs.data?.runs ?? []} onChange={(key) => go({ base: key, pair: undefined, change: undefined })} />
        <RunPicker label="Candidate run" value={search.cand} runs={runs.data?.runs ?? []} onChange={(key) => go({ cand: key, pair: undefined, change: undefined })} />
        <Button
          type="button"
          variant="default"
          leftSection={<IconArrowsExchange size={16} aria-hidden="true" />}
          disabled={!search.base && !search.cand}
          onClick={() => go({ base: search.cand, cand: search.base, pair: undefined, change: undefined })}
        >
          Swap baseline and candidate
        </Button>
      </Group>
      {runs.isError && (
        <Alert role="alert" color="red" my="sm">
          The runs could not be listed. {runs.error.message}
        </Alert>
      )}
      {!picked && (
        <Text component="div" c="dimmed" role="status">
          {runs.isPending ? 'Reading the runs…' : (runs.data?.runs.length ?? 0) < 1 ? 'No runs recorded yet, so there is nothing to compare.' : 'Choose both runs to compare them. You can also open a run in the Runs tab and use it as the baseline or the candidate.'}
        </Text>
      )}
      {picked && (baseline.isPending || candidate.isPending) && (
        <Text role="status" component="div" c="dimmed">
          Reading the two runs…
        </Text>
      )}
      {picked && (baseline.isError || candidate.isError) && (
        <Alert role="alert" color="red" my="sm">
          A run could not be read. {baseline.error?.message ?? candidate.error?.message}
          <Group mt="xs">
            <Button
              type="button"
              variant="light"
              onClick={() => {
                void baseline.refetch();
                void candidate.refetch();
              }}
            >
              Try again
            </Button>
          </Group>
        </Alert>
      )}
      {picked && baseline.isSuccess && baseline.data === null && <Missing side="baseline" keyed={search.base!} />}
      {picked && candidate.isSuccess && candidate.data === null && <Missing side="candidate" keyed={search.cand!} />}
      {picked && baseline.data && candidate.data && (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <RunCard role="Baseline" run={baseline.data.run} />
            <RunCard role="Candidate" run={candidate.data.run} />
          </SimpleGrid>
          <Comparison baseline={baseline.data} candidate={candidate.data} />
        </Stack>
      )}
    </Box>
  );
}
