import { IconAlertTriangle, IconArrowLeft, IconVideo } from '@tabler/icons-react';
import { Alert, Anchor, Box, Button, Code, Flex, Group, List, Stack, Table, Text, TextInput, Title, VisuallyHidden } from '@mantine/core';
/**
 * @module Runs view
 *
 * The CI runs that produced the report, newest first: when, on which branch and commit, which environments, how many
 * tests and how they went, how long it took, whether it has recordings to watch, and a link to the run. Opening one lists
 * every test it ran, filterable, with a way to show exactly those tests in the explorer. Videos are counted as
 * references (every mention) and as distinct playable recordings (identical bytes are one), and a reference whose file
 * was never stored is shown as unavailable, never as a recording.
 */
import { videoCounts } from '@crvouga/atlas/reports/evidence-detail';
import type { VideoCounts, VideoRef } from '@crvouga/atlas/reports/evidence-types';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import type { FilterName } from '@crvouga/atlas/reports/artifact-query';
import { formatMs, type RunResult, type RunSummary } from '@crvouga/atlas/reports/test-catalog';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { ago, exactTime, plural, shortSha, statusWord, useNow } from '../evidence/format';
import { Meter, StatusMark } from '../evidence/marks';
import { useRunDetail, useRunList } from './catalog';
import { FilterBar } from './filters';
import { patched, useExplorerNavigate, useExplorerSearch } from './navigate';
import { runName } from './parts';
import { filtered, filterOf, NO_FILTERS } from './search';
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
/** Who holds a video, for a person: the test, one of its tries, or a step (in a try). */
function ownerText(video: VideoRef): string {
  const attempt = video.attempt === undefined ? '' : `try ${video.attempt + 1}`;
  if (video.owner === 'layer') return 'the run';
  if (video.owner === 'step') return `step “${video.step ?? ''}”${attempt ? `, ${attempt}` : ''}`;
  if (video.owner === 'attempt') return attempt || 'a try';
  return 'the test';
}
const UNAVAILABLE = 'Listed in the report, but its file was never stored, so it cannot be played.';
/** The unavailable references of a video summary and why they cannot be watched. */
function Unavailable({ videos }: { videos: VideoCounts }) {
  if (!videos.unavailable) return null;
  return (
    <Text component="div" size="xs" c="dimmed" data-video-unavailable>
      <IconAlertTriangle size={16} aria-hidden="true" /> {plural(videos.unavailable, 'video', 'videos')} unavailable. {UNAVAILABLE}
    </Text>
  );
}
/** A run's videos in its row: a link to the recordings, how many references they come from, and what cannot be played. */
function RunVideos({ run }: { run: RunSummary }) {
  const videos = run.videos;
  if (!videos) return <Text span inherit c="dimmed" data-video="none">No video</Text>;
  return (
    <Stack gap={0} data-video={videos.recordings > 0 ? 'available' : 'unavailable'}>
      {videos.recordings > 0 && (
        <Anchor
          aria-label={`Watch ${plural(videos.recordings, 'recording', 'recordings')} in run ${runName(run.key)}`}
          renderRoot={(props) => (
            <Link {...props} to="/" search={patched({ openRun: run.key, video: true })} resetScroll={false} activeOptions={{ exact: true }} />
          )}
        >
          <IconVideo size={16} aria-hidden="true" /> {plural(videos.recordings, 'video', 'videos')}
        </Anchor>
      )}
      {videos.references !== videos.recordings + videos.unavailable && (
        <Text component="div" size="xs" c="dimmed">
          {plural(videos.references, 'reference', 'references')}
        </Text>
      )}
      <Unavailable videos={videos} />
    </Stack>
  );
}
/** The Has video filter: a toggle named by its meaning and the count of what it matches. */
function HasVideo({ count, pressed, noun, onToggle }: { count: number; pressed: boolean; noun: [string, string]; onToggle: () => void }) {
  return (
    <Button type="button" aria-pressed={pressed} aria-label={`Has video: ${plural(count, noun[0], noun[1])}`} onClick={onToggle} variant="light" leftSection={<IconVideo size={16} aria-hidden="true" />}>
      Has video{' '}
      <Text span inherit>
        {count}
      </Text>
    </Button>
  );
}
/** What a filter is called when a page says a server could not apply it. */
const FILTER_WORDS: Partial<Record<FilterName, string>> = { artifactTag: 'tag', type: 'media type', label: 'label', domain: 'domain', spec: 'spec' };
/** Says which filters the list is not narrowed by, because the server that answered ignored them. */
export function NotApplied({ names, noun }: { names: readonly FilterName[]; noun: string }) {
  if (!names.length) return null;
  return (
    <Alert role="status" color="blue" my="sm" data-not-applied>
      This server cannot filter {noun} by {names.map((name) => FILTER_WORDS[name] ?? name).join(', ')}, so the list below is not narrowed by {names.length > 1 ? 'them' : 'it'}. Update the server to use{' '}
      {names.length > 1 ? 'these filters' : 'this filter'}.
    </Alert>
  );
}
function RunTable() {
  const search = useExplorerSearch();
  const go = useExplorerNavigate();
  const video = search.video === true;
  const filter = useMemo(() => filterOf(search), [search]);
  const narrow = filtered(search);
  const runs = useRunList(true, filter);
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
  const withVideo = runs.data.withVideo;
  const noun = narrow ? 'matching' : '';
  return (
    <Box aria-label="Runs" component="section" mb="lg">
      {(narrow || list.length > 0) && <FilterBar facets={runs.data.facets} search={search} tab="runs" extra={withVideo !== undefined || video ? <HasVideo count={withVideo ?? list.length} pressed={video} noun={['run', 'runs']} onToggle={() => go({ video: video ? undefined : true })} /> : undefined} />}
      <NotApplied names={runs.data.notApplied} noun="runs" />
      {!list.length && !narrow && (
        <Text component="div" c="dimmed">
          No runs recorded yet.
        </Text>
      )}
      {list.length > 0 && (
        <Text role="status" component="div">
          {runs.data.total > list.length
            ? `The newest ${list.length} of ${plural(runs.data.total, 'run', 'runs')} ${noun}`.trim()
            : `${plural(list.length, 'run', 'runs')} ${noun}`.trim()}
        </Text>
      )}
      {!list.length && narrow && (
        <Stack gap="xs" align="flex-start" role="status" data-no-match>
          <Text component="div" c="dimmed">
            No run matches these filters.
            {video && withVideo === undefined && ' This server does not report which runs have recordings.'}
          </Text>
          <Button type="button" variant="light" onClick={() => go(NO_FILTERS)}>
            Clear filters
          </Button>
        </Stack>
      )}
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
              <Table.Th scope="col">Video</Table.Th>
              <Table.Th scope="col">Tags</Table.Th>
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
                      <Link {...props} to="/" search={patched({ openRun: run.key, video: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
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
                  <RunVideos run={run} />
                </Table.Td>
                <Table.Td data-tags>{run.artifactTags?.map((tag) => `#${tag}`).join(' ') || '—'}</Table.Td>
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
/** The videos of one result and who holds them, as text (the whole row is one link, so nothing here is interactive). */
function ResultVideos({ videos }: { videos: readonly VideoRef[] | undefined }) {
  const counts = videoCounts(videos);
  if (!counts || !videos) return null;
  const owners = [...new Set(videos.filter((item) => item.available).map(ownerText))];
  return (
    <>
      {counts.recordings > 0 && (
        <Text span inherit data-video="available">
          <IconVideo size={16} aria-hidden="true" /> {plural(counts.recordings, 'video', 'videos')} ({owners.join('; ')})
        </Text>
      )}
      {counts.unavailable > 0 && (
        <Text span inherit data-video-unavailable>
          <IconAlertTriangle size={16} aria-hidden="true" /> {plural(counts.unavailable, 'video', 'videos')} unavailable
        </Text>
      )}
    </>
  );
}
const RESULT_FILTERS = [
  { id: '', label: 'All' },
  { id: 'failed', label: 'Failed' },
  { id: 'passed', label: 'Passed' },
  { id: 'not-run', label: 'Not run' }
] as const;
function RunDetailView({ runKey }: { runKey: string }) {
  const search = useExplorerSearch();
  const go = useExplorerNavigate();
  const video = search.video === true;
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
        (!video || (videoCounts(result.videos)?.recordings ?? 0) > 0) &&
        terms.every((term) =>
          `${result.title}\n${result.specPath ?? ''}\n${result.environment ?? ''}\n${result.producer}`.toLowerCase().includes(term)
        )
    );
  }, [results, status, words, video]);
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
      {run.videos && (
        <Text component="div" data-run-videos>
          <IconVideo size={16} aria-hidden="true" /> {plural(run.videos.recordings, 'video', 'videos')}
          {run.videos.references !== run.videos.recordings + run.videos.unavailable && ` from ${plural(run.videos.references, 'reference', 'references')}`}
          <Unavailable videos={run.videos} />
        </Text>
      )}
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
      {(run.videos || video) && (
        <Flex gap="xs" align="center" wrap="wrap">
          <HasVideo
            count={results.filter((result) => (videoCounts(result.videos)?.recordings ?? 0) > 0).length}
            pressed={video}
            noun={['result', 'results']}
            onToggle={() => go({ video: video ? undefined : true })}
          />
        </Flex>
      )}
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
                      <ResultVideos videos={result.videos} />
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
