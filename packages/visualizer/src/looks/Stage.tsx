import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconMovie,
  IconPhoto,
  IconPhotoOff,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconTimeline
} from '@tabler/icons-react';
import { ActionIcon, Alert, Box, Button, Card, Center, Group, Image, List, ScrollArea, Slider, Stack, Tabs, Text, Title } from '@mantine/core';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { finderBlocksKeys } from '../find/open';
import type { FilmLook, Looks, MomentLook } from './collect';
export type LookMode = 'pictures' | 'film' | 'timeline';
const MODE_LABEL: Record<LookMode, string> = {
  pictures: 'Pictures',
  film: 'Video',
  timeline: 'Timeline'
};
const MODE_ICON = { pictures: IconPhoto, film: IconMovie, timeline: IconTimeline } satisfies Record<LookMode, unknown>;
/** The dark neutral ground a picture or a video is letterboxed on, in both color schemes. */
const FRAME = 'dark.9';
type Props = {
  looks: Looks;
  /** Which kind to open when a run recorded more than one. */
  prefer: LookMode;
  /** Replaces the stage when the run recorded nothing of this subject. */
  empty?: ReactNode;
  notice?: string | null;
  /** Timeline position, counted from zero. Omit to let the stage keep its own. */
  moment?: number;
  onMoment?: (index: number) => void;
  /** Draws one timeline moment. Stills and video render themselves. */
  renderMoment?: (index: number) => ReactNode;
  /** Ask the stage to show this kind, for example after choosing a step. */
  mode?: LookMode | null;
  onMode?: (mode: LookMode) => void;
  failure?: boolean;
  onFailure?: () => void;
};
function modesOf(looks: Looks): LookMode[] {
  const modes: LookMode[] = [];
  if (looks.pictures.length) modes.push('pictures');
  if (looks.films.length) modes.push('film');
  if (looks.moments.length) modes.push('timeline');
  return modes;
}
function choose(prefer: LookMode, modes: readonly LookMode[], requested: LookMode | null | undefined): LookMode | null {
  if (requested && modes.includes(requested)) return requested;
  if (modes.includes(prefer)) return prefer;
  return modes[0] ?? null;
}
function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `${rest}s`;
}
function pauseFor(mode: LookMode, moment: MomentLook | undefined): number {
  if (mode === 'pictures') return 1400;
  return Math.max(100, Math.min(moment?.pauseMs ?? 700, 2000));
}
/**
 * One player for whatever a runner captured: stills, a video, or a timeline of moments.
 * Kinds the run did not record are absent. When several were recorded, each is a full view of the same evidence.
 */
export function Stage({ looks, prefer, empty, notice, moment, onMoment, renderMoment, mode, onMode, failure, onFailure }: Props) {
  const modes = modesOf(looks);
  const [localMode, setLocalMode] = useState<LookMode | null>(null);
  const [playing, setPlaying] = useState(false);
  const active = choose(prefer, modes, onMode ? (mode ?? null) : localMode);
  const pickMode = (next: LookMode) => {
    setPlaying(false);
    if (onMode) onMode(next);
    else setLocalMode(next);
  };
  const [picture, setPicture] = useState(0);
  const [film, setFilm] = useState(0);
  const [localMoment, setLocalMoment] = useState(0);
  const sectionRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onMomentRef = useRef(onMoment);
  onMomentRef.current = onMoment;
  const count = active === 'pictures' ? looks.pictures.length : active === 'film' ? looks.films.length : looks.moments.length;
  const timelineIndex = moment ?? localMoment;
  const index = Math.max(0, Math.min(count - 1, active === 'pictures' ? picture : active === 'film' ? film : timelineIndex));
  const select = (next: number) => {
    const clamped = Math.max(0, Math.min(count - 1, next));
    if (active === 'pictures') setPicture(clamped);
    else if (active === 'film') setFilm(clamped);
    else if (onMomentRef.current) onMomentRef.current(clamped);
    else setLocalMoment(clamped);
  };
  const selectRef = useRef(select);
  selectRef.current = select;
  useEffect(() => {
    setPlaying(false);
  }, [active]);
  useEffect(() => {
    if (!playing || !active || active === 'film' || count < 2) return;
    if (index >= count - 1) {
      setPlaying(false);
      return;
    }
    const current = active === 'timeline' ? looks.moments[index] : undefined;
    const timer = setTimeout(() => selectRef.current(index + 1), pauseFor(active, current));
    return () => clearTimeout(timer);
  }, [playing, active, index, count, looks.moments]);
  useEffect(() => {
    if (!active || count < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (finderBlocksKeys() || event.altKey || event.ctrlKey || event.metaKey) return;
      const root = sectionRef.current;
      const focused = document.activeElement;
      if (!root || (focused instanceof HTMLElement && focused !== document.body && !root.contains(focused))) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
      const next =
        event.key === 'ArrowRight'
          ? index + 1
          : event.key === 'ArrowLeft'
            ? index - 1
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? count - 1
                : null;
      if (next === null || next === index || next < 0 || next >= count) return;
      event.preventDefault();
      setPlaying(false);
      selectRef.current(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, index, count]);
  if (!active) {
    return (
      <Stack gap="sm">
        {notice && <Alert color="blue">{notice}</Alert>}
        <Card padding="xl" radius="md" shadow="none" bg="var(--mantine-color-default-hover)" bd="1px dashed var(--mantine-color-default-border)">
          <Stack gap="xs" align="center" ta="center">
            <Text span c="dimmed" lh={1}>
              <IconPhotoOff size={28} stroke={1.5} aria-hidden="true" />
            </Text>
            {empty ?? (
              <Text component="div" c="dimmed">
                Nothing was captured of this.
              </Text>
            )}
          </Stack>
        </Card>
      </Stack>
    );
  }
  const showTransport = count > 1;
  const showPlay = showTransport && active !== 'film';
  const shot = looks.pictures[index];
  const clip = looks.films[index];
  const step = looks.moments[index];
  const noun = active === 'pictures' ? 'Picture' : active === 'film' ? 'Video' : 'Moment';
  return (
    <Stack ref={sectionRef} aria-label="What it looked like" component="section" gap="sm" miw={0}>
      {modes.length > 1 && (
        <Tabs value={active} onChange={(value) => pickMode(value as LookMode)}>
          <Tabs.List aria-label="Captured evidence">
            {modes.map((item) => {
              const Icon = MODE_ICON[item];
              return (
                <Tabs.Tab key={item} value={item} id={`look-${item}`} leftSection={<Icon size={16} aria-hidden="true" />}>
                  {MODE_LABEL[item]}
                </Tabs.Tab>
              );
            })}
          </Tabs.List>
        </Tabs>
      )}
      {notice && <Alert color="blue">{notice}</Alert>}
      <Stack gap="xs" miw={0}>
        {active === 'pictures' && shot && (
          <>
            <Card padding="xs" radius="md" shadow="none" bg={FRAME}>
              <Center>
                <Image src={shot.src} alt={shot.alt} fit="contain" w="auto" maw="100%" mah="min(64vh, 40rem)" radius="xs" />
              </Center>
            </Card>
            <Text component="div" c="dimmed" size="xs">
              {shot.label}
            </Text>
          </>
        )}
        {active === 'film' && clip && <Film film={clip} videoRef={videoRef} />}
        {active === 'timeline' &&
          step &&
          (renderMoment ? (
            <Card padding="md" radius="md" shadow="none">
              <Stack gap="sm" miw={0}>
                {renderMoment(index)}
              </Stack>
            </Card>
          ) : step.thumb ? (
            <Box component="figure" m={0}>
              <Card padding="xs" radius="md" shadow="none" bg={FRAME}>
                <Still src={step.thumb} point={step.point} />
              </Card>
              <Group data-status={step.status ?? undefined} component="figcaption" gap="xs" mt="xs" fz="sm">
                {step.caption && (
                  <Text span inherit c="dimmed">
                    {step.caption}
                  </Text>
                )}
                <Text span inherit fw={600}>
                  {step.label}
                </Text>
              </Group>
            </Box>
          ) : (
            <Card data-status={step.status ?? undefined} component="article" padding="md" radius="md" shadow="none">
              {step.caption && (
                <Text component="div" c="dimmed" size="xs">
                  {step.caption}
                </Text>
              )}
              <Title order={3}>{step.label}</Title>
            </Card>
          ))}
      </Stack>
      {showTransport && (
        <Group gap="xs" align="center" wrap="wrap">
          {showPlay && (
            <Button
              type="button"
              onClick={() => {
                if (!playing && index === count - 1) select(0);
                setPlaying((value) => !value);
              }}
              variant="light"
              size="compact-md"
              leftSection={playing ? <IconPlayerPauseFilled size={14} aria-hidden="true" /> : <IconPlayerPlayFilled size={14} aria-hidden="true" />}
            >
              {playing ? 'Pause' : 'Play'}
            </Button>
          )}
          <ActionIcon.Group>
            <ActionIcon
              type="button"
              aria-label={`Previous ${noun.toLowerCase()}`}
              disabled={index === 0}
              onClick={() => {
                setPlaying(false);
                select(index - 1);
              }}
              variant="default"
              size="md"
            >
              <IconChevronLeft aria-hidden="true" size={16} />
            </ActionIcon>
            <ActionIcon
              type="button"
              aria-label={`Next ${noun.toLowerCase()}`}
              disabled={index >= count - 1}
              onClick={() => {
                setPlaying(false);
                select(index + 1);
              }}
              variant="default"
              size="md"
            >
              <IconChevronRight aria-hidden="true" size={16} />
            </ActionIcon>
          </ActionIcon.Group>
          <Slider
            aria-label={noun}
            thumbLabel={noun}
            min={0}
            max={count - 1}
            value={index}
            label={(value) => `${noun} ${value + 1}`}
            size="sm"
            onChange={(value) => {
              setPlaying(false);
              select(value);
            }}
            flex={1}
            miw="6rem"
          />
          <Text span c="dimmed" size="xs">
            {noun} {index + 1} of {count}
          </Text>
          {active === 'timeline' && onFailure && (
            <Button
              type="button"
              disabled={!failure}
              onClick={onFailure}
              variant="light"
              color="red"
              size="compact-md"
              leftSection={<IconAlertTriangle size={14} aria-hidden="true" />}
            >
              Next failure
            </Button>
          )}
        </Group>
      )}
      {active === 'pictures' && (
        <Strip
          items={looks.pictures}
          index={index}
          onSelect={(next) => {
            setPlaying(false);
            select(next);
          }}
        />
      )}
      {active === 'film' && (
        <Strip
          items={looks.films.map((item) => ({ id: item.id, label: item.label, thumb: item.poster }))}
          index={index}
          onSelect={(next) => select(next)}
        />
      )}
      {active === 'timeline' && (
        <Strip
          items={looks.moments}
          index={index}
          onSelect={(next) => {
            setPlaying(false);
            select(next);
          }}
        />
      )}
      {active === 'film' && clip && clip.chapters.length > 0 && (
        <List aria-label="Moments in the video" spacing={2} listStyleType="none" type="ordered">
          {clip.chapters.map((chapter) => (
            <List.Item key={`${chapter.atMs}:${chapter.label}`}>
              <Button
                type="button"
                onClick={() => {
                  const node = videoRef.current;
                  if (!node) return;
                  node.currentTime = chapter.atMs / 1000;
                  void node.play().catch(() => undefined);
                }}
                variant="subtle"
                size="compact-sm"
                leftSection={<IconPlayerPlayFilled size={12} aria-hidden="true" />}
              >
                {clock(chapter.atMs)} {chapter.label}
              </Button>
            </List.Item>
          ))}
        </List>
      )}
    </Stack>
  );
}
function Film({ film, videoRef }: { film: FilmLook; videoRef: RefObject<HTMLVideoElement | null> }) {
  return (
    <>
      <Box
        key={film.src}
        ref={videoRef}
        src={film.src}
        poster={film.poster ?? undefined}
        controls
        preload="metadata"
        playsInline
        aria-label={film.label}
        onLoadedMetadata={(event) => {
          const node = event.currentTarget;
          if (node.videoWidth > 0 && node.videoHeight > 0) node.style.setProperty('--ar', String(node.videoWidth / node.videoHeight));
        }}
        component="video"
        display="block"
        maw="100%"
        w="100%"
        mah="min(70vh, 40rem)"
        bg={FRAME}
        bdrs="md"
      >
        {film.captions && <track kind="captions" src={film.captions} srcLang="en" label="Steps" default />}
      </Box>
      <Text component="div" c="dimmed" size="xs">
        {film.label}
        {film.durationMs !== null && ` · ${clock(film.durationMs)}`}
      </Text>
    </>
  );
}
/** A still, with a mark where the moment happened when the run recorded a point on it. */
function Still({
  src,
  point
}: {
  src: string;
  point?: {
    x: number;
    y: number;
  } | null;
}) {
  const [size, setSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const placed = point && size && point.x >= 0 && point.y >= 0 && point.x <= size.w && point.y <= size.h;
  return (
    <Box pos="relative" w="fit-content" maw="100%" mx="auto">
      <Image
        src={src}
        alt=""
        onLoad={(event) => setSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
        fit="contain"
        maw="100%"
        mah="min(60vh, 40rem)"
      />
      {placed && (
        <Box
          component="span"
          pos="absolute"
          left={`${(point.x / size.w) * 100}%`}
          top={`${(point.y / size.h) * 100}%`}
          w="1rem"
          h="1rem"
          bdrs="xl"
          bg="blue.6"
          opacity={0.6}
          aria-hidden="true"
        />
      )}
    </Box>
  );
}
function Strip({
  items,
  index,
  onSelect
}: {
  items: readonly {
    id: string;
    label: string;
    thumb: string | null;
  }[];
  index: number;
  onSelect: (index: number) => void;
}) {
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selected.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [index]);
  if (items.length < 2) return null;
  return (
    <ScrollArea type="auto" offsetScrollbars="x">
      <Group gap={6} wrap="nowrap" aria-label="Captured frames">
        {items.map((item, itemIndex) => (
          <Box key={item.id}>
            <Button
              ref={itemIndex === index ? selected : undefined}
              type="button"
              aria-current={itemIndex === index}
              aria-label={item.label}
              title={item.label}
              onClick={() => onSelect(itemIndex)}
              variant={itemIndex === index ? 'light' : 'subtle'}
              color={itemIndex === index ? undefined : 'gray'}
              bd={itemIndex === index ? '1px solid var(--mantine-color-primary-outline)' : '1px solid var(--mantine-color-default-border)'}
              h="auto"
              p={item.thumb ? 4 : 'xs'}
              size="compact-sm"
            >
              {item.thumb ? (
                <Image src={item.thumb} alt="" fit="contain" w="4.5rem" h="3rem" radius="xs" bg={FRAME} />
              ) : (
                <Text span inherit maw="10rem" truncate>
                  {item.label}
                </Text>
              )}
            </Button>
          </Box>
        ))}
      </Group>
    </ScrollArea>
  );
}
