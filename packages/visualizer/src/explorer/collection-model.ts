/**
 * @module Review collection model
 *
 * The small pure parts of the Collections tab: reading and writing the time of a note in a recording (`1:05`), how many
 * distinct runs and layers a collection's entries come from (so the page never lets entries from several executions read
 * as one), and the tags field. The page is `collections.tsx`.
 */
import type { ReviewCollection } from '@crvouga/atlas/reports/review-collection';

/**
 * A moment in a recording as the person typed it, in milliseconds: `75` is seconds, `1:15` minutes and seconds, `1:02:03`
 * hours too. Empty is no time (`null`, valid); anything else that is not a time is `undefined`, so a mistake is told apart
 * from no time. Fractions of a second are kept (`1:15.5`).
 */
export function parseTimecode(raw: string): number | null | undefined {
  const value = raw.trim();
  if (value === '') return null;
  const parts = value.split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return undefined;
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return Math.round(seconds * 1000);
}

/** A moment in a recording for a person: `1:15`, or `1:02:03` from an hour. */
export function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/** How many distinct runs and layers (executions) a collection's entries were recorded in. More than one run means the collection is not one execution. */
export function sourceSpread(collection: Pick<ReviewCollection, 'entries'>): { readonly runs: number; readonly layers: number } {
  return {
    runs: new Set(collection.entries.map((entry) => entry.snapshot.run)).size,
    layers: new Set(collection.entries.map((entry) => entry.source.layer)).size
  };
}

/** The tags typed in a field (commas or spaces apart), without repeats; the server normalizes them. */
export function parseTagsField(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((tag) => tag.trim()).filter(Boolean))];
}
