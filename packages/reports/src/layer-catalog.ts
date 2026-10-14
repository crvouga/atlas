/**
 * @module Layer catalog of one backend
 *
 * Lists what one backend holds as catalog entries (immutable layers under `layers/index/`, and commit-keyed
 * recordings written before layers existed) and turns one entry into the layer summaries it stands for. It only
 * reads: opening Atlas never rewrites a store. Whether a backend can be read at all, and how entries from several
 * backends combine, is decided by the callers (`compose.ts`, `layers-route.ts`).
 *
 * @see docs/report-contract.md
 */
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

/**
 * Lists one backend's catalog entries as opaque strings to pass to `catalogLayers`.
 *
 * An entry is `layer:<key>` for each key under `layers/index/` (listed newest first, in the store's own key order),
 * followed by `commit:<sha>` for every 40-hex commit named by a key under `versions/` or `index/` (a store written
 * before layers existed, sorted by sha). Only lists keys; reads no layer. A store that cannot be listed throws.
 * Existing recordings are read in place and never rewritten.
 */
export async function catalogEntries(store: ObjectStore): Promise<readonly string[]> {
  const [layers, versions, commits] = await Promise.all([store.listKeys(LAYER_INDEX), store.listKeys('versions/'), store.listKeys('index/')]);
  const shas = new Set([...versions, ...commits].flatMap(key => /([0-9a-f]{40})\.json$/.exec(key)?.[1] ?? []));
  return [...layers.map(key => `layer:${key}`), ...[...shas].sort().map(sha => `commit:${sha}`)];
}

/**
 * Reads the layer summaries one catalog entry from `catalogEntries` stands for.
 *
 * A `layer:` entry yields exactly one summary (the layer the catalog entry names, without its bundle) and throws
 * when the entry is not JSON, names no layer, the layer is missing, or the layer cannot be parsed, so the caller can
 * report it as a notice instead of counting it as a pass. A `commit:` entry yields the older commit-keyed
 * recordings of that sha: one summary per stored part (`part-<sha>-<id>`) and one per stored source
 * (`source-<sha>-<id>`); a part whose checks a source already carries, and that has no parameters, is dropped so the
 * same evidence is not counted twice. Those ids are mutable addresses, not content digests.
 */
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
    layers.push({ ...(stored.record.environment ? { environment: stored.record.environment } : {}), id: `source-${sha}-${sourceId}`, producer: sourceId, recordedAtMs: Math.max(commit?.startedAtMs ?? 0, stored.record.updatedAtMs), sha, branch: commit?.branch ?? null, runUrl: commit?.runUrl ?? null, parameters: stored.record.parameters ?? {}, specs, parts: sourceParts(sha, stored.record), source: stored.record, recording: { type: 'commit', sha, source: sourceId } });
  });
  const signature = (part: (typeof parts)[number]) => JSON.stringify([part.id, part.kind, part.checks]);
  const sourceEvidence = new Set(layers.filter(layer => layer.source).flatMap(layer => layer.parts.map(signature)));
  return layers.filter(layer => layer.source || !layer.parts.every(part => !part.parameters && sourceEvidence.has(signature(part))));
}
