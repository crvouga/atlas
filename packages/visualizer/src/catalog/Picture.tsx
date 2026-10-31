/**
 * @module UI catalog picture
 *
 * The picture of one captured cell, shared by the catalog's cards, the open state and the comparison. A picture is shown only
 * for a cell that was captured, or that failed (a picture of what the page showed, for diagnosis); every other cell says in
 * words what it is inside the same reserved frame. Pictures are `loading="lazy"` and decoded off the main thread, so only what is on screen is fetched and drawing never waits for one.
 */
import type { UiCell, UiImage } from '@crvouga/atlas/reports/ui-catalog';
import { Box, Button, Center, Image, Loader, Stack, Text, UnstyledButton } from '@mantine/core';
import { useState } from 'react';

import { reportAssetUrl } from '../evidence/api';
import { safeUri } from '../evidence/format';
import { useGallery, type GalleryImage } from './Gallery';
import { coverageWord } from './words';

/** Where a browser loads a picture from: its stored file in the layer, else its safe web address. */
export function imageSource(image: UiImage | null | undefined): string | null {
  if (!image) return null;
  return image.path ? reportAssetUrl(image.path) : safeUri(image.uri);
}

/** Describe only captured or failed cells with safe, readable image addresses. */
export function galleryImage(cell: UiCell, title: string, label?: string): GalleryImage | null {
  const source = cell.coverage === 'captured' || cell.coverage === 'failed' ? imageSource(cell.capture?.image) : null;
  return source ? { source, name: `${title}, ${label ?? cell.profile.label}`, description: `${coverageWord(cell.coverage)} · ${cell.profile.label}` } : null;
}

function Preview({ source, name, onInspect }: { source: string; name: string; onInspect: () => void }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  return <>
    <UnstyledButton pos="absolute" inset={0} w="100%" h="100%" aria-label={`Inspect ${name}`} onClick={onInspect}>
      <Image key={attempt} src={source} alt={name} loading="lazy" decoding="async" fit="contain" w="100%" h="100%"
        opacity={status === 'loaded' ? 1 : 0} aria-hidden={status !== 'loaded'} onLoad={() => setStatus('loaded')} onError={() => setStatus('error')} />
      {status === 'loading' && <Center pos="absolute" inset={0} p="sm">
        <Stack align="center" gap="xs" role="status"><Loader size="sm" /><Text size="sm">Loading image…</Text></Stack>
      </Center>}
    </UnstyledButton>
    {status === 'error' && <Center pos="absolute" inset={0} p="sm">
      <Stack align="center" gap="xs" role="alert">
        <Text size="sm" ta="center" lineClamp={2}>Image could not be loaded</Text>
        <Button variant="default" onClick={() => { setStatus('loading'); setAttempt(attempt + 1); }}>Try again</Button>
      </Stack>
    </Center>}
  </>;
}

/**
 * A fixed frame for a cell's picture, including loading, retry and missing-picture states.
 * `label` names the comparison side. `height` defaults to the catalog card's height; `100%` fills an inspection stage.
 */
export function Picture({ cell, title, height = 240, label, onInspect, emptyMessage }: {
  cell?: UiCell | null; title: string; height?: number | string; label?: string; onInspect?: () => void; emptyMessage?: string;
}) {
  const gallery = useGallery();
  const image = cell?.capture?.image;
  const source = cell && (cell.coverage === 'captured' || cell.coverage === 'failed') ? imageSource(image) : null;
  const name = [title, label ?? cell?.profile.label].filter(Boolean).join(', ');
  const empty = emptyMessage ?? (cell ? cell.coverage === 'captured'
    ? image?.omitted ? `Picture left out (${image.omitted})` : 'Captured without a picture'
    : coverageWord(cell.coverage) : 'No picture available');
  return <Box pos="relative" w="100%" h={height} flex="0 0 auto" role="group" aria-label={`${name}: image frame`}>
    {source && cell ? <Preview key={`${source}|${name}`} source={source} name={name}
      onInspect={() => onInspect ? onInspect() : gallery?.open(galleryImage(cell, title, label)!)} />
      : <Center h="100%" w="100%" p="sm">
        <Text c="dimmed" size="sm" ta="center" lineClamp={3} role="img" aria-label={`${name}: no picture`}>{empty}</Text>
      </Center>}
  </Box>;
}
