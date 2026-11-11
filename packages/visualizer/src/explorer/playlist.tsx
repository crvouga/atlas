/**
 * @module Watch playlist
 *
 * A watch session over a filtered set of recorded results: the player and the plain-language scenario beside an ordered
 * list of every result in the set. A failed result stays in the list with its outcome, and a result with no recording,
 * an API-only one or one whose file is missing says so in words instead of being left out or shown as demonstrated.
 *
 * Only the clip on screen is read: the list is made of the metadata the catalog already sent, the current result's
 * evidence is read when it is selected, and its video is loaded with `preload="metadata"`, so opening the playlist of a
 * large library downloads no recordings in bulk. A row shows a poster (lazily loaded) and a length only when the catalog
 * already carried them for its clip; none is read to find out. There is one `<video>`; selecting another clip replaces it and keeps
 * the position of the one left, so returning resumes there. A clip that will not load (or whose autoplay the browser
 * blocked) stays in the list and offers Retry, Play and Next. Recordings are always labelled illustrative: playback
 * length and speed are those of the recording, never production latency.
 */
import { attachmentIdentity, isVideoAttachment, type CheckDetail } from '@crvouga/atlas/reports/evidence-detail';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { contentTypeOf } from '@crvouga/atlas/reports/media-types';
import type { Attachment, Step } from '@crvouga/atlas/schema';
import { Alert, Anchor, AspectRatio, Badge, Box, Button, Center, Code, Divider, Flex, Grid, Group, Image, List, Modal, NativeSelect, NavLink, ScrollArea, Skeleton, Stack, Switch, Text, ThemeIcon, Title } from '@mantine/core';
import { IconAlertTriangle, IconApi, IconPlayerPlay, IconPlayerPlayFilled, IconPlayerSkipBack, IconPlayerSkipForward, IconVideoOff } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { reportJson } from '../evidence/api';
import { attachmentSource } from '../evidence/artifacts';
import { everyAttachment } from '../evidence/artifact-tags';
import { ScopeNotice } from '../evidence/evidence-scope';
import { MomentBar, MomentPlayback, SeekStep, stepsOfRecording, useIsPlaying, useMomentVideo } from '../evidence/moments';
import { duration, exactTime, plural, statusWord } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { patched } from './navigate';
import { ReadPromise } from './parts';
import { clock, TEXT_KIND_WORD, type RecordingFocus } from './recording-text';
import { clipHints, playableVideo, playlistCounts, RECORDING_STATE_TEXT, recordingState, stepFrom, type PlaylistEntry, type RecordingState } from './playlist-entries';

/** Entries listed before "more"; the selected entry is always listed. */
const LISTED = 50;
/** Playback speeds offered. */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** Step names are shown with their Gherkin keyword when they have one. */
const KEYWORDS = new Set(['given', 'when', 'then', 'and', 'but']);

const NO_STEPS: readonly Step[] = [];

/** Where the evidence of an entry's check is read from, or null when the entry names no layer that can be read. */
export function entryDetailQuery(entry: PlaylistEntry) {
  if (entry.backend === null || !/^[0-9a-f]{64}$/.test(entry.layer)) return null;
  const backend = entry.backend;
  return {
    queryKey: ['evidence-detail', backend, entry.layer, entry.kind ?? '', entry.check],
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      reportJson<CheckDetail>(
        `/evidence/detail/${encodeURIComponent(backend)}/${encodeURIComponent(entry.layer)}?check=${encodeURIComponent(entry.check)}${entry.kind ? `&kind=${encodeURIComponent(entry.kind)}` : ''}`,
        signal
      ),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  };
}

/** The evidence of one entry's check, read when the entry is on screen. */
export function useEntryDetail(entry: PlaylistEntry, enabled: boolean) {
  const query = entryDetailQuery(entry);
  return useQuery({
    queryKey: query?.queryKey ?? ['evidence-detail', '', entry.layer, entry.kind ?? '', entry.check],
    queryFn: query?.queryFn ?? (() => Promise.reject(new Error('no evidence to read'))),
    enabled: enabled && query !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
}

/** What stands in for a recording that cannot be watched, so a row never looks like it has a clip when it has none. */
const THUMB_ICON: Record<Exclude<RecordingState, 'playable'>, typeof IconVideoOff> = { unplayable: IconVideoOff, 'api-only': IconApi, none: IconVideoOff };

/**
 * The picture of a result in a list: the poster the catalog named for its clip, loaded only when its row is near the
 * screen (`loading="lazy"`), with a play mark and the declared length. Nothing is read to draw it: a clip with no
 * declared poster shows the play mark alone, a poster that will not load is left out, and a result with nothing to
 * watch shows a struck-out mark (or `fallback`) instead of a play mark. `w` is its width; it is always 16:9.
 */
export function ClipThumb({ entry, w = 96, length = true, fallback }: { entry: Pick<PlaylistEntry, 'videos' | 'backend' | 'environment' | 'layer'>; w?: number; /** False where the declared length is already said in words beside the picture. */ length?: boolean; /** Shown in place of the struck-out mark when the result has other evidence to look at (a screenshot, a trace). */ fallback?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  const hints = clipHints(entry);
  const state = recordingState(entry);
  const url = hints.poster ? attachmentSource({ name: 'poster', bundleKey: hints.poster }, entry.layer).url : null;
  const Missing = state === 'playable' ? null : THUMB_ICON[state];
  return (
    <AspectRatio component="span" display="block" ratio={16 / 9} w={w} miw={w} data-thumb={state}>
      <Center component="span" pos="relative" bg="var(--mantine-color-default-hover)" bd="1px solid var(--mantine-color-default-border)" bdrs="sm" c="dimmed">
        {url && !broken && <Image src={url} alt="" loading="lazy" decoding="async" pos="absolute" top={0} left={0} w="100%" h="100%" fit="cover" radius="sm" data-poster onError={() => setBroken(true)} />}
        {Missing ? (
          (fallback ?? <Missing size={Math.round(w / 5)} stroke={1.5} aria-hidden="true" />)
        ) : (
          <ThemeIcon component="span" pos="relative" size={Math.max(22, Math.round(w / 4))} radius="xl" color="dark" variant="filled" opacity={0.85}>
            <IconPlayerPlayFilled size={Math.max(10, Math.round(w / 9))} aria-hidden="true" />
          </ThemeIcon>
        )}
        {length && hints.durationMs ? (
          <Badge component="span" pos="absolute" bottom={3} right={3} size="xs" radius="sm" color="dark" variant="filled" tt="none">
            {duration(hints.durationMs)}
          </Badge>
        ) : null}
      </Center>
    </AspectRatio>
  );
}

/** One step of the scenario: in words, with a control to show it in the recording and a mark while it is playing. */
function ScenarioStep({ step }: { step: Step }) {
  const playing = useIsPlaying(step);
  return (
    <List.Item aria-current={playing ? 'step' : undefined} data-playing={playing || undefined} {...(playing ? { bg: 'var(--mantine-color-primary-light)' } : {})}>
      <Group gap="xs" wrap="wrap">
        <Text span inherit>
          {step.kind && KEYWORDS.has(step.kind.toLowerCase()) ? `${step.kind.charAt(0).toUpperCase()}${step.kind.slice(1).toLowerCase()} ` : ''}
          {step.name}
          {step.status && step.status !== 'passed' ? ` (${step.status})` : ''}
        </Text>
        {playing && <Badge variant="light">Playing now</Badge>}
        <SeekStep step={step} />
      </Group>
    </List.Item>
  );
}

/** The scenario in words: the steps the producer recorded for the recording shown, with the Gherkin keyword where it gave one. */
function Scenario({ entry, detail, steps }: { entry: PlaylistEntry; detail: CheckDetail | undefined; steps: readonly Step[] }) {
  return (
    <Stack gap="sm" component="section" aria-label="Scenario">
      <Title order={3}>{entry.title}</Title>
      {steps.length > 0 && (
        <List type="ordered" spacing={6} size="sm" aria-label="Steps">
          {steps.map((step, index) => (
            <ScenarioStep key={`${step.id ?? step.name}:${index}`} step={step} />
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

/** The one `<video>`: joined to the steps beside it, with the player's own handlers kept. */
function ClipVideo({
  movie,
  videoRef,
  onLoadedMetadata,
  onTimeUpdate,
  children,
  ...rest
}: {
  movie: Attachment;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
  children: React.ReactNode;
  [prop: string]: unknown;
}) {
  const moments = useMomentVideo(movie);
  return (
    <Box
      component="video"
      {...rest}
      {...moments}
      ref={(element: HTMLVideoElement | null) => {
        (videoRef as { current: HTMLVideoElement | null }).current = element;
        moments?.ref(element);
      }}
      onLoadedMetadata={(event: React.SyntheticEvent<HTMLVideoElement>) => {
        moments?.onLoadedMetadata(event);
        onLoadedMetadata();
      }}
      onTimeUpdate={(event: React.SyntheticEvent<HTMLVideoElement>) => {
        moments?.onTimeUpdate(event);
        onTimeUpdate();
      }}
    >
      {children}
    </Box>
  );
}

/** Who recorded the entry and what it carries, in one line each. */
function Facts({ entry }: { entry: PlaylistEntry }) {
  return (
    <Stack gap="xs" aria-label="Recording facts">
      <Group gap="xs" wrap="wrap">
        <StatusMark status={entry.status} size={14} />
        <Text span size="sm" fw={600} data-outcome={entry.status}>
          {statusWord(entry.status)}
        </Text>
        <Text span size="sm" c="dimmed">
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
        <Text component="div" size="sm" c="dimmed">
          Spec <Code>{entry.specPath}</Code>
        </Text>
      )}
    </Stack>
  );
}

/** Where a search result opened: which words, from what, in which attempt, and whether the player could go to the time. */
function FoundMoment({ focus, seek }: { focus: RecordingFocus; seek: 'applied' | 'unavailable' | null }) {
  const timed = focus.startMs !== null && focus.endMs !== null;
  return (
    <Alert color="blue" variant="light" title="Found in this recording" role="status" data-found-moment>
      <Stack gap="xs">
        <Text component="div">
          {TEXT_KIND_WORD[focus.kind]}
          {focus.attemptLabel ? ` · ${focus.attemptLabel}` : ''}
          {timed ? ` · ${clock(focus.startMs!)}–${clock(focus.endMs!)}` : ''}
        </Text>
        <Text component="div">Indexed text: {focus.text}</Text>
        {focus.generated && (
          <Text component="div" c="dimmed">
            Generated text; it may contain errors.
          </Text>
        )}
        {seek === 'unavailable' && (
          <Text component="div" data-seek-unavailable>
            Seeking is unavailable: {focus.startMs === null ? 'the text has no usable time' : 'the recording it belongs to or its time could not be reached'}, so the recording is opened at its start and not at a guessed moment.
          </Text>
        )}
      </Stack>
    </Alert>
  );
}

/** The one player. It is keyed by its entry, so a new clip is a fresh element and the previous one is gone. */
function Clip({
  entry,
  speed,
  autoPlay,
  focus,
  positions,
  onEnded,
  onFailed,
  onNext,
  onClose,
  transport
}: {
  entry: PlaylistEntry;
  speed: number;
  autoPlay: boolean;
  /** A moment found by searching inside recordings: its video is selected and, when its time is usable, played from there. */
  focus: RecordingFocus | null;
  positions: Map<string, number>;
  onEnded: () => PlaylistEntry | null;
  onFailed: (id: string) => void;
  onNext: (() => void) | null;
  onClose: () => void;
  /** The session's controls (previous, next, speed, advancing), shown directly under the player. */
  transport: ReactNode;
}) {
  const state = recordingState(entry);
  const detail = useEntryDetail(entry, state === 'playable');
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [seek, setSeek] = useState<'applied' | 'unavailable' | null>(null);
  const chosen = playableVideo(entry);
  const attachments = useMemo(() => (detail.data ? everyAttachment(detail.data.check) : []), [detail.data]);
  const videos = useMemo(() => attachments.filter(isVideoAttachment), [attachments]);
  const found = focus?.recording ? videos.find((item) => attachmentIdentity(item) === focus.recording) : undefined;
  const movie = useMemo(() => found ?? videos.find((item) => attachmentIdentity(item) === chosen?.recording) ?? videos[0], [found, videos, chosen]);
  const captions = useMemo(
    () => attachments.filter((item) => (item.contentType ?? contentTypeOf(item.name)).toLowerCase().startsWith('text/vtt')),
    [attachments]
  );
  const url = movie ? attachmentSource(movie, entry.layer).url : null;
  // The steps are those of the check or the try that carries this recording, placed by this recording's own timing.
  const placedIn = useMemo(() => (movie ? [movie] : []), [movie]);
  const steps = useMemo(() => (detail.data ? stepsOfRecording(detail.data.check, movie ? attachmentIdentity(movie) : undefined) : NO_STEPS), [detail.data, movie]);

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
    <Group gap="md" wrap="wrap">
      <ReadPromise specPath={entry.specPath} check={entry.check} />
      <Anchor
        renderRoot={(props) => (
          <Link {...props} to="/" search={patched({ tab: undefined, openRun: undefined, artifact: undefined, watch: undefined, watchClip: undefined, test: entry.key, layer: entry.layer })} resetScroll={false} activeOptions={{ exact: true }} onClick={onClose} />
        )}
      >
        Developer details
      </Anchor>
    </Group>
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
      <Stack gap="xs">
        <AspectRatio ratio={16 / 9}>
          <Skeleton radius="md" />
        </AspectRatio>
        <Text role="status" component="div" size="sm" c="dimmed">
          Loading the recording…
        </Text>
      </Stack>
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
        {focus && <FoundMoment focus={focus} seek={seek} />}
        <ScopeNotice scope={chosen?.scope} name={movie!.name} />
        <ClipVideo
          key={attempt}
          movie={movie!}
          videoRef={video}
          src={url}
          controls
          preload="metadata"
          aria-label={`Recording: ${movie!.description ?? movie!.name}`}
          maw="100%"
          w="100%"
          mah="64vh"
          bg="var(--mantine-color-dark-9)"
          bdrs="md"
          display="block"
          data-playing={entry.id}
          onLoadedMetadata={() => {
            const element = video.current!;
            element.playbackRate = speed;
            if (focus) {
              // Seek only to a time the track gave and the recording can reach; otherwise open it at the start and say so.
              const reachable = (found !== undefined || !focus.recording) && focus.startMs !== null && (!Number.isFinite(element.duration) || focus.startMs / 1000 < element.duration);
              if (reachable) element.currentTime = focus.startMs! / 1000;
              setSeek(reachable ? 'applied' : 'unavailable');
              if (autoPlay) play();
              return;
            }
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
        </ClipVideo>
        {movie!.durationMs ? (
          <Text component="div" size="sm" c="dimmed">
            Length of the recording: {duration(movie!.durationMs)}
          </Text>
        ) : null}
        {captions.length > 0 && (
          <Text component="div" size="sm" c="dimmed">
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
    <MomentPlayback
      steps={steps}
      attachments={placedIn}
      layer={entry.layer}
      linkSearch={{ test: entry.key, layer: entry.layer, tab: undefined, openRun: undefined, artifact: undefined, watch: undefined, watchClip: undefined }}
    >
      <Stack gap="md" miw={0} aria-label={`Now showing ${entry.title}`} component="section" data-clip={entry.id}>
        {body}
        {transport}
        <MomentBar />
        <Divider />
        <Scenario entry={entry} detail={detail.data} steps={steps} />
        <Facts entry={entry} />
        <Text component="div" size="sm" c="dimmed">
          Illustrative recording of one run. Its length and speed are those of the recording, not production latency, and it does not approve the behavior for production.
        </Text>
        {developer}
      </Stack>
    </MomentPlayback>
  );
}

/**
 * The watch session for `entries`: opens as a modal over the explorer. `total` is how many results matched when the list
 * holds only the newest of them, so the session says it is not the whole set. `focus` opens it on one found moment: that
 * result, that attempt's video and, when the time is usable, that time. `initial` is the entry to start on when there is no
 * `focus`, and `title` the heading. `onSelect` is told the id of the entry on screen when the session opens and each time it
 * changes, so the address can name it. Closing it discards positions.
 */
export function WatchPlaylist({
  entries,
  total,
  focus,
  onClose,
  onSelect,
  initial,
  title = 'Watch recordings'
}: {
  entries: readonly PlaylistEntry[];
  total?: number;
  focus?: RecordingFocus;
  onClose: () => void;
  onSelect?: (id: string) => void;
  initial?: string;
  title?: string;
}) {
  const first = entries.find((entry) => entry.id === initial) ?? entries.find((entry) => recordingState(entry) === 'playable') ?? entries[0];
  const [chosen, setChosen] = useState<string | null>(focus && entries.some((entry) => entry.id === focus.entryId) ? focus.entryId : (first?.id ?? null));
  // Selecting anything else leaves the found moment behind: it describes one video and one time.
  const [moment, setMoment] = useState<RecordingFocus | null>(focus ?? null);
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
  const activeId = active?.id;
  const selected = useRef(onSelect);
  selected.current = onSelect;
  useEffect(() => {
    if (activeId !== undefined && !focus) selected.current?.(activeId);
  }, [activeId, focus]);
  const next = stepFrom(entries, active?.id ?? null, 1, repeat);
  const previous = stepFrom(entries, active?.id ?? null, -1, repeat);
  const select = (entry: PlaylistEntry, play: boolean) => {
    setMoment(null);
    setAutoPlay(play);
    setChosen(entry.id);
  };
  const listed = entries.slice(0, Math.max(shown, activeAt + 1));
  const speedId = useId();
  const transport = active && (
    <Stack gap={6}>
      <Group role="group" aria-label="Playlist controls" align="center" justify="space-between" gap="sm" wrap="wrap">
        <Group gap="xs" wrap="nowrap">
          <Button type="button" variant="default" leftSection={<IconPlayerSkipBack size={16} aria-hidden="true" />} disabled={!previous} onClick={() => previous && select(previous, true)}>
            Previous clip
          </Button>
          <Button type="button" variant="default" rightSection={<IconPlayerSkipForward size={16} aria-hidden="true" />} disabled={!next} onClick={() => next && select(next, true)}>
            Next clip
          </Button>
          <Text span size="sm" c="dimmed" visibleFrom="xs" aria-hidden="true">
            {activeAt + 1} of {entries.length}
          </Text>
        </Group>
        <Group gap="md" wrap="wrap" align="center">
          <Group gap={6} wrap="nowrap">
            <Text component="label" htmlFor={speedId} size="sm">
              Playback speed
            </Text>
            <NativeSelect id={speedId} size="xs" w={76} value={String(speed)} onChange={(event) => setSpeed(Number(event.currentTarget.value))} data={SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }))} />
          </Group>
          <Switch size="sm" label="Play the next clip when one ends" checked={advance} onChange={(event) => setAdvance(event.currentTarget.checked)} />
          <Switch size="sm" label="Repeat" description="Start over after the last clip, or replay a clip when not advancing" checked={repeat} onChange={(event) => setRepeat(event.currentTarget.checked)} />
        </Group>
      </Group>
      <Text c="dimmed" component="div" size="xs">
        Previous and next skip results with nothing to play; select one in the list to see why.
      </Text>
    </Stack>
  );
  return (
    <Modal opened onClose={onClose} title={title} size="min(86rem, 96vw)" centered>
      <Stack gap="md">
        <Text role="status" component="div" size="sm" c="dimmed" data-playlist-summary>
          {plural(entries.length, 'result', 'results')}
          {total !== undefined && total > entries.length ? ` (the newest of ${total.toLocaleString()} matching)` : ''}: {counts.playable} with a recording
          {counts.unplayable > 0 ? `, ${counts.unplayable} whose recording is not available` : ''}
          {counts['api-only'] > 0 ? `, ${counts['api-only']} API only` : ''}
          {counts.none > 0 ? `, ${counts.none} with no recording` : ''}. {plural(counts.failed, 'failed result', 'failed results')}
          {counts.failed > 0 ? ' kept in the playlist' : ''}.
        </Text>
        {entries.length === 0 && (
          <Text component="div" c="dimmed" ta="center" py="xl">
            No result is in this set, so there is nothing to watch.
          </Text>
        )}
        <Grid gap="lg">
          <Grid.Col span={{ base: 12, md: 8 }}>
            {active && (
              <Clip
                key={active.id}
                entry={active}
                speed={speed}
                autoPlay={autoPlay}
                focus={moment && moment.entryId === active.id ? moment : null}
                positions={positions.current}
                onEnded={() => {
                  const target = advance ? stepFrom(entries, active.id, 1, repeat) : repeat ? active : null;
                  if (target && target.id !== active.id) select(target, true);
                  return target;
                }}
                onFailed={(id) => setFailedIds((held) => new Set(held).add(id))}
                onNext={next ? () => select(next, true) : null}
                onClose={onClose}
                transport={transport}
              />
            )}
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap="xs" component="section" aria-label="Playlist">
              <Group justify="space-between" align="baseline">
                <Title order={3}>Playlist</Title>
                <Text size="sm" c="dimmed">
                  {plural(entries.length, 'clip', 'clips')}
                </Text>
              </Group>
              <ScrollArea.Autosize mah={{ base: 360, md: '72vh' }} type="auto" scrollbars="y" offsetScrollbars="y">
                <List listStyleType="none">
                  {listed.map((entry, index) => {
                    const state = recordingState(entry);
                    const here = entry.id === active?.id;
                    const hints = clipHints(entry);
                    return (
                      <Box component="li" key={entry.id} mt={index > 0 ? 4 : 0} data-entry={entry.id} data-status={entry.status} data-recording-state={state}>
                        <NavLink
                          component="button"
                          type="button"
                          active={here}
                          variant="light"
                          p="xs"
                          bdrs="md"
                          aria-current={here ? 'true' : undefined}
                          onClick={() => select(entry, state === 'playable')}
                          leftSection={<ClipThumb entry={entry} w={104} length={false} />}
                          label={
                            <Text span size="sm" fw={500} lineClamp={2}>
                              {entry.title}
                            </Text>
                          }
                          description={
                            <Flex component="span" gap={6} align="center" wrap="nowrap" mt={2}>
                              <StatusMark status={entry.status} size={12} />
                              <Text span inherit>
                                {statusWord(entry.status)} · {environmentLabel(entry.environment)} ·{' '}
                                {failedIds.has(entry.id) ? 'Could not be loaded' : RECORDING_STATE_TEXT[state].label}
                                {hints.durationMs ? ` · ${duration(hints.durationMs)} recording` : ''}
                              </Text>
                            </Flex>
                          }
                        />
                      </Box>
                    );
                  })}
                </List>
              </ScrollArea.Autosize>
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
