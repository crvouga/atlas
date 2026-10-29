/**
 * @module Review collections in a store
 *
 * Where review collections are kept: one immutable object per revision under `curation/review-collections/<id>/`, and
 * one small immutable object per reviewer's note under `curation/review-notes/<id>/`, named by time and a random id so
 * editors never overwrite one another. Nothing here is ever changed or deleted by the server, and nothing here touches
 * the layers the entries point at: a collection is curation beside the report, not a layer and not a test run.
 *
 * Publishing refuses; it never alters. A request the server cannot resolve to exact, held results is refused with
 * the entry that failed, and what is recorded is what was asked for, plus what the report said about each source.
 *
 * @see docs/server.md#review-collections
 */
import {
  ReviewCollectionRequestSchema,
  ReviewCollectionSchema,
  ReviewNoteInputSchema,
  ReviewNoteSchema
} from '../../schema/src/api';
import { normalizeTag, normalizeTags } from './artifact-tags';
import { readUtf8, writeUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import {
  REVIEW_COLLECTIONS_PREFIX,
  REVIEW_ID,
  REVIEW_NOTES_PREFIX,
  reviewCollectionKey,
  sameSource,
  snapshotOf,
  type ReviewCollection,
  type ReviewEntry,
  type ReviewNote,
  type ReviewSource
} from './review-collection';
import type { ArtifactResult } from './test-catalog';

/** The request was not acceptable. `status` is the HTTP status to answer: 404 (no such collection), 409 (not the newest revision) or 422. */
export class ReviewCollectionError extends Error {
  constructor(readonly status: 404 | 409 | 422, message: string) {
    super(message);
  }
}

/** Finds the recorded results of a layer's check (all kinds when `kind` is undefined). */
export type ResultFinder = (layer: string, check: string, kind: string | undefined) => readonly ArtifactResult[];

const KEY = /^curation\/review-collections\/([a-z0-9][a-z0-9-]{7,39})\/r(\d{6})\.json$/;

const first = (error: { issues: readonly { path: PropertyKey[]; message: string }[] }) => `${error.issues[0]?.path.join('.') || '(body)'}: ${error.issues[0]?.message ?? 'invalid'}`;

/** A fresh collection id: `rc-` and 16 random hex digits. */
function newId(): string {
  return `rc-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/**
 * The revisions that exist for a collection id, oldest first. Empty when there is none. Transport errors throw.
 */
export async function reviewRevisions(store: ObjectStore, id: string): Promise<number[]> {
  if (!REVIEW_ID.test(id)) return [];
  const keys = await store.listKeys(`${REVIEW_COLLECTIONS_PREFIX}${id}/`);
  return keys.flatMap((key) => {
    const match = KEY.exec(key);
    return match ? [Number(match[2])] : [];
  }).sort((a, b) => a - b);
}

/**
 * One revision of a collection (the newest when `revision` is absent), or `null` when there is none or it cannot be read
 * as a collection (unknown, never guessed at). Transport errors throw.
 */
export async function readReviewCollection(store: ObjectStore, id: string, revision?: number): Promise<{ readonly collection: ReviewCollection; readonly revisions: number[] } | null> {
  const revisions = await reviewRevisions(store, id);
  const wanted = revision ?? revisions.at(-1);
  if (wanted === undefined || !revisions.includes(wanted)) return null;
  const text = await readUtf8(store, reviewCollectionKey(id, wanted));
  if (text === null) return null;
  try {
    const parsed = ReviewCollectionSchema.safeParse(JSON.parse(text));
    return parsed.success ? { collection: parsed.data, revisions } : null;
  } catch {
    return null;
  }
}

/**
 * Validates a request (`ReviewCollectionRequestSchema`) and records it as a new immutable revision, by `by` at `atMs`.
 * Without `basedOn` it is a new collection with a new id; with it, revision `basedOn.revision + 1` of that collection,
 * and `basedOn.revision` must be the newest (409 otherwise) so two curators never silently overwrite each other.
 *
 * Every entry is resolved with `find`: it must name a result the report holds (and, when it names a recording, one of
 * that result's recordings) or the whole request is refused with 422 naming the entry. The snapshot recorded for an entry
 * is what the report says about that result, not what the request claims. Entries are kept in the order given and a
 * source may appear once. Throws {@link ReviewCollectionError}; a revision that already exists is never overwritten.
 */
export async function recordReviewCollection(store: ObjectStore, input: unknown, by: string, atMs: number, find: ResultFinder): Promise<ReviewCollection> {
  const parsed = ReviewCollectionRequestSchema.safeParse(input);
  if (!parsed.success) throw new ReviewCollectionError(422, `Not a review collection: ${first(parsed.error)}`);
  const request = parsed.data;
  const given = request.entries ?? [];
  const gapsGiven = request.gaps ?? [];
  if (given.length === 0 && gapsGiven.length === 0) throw new ReviewCollectionError(422, 'Name at least one entry or one gap.');
  const tagInputs = request.tags ?? [];
  if (tagInputs.some((tag) => normalizeTag(tag) === null)) throw new ReviewCollectionError(422, 'A tag is empty or longer than 64 characters.');
  if (gapsGiven.some((gap) => (gap.after ?? 0) > given.length)) throw new ReviewCollectionError(422, 'A gap is placed after more entries than the collection has.');

  let id: string;
  let revision = 1;
  if (request.basedOn) {
    id = request.basedOn.id;
    const existing = await reviewRevisions(store, id);
    if (existing.length === 0) throw new ReviewCollectionError(404, 'No collection has that id.');
    const newest = existing.at(-1)!;
    if (request.basedOn.revision !== newest) throw new ReviewCollectionError(409, `Revision ${request.basedOn.revision} is not the newest: revision ${newest} exists. Base the new revision on that one.`);
    revision = newest + 1;
  } else {
    id = newId();
  }

  const entries: ReviewEntry[] = [];
  for (const [index, item] of given.entries()) {
    const label = `Entry ${index + 1}`;
    const found = find(item.layer, item.check, item.kind);
    if (found.length === 0) throw new ReviewCollectionError(422, `${label}: the report holds no result "${item.check}" in layer ${item.layer.slice(0, 12)}. Take the layer and check from GET /api/reports/artifacts.`);
    if (found.length > 1) throw new ReviewCollectionError(422, `${label}: the check "${item.check}" exists in several parts of that layer (${found.map((result) => result.kind).join(', ')}). Name the kind.`);
    const result = found[0]!;
    if (item.recording !== undefined && !result.videos?.some((video) => video.available && video.recording === item.recording)) {
      throw new ReviewCollectionError(422, `${label}: that result has no such recording.`);
    }
    const source: ReviewSource = { layer: item.layer, check: item.check, kind: result.kind, ...(item.recording === undefined ? {} : { recording: item.recording }) };
    if (entries.some((entry) => sameSource(entry.source, source))) throw new ReviewCollectionError(422, `${label}: the same source is already in the collection.`);
    entries.push({ id: `e${index + 1}`, source, ...(item.caption ? { caption: item.caption } : {}), snapshot: snapshotOf(result) });
  }

  const collection: ReviewCollection = {
    schemaVersion: 1, id, revision, title: request.title.trim(),
    ...(request.purpose?.trim() ? { purpose: request.purpose.trim() } : {}),
    ...(request.audience?.trim() ? { audience: request.audience.trim() } : {}),
    tags: normalizeTags(tagInputs), entries,
    gaps: gapsGiven.map((gap, index) => ({ id: `g${index + 1}`, note: gap.note.trim(), after: gap.after ?? 0 })),
    ...(request.frozenFrom ? { frozenFrom: request.frozenFrom } : {}),
    ...(request.basedOn ? { basedOn: { id: request.basedOn.id, revision: request.basedOn.revision } } : {}),
    createdBy: by, createdAtMs: atMs
  };
  if (!collection.title) throw new ReviewCollectionError(422, 'The title is empty.');
  const key = reviewCollectionKey(id, revision);
  // A revision is never overwritten. (A store has no conditional write: two simultaneous requests for the same
  // revision can still race, which is why a new revision must name the newest one it is based on.)
  if (await store.head(key)) throw new ReviewCollectionError(409, `Revision ${revision} already exists.`);
  await writeUtf8(store, key, JSON.stringify(collection), 'application/json');
  return collection;
}

/** The newest revision of every collection in `store`, newest first. One that cannot be read as a collection is skipped. Transport errors throw. */
export async function listReviewCollections(store: ObjectStore): Promise<{ readonly collection: ReviewCollection; readonly revisions: number }[]> {
  const keys = await store.listKeys(REVIEW_COLLECTIONS_PREFIX);
  const byId = new Map<string, number[]>();
  for (const key of keys) {
    const match = KEY.exec(key);
    if (match) byId.set(match[1]!, [...(byId.get(match[1]!) ?? []), Number(match[2])]);
  }
  const read = await Promise.all([...byId].map(async ([id, revisions]) => {
    const newest = Math.max(...revisions);
    const text = await readUtf8(store, reviewCollectionKey(id, newest));
    if (text === null) return [];
    try {
      const parsed = ReviewCollectionSchema.safeParse(JSON.parse(text));
      return parsed.success ? [{ collection: parsed.data, revisions: revisions.length }] : [];
    } catch {
      return [];
    }
  }));
  return read.flat().sort((a, b) => b.collection.createdAtMs - a.collection.createdAtMs || (a.collection.id < b.collection.id ? -1 : 1));
}

/**
 * Validates a note (`ReviewNoteInputSchema`) against the revision it is about and records it as a new object, by `by` at
 * `atMs`. `note` and `gap` need text; `reviewed` and `unreviewed` need an entry; an entry must be one of the revision's;
 * a timecode needs an entry. Throws {@link ReviewCollectionError} (404 for no such collection or revision). It records
 * curation only: no layer, result or collection revision changes.
 */
export async function recordReviewNote(store: ObjectStore, input: unknown, by: string, atMs: number): Promise<ReviewNote> {
  const parsed = ReviewNoteInputSchema.safeParse(input);
  if (!parsed.success) throw new ReviewCollectionError(422, `Not a review note: ${first(parsed.error)}`);
  const { collection: id, revision, entry, kind, text, timecodeMs } = parsed.data;
  if (!REVIEW_ID.test(id)) throw new ReviewCollectionError(404, 'No collection has that id.');
  const found = await readReviewCollection(store, id, revision);
  if (!found) throw new ReviewCollectionError(404, 'No such collection revision.');
  if (entry !== undefined && !found.collection.entries.some((item) => item.id === entry)) throw new ReviewCollectionError(422, `Entry "${entry}" is not in revision ${revision}.`);
  if ((kind === 'reviewed' || kind === 'unreviewed') && entry === undefined) throw new ReviewCollectionError(422, `A "${kind}" mark names the entry.`);
  if ((kind === 'note' || kind === 'gap') && !text?.trim()) throw new ReviewCollectionError(422, `A ${kind} needs text.`);
  if (timecodeMs !== undefined && entry === undefined) throw new ReviewCollectionError(422, 'A timecode names the entry whose recording it is a moment of.');
  const noteId = `${String(atMs).padStart(16, '0')}-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const note: ReviewNote = {
    id: noteId, collection: id, revision, ...(entry === undefined ? {} : { entry }), kind,
    ...(text?.trim() ? { text: text.trim() } : {}), ...(timecodeMs === undefined ? {} : { timecodeMs }), by, atMs
  };
  await writeUtf8(store, `${REVIEW_NOTES_PREFIX}${id}/${noteId}.json`, JSON.stringify({ schemaVersion: 1, ...note }), 'application/json');
  return note;
}

/** Every recorded note of a collection (all revisions), oldest first. One that cannot be read as a note is skipped. Transport errors throw. */
export async function readReviewNotes(store: ObjectStore, id: string): Promise<ReviewNote[]> {
  if (!REVIEW_ID.test(id)) return [];
  const keys = (await store.listKeys(`${REVIEW_NOTES_PREFIX}${id}/`)).filter((key) => key.endsWith('.json'));
  const read = await Promise.all(keys.map(async (key) => {
    const text = await readUtf8(store, key);
    if (text === null) return [];
    try {
      const parsed = ReviewNoteSchema.safeParse(JSON.parse(text));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  }));
  return read.flat().sort((a, b) => a.atMs - b.atMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
