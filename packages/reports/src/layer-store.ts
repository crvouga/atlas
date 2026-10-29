/**
 * @module Layer storage
 *
 * Reads and writes layers in an `ObjectStore`: the immutable manifest at `layers/manifests/<id>.json`, the catalog
 * entry at `layers/index/<inverted-time>-<id>.json`, and the captured files under `layers/blobs/`. A layer is written
 * bottom up (files, then manifest, then catalog entry) so a reader never meets an entry whose content has not arrived,
 * and every key is derived from content so two producers never write different bytes to one key.
 *
 * @see docs/report-contract.md#where-bytes-go
 */
import { createBundleReader, writeBundle, type BundleIndex, type BundleEntry } from './bundle';
import { readUtf8, writeUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import type { LayerSummary, ReportLayer } from './layer-types';
import { unbundledKeys } from './evidence-detail';
import { LAYER_SCHEMA_VERSION, parseLayerDocument } from '../../schema/src/layer';

/** The key prefix under which every layer's catalog entry is written. */
export const LAYER_INDEX = 'layers/index/';

/** The store key of a layer's manifest. Throws `Invalid layer id` unless `id` is 64 lowercase hex digits, so an id can never address another key. */
export function layerKey(id: string): string {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid layer id');
  return `layers/manifests/${id}.json`;
}
/**
 * Writes a layer whose captured files arrive as a stream, then its manifest and catalog entry, and returns it.
 *
 * The files are packed into content-addressed blobs under `layers/blobs/` first (`writeBundle`), then
 * `publishLayerBundle` does the rest. The id is computed from the content, so publishing the same layer again
 * writes the same keys.
 */
export async function publishLayer(store: ObjectStore, summary: Omit<LayerSummary, 'id'>, entries: AsyncIterable<BundleEntry>): Promise<ReportLayer> {
  const bundle = await writeBundle(store, entries, 'layers/blobs/');
  return publishLayerBundle(store, summary, bundle);
}
/**
 * The key of a layer's catalog entry: `layers/index/<16 digits>-<id>.json`, where the digits are
 * `Number.MAX_SAFE_INTEGER - floor(max(0, recordedAtMs))` zero-padded. The time is inverted so a listing in key order
 * is newest first. The entry makes a layer visible, so it is written last, after the layer and its files.
 */
export function layerCatalogKey(recordedAtMs: number, id: string): string {
  return `${LAYER_INDEX}${String(Number.MAX_SAFE_INTEGER - Math.max(0, Math.floor(recordedAtMs))).padStart(16, '0')}-${id}.json`;
}
/**
 * Writes a layer whose captured files are already stored (`bundle` locates them) and returns it with its id.
 *
 * The id is the SHA-256 of the JSON of `{ schemaVersion, ...summary, bundle }`, so recording the same thing the same
 * way gives the same id. Writes the manifest only if `head` says it is absent, then always writes the catalog entry
 * (same key, same bytes on a repeat), so a retry is harmless and a crash between the two leaves a manifest no catalog
 * entry names, never the reverse. Store errors reject; nothing is validated here (the publishers do that).
 */
export async function publishLayerBundle(store: ObjectStore, summary: Omit<LayerSummary, 'id'>, bundle: BundleIndex): Promise<ReportLayer> {
  // The id is the digest of exactly this document without it, so every producer that records the same thing writes the same layer.
  const body = JSON.stringify({ schemaVersion: LAYER_SCHEMA_VERSION, ...summary, bundle });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const id = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const layer: ReportLayer = { ...summary, id, bundle };
  // Immutable manifest first, independent catalog entry last: concurrent producers never overwrite one another.
  if (!(await store.head(layerKey(id)))) await writeUtf8(store, layerKey(id), JSON.stringify({ schemaVersion: LAYER_SCHEMA_VERSION, ...layer }), 'application/json');
  await writeUtf8(store, layerCatalogKey(summary.recordedAtMs, id), JSON.stringify({ id }), 'application/json');
  return layer;
}
/**
 * Reads and validates a layer manifest, returning it without `schemaVersion`, or `null` when no manifest exists.
 *
 * A manifest that is present but cannot be read is an error naming why, never a half-read layer: it throws when the
 * bytes are not JSON, fail the layer schema, or are a newer major schema version. Callers turn that into a notice,
 * which fails the gate. Throws `Invalid layer id` for a malformed `id`. The id is not recomputed from the content.
 */
export async function readLayer(store: ObjectStore, id: string): Promise<ReportLayer | null> {
  const raw = await readUtf8(store, layerKey(id));
  if (raw === null) return null;
  let json: unknown;
  try { json = JSON.parse(raw); } catch { throw new Error(`Layer ${id.slice(0, 12)} is not JSON`); }
  const parsed = parseLayerDocument(json);
  if (!parsed.ok) throw new Error(`Layer ${id.slice(0, 12)}: ${parsed.reason}`);
  const { schemaVersion: _version, ...layer } = parsed.layer;
  return layer as unknown as ReportLayer;
}
/** Reads one captured file (a screenshot, a frame, a recorded report) of a layer, or `null` when the layer or the file is missing. Throws like `readLayer`. */
export async function readLayerFile(store: ObjectStore, id: string, file: string) {
  const layer = await readLayer(store, id);
  return layer ? createBundleReader(store, layer.bundle)(file) : null;
}
/** Drops a layer's bundle index, leaving the summary composition reads, plus which bundle keys its attachments name that the bundle does not hold (`unbundled`, when any). */
export function layerSummary(layer: ReportLayer): LayerSummary {
  const { bundle, ...summary } = layer;
  const unbundled = unbundledKeys(layer, bundle);
  return unbundled.length ? { ...summary, unbundled } : summary;
}
