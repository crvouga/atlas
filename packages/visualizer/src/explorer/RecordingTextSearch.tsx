/**
 * @module Search inside recordings
 *
 * Finds words that were spoken or shown on screen in the recordings of the Artifacts tab, from the text their producers
 * supplied (WebVTT, SubRip, timed JSON, a transcript; see `recording-text.ts`). It is the shared search (`find/`) applied
 * to the indexed segments, so phrases, misspellings, filters typed in the box and meaning-based matches behave as in every
 * other search box, and a result always shows the words as indexed, never a reworded quotation.
 *
 * Nothing is read until words are typed. Then, a few at a time, each listed result's evidence is read through the same
 * report API that plays its recording, and so under the same access rules: a file the viewer may not read is never
 * indexed, appears in no snippet or count, and is reported as a recording that could not be searched. The index lives
 * in this page only; there is no stored or cross-project index. "No match" is said only about recordings whose text was
 * searched: recordings with no text, silent ones and unreadable text are listed apart, each in its own words. A
 * match finds a moment; it says nothing about whether the behavior passed, and the result's own outcome stays beside it.
 */
import { Accordion, Alert, Anchor, Badge, Button, Group, Highlight, List, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ReportsError, reportText } from '../evidence/api';
import { attachmentSource } from '../evidence/artifacts';
import { plural, statusWord } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { useDocSearch } from '../find/doc-search';
import { passesFilters } from '../find/query';
import type { Ranked } from '../find/rank';
import { patched, useExplorerNavigate, useExplorerSearch } from './navigate';
import { entryDetailQuery, WatchPlaylist } from './playlist';
import { recordingState, type PlaylistEntry } from './playlist-entries';
import {
  coverageCounts,
  coverageOf,
  focusOf,
  indexTrack,
  rangeWord,
  segmentDoc,
  segmentsOf,
  TEXT_KIND_WORD,
  tracksOf,
  trackReadable,
  uncertaintyWord,
  unreadTrack,
  type IndexedSegment,
  type RecordingFocus,
  type TrackResult,
  type VideoCoverage
} from './recording-text';
import { SearchNotes, TypedFilters } from './search-notes';
import type { CheckDetail } from '@crvouga/atlas/reports/evidence-detail';

/** Results listed before "more". */
const LISTED = 10;
/** Results read at once. */
const READERS = 4;

/** What was learned about one result's recordings. */
type Read =
  | { readonly state: 'read'; readonly videos: readonly VideoCoverage[]; readonly segments: readonly IndexedSegment[] }
  | { readonly state: 'unreadable'; readonly reason: string };

function problem(error: unknown): string {
  if (error instanceof ReportsError) {
    if (error.status === 401 || error.status === 403) return 'You are not permitted to read this, so it is not searched.';
    if (error.status === 404) return 'It is not in the report store, so it is not searched.';
  }
  return error instanceof Error ? error.message : 'It could not be read.';
}

/**
 * Reads, once `enabled`, the text tracks of each result that has a recording, a few results at a time. What is read lands
 * as it arrives; `read` of `total` say how far it is.
 */
function useRecordingText(entries: readonly PlaylistEntry[], enabled: boolean) {
  const client = useQueryClient();
  const cache = useRef(new Map<string, Read>());
  const [reads, setReads] = useState<ReadonlyMap<string, Read>>(() => new Map());
  const playable = useMemo(() => entries.filter((entry) => recordingState(entry) === 'playable' && entryDetailQuery(entry) !== null), [entries]);
  const key = playable.map((entry) => entry.id).join('\n');
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const wanted = playable.filter((entry) => !cache.current.has(entry.id));
    let cursor = 0;
    const readTrack = async (entry: PlaylistEntry, track: ReturnType<typeof tracksOf>[number]): Promise<TrackResult> => {
      const readable = trackReadable(track);
      if (!readable.readable) return { track, state: readable.state, reason: readable.reason, segments: [], timing: 'absent', truncated: false };
      const attachment = track.attachment;
      if (attachment.text !== undefined) return indexTrack(track, attachment.text);
      const path = attachmentSource(attachment, entry.layer).path;
      if (!path) return unreadTrack(track, 'The text names no stored file.');
      try {
        return indexTrack(track, await client.fetchQuery({ queryKey: ['artifact-text', path], queryFn: ({ signal }) => reportText(path, signal), staleTime: Number.POSITIVE_INFINITY, retry: false }));
      } catch (error) {
        return unreadTrack(track, problem(error));
      }
    };
    const readEntry = async (entry: PlaylistEntry): Promise<Read> => {
      let detail: CheckDetail;
      try {
        detail = await client.fetchQuery(entryDetailQuery(entry)!);
      } catch (error) {
        return { state: 'unreadable', reason: `Its evidence could not be read. ${problem(error)}` };
      }
      const results: TrackResult[] = [];
      for (const track of tracksOf(detail)) results.push(await readTrack(entry, track));
      const videos = coverageOf(detail, results);
      return { state: 'read', videos, segments: segmentsOf(entry, detail, results, videos) };
    };
    const pull = async () => {
      for (;;) {
        const entry = wanted[cursor++];
        if (entry === undefined || cancelled) return;
        const done = await readEntry(entry);
        if (cancelled) return;
        cache.current.set(entry.id, done);
        setReads(new Map(cache.current));
      }
    };
    void Promise.all(Array.from({ length: READERS }, pull));
    return () => {
      cancelled = true;
    };
  }, [client, enabled, key, playable]);
  const read = useMemo(() => playable.filter((entry) => reads.has(entry.id)).length, [playable, reads]);
  return { reads, playable, read, total: playable.length };
}

/** Why a segment is in the results, in words that do not claim more than was matched. */
function why(hit: Ranked): string {
  if (hit.exact && hit.literals?.length) return `Exact: ${hit.literals.map((literal) => `“${literal}”`).join(', ')}`;
  if (hit.semantic) return 'Similar meaning to the indexed words';
  if (hit.fuzzy) return 'Close spelling of the indexed words';
  if (hit.partial) return 'Some of the words are in the indexed text';
  return 'The words are in the indexed text';
}

const COVERAGE_WORD = { 'not-indexed': 'Not indexed', unsupported: 'Unsupported', failed: 'Failed', searched: 'Searched' } as const;
const COVERAGE_COLOR = { 'not-indexed': 'gray', unsupported: 'orange', failed: 'red', searched: 'green' } as const;

/** A recording that was not searched, and why. */
type Unsearched = { readonly key: string; readonly entry: PlaylistEntry; readonly name: string | null; readonly attempt: string; readonly state: 'not-indexed' | 'unsupported' | 'failed'; readonly reason: string };

/** The Artifacts tab's search of the words in its recordings. `entries` are the listed results; `total` how many matched the filters. */
export function RecordingTextSearch({ entries, total }: { entries: readonly PlaylistEntry[]; total: number }) {
  const search = useExplorerSearch();
  const go = useExplorerNavigate();
  const [draft, setDraft] = useState(search.inside ?? '');
  useEffect(() => setDraft((current) => (current.trim() === (search.inside ?? '').trim() ? current : (search.inside ?? ''))), [search.inside]);
  const [shown, setShown] = useState(LISTED);
  const [opened, setOpened] = useState<RecordingFocus | null>(null);
  const query = search.inside;
  const { reads, playable, read, total: readable } = useRecordingText(entries, !!query);
  const items = useMemo(() => [...reads.values()].flatMap((item) => (item.state === 'read' ? item.segments : [])), [reads]);
  const docs = useMemo(() => items.map(segmentDoc), [items]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item] as const)), [items]);
  const found = useDocSearch(docs, query);
  const matches = useMemo(() => (found.hits ? [...found.hits.values()].filter((hit) => passesFilters(hit.doc.facets, found.parsed.filters)) : null), [found.hits, found.parsed.filters]);
  const unsearched = useMemo<Unsearched[]>(() => {
    const out: Unsearched[] = [];
    for (const entry of playable) {
      const item = reads.get(entry.id);
      if (!item) continue;
      if (item.state === 'unreadable') out.push({ key: entry.id, entry, name: null, attempt: '', state: 'failed', reason: item.reason });
      else
        for (const video of item.videos)
          if (video.state !== 'searched') out.push({ key: `${entry.id}|${video.name}|${video.attempt}`, entry, name: video.name, attempt: video.attempt === null ? '' : `Attempt ${video.attempt + 1}`, state: video.state, reason: video.reason });
      // A recording the evidence lists no video for, though the catalog does, is counted as not indexed.
      if (item.state === 'read' && item.videos.length === 0) out.push({ key: `${entry.id}|none`, entry, name: null, attempt: '', state: 'not-indexed', reason: 'The recording could not be matched to any text.' });
    }
    return out;
  }, [playable, reads]);
  const videos = useMemo(() => [...reads.values()].flatMap((item) => (item.state === 'read' ? item.videos : [])), [reads]);
  const counts = useMemo(() => coverageCounts(videos), [videos]);
  const waiting = !!query && read < readable;
  const noRecording = entries.length - playable.length;
  const results = matches?.slice(0, shown) ?? [];
  const resultEntries = new Set((matches ?? []).map((hit) => byId.get(hit.doc.id)?.entry.id));
  const set = (value: string) => {
    setDraft(value);
    setShown(LISTED);
    go({ inside: value.trim() || undefined }, { replace: true });
  };
  return (
    <Stack component="section" aria-label="Search inside recordings" gap="xs" my="md" data-recording-text>
      <Title order={2}>Search inside recordings</Title>
      <Text c="dimmed">
        Find words that were spoken or shown on screen, from the transcripts, captions and screen text that producers supplied with the recordings listed here. A match finds a moment; it does not show that the behavior
        passed.
      </Text>
      <Group gap="xs" align="center" wrap="wrap">
        <TextInput type="search" aria-label="Words spoken or shown" placeholder="delivery address" value={draft} miw={{ base: '100%', sm: '20rem' }} onChange={(event) => set(event.target.value)} />
        <TypedFilters parsed={found.parsed} query={draft} onChange={set} />
      </Group>
      <SearchNotes issues={found.parsed.issues} semantic={found.status} />
      {!query && (
        <Text component="div" c="dimmed">
          Type words to search. Nothing is read from the recordings until you do, and only the text supplied with them is read, never the video.
        </Text>
      )}
      {query && (
        <Stack gap="xs">
          <Text role="status" component="div" data-reading>
            {waiting
              ? `Reading the text of recordings: ${read} of ${readable}.`
              : `Searched the text of ${plural(counts.searched, 'recording', 'recordings')}.`}
            {total > entries.length ? ` Only the newest ${entries.length} of ${total.toLocaleString()} results are listed, so only they are searched.` : ''}
            {noRecording > 0 ? ` ${plural(noRecording, 'result has', 'results have')} no playable recording and ${noRecording === 1 ? 'is' : 'are'} not searched.` : ''}
          </Text>
          <Group gap="xs" aria-label="Coverage" role="group" data-coverage>
            {(['searched', 'not-indexed', 'unsupported', 'failed'] as const).map((state) => (
              <Badge key={state} color={COVERAGE_COLOR[state]} variant="light" data-coverage-state={state}>
                {COVERAGE_WORD[state]}: {counts[state] + (state === 'failed' ? unsearched.filter((item) => item.name === null && item.state === 'failed').length : 0)}
              </Badge>
            ))}
          </Group>
        </Stack>
      )}
      {query && matches === null && (
        <Text component="div" c="dimmed">
          Add words to search for. Filters alone do not match any text.
        </Text>
      )}
      {query && matches && matches.length === 0 && (
        <Alert role="status" color={waiting ? 'blue' : 'gray'} data-no-match={waiting ? undefined : true}>
          {waiting
            ? 'No match yet. Some recordings are still being read, so this is not the final answer.'
            : counts.searched === 0
              ? 'Nothing was searched: no listed recording has text that can be searched. Recordings without it are listed below.'
              : `No indexed text matches. ${plural(counts.searched, 'recording was', 'recordings were')} searched.${unsearched.length > 0 ? ` ${plural(unsearched.length, 'recording was', 'recordings were')} not searched (listed below), so this says nothing about ${unsearched.length === 1 ? 'it' : 'them'}.` : ''}`}
        </Alert>
      )}
      {matches && matches.length > 0 && (
        <Stack gap="xs">
          <Text role="status" component="div" data-match-count>
            {plural(matches.length, 'match', 'matches')} in {plural(resultEntries.size, 'result', 'results')}. The outcome is the result&apos;s own; a match does not change it.
          </Text>
          <Table.ScrollContainer minWidth={760}>
            <Table data-recording-matches>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th scope="col">Indexed text</Table.Th>
                  <Table.Th scope="col">Source</Table.Th>
                  <Table.Th scope="col">Time</Table.Th>
                  <Table.Th scope="col">Result</Table.Th>
                  <Table.Th scope="col">Outcome</Table.Th>
                  <Table.Th scope="col">Open</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {results.map((hit) => {
                  const item = byId.get(hit.doc.id);
                  if (!item) return null;
                  return (
                    <Table.Tr key={hit.doc.id} data-match={hit.doc.id} data-source-kind={item.kind} data-status={item.entry.status}>
                      <Table.Td maw="28rem">
                        <Highlight highlight={[...found.parsed.words, ...found.parsed.phrases]} component="div">
                          {item.segment.text}
                        </Highlight>
                        <Text c="dimmed" size="xs" data-why>
                          {why(hit)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text component="div">{TEXT_KIND_WORD[item.kind]}</Text>
                        {item.generated && (
                          <Text c="orange.8" size="xs" component="div" data-generated>
                            {uncertaintyWord(item)}
                          </Text>
                        )}
                        {!item.generated && item.segment.confidence !== undefined && (
                          <Text c="dimmed" size="xs" component="div">
                            Confidence {Math.round(item.segment.confidence * 100)}%
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td data-time>{rangeWord(item)}</Table.Td>
                      <Table.Td>
                        <Anchor
                          aria-label={`Open ${item.entry.title} as recorded`}
                          renderRoot={(props) => (
                            <Link {...props} to="/" search={patched({ tab: undefined, openRun: undefined, test: item.entry.key, layer: item.entry.layer })} resetScroll={false} activeOptions={{ exact: true }} />
                          )}
                        >
                          {item.entry.title}
                        </Anchor>
                        <Text c="dimmed" size="xs" component="div">
                          {[item.entry.producer, item.videoName, item.attemptLabel].filter(Boolean).join(' · ')}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <StatusMark status={item.entry.status} size={14} /> {statusWord(item.entry.status)}
                      </Table.Td>
                      <Table.Td>
                        <Button
                          type="button"
                          size="compact-sm"
                          variant="light"
                          leftSection={<IconPlayerPlay size={16} aria-hidden="true" />}
                          aria-label={`Open the recording of ${item.entry.title}${item.attemptLabel ? `, ${item.attemptLabel}` : ''} at ${rangeWord(item)}`}
                          onClick={() => setOpened(focusOf(item))}
                        >
                          {item.segment.startMs === null ? 'Open recording' : 'Open here'}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {matches.length > results.length && (
            <Button type="button" variant="subtle" onClick={() => setShown(shown + LISTED)}>
              Show more ({matches.length - results.length} more)
            </Button>
          )}
        </Stack>
      )}
      {query && unsearched.length > 0 && (
        <Accordion variant="separated">
          <Accordion.Item value="unsearched">
            <Accordion.Control>Recordings that were not searched ({unsearched.length})</Accordion.Control>
            <Accordion.Panel>
              <Text c="dimmed" mb="xs">
                These are not &quot;no match&quot;: their words were never searched.
              </Text>
              <List spacing="xs" listStyleType="none" aria-label="Recordings that were not searched">
                {unsearched.map((item) => (
                  <List.Item key={item.key} data-unsearched={item.state}>
                    <Group gap="xs" wrap="wrap">
                      <Badge color={COVERAGE_COLOR[item.state]} variant="light">
                        {COVERAGE_WORD[item.state]}
                      </Badge>
                      <Text span inherit fw={600}>
                        {item.entry.title}
                      </Text>
                      <Text span inherit c="dimmed">
                        {[item.name, item.attempt].filter(Boolean).join(' · ')}
                      </Text>
                    </Group>
                    <Text c="dimmed" size="sm">
                      {item.reason}
                    </Text>
                  </List.Item>
                ))}
              </List>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
      {opened && <WatchPlaylist entries={entries} total={total} focus={opened} onClose={() => setOpened(null)} />}
    </Stack>
  );
}
