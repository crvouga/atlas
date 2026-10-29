/**
 * @module UI catalog picture
 *
 * The picture of one captured cell, shared by the catalog's cards, the open state and the comparison. A picture is shown only
 * for a cell that was captured, or that failed (a picture of what the page showed, for diagnosis); every other cell says in
 * words what it is instead of showing an empty frame. Pictures are `loading="lazy"`, so only what is on screen is fetched.
 */
import type { UiCell, UiImage } from '@crvouga/atlas/reports/ui-catalog';
import { Image, Text } from '@mantine/core';

import { reportAssetUrl } from '../evidence/api';
import { safeUri } from '../evidence/format';
import { coverageWord } from './words';

/** Where a browser loads a picture from: its stored file in the layer, else its safe web address. */
export function imageSource(image: UiImage | null | undefined): string | null {
  if (!image) return null;
  return image.path ? reportAssetUrl(image.path) : safeUri(image.uri);
}

/** The picture of a cell, or the words that say why there is none. `label` names the side of a comparison it belongs to. */
export function Picture({ cell, title, height, label }: { cell: UiCell; title: string; height?: number; label?: string }) {
  const image = cell.capture?.image;
  const source = cell.coverage === 'captured' || cell.coverage === 'failed' ? imageSource(image) : null;
  const name = `${title}, ${label ?? cell.profile.label}`;
  if (source) return <Image src={source} alt={name} loading="lazy" fit="contain" {...(height ? { h: height } : {})} {...(image?.width ? { w: 'auto', maw: '100%' } : {})} />;
  return (
    <Text c="dimmed" fz="sm" role="img" aria-label={`${name}: no picture`}>
      {cell.coverage === 'captured' ? (image?.omitted ? `Picture left out (${image.omitted})` : 'Captured without a picture') : coverageWord(cell.coverage)}
    </Text>
  );
}
