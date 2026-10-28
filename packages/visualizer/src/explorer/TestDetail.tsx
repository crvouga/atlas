import { IconX, IconCircleFilled } from '@tabler/icons-react';
import { Alert, Anchor, Badge, Box, Button, Code, Flex, SimpleGrid, Stack, Table, Text, Title, VisuallyHidden } from '@mantine/core';
/**
 * @module Test detail
 *
 * One test, opened beside the list: what it is (spec, domain, id), its current result in every environment, how it has
 * gone (pass rate, flips, durations, a duration trend and a strip of past outcomes), every recorded result, its tags and
 * labels, and what its current result carries (steps, screenshots, video, traces, the recording) through the same
 * evidence views as a spec page.
 */
import type { CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { formatMs, runKey, type TestResultEntry, type TestSummary } from '@crvouga/atlas/reports/test-catalog';
import { Link } from '@tanstack/react-router';
import { lazy, Suspense, useState } from 'react';
import { CheckDetail } from '../evidence/check-detail';
import { ago, exactTime, plural, shortSha, statusWord, useNow } from '../evidence/format';
import { useEvidence } from '../evidence/evidence-context';
import { Origin, StatusMark } from '../evidence/marks';
import { useTestHistory } from './catalog';
import { patched, useExplorerNavigate, useExplorerSearch } from './navigate';
import { Badges, runName } from './parts';
import { usePinnedResult, type PinnedResult } from './pinned';
const RecordingPage = lazy(() => import('../evidence/recording-page').then((module) => ({ default: module.RecordingPage })));
/** Results the history table shows before "Show more". */
const HISTORY_ROWS = 20;
function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
/** Switches the detail from one pinned result back to the latest combined evidence. */
function LatestLink({ children }: { children: string }) {
  return (
    <Anchor
      renderRoot={(props) => (
        <Link {...props} to="/" search={patched({ layer: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
      )}
    >
      {children}
    </Anchor>
  );
}

/**
 * Says which evidence the detail shows: this one run's result (pinned by the address), or the latest combined evidence.
 * The change from one to the other is always an explicit link, so a result never turns into another silently.
 */
function Scope({ pinned, slot }: { pinned: PinnedResult; slot: CheckSlot | undefined }) {
  const { backends } = useEvidence();
  const now = useNow();
  if (pinned.state === 'none')
    return (
      <Flex aria-label="Evidence scope" role="group" gap="xs" align="center" wrap="wrap" mb="lg">
        <Badge variant="light">Latest combined evidence</Badge>
        <Text span inherit c="dimmed">
          The newest result of each environment, which can come from different runs. Open a run to see exactly what it recorded.
        </Text>
      </Flex>
    );
  if (pinned.state === 'loading')
    return (
      <Text role="status" component="div" c="dimmed" mb="lg">
        Reading the result of the run you opened…
      </Text>
    );
  if (pinned.state === 'missing')
    return (
      <Alert color="blue" title="That result is not available" mb="lg">
        <Stack gap="xs">
          <Text span inherit>
            {pinned.reason} No other result is shown in its place.
          </Text>
          <LatestLink>Show latest combined evidence</LatestLink>
        </Stack>
      </Alert>
    );
  const { layer } = pinned.entry;
  const newer = slot?.outcomes.find(
    (outcome) =>
      outcome.layer.id !== layer.id &&
      outcome.layer.recordedAtMs > layer.recordedAtMs &&
      outcome.layer.producer === layer.producer &&
      outcome.layer.environment === layer.environment &&
      JSON.stringify(outcome.parameters) === JSON.stringify(pinned.entry.row.variant)
  );
  const key = runKey(layer);
  return (
    <Alert color="blue" title={`This run: ${runName(key)}`} mb="lg">
      <Stack gap="xs">
        <Flex gap="xs" align="center" wrap="wrap">
          <Text span inherit fw={600}>
            {layer.producer}
          </Text>
          <Origin layer={layer} backends={backends} now={now} />
        </Flex>
        <Text span inherit>
          The evidence below is what this run recorded. The current results, statistics and history are about the latest combined evidence
          across runs.
        </Text>
        {newer && (
          <Text span inherit role="status">
            A newer result exists: {statusWord(newer.row.status)} {ago(newer.layer.recordedAtMs, now)}.
          </Text>
        )}
        <Flex gap="md" align="center" wrap="wrap">
          <LatestLink>Show latest combined evidence</LatestLink>
          <Anchor
            renderRoot={(props) => (
              <Link
                {...props}
                to="/"
                search={patched({ tab: 'runs', openRun: key, test: undefined, layer: undefined })}
                resetScroll={false}
                activeOptions={{ exact: true }}
              />
            )}
          >
            Back to run {runName(key)}
          </Anchor>
        </Flex>
      </Stack>
    </Alert>
  );
}

/** The open test. `slot` is the report's check for it, when the page holds one, for its evidence. */
export function TestDetail({ test, slot }: { test: TestSummary; slot: CheckSlot | undefined }) {
  const now = useNow();
  const history = useTestHistory(test.key);
  const { layer } = useExplorerSearch();
  const go = useExplorerNavigate();
  const pinned = usePinnedResult(layer, test.key);
  const [recording, setRecording] = useState(false);
  const [recordingLayer, setRecordingLayer] = useState<string | undefined>(undefined);
  const [moment, setMoment] = useState<number | null>(null);
  const [rows, setRows] = useState(HISTORY_ROWS);
  const entries = history.data?.history ?? [];
  const stats = test.stats;
  const d = stats.durations;
  if (recording && slot) {
    return (
      <Suspense
        fallback={
          <Text role="status" c="dimmed">
            Loading the recording…
          </Text>
        }
      >
        <RecordingPage
          slot={slot}
          layerId={recordingLayer ?? layer}
          entry={pinned.state === 'ready' && (recordingLayer ?? layer) === pinned.entry.layer.id ? pinned.entry : undefined}
          label={test.title}
          back="Test detail"
          moment={moment}
          onMoment={setMoment}
          onClose={() => setRecording(false)}
        />
      </Suspense>
    );
  }
  return (
    <Box aria-label={test.title} component="article">
      <Flex gap="xs" align="center" wrap="wrap" justify="flex-end">
        <Anchor
          aria-label="Close the test"
          renderRoot={(props) => (
            <Link {...props} to="/" search={patched({ test: undefined, layer: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
          )}
        >
          <IconX size={20} aria-hidden="true" />
        </Anchor>
      </Flex>
      <Box component="header" mb="lg">
        {test.spec && (
          <Text component="div" c="dimmed">
            {test.spec!.domain && (
              <Anchor
                renderRoot={(props) => (
                  <Link
                    {...props}
                    to="/"
                    search={patched({ domain: test.spec!.domain, spec: undefined })}
                    resetScroll={false}
                    activeOptions={{ exact: true }}
                  />
                )}
              >
                {test.spec!.domain}
              </Anchor>
            )}
            <Anchor
              renderRoot={(props) => (
                <Link
                  {...props}
                  to="/"
                  search={patched({ spec: test.spec!.path, domain: undefined })}
                  resetScroll={false}
                  activeOptions={{ exact: true }}
                />
              )}
            >
              {test.spec!.title}
            </Anchor>
          </Text>
        )}
        <Title order={2} mb="sm">
          {test.title}
        </Title>
        <Flex gap="xs" align="center" wrap="wrap">
          <StatusMark status={test.status} />
          <Text data-status={test.status} span inherit fw={600}>
            {statusWord(test.status)}
          </Text>
          {stats.flaky && (
            <Text title={stats.flakyReason} span inherit>
              Flaky: {stats.flakyReason}
            </Text>
          )}
          <Badges test={test} />
        </Flex>
        {test.spec && <Code c="dimmed">{test.spec!.path}</Code>}
        <Code title="Check id" c="dimmed">
          {test.id}
        </Code>
      </Box>

      <Scope pinned={pinned} slot={slot} />

      <Box aria-label="Current results" component="section" mb="lg">
        <Title order={3} mb="sm" c="dimmed">
          Current result per environment
        </Title>
        {test.outcomes.length === 0 ? (
          <Text component="div" c="dimmed">
            No completed result recorded yet.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={600}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th scope="col">Environment</Table.Th>
                  <Table.Th scope="col">Producer</Table.Th>
                  <Table.Th scope="col">Status</Table.Th>
                  <Table.Th scope="col">Duration</Table.Th>
                  <Table.Th scope="col">Branch</Table.Th>
                  <Table.Th scope="col">Commit</Table.Th>
                  <Table.Th scope="col">Recorded</Table.Th>
                  <Table.Th scope="col">
                    <VisuallyHidden>Run</VisuallyHidden>
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {test.outcomes.map((outcome) => (
                  <Table.Tr
                    key={`${outcome.layer}|${outcome.producer}|${outcome.environment}|${JSON.stringify(outcome.parameters)}`}
                    data-status={outcome.status}
                  >
                    <Table.Td>
                      {environmentLabel(outcome.environment)}
                      {Object.entries(outcome.parameters).map(([name, value]) => (
                        <Text key={name} span inherit c="dimmed">
                          {' '}
                          {name}: {value}
                        </Text>
                      ))}
                    </Table.Td>
                    <Table.Td>{outcome.producer}</Table.Td>
                    <Table.Td>
                      <Flex component="span" display="inline-flex" gap="xs" align="center" wrap="wrap">
                        <StatusMark status={outcome.status} size={12} />
                        {statusWord(outcome.status)}
                      </Flex>
                    </Table.Td>
                    <Table.Td>{formatMs(outcome.durationMs)}</Table.Td>
                    <Table.Td title={outcome.branch ?? ''} c="dimmed">
                      {outcome.branch ?? '—'}
                    </Table.Td>
                    <Table.Td>
                      <Code>{shortSha(outcome.sha) ?? '—'}</Code>
                    </Table.Td>
                    <Table.Td title={exactTime(outcome.at)}>{ago(outcome.at, now)}</Table.Td>
                    <Table.Td>
                      {outcome.runUrl ? (
                        <Anchor href={outcome.runUrl} target="_blank" rel="noreferrer">
                          CI run
                        </Anchor>
                      ) : null}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Box>

      <Box aria-label="Statistics" component="section" mb="lg">
        <Title order={3} mb="sm" c="dimmed">
          How it has gone
        </Title>
        <SimpleGrid component="dl" cols={{ base: 2, sm: 3 }}>
          <Stack gap="sm">
            <Box component="dt">Pass rate</Box>
            <Box component="dd" m={0}>
              {percent(stats.passRate)}
            </Box>
          </Stack>
          <Stack gap="sm">
            <Box component="dt">Results</Box>
            <Box component="dd" m={0}>
              {stats.results}{' '}
              <Text span inherit>
                ({stats.passed} passed{stats.failed ? `, ${stats.failed} failed` : ''})
              </Text>
            </Box>
          </Stack>
          <Stack gap="sm">
            <Box component="dt">Runs</Box>
            <Box component="dd" m={0}>
              {stats.runs}
            </Box>
          </Stack>
          <Stack gap="sm">
            <Box component="dt">Flips</Box>
            <Box component="dd" m={0}>
              {stats.flips}
            </Box>
          </Stack>
          <Stack gap="sm">
            <Box component="dt">Average</Box>
            <Box component="dd" m={0}>
              {formatMs(d?.avgMs)}
            </Box>
          </Stack>
          <Stack gap="sm">
            <Box component="dt">p50</Box>
            <Box component="dd" m={0}>
              {formatMs(d?.p50Ms)}
            </Box>
          </Stack>
          <Stack gap="sm">
            <Box component="dt">p95</Box>
            <Box component="dd" m={0}>
              {formatMs(d?.p95Ms)}
            </Box>
          </Stack>
          <Stack gap="sm">
            <Box component="dt">Min – max</Box>
            <Box component="dd" m={0}>
              {d ? `${formatMs(d.minMs)} – ${formatMs(d.maxMs)}` : '—'}
            </Box>
          </Stack>
          <Stack gap="sm">
            <Box component="dt">Last</Box>
            <Box component="dd" m={0}>
              {formatMs(d?.lastMs)}
            </Box>
          </Stack>
          <Stack gap="sm">
            <Box component="dt">Last passed</Box>
            <Box component="dd" m={0}>
              {stats.lastPassedAtMs ? ago(stats.lastPassedAtMs, now) : '—'}
            </Box>
          </Stack>
          <Stack gap="sm">
            <Box component="dt">Last failed</Box>
            <Box component="dd" m={0}>
              {stats.lastFailedAtMs ? ago(stats.lastFailedAtMs, now) : '—'}
            </Box>
          </Stack>
          <Stack gap="sm">
            <Box component="dt">First seen</Box>
            <Box component="dd" m={0}>
              {stats.firstSeenMs ? ago(stats.firstSeenMs, now) : '—'}
            </Box>
          </Stack>
        </SimpleGrid>
        {stats.branches.length > 0 && (
          <Text component="div" c="dimmed">
            Branches: {stats.branches.join(', ')}
          </Text>
        )}
        {!d && (
          <Text component="div" c="dimmed">
            No duration recorded. Producers can send <Code>durationMs</Code> with each check.
          </Text>
        )}
        {entries.length > 1 && <Trend entries={entries} />}
      </Box>

      {(test.tags.length > 0 || Object.keys(test.labels).length > 0) && (
        <Box aria-label="Tags and labels" component="section" mb="lg">
          <Title order={3} mb="sm" c="dimmed">
            Tags and labels
          </Title>
          <Flex gap="xs" align="center" wrap="wrap">
            {test.tags.map((tag) => (
              <Anchor
                key={tag}
                renderRoot={(props) => (
                  <Link {...props} to="/" search={patched({ tag })} resetScroll={false} activeOptions={{ exact: true }} />
                )}
              >
                {tag}
              </Anchor>
            ))}
            {Object.entries(test.labels).map(([name, value]) => (
              <Text key={name} span inherit>
                {name}: {value}
              </Text>
            ))}
          </Flex>
        </Box>
      )}

      <Box aria-label="Evidence" component="section" mb="lg">
        <Title order={3} mb="sm" c="dimmed">
          {layer ? 'What this run recorded' : 'What the current result carries'}
        </Title>
        {slot && (!layer || pinned.state === 'ready') ? (
          <CheckDetail
            slot={slot}
            layerId={layer}
            {...(pinned.state === 'ready' ? { pinned: pinned.entry, pin: true } : {})}
            reads="steps"
            select={(patch) => {
              if (patch.view === 'recording') {
                setRecordingLayer(patch.layer ?? undefined);
                setRecording(true);
                setMoment(null);
              } else go({ layer: patch.layer ?? undefined });
            }}
          />
        ) : layer ? (
          <Text component="div" c="dimmed">
            {pinned.state === 'missing' ? 'There is no evidence to show for that run.' : 'Reading the evidence of that run…'}
          </Text>
        ) : (
          <Text component="div" c="dimmed">
            The evidence of this result is not loaded in this page.
          </Text>
        )}
      </Box>

      <Box aria-label="History" component="section" mb="lg">
        <Title order={3} mb="sm" c="dimmed">
          History{entries.length ? ` · ${plural(entries.length, 'result', 'results')}` : ''}
        </Title>
        {history.isPending && (
          <Text role="status" component="div" c="dimmed">
            Reading the history…
          </Text>
        )}
        {history.isError && (
          <Alert role="alert" color={'red'} my="sm">
            The history could not be read. {history.error.message}
          </Alert>
        )}
        {entries.length > 0 && (
          <Table.ScrollContainer minWidth={600}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th scope="col">Recorded</Table.Th>
                  <Table.Th scope="col">Environment</Table.Th>
                  <Table.Th scope="col">Status</Table.Th>
                  <Table.Th scope="col">Duration</Table.Th>
                  <Table.Th scope="col">Branch</Table.Th>
                  <Table.Th scope="col">Commit</Table.Th>
                  <Table.Th scope="col">Detail</Table.Th>
                  <Table.Th scope="col">
                    <VisuallyHidden>Evidence</VisuallyHidden>
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {entries.slice(0, rows).map((entry) => (
                  <Table.Tr
                    key={`${entry.layer}|${entry.kind}|${entry.producer}|${entry.environment}|${JSON.stringify(entry.parameters)}`}
                    data-status={entry.status}
                  >
                    <Table.Td title={exactTime(entry.at)}>
                      {entry.runUrl ? (
                        <Anchor href={entry.runUrl} target="_blank" rel="noreferrer">
                          {ago(entry.at, now)}
                        </Anchor>
                      ) : (
                        ago(entry.at, now)
                      )}
                    </Table.Td>
                    <Table.Td>{environmentLabel(entry.environment)}</Table.Td>
                    <Table.Td>
                      <Flex component="span" display="inline-flex" gap="xs" align="center" wrap="wrap">
                        <StatusMark status={entry.status} size={12} />
                        {statusWord(entry.status)}
                      </Flex>
                    </Table.Td>
                    <Table.Td>{formatMs(entry.durationMs)}</Table.Td>
                    <Table.Td title={entry.branch ?? ''} c="dimmed">
                      {entry.branch ?? '—'}
                    </Table.Td>
                    <Table.Td>
                      <Code>{shortSha(entry.sha) ?? '—'}</Code>
                    </Table.Td>
                    <Table.Td title={entry.detail} c="dimmed">
                      {entry.detail.split('\n')[0]}
                    </Table.Td>
                    <Table.Td>
                      <Anchor
                        aria-label={`Open the ${statusWord(entry.status)} result recorded ${ago(entry.at, now)} in ${environmentLabel(entry.environment)}`}
                        aria-current={entry.layer === layer ? 'true' : undefined}
                        renderRoot={(props) => (
                          <Link
                            {...props}
                            to="/"
                            search={patched({ layer: entry.layer })}
                            resetScroll={false}
                            activeOptions={{ exact: true }}
                          />
                        )}
                      >
                        Open this result
                      </Anchor>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {entries.length > rows && (
          <Button type="button" onClick={() => setRows(rows + HISTORY_ROWS)} variant="subtle">
            Show more ({entries.length - rows} more)
          </Button>
        )}
      </Box>
    </Box>
  );
}
/** The duration of each completed result over time, and a strip of every outcome, oldest on the left. */
function Trend({ entries }: { entries: readonly TestResultEntry[] }) {
  const oldest = [...entries].reverse();
  const timed = oldest.filter((entry) => entry.durationMs !== null && (entry.status === 'passed' || entry.status === 'failed'));
  const width = 320,
    height = 56,
    pad = 4;
  const max = Math.max(1, ...timed.map((entry) => entry.durationMs!));
  const x = (index: number) => (timed.length === 1 ? width / 2 : pad + (index * (width - 2 * pad)) / (timed.length - 1));
  const y = (ms: number) => height - pad - (ms / max) * (height - 2 * pad);
  const points = timed.map((entry, index) => `${x(index).toFixed(1)},${y(entry.durationMs!).toFixed(1)}`).join(' ');
  return (
    <Stack gap="sm">
      {timed.length > 1 && (
        <Box component="figure" m={0}>
          <Box component="figcaption">
            Duration over the last {plural(timed.length, 'result', 'results')} · max {formatMs(max)}
          </Box>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`Durations from ${formatMs(timed[0]!.durationMs)} to ${formatMs(timed.at(-1)!.durationMs)}`}
            preserveAspectRatio="none"
          >
            <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="var(--mantine-color-gray-3)" />
            <polyline points={points} fill="none" stroke="var(--mantine-color-blue-7)" strokeWidth={2} />
            {timed.map((entry, index) => (
              <circle
                key={index}
                cx={x(index)}
                cy={y(entry.durationMs!)}
                r={entry.status === 'failed' ? 3 : index === timed.length - 1 ? 2.5 : 0}
                data-status={entry.status}
              >
                <title>{`${exactTime(entry.at)} · ${environmentLabel(entry.environment)} · ${statusWord(entry.status)} · ${formatMs(entry.durationMs)}`}</title>
              </circle>
            ))}
            {/* Wide invisible targets, so a point is easy to hover. */}
            {timed.map((entry, index) => (
              <rect
                key={`hit${index}`}
                x={x(index) - width / timed.length / 2}
                y={0}
                width={width / timed.length}
                height={height}
                fill="transparent"
              >
                <title>{`${exactTime(entry.at)} · ${environmentLabel(entry.environment)} · ${statusWord(entry.status)} · ${formatMs(entry.durationMs)}`}</title>
              </rect>
            ))}
          </svg>
        </Box>
      )}
      <Flex
        role="img"
        aria-label={`Outcomes, oldest first: ${oldest.map((entry) => statusWord(entry.status)).join(', ')}`}
        gap="xs"
        align="center"
        wrap="wrap"
      >
        {oldest.map((entry, index) => (
          <Text
            key={index}
            c={entry.status === 'passed' ? 'green' : entry.status === 'failed' ? 'red' : 'gray'}
            data-status={entry.status}
            title={`${exactTime(entry.at)} · ${environmentLabel(entry.environment)} · ${statusWord(entry.status)}${entry.durationMs !== null ? ` · ${formatMs(entry.durationMs)}` : ''}`}
            span
            inherit
          >
            <IconCircleFilled size={12} aria-hidden="true" />
          </Text>
        ))}
      </Flex>
    </Stack>
  );
}
