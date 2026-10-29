/**
 * @module Watch playlist
 *
 * A watch session over a filtered set of recorded results: the player and the plain-language scenario beside an ordered
 * list of every result in the set. A failed result stays in the list with its outcome, and a result with no recording,
 * an API-only one or one whose file is missing says so in words instead of being left out or shown as demonstrated.
 *
 * Only the clip on screen is read: the list is made of the metadata the catalog already sent, the current result's
 * evidence is read when it is selected, and its video is loaded with `preload="metadata"`, so opening the playlist of a
 * large library downloads no recordings in bulk. There is one `<video>`; selecting another clip replaces it and keeps
 * the position of the one left, so returning resumes there. A clip that will not load (or whose autoplay the browser
 * blocked) stays in the list and offers Retry, Play and Next. Recordings are always labelled illustrative: playback
 * length and speed are those of the recording, never production latency.
 */
import { attachmentIdentity, isVideoAttachment, type CheckDetail } from '@crvouga/atlas/reports/evidence-detail';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { contentTypeOf } from '@crvouga/atlas/reports/media-types';
import { Alert, Anchor, Badge, Box, Button, Code, Flex, Grid, Group, List, Modal, NativeSelect, Stack, Switch, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconPlayerPlay, IconPlayerSkipBack, IconPlayerSkipForward } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { reportJson } from '../evidence/api';
import { attachmentSource } from '../evidence/artifacts';
import { everyAttachment } from '../evidence/artifact-tags';
import { ScopeNotice } from '../evidence/evidence-scope';
import { duration, exactTime, plural, statusWord } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { patched } from './navigate';
import { playableVideo, playlistCounts, RECORDING_STATE_TEXT, recordingState, stepFrom, type PlaylistEntry } from './playlist-entries';

/** Entries listed before "more"; the selected entry is always listed. */
const LISTED = 50;
/** Playback speeds offered. */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** Step names are shown with their Gherkin keyword when they have one. */
const KEYWORDS = new Set(['given', 'when', 'then', 'and', 'but']);

/** The evidence of one entry's check, read when the entry is on screen. */
function useEntryDetail(entry: PlaylistEntry, enabled: boolean) {
  return useQuery({
    queryKey: ['evidence-detail', entry.backend ?? '', entry.layer, entry.kind ?? '', entry.check],
    queryFn: ({ signal }) =>
      reportJson<CheckDetail>(
        `/evidence/detail/${encodeURIComponent(entry.backend!)}/${encodeURIComponent(entry.layer)}?check=${encodeURIComponent(entry.check)}${entry.kind ? `&kind=${encodeURIComponent(entry.kind)}` : ''}`,
        signal
      ),
    enabled: enabled && entry.backend !== null && /^[0-9a-f]{64}$/.test(entry.layer),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
}

/** The scenario in words: the steps the producer recorded, with the Gherkin keyword where it gave one. */
function Scenario({ entry, detail }: { entry: PlaylistEntry; detail: CheckDetail | undefined }) {
  const steps = detail?.check.steps ?? [];
  return (
    <Stack gap="xs" component="section" aria-label="Scenario">
      <Title order={3}>{entry.title}</Title>
      {steps.length > 0 && (
        <List type="ordered" spacing="xs" aria-label="Steps">
          {steps.map((step, index) => (
            <List.Item key={`${step.id ?? step.name}:${index}`}>
              {step.kind && KEYWORDS.has(step.kind.toLowerCase()) ? `${step.kind.charAt(0).toUpperCase()}${step.kind.slice(1).toLowerCase()} ` : ''}
              {step.name}
              {step.status && step.status !== 'passed' ? ` (${step.status})` : ''}
            </List.Item>
          ))}
        </List>
      )}
      {entry.status === 'failed' && detail?.check.detail && (
        <Alert color="red" title="Why it failed" role="status">
          <Text component="div" lineClamp={4}>
            {detail.check.detail}
          </Text>
        </Alert>
      )}
    </Stack>
  );
}

/** Who recorded the entry and what it carries, in one line each. */
function Facts({ entry }: { entry: PlaylistEntry }) {
  return (
    <Stack gap="xs" aria-label="Recording facts">
      <Group gap="xs" wrap="wrap">
        <StatusMark status={entry.status} size={14} />
        <Text span inherit fw={600} data-outcome={entry.status}>
          {statusWord(entry.status)}
        </Text>
        <Text span inherit c="dimmed">
          {[environmentLabel(entry.environment), entry.producer, `recorded ${exactTime(entry.at)}`].join(' · ')}
        </Text>
      </Group>
      {entry.tags.length > 0 && (
        <Group gap="xs" aria-label="Tags">
          {entry.tags.map((tag) => (
            <Badge key={tag} variant="light" tt="none">
              #{tag}
            </Badge>
          ))}
        </Group>
      )}
      {entry.specPath && (
        <Text component="div" c="dimmed">
          Spec <Code>{entry.specPath}</Code>
        </Text>
      )}
    </Stack>
  );
}

/** The one player. It is keyed by its entry, so a new clip is a fresh element and the previous one is gone. */
function Clip({
  entry,
  speed,
  autoPlay,
  positions,
  onEnded,
  onFailed,
  onNext,
  onClose
}: {
  entry: PlaylistEntry;
  speed: number;
  autoPlay: boolean;
  positions: Map<string, number>;
  onEnded: () => PlaylistEntry | null;
  onFailed: (id: string) => void;
  onNext: (() => void) | null;
  onClose: () => void;
}) {
  const state = recordingState(entry);
  const detail = useEntryDetail(entry, state === 'playable');
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const chosen = playableVideo(entry);
  const attachments = useMemo(() => (detail.data ? everyAttachment(detail.data.check) : []), [detail.data]);
  const movie = useMemo(() => {
    const videos = attachments.filter(isVideoAttachment);
    return videos.find((item) => attachmentIdentity(item) === chosen?.recording) ?? videos[0];
  }, [attachments, chosen]);
  const captions = useMemo(
    () => attachments.filter((item) => (item.contentType ?? contentTypeOf(item.name)).toLowerCase().startsWith('text/vtt')),
    [attachments]
  );
  const url = movie ? attachmentSource(movie, entry.layer).url : null;

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed]);

  const play = () => {
    const element = video.current;
    if (!element) return;
    setBlocked(false);
    // `play()` rejects when the browser blocks it; a browser without a promise has nothing to catch.
    const started = element.play() as Promise<void> | undefined;
    started?.catch(() => setBlocked(true));
  };

  const developer = (
    <Anchor
      renderRoot={(props) => (
        <Link {...props} to="/" search={patched({ tab: undefined, openRun: undefined, artifact: undefined, test: entry.key, layer: entry.layer })} resetScroll={false} activeOptions={{ exact: true }} onClick={onClose} />
      )}
    >
      Developer details
    </Anchor>
  );

  let body;
  if (state !== 'playable') {
    body = (
      <Alert color="orange" title={RECORDING_STATE_TEXT[state].label} icon={<IconAlertTriangle size={16} aria-hidden="true" />} role="status" data-recording-state={state}>
        {RECORDING_STATE_TEXT[state].meaning}
      </Alert>
    );
  } else if (detail.isPending) {
    body = (
      <Text role="status" component="div" c="dimmed">
        Loading the recording…
      </Text>
    );
  } else if (detail.isError || !url) {
    body = (
      <Alert role="alert" color="orange" title="This recording cannot be played" data-clip-failed>
        <Stack gap="xs" align="flex-start">
          <Text component="div">{detail.isError ? 'Its evidence could not be read.' : 'The result names a recording, but no file can be played from here.'}</Text>
          <Group gap="xs">
            {detail.isError && (
              <Button type="button" variant="light" onClick={() => void detail.refetch()}>
                Try again
              </Button>
            )}
            {onNext && (
              <Button type="button" variant="light" onClick={onNext}>
                Next clip
              </Button>
            )}
          </Group>
        </Stack>
      </Alert>
    );
  } else {
    body = (
      <Stack gap="xs">
        <ScopeNotice scope={chosen?.scope} name={movie!.name} />
        <Box
          key={attempt}
          component="video"
          ref={video}
          src={url}
          controls
          preload="metadata"
          aria-label={`Recording: ${movie!.description ?? movie!.name}`}
          maw="100%"
          w="100%"
          mah="70vh"
          data-playing={entry.id}
          onLoadedMetadata={() => {
            const element = video.current!;
            element.playbackRate = speed;
            const saved = positions.get(entry.id);
            if (saved !== undefined && saved < (element.duration || Number.POSITIVE_INFINITY)) element.currentTime = saved;
            if (autoPlay) play();
          }}
          onTimeUpdate={() => positions.set(entry.id, video.current!.currentTime)}
          onEnded={() => {
            positions.delete(entry.id);
            const next = onEnded();
            if (next && next.id === entry.id && video.current) {
              video.current.currentTime = 0;
              play();
            }
          }}
          onError={() => {
            setFailed(true);
            onFailed(entry.id);
          }}
        >
          {captions.map((caption) => {
            const source = attachmentSource(caption, entry.layer).url;
            return source ? <track key={source} kind="captions" src={source} label={caption.description ?? caption.name} /> : null;
          })}
        </Box>
        {movie!.durationMs ? (
          <Text component="div" c="dimmed">
            Length of the recording: {duration(movie!.durationMs)}
          </Text>
        ) : null}
        {captions.length > 0 && (
          <Text component="div" c="dimmed">
            Captions are offered in the player's captions control: {captions.map((caption) => caption.description ?? caption.name).join(', ')}.
          </Text>
        )}
        {blocked && (
          <Alert color="blue" role="status" title="Autoplay was blocked" data-autoplay-blocked>
            <Stack gap="xs" align="flex-start">
              <Text component="div">The browser did not start this clip by itself. Play it to continue.</Text>
              <Button type="button" leftSection={<IconPlayerPlay size={16} aria-hidden="true" />} onClick={play}>
                Play
              </Button>
            </Stack>
          </Alert>
        )}
        {failed && (
          <Alert color="orange" role="alert" title="This video cannot be played" data-clip-failed>
            <Stack gap="xs" align="flex-start">
              <Text component="div">The file could not be loaded, or this browser cannot play its format. It stays in the playlist.</Text>
              <Group gap="xs">
                <Button
                  type="button"
                  variant="light"
                  onClick={() => {
                    setFailed(false);
                    setAttempt(attempt + 1);
                  }}
                >
                  Retry
                </Button>
                {onNext && (
                  <Button type="button" variant="light" onClick={onNext}>
                    Next clip
                  </Button>
                )}
              </Group>
            </Stack>
          </Alert>
        )}
      </Stack>
    );
  }
  return (
    <Stack gap="md" miw={0} aria-label={`Now showing ${entry.title}`} component="section" data-clip={entry.id}>
      {body}
      <Facts entry={entry} />
      <Scenario entry={entry} detail={detail.data} />
      <Text component="div" c="dimmed">
        Illustrative recording of one run. Its length and speed are those of the recording, not production latency, and it does not approve the behavior for production.
      </Text>
      {developer}
    </Stack>
  );
}

/**
 * The watch session for `entries`: opens as a modal over the explorer. `total` is how many results matched when the list
 * holds only the newest of them, so the session says it is not the whole set. `initial` is the entry to start on and `title` the
 * heading. Closing it discards positions.
 */
export function WatchPlaylist({ entries, total, onClose, initial, title = 'Watch recordings' }: { entries: readonly PlaylistEntry[]; total?: number; onClose: () => void; initial?: string; title?: string }) {
  const first = entries.find((entry) => entry.id === initial) ?? entries.find((entry) => recordingState(entry) === 'playable') ?? entries[0];
  const [chosen, setChosen] = useState<string | null>(first?.id ?? null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [advance, setAdvance] = useState(true);
  const [repeat, setRepeat] = useState(false);
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState(LISTED);
  const positions = useRef(new Map<string, number>());
  const active = entries.find((entry) => entry.id === chosen) ?? first ?? null;
  const counts = useMemo(() => playlistCounts(entries), [entries]);
  const activeAt = active ? entries.indexOf(active) : -1;
  const next = stepFrom(entries, active?.id ?? null, 1, repeat);
  const previous = stepFrom(entries, active?.id ?? null, -1, repeat);
  const select = (entry: PlaylistEntry, play: boolean) => {
    setAutoPlay(play);
    setChosen(entry.id);
  };
  const listed = entries.slice(0, Math.max(shown, activeAt + 1));
  return (
    <Modal opened onClose={onClose} title={title} size="xl" centered>
      <Stack gap="md">
        <Text role="status" component="div" data-playlist-summary>
          {plural(entries.length, 'result', 'results')}
          {total !== undefined && total > entries.length ? ` (the newest of ${total.toLocaleString()} matching)` : ''}: {counts.playable} with a recording
          {counts.unplayable > 0 ? `, ${counts.unplayable} whose recording is not available` : ''}
          {counts['api-only'] > 0 ? `, ${counts['api-only']} API only` : ''}
          {counts.none > 0 ? `, ${counts.none} with no recording` : ''}. {plural(counts.failed, 'failed result', 'failed results')}
          {counts.failed > 0 ? ' kept in the playlist' : ''}.
        </Text>
        {entries.length === 0 && (
          <Text component="div" c="dimmed">
            No result is in this set, so there is nothing to watch.
          </Text>
        )}
        {active && (
          <Group role="group" aria-label="Playlist controls" align="flex-end" gap="md" wrap="wrap">
            <Button type="button" variant="default" leftSection={<IconPlayerSkipBack size={16} aria-hidden="true" />} disabled={!previous} onClick={() => previous && select(previous, true)}>
              Previous clip
            </Button>
            <Button type="button" variant="default" rightSection={<IconPlayerSkipForward size={16} aria-hidden="true" />} disabled={!next} onClick={() => next && select(next, true)}>
              Next clip
            </Button>
            <NativeSelect
              label="Playback speed"
              value={String(speed)}
              onChange={(event) => setSpeed(Number(event.currentTarget.value))}
              data={SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }))}
            />
            <Switch label="Play the next clip when one ends" checked={advance} onChange={(event) => setAdvance(event.currentTarget.checked)} />
            <Switch label="Repeat" description="Start over after the last clip, or replay a clip when not advancing" checked={repeat} onChange={(event) => setRepeat(event.currentTarget.checked)} />
          </Group>
        )}
        {active && (
          <Text c="dimmed" component="div" size="sm">
            Previous and next skip results with nothing to play; select one in the list to see why.
          </Text>
        )}
        <Grid gap="md">
          <Grid.Col span={{ base: 12, md: 8 }}>
            {active && (
              <Clip
                key={active.id}
                entry={active}
                speed={speed}
                autoPlay={autoPlay}
                positions={positions.current}
                onEnded={() => {
                  const target = advance ? stepFrom(entries, active.id, 1, repeat) : repeat ? active : null;
                  if (target && target.id !== active.id) select(target, true);
                  return target;
                }}
                onFailed={(id) => setFailedIds((held) => new Set(held).add(id))}
                onNext={next ? () => select(next, true) : null}
                onClose={onClose}
              />
            )}
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap="xs" component="section" aria-label="Playlist">
              <Title order={3}>Playlist</Title>
              <List spacing="xs" listStyleType="none">
                {listed.map((entry, index) => {
                  const state = recordingState(entry);
                  const here = entry.id === active?.id;
                  return (
                    <List.Item key={entry.id} data-entry={entry.id} data-status={entry.status} data-recording-state={state}>
                      <Button
                        type="button"
                        variant={here ? 'light' : 'subtle'}
                        fullWidth
                        h="auto"
                        py="xs"
                        justify="flex-start"
                        aria-current={here ? 'true' : undefined}
                        aria-label={`${index + 1}. ${entry.title}, ${statusWord(entry.status)}, ${failedIds.has(entry.id) ? 'could not be loaded' : RECORDING_STATE_TEXT[state].label}`}
                        onClick={() => select(entry, state === 'playable')}
                      >
                        <Flex component="span" gap="xs" wrap="nowrap" align="flex-start">
                          <StatusMark status={entry.status} size={14} />
                          <Flex component="span" direction="column" align="flex-start">
                            <Text span inherit ta="left">
                              {entry.title}
                            </Text>
                            <Text span inherit c="dimmed" size="xs" ta="left">
                              {statusWord(entry.status)} · {environmentLabel(entry.environment)} ·{' '}
                              {failedIds.has(entry.id) ? 'Could not be loaded' : RECORDING_STATE_TEXT[state].label}
                            </Text>
                          </Flex>
                        </Flex>
                      </Button>
                    </List.Item>
                  );
                })}
              </List>
              {entries.length > listed.length && (
                <Button type="button" variant="subtle" onClick={() => setShown(listed.length + LISTED)}>
                  Show more ({entries.length - listed.length} more)
                </Button>
              )}
            </Stack>
          </Grid.Col>
        </Grid>
      </Stack>
    </Modal>
  );
}
