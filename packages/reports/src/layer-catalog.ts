import type { ObjectStore } from './object-store';
import type { LayerSummary } from './layer-types';
import { readUtf8 } from './object-io';
import { readCommit } from './read';
import { readInventory } from './spec-inventory';
import { readParts } from './report-parts';
import { reportStore } from './publication';
import { readStoredSource } from './source-content';
import { sourceParts } from './source-part';
import { LAYER_INDEX, readLayer, layerSummary } from './layer-store';
import { eachLimited } from './completion-order';

/** Read existing recordings in place; opening Atlas never rewrites the evidence store. */
export async function catalogEntries(store: ObjectStore): Promise<readonly string[]> {
  const [layers, versions, commits] = await Promise.all([store.listKeys(LAYER_INDEX), store.listKeys('versions/'), store.listKeys('index/')]);
  const shas = new Set([...versions, ...commits].flatMap(key => /([0-9a-f]{40})\.json$/.exec(key)?.[1] ?? []));
  return [...layers.map(key => `layer:${key}`), ...[...shas].sort().map(sha => `commit:${sha}`)];
}
export async function catalogLayers(store: ObjectStore, entry: string): Promise<readonly LayerSummary[]> {
  if (entry.startsWith('layer:')) {
    const raw = await readUtf8(store, entry.slice(6));
    const id = raw && (JSON.parse(raw) as { id: string }).id;
    const layer = id ? await readLayer(store, id) : null;
    if (!layer) throw new Error('An indexed report layer is unavailable');
    return [layerSummary(layer)];
  }
  const sha = entry.slice(7);
  const [commit, inventory, parts, scoped] = await Promise.all([readCommit(store, sha), readInventory(store, sha), readParts(store, sha), reportStore(store, sha)]);
  const specs = inventory?.entries ?? [];
  const layers: LayerSummary[] = parts.map(part => ({ ...(part.freshness ? { freshness: part.freshness } : {}), id: `part-${sha}-${part.id}`, producer: part.id, recordedAtMs: part.recordedAtMs, sha, branch: commit?.branch ?? null, runUrl: commit?.runUrl ?? null, parameters: part.parameters ?? {}, specs, parts: [part], source: null, recording: null }));
  await eachLimited(await scoped.listKeys(`commits/${sha}/sources/`), 8, async key => {
    const sourceId = key.split('/').at(-1)!.replace(/\.json$/, '');
    const stored = await readStoredSource(store, sha, sourceId);
    if (!stored) return;
    layers.push({ id: `source-${sha}-${sourceId}`, producer: sourceId, recordedAtMs: Math.max(commit?.startedAtMs ?? 0, stored.record.updatedAtMs), sha, branch: commit?.branch ?? null, runUrl: commit?.runUrl ?? null, parameters: {}, specs, parts: sourceParts(sha, stored.record), source: stored.record, recording: { type: 'commit', sha, source: sourceId } });
  });
  const signature = (part: (typeof parts)[number]) => JSON.stringify([part.id, part.kind, part.checks]);
  const sourceEvidence = new Set(layers.filter(layer => layer.source).flatMap(layer => layer.parts.map(signature)));
  return layers.filter(layer => layer.source || !layer.parts.every(part => !part.parameters && sourceEvidence.has(signature(part))));
}
