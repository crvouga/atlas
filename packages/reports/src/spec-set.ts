/**
 * @module Spec sets
 *
 * Publishes and finds spec sets: the specs of one commit, stored in the store itself so a viewer needs no checkout. Bodies
 * are content-addressed in `layers/specs/blobs/<sha256>.txt`, the set is `layers/specs/sets/<id>.json`, and the catalog
 * entry `layers/specs/index/<inverted-time>-<branch>-<flag>-<id>.json` is written last. `latestSpecSet` picks the outline
 * a report is laid over: the newest set of `main` (then `master`, then any branch), preferring a set from a clean
 * commit over one from a modified checkout.
 *
 * @see docs/report-contract.md#where-bytes-go
 */
import { SpecSetSchema, type SpecSet } from '../../schema/src/layer';
import { eachLimited } from './completion-order';
import { collectSpecFiles, isSpecFile, specKindOf, specTitleOf, type SpecFileText } from './directory-outline';
import { textFingerprint } from './layer-merge';
import { readUtf8, writeUtf8 } from './object-io';
import { isPaged, type ObjectStore } from './object-store';
import { sha256Hex } from './sigv4';

export { collectSpecFiles, isSpecFile, type SpecFileText };

const SET_PREFIX = 'layers/specs/sets/';
const INDEX_PREFIX = 'layers/specs/index/';
const BLOB_PREFIX = 'layers/specs/blobs/';

/** A branch as it appears in a catalog key: lowercase letters and digits. `_` for none. */
const branchSlug = (branch: string | null) => branch?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '_';
const flagOf = (freshness: SpecSet['freshness']) => (freshness === undefined ? 'c' : freshness === 'modified' ? 'm' : 'u');

/** What to publish as one spec set. */
export type PublishSpecSetInput = {
  /** The spec files and their text; see `collectSpecFiles`. */
  readonly files: readonly SpecFileText[];
  /** The branch the specs are from, or `null`. Part of the set's identity and of its catalog key. */
  readonly branch: string | null;
  /** The commit the specs are from, or `null`. Part of the set's identity. */
  readonly sha: string | null;
  /** When the specs were recorded, epoch milliseconds; orders the catalog (newest first). */
  readonly recordedAtMs: number;
  /** `modified` for a checkout with uncommitted edits, `unknown` outside git; absent for a clean checkout. Part of the set's identity. */
  readonly freshness?: 'unknown' | 'modified';
  /** The group shown in the viewer for every file. Default `product`. */
  readonly domain?: string;
};

/**
 * Publishes the specs of one version and returns the set. Bodies are stored by content, so a spec that did not change
 * costs nothing, and the set is named by what it holds: publishing the same specs from the same commit twice
 * writes the same set. The catalog entry is written last.
 *
 * The set's `id` is the SHA-256 of the branch, sha, freshness and each file's path and digest, so the same specs from a
 * developer's edited worktree and from CI are different sets. Store errors reject; a failure part-way leaves bodies
 * no set names, never a set whose bodies are missing.
 */
export async function publishSpecSet(store: ObjectStore, input: PublishSpecSetInput): Promise<SpecSet> {
  const files = await Promise.all([...input.files].sort((a, b) => (a.path < b.path ? -1 : 1)).map(async file => {
    const bytes = new TextEncoder().encode(file.text);
    return { path: file.path, digest: await sha256Hex(bytes), fingerprint: textFingerprint(file.text), kind: specKindOf(file.path), title: specTitleOf(file.path, file.text), domain: input.domain ?? 'product', bytes: bytes.length, text: file.text };
  }));
  await eachLimited(files, 16, async file => {
    const key = `${BLOB_PREFIX}${file.digest}.txt`;
    if (!(await store.head(key))) await writeUtf8(store, key, file.text, 'text/plain; charset=utf-8');
  });
  // Freshness is part of the identity: the same specs from a developer's edited worktree and from CI are different sets.
  const id = await sha256Hex(JSON.stringify([input.branch, input.sha, input.freshness ?? null, files.map(file => [file.path, file.digest])]));
  const set: SpecSet = {
    schemaVersion: 1, id, branch: input.branch, sha: input.sha, recordedAtMs: input.recordedAtMs,
    ...(input.freshness ? { freshness: input.freshness } : {}),
    files: files.map(({ text: _text, ...file }) => file)
  };
  if (!(await store.head(`${SET_PREFIX}${id}.json`))) await writeUtf8(store, `${SET_PREFIX}${id}.json`, JSON.stringify(set), 'application/json');
  const inverse = String(Number.MAX_SAFE_INTEGER - Math.max(0, Math.floor(input.recordedAtMs))).padStart(16, '0');
  // The branch and whether the checkout was clean are in the key, so the outline is found without opening every set.
  await writeUtf8(store, `${INDEX_PREFIX}${inverse}-${branchSlug(input.branch)}-${flagOf(input.freshness)}-${id}.json`, JSON.stringify({ id }), 'application/json');
  return set;
}

/** Reads and validates a spec set by id, or `null` when it is missing. Throws `Spec set <id> is not valid: ...` when it fails the schema, and a `SyntaxError` when it is not JSON. */
export async function readSpecSet(store: ObjectStore, id: string): Promise<SpecSet | null> {
  const raw = await readUtf8(store, `${SET_PREFIX}${id}.json`);
  if (raw === null) return null;
  const parsed = SpecSetSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`Spec set ${id.slice(0, 12)} is not valid: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  return parsed.data;
}

/** Reads the text of a spec body by its SHA-256 digest, or `null` when it is missing or `digest` is not 64 lowercase hex digits. */
export async function readSpecBody(store: ObjectStore, digest: string): Promise<string | null> {
  return /^[0-9a-f]{64}$/.test(digest) ? readUtf8(store, `${BLOB_PREFIX}${digest}.txt`) : null;
}

const DEFAULT_BRANCHES = ['main', 'master'];
const MAX_PAGES = 20;

type Found = { readonly set: SpecSet; readonly store: ObjectStore };
const newer = (a: Found, b: Found) => b.set.recordedAtMs - a.set.recordedAtMs || (a.set.id < b.set.id ? -1 : 1);
const clean = (found: Found) => found.set.freshness === undefined;
const ENTRY = /(?:^|\/)(\d{16})-(.+)-([cmu])-([0-9a-f]{64})\.json$/;

/** The catalog, newest first, a page at a time where the store can. */
async function* catalog(store: ObjectStore): AsyncGenerator<{ slug: string; flag: string; id: string }> {
  const parse = (key: string) => { const match = ENTRY.exec(key); return match ? { slug: match[2]!, flag: match[3]!, id: match[4]! } : null; };
  if (!isPaged(store)) {
    for (const key of await store.listKeys(INDEX_PREFIX)) { const entry = parse(key); if (entry) yield entry; }
    return;
  }
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await store.listPage(INDEX_PREFIX, { ...(after === undefined ? {} : { after }), limit: 1000 });
    for (const key of result.keys) { const entry = parse(key); if (entry) yield entry; }
    if (result.next === null) return;
    after = result.next;
  }
}

/**
 * The spec set the report is laid over: the newest one of `branch` in any of the stores. Without a
 * branch, the newest of `main` or `master`, and failing that the newest of all, so a project that
 * only ever publishes from other branches still has an outline.
 *
 * A set from a modified checkout (a developer's uncommitted edits) is used only when no set from a
 * commit exists: the shared view does not follow anyone's work in progress. The branch and cleanliness
 * are read from the catalog's keys, so choosing costs a listing and a read or two, however many sets
 * other branches have published. `cache` keeps sets already read: they never change.
 *
 * Resolves to the set and the store it was found in, or `null` when no store has a fitting set (with an explicit
 * `branch`, only that branch counts). A store that fails is skipped; the first error is thrown only when every store
 * failed. A set that cannot be read is skipped.
 */
export async function latestSpecSet(stores: readonly ObjectStore[], branch?: string, cache: Map<string, SpecSet> = new Map()): Promise<Found | null> {
  const wanted = new Set((branch ? [branch] : DEFAULT_BRANCHES).map(name => branchSlug(name)));
  const read = async (store: ObjectStore, id: string) => {
    const known = cache.get(id);
    if (known) return known;
    const set = await readSpecSet(store, id).catch(() => null);
    if (set) cache.set(id, set);
    return set;
  };
  const preferred: Found[] = [];
  const newest: Found[] = [];
  const failures: unknown[] = [];
  for (const store of stores) {
    let firstAccepted: Found | null = null;
    let firstOverall: Found | null = null;
    let firstCleanOverall: Found | null = null;
    try {
      for await (const entry of catalog(store)) {
        // Entries are newest first. Stop at the first clean set of the branch; remember the others for the fallbacks.
        if (!wanted.has(entry.slug)) {
          if (!branch && entry.flag === 'c' && !firstCleanOverall) { const set = await read(store, entry.id); if (set) firstCleanOverall = { set, store }; }
          else if (!branch && !firstOverall && !firstCleanOverall) { const set = await read(store, entry.id); if (set) firstOverall = { set, store }; }
          continue;
        }
        const set = await read(store, entry.id);
        if (!set || (branch && set.branch !== branch)) continue;
        const found = { set, store };
        firstAccepted ??= found;
        if (entry.flag === 'c') { firstAccepted = found; break; }
      }
    } catch (error) {
      // One store that is down does not take the outline with it.
      failures.push(error);
      continue;
    }
    if (firstAccepted) preferred.push(firstAccepted);
    const fallback = firstCleanOverall ?? firstOverall;
    if (fallback) newest.push(fallback);
  }
  if (failures.length === stores.length && stores.length > 0) throw failures[0];
  const pool = preferred.length || branch ? preferred : newest;
  const cleaned = pool.filter(clean);
  return [...(cleaned.length ? cleaned : pool)].sort(newer)[0] ?? null;
}
