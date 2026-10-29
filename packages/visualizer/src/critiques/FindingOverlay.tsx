/**
 * @module Finding overlays
 *
 * A critic's findings drawn where they were found, on the picture they are about. A finding's region is in the unit the critic stated:
 * `normalized` (0..1 of the picture) or `px` (pixels of the stored picture, which needs the picture's size, taken from the catalog
 * or from the loaded image). A region in any other unit cannot be placed and is not drawn; the findings table still says where in
 * words. Every box carries the finding's number, so it is never told apart by color alone, and the picture keeps its own alternative text.
 * An overlay is an opinion drawn over evidence: it changes nothing about the picture and is never a result.
 */
import type { EntryCritique } from '@crvouga/atlas/reports/ui-catalog-entries';
import { Badge, Box, Image } from '@mantine/core';
import { useState } from 'react';

type CritiqueFinding = NonNullable<EntryCritique['critique']['findings']>[number];

/** The color of a severity, as the table shows it. Unknown severities are gray. */
export const SEVERITY_COLOR: Readonly<Record<string, string>> = { major: 'red', minor: 'yellow', info: 'blue' };

/** A region as percentages of the picture, or `null` when it cannot be placed (an unknown unit, no known size for pixels, or not finite numbers). */
export function regionBox(region: NonNullable<CritiqueFinding['region']>, size: { readonly width: number; readonly height: number } | null): { left: number; top: number; width: number; height: number } | null {
  const [fx, fy] = region.unit === 'normalized' ? [1, 1] : region.unit === 'px' && size ? [size.width, size.height] : [0, 0];
  if (!fx || !fy || ![region.x, region.y, region.w, region.h].every(Number.isFinite)) return null;
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  const left = clamp((region.x / fx) * 100), top = clamp((region.y / fy) * 100);
  return { left, top, width: Math.min(100 - left, clamp((region.w / fx) * 100)), height: Math.min(100 - top, clamp((region.h / fy) * 100)) };
}

/** The picture with a numbered box for each finding that has a region. `selected` (an index into `findings`) is drawn thicker. */
export function FindingOverlay({ src, alt, size, findings, selected, show }: {
  src: string; alt: string; size?: { width?: number | undefined; height?: number | undefined };
  findings: readonly CritiqueFinding[]; selected: number | null; show: boolean;
}) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const known = size?.width && size.height ? { width: size.width, height: size.height } : natural;
  return (
    <Box pos="relative" w="fit-content" maw="100%">
      <Image src={src} alt={alt} loading="lazy" fit="contain" onLoad={(event) => { const img = event.currentTarget; if (img.naturalWidth && img.naturalHeight) setNatural({ width: img.naturalWidth, height: img.naturalHeight }); }} />
      {show && findings.map((finding, index) => {
        const box = finding.region ? regionBox(finding.region, known) : null;
        if (!box) return null;
        const color = SEVERITY_COLOR[finding.severity ?? ''] ?? 'gray';
        return (
          <Box key={finding.id ?? index} data-finding={finding.id ?? String(index + 1)} aria-hidden pos="absolute" left={`${box.left}%`} top={`${box.top}%`} w={`${box.width}%`} h={`${box.height}%`} data-selected={selected === index} bd={`${selected === index ? 4 : 2}px solid ${color}.7`}>
            <Badge circle size="sm" color={color} variant="filled">{index + 1}</Badge>
          </Box>
        );
      })}
    </Box>
  );
}
