/**
 * @module Review collections
 *
 * A review collection is a named, curated, ordered set of references to results that other runs recorded: a few
 * recordings from several executions, a note on what each is for, the gaps nobody recorded yet. It is curation, not a
 * test run. It has no status of its own, carries no check, never decides a result or a winner, and never claims its
 * entries are one execution: each entry keeps the layer, run, revision and status it was recorded with. A revision is
 * immutable; changing a collection is publishing a new revision, explicitly. Reviewers' notes and "reviewed" marks live
 * apart, as an append-only list with who and when, and are not outcomes.
 *
 * This module is pure and safe in a browser: how an entry is frozen from the result it points at, how an entry stands
 * now (available, unverified, unavailable), how marks fold, and the portable manifest. The store is
 * `review-collection-store.ts`.
 *
 * @see docs/server.md#review-collections
 */
import type { z } from 'zod/v4';

import type {
  ReviewAvailabilitySchema,
  ReviewCollectionDetailSchema,
  ReviewCollectionListSchema,
  ReviewCollectionSchema,
  ReviewEntrySchema,
  ReviewManifestSchema,
  ReviewNoteSchema,
  ReviewSnapshotSchema,
  ReviewSourceSchema
} from '../../schema/src/api';
import type { ArtifactResult } from './test-catalog';

/** The exact result (and optionally one recording of it) an entry points at. */
export type ReviewSource = z.infer<typeof ReviewSourceSchema>;
/** What was recorded about a source when it was frozen. */
export type ReviewSnapshot = z.infer<typeof ReviewSnapshotSchema>;
/** One entry of a collection revision. */
export type ReviewEntry = z.infer<typeof ReviewEntrySchema>;
/** One immutable revision of a collection. */
export type ReviewCollection = z.infer<typeof ReviewCollectionSchema>;
/** A recorded note, time-coded gap note or reviewed mark. */
export type ReviewNote = z.infer<typeof ReviewNoteSchema>;
/** How an entry's source stands now. */
export type ReviewAvailability = z.infer<typeof ReviewAvailabilitySchema>;
/** `GET /api/reports/review-collections/detail`: one revision, how its sources stand now, and its notes. */
export type ReviewCollectionDetail = z.infer<typeof ReviewCollectionDetailSchema>;
/** `GET /api/reports/review-collections`: the newest revision of every collection. */
export type ReviewCollectionList = z.infer<typeof ReviewCollectionListSchema>;
/** The portable index of one revision. */
export type ReviewManifest = z.infer<typeof ReviewManifestSchema>;

/** Where the revisions of collections are kept in a store: `<prefix><id>/r<revision, six digits>.json`. */
export const REVIEW_COLLECTIONS_PREFIX = 'curation/review-collections/';
/** Where reviewers' notes are kept: `<prefix><collection id>/<time>-<random>.json`, one object each. */
export const REVIEW_NOTES_PREFIX = 'curation/review-notes/';

/** A collection id as the server mints it and the address carries it. Anything else is not an id (and never reaches a store key). */
export const REVIEW_ID = /^[a-z0-9][a-z0-9-]{7,39}$/;

/** The store key of one revision of a collection. */
export function reviewCollectionKey(id: string, revision: number): string {
  return `${REVIEW_COLLECTIONS_PREFIX}${id}/r${String(revision).padStart(6, '0')}.json`;
}

/** Whether two sources name the same result and recording. `kind` counts only when both have one. */
export function sameSource(a: ReviewSource, b: ReviewSource): boolean {
  return a.layer === b.layer && a.check === b.check && (a.kind ?? '') === (b.kind ?? '') && (a.recording ?? '') === (b.recording ?? '');
}

/**
 * What is recorded about a result when an entry is frozen: its own status, time, run, commit and videos, as the layer
 * recorded them. Nothing here is the collection's opinion, and none of it is ever updated: a later run does not change it.
 */
export function snapshotOf(result: ArtifactResult): ReviewSnapshot {
  return {
    title: result.title,
    specPath: result.specPath,
    status: result.status,
    recordedAtMs: result.at,
    environment: result.environment,
    producer: result.producer,
    branch: result.branch,
    sha: result.sha,
    run: result.run,
    runUrl: result.runUrl,
    backend: result.backend,
    testKey: result.key,
    ...(result.attemptStatuses ? { attemptStatuses: [...result.attemptStatuses] } : {}),
    ...(result.videos ? { videos: structuredClone(result.videos) as unknown as NonNullable<ReviewSnapshot['videos']> } : {})
  };
}

/**
 * How the sources of a collection stand now. `layerHeld` says whether a layer is still in a backend; `results` finds the
 * results the report holds. A layer that is gone makes its entries `unavailable`; a layer that is held while the report
 * no longer lists the result (or the recording) is `unverified`, not available and not gone. Every entry keeps its place
 * and its explanation: nothing is removed or replaced.
 */
export function availabilityOf(
  collection: Pick<ReviewCollection, 'entries'>,
  layerHeld: (layer: string) => boolean,
  results: (layer: string, check: string, kind: string | undefined) => readonly ArtifactResult[]
): ReviewAvailability[] {
  return collection.entries.map((entry) => {
    const { source } = entry;
    if (!layerHeld(source.layer)) {
      return { entry: entry.id, state: 'unavailable', reason: `The layer ${source.layer.slice(0, 12)} that recorded this is no longer in any backend (it may have been deleted by garbage collection). The entry is kept as it was frozen.` };
    }
    const found = results(source.layer, source.check, source.kind);
    if (found.length === 0) {
      return { entry: entry.id, state: 'unverified', reason: 'The layer is held, but the report no longer lists this result (it is outside the history the report keeps), so it cannot be checked now.' };
    }
    if (source.recording !== undefined && !found.some((result) => result.videos?.some((video) => video.available && video.recording === source.recording))) {
      return { entry: entry.id, state: 'unverified', reason: 'The result is listed, but the recording this entry points at is not among its recordings any more.' };
    }
    return { entry: entry.id, state: 'available' };
  });
}

/**
 * Folds the notes into the reviewed marks that stand now: for each entry the newest `reviewed` or `unreviewed` decides
 * (ties in time go to the later id). Only entries currently `reviewed` are returned, with who and when. A mark is
 * curation: it is not a check outcome and does not mean anyone accepted the behavior.
 */
export function foldReviewed(notes: readonly ReviewNote[]): Record<string, { readonly by: string; readonly atMs: number }> {
  const latest = new Map<string, ReviewNote>();
  const ordered = [...notes].sort((a, b) => a.atMs - b.atMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const note of ordered) if (note.entry !== undefined && (note.kind === 'reviewed' || note.kind === 'unreviewed')) latest.set(note.entry, note);
  const out: Record<string, { by: string; atMs: number }> = {};
  for (const [entry, note] of latest) if (note.kind === 'reviewed') out[entry] = { by: note.by, atMs: note.atMs };
  return out;
}

/**
 * A name that is safe to write to any file system: the last path segment only, letters, digits, dot, dash and
 * underscore (everything else becomes `_`), no leading dot, at most 100 characters, never empty.
 *
 * @example
 * ```ts
 * safeFileName('../../etc/pass wd.webm'); // 'pass_wd.webm'
 * ```
 */
export function safeFileName(name: string): string {
  const last = name.normalize('NFC').split(/[\\/]/).filter(Boolean).at(-1) ?? '';
  const cleaned = last.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 100);
  return cleaned.length > 0 ? cleaned : 'file';
}

/** The digest in a recording identity (`sha256:<64 hex>`), or null when the identity is a bundle key or address: the bytes' hash is then not known. */
export function digestOf(recording: string | undefined): string | null {
  const match = recording === undefined ? null : /^sha256:([0-9a-f]{64})$/.exec(recording);
  return match ? match[1]! : null;
}

/**
 * The portable index of one revision: every entry with where its result came from, how it stands now, whether it was
 * marked reviewed, and the files (recordings) it references, each with its recorded digest when there is one and a name
 * that is safe to write. A file whose source cannot be read now is listed as `missing`, with the reason under `missing`
 * of the manifest, never left out. The manifest has no bytes; it is what a packer needs to build an archive that says
 * what it lacks.
 */
export function manifestOf(
  collection: ReviewCollection,
  availability: readonly ReviewAvailability[],
  reviewed: Readonly<Record<string, unknown>>,
  generatedAtMs: number
): ReviewManifest {
  const states = new Map(availability.map((item) => [item.entry, item]));
  const missing: { entry: string; reason: string }[] = [];
  const entries = collection.entries.map((entry, index) => {
    const position = index + 1;
    const state = states.get(entry.id) ?? { entry: entry.id, state: 'unverified' as const, reason: 'Not checked.' };
    const wanted = (entry.snapshot.videos ?? []).filter((video) => entry.source.recording === undefined || video.recording === entry.source.recording);
    const seen = new Set<string>();
    const files = wanted.flatMap((video) => {
      const identity = video.recording ?? `unavailable:${video.name}`;
      if (seen.has(identity)) return [];
      seen.add(identity);
      const safeName = safeFileName(video.name);
      const gone = state.state === 'unavailable' || !video.available;
      return [{
        name: video.name, safeName, path: `files/${String(position).padStart(3, '0')}-${safeName}`,
        ...(video.recording === undefined ? {} : { recording: video.recording }),
        sha256: digestOf(video.recording), missing: gone
      }];
    });
    if (state.state === 'unavailable') missing.push({ entry: entry.id, reason: state.reason ?? 'The source is gone.' });
    else for (const file of files) if (file.missing) missing.push({ entry: entry.id, reason: `${file.name}: the recording names no bytes.` });
    return {
      id: entry.id, position, ...(entry.caption === undefined ? {} : { caption: entry.caption }), source: entry.source, snapshot: entry.snapshot,
      state: state.state, ...(state.reason === undefined ? {} : { reason: state.reason }), reviewed: entry.id in reviewed, files
    };
  });
  return {
    schemaVersion: 1, generatedAtMs,
    collection: {
      id: collection.id, revision: collection.revision, title: collection.title,
      ...(collection.purpose === undefined ? {} : { purpose: collection.purpose }), ...(collection.audience === undefined ? {} : { audience: collection.audience }),
      tags: collection.tags, createdBy: collection.createdBy, createdAtMs: collection.createdAtMs
    },
    entries, gaps: collection.gaps, missing,
    notes: 'A review collection is curation. Its entries come from the results named in each source, possibly from several runs; they are not one execution. Statuses are those the layers recorded. A reviewed mark is not an outcome and not an approval. This manifest lists files and holds no bytes; a file with a null digest has no recorded hash and is unverified.'
  };
}
