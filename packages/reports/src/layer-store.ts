import { createBundleReader, writeBundle, type BundleIndex, type BundleEntry } from './bundle';
import { readUtf8, writeUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import type { LayerSummary, ReportLayer } from './layer-types';
import { LAYER_SCHEMA_VERSION, parseLayerDocument } from '../../schema/src/layer';

export const LAYER_INDEX = 'layers/index/';
export function layerKey(id: string): string {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid layer id');
  return `layers/manifests/${id}.json`;
}
export async function publishLayer(store: ObjectStore, summary: Omit<LayerSummary, 'id'>, entries: AsyncIterable<BundleEntry>): Promise<ReportLayer> {
  const bundle = await writeBundle(store, entries, 'layers/blobs/');
  return publishLayerBundle(store, summary, bundle);
}
/** The catalog entry that makes a layer visible. It is written last, after the layer and its files. */
export function layerCatalogKey(recordedAtMs: number, id: string): string {
  return `${LAYER_INDEX}${String(Number.MAX_SAFE_INTEGER - Math.max(0, Math.floor(recordedAtMs))).padStart(16, '0')}-${id}.json`;
}
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
/** A layer that is present but cannot be read is an error naming why, never a half-read layer. */
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
export async function readLayerFile(store: ObjectStore, id: string, file: string) {
  const layer = await readLayer(store, id);
  return layer ? createBundleReader(store, layer.bundle)(file) : null;
}
export function layerSummary(layer: ReportLayer): LayerSummary {
  const { bundle: _, ...summary } = layer;
  return summary;
}
