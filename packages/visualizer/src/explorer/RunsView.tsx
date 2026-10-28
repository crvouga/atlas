import { IconArrowLeft } from '@tabler/icons-react';
import { Alert, Anchor, Box, Button, Code, Flex, Group, List, Stack, Table, Text, TextInput, Title, VisuallyHidden } from '@mantine/core';
/**
 * @module Runs view
 *
 * The CI runs that produced the report, newest first: when, on which branch and commit, which environments, how many
 * tests and how they went, how long it took, and a link to the run. Opening one lists every test it ran, filterable,
 * with a way to show exactly those tests in the explorer.
 */
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { formatMs, type RunResult, type RunSummary } from '@crvouga/atlas/reports/test-catalog';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { ago, exactTime, plural, shortSha, statusWord, useNow } from '../evidence/format';
import { Meter, StatusMark } from '../evidence/marks';
import { useRunDetail, useRunList } from './catalog';
import { patched, useExplorerSearch } from './navigate';
import { runName } from './parts';
const RUN_ROWS = 50;
const RESULT_ROWS = 200;
/** The Runs tab: the run list, or the run opened in it. */
export function RunsView() {
  const search = useExplorerSearch();
  return search.openRun ? <RunDetailView runKey={search.openRun} /> : <RunTable />;
}
/** What a run is called: the title its producer gave it, else its CI run number or `branch@sha`. */
function runLabel(run: RunSummary): string {
  return run.title ?? runName(run.key);
}
/** Beside a commit: said whenever the run was not recorded from a clean checkout, whatever the run is titled. */
function Freshness({ run }: { run: RunSummary }) {
  if (!run.freshness) return null;
  return (
    <Text span inherit c="dimmed">
      {run.freshness === 'modified' ? 'with local changes' : 'origin not captured'}
    </Text>
  );
}
function Counts({ run }: { run: RunSummary }) {
  return (
    <Text span inherit>
      {run.counts.failed > 0 && (
        <Text span inherit fw={600}>
          {run.counts.failed} failed
        </Text>
      )}
      <Text span inherit>
        {run.counts.passed} passed
      </Text>
      {run.counts['not-run'] > 0 && (
        <Text span inherit>
          {run.counts['not-run']} not run
        </Text>
      )}
      {run.counts.running > 0 && (
        <Text data-status="running" span inherit>
          {run.counts.running} running
        </Text>
      )}
    </Text>
  );
}
function RunTable() {
  const runs = useRunList();
  const now = useNow();
  const [shown, setShown] = useState(RUN_ROWS);
  if (runs.isPending)
    return (
      <Text role="status" component="div" c="dimmed">
        Reading the runs…
      </Text>
    );
  if (runs.isError)
    return (
      <Alert role="alert" color={'red'} my="sm">
        The runs could not be read. {runs.error.message}
      </Alert>
    );
  const list = runs.data.runs;
  if (!list.length)
    return (
      <Text component="div" c="dimmed">
        No runs recorded yet.
      </Text>
    );
  return (
    <Box aria-label="Runs" component="section" mb="lg">
      <Flex gap="xs" align="center" wrap="wrap">
        {runs.data.total > list.length
          ? `The newest ${list.length} of ${plural(runs.data.total, 'run', 'runs')}`
          : plural(list.length, 'run', 'runs')}
      </Flex>
      <Table.ScrollContainer minWidth={600}>
        <Table data-runs>
          <Table.Thead>
            <Table.Tr>
              <Table.Th scope="col">Ended</Table.Th>
              <Table.Th scope="col">Branch</Table.Th>
              <Table.Th scope="col">Commit</Table.Th>
              <Table.Th scope="col">Environments</Table.Th>
              <Table.Th scope="col">Tests</Table.Th>
              <Table.Th scope="col">Outcomes</Table.Th>
              <Table.Th scope="col">Span</Table.Th>
              <Table.Th scope="col">
                <VisuallyHidden>CI run</VisuallyHidden>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.slice(0, shown).map((run) => (
              <Table.Tr key={run.key} data-status={run.counts.failed ? 'failed' : 'passed'}>
                <Table.Td title={exactTime(run.endedAtMs)}>
                  <Anchor
                    aria-label={`Open run ${runLabel(run)}`}
                    renderRoot={(props) => (
                      <Link {...props} to="/" search={patched({ openRun: run.key })} resetScroll={false} activeOptions={{ exact: true }} />
                    )}
                  >
                    {ago(run.endedAtMs, now)}
                  </Anchor>
                  {run.title && (
                    <Text c="dimmed" fz="xs">
                      {run.title}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td title={run.branch ?? ''} c="dimmed">
                  {run.branch ?? '—'}
                </Table.Td>
                <Table.Td>
                  <Code>{shortSha(run.sha) ?? '—'}</Code> <Freshness run={run} />
                </Table.Td>
                <Table.Td>{run.environments.map((env) => environmentLabel(env)).join(', ') || '—'}</Table.Td>
                <Table.Td>{run.tests}</Table.Td>
                <Table.Td>
                  <Text span inherit>
                    <Meter counts={run.counts} />
                  </Text>
                  <Counts run={run} />
                </Table.Td>
                <Table.Td>{formatMs(run.spanMs)}</Table.Td>
                <Table.Td>
                  {run.runUrl ? (
                    <Anchor href={run.runUrl} target="_blank" rel="noreferrer">
                      CI run
                    </Anchor>
                  ) : null}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {list.length > shown && (
        <Button type="button" onClick={() => setShown(shown + RUN_ROWS)} variant="subtle">
          Show more ({list.length - shown} more)
        </Button>
      )}
    </Box>
  );
}
const RESULT_FILTERS = [
  { id: '', label: 'All' },
  { id: 'failed', label: 'Failed' },
  { id: 'passed', label: 'Passed' },
  { id: 'not-run', label: 'Not run' }
] as const;
function RunDetailView({ runKey }: { runKey: string }) {
  const detail = useRunDetail(runKey);
  const now = useNow();
  const [status, setStatus] = useState('');
  const [words, setWords] = useState('');
  const [shown, setShown] = useState(RESULT_ROWS);
  const results = detail.data?.results ?? [];
  const filtered = useMemo(() => {
    const terms = words.toLowerCase().split(/\s+/).filter(Boolean);
    return results.filter(
      (result) =>
        (!status || result.status === status) &&
        terms.every((term) =>
          `${result.title}\n${result.specPath ?? ''}\n${result.environment ?? ''}\n${result.producer}`.toLowerCase().includes(term)
        )
    );
  }, [results, status, words]);
  const bySpec = useMemo(() => {
    const groups = new Map<string, RunResult[]>();
    for (const result of filtered.slice(0, shown)) {
      const key = result.specPath ?? '';
      const group = groups.get(key);
      if (group) group.push(result);
      else groups.set(key, [result]);
    }
    return [...groups];
  }, [filtered, shown]);
  const back = (
    <Anchor
      renderRoot={(props) => (
        <Link {...props} to="/" search={patched({ openRun: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
      )}
    >
      <Text aria-hidden="true" span inherit>
        <IconArrowLeft size={16} aria-hidden="true" />
      </Text>{' '}
      All runs
    </Anchor>
  );
  if (detail.isPending)
    return (
      <>
        {back}
        <Text role="status" component="div" c="dimmed">
          Reading the run…
        </Text>
      </>
    );
  if (detail.isError)
    return (
      <>
        {back}
        <Alert role="alert" color={'red'} my="sm">
          The run could not be read. {detail.error.message}
        </Alert>
      </>
    );
  if (!detail.data)
    return (
      <>
        {back}
        <Alert color={'blue'} my="sm">
          That run is not in the report any more.
        </Alert>
      </>
    );
  const { run } = detail.data;
  return (
    <Box aria-label={`Run ${runLabel(run)}`} component="section" mb="lg">
      {back}
      <Title order={2} mb="sm">
        Run {runLabel(run)}
      </Title>
      <Text component="div">
        {run.branch && (
          <Text span inherit>
            {run.branch}
          </Text>
        )}
        {run.sha && <Code>{shortSha(run.sha)}</Code>}
        <Freshness run={run} />
        <Text title={exactTime(run.endedAtMs)} span inherit>
          ended {ago(run.endedAtMs, now)}
        </Text>
        <Text span inherit>
          took {formatMs(run.spanMs)}
        </Text>
        {run.environments.length > 0 && (
          <Text span inherit>
            {run.environments.map((env) => environmentLabel(env)).join(', ')}
          </Text>
        )}
        <Text span inherit>
          {run.producers.join(', ')}
        </Text>
        {run.totalDurationMs !== null && (
          <Text span inherit>
            {formatMs(run.totalDurationMs)} of test time
          </Text>
        )}
      </Text>
      <Stack gap="sm">
        <Text span inherit>
          <Meter counts={run.counts} />
        </Text>
        <Text span inherit>
          {plural(run.tests, 'test', 'tests')}
        </Text>
        <Counts run={run} />
      </Stack>
      <Flex gap="xs" align="center" wrap="wrap">
        <Anchor
          renderRoot={(props) => (
            <Link
              {...props}
              to="/"
              search={patched({ tab: undefined, openRun: undefined, inRun: run.key, test: undefined, layer: undefined })}
              resetScroll={false}
              activeOptions={{ exact: true }}
            />
          )}
        >
          Show these tests in the explorer
        </Anchor>
        {run.runUrl && (
          <Anchor href={run.runUrl} target="_blank" rel="noreferrer">
            Open the CI run
          </Anchor>
        )}
      </Flex>
      <Flex gap="xs" align="center" wrap="wrap">
        <TextInput
          type="search"
          aria-label="Search this run"
          placeholder="Search this run…"
          value={words}
          onChange={(event) => setWords(event.target.value)}
        />
      </Flex>
      <Flex role="group" aria-label="Result status" gap="xs" align="center" wrap="wrap">
        {RESULT_FILTERS.map((filter) => (
          <Button
            key={filter.id || 'all'}
            type="button"
            aria-pressed={status === filter.id}
            data-status={filter.id || undefined}
            onClick={() => setStatus(filter.id)}
            variant="light"
          >
            {filter.label}{' '}
            <Text span inherit>
              {filter.id ? results.filter((result) => result.status === filter.id).length : results.length}
            </Text>
          </Button>
        ))}
      </Flex>
      {!filtered.length && (
        <Text component="div" c="dimmed">
          No result matches.
        </Text>
      )}
      {bySpec.map(([spec, list]) => (
        <Box key={spec} data-open aria-label={spec || 'No spec'} component="section" mb="lg">
          <Button data-static variant="default" fullWidth h="auto" py="sm" justify="flex-start">
            <Flex component="span" direction="column" gap="xs" miw={0}>
              <Code>{spec || 'No spec'}</Code>
            </Flex>
            <Flex component="span" display="inline-flex" gap="xs" align="center" wrap="wrap">
              {plural(list.length, 'result', 'results')}
            </Flex>
          </Button>
          <List spacing="xs" listStyleType="none">
            {list.map((result) => (
              <List.Item key={`${result.key}|${result.environment}|${result.producer}|${result.layer}`} data-status={result.status}>
                <Anchor
                  display="flex"
                  p="sm"
                  underline="never"
                  renderRoot={(props) => (
                    <Link
                      {...props}
                      to="/"
                      search={patched({ tab: undefined, openRun: undefined, test: result.key, layer: result.layer })}
                      resetScroll={false}
                      activeOptions={{ exact: true }}
                    />
                  )}
                >
                  <StatusMark status={result.status} size={14} />
                  <Flex component="span" direction="column" gap="xs" miw={0}>
                    <Flex component="span" direction="column" gap="xs" miw={0}>
                      {result.title}
                    </Flex>
                    <Flex component="span" display="inline-flex" gap="xs" align="center" wrap="wrap" c="dimmed">
                      <Text span inherit>
                        {environmentLabel(result.environment)}
                      </Text>
                      <Text span inherit>
                        {result.producer}
                      </Text>
                      <Text span inherit>
                        {statusWord(result.status)}
                      </Text>
                    </Flex>
                    {result.status === 'failed' && result.detail && (
                      <Text span inherit c="red.7" size="xs" lineClamp={2}>
                        {result.detail.split('\n')[0]}
                      </Text>
                    )}
                  </Flex>
                  <Group data-one gap="md" ml="auto" visibleFrom="sm">
                    <Text span inherit>
                      {formatMs(result.durationMs)}
                    </Text>
                  </Group>
                </Anchor>
              </List.Item>
            ))}
          </List>
        </Box>
      ))}
      {filtered.length > shown && (
        <Button type="button" onClick={() => setShown(shown + RESULT_ROWS)} variant="subtle">
          Show more ({filtered.length - shown} more)
        </Button>
      )}
    </Box>
  );
}
