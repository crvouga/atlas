/**
 * @module Recording playlist
 *
 * The order and the honesty of a watch session: a filtered set of recorded results becomes an ordered list of entries,
 * each with what can be said about its recording before anything is downloaded. Every result of the set is an entry
 * (a failed one is never dropped, and one without a recording says so) and the order is the order of the set it came
 * from, so the same filters give the same playlist. Pure functions; the player is `playlist.tsx`.
 */
import { videoCounts } from '@crvouga/atlas/reports/evidence-detail';
import type { VideoRef } from '@crvouga/atlas/reports/evidence-types';
import type { EvidenceStatus } from '@crvouga/atlas/reports/explorer-types';
import type { ReviewAvailability, ReviewCollection } from '@crvouga/atlas/reports/review-collection';
import type { ArtifactResult, RunLayer, RunResult } from '@crvouga/atlas/reports/test-catalog';

/** One recorded result in a playlist: where to read its evidence, what to say about it, and its video references. */
export type PlaylistEntry = {
  /** Identifies the entry for as long as the set is the same; selection follows it, never a position. */
  readonly id: string;
  readonly title: string;
  /** The test's key, to open it. */
  readonly key: string;
  readonly specPath: string | null;
  readonly status: EvidenceStatus;
  readonly environment: string | null;
  readonly producer: string;
  /** When it was recorded, epoch ms. */
  readonly at: number;
  /** The layer that recorded it and the backend to read it from; null when the backend is not known (an older server). */
  readonly layer: string;
  readonly backend: string | null;
  /** The check's id and, when known, the kind of its part: with the layer they name the evidence to read. */
  readonly check: string;
  readonly kind: string | null;
  /** The tags its attachments carry. */
  readonly tags: readonly string[];
  /** Every video its evidence references. */
  readonly videos: readonly VideoRef[];
};

/**
 * What is known about an entry's recording: `playable` (a stored file can be tried), `unplayable` (referenced, but no
 * bytes were published, or the backend to read them from is unknown), `api-only` (no recording and recorded through
 * an API, so there is no screen) or `none`.
 */
export type RecordingState = 'playable' | 'unplayable' | 'api-only' | 'none';

/** Environments a reader cannot watch: a result recorded only through these has no screen. */
const API_ENVIRONMENT = /^(api|http|rest|graphql|service|backend)(-|$)/;

/** The state of an entry's recording. Only `playable` means there is something to watch; none of the others is a pass with proof. */
export function recordingState(entry: Pick<PlaylistEntry, 'videos' | 'backend' | 'environment'>): RecordingState {
  const counts = videoCounts(entry.videos);
  if (counts && counts.recordings > 0) return entry.backend === null ? 'unplayable' : 'playable';
  if (counts) return 'unplayable';
  return entry.environment !== null && API_ENVIRONMENT.test(entry.environment) ? 'api-only' : 'none';
}

/** What each state says to a person. A recording is never described as demonstrating anything it does not. */
export const RECORDING_STATE_TEXT: Record<RecordingState, { readonly label: string; readonly meaning: string }> = {
  playable: { label: 'Recording', meaning: 'A recording is stored for this result.' },
  unplayable: { label: 'Recording not available', meaning: 'This result references a recording, but no stored file can be played, so it is not demonstrated.' },
  'api-only': { label: 'API only', meaning: 'This result was recorded through an API, so there is no screen to watch. It is not demonstrated by a recording.' },
  none: { label: 'No recording', meaning: 'No recording was published for this result, so it is not demonstrated by one.' }
};

/** The first video of an entry that names bytes: the one that is played. */
export function playableVideo(entry: Pick<PlaylistEntry, 'videos'>): VideoRef | undefined {
  return entry.videos.find((video) => video.available && video.recording !== undefined);
}

/** The recorded results of the Artifacts tab as playlist entries, in their order. */
export function entriesFromArtifacts(results: readonly ArtifactResult[]): PlaylistEntry[] {
  return results.map((result) => ({
    id: `${result.layer}|${result.key}|${result.kind}|${result.producer}|${result.environment ?? ''}`,
    title: result.title,
    key: result.key,
    specPath: result.specPath,
    status: result.status,
    environment: result.environment,
    producer: result.producer,
    at: result.at,
    layer: result.layer,
    backend: result.backend,
    check: result.id,
    kind: result.kind,
    tags: result.artifactTags,
    videos: result.videos ?? []
  }));
}

/** The results of one run as playlist entries, in their order; `layers` say which backend each result's layer was read from. */
export function entriesFromRun(results: readonly RunResult[], layers: readonly RunLayer[] | undefined): PlaylistEntry[] {
  const backends = new Map((layers ?? []).map((layer) => [layer.id, layer.backend]));
  return results.map((result) => ({
    id: `${result.layer}|${result.key}||${result.producer}|${result.environment ?? ''}`,
    title: result.title,
    key: result.key,
    specPath: result.specPath,
    status: result.status,
    environment: result.environment,
    producer: result.producer,
    at: result.at,
    layer: result.layer,
    backend: backends.get(result.layer) ?? null,
    check: result.id,
    kind: null,
    tags: [...new Set((result.videos ?? []).flatMap((video) => video.tags ?? []))].sort(),
    videos: result.videos ?? []
  }));
}

/**
 * The entries of a review collection as playlist entries, in the collection's order (never re-sorted). Each is what the
 * collection froze: its recorded status and time. An entry whose layer is gone has no backend to read, so it is said to
 * have no recording that can be played rather than dropped. An entry that names one recording lists only that one.
 */
export function entriesFromCollection(collection: Pick<ReviewCollection, 'entries'>, availability: readonly ReviewAvailability[]): PlaylistEntry[] {
  const gone = new Set(availability.filter((item) => item.state === 'unavailable').map((item) => item.entry));
  return collection.entries.map((entry) => {
    const videos = ((entry.snapshot.videos ?? []) as readonly VideoRef[]).filter((video) => entry.source.recording === undefined || video.recording === entry.source.recording);
    return {
      id: entry.id,
      title: entry.snapshot.title,
      key: entry.snapshot.testKey,
      specPath: entry.snapshot.specPath,
      status: entry.snapshot.status,
      environment: entry.snapshot.environment,
      producer: entry.snapshot.producer,
      at: entry.snapshot.recordedAtMs,
      layer: entry.source.layer,
      backend: gone.has(entry.id) ? null : entry.snapshot.backend,
      check: entry.source.check,
      kind: entry.source.kind ?? null,
      tags: [...new Set(videos.flatMap((video) => video.tags ?? []))].sort(),
      videos
    };
  });
}

/** How many entries are in each state, and how many failed (a failure is counted whether or not it was recorded). */
export function playlistCounts(entries: readonly PlaylistEntry[]): Record<RecordingState, number> & { readonly failed: number } {
  const counts = { playable: 0, unplayable: 0, 'api-only': 0, none: 0, failed: 0 };
  for (const entry of entries) {
    counts[recordingState(entry)] += 1;
    if (entry.status === 'failed') counts.failed += 1;
  }
  return counts;
}

/**
 * The entry to go to from `from`, over the entries that can be watched. `step` is 1 for next, -1 for previous. Past the
 * end it wraps to the other end when `wrap`, else it is null. From an entry that cannot be watched (selected from the
 * list to read why), it is the nearest watchable one in that direction.
 */
export function stepFrom(entries: readonly PlaylistEntry[], from: string | null, step: 1 | -1, wrap: boolean): PlaylistEntry | null {
  const at = from === null ? -1 : entries.findIndex((entry) => entry.id === from);
  const watchable = (entry: PlaylistEntry) => recordingState(entry) === 'playable';
  const ordered = step === 1 ? entries.map((entry, index) => [entry, index] as const) : entries.map((entry, index) => [entry, index] as const).reverse();
  const after = ordered.filter(([entry, index]) => watchable(entry) && (at < 0 ? true : step === 1 ? index > at : index < at));
  if (after.length > 0) return after[0]![0];
  if (!wrap) return null;
  return ordered.find(([entry]) => watchable(entry))?.[0] ?? null;
}
