import { IconAlertTriangle, IconArrowLeft, IconArrowsExchange, IconCheck, IconExternalLink, IconFilterOff, IconHistory, IconListSearch, IconPlayerPlay, IconSearch, IconVideo } from '@tabler/icons-react';
import { Alert, Anchor, Badge, Box, Button, Card, Center, Code, Divider, Flex, Group, List, NativeSelect, NavLink, Skeleton, Stack, Table, Text, TextInput, Title, VisuallyHidden } from '@mantine/core';
/**
 * @module Runs view
 *
 * The CI runs that produced the report, newest first: when, on which branch and commit, which environments, how many
 * tests and how they went, how long it took, whether it has recordings to watch, and a link to the run. Opening one lists
 * every test it ran, filterable, with a way to show exactly those tests in the explorer. Videos are counted as
 * references (every mention) and as distinct playable recordings (identical bytes are one), and a reference whose file
 * was never stored is shown as unavailable, never as a recording. An opened run lists its artifacts first (see
 * `RunArtifacts`), and a run of no checks says so instead of reading as passed.
 */
import { videoCounts } from '@crvouga/atlas/reports/evidence-detail';
import type { VideoCounts, VideoRef } from '@crvouga/atlas/reports/evidence-types';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import type { FilterName } from '@crvouga/atlas/reports/artifact-query';
import { formatMs, type RunResult, type RunSummary } from '@crvouga/atlas/reports/test-catalog';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Panel } from '../components/Page';
import { statusColor } from '../ui/theme';
import { behaviorDocs, behaviorId, describeHit, forRuns, resultDoc, runDoc } from '../find/behaviors';
import { useDocSearch } from '../find/doc-search';
import { hasFilters, passesFilters, type ParsedSearch, type SearchFilters } from '../find/query';
import type { FindDoc, Ranked } from '../find/rank';
import { ago, exactTime, plural, shortSha, statusWord, useNow } from '../evidence/format';
import { Meter, StatusMark } from '../evidence/marks';
import { useRecordingVerification, useRunDetail, useRunList, useTestCatalog } from './catalog';
import { allStoredVideosGone, verificationOfRun, type RunVerification } from './recording-verification';
import { RunArtifacts } from './RunArtifacts';
import { entriesFromRun } from './playlist-entries';
import { WatchPlaylist } from './playlist';
import { FilterBar } from './filters';
import { SearchNotes, TypedFilters } from './search-notes';
import { patched, useExplorerNavigate, useExplorerSearch, useWatchAddress } from './navigate';
import { runName } from './parts';
import { filtered, filterOf, NO_FILTERS } from './search';
const RUN_ROWS = 50;
const NO_RESULTS: readonly RunResult[] = [];
const RESULT_ROWS = 200;
/**
 * A calm, centered state inside a panel: a dimmed mark, one sentence and at most one action. Other attributes (a
 * `role`, a `data-` mark) land on its root, so what a page says when it has nothing to show stays findable.
 */
export function EmptyState({ icon, children, action, ...rest }: { icon?: ReactNode; children: ReactNode; action?: ReactNode; role?: 'status' | 'note'; [mark: `data-${string}`]: unknown }) {
  return (
    <Stack align="center" gap="sm" py={48} px="lg" {...rest}>
      {icon && (
        <Center c="dimmed" aria-hidden="true">
          {icon}
        </Center>
      )}
      <Text component="div" size="sm" c="dimmed" ta="center" maw={520}>
        {children}
      </Text>
      {action}
    </Stack>
  );
}
/** What a panel shows while its content is read: the sentence a screen reader hears, over rows shaped like what is coming. */
export function Reading({ children, rows = 4 }: { children: ReactNode; rows?: number }) {
  return (
    <Stack gap="sm">
      <Text role="status" component="div" size="sm" c="dimmed">
        {children}
      </Text>
      <Stack gap="xs" aria-hidden="true">
        {Array.from({ length: rows }, (_, row) => (
          <Skeleton key={row} h={36} radius="sm" />
        ))}
      </Stack>
    </Stack>
  );
}
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
  // A run of no checks (only files) has not passed anything: say so, rather than "0 passed".
  if (run.tests === 0 && Object.values(run.counts).every((count) => count === 0))
    return (
      <Text span inherit c="dimmed" data-status="none">
        No checks recorded
      </Text>
    );
  return (
    <Flex component="span" display="inline-flex" gap="xs" wrap="wrap">
      {run.counts.failed > 0 && (
        <Text span inherit fw={600} c={`${statusColor('failed')}.7`}>
          {run.counts.failed} failed
        </Text>
      )}
      <Text span inherit>
        {run.counts.passed} passed
      </Text>
      {run.counts['not-run'] > 0 && (
        <Text span inherit c="dimmed">
          {run.counts['not-run']} not run
        </Text>
      )}
      {run.counts.running > 0 && (
        <Text data-status="running" span inherit c={`${statusColor('running')}.7`}>
          {run.counts.running} running
        </Text>
      )}
    </Flex>
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
const MISSING = 'The run says it stored this file, but its bundle no longer holds it, so it cannot be played.';
/** The unavailable references of a video summary and why they cannot be watched: never stored, or stored and then gone. */
function Unavailable({ videos }: { videos: VideoCounts }) {
  if (!videos.unavailable) return null;
  const missing = Math.min(videos.missing ?? 0, videos.unavailable);
  return (
    <Text component="div" size="xs" c="dimmed" data-video-unavailable>
      <IconAlertTriangle size={16} aria-hidden="true" /> {plural(videos.unavailable, 'video', 'videos')} unavailable.{' '}
      {missing > 0 && <Text span inherit data-video-missing>{missing === videos.unavailable ? MISSING : `${plural(missing, 'video', 'videos')}: ${MISSING}`}{' '}</Text>}
      {missing < videos.unavailable && UNAVAILABLE}
    </Text>
  );
}
/** Words for a run's recording completeness, apart from how its tests went. */
const COMPLETENESS_WORDS: Record<string, string> = { complete: 'complete', incomplete: 'incomplete', 'none-expected': 'none expected', unknown: 'unknown' };
/** A run's recording completeness in its row: how many expected recordings were published, said in words and independent of its outcomes. Nothing when its layers declared no expectations (unknown is not shown as complete). */
function RunRecordings({ run }: { run: RunSummary }) {
  const recordings = run.recordings;
  if (!recordings) return null;
  const word = COMPLETENESS_WORDS[recordings.state] ?? 'unknown';
  const text = recordings.expected > 0 ? `Recordings ${recordings.published} of ${recordings.expected}: ${word}` : `Recordings: ${word}`;
  return (
    <Badge
      size="sm"
      variant="light"
      color={recordings.state === 'incomplete' ? 'orange' : 'gray'}
      data-recordings={recordings.state}
      title={recordings.state === 'incomplete' ? 'Some expected recordings were not published. The test outcomes are unaffected.' : undefined}
    >
      {text}
    </Badge>
  );
}
/**
 * What the server's read-back says about a run's stored videos, apart from its test outcomes: some are gone or damaged
 * (an orange mark that names the problems), or all were read back and are as published. Nothing when they were never
 * read back: an unverified run is not shown as verified.
 */
function StoredVideos({ verification }: { verification: RunVerification | null }) {
  if (!verification) return null;
  const at = `Read back from storage ${exactTime(verification.atMs)}. This checks the stored files, not playback in a browser. The test outcomes are unaffected.`;
  if (verification.gaps === 0)
    return (
      <Text component="div" size="xs" c="dimmed" title={at} data-stored-videos="verified">
        <IconCheck size={16} aria-hidden="true" /> {verification.checked > 0 ? `${plural(verification.ok, 'stored video', 'stored videos')} verified` : 'No stored videos to verify'}
      </Text>
    );
  return (
    <Text component="div" size="xs" c="orange" title={at} data-stored-videos="unavailable">
      <IconAlertTriangle size={16} aria-hidden="true" /> Recording unavailable: {verification.gaps} of {plural(verification.checked, 'stored video', 'stored videos')} failed the read-back ({verification.problems.join(', ')}).
    </Text>
  );
}
/** A run's videos in its row: a link to the recordings, how many references they come from, and what cannot be played. */
function RunVideos({ run, verification }: { run: RunSummary; verification: RunVerification | null }) {
  const videos = run.videos;
  const gone = videos !== undefined && allStoredVideosGone(verification, videos.recordings);
  const files = run.attachments ? (
    <Anchor
      aria-label={`Open the ${plural(run.attachments, 'file', 'files')} of run ${runName(run.key)}`}
      renderRoot={(props) => (
        <Link {...props} to="/" search={patched({ openRun: run.key, layer: undefined, artifact: undefined, video: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
      )}
    >
      <Text span inherit data-run-files>
        {plural(run.attachments, 'file', 'files')}
      </Text>
    </Anchor>
  ) : null;
  if (!videos)
    return (
      <Stack gap={0}>
        <Text span inherit c="dimmed" data-video="none">
          No video
        </Text>
        {files}
      </Stack>
    );
  return (
    <Stack gap={0} data-video={videos.recordings > 0 && !gone ? 'available' : 'unavailable'}>
      {files}
      {videos.recordings > 0 && !gone && (
        <Anchor
          aria-label={`Watch ${plural(videos.recordings, 'recording', 'recordings')} in run ${runName(run.key)}`}
          renderRoot={(props) => (
            <Link {...props} to="/" search={patched({ openRun: run.key, layer: undefined, artifact: undefined, video: true })} resetScroll={false} activeOptions={{ exact: true }} />
          )}
        >
          <IconVideo size={16} aria-hidden="true" /> Watch {plural(videos.recordings, 'recording', 'recordings')}
        </Anchor>
      )}
      {videos.references !== videos.recordings + videos.unavailable && (
        <Text component="div" size="xs" c="dimmed">
          {plural(videos.references, 'reference', 'references')}
        </Text>
      )}
      <Unavailable videos={videos} />
      <StoredVideos verification={verification} />
    </Stack>
  );
}
/** The Has video filter: a toggle named by its meaning and the count of what it matches. */
function HasVideo({ count, pressed, noun, onToggle, size }: { count: number; pressed: boolean; noun: [string, string]; onToggle: () => void; size?: 'xs' }) {
  return (
    <Button type="button" size={size} aria-pressed={pressed} aria-label={`Has video ${plural(count, noun[0], noun[1])}`} onClick={onToggle} variant={pressed ? 'light' : 'default'} leftSection={<IconVideo size={16} aria-hidden="true" />} rightSection={<Text span inherit c="dimmed">{count}</Text>}>
      Has video{' '}
    </Button>
  );
}
/** The search box of the Runs tab and of an opened run: one query in the address, so a link reproduces it. */
function SearchBox({ label, placeholder, parsed, onSearch }: { label: string; placeholder: string; parsed: ParsedSearch; onSearch: (value: string) => void }) {
  const search = useExplorerSearch();
  const [draft, setDraft] = useState(search.q ?? '');
  // The address may change from elsewhere (a link, back, a chip): follow it.
  useEffect(() => setDraft((current) => (current.trim() === (search.q ?? '').trim() ? current : (search.q ?? ''))), [search.q]);
  return (
    <Flex gap="xs" align="center" wrap="wrap" flex={1}>
      <TextInput
        type="search"
        leftSection={<IconSearch size={16} aria-hidden="true" />}
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        flex={1}
        miw={{ base: '100%', sm: '20rem' }}
        onChange={(event) => {
          setDraft(event.target.value);
          onSearch(event.target.value.trim());
        }}
      />
      <TypedFilters
        parsed={parsed}
        query={draft}
        onChange={(next) => {
          setDraft(next);
          onSearch(next);
        }}
      />
    </Flex>
  );
}
/** Why a result is in the list, beside it: exact, or the fields the words were found in. */
function WhyMatched({ hit }: { hit: Ranked | undefined }) {
  const why = hit ? describeHit(hit) : '';
  if (!hit || !why) return null;
  return (
    <Text size="xs" c="dimmed" data-why>
      {hit.exact && (
        <Badge component="span" color="blue" mr="xs">
          Exact
        </Badge>
      )}
      {why}
    </Text>
  );
}
const RUN_SORTS = [
  { id: 'recent', label: 'Newest' },
  { id: 'failures', label: 'Most failures' },
  { id: 'relevance', label: 'Best match' }
] as const;
/** What a filter is called when a page says a server could not apply it. */
const FILTER_WORDS: Partial<Record<FilterName, string>> = { artifactTag: 'tag', type: 'media type', label: 'label', domain: 'domain', spec: 'spec', recordings: 'recording completeness' };
/** Says which filters the list is not narrowed by, because the server that answered ignored them. */
export function NotApplied({ names, noun }: { names: readonly FilterName[]; noun: string }) {
  if (!names.length) return null;
  return (
    <Alert role="status" color="blue" data-not-applied>
      This server cannot filter {noun} by {names.map((name) => FILTER_WORDS[name] ?? name).join(', ')}, so the list below is not narrowed by {names.length > 1 ? 'them' : 'it'}. Update the server to use{' '}
      {names.length > 1 ? 'these filters' : 'this filter'}.
    </Alert>
  );
}
function RunTable() {
  const search = useExplorerSearch();
  const go = useExplorerNavigate();
  const video = search.video === true;
  const searching = !!search.q;
  // The structured filters of the address narrow the runs on the server; the words are matched here by the shared search,
  // over every run, so the Runs tab judges "savde answer" as the finder and the test list do.
  const filter = useMemo(() => {
    const { q: _words, ...rest } = filterOf(search);
    return rest;
  }, [search]);
  const narrow = filtered(search);
  const runs = useRunList(true, filter, searching);
  const stored = useRecordingVerification();
  const now = useNow();
  const [shown, setShown] = useState(RUN_ROWS);
  const docs = useMemo(() => (runs.data?.runs ?? []).map((run) => runDoc(run, runLabel(run))), [runs.data]);
  const found = useDocSearch(docs, search.q);
  const parsed = useMemo(() => forRuns(found.parsed), [found.parsed]);
  const sortValue = search.sort === 'failures' ? 'failures' : (search.sort === 'relevance' || !search.sort) && found.hits ? 'relevance' : 'recent';
  const visible = useMemo(() => {
    const runsOf = runs.data?.runs ?? [];
    const order = found.hits ? new Map([...found.hits.keys()].map((id, at) => [id, at] as const)) : null;
    const kept = runsOf.filter((run, at) => {
      const doc = docs[at]!;
      return (!found.hits || found.hits.has(doc.id)) && passesFilters(doc.facets, parsed.filters);
    });
    if (sortValue === 'failures') return [...kept].sort((a, b) => b.counts.failed - a.counts.failed || b.endedAtMs - a.endedAtMs);
    if (sortValue === 'relevance' && order) return [...kept].sort((a, b) => (order.get(`runs:${a.key}`) ?? 0) - (order.get(`runs:${b.key}`) ?? 0));
    return kept;
  }, [runs.data, docs, found.hits, parsed.filters, sortValue]);
  if (runs.isPending)
    return (
      <Panel title="Runs">
        <Reading>Reading the runs…</Reading>
      </Panel>
    );
  if (runs.isError)
    return (
      <Panel title="Runs">
        <Alert role="alert" color={'red'}>
          The runs could not be read. {runs.error.message}
        </Alert>
      </Panel>
    );
  const everything = runs.data.runs;
  const list = visible;
  const withVideo = runs.data.withVideo;
  const noun = narrow ? 'matching' : '';
  const hasVideoNow = video || parsed.filters.video;
  const typed = parsed.tokens.length > 0 || parsed.issues.length > 0 || found.status !== 'idle';
  return (
    <Stack aria-label="Runs" component="section" gap="md">
      <Panel
        flush
        title="Runs"
        description={
          everything.length > 0 ? (
            <Text role="status" component="div" size="sm" c="dimmed">
              {runs.data.total > everything.length
                ? `The newest ${everything.length} of ${plural(runs.data.total, 'run', 'runs')} ${noun}`.trim()
                : searching || list.length !== everything.length
                  ? `${list.length.toLocaleString()} of ${plural(everything.length, 'run', 'runs')} ${noun}`.trim()
                  : `${plural(list.length, 'run', 'runs')} ${noun}`.trim()}
            </Text>
          ) : undefined
        }
        actions={
          everything.length > 0 ? (
            <NativeSelect
              aria-label="Sort runs"
              value={sortValue}
              onChange={(event) => go({ sort: event.target.value === (found.hits ? 'relevance' : 'recent') ? undefined : (event.target.value as 'recent' | 'failures' | 'relevance') })}
            >
              {RUN_SORTS.filter((option) => option.id !== 'relevance' || found.hits !== null).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          ) : undefined
        }
      >
        {(narrow || everything.length > 0 || runs.data.notApplied.length > 0 || typed) && (
          <Stack px="lg" pb="md" pt={4} gap="sm">
            {(narrow || everything.length > 0) && (
              <FilterBar
                facets={runs.data.facets}
                search={search}
                tab="runs"
                extra={
                  withVideo !== undefined || video ? (
                    <HasVideo count={withVideo ?? list.length} pressed={hasVideoNow} noun={['run', 'runs']} onToggle={() => go({ video: video ? undefined : true })} />
                  ) : undefined
                }
              />
            )}
            <NotApplied names={runs.data.notApplied} noun="runs" />
            {typed && (
              <>
                <Flex gap="xs" align="center" wrap="wrap">
                  <TypedFilters parsed={parsed} query={search.q ?? ''} onChange={(next) => go({ q: next || undefined }, { replace: true })} />
                </Flex>
                <SearchNotes issues={parsed.issues} semantic={found.status} />
              </>
            )}
          </Stack>
        )}
        {!everything.length && !narrow && <EmptyState icon={<IconHistory size={28} stroke={1.5} aria-hidden="true" />}>No runs recorded yet.</EmptyState>}
        {!list.length && narrow && (
          <EmptyState
            role="status"
            data-no-match
            icon={<IconFilterOff size={28} stroke={1.5} aria-hidden="true" />}
            action={
              <Button type="button" variant="light" onClick={() => go(NO_FILTERS)}>
                Clear filters
              </Button>
            }
          >
            No run matches these filters.
            {video && withVideo === undefined && ' This server does not report which runs have recordings.'}
          </EmptyState>
        )}
        <Table.ScrollContainer minWidth={980}>
          <Table data-runs verticalSpacing="sm" highlightOnHover {...(list.length ? {} : { display: 'none' })}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col" pl="lg">
                  Run / ended
                </Table.Th>
                <Table.Th scope="col">Branch and commit</Table.Th>
                <Table.Th scope="col">Environments</Table.Th>
                <Table.Th scope="col" ta="right">
                  Tests
                </Table.Th>
                <Table.Th scope="col">Outcomes</Table.Th>
                <Table.Th scope="col">Span</Table.Th>
                <Table.Th scope="col">Video</Table.Th>
                <Table.Th scope="col">Tags</Table.Th>
                <Table.Th scope="col" pr="lg">
                  <VisuallyHidden>CI run</VisuallyHidden>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.slice(0, shown).map((run) => (
                <Table.Tr key={run.key} data-status={run.counts.failed ? 'failed' : run.tests === 0 ? 'not-run' : 'passed'}>
                  <Table.Td title={exactTime(run.endedAtMs)} pl="lg" miw={200}>
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                      <Box pt={3}>
                        <StatusMark status={runStatus(run)} size={14} />
                      </Box>
                      <Stack gap={2} miw={0}>
                        <Anchor
                          fw={500}
                          aria-label={`Open run ${runLabel(run)}`}
                          renderRoot={(props) => (
                            <Link {...props} to="/" search={patched({ openRun: run.key, layer: undefined, artifact: undefined, video: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
                          )}
                        >
                          {runLabel(run)}
                        </Anchor>
                        <Text c="dimmed" fz="xs">
                          {ago(run.endedAtMs, now)}
                        </Text>
                        <WhyMatched hit={found.hits?.get(`runs:${run.key}`)} />
                      </Stack>
                    </Group>
                  </Table.Td>
                  <Table.Td title={run.branch ?? ''}>
                    <Stack gap={2}>
                      <Group gap={6} wrap="nowrap">
                        <Text span size="sm" c="dimmed">
                          {run.branch ?? '—'}
                        </Text>
                        <Code>{shortSha(run.sha) ?? '—'}</Code>
                      </Group>
                      <Text span size="xs">
                        <Freshness run={run} />
                      </Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td maw={220}>{run.environments.map((env) => environmentLabel(env)).join(', ') || '—'}</Table.Td>
                  <Table.Td ta="right">{run.tests}</Table.Td>
                  <Table.Td miw={180}>
                    <Stack gap={6}>
                      <Meter counts={run.counts} />
                      <Text span size="xs">
                        <Counts run={run} />
                      </Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td c="dimmed" miw={110}>
                    {formatMs(run.spanMs)}
                  </Table.Td>
                  <Table.Td maw={320}>
                    <Stack gap={4} align="flex-start">
                      <RunVideos run={run} verification={verificationOfRun(stored.data, run.key)} />
                      <RunRecordings run={run} />
                    </Stack>
                  </Table.Td>
                  <Table.Td data-tags miw={110}>
                    {run.artifactTags?.length ? (
                      <Group gap={4} wrap="wrap">
                        {run.artifactTags.map((tag) => (
                          <Badge key={tag} component="span" size="sm" variant="light" tt="none">
                            #{tag}
                          </Badge>
                        ))}
                      </Group>
                    ) : (
                      <Text span c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td pr="lg">
                    {run.runUrl ? (
                      <Anchor href={run.runUrl} target="_blank" rel="noreferrer" size="sm">
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
          <Center p="sm">
            <Button type="button" onClick={() => setShown(shown + RUN_ROWS)} variant="subtle">
              Show more ({list.length - shown} more)
            </Button>
          </Center>
        )}
      </Panel>
    </Stack>
  );
}
/** How a run went as one mark: failed when anything failed, running while anything runs, passed only when something passed. A run of no checks, or of none that ran, is not shown as passed. */
function runStatus(run: RunSummary): 'failed' | 'running' | 'passed' | 'none' {
  return run.counts.failed > 0 ? 'failed' : run.counts.running > 0 ? 'running' : run.counts.passed > 0 ? 'passed' : 'none';
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
  const stored = useRecordingVerification();
  const now = useNow();
  const [status, setStatus] = useState('');
  const [shown, setShown] = useState(RESULT_ROWS);
  const catalog = useTestCatalog();
  const model = catalog.model;
  const results = detail.data?.results ?? NO_RESULTS;
  // The words are judged against every behavior of the report, as in the test list, so the same words make the same
  // behaviors eligible; the run's results are then the ones of those behaviors it recorded.
  const docs = useMemo<readonly FindDoc[]>(() => {
    if (!search.q) return [];
    const base = model ? behaviorDocs(model.tests) : new Map<string, FindDoc>();
    const extra = new Map<string, FindDoc>();
    for (const result of results) if (!base.has(result.key) && !extra.has(result.key)) extra.set(result.key, resultDoc(result, undefined));
    return [...base.values(), ...extra.values()];
  }, [search.q, model, results]);
  const found = useDocSearch(docs, search.q);
  const resultDocs = useMemo(() => results.map((result) => resultDoc(result, model?.byKey.get(result.key))), [results, model]);
  const narrowedResults = useMemo(
    () =>
      results.filter(
        (result, at) =>
          (!found.hits || found.hits.has(behaviorId(result.key))) &&
          (!video || (videoCounts(result.videos)?.recordings ?? 0) > 0) &&
          passesFilters(resultDocs[at]!.facets, { ...found.parsed.filters, status: [] })
      ),
    [results, resultDocs, found, video]
  );
  const statusFilters = found.parsed.filters.status;
  const filtered = useMemo(
    () =>
      narrowedResults.filter(
        (result) => (!status || result.status === status) && (!statusFilters.length || statusFilters.some((wanted) => (wanted === 'flaky' ? model?.byKey.get(result.key)?.stats.flaky === true : result.status === wanted)))
      ),
    [narrowedResults, status, statusFilters, model]
  );
  const watch = useWatchAddress();
  const playlist = useMemo(() => entriesFromRun(filtered, detail.data?.layers), [filtered, detail.data]);
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
      size="sm"
      c="dimmed"
      renderRoot={(props) => (
        <Link {...props} to="/" search={patched({ openRun: undefined, layer: undefined, artifact: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
      )}
    >
      <Text aria-hidden="true" span inherit>
        <IconArrowLeft size={14} aria-hidden="true" />
      </Text>{' '}
      All runs
    </Anchor>
  );
  if (detail.isPending)
    return (
      <Card>
        <Stack gap="md">
          {back}
          <Reading>Reading the run…</Reading>
        </Stack>
      </Card>
    );
  if (detail.isError)
    return (
      <Card>
        <Stack gap="md">
          {back}
          <Alert role="alert" color={'red'}>
            The run could not be read. {detail.error.message}
          </Alert>
        </Stack>
      </Card>
    );
  if (!detail.data)
    return (
      <Card>
        <Stack gap="md">
          {back}
          <Alert color={'blue'}>That run is not in the report any more.</Alert>
        </Stack>
      </Card>
    );
  const { run } = detail.data;
  const facts: ReactNode[] = [
    run.branch || run.sha ? (
      <Group gap={6} wrap="nowrap">
        {run.branch && (
          <Text span inherit>
            {run.branch}
          </Text>
        )}
        {run.sha && <Code>{shortSha(run.sha)}</Code>}
        <Freshness run={run} />
      </Group>
    ) : run.freshness ? (
      <Freshness run={run} />
    ) : null,
    <Text title={exactTime(run.endedAtMs)} span inherit>
      ended {ago(run.endedAtMs, now)}
    </Text>,
    <Text span inherit>
      took {formatMs(run.spanMs)}
    </Text>,
    run.environments.length > 0 ? (
      <Text span inherit>
        {run.environments.map((env) => environmentLabel(env)).join(', ')}
      </Text>
    ) : null,
    run.producers.length > 0 ? (
      <Text span inherit>
        {run.producers.join(', ')}
      </Text>
    ) : null,
    run.totalDurationMs !== null ? (
      <Text span inherit>
        {formatMs(run.totalDurationMs)} of test time
      </Text>
    ) : null
  ].filter((fact) => fact !== null);
  return (
    <Stack aria-label={`Run ${runLabel(run)}`} component="section" gap="md">
      <Card>
        <Stack gap="md">
          <Group justify="space-between" align="flex-start" gap="md">
            <Stack gap={6} flex={1} miw={{ base: '100%', sm: 320 }}>
              {back}
              <Group gap="sm" wrap="nowrap" align="center">
                <StatusMark status={runStatus(run)} size={20} />
                <Title order={2}>Run {runLabel(run)}</Title>
              </Group>
            </Stack>
            <Group gap="xs">
              {run.runUrl && (
                <Button component="a" href={run.runUrl} target="_blank" rel="noreferrer" rightSection={<IconExternalLink size={14} aria-hidden="true" />}>
                  Open the CI run
                </Button>
              )}
              <Button
                leftSection={<IconListSearch size={16} aria-hidden="true" />}
                renderRoot={(props) => (
                  <Link
                    {...props}
                    to="/"
                    search={patched({ tab: undefined, openRun: undefined, inRun: run.key, test: undefined, layer: undefined, artifact: undefined })}
                    resetScroll={false}
                    activeOptions={{ exact: true }}
                  />
                )}
              >
                Show these tests in the explorer
              </Button>
            </Group>
          </Group>
          <Group component="div" gap="sm" c="dimmed" fz="sm" wrap="wrap">
            {facts.map((fact, at) => (
              <Group key={at} gap="sm" wrap="nowrap">
                {at > 0 && <Divider orientation="vertical" />}
                {fact}
              </Group>
            ))}
          </Group>
          <Stack gap={6}>
            <Meter counts={run.counts} />
            <Group gap="sm" fz="sm">
              <Text span inherit fw={600}>
                {run.tests === 0 ? 'No tests' : plural(run.tests, 'test', 'tests')}
              </Text>
              <Counts run={run} />
            </Group>
          </Stack>
          {(run.videos || verificationOfRun(stored.data, run.key)) && (
            <Stack gap={4}>
              {run.videos && (
                <Text component="div" size="sm" data-run-videos>
                  <IconVideo size={16} aria-hidden="true" /> {plural(run.videos.recordings, 'video', 'videos')}
                  {run.videos.references !== run.videos.recordings + run.videos.unavailable && ` from ${plural(run.videos.references, 'reference', 'references')}`}
                  <Unavailable videos={run.videos} />
                </Text>
              )}
              <StoredVideos verification={verificationOfRun(stored.data, run.key)} />
            </Stack>
          )}
          <Divider />
          <Group gap="xs" wrap="wrap">
            <Text size="sm" c="dimmed" aria-hidden="true">
              <IconArrowsExchange size={16} aria-hidden="true" />
            </Text>
            {(['base', 'cand'] as const).map((side) => (
              <Anchor
                key={side}
                size="sm"
                renderRoot={(props) => (
                  <Link {...props} to="/" search={patched({ tab: 'compare', [side]: run.key, openRun: undefined, layer: undefined, artifact: undefined, pair: undefined, video: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
                )}
              >
                {side === 'base' ? 'Compare with this run as the baseline' : 'Compare with this run as the candidate'}
              </Anchor>
            ))}
          </Group>
        </Stack>
      </Card>
      <RunArtifacts detail={detail.data} />
      <Panel
        flush
        order={3}
        title="Results"
        description={
          search.q || found.parsed.tokens.length > 0 ? (
            <Text role="status" size="sm" c="dimmed">
              {filtered.length.toLocaleString()} of {plural(results.length, 'result', 'results')} match
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              Grouped by spec. Each opens the test as this run recorded it.
            </Text>
          )
        }
        actions={
          filtered.length > 0 ? (
            <Button type="button" variant="filled" leftSection={<IconPlayerPlay size={16} aria-hidden="true" />} onClick={() => watch.open()}>
              Watch these {plural(filtered.length, 'result', 'results')}
            </Button>
          ) : undefined
        }
      >
        <Stack px="lg" pb="md" pt={4} gap="sm">
          <Flex gap="xs" align="center" wrap="wrap">
            <SearchBox
              label="Search this run"
              placeholder='Search this run… or filter: status:failed has:video "exact phrase"'
              parsed={found.parsed}
              onSearch={(value) => go({ q: value || undefined }, { replace: true })}
            />
          </Flex>
          <SearchNotes issues={found.parsed.issues} semantic={found.status} />
          <Group gap="xs" wrap="wrap">
            <Group gap={6} role="group" aria-label="Result status">
              {RESULT_FILTERS.map((filter) => (
                <Button
                  key={filter.id || 'all'}
                  type="button"
                  size="xs"
                  aria-pressed={status === filter.id}
                  data-status={filter.id || undefined}
                  onClick={() => setStatus(filter.id)}
                  variant={status === filter.id ? 'light' : 'default'}
                  rightSection={<Text span inherit c="dimmed">{filter.id ? narrowedResults.filter((result) => result.status === filter.id).length : narrowedResults.length}</Text>}
                >
                  {filter.label}{' '}
                </Button>
              ))}
            </Group>
            {(run.videos || video) && (
              <HasVideo
                size="xs"
                count={results.filter((result) => (videoCounts(result.videos)?.recordings ?? 0) > 0).length}
                pressed={video || found.parsed.filters.video}
                noun={['result', 'results']}
                onToggle={() => go({ video: video ? undefined : true })}
              />
            )}
          </Group>
        </Stack>
        {watch.watching && <WatchPlaylist entries={playlist} initial={watch.clip} onSelect={watch.select} onClose={watch.close} />}
        {!filtered.length && <EmptyState icon={<IconFilterOff size={28} stroke={1.5} aria-hidden="true" />}>No result matches.</EmptyState>}
        {bySpec.map(([spec, list]) => (
          <Box key={spec} data-open aria-label={spec || 'No spec'} component="section">
            <Divider />
            <Group justify="space-between" gap="sm" px="lg" py="xs" bg="var(--mantine-color-default-hover)" wrap="nowrap">
              <Code bg="transparent" fw={600}>
                {spec || 'No spec'}
              </Code>
              <Text span size="xs" c="dimmed">
                {plural(list.length, 'result', 'results')}
              </Text>
            </Group>
            <List listStyleType="none" px="xs" py={4}>
              {list.map((result) => (
                <Box component="li" key={`${result.key}|${result.environment}|${result.producer}|${result.layer}`} data-status={result.status}>
                  <NavLink
                    py={6}
                    renderRoot={(props) => (
                      <Link
                        {...props}
                        to="/"
                        search={patched({ tab: undefined, openRun: undefined, artifact: undefined, test: result.key, layer: result.layer })}
                        resetScroll={false}
                        activeOptions={{ exact: true }}
                      />
                    )}
                    leftSection={<StatusMark status={result.status} size={16} />}
                    label={result.title}
                    description={
                      <>
                        <Flex component="span" display="inline-flex" gap="xs" align="center" wrap="wrap">
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
                          <Text span inherit display="block" c="red" lineClamp={2}>
                            {result.detail.split('\n')[0]}
                          </Text>
                        )}
                      </>
                    }
                    rightSection={
                      <Text span size="xs" c="dimmed" data-one visibleFrom="sm">
                        {formatMs(result.durationMs)}
                      </Text>
                    }
                  />
                </Box>
              ))}
            </List>
          </Box>
        ))}
        {filtered.length > shown && (
          <Center p="sm">
            <Button type="button" onClick={() => setShown(shown + RESULT_ROWS)} variant="subtle">
              Show more ({filtered.length - shown} more)
            </Button>
          </Center>
        )}
      </Panel>
    </Stack>
  );
}
