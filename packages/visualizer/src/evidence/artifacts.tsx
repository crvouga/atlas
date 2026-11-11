import type { CheckDetail, EvidenceHolder } from '@crvouga/atlas/reports/evidence-detail';
import { attachmentIdentity, isVideoAttachment, roleOfType } from '@crvouga/atlas/reports/evidence-detail';
import { effectiveScope } from '@crvouga/atlas/reports/evidence-scope';
import type { LayerHeader, LayerRow } from '@crvouga/atlas/reports/evidence-types';
import { contentTypeOf } from '@crvouga/atlas/reports/media-types';
import type { Annotation, Attachment, Attempt, Step } from '@crvouga/atlas/schema';
import { Accordion, ActionIcon, Alert, Anchor, Badge, Box, Button, Center, Code, Divider, Group, Image, List, Paper, ScrollArea, SimpleGrid, Skeleton, Stack, Text, ThemeIcon, Title, UnstyledButton } from '@mantine/core';
import {
  IconBrowser,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconExternalLink,
  IconFile,
  IconFileText,
  IconFileTypePdf,
  IconFileZip,
  IconMovie,
  IconMusic,
  IconPhoto
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArtifactTagList, ArtifactTagsProvider, TagFilterBar, useFilteredAttachments } from './artifact-tags';
import { reportAssetUrl, reportJson, reportText } from './api';
import { ScopeNotice, ScopeProvider, useScope } from './evidence-scope';
import { duration, plural, safeUri } from './format';
import { StatusMark } from './marks';
import { MomentBar, MomentPlayback, momentOwner, SeekStep, useIsPlaying, useMomentVideo, useRequestedMoment } from './moments';
import { videosIn } from './outcome';
/**
 * How one kind of attachment is shown. The first renderer that matches wins, so a new kind of artifact (a
 * flame graph, a HAR, a coverage map) is one more entry, and an attachment nobody has a renderer for is still
 * listed, with its name, what it is and a way to download it. Nothing here fails on what it does not know.
 */
export type ArtifactRenderer = {
  readonly id: string;
  readonly matches: (attachment: Attachment, type: string) => boolean;
  /** `url` is where the bytes are, if they are anywhere a browser can reach; `path` is the report API path of a stored file. */
  readonly render: (
    attachment: Attachment,
    context: {
      url: string | null;
      path: string | null;
      type: string;
      /** True when the card is one tile of a grid of pictures, so a picture keeps to a thumbnail's height. */
      tile?: boolean;
    }
  ) => ReactNode;
  /** Wide renderers take a whole row of the gallery. */
  readonly wide?: boolean;
};
const mediaType = (attachment: Attachment) =>
  (attachment.contentType ?? contentTypeOf(attachment.name)).split(';')[0]!.trim().toLowerCase();
const label = (attachment: Attachment) => attachment.description ?? attachment.name;
/**
 * The frame a recording or a picture is letterboxed in: a dark neutral ground in both color schemes, the full width
 * of its container and a bounded height. Spread it on a `<video>` (`Box component="video"`) so every player looks alike.
 */
export const MEDIA_FRAME = { display: 'block', w: '100%', maw: '100%', mah: 'min(70vh, 40rem)', bg: 'dark.9', bdrs: 'md' } as const;
function fileIcon(type: string) {
  if (type.startsWith('image/')) return IconPhoto;
  if (type.startsWith('video/')) return IconMovie;
  if (type.startsWith('audio/')) return IconMusic;
  if (type === 'application/pdf') return IconFileTypePdf;
  if (type === 'text/html' || type === 'application/xhtml+xml') return IconBrowser;
  if (/(zip|tar|gzip|compressed|archive)/.test(type)) return IconFileZip;
  if (type.startsWith('text/') || /(json|xml|yaml|x-ndjson|x-diff)/.test(type)) return IconFileText;
  return IconFile;
}
/** A video that plays inline; when the file cannot be loaded or this browser cannot play it, it says so and offers the file, instead of an empty player. */
function VideoPlayer({ attachment, url }: { attachment: Attachment; url: string }) {
  const [failed, setFailed] = useState(false);
  // Inside a result's playback the player is the one its steps seek and that marks the step playing.
  const moments = useMomentVideo(attachment);
  if (failed)
    return (
      <Alert role="alert" color="orange" title="This video cannot be played">
        <Text component="div">
          {label(attachment)} could not be loaded, or this browser cannot play its format. Nothing is wrong with the report: the file may be missing from the
          store or in an unsupported codec.{' '}
          <Anchor href={url} download={attachment.name} target="_blank" rel="noreferrer">
            Download {attachment.name}
          </Anchor>
        </Text>
      </Alert>
    );
  return (
    <Box
      src={url}
      controls
      preload="metadata"
      aria-label={label(attachment)}
      component="video"
      {...MEDIA_FRAME}
      onError={() => setFailed(true)}
      {...moments}
    />
  );
}
function TextValue({ attachment, path }: { attachment: Attachment; path: string | null }) {
  const stored = useQuery({
    queryKey: ['artifact-text', path ?? ''],
    queryFn: ({ signal }) => reportText(path!, signal),
    enabled: attachment.text === undefined && path !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
  const raw = attachment.text ?? stored.data;
  if (raw === undefined)
    return (
      <Text component="div" c="dimmed" size="xs">
        {stored.isError ? 'Could not be read.' : 'Loading…'}
      </Text>
    );
  const shown = raw.length > 200000 ? raw.slice(0, 200000) : raw;
  const pretty = /json/.test(mediaType(attachment)) ? tryPretty(shown) : shown;
  return (
    <>
      <ScrollArea.Autosize mah="24rem" type="auto">
        <Code block>{pretty}</Code>
      </ScrollArea.Autosize>
      {shown.length < raw.length && (
        <Text component="div" c="dimmed" size="xs">
          Showing the first 200 000 characters.
        </Text>
      )}
    </>
  );
}
function tryPretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
/** In order: the first that matches. Add to the front with {@link registerArtifactRenderer}. */
export const artifactRenderers: ArtifactRenderer[] = [
  {
    id: 'image',
    matches: (_, type) => type.startsWith('image/') && type !== 'image/svg+xml',
    render: (a, { url, tile }) =>
      url ? (
        <Anchor href={url} target="_blank" rel="noreferrer" display="block">
          <Image
            src={url}
            alt={label(a)}
            loading="lazy"
            width={a.width}
            height={a.height}
            fit="contain"
            maw="100%"
            w="100%"
            h={tile ? '9rem' : 'auto'}
            mah={tile ? undefined : 'min(70vh, 40rem)'}
            bg="dark.9"
            radius="sm"
          />
        </Anchor>
      ) : null
  },
  // SVG can carry script: shown as a picture only, never inlined.
  {
    id: 'svg',
    matches: (_, type) => type === 'image/svg+xml',
    render: (a, { url, tile }) =>
      url ? (
        <Image
          src={url}
          alt={label(a)}
          loading="lazy"
          fit="contain"
          maw="100%"
          w="100%"
          h={tile ? '9rem' : 'auto'}
          mah={tile ? undefined : 'min(70vh, 40rem)'}
          bg="var(--mantine-color-default-hover)"
          radius="sm"
        />
      ) : null
  },
  {
    id: 'video',
    wide: true,
    matches: (_, type) => type.startsWith('video/'),
    render: (a, { url }) => (url ? <VideoPlayer attachment={a} url={url} /> : null)
  },
  {
    id: 'audio',
    matches: (_, type) => type.startsWith('audio/'),
    render: (a, { url }) => (url ? <Box component="audio" src={url} controls preload="none" aria-label={label(a)} display="block" w="100%" /> : null)
  },
  // A page snapshot runs nothing: the frame has no permissions and the file is served sandboxed.
  {
    id: 'snapshot',
    wide: true,
    matches: (_, type) => type === 'text/html' || type === 'application/xhtml+xml',
    render: (a, { url }) =>
      url ? <Box component="iframe" display="block" w="100%" h="32rem" bd="1px solid var(--mantine-color-default-border)" bdrs="sm" sandbox="" src={url} title={label(a)} loading="lazy" /> : null
  },
  {
    id: 'pdf',
    wide: true,
    matches: (_, type) => type === 'application/pdf',
    render: (a, { url }) =>
      url ? <Box component="iframe" display="block" w="100%" h="32rem" bd="1px solid var(--mantine-color-default-border)" bdrs="sm" sandbox="" src={url} title={label(a)} loading="lazy" /> : null
  },
  {
    id: 'text',
    wide: true,
    matches: (a, type) => a.text !== undefined || type.startsWith('text/') || /(json|xml|yaml|x-ndjson|x-diff)/.test(type),
    render: (a, { path }) => <TextValue attachment={a} path={path} />
  }
];
export function registerArtifactRenderer(renderer: ArtifactRenderer) {
  artifactRenderers.unshift(renderer);
}
function sizeOf(bytes: number | undefined) {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
/** Where an attachment's bytes are, if a browser can reach them: its stored file in the layer, else its safe `http(s)` address. */
export function attachmentSource(attachment: Attachment, layer: string): { path: string | null; url: string | null } {
  const path = attachment.bundleKey
    ? `/layers/${encodeURIComponent(layer)}/blobs/${attachment.bundleKey.split('/').map(encodeURIComponent).join('/')}`
    : null;
  return { path, url: path ? reportAssetUrl(path) : safeUri(attachment.uri) };
}
/**
 * One attachment as a card: it plays or shows itself when it can, and always says what it is (name, role, type, size,
 * duration, tags) and how to get it. A file that has no address, has an address that is not a web address, or that
 * nothing can preview says so in words. Pass `link` for a control that opens this one artifact, `note` for how it
 * relates to the rest of the report, and `selected` to mark the one a link pointed at (it scrolls into view).
 */
export function ArtifactCard({
  attachment,
  layer,
  link,
  note,
  selected,
  tile,
  hidden,
  bare
}: {
  attachment: Attachment;
  layer: string;
  link?: ReactNode;
  note?: ReactNode;
  selected?: boolean;
  /** One tile of a grid of pictures: the picture keeps to a thumbnail's height and the caption is compact. */
  tile?: boolean;
  /** A slide of the media carousel that is not the one on screen: it stays in the page, out of sight. */
  hidden?: boolean;
  /** A slide of the media carousel: no frame of its own. */
  bare?: boolean;
}) {
  const type = mediaType(attachment);
  const { path, url } = attachmentSource(attachment, layer);
  const renderer = artifactRenderers.find((candidate) => candidate.matches(attachment, type));
  const body = renderer?.render(attachment, { url, path, type, tile });
  const Icon = fileIcon(type);
  const item = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) item.current?.scrollIntoView?.({ block: 'center' });
  }, [selected]);
  const scope = effectiveScope(attachment.scope, useScope());
  // A recording says what it shows before it is played; evidence that declared a scope of its own says so too.
  const scoped = isVideoAttachment(attachment) || attachment.scope !== undefined;
  return (
    <Paper
      component="li"
      display={hidden ? 'none' : 'block'}
      aria-hidden={hidden || undefined}
      ref={item}
      withBorder={!bare}
      radius="md"
      p={bare ? 0 : tile ? 'xs' : 'sm'}
      miw={0}
      data-wide={renderer?.wide || undefined}
      data-role={attachment.role ?? roleOfType(type)}
      data-selected={selected || undefined}
      bg={selected ? 'var(--mantine-color-primary-light)' : undefined}
    >
      <Stack gap="xs" miw={0}>
        {scoped && <ScopeNotice scope={scope} name={attachment.name} />}
        {body}
        <Group component="figcaption" gap="sm" wrap="nowrap" align="center" miw={0}>
          {!tile && (
            <ThemeIcon variant="default" size="lg" radius="md" c="dimmed" visibleFrom="xs">
              <Icon size={18} stroke={1.5} aria-hidden="true" />
            </ThemeIcon>
          )}
          <Stack gap={0} flex={1} miw={0}>
            <Group gap={6} wrap="wrap" align="center">
              <Text span fw={600} lineClamp={tile ? 1 : undefined} title={attachment.name}>
                {attachment.name}
              </Text>
              {selected && (
                <Badge variant="light" size="sm">
                  Selected
                </Badge>
              )}
              {attachment.role && (
                <Badge variant="default" size="sm">
                  {attachment.role}
                </Badge>
              )}
            </Group>
            <Text span c="dimmed" size="xs" lineClamp={tile ? 1 : undefined}>
              {[type, sizeOf(attachment.bytes), attachment.durationMs ? duration(attachment.durationMs) : ''].filter(Boolean).join(' · ')}
            </Text>
          </Stack>
          {url && (
            <Button
              component="a"
              href={url}
              download={attachment.name}
              target="_blank"
              rel="noreferrer"
              variant="subtle"
              size="compact-sm"
              leftSection={body ? <IconDownload size={14} aria-hidden="true" /> : <IconExternalLink size={14} aria-hidden="true" />}
            >
              {body ? 'Download' : 'Open'}
            </Button>
          )}
          {link}
        </Group>
        {!url && attachment.text === undefined && (
          <Alert role={selected ? 'alert' : undefined} color="orange" data-unavailable>
            {attachment.uri
              ? 'No file to show. This file is only given by an address that is not a web address, so Atlas will not follow it. Ask the producer for a web address or to upload the file.'
              : 'No file to show. The report lists this file, but it was never stored, so it cannot be shown or downloaded. Publish it again with the file attached.'}
          </Alert>
        )}
        {url && !renderer && (
          <Text component="div" c="dimmed" size="xs" data-no-preview>
            Atlas has no preview for this kind of file. Open or download it to inspect it.
          </Text>
        )}
        {note}
        <ArtifactTagList attachment={attachment} />
      </Stack>
    </Paper>
  );
}
/** Pictures are tiles of a grid; recordings, pages and text take a whole row; a file nothing previews is a row with its name and a download. */
function groupOf(attachment: Attachment): 'wide' | 'tile' | 'file' {
  const type = mediaType(attachment);
  const renderer = artifactRenderers.find((candidate) => candidate.matches(attachment, type));
  if (!renderer || !attachmentSourceKnown(attachment)) return renderer?.id === 'text' ? 'wide' : 'file';
  if (renderer.wide) return 'wide';
  return type.startsWith('image/') ? 'tile' : 'file';
}
const attachmentSourceKnown = (attachment: Attachment) => Boolean(attachment.bundleKey) || safeUri(attachment.uri) !== null;
/** Whether an attachment is something to look at or play (a picture, a recording, a sound) that the page can show. */
function isMedia(attachment: Attachment): boolean {
  const type = mediaType(attachment);
  return (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) && groupOf(attachment) !== 'file';
}
/**
 * The pictures and recordings of one result, one at a time and as large as the page allows, with arrows, a count and a
 * strip to choose from. Every slide stays in the page (a recording keeps its place for the steps that seek it); only the
 * chosen one is on screen.
 */
function MediaCarousel({ items, layer }: { items: readonly { attachment: Attachment; index: number }[]; layer: string }) {
  const [at, setAt] = useState(0);
  const current = Math.min(at, items.length - 1);
  const step = (by: number) => setAt((current + by + items.length) % items.length);
  const many = items.length > 1;
  return (
    <Stack
      component="section"
      aria-label="Media"
      aria-roledescription="carousel"
      gap="xs"
      miw={0}
      data-media-carousel
      onKeyDown={(event) => {
        // Arrow keys belong to a focused player or slider; elsewhere in the carousel they change the slide.
        const target = event.target as HTMLElement;
        if (!many || ['VIDEO', 'AUDIO', 'INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.getAttribute('role') === 'slider') return;
        if (event.key === 'ArrowLeft') step(-1);
        else if (event.key === 'ArrowRight') step(1);
        else return;
        event.stopPropagation();
      }}
    >
      {many && (
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Text size="sm" c="dimmed" role="status" aria-live="polite" truncate>
            {current + 1} of {items.length} · {items[current]!.attachment.name}
          </Text>
          <ActionIcon.Group>
            <ActionIcon variant="default" size="md" aria-label="Previous picture or recording" onClick={() => step(-1)}>
              <IconChevronLeft size={16} aria-hidden="true" />
            </ActionIcon>
            <ActionIcon variant="default" size="md" aria-label="Next picture or recording" onClick={() => step(1)}>
              <IconChevronRight size={16} aria-hidden="true" />
            </ActionIcon>
          </ActionIcon.Group>
        </Group>
      )}
      <Stack component="ul" gap="sm" p={0} m={0}>
        {items.map(({ attachment, index }, slide) => (
          <ArtifactCard key={`${attachment.id ?? attachment.name}:${index}`} attachment={attachment} layer={layer} hidden={slide !== current} bare />
        ))}
      </Stack>
      {many && (
        <ScrollArea type="auto" offsetScrollbars="x" scrollbarSize={6}>
          <Group gap={6} wrap="nowrap" role="group" aria-label="Choose a picture or recording">
            {items.map(({ attachment, index }, slide) => {
              const type = mediaType(attachment);
              const { url } = attachmentSource(attachment, layer);
              const Icon = fileIcon(type);
              return (
                <UnstyledButton
                  key={`${attachment.id ?? attachment.name}:${index}`}
                  aria-label={`Show ${attachment.name}`}
                  aria-pressed={slide === current}
                  title={attachment.name}
                  onClick={() => setAt(slide)}
                  w={88}
                  h={56}
                  flex="none"
                  bdrs="sm"
                  bd={slide === current ? '2px solid var(--mantine-primary-color-filled)' : '1px solid var(--mantine-color-default-border)'}
                  bg="var(--mantine-color-default-hover)"
                  c="dimmed"
                >
                  <Center h="100%">
                    {type.startsWith('image/') && url ? (
                      <Image src={url} alt="" loading="lazy" decoding="async" fit="cover" w="100%" h="100%" radius="xs" />
                    ) : (
                      <Icon size={20} stroke={1.5} aria-hidden="true" />
                    )}
                  </Center>
                </UnstyledButton>
              );
            })}
          </Group>
        </ScrollArea>
      )}
    </Stack>
  );
}
export function Attachments({ attachments: all, layer }: { attachments: readonly Attachment[]; layer: string }) {
  const attachments = useFilteredAttachments(all);
  if (!attachments.length) return null;
  const indexed = attachments.map((attachment, index) => ({ attachment, index }));
  const media = indexed.filter(({ attachment }) => isMedia(attachment));
  const rest = indexed.filter(({ attachment }) => !isMedia(attachment));
  return (
    <Stack aria-label="Attachments" component="section" gap="sm" miw={0}>
      {media.length > 0 && <MediaCarousel items={media} layer={layer} />}
      <Title order={3} size="sm" c="dimmed" fw={500}>
        {plural(attachments.length, 'attachment', 'attachments')}
      </Title>
      {rest.length > 0 && (
        <Stack component="ul" gap="sm" p={0} m={0}>
          {rest.map(({ attachment, index }) => (
            <ArtifactCard key={`${attachment.id ?? attachment.name}:${index}`} attachment={attachment} layer={layer} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
const STEP_STATUS: Record<string, 'passed' | 'failed' | 'running' | 'not-run'> = {
  passed: 'passed',
  pass: 'passed',
  ok: 'passed',
  failed: 'failed',
  fail: 'failed',
  error: 'failed',
  running: 'running',
  skipped: 'not-run',
  'not-run': 'not-run',
  'not-reached': 'not-run',
  pending: 'not-run'
};
/** The timeline: ordered by when each step started, nested by `parentId`. A step whose parent is missing is shown at the top. */
export function Timeline({ steps, layer }: { steps: readonly Step[]; layer: string }) {
  const tree = useMemo(() => {
    const ids = new Set(steps.flatMap((step) => (step.id ? [step.id] : [])));
    const children = new Map<string | null, Step[]>();
    for (const step of steps) {
      const parent = step.parentId && ids.has(step.parentId) ? step.parentId : null;
      children.set(parent, [...(children.get(parent) ?? []), step]);
    }
    for (const list of children.values()) list.sort((a, b) => (a.offsetMs ?? 0) - (b.offsetMs ?? 0));
    return children;
  }, [steps]);
  const render = (parent: string | null): ReactNode => (
    <List spacing={2} listStyleType="none" type="ordered" pl={parent === null ? 0 : 'lg'}>
      {(tree.get(parent) ?? []).map((step, index) => (
        <TimelineStep key={`${step.id ?? step.name}:${index}`} step={step} layer={layer}>
          {step.id && tree.has(step.id) && render(step.id)}
        </TimelineStep>
      ))}
    </List>
  );
  return (
    <Stack aria-label="Timeline" component="section" gap="sm" miw={0}>
      <Title order={3}>{plural(steps.length, 'step', 'steps')}</Title>
      <MomentBar />
      {render(null)}
    </Stack>
  );
}
/** One step of the timeline: its outcome and times, a control to show it in the recording when there is one, and what it carries. */
function TimelineStep({ step, layer, children }: { step: Step; layer: string; children: ReactNode }) {
  const status = STEP_STATUS[(step.status ?? '').toLowerCase()];
  const playing = useIsPlaying(step);
  return (
    <List.Item
      data-evidence-step
      data-status={status ?? step.status ?? 'none'}
      data-playing={playing || undefined}
      aria-current={playing ? 'step' : undefined}
      bg={playing ? 'var(--mantine-color-primary-light)' : undefined}
      bdrs="sm"
      px="xs"
      py={6}
    >
      <Stack gap="xs" miw={0}>
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Box pt={3} lh={1}>
            <StatusMark status={status ?? 'none'} size={14} />
          </Box>
          <Group gap={6} wrap="wrap" align="center" flex={1} miw={0}>
            <Text span fw={playing || status === 'failed' ? 600 : undefined}>
              {step.name}
            </Text>
            {step.kind && (
              <Badge variant="default" size="xs">
                {step.kind}
              </Badge>
            )}
            {step.status && !status && (
              <Badge color="gray" size="xs">
                {step.status}
              </Badge>
            )}
            {playing && (
              <Badge variant="light" size="sm">
                Playing now
              </Badge>
            )}
          </Group>
          <Group gap="xs" wrap="wrap" justify="flex-end" align="center">
            <SeekStep step={step} />
            <Text span c="dimmed" size="xs">
              {[step.offsetMs !== undefined ? `+${duration(step.offsetMs)}` : '', duration(step.durationMs)].filter(Boolean).join(' · ')}
            </Text>
          </Group>
        </Group>
        {step.detail &&
          (status === 'failed' ? (
            <Code block c="red.7" ml="lg">
              {step.detail}
            </Code>
          ) : (
            <Text component="div" c="dimmed" ml="lg">
              {step.detail}
            </Text>
          ))}
        {step.annotations && <Notes notes={step.annotations} />}
        {step.attachments && <Attachments attachments={step.attachments} layer={layer} />}
        {children}
      </Stack>
    </List.Item>
  );
}
export function Notes({ notes }: { notes: readonly Annotation[] }) {
  if (!notes.length) return null;
  return (
    <List aria-label="Annotations" spacing="xs" listStyleType="none">
      {notes.map((note, index) => (
        <List.Item key={index}>
        <Alert color={note.level === 'error' ? 'red' : note.level === 'warning' ? 'orange' : 'gray'} p="xs">
          <Text data-level={note.level ?? 'info'} span inherit fw={600} tt="capitalize">
            {note.level && ['info', 'warning', 'error'].includes(note.level) ? note.level : note.type}
          </Text>{' '}
          <Text span inherit>
            {note.message}
            {note.source?.file && (
              <Text span inherit c="dimmed">
                {' '}
                {note.source.file}
                {note.source.line ? `:${note.source.line}` : ''}
              </Text>
            )}
            {note.level && !['info', 'warning', 'error'].includes(note.level) && (
              <Text span inherit c="dimmed">
                {' '}
                ({note.level})
              </Text>
            )}
          </Text>
        </Alert>
        </List.Item>
      ))}
    </List>
  );
}
const NO_FILES: readonly Attachment[] = [];
function Tries({ attempts, layer }: { attempts: readonly Attempt[]; layer: string }) {
  if (!attempts.length) return null;
  return (
    <Stack aria-label="Tries" component="section" gap="sm" miw={0}>
      <Title order={3}>{plural(attempts.length, 'try', 'tries')}</Title>
      <List spacing="sm" listStyleType="none" type="ordered">
        {attempts.map((attempt) => (
          <List.Item key={attempt.index} data-attempt={attempt.index}>
            <Paper withBorder radius="md" p="sm">
              <Stack gap="sm" miw={0}>
                <Group gap="xs" align="center" wrap="nowrap">
                  <StatusMark status={attempt.status} size={14} />
                  <Text span fw={600} flex={1}>
                    Try {attempt.index + 1}
                  </Text>
                  <Text span c="dimmed" size="xs">
                    {duration(attempt.durationMs)}
                  </Text>
                </Group>
                {attempt.detail &&
                  (attempt.status === 'failed' ? (
                    <Code block c="red.7">
                      {attempt.detail}
                    </Code>
                  ) : (
                    <Text component="div" c="dimmed">
                      {attempt.detail}
                    </Text>
                  ))}
                <ScopeProvider scope={attempt.scope}>
                  {/* A try is placed in its own recording with that recording's own timing, never in another try's. */}
                  <MomentPlayback steps={attempt.steps} attachments={attempt.attachments ?? NO_FILES} layer={layer}>
                    {attempt.steps && attempt.steps.length > 0 ? <Timeline steps={attempt.steps} layer={layer} /> : <MomentBar />}
                    {attempt.attachments && <Attachments attachments={attempt.attachments} layer={layer} />}
                  </MomentPlayback>
                </ScopeProvider>
              </Stack>
            </Paper>
          </List.Item>
        ))}
      </List>
    </Stack>
  );
}
/** What is not known: kept, and shown as it is, so nothing a tool recorded is out of reach. */
function Raw({ extensions }: { extensions: Readonly<Record<string, unknown>> }) {
  const names = Object.keys(extensions);
  if (!names.length) return null;
  return (
    <Accordion variant="separated">
      <Accordion.Item value="content">
        <Accordion.Control>
          {plural(names.length, 'extension', 'extensions')}: {names.join(', ')}
        </Accordion.Control>
        <Accordion.Panel>
          <Code block>{JSON.stringify(extensions, null, 2)}</Code>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
function Facts({ holder }: { holder: EvidenceHolder }) {
  const labels = Object.entries(holder.labels ?? {});
  const tags = holder.tags ?? [];
  const links = (holder.links ?? []).flatMap((link) => {
    const url = safeUri(link.url);
    return url ? [{ ...link, url }] : [];
  });
  if (!labels.length && !tags.length && !links.length) return null;
  return (
    <Stack gap="xs" component="section" aria-label="Recorded facts">
      <Title order={3}>Facts</Title>
      <Group component="ul" aria-label="Facts" gap="xs" p={0} m={0} align="stretch">
        {labels.map(([name, value]) => (
          <Paper component="li" display="block" key={`l:${name}`} withBorder radius="md" px="sm" py={6}>
            <Text span c="dimmed" size="xs" display="block">
              {name}
            </Text>{' '}
            <Text span inherit fw={600} fz="sm">
              {value}
            </Text>
          </Paper>
        ))}
        {tags.map((tag) => (
          <Box component="li" display="flex" key={`t:${tag}`}>
            <Badge variant="default" size="lg" my="auto">
              {tag}
            </Badge>
          </Box>
        ))}
        {links.map((link) => (
          <Box component="li" display="flex" key={`k:${link.url}`}>
            <Anchor href={link.url} target="_blank" rel="noreferrer" my="auto">
              {link.name ?? link.rel ?? link.url}
            </Anchor>
          </Box>
        ))}
      </Group>
    </Stack>
  );
}
function Evidence({ holder, layer, steps = false, owner }: { holder: EvidenceHolder; layer: string; steps?: boolean; owner?: string }) {
  return (
    <ScopeProvider scope={holder.scope}>
      <MomentPlayback steps={steps ? holder.steps : undefined} attachments={holder.attachments ?? NO_FILES} layer={layer} primary={steps} owner={owner}>
        {holder.attachments && <Attachments attachments={holder.attachments} layer={layer} />}
        <Facts holder={holder} />
        {holder.annotations && <Notes notes={holder.annotations} />}
        {steps && holder.steps && holder.steps.length > 0 ? <Timeline steps={holder.steps} layer={layer} /> : <MomentBar />}
        {holder.attempts && holder.attempts.length > 1 && <Tries attempts={holder.attempts} layer={layer} />}
        {holder.extensions && <Raw extensions={holder.extensions} />}
      </MomentPlayback>
    </ScopeProvider>
  );
}
/** The full evidence of one result, read only when `enabled` and the result has some to read (an archived layer). Shared by every view of the result, so it is read once. */
export function useCheckDetail(layer: LayerHeader, row: LayerRow, enabled = true) {
  const wanted = row.evidence !== undefined || layer.evidence !== undefined;
  return useQuery({
    queryKey: ['evidence-detail', layer.backend, layer.id, row.kind, row.id],
    queryFn: ({ signal }) =>
      reportJson<CheckDetail>(
        `/evidence/detail/${encodeURIComponent(layer.backend)}/${encodeURIComponent(layer.id)}?check=${encodeURIComponent(row.id)}&kind=${encodeURIComponent(row.kind)}`,
        signal
      ),
    enabled: enabled && wanted && /^[0-9a-f]{64}$/.test(layer.id),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
}
/** Everything one result carries beyond its outcome, read when it is opened, and what the run around it carried. */
export function ResultEvidence({ layer, row }: { layer: LayerHeader; row: LayerRow }) {
  const wanted = row.evidence !== undefined || layer.evidence !== undefined;
  const detail = useCheckDetail(layer, row);
  const requested = useRequestedMoment();
  if (!wanted) return null;
  if (detail.isLoading)
    return (
      <Stack gap="xs">
        <Text role="status" component="div" c="dimmed">
          Loading what this result carries…
        </Text>
        <Skeleton height="1rem" radius="sm" />
        <Skeleton height="1rem" radius="sm" w="70%" />
      </Stack>
    );
  if (detail.isError || !detail.data)
    return (
      <Alert role="alert" color="red">
        What this result carries could not be read.
      </Alert>
    );
  const { check, run, inheritedScope } = detail.data;
  const declared = effectiveScope(check.scope, inheritedScope);
  const hasRun = Object.values(run).some((value) =>
    Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.keys(value).length > 0 : false
  );
  return (
    <ArtifactTagsProvider layer={layer.id} kind={row.kind} check={row.id} holders={[check, run]}>
      <Stack aria-label="Evidence" gap="md" miw={0}>
        <TagFilterBar holders={[check, run]} />
        {requested.clip !== undefined && requested.layer === layer.id && ![...videosIn(check), ...videosIn(run)].some((video) => attachmentIdentity(video) === requested.clip) && (
          <Alert role="status" color="orange" title="The recording this link names is not in this result" data-moment-missing>
            The link names a recording that this run did not record for this check. Nothing is played in its place, and no other run is
            substituted.
          </Alert>
        )}
        <ScopeProvider scope={inheritedScope}>
          <Evidence holder={check} layer={layer.id} steps owner={momentOwner(layer.id, row.kind, row.id)} />
        </ScopeProvider>
        {declared && (
          <Box aria-label="Scope of this result" component="section">
            <ScopeNotice scope={declared} name={row.title} />
          </Box>
        )}
        {hasRun && (
          <Stack aria-label="From the run" component="section" gap="md" miw={0}>
            <Divider />
            <Title order={3}>From the run</Title>
            <Evidence holder={run} layer={layer.id} />
          </Stack>
        )}
      </Stack>
    </ArtifactTagsProvider>
  );
}
