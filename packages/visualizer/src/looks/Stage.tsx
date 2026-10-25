import { IconArrowLeft } from '@tabler/icons-react';
import { Alert, Box, Button, Flex, Group, Image, List, ScrollArea, Slider, Stack, Tabs, Text, Title } from '@mantine/core';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { IconChevronRight as ChevronIcon } from '@tabler/icons-react';
import { finderBlocksKeys } from '../find/open';
import type { FilmLook, Looks, MomentLook } from './collect';
export type LookMode = 'pictures' | 'film' | 'timeline';
const MODE_LABEL: Record<LookMode, string> = {
  pictures: 'Pictures',
  film: 'Video',
  timeline: 'Timeline'
};
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
  const sectionRef = useRef<HTMLElement>(null);
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
        {notice && (
          <Alert color={'blue'} my="sm">
            {notice}
          </Alert>
        )}
        {empty ?? (
          <Text component="div" c="dimmed">
            Nothing was captured of this.
          </Text>
        )}
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
    <Box ref={sectionRef} aria-label="What it looked like" component="section" mb="lg">
      {modes.length > 1 && (
        <Tabs value={active} onChange={(value) => pickMode(value as LookMode)} mb="md">
          <Tabs.List aria-label="Captured evidence">
            {modes.map((item) => (
              <Tabs.Tab key={item} value={item} id={`look-${item}`}>
                {MODE_LABEL[item]}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      )}
      {notice && (
        <Alert color={'blue'} my="sm">
          {notice}
        </Alert>
      )}
      <Stack gap="sm" miw={0}>
        {active === 'pictures' && shot && (
          <>
            <Image src={shot.src} alt={shot.alt} fit="contain" maw="100%" mah="60vh" />
            <Flex gap="xs" align="center" wrap="wrap" c="dimmed">
              {shot.label}
            </Flex>
          </>
        )}
        {active === 'film' && clip && <Film film={clip} videoRef={videoRef} />}
        {active === 'timeline' &&
          step &&
          (renderMoment ? (
            <Stack gap="sm" miw={0}>
              {renderMoment(index)}
            </Stack>
          ) : step.thumb ? (
            <Box component="figure" m={0}>
              <Still src={step.thumb} point={step.point} />
              <Box data-status={step.status ?? undefined} component="figcaption">
                {step.caption && (
                  <Text span inherit>
                    {step.caption}
                  </Text>
                )}
                <Text span inherit fw={600}>
                  {step.label}
                </Text>
              </Box>
            </Box>
          ) : (
            <Box data-status={step.status ?? undefined} component="article">
              {step.caption && <Text component="div">{step.caption}</Text>}
              <Title order={3} mb="sm">
                {step.label}
              </Title>
            </Box>
          ))}
      </Stack>
      {showTransport && (
        <Flex gap="xs" align="center" wrap="wrap">
          {showPlay && (
            <Button
              type="button"
              onClick={() => {
                if (!playing && index === count - 1) select(0);
                setPlaying((value) => !value);
              }}
              variant="light"
            >
              {playing ? 'Pause' : 'Play'}
            </Button>
          )}
          <Button
            type="button"
            aria-label={`Previous ${noun.toLowerCase()}`}
            disabled={index === 0}
            onClick={() => {
              setPlaying(false);
              select(index - 1);
            }}
            variant="light"
          >
            <Text span aria-hidden="true">
              <IconArrowLeft size={16} aria-hidden="true" />
            </Text>
          </Button>
          <Button
            type="button"
            aria-label={`Next ${noun.toLowerCase()}`}
            disabled={index >= count - 1}
            onClick={() => {
              setPlaying(false);
              select(index + 1);
            }}
            variant="light"
          >
            <ChevronIcon aria-hidden="true" size={14} />
          </Button>
          <Slider
            aria-label={noun}
            min={0}
            max={count - 1}
            value={index}
            onChange={(value) => {
              setPlaying(false);
              select(value);
            }}
            flex={1}
          />
          <Text span inherit c="dimmed">
            {noun} {index + 1} of {count}
          </Text>
          {active === 'timeline' && onFailure && (
            <Button type="button" disabled={!failure} onClick={onFailure} variant="light">
              Next failure
            </Button>
          )}
        </Flex>
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
        <List aria-label="Moments in the video" spacing="xs" listStyleType="none" type="ordered">
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
                variant="light"
              >
                {clock(chapter.atMs)} {chapter.label}
              </Button>
            </List.Item>
          ))}
        </List>
      )}
    </Box>
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
        maw="100%"
        w="100%"
      >
        {film.captions && <track kind="captions" src={film.captions} srcLang="en" label="Steps" default />}
      </Box>
      <Flex gap="xs" align="center" wrap="wrap" c="dimmed">
        {film.label}
        {film.durationMs !== null && ` · ${clock(film.durationMs)}`}
      </Flex>
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
        mah="60vh"
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
    <ScrollArea type="auto" mt="sm">
      <Group gap="xs" wrap="nowrap" aria-label="Captured frames">
        {items.map((item, itemIndex) => (
          <Box key={item.id}>
            <Button
              ref={itemIndex === index ? selected : undefined}
              type="button"
              aria-current={itemIndex === index}
              aria-label={item.label}
              title={item.label}
              onClick={() => onSelect(itemIndex)}
              variant={itemIndex === index ? 'light' : 'default'}
              h="auto"
              p="xs"
            >
              {item.thumb ? (
                <Image src={item.thumb} alt="" fit="contain" w="4rem" h="3rem" />
              ) : (
                <Text span inherit>
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
