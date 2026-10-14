/**
 * @module Bundles of captured files
 *
 * Packs many small captured files (screenshots, frames, attachments) into a few gzip-compressed, content-addressed
 * blobs in an {@link ObjectStore}, and reads single files back out. The bytes of every entry are concatenated into
 * chunks of at most {@link BUNDLE_BYTES} uncompressed bytes; each chunk is gzipped and stored once at
 * `<prefix><sha256 of the uncompressed chunk>.gz`, so identical chunks and re-publishes write nothing new. A
 * {@link BundleIndex} says, per file key, which byte ranges of which blobs hold it. A layer document keeps that
 * index in its `bundle` field. Blobs are immutable; the index is the only mutable-looking part and is written last.
 *
 * @see docs/report-contract.md (where bytes go)
 */
import {
  readObjectBytes,
  readUtf8,
  writeUtf8,
} from './object-io';
import type { ObjectStore } from './object-store';
import { eachLimitedStream } from './completion-order';

/** Uncompressed size of one chunk, in bytes (4 MiB). A file larger than this is split across several chunks. */
export const BUNDLE_BYTES = 4 * 1024 * 1024;
type Location = { blob: string; offset: number; size: number };
/**
 * Where each file of a bundle is, keyed by the file's key (for a layer, `attachments/<sha256>` and the like).
 * `parts` lists, in order, the byte ranges (`offset`, `size` within the decompressed blob `blob`, a store key) whose
 * concatenation is the file.
 */
export type BundleIndex = Record<
  string,
  { contentType: string; parts: Location[] }
>;
/** One file to bundle, or one file read back. */
export type BundleEntry = {
  /** The file's name inside the bundle; the key in the {@link BundleIndex}. A repeated key appends more parts to the same file. */
  key: string;
  bytes: Uint8Array;
  /** The media type to serve the bytes with. The first entry with a key decides it. */
  contentType: string;
};
type BundleWrites = {
  prefix: string;
  pending: Map<string, Promise<void>>;
};

/** The store key of a commit's bundle index for one source: `commits/<sha>/bundles/<source>.json`. This is the older, per-commit layout; layers hold their index in the layer document instead. */
export function bundleIndexKey(sha: string, source: string): string {
  return `commits/${sha}/bundles/${source}.json`;
}

async function transform(
  bytes: Uint8Array,
  decompress: boolean
): Promise<Uint8Array> {
  const buffer = new Uint8Array(bytes).buffer;
  const stream = new Blob([buffer]).stream();
  const output = decompress
    ? stream.pipeThrough(new DecompressionStream('gzip'))
    : stream.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(output).arrayBuffer());
}

async function flush(
  store: ObjectStore,
  entries: readonly BundleEntry[],
  index: BundleIndex,
  writes: BundleWrites
): Promise<void> {
  const bytes = new Uint8Array(
    entries.reduce((size, entry) => size + entry.bytes.length, 0)
  );
  const locations: Location[] = [];
  let offset = 0;
  for (const entry of entries) {
    bytes.set(entry.bytes, offset);
    const location = { blob: '', offset, size: entry.bytes.length };
    (index[entry.key] ??= {
      contentType: entry.contentType,
      parts: [],
    }).parts.push(location);
    locations.push(location);
    offset += entry.bytes.length;
  }
  const compressed = await transform(bytes, false);
  // Some runtimes put wall time in gzip's MTIME header. Canonicalize it;
  // content identity depends only on the uncompressed bytes.
  compressed.fill(0, 4, 8);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  const blob = `${writes.prefix}${hash}.gz`;
  for (const location of locations) location.blob = blob;
  // Identical chunks and reruns reuse the same bytes: HEAD is Class B;
  // writing the same content again would still incur a Class A operation.
  let upload = writes.pending.get(blob);
  if (upload === undefined) {
    upload = uploadBlob(store, blob, compressed);
    writes.pending.set(blob, upload);
  }
  await upload;
}

async function uploadBlob(
  store: ObjectStore,
  blob: string,
  bytes: Uint8Array
): Promise<void> {
  if (!(await store.head(blob)))
    await store.put(blob, bytes, 'application/gzip');
}

async function* chunks(
  entries: AsyncIterable<BundleEntry>
): AsyncGenerator<readonly BundleEntry[]> {
  let pending: BundleEntry[] = [];
  let size = 0;
  for await (const entry of entries) {
    for (let offset = 0; offset < Math.max(1, entry.bytes.length); ) {
      const bytes = entry.bytes.slice(offset, offset + BUNDLE_BYTES - size);
      pending.push({ ...entry, bytes });
      size += bytes.length;
      offset += Math.max(1, bytes.length);
      if (size === BUNDLE_BYTES) {
        yield pending;
        pending = [];
        size = 0;
      }
    }
  }
  if (pending.length > 0) yield pending;
}

/**
 * Writes `entries` as blobs next to `key` and then the index at `key`: up to four compressed chunks in flight,
 * with the one small index published last, so a reader never finds an index whose blobs have not arrived.
 *
 * Trap: blobs go to `<key up to "/bundles/">/blobs/`, so `key` must contain `/bundles/` (as {@link bundleIndexKey}
 * gives); otherwise the prefix is computed from a wrong slice.
 */
export async function publishBundle(
  store: ObjectStore,
  key: string,
  entries: AsyncIterable<BundleEntry>
): Promise<void> {
  const index = await writeBundle(store, entries, `${key.slice(0, key.indexOf('/bundles/'))}/blobs/`);
  await writeUtf8(store, key, JSON.stringify(index), 'application/json');
}

/**
 * Packs `entries` into gzip blobs under `prefix` (for layers, `layers/blobs/`) and returns the index that locates
 * every file; the caller stores the index (a layer keeps it as its `bundle`).
 *
 * The entries are consumed lazily with up to four chunks in flight. A blob that already exists in the store is not
 * written again (one `head` per distinct blob). The gzip header's timestamp is zeroed, and the blob name is the
 * SHA-256 of the uncompressed chunk, so the same files in the same order always produce the same blobs. Order of
 * entries matters for that: chunking follows input order. A store error rejects after started writes settle.
 */
export async function writeBundle(store: ObjectStore, entries: AsyncIterable<BundleEntry>, prefix: string): Promise<BundleIndex> {
  const index: BundleIndex = {};
  const writes: BundleWrites = { prefix, pending: new Map() };
  await eachLimitedStream(chunks(entries), 4, chunk => flush(store, chunk, index, writes));
  return index;
}

/**
 * Creates a reader that returns one file of a bundle by key, or `null` when the key is not in `index` or one of
 * its blobs is missing from the store.
 *
 * Only immutable blobs are cached (the last four decompressed blobs, oldest evicted first, including a cached
 * "missing" answer); mutable indexes are read for each request. Transport errors from the store reject.
 */
export function createBundleReader(
  store: ObjectStore,
  index: BundleIndex
): (key: string) => Promise<BundleEntry | null> {
  const cache = new Map<string, Promise<Uint8Array | null>>();
  return async (key) => {
    const location = index[key];
    if (location === undefined) return null;
    const chunks: Uint8Array[] = [];
    for (const part of location.parts) {
      let pending = cache.get(part.blob);
      if (pending === undefined) {
        if (cache.size >= 4) cache.delete(cache.keys().next().value ?? '');
        pending = readObjectBytes(store, part.blob).then((bytes) =>
          bytes === null ? null : transform(bytes, true)
        );
        cache.set(part.blob, pending);
      }
      const bytes = await pending;
      if (bytes === null) return null;
      chunks.push(bytes.slice(part.offset, part.offset + part.size));
    }
    const bytes = new Uint8Array(
      chunks.reduce((size, chunk) => size + chunk.length, 0)
    );
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return { key, bytes, contentType: location.contentType };
  };
}

/** Reads and parses the bundle index at `key`; an index that is not there is an empty bundle (`{}`). Invalid JSON throws. */
export async function readBundleIndex(
  store: ObjectStore,
  key: string
): Promise<BundleIndex> {
  const text = await readUtf8(store, key);
  return text === null ? {} : (JSON.parse(text) as BundleIndex);
}
