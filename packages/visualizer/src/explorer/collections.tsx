/**
 * @module Collections tab
 *
 * Review collections: named, curated, ordered sets of recorded results frozen from a filtered view, with notes, gaps and
 * reviewed marks. A collection is curation, not a test run: the page says so, never shows one status for the whole,
 * lists every entry with the run, commit and status it was recorded with (so entries from several executions are not read
 * as one), keeps failed, retried and incomplete results beside a later passing replay in the order the curator chose, and
 * keeps an entry whose source is gone in its place with the reason. A reviewed mark and a note change no outcome and are
 * not an approval. Writing needs a token that may publish (kept only in this tab); reading needs only what the report needs.
 */
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import type { ReviewCollectionDetail, ReviewCollectionList, ReviewNote } from '@crvouga/atlas/reports/review-collection';
import type { ArtifactResult } from '@crvouga/atlas/reports/test-catalog';
import { Alert, Anchor, Badge, Button, Group, Modal, NativeSelect, Paper, PasswordInput, Stack, Switch, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconDownload, IconLock, IconPlayerPlay } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';

import { readProblem } from '../evidence/artifact-tags';
import { reportAssetUrl, reportJson, ReportsError } from '../evidence/api';
import { exactTime, plural, shortSha, statusWord } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { formatTimecode, parseTagsField, parseTimecode, sourceSpread } from './collection-model';
import { patched, useExplorerNavigate, useExplorerSearch } from './navigate';
import { runName } from './parts';
import { WatchPlaylist } from './playlist';
import { entriesFromCollection, RECORDING_STATE_TEXT, recordingState } from './playlist-entries';

/** The token that may publish, kept for as long as this page is open and nowhere else. */
let heldToken = '';

/** The publish token this tab holds and a way to change it. */
function usePublishToken(): readonly [string, (token: string) => void] {
  const [token, setToken] = useState(heldToken);
  return [
    token,
    (next) => {
      heldToken = next;
      setToken(next);
    }
  ];
}

/** Sends one change to the server as JSON; resolves with the answer, rejects with the server's reason. */
async function send<T>(path: string, body: unknown, token: string): Promise<T> {
  const response = await fetch(reportAssetUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await readProblem(response));
  return (await response.json()) as T;
}

const TokenField = ({ token, onChange }: { token: string; onChange: (token: string) => void }) => (
  <PasswordInput
    label="Token"
    description="A token that may publish. Kept only in this tab. Not needed on a server without tokens."
    value={token}
    onChange={(event) => onChange(event.currentTarget.value)}
    autoComplete="off"
  />
);

/** The Collections tab: the published collections, or the one the address opens. */
export function CollectionsView() {
  const search = useExplorerSearch();
  return search.collection ? <CollectionPage id={search.collection} revision={search.rev} /> : <CollectionList />;
}

function CollectionList() {
  const answer = useQuery({ queryKey: ['review-collections'], queryFn: ({ signal }) => reportJson<ReviewCollectionList>('/review-collections', signal), retry: false, staleTime: 5000 });
  if (answer.isPending)
    return (
      <Text role="status" component="div" c="dimmed">
        Reading the review collections…
      </Text>
    );
  if (answer.isError) {
    const missing = answer.error instanceof ReportsError && answer.error.status === 404;
    return (
      <Alert role={missing ? 'status' : 'alert'} color={missing ? 'blue' : 'red'} my="sm">
        <Stack gap="xs" align="flex-start">
          <Text>{missing ? 'This server does not keep review collections. Update it to publish and share curated reviews.' : `The review collections could not be read. ${answer.error.message}`}</Text>
          {!missing && (
            <Button type="button" onClick={() => void answer.refetch()}>
              Try again
            </Button>
          )}
        </Stack>
      </Alert>
    );
  }
  const { collections } = answer.data;
  return (
    <Stack component="section" aria-label="Review collections" gap="sm" mb="lg">
      <Text c="dimmed">A review collection is a curated, frozen set of recordings with notes and gaps. It is not a test run and has no status of its own.</Text>
      {collections.length === 0 ? (
        <Text component="div" c="dimmed">
          No review collection has been published yet. Filter the Artifacts tab to the recordings to review and choose Freeze as review collection.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={600}>
          <Table data-collections>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">Collection</Table.Th>
                <Table.Th scope="col">Audience</Table.Th>
                <Table.Th scope="col">Entries</Table.Th>
                <Table.Th scope="col">Gaps</Table.Th>
                <Table.Th scope="col">Revision</Table.Th>
                <Table.Th scope="col">Published</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {collections.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>
                    <Anchor renderRoot={(props) => <Link {...props} to="/" search={patched({ tab: 'collections', collection: item.id, rev: undefined })} resetScroll={false} activeOptions={{ exact: true }} />}>{item.title}</Anchor>
                    {item.purpose && (
                      <Text c="dimmed" fz="xs">
                        {item.purpose}
                      </Text>
                    )}
                    {item.tags.length > 0 && <Text fz="xs">{item.tags.map((tag) => `#${tag}`).join(' ')}</Text>}
                  </Table.Td>
                  <Table.Td>{item.audience ?? '—'}</Table.Td>
                  <Table.Td>{item.entries}</Table.Td>
                  <Table.Td>{item.gaps}</Table.Td>
                  <Table.Td>
                    {item.revision}
                    {item.revisions > 1 ? ` of ${item.revisions}` : ''}
                  </Table.Td>
                  <Table.Td>
                    {item.createdBy}, {exactTime(item.createdAtMs)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}

const AVAILABILITY: Record<'available' | 'unverified' | 'unavailable', { label: string; color: string }> = {
  available: { label: 'Source available', color: 'gray' },
  unverified: { label: 'Source not verified', color: 'yellow' },
  unavailable: { label: 'Source unavailable', color: 'yellow' }
};

function CollectionPage({ id, revision }: { id: string; revision: number | undefined }) {
  const go = useExplorerNavigate();
  const client = useQueryClient();
  const [token, setToken] = usePublishToken();
  const [watching, setWatching] = useState<string | null | false>(false);
  const detail = useQuery({
    queryKey: ['review-collection', id, revision ?? 'newest'],
    queryFn: ({ signal }) => reportJson<ReviewCollectionDetail>(`/review-collections/detail?id=${encodeURIComponent(id)}${revision ? `&revision=${revision}` : ''}`, signal),
    retry: false,
    // How the sources stand is read each time the page opens: a recording may have been collected since.
    staleTime: 0
  });
  const back = (
    <Anchor renderRoot={(props) => <Link {...props} to="/" search={patched({ tab: 'collections', collection: undefined, rev: undefined })} resetScroll={false} activeOptions={{ exact: true }} />}>
      All review collections
    </Anchor>
  );
  if (detail.isPending)
    return (
      <Text role="status" component="div" c="dimmed">
        Reading the review collection…
      </Text>
    );
  if (detail.isError) {
    const missing = detail.error instanceof ReportsError && detail.error.status === 404;
    return (
      <Alert role={missing ? 'status' : 'alert'} color={missing ? 'blue' : 'red'} my="sm">
        <Stack gap="xs" align="flex-start">
          <Text>{missing ? 'No review collection has that address, or that revision of it.' : `The review collection could not be read. ${detail.error.message}`}</Text>
          {!missing && (
            <Button type="button" onClick={() => void detail.refetch()}>
              Try again
            </Button>
          )}
          {back}
        </Stack>
      </Alert>
    );
  }
  const { collection, revisions, availability, reviews, reviewed } = detail.data;
  const newest = revisions.at(-1) ?? collection.revision;
  const spread = sourceSpread(collection);
  const states = new Map(availability.map((item) => [item.entry, item]));
  const playlist = entriesFromCollection(collection, availability);
  const notesOf = (entry: string | undefined) => reviews.filter((note) => note.entry === entry && (note.kind === 'note' || note.kind === 'gap'));
  const record = async (body: Record<string, unknown>) => {
    await send('/review-collections/reviews', { collection: collection.id, revision: collection.revision, ...body }, token);
    await client.invalidateQueries({ queryKey: ['review-collection', id] });
  };
  const exportHref = reportAssetUrl(`/review-collections/export?id=${encodeURIComponent(collection.id)}&revision=${collection.revision}`);
  const shareLink = typeof window === 'undefined' ? '' : window.location.href;
  return (
    <Stack component="section" aria-label="Review collection" gap="md" mb="lg">
      {back}
      <Stack gap="xs">
        <Title order={2}>{collection.title}</Title>
        {collection.purpose && <Text>{collection.purpose}</Text>}
        <Text c="dimmed" component="div">
          {collection.audience ? `For ${collection.audience}. ` : ''}Published by {collection.createdBy}, {exactTime(collection.createdAtMs)}.
          {collection.tags.length > 0 ? ` ${collection.tags.map((tag) => `#${tag}`).join(' ')}` : ''}
        </Text>
        <Group gap="sm" align="flex-end" data-revision={collection.revision}>
          <Badge variant="light" leftSection={<IconLock size={14} aria-hidden="true" />}>
            Frozen, revision {collection.revision} of {newest}
          </Badge>
          {revisions.length > 1 && (
            <NativeSelect
              label="Revision"
              value={String(collection.revision)}
              onChange={(event) => go({ rev: Number(event.currentTarget.value) === newest ? undefined : Number(event.currentTarget.value) })}
              data={revisions.map((value) => ({ value: String(value), label: value === newest ? `${value} (newest)` : String(value) }))}
            />
          )}
        </Group>
      </Stack>
      <Alert color="blue" role="note" data-curation>
        <Text>
          This is a review collection, not a test run. Its {plural(collection.entries.length, 'entry', 'entries')} {collection.entries.length === 1 ? 'was' : 'were'} recorded in {plural(spread.runs, 'run', 'runs')}
          {spread.runs > 1 ? ' and are not one execution' : ''}; each shows the status it was recorded with. Membership and order are fixed: later runs and tag changes do not alter this revision, and a change is a new revision.
          Notes and reviewed marks are curation. They do not change any result and are not an approval.
          {revision && revision !== newest ? ` You are reading revision ${collection.revision}; revision ${newest} is newer.` : ''}
        </Text>
      </Alert>
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Button type="button" variant="filled" leftSection={<IconPlayerPlay size={16} aria-hidden="true" />} onClick={() => setWatching(null)} disabled={collection.entries.length === 0}>
          Watch these {plural(collection.entries.length, 'entry', 'entries')}
        </Button>
        <Button component="a" href={exportHref} download leftSection={<IconDownload size={16} aria-hidden="true" />}>
          Download manifest
        </Button>
        <TextInput label="Share link" description="Opening it needs the same read access as this report." value={shareLink} readOnly onFocus={(event) => event.currentTarget.select()} miw={280} />
      </Group>
      <TokenField token={token} onChange={setToken} />
      {watching !== false && <WatchPlaylist title={collection.title} entries={playlist} initial={watching ?? undefined} onClose={() => setWatching(false)} />}
      {notesOf(undefined).length > 0 && (
        <Stack gap="xs" component="section" aria-label="Notes on the collection">
          <Title order={3}>Notes on the collection</Title>
          {notesOf(undefined).map((note) => (
            <NoteLine key={note.id} note={note} />
          ))}
        </Stack>
      )}
      {collection.entries.length === 0 && <Text c="dimmed">This revision has no entries, only gaps.</Text>}
      <Stack gap="md" data-entries>
        {collection.gaps.filter((gap) => gap.after === 0).map((gap) => <GapItem key={gap.id} note={gap.note} />)}
        {collection.entries.map((entry, index) => {
          const playable = playlist[index]!;
          const standing = states.get(entry.id);
          const mark = reviewed[entry.id];
          const notes = notesOf(entry.id);
          const state = recordingState(playable);
          const tries = entry.snapshot.attemptStatuses ?? [];
          return (
            <Stack key={entry.id} gap="md">
              <Paper withBorder p="md" component="section" aria-label={`Entry ${index + 1}: ${entry.snapshot.title}`} data-entry={entry.id} data-status={entry.snapshot.status} data-availability={standing?.state ?? 'unverified'}>
                <Stack gap="xs">
                  <Group justify="space-between" align="flex-start" wrap="wrap">
                    <Title order={3}>
                      {index + 1}.{' '}
                      <Anchor
                        inherit
                        renderRoot={(props) => (
                          <Link {...props} to="/" search={patched({ tab: undefined, openRun: undefined, collection: undefined, rev: undefined, test: entry.snapshot.testKey, layer: entry.source.layer })} resetScroll={false} activeOptions={{ exact: true }} />
                        )}
                      >
                        {entry.snapshot.title}
                      </Anchor>
                    </Title>
                    <Group gap="xs">
                      <Text span>
                        <StatusMark status={entry.snapshot.status} size={14} /> {statusWord(entry.snapshot.status)} as recorded
                      </Text>
                      <Badge variant="outline" color={AVAILABILITY[standing?.state ?? 'unverified'].color}>
                        {AVAILABILITY[standing?.state ?? 'unverified'].label}
                      </Badge>
                    </Group>
                  </Group>
                  {entry.caption && <Text>{entry.caption}</Text>}
                  <Text c="dimmed" fz="sm" component="div">
                    Recorded {exactTime(entry.snapshot.recordedAtMs)} · {environmentLabel(entry.snapshot.environment)} · {entry.snapshot.producer} · run {runName(entry.snapshot.run)}
                    {entry.snapshot.sha ? ` · commit ${shortSha(entry.snapshot.sha)}` : ''}
                    {entry.snapshot.branch ? ` · ${entry.snapshot.branch}` : ''} · layer {entry.source.layer.slice(0, 12)}
                  </Text>
                  {tries.length > 0 && (
                    <Text fz="sm" component="div" data-tries>
                      Tries, in order: {tries.map((status) => statusWord(status)).join(', then ')}
                    </Text>
                  )}
                  {standing && standing.state !== 'available' && (
                    <Alert color="yellow" role="status" title={standing.state === 'unavailable' ? 'This source is no longer available' : 'This source could not be verified'}>
                      {standing.reason} What it was when frozen is kept here.
                    </Alert>
                  )}
                  <Group gap="sm" align="center">
                    <Text span fz="sm" c="dimmed">
                      {RECORDING_STATE_TEXT[state].label}
                    </Text>
                    {state === 'playable' && (
                      <Button type="button" size="compact-sm" variant="light" leftSection={<IconPlayerPlay size={14} aria-hidden="true" />} onClick={() => setWatching(entry.id)}>
                        Watch entry {index + 1}
                      </Button>
                    )}
                  </Group>
                  <ReviewControls
                    entry={entry.id}
                    label={`entry ${index + 1}`}
                    reviewed={mark}
                    notes={notes}
                    onMark={(on) => record({ entry: entry.id, kind: on ? 'reviewed' : 'unreviewed' })}
                    onNote={(body) => record({ entry: entry.id, ...body })}
                  />
                </Stack>
              </Paper>
              {collection.gaps.filter((gap) => gap.after === index + 1).map((gap) => <GapItem key={gap.id} note={gap.note} />)}
            </Stack>
          );
        })}
      </Stack>
    </Stack>
  );
}

const GapItem = ({ note }: { note: string }) => (
  <Alert color="gray" title="Gap" data-gap role="note">
    {note}
  </Alert>
);

function NoteLine({ note }: { note: ReviewNote }) {
  return (
    <Text fz="sm" component="div" data-note={note.kind}>
      <Badge size="sm" variant="light" color={note.kind === 'gap' ? 'orange' : 'gray'} mr="xs">
        {note.kind === 'gap' ? 'Gap' : 'Note'}
      </Badge>
      {note.timecodeMs !== undefined && <Text span fw={600}>{formatTimecode(note.timecodeMs)} </Text>}
      {note.text}{' '}
      <Text span c="dimmed" inherit>
        {note.by}, {exactTime(note.atMs)}
      </Text>
    </Text>
  );
}

/** The reviewed mark, the notes of one entry and the form for a new one. Each change is a new record with who and when. */
function ReviewControls({
  entry: _entry,
  label,
  reviewed,
  notes,
  onMark,
  onNote
}: {
  entry: string;
  /** What a person calls it: `entry 2`. */
  label: string;
  reviewed: { by: string; atMs: number } | undefined;
  notes: readonly ReviewNote[];
  onMark: (on: boolean) => Promise<unknown>;
  onNote: (body: { kind: 'note' | 'gap'; text: string; timecodeMs?: number }) => Promise<unknown>;
}) {
  const [text, setText] = useState('');
  const [time, setTime] = useState('');
  const [gap, setGap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const timecode = parseTimecode(time);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      return true;
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (timecode === undefined || !text.trim()) return;
    if (await run(() => onNote({ kind: gap ? 'gap' : 'note', text, ...(timecode === null ? {} : { timecodeMs: timecode }) }))) {
      setText('');
      setTime('');
      setGap(false);
    }
  };
  return (
    <Stack gap="xs" role="group" aria-label={`Review of ${label}`}>
      <Switch
        label="Reviewed"
        description={reviewed ? `Marked reviewed by ${reviewed.by}, ${exactTime(reviewed.atMs)}. This is curation, not an outcome or an approval.` : 'Not marked reviewed. A mark is curation, not an outcome or an approval.'}
        checked={!!reviewed}
        disabled={busy}
        onChange={(event) => void run(() => onMark(event.currentTarget.checked))}
      />
      {notes.map((note) => (
        <NoteLine key={note.id} note={note} />
      ))}
      <form onSubmit={(event) => void submit(event)} aria-label={`Add a note to ${label}`}>
        <Group align="flex-end" gap="sm" wrap="wrap">
          <Textarea label="Note" value={text} onChange={(event) => setText(event.currentTarget.value)} autosize minRows={1} maxLength={4000} miw={240} />
          <TextInput
            label="Time in the recording"
            description="m:ss, optional"
            value={time}
            onChange={(event) => setTime(event.currentTarget.value)}
            error={timecode === undefined ? 'Use m:ss, like 1:15, or seconds.' : undefined}
            w={160}
          />
          <Switch label="This is a gap" description="Something missing or unclear" checked={gap} onChange={(event) => setGap(event.currentTarget.checked)} />
          <Button type="submit" loading={busy} disabled={!text.trim() || timecode === undefined}>
            Add note
          </Button>
        </Group>
      </form>
      {problem && (
        <Alert role="alert" color="red">
          {problem}
        </Alert>
      )}
    </Stack>
  );
}

/**
 * The dialog that freezes the results of a filtered view as a review collection: a title, purpose, audience and tags, and
 * the token that may publish. The entries are the results as the page lists them, in that order, from whichever runs they
 * were recorded in. Resolves to the new collection's address by opening it.
 */
export function FreezeCollection({ results, total, filterQuery, onClose }: { results: readonly ArtifactResult[]; total: number; filterQuery: string; onClose: () => void }) {
  const go = useExplorerNavigate();
  const client = useQueryClient();
  const [token, setToken] = usePublishToken();
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [audience, setAudience] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const runs = new Set(results.map((result) => result.run)).size;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await send<{ id: string }>(
        '/review-collections',
        {
          title,
          ...(purpose.trim() ? { purpose } : {}),
          ...(audience.trim() ? { audience } : {}),
          tags: parseTagsField(tags),
          ...(filterQuery ? { frozenFrom: filterQuery } : {}),
          entries: results.map((result) => ({ layer: result.layer, check: result.id, kind: result.kind }))
        },
        token
      );
      await client.invalidateQueries({ queryKey: ['review-collections'] });
      onClose();
      go({ tab: 'collections', collection: made.id, rev: undefined, test: undefined, openRun: undefined, layer: undefined });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title="Freeze as review collection" size="lg" centered>
      <form onSubmit={(event) => void submit(event)} aria-label="Freeze as review collection">
        <Stack gap="sm">
          <Text role="status" component="div" data-freeze-summary>
            {plural(results.length, 'result', 'results')} from {plural(runs, 'run', 'runs')}, in the order listed
            {total > results.length ? ` (the newest of ${total.toLocaleString()} matching)` : ''}. Failed and incomplete results stay in. Later runs and tag changes will not alter the collection; a change is a new revision.
          </Text>
          <TextInput label="Title" required value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={200} data-autofocus />
          <Textarea label="Purpose" description="Why this review exists" value={purpose} onChange={(event) => setPurpose(event.currentTarget.value)} autosize minRows={2} maxLength={2000} />
          <TextInput label="Audience" description="Who should review it" value={audience} onChange={(event) => setAudience(event.currentTarget.value)} maxLength={500} />
          <TextInput label="Tags" description="Such as demo, separated by commas" value={tags} onChange={(event) => setTags(event.currentTarget.value)} />
          <TokenField token={token} onChange={setToken} />
          {problem && (
            <Alert role="alert" color="red">
              {problem}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button type="button" variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="filled" loading={busy} disabled={!title.trim() || results.length === 0}>
              Freeze {plural(results.length, 'result', 'results')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
