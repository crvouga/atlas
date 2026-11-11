import { Badge, Button, Group, Image, List, Paper, Skeleton, Stack, Text } from '@mantine/core';
import { IconPhotoOff } from '@tabler/icons-react';
import { useRef, useState, type ReactNode } from 'react';
import type { ImageMedia, ItemStatus, StateView } from '../data/model';
type PlaceholderReason = 'not-captured' | 'not-reached' | 'processing' | 'not-run' | 'spec-only';
const REASON_LABEL: Record<PlaceholderReason, string> = {
  'not-captured': 'Not captured yet',
  'not-reached': 'Not reached in this run',
  processing: 'Still processing',
  'not-run': 'Not in this run',
  'spec-only': 'Not captured yet'
};
export function placeholderReason(status: ItemStatus, media: ImageMedia | null): PlaceholderReason {
  return media?.state === 'processing'
    ? 'processing'
    : status === 'not-reached'
      ? 'not-reached'
      : status === 'not-yet-run'
        ? 'not-run'
        : status === 'spec-only'
          ? 'spec-only'
          : 'not-captured';
}
/** A specification preview is explicitly labeled; it never pretends to be a recorded screenshot. */
export function ScreenPlaceholder({
  state,
  reason,
  size,
  description = true,
  lines = true,
  caption = true
}: {
  state: StateView;
  reason: PlaceholderReason;
  size: 'thumb' | 'full';
  description?: boolean;
  lines?: boolean;
  caption?: boolean;
}) {
  const sketch = lines ? (state.hints.length ? state.hints : state.specChecks).slice(0, size === 'thumb' ? 3 : 8) : [];
  return (
    <Paper
      bd="1px dashed var(--mantine-color-default-border)"
      bg="var(--mantine-color-default-hover)"
      p={size === 'thumb' ? 'xs' : 'lg'}
      w="100%"
      role="img"
      aria-label={`${state.name}: ${REASON_LABEL[reason]}`}
    >
      {state.design ? (
        <Stack gap="xs">
          <Image src={state.design.image} alt={`Design for ${state.name}`} fit="contain" mah="60vh" radius="sm" />
          <Badge color="gray" size="sm" w="fit-content">
            Design, not a screenshot
          </Badge>
        </Stack>
      ) : (
        <Stack gap="xs">
          {description && state.description && (
            <Text size={size === 'thumb' ? 'xs' : 'sm'} c="dimmed">
              {state.description}
            </Text>
          )}
          {sketch.length > 0 && (
            <List size="xs" spacing={2} c="dimmed">
              {sketch.map((line) => (
                <List.Item key={line}>{line}</List.Item>
              ))}
            </List>
          )}
          {caption && (
            <Group gap={6} wrap="nowrap" c="dimmed">
              <IconPhotoOff size={14} aria-hidden="true" />
              <Text size="xs" fw={500}>
                {REASON_LABEL[reason]}
              </Text>
            </Group>
          )}
          {sketch.length === 0 && <Skeleton height={size === 'thumb' ? '2.5rem' : '4rem'} animate={false} />}
        </Stack>
      )}
    </Paper>
  );
}
/** Screenshot load and retry state, without a broken-image surface or lost placeholder. */
export function Screenshot({ src, alt, size, underlay }: { src: string; alt: string; size: 'thumb' | 'full'; underlay?: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const url = attempt ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}` : src;
  return (
    <Stack gap="xs">
      {state !== 'loaded' && (underlay ?? <Skeleton height={size === 'thumb' ? '6rem' : '18rem'} radius="md" />)}
      {state === 'failed' ? (
        <Stack gap="xs" role="status">
          <Text c="dimmed">Couldn’t load the screenshot.</Text>
          <Button
            size="compact-sm"
            w="fit-content"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setState('loading');
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </Stack>
      ) : (
        <Image
          key={url}
          src={url}
          alt={alt}
          fit="contain"
          maw="100%"
          mah="60vh"
          radius="md"
          bg="var(--mantine-color-default-hover)"
          bd="1px solid var(--mantine-color-default-border)"
          loading="lazy"
          decoding="async"
          draggable={false}
          display={state === 'loaded' ? 'block' : 'none'}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
        />
      )}
    </Stack>
  );
}
/** Prefer real captured evidence; otherwise render the specification's preview. */
export function ScreenImage({
  state,
  size,
  description = true,
  lines = true,
  caption = true
}: {
  state: StateView;
  size: 'thumb' | 'full';
  description?: boolean;
  lines?: boolean;
  caption?: boolean;
}) {
  const media = state.result?.screenshot ?? null;
  const src = media?.state === 'available' ? (size === 'thumb' ? (media.thumb ?? media.full) : (media.full ?? media.thumb)) : null;
  const startedAsPlaceholder = useRef(src === null);
  const placeholder = (
    <ScreenPlaceholder
      state={state}
      reason={placeholderReason(state.status, media)}
      size={size}
      description={description}
      lines={lines}
      caption={caption}
    />
  );
  return src ? (
    <Screenshot
      src={src}
      alt={`Screenshot of ${state.name}`}
      size={size}
      underlay={startedAsPlaceholder.current ? placeholder : undefined}
    />
  ) : (
    placeholder
  );
}
