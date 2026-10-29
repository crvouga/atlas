import { IconAlertTriangle, IconArrowLeft, IconPlayerPlay, IconVideo } from '@tabler/icons-react';
import { Alert, Anchor, Badge, Box, Button, Code, Flex, Group, List, NativeSelect, Stack, Table, Text, TextInput, Title, VisuallyHidden } from '@mantine/core';
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
import { useEffect, useMemo, useState } from 'react';
import { behaviorDocs, behaviorId, describeHit, forRuns, resultDoc, runDoc } from '../find/behaviors';
import { useDocSearch } from '../find/doc-search';
import { hasFilters, passesFilters, type ParsedSearch, type SearchFilters } from '../find/query';
import type { FindDoc, Ranked } from '../find/rank';
import { ago, exactTime, plural, shortSha, statusWord, useNow } from '../evidence/format';
import { Meter, StatusMark } from '../evidence/marks';
import { useRunDetail, useRunList, useTestCatalog } from './catalog';
import { RunArtifacts } from './RunArtifacts';
import { entriesFromRun } from './playlist-entries';
import { WatchPlaylist } from './playlist';
import { FilterBar } from './filters';
import { SearchNotes, TypedFilters } from './search-notes';
import { patched, useExplorerNavigate, useExplorerSearch } from './navigate';
import { runName } from './parts';
import { filtered, filterOf, NO_FILTERS } from './search';
const RUN_ROWS = 50;
const NO_RESULTS: readonly RunResult[] = [];
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
  // A run of no checks (only files) has not passed anything: say so, rather than "0 passed".
  if (run.tests === 0 && Object.values(run.counts).every((count) => count === 0))
    return (
      <Text span inherit c="dimmed" data-status="none">
        No checks recorded
      </Text>
    );
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
  const files = run.attachments ? (
    <Anchor
      aria-label={`Open the ${plural(run.attachments, 'file', 'files')} of run ${runName(run.key)}`}
      renderRoot={(props) => (
        <Link {...props} to="/" search={patched({ openRun: run.key, layer: undefined, artifact: undefined, video: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
      )}
    >
      <Text span inherit data-run-files>
        {plural(run.attachments, 'run file', 'run files')}
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
    <Stack gap={0} data-video={videos.recordings > 0 ? 'available' : 'unavailable'}>
      {files}
      {videos.recordings > 0 && (
        <Anchor
          aria-label={`Watch ${plural(videos.recordings, 'recording', 'recordings')} in run ${runName(run.key)}`}
          renderRoot={(props) => (
            <Link {...props} to="/" search={patched({ openRun: run.key, layer: undefined, artifact: undefined, video: true })} resetScroll={false} activeOptions={{ exact: true }} />
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
/** The search box of the Runs tab and of an opened run: one query in the address, so a link reproduces it. */
function SearchBox({ label, placeholder, parsed, onSearch }: { label: string; placeholder: string; parsed: ParsedSearch; onSearch: (value: string) => void }) {
  const search = useExplorerSearch();
  const [draft, setDraft] = useState(search.q ?? '');
  // The address may change from elsewhere (a link, back, a chip): follow it.
  useEffect(() => setDraft((current) => (current.trim() === (search.q ?? '').trim() ? current : (search.q ?? ''))), [search.q]);
  return (
    <Flex gap="xs" align="center" wrap="wrap">
      <TextInput
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
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
  const searching = !!search.q;
  // The structured filters of the address narrow the runs on the server; the words are matched here by the shared search,
  // over every run, so the Runs tab judges "savde answer" as the finder and the test list do.
  const filter = useMemo(() => {
    const { q: _words, ...rest } = filterOf(search);
    return rest;
  }, [search]);
  const narrow = filtered(search);
  const runs = useRunList(true, filter, searching);
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
  const everything = runs.data.runs;
  const list = visible;
  const withVideo = runs.data.withVideo;
  const noun = narrow ? 'matching' : '';
  const hasVideoNow = video || parsed.filters.video;
  return (
    <Box aria-label="Runs" component="section" mb="lg">
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
      {(parsed.tokens.length > 0 || parsed.issues.length > 0 || found.status !== 'idle') && (
        <>
          <Flex gap="xs" align="center" wrap="wrap">
            <TypedFilters parsed={parsed} query={search.q ?? ''} onChange={(next) => go({ q: next || undefined }, { replace: true })} />
          </Flex>
          <SearchNotes issues={parsed.issues} semantic={found.status} />
        </>
      )}
      {!everything.length && !narrow && (
        <Text component="div" c="dimmed">
          No runs recorded yet.
        </Text>
      )}
      {everything.length > 0 && (
        <Flex gap="xs" align="center" wrap="wrap" role="status">
          <Text span inherit>
            {runs.data.total > everything.length
              ? `The newest ${everything.length} of ${plural(runs.data.total, 'run', 'runs')} ${noun}`.trim()
              : searching || list.length !== everything.length
                ? `${list.length.toLocaleString()} of ${plural(everything.length, 'run', 'runs')} ${noun}`.trim()
                : `${plural(list.length, 'run', 'runs')} ${noun}`.trim()}
          </Text>
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
        </Flex>
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
              <Table.Tr key={run.key} data-status={run.counts.failed ? 'failed' : run.tests === 0 ? 'not-run' : 'passed'}>
                <Table.Td title={exactTime(run.endedAtMs)}>
                  <Anchor
                    aria-label={`Open run ${runLabel(run)}`}
                    renderRoot={(props) => (
                      <Link {...props} to="/" search={patched({ openRun: run.key, layer: undefined, artifact: undefined, video: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
                    )}
                  >
                    {ago(run.endedAtMs, now)}
                  </Anchor>
                  {run.title && (
                    <Text c="dimmed" fz="xs">
                      {run.title}
                    </Text>
                  )}
                  <WhyMatched hit={found.hits?.get(`runs:${run.key}`)} />
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
  const [watching, setWatching] = useState(false);
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
      renderRoot={(props) => (
        <Link {...props} to="/" search={patched({ openRun: undefined, layer: undefined, artifact: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
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
          {run.tests === 0 ? 'No tests' : plural(run.tests, 'test', 'tests')}
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
      <RunArtifacts detail={detail.data} />
      <Flex gap="xs" align="center" wrap="wrap">
        <Anchor
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
        </Anchor>
        {run.runUrl && (
          <Anchor href={run.runUrl} target="_blank" rel="noreferrer">
            Open the CI run
          </Anchor>
        )}
        {(['base', 'cand'] as const).map((side) => (
          <Anchor
            key={side}
            renderRoot={(props) => (
              <Link {...props} to="/" search={patched({ tab: 'compare', [side]: run.key, openRun: undefined, layer: undefined, artifact: undefined, pair: undefined, video: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
            )}
          >
            {side === 'base' ? 'Compare with this run as the baseline' : 'Compare with this run as the candidate'}
          </Anchor>
        ))}
      </Flex>
      <Flex gap="xs" align="center" wrap="wrap">
        <SearchBox
          label="Search this run"
          placeholder='Search this run… or filter: status:failed has:video "exact phrase"'
          parsed={found.parsed}
          onSearch={(value) => go({ q: value || undefined }, { replace: true })}
        />
      </Flex>
      <SearchNotes issues={found.parsed.issues} semantic={found.status} />
      {(search.q || found.parsed.tokens.length > 0) && (
        <Text role="status" size="sm" c="dimmed">
          {filtered.length.toLocaleString()} of {plural(results.length, 'result', 'results')} match
        </Text>
      )}
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
              {filter.id ? narrowedResults.filter((result) => result.status === filter.id).length : narrowedResults.length}
            </Text>
          </Button>
        ))}
      </Flex>
      {(run.videos || video) && (
        <Flex gap="xs" align="center" wrap="wrap">
          <HasVideo
            count={results.filter((result) => (videoCounts(result.videos)?.recordings ?? 0) > 0).length}
            pressed={video || found.parsed.filters.video}
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
      {filtered.length > 0 && (
        <Button type="button" variant="filled" my="sm" leftSection={<IconPlayerPlay size={16} aria-hidden="true" />} onClick={() => setWatching(true)}>
          Watch these {plural(filtered.length, 'result', 'results')}
        </Button>
      )}
      {watching && <WatchPlaylist entries={playlist} onClose={() => setWatching(false)} />}
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
                      search={patched({ tab: undefined, openRun: undefined, artifact: undefined, test: result.key, layer: result.layer })}
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
