import { IconX, IconCircleFilled } from '@tabler/icons-react';
import { Alert, Anchor, Badge, Box, Button, Code, Divider, Flex, Group, Paper, SimpleGrid, Stack, Table, Tabs, Text, Title, VisuallyHidden } from '@mantine/core';
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
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { statusColor } from '../ui/theme';
import { assessTest } from '../evidence/applicability';
import { ApplicabilitySummary } from '../evidence/applicability-view';
import { CheckDetail } from '../evidence/check-detail';
import { ago, exactTime, plural, shortSha, statusWord, useNow } from '../evidence/format';
import { useEvidence } from '../evidence/evidence-context';
import { Origin, StatusMark } from '../evidence/marks';
import { outcomeHeadline, selectedResult } from '../evidence/outcome';
import { useTestHistory } from './catalog';
import { releaseOf } from './applicability';
import { patched, useExplorerNavigate, useExplorerSearch } from './navigate';
import { Badges, Fact, ReadPromise, runName } from './parts';
import { Reliability } from './Reliability';
import { ProductLatency } from './ProductLatency';
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
        <Link {...props} to="/" search={patched({ layer: undefined, clip: undefined, clipAt: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
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
      <Flex aria-label="Evidence scope" role="group" gap="xs" align="center" wrap="wrap">
        <Badge variant="default">Latest combined evidence</Badge>
        <Text span size="xs" c="dimmed" flex={1} miw={240}>
          The newest result of each environment, which can come from different runs. Open a run to see exactly what it recorded.
        </Text>
      </Flex>
    );
  if (pinned.state === 'loading')
    return (
      <Text role="status" component="div" c="dimmed">
        Reading the result of the run you opened…
      </Text>
    );
  if (pinned.state === 'missing')
    return (
      <Alert color="blue" title="That result is not available">
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
    <Alert color="blue" title={`This run: ${runName(key)}`}>
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
  const search = useExplorerSearch();
  const { layer, source } = search;
  const release = releaseOf(search);
  const applicability = assessTest(test, release);
  const go = useExplorerNavigate();
  const pinned = usePinnedResult(layer, test.key);
  const [recording, setRecording] = useState(false);
  const [recordingLayer, setRecordingLayer] = useState<string | undefined>(undefined);
  const [moment, setMoment] = useState<number | null>(null);
  const [rows, setRows] = useState(HISTORY_ROWS);
  // A link to a reliability scope opens on the figures it describes.
  const scoped = !!(search.relOpen || search.relEnv || search.relProducer || search.relBranch || search.relParam || search.relSince || search.relUntil || search.relRevision);
  const [tab, setTab] = useState(scoped ? 'reliability' : 'results');
  // Opening another result (from the history or the executions) shows what it recorded.
  const shownLayer = useRef(layer);
  const top = useRef<HTMLDivElement>(null);
  const about = useRef<HTMLDivElement>(null);
  // A link to a reliability scope arrives at its figures, which sit under the recording.
  useEffect(() => {
    if (scoped) about.current?.scrollIntoView?.({ block: 'start' });
  }, []);
  useEffect(() => {
    // Its evidence is at the top of the panel, above these tabs.
    if (shownLayer.current !== layer) top.current?.scrollIntoView?.({ block: 'start' });
    shownLayer.current = layer;
  }, [layer]);
  const entries = history.data?.history ?? [];
  const selected = slot && (!layer || pinned.state === 'ready') ? selectedResult(slot, pinned.state === 'ready' ? pinned.entry : undefined, source) : undefined;
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
  const facts: [string, ReactNode][] = [
    ['Pass rate', percent(stats.passRate)],
    [
      'Results',
      <>
        {stats.results}{' '}
        <Text span inherit fw={400} c="dimmed">
          ({stats.passed} passed{stats.failed ? `, ${stats.failed} failed` : ''})
        </Text>
      </>
    ],
    ['Runs', stats.runs],
    ['Flips', stats.flips],
    ['Average', formatMs(d?.avgMs)],
    ['p50', formatMs(d?.p50Ms)],
    ['p95', formatMs(d?.p95Ms)],
    ['Min – max', d ? `${formatMs(d.minMs)} – ${formatMs(d.maxMs)}` : '—'],
    ['Last', formatMs(d?.lastMs)],
    ['Last passed', stats.lastPassedAtMs ? ago(stats.lastPassedAtMs, now) : '—'],
    ['Last failed', stats.lastFailedAtMs ? ago(stats.lastFailedAtMs, now) : '—'],
    ['First seen', stats.firstSeenMs ? ago(stats.firstSeenMs, now) : '—']
  ];
  return (
    <Stack aria-label={test.title} component="article" gap="lg" ref={top}>
      <Stack component="header" gap="xs">
        {test.spec && (
          <Group gap={6} c="dimmed" fz="xs">
            {test.spec!.domain && (
              <>
                <Anchor
                  size="xs"
                  c="dimmed"
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
                <Text span inherit aria-hidden="true">
                  /
                </Text>
              </>
            )}
            <Anchor
              size="xs"
              c="dimmed"
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
          </Group>
        )}
        <Title order={2}>{test.title}</Title>
        <Flex gap="xs" align="center" wrap="wrap">
          <Badge color={statusColor(test.status)} data-status={test.status} leftSection={<StatusMark status={test.status} size={12} />}>
            {statusWord(test.status)}
          </Badge>
          <Text span size="xs" c="dimmed">
            worst current result of {plural(test.outcomes.length, 'source', 'sources')}
          </Text>
          {stats.flaky && (
            <Text title={stats.flakyReason} span size="xs" c="orange">
              Flaky: {stats.flakyReason}
            </Text>
          )}
        </Flex>
        {selected && slot && (
          <Text component="p" m={0} role="status" size="xs" c="dimmed" data-outcome-headline>
            {outcomeHeadline(selected, slot).text}
          </Text>
        )}
      </Stack>

      <Stack aria-label="Evidence" component="section" gap="sm">
        <VisuallyHidden>
          <Title order={3}>{layer ? 'What this run recorded' : 'What the current result carries'}</Title>
        </VisuallyHidden>
        {slot && (!layer || pinned.state === 'ready') ? (
      <CheckDetail
        slot={slot}
        layerId={layer}
        {...(pinned.state === 'ready' ? { pinned: pinned.entry, pin: true } : {})}
        reads="steps"
        headline={false}
        mediaFirst
        records={entries.map((entry) => ({
          layer: entry.layer,
          kind: entry.kind,
          status: entry.status,
          at: entry.at,
          sha: entry.sha,
          producer: entry.producer,
          environment: entry.environment,
          parameters: entry.parameters
        }))}
        {...(layer ? {} : { source, onSource: (next: string | null) => go({ source: next ?? undefined }) })}
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
      </Stack>

      <Divider />
      <Tabs ref={about} value={tab} onChange={(value) => setTab(value ?? 'results')} keepMounted>
        <Tabs.List aria-label="About this test">
          <Tabs.Tab value="results">Results</Tabs.Tab>
          <Tabs.Tab value="statistics">Statistics</Tabs.Tab>
          <Tabs.Tab value="reliability">Reliability</Tabs.Tab>
          <Tabs.Tab value="latency">Product latency</Tabs.Tab>
          <Tabs.Tab
            value="history"
            rightSection={
              entries.length ? (
                <Text span size="xs" c="dimmed">
                  {entries.length}
                </Text>
              ) : undefined
            }
          >
            History
          </Tabs.Tab>
        </Tabs.List>


        <Tabs.Panel value="results" pt="md">
          <Stack gap="lg">
            <Stack aria-label="Current results" component="section" gap="xs">
              <Title order={3}>Current result per environment</Title>
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
                          <Table.Td fw={500}>
                            {environmentLabel(outcome.environment)}
                            {Object.entries(outcome.parameters).map(([name, value]) => (
                              <Text key={name} span inherit fw={400} c="dimmed">
                                {' '}
                                {name}: {value}
                              </Text>
                            ))}
                          </Table.Td>
                          <Table.Td>{outcome.producer}</Table.Td>
                          <Table.Td>
                            <Flex component="span" display="inline-flex" gap={6} align="center" wrap="nowrap">
                              <StatusMark status={outcome.status} size={14} />
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
                          <Table.Td title={exactTime(outcome.at)} c="dimmed">
                            {ago(outcome.at, now)}
                          </Table.Td>
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
            </Stack>

            <Stack aria-label="Evidence applicability" component="section" gap="xs">
              <Title order={3}>Does this evidence apply?</Title>
              <ApplicabilitySummary assessment={applicability} release={release} />
            </Stack>

            {(test.tags.length > 0 || Object.keys(test.labels).length > 0) && (
              <Stack aria-label="Tags and labels" component="section" gap="xs">
                <Title order={3}>Tags and labels</Title>
                <Flex gap={6} align="center" wrap="wrap">
                  {test.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="default"
                      renderRoot={(props) => <Link {...props} to="/" search={patched({ tag })} resetScroll={false} activeOptions={{ exact: true }} />}
                    >
                      {tag}
                    </Badge>
                  ))}
                  {Object.entries(test.labels).map(([name, value]) => (
                    <Badge key={name} color="gray">
                      {name}: {value}
                    </Badge>
                  ))}
                </Flex>
              </Stack>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="statistics" pt="md">
          <Stack aria-label="Statistics" component="section" gap="sm">
            <Stack gap={2}>
              <Title order={3}>How it has gone</Title>
              <Text component="div" c="dimmed">
                Durations here are test execution time: setup, waits, retries and any demo pacing included. They do not say how quickly the product
                responded; see Product latency.
              </Text>
            </Stack>
            <Paper withBorder>
              <SimpleGrid component="dl" cols={{ base: 2, sm: 4 }} m={0} spacing="md">
                {facts.map(([label, value]) => (
                  <Fact key={label} label={label}>
                    {value}
                  </Fact>
                ))}
              </SimpleGrid>
            </Paper>
            {stats.branches.length > 0 && (
              <Text component="div" c="dimmed">
                Branches: {stats.branches.join(', ')}
              </Text>
            )}
            {!d && (
              <Text component="div" c="dimmed">
                No test duration recorded. Producers can send <Code>durationMs</Code> with each check.
              </Text>
            )}
            {entries.length > 1 && <Trend entries={entries} />}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="reliability" pt="md">
          {!history.isError && <Reliability testKey={test.key} entries={history.data === null ? [] : history.data?.history} />}
          {history.isError && (
            <Text component="div" c="dimmed">
              Reliability needs the history, which could not be read.
            </Text>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="latency" pt="md">
          <ProductLatency entries={entries} />
        </Tabs.Panel>

        <Tabs.Panel value="history" pt="md">
          <Stack aria-label="History" component="section" gap="xs">
            <Title order={3}>History{entries.length ? ` · ${plural(entries.length, 'result', 'results')}` : ''}</Title>
            {history.isPending && (
              <Text role="status" component="div" c="dimmed">
                Reading the history…
              </Text>
            )}
            {history.isError && (
              <Alert role="alert" color="red">
                The history could not be read. {history.error.message}
              </Alert>
            )}
            {!history.isPending && !history.isError && entries.length === 0 && (
              <Text component="div" c="dimmed">
                No earlier results are held for this test.
              </Text>
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
                        bg={entry.layer === layer ? 'var(--mantine-color-primary-light)' : undefined}
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
                          <Flex component="span" display="inline-flex" gap={6} align="center" wrap="nowrap">
                            <StatusMark status={entry.status} size={14} />
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
                        <Table.Td title={entry.detail} c="dimmed" maw={260}>
                          <Text span inherit lineClamp={2}>
                            {entry.detail.split('\n')[0]}
                          </Text>
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
              <Box>
                <Button type="button" size="compact-sm" onClick={() => setRows(rows + HISTORY_ROWS)} variant="subtle" c="dimmed">
                  Show more ({entries.length - rows} more)
                </Button>
              </Box>
            )}
          </Stack>
        </Tabs.Panel>
      </Tabs>
      <Divider />
      <Badges test={test} />
      <Scope pinned={pinned} slot={slot} />
      <Group gap="sm" c="dimmed" fz="xs">
          {test.spec && (
            <>
              <Text span inherit ff="monospace">
                {test.spec!.path}
              </Text>
              <Divider orientation="vertical" visibleFrom="xs" />
            </>
          )}
          <Text span inherit ff="monospace" title="Check id">
            {test.id}
          </Text>
          {test.spec && <Divider orientation="vertical" visibleFrom="xs" />}
          <ReadPromise specPath={test.spec?.path ?? null} check={test.id} />
        </Group>

      <Divider />
      <Group justify="center">
        <Anchor
          c="dimmed"
          aria-label="Close the test"
          renderRoot={(props) => (
            <Link {...props} to="/" search={patched({ test: undefined, layer: undefined, clip: undefined, clipAt: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
          )}
        >
          <Group component="span" display="inline-flex" gap={4}>
            <IconX size={14} aria-hidden="true" />
            Close
          </Group>
        </Anchor>
      </Group>
    </Stack>
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
    <Stack gap="xs">
      {timed.length > 1 && (
        <Box component="figure" m={0} maw={480}>
          <Box component="figcaption" fz="xs" c="dimmed" mb={4}>
            Test duration over the last {plural(timed.length, 'result', 'results')} · max {formatMs(max)}
          </Box>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`Durations from ${formatMs(timed[0]!.durationMs)} to ${formatMs(timed.at(-1)!.durationMs)}`}
            preserveAspectRatio="none"
          >
            <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="var(--mantine-color-default-border)" />
            <polyline points={points} fill="none" stroke="var(--mantine-color-dimmed)" strokeWidth={1.5} />
            {timed.map((entry, index) => (
              <circle
                key={index}
                cx={x(index)}
                cy={y(entry.durationMs!)}
                r={entry.status === 'failed' ? 3 : index === timed.length - 1 ? 2.5 : 0}
                fill={entry.status === 'failed' ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-text)'}
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
        gap={3}
        align="center"
        wrap="wrap"
      >
        {oldest.map((entry, index) => (
          <Text
            key={index}
            c={statusColor(entry.status)}
            lh={1}
            data-status={entry.status}
            title={`${exactTime(entry.at)} · ${environmentLabel(entry.environment)} · ${statusWord(entry.status)}${entry.durationMs !== null ? ` · ${formatMs(entry.durationMs)}` : ''}`}
            span
            inherit
          >
            <IconCircleFilled size={10} aria-hidden="true" />
          </Text>
        ))}
      </Flex>
    </Stack>
  );
}
