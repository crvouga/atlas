import { createBundleReader, writeBundle, type BundleIndex, type BundleEntry } from './bundle';
import { readUtf8, writeUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import type { LayerSummary, ReportLayer } from './layer-types';

export const LAYER_INDEX = 'layers/index/';
export function layerKey(id: string): string {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid layer id');
  return `layers/manifests/${id}.json`;
}
export async function publishLayer(store: ObjectStore, summary: Omit<LayerSummary, 'id'>, entries: AsyncIterable<BundleEntry>): Promise<ReportLayer> {
  const bundle = await writeBundle(store, entries, 'layers/blobs/');
  return publishLayerBundle(store, summary, bundle);
}
export async function publishLayerBundle(store: ObjectStore, summary: Omit<LayerSummary, 'id'>, bundle: BundleIndex): Promise<ReportLayer> {
  const body = JSON.stringify({ ...summary, bundle });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const id = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const layer: ReportLayer = { ...summary, id, bundle };
  // Immutable manifest first, independent catalog entry last: concurrent producers never overwrite one another.
  if (!(await store.head(layerKey(id)))) await writeUtf8(store, layerKey(id), JSON.stringify(layer), 'application/json');
  const inverse = String(Number.MAX_SAFE_INTEGER - Math.max(0, Math.floor(summary.recordedAtMs))).padStart(16, '0');
  await writeUtf8(store, `${LAYER_INDEX}${inverse}-${id}.json`, JSON.stringify({ id }), 'application/json');
  return layer;
}
export async function readLayer(store: ObjectStore, id: string): Promise<ReportLayer | null> {
  const raw = await readUtf8(store, layerKey(id));
  return raw === null ? null : JSON.parse(raw) as ReportLayer;
}
export async function readLayerFile(store: ObjectStore, id: string, file: string) {
  const layer = await readLayer(store, id);
  return layer ? createBundleReader(store, layer.bundle)(file) : null;
}
export function layerSummary(layer: ReportLayer): LayerSummary {
  const { bundle: _, ...summary } = layer;
  return summary;
}
