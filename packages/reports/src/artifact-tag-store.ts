/**
 * @module Reviewer tags in a store
 *
 * Where a reviewer's tags for attachments are kept: one small immutable object per edit under
 * `curation/artifact-tags/`, named by time and a random id so editors never overwrite one another, and never changed
 * or deleted afterwards. The layers they are about are not touched. The list of edits is the audit trail: who changed
 * which tags of which attachment, and when. `foldArtifactTags` turns it into the tags that stand now.
 *
 * @see docs/server.md#tagging-artifacts
 */
import { ArtifactTagEntrySchema, ArtifactTagEditSchema } from '../../schema/src/api';
import { readUtf8, writeUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import { normalizeTag, normalizeTags, type ArtifactTagEntry } from './artifact-tags';

/** The prefix of every recorded edit in a store. */
export const ARTIFACT_TAGS_PREFIX = 'curation/artifact-tags/';

/** The edit was not acceptable (`status` is the HTTP status to answer). */
export class ArtifactTagError extends Error {
  constructor(readonly status: 422, message: string) {
    super(message);
  }
}

/**
 * Validates an edit (`ArtifactTagEditSchema`), normalizes its tags and records it as a new object in `store`, by
 * `by` at `atMs`. Throws {@link ArtifactTagError} for a body that is not an edit, a tag that is not a tag (empty, or
 * over 64 characters) or an edit that changes nothing. Recording the same edit twice records two entries.
 */
export async function recordArtifactTags(store: ObjectStore, input: unknown, by: string, atMs: number): Promise<ArtifactTagEntry> {
  const parsed = ArtifactTagEditSchema.safeParse(input);
  if (!parsed.success) throw new ArtifactTagError(422, `Not a tag edit: ${parsed.error.issues[0]?.path.join('.') || '(body)'}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  const { target, add = [], remove = [] } = parsed.data;
  if ([...add, ...remove].some(tag => normalizeTag(tag) === null)) throw new ArtifactTagError(422, 'A tag is empty or longer than 64 characters.');
  const added = normalizeTags(add);
  const removed = normalizeTags(remove);
  const entryAdd = added.filter(tag => !removed.includes(tag));
  const entryRemove = removed.filter(tag => !added.includes(tag));
  if (!entryAdd.length && !entryRemove.length) throw new ArtifactTagError(422, 'Name at least one tag to add or remove.');
  const id = `${String(atMs).padStart(16, '0')}-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const entry: ArtifactTagEntry = {
    id, by, atMs,
    target: { layer: target.layer, check: target.check, ...(target.kind === undefined ? {} : { kind: target.kind }), artifact: target.artifact },
    add: entryAdd, remove: entryRemove
  };
  await writeUtf8(store, `${ARTIFACT_TAGS_PREFIX}${id}.json`, JSON.stringify({ schemaVersion: 1, ...entry }), 'application/json');
  return entry;
}

/**
 * Every recorded edit in `store`, oldest first. An object that cannot be read as an edit is skipped (unknown, never
 * guessed at). A store with none gives an empty list. Transport errors throw.
 */
export async function readArtifactTagEntries(store: ObjectStore): Promise<ArtifactTagEntry[]> {
  const keys = (await store.listKeys(ARTIFACT_TAGS_PREFIX)).filter(key => key.endsWith('.json'));
  const read = await Promise.all(keys.map(async key => {
    const text = await readUtf8(store, key);
    if (text === null) return [];
    try {
      const parsed = ArtifactTagEntrySchema.safeParse(JSON.parse(text));
      return parsed.success ? [parsed.data as ArtifactTagEntry] : [];
    } catch { return []; }
  }));
  return read.flat().sort((a, b) => a.atMs - b.atMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
