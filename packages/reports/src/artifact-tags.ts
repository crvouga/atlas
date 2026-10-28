/**
 * @module Artifact tags
 *
 * The tags of one attachment (a recording, a screenshot, a trace): how a tag is normalized so `demo` and `#demo`
 * are the same tag, which tags an attachment shows (its producer's, its reviewers', and those it inherits from its
 * check and run), and how a reviewer's edits fold into the tags that stand now. Pure functions, safe in a browser.
 *
 * Tags describe evidence; they never decide a status, a slot or a winner. A producer writes `tags` on the attachment
 * inside an immutable layer. A reviewer's tags live apart, as an append-only list of edits that the server records
 * with who made each and when (`artifact-tag-store.ts`); the layer is never rewritten.
 *
 * @see docs/rich-evidence.md#tagging-artifacts-and-demos
 */
import type { Attachment } from '../../schema/src/layer';

/** The longest a normalized tag may be, in characters. */
export const MAX_TAG_LENGTH = 64;

/**
 * Normalizes a tag so equal tags compare equal: Unicode NFC, any leading `#` removed, surrounding whitespace
 * trimmed, letters lower-cased and each run of whitespace inside turned into one `-`. Every other character is kept,
 * so `Smoke`, `#smoke` and ` smoke ` are `smoke`, and `team/payments` or `release=2` stay as they are. Returns
 * `null` for a tag that is empty after that (`''`, `'#'`, `'  '`) or longer than {@link MAX_TAG_LENGTH}.
 *
 * @example
 * ```ts
 * normalizeTag('#Demo'); // 'demo'
 * normalizeTag('release candidate'); // 'release-candidate'
 * normalizeTag('#'); // null
 * ```
 */
export function normalizeTag(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const tag = raw.normalize('NFC').trim().replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-');
  return tag.length > 0 && tag.length <= MAX_TAG_LENGTH ? tag : null;
}

/** Normalizes every tag with {@link normalizeTag}, dropping the ones that are not tags and the repeats; the first of each keeps its place. */
export function normalizeTags(raw: Iterable<string> | undefined): string[] {
  const seen = new Set<string>();
  for (const value of raw ?? []) {
    const tag = normalizeTag(value);
    if (tag !== null) seen.add(tag);
  }
  return [...seen];
}

/** The tag as a person sees it: `#demo`. */
export const displayTag = (tag: string) => `#${tag}`;

/**
 * How an edit names an attachment: `id:<id>` when it has an `id`, else `key:<bundleKey>` (its bytes), else
 * `name:<name>`. It is stable for a layer, which never changes. Two attachments in one check with the same bytes and
 * no `id` share a reference, and so share reviewer tags; give them an `id` to tag them apart.
 */
export function artifactRef(attachment: Pick<Attachment, 'id' | 'bundleKey' | 'name'>): string {
  if (attachment.id) return `id:${attachment.id}`;
  if (attachment.bundleKey) return `key:${attachment.bundleKey}`;
  return `name:${attachment.name}`;
}

/** Where a reviewer's tags are about: one attachment of one check of one archived layer. */
export type ArtifactTarget = {
  readonly layer: string;
  readonly check: string;
  readonly kind?: string | undefined;
  readonly artifact: string;
};

/** One recorded edit. Entries are never changed or removed. */
export type ArtifactTagEntry = {
  readonly id: string;
  readonly target: ArtifactTarget;
  readonly add: readonly string[];
  readonly remove: readonly string[];
  readonly by: string;
  readonly atMs: number;
};

/** A string that is equal for equal targets (the part `kind` is optional and then does not matter). */
export const targetKey = (target: ArtifactTarget) => JSON.stringify([target.layer, target.check, target.kind ?? '', target.artifact]);

/** A tag a reviewer added: who added it last, and when. */
export type ReviewerTag = { readonly tag: string; readonly by: string; readonly atMs: number };

/**
 * Folds the recorded edits (in any order) into the reviewer tags that stand now, by target (see {@link targetKey}).
 * Edits apply oldest first, ties by `id`; a tag added, removed and added again stands, with the time and author of
 * the last add. A target whose tags were all removed is absent. Entries that are not understood are ignored.
 */
export function foldArtifactTags(entries: readonly ArtifactTagEntry[]): Map<string, ReviewerTag[]> {
  const ordered = [...entries].sort((a, b) => a.atMs - b.atMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const standing = new Map<string, Map<string, ReviewerTag>>();
  for (const entry of ordered) {
    const key = targetKey(entry.target);
    const tags = standing.get(key) ?? new Map<string, ReviewerTag>();
    for (const tag of entry.remove) tags.delete(tag);
    for (const tag of entry.add) tags.set(tag, { tag, by: entry.by, atMs: entry.atMs });
    standing.set(key, tags);
  }
  const out = new Map<string, ReviewerTag[]>();
  for (const [key, tags] of standing) if (tags.size) out.set(key, [...tags.values()]);
  return out;
}

/** Where a shown tag comes from: the attachment's own producer (`artifact`), a reviewer after the upload (`reviewer`), or the check or run around it (`inherited`). */
export type TagSource = 'artifact' | 'reviewer' | 'inherited';

/** One tag an attachment shows, with its source and, for a reviewer's tag, who added it and when. */
export type ArtifactTag = { readonly tag: string; readonly source: TagSource; readonly by?: string; readonly atMs?: number };

/**
 * The tags one attachment shows, normalized and without repeats: its producer's own (`artifact`), then the
 * reviewers' (`reviewer`), then those of its check and run that it does not have itself (`inherited`). A tag it has
 * more than once is shown once, by the first source above.
 */
export function artifactTagsOf(attachment: Pick<Attachment, 'tags'>, options: { readonly reviewer?: readonly ReviewerTag[]; readonly inherited?: Iterable<string> } = {}): ArtifactTag[] {
  const out = new Map<string, ArtifactTag>();
  for (const tag of normalizeTags(attachment.tags)) out.set(tag, { tag, source: 'artifact' });
  for (const found of options.reviewer ?? []) if (!out.has(found.tag)) out.set(found.tag, { tag: found.tag, source: 'reviewer', by: found.by, atMs: found.atMs });
  for (const tag of normalizeTags(options.inherited)) if (!out.has(tag)) out.set(tag, { tag, source: 'inherited' });
  return [...out.values()];
}

/**
 * Does an attachment match a tag (either spelling)? An exact query (`inherited: false`, the default) matches only the
 * tags the attachment has itself, from its producer or a reviewer; an inherited query also matches the tags it
 * inherits from its check and run. The two differ for a recording that is untagged under a tagged run.
 */
export function hasArtifactTag(tags: readonly ArtifactTag[], wanted: string, options: { readonly inherited?: boolean } = {}): boolean {
  const tag = normalizeTag(wanted);
  return tag !== null && tags.some(item => item.tag === tag && (options.inherited === true || item.source !== 'inherited'));
}
