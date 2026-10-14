import { eachLimited } from './completion-order';
import type { BackendInfo, LayerEvidence, LayerHeader, StatusCounts } from './evidence-types';
import type { EvidenceStatus, SpecEntry } from './explorer-types';
import { catalogEntries, catalogLayers } from './layer-catalog';
import { combineEvidence, distinctHeaders, emptyCounts, isDiagnosticKind, layerEvidence, specPath, type CombinedEvidence, type EvidenceResult } from './layer-merge';
import type { ReportOutline } from './layer-types';
import type { ObjectStore } from './object-store';

/** A store that contributes layers. Any {@link ObjectStore} is one: a directory, a bucket, a device lab. */
export type BackendInput = {
  /** Stable and unique: lowercase letters, digits and hyphens. It names where a result came from. */
  readonly id: string;
  readonly label?: string;
  readonly store: ObjectStore;
};

export type CombineOptions = {
  /** The specs the report is laid out against. When omitted, the specs the layers recorded. */
  readonly outline?: ReportOutline;
  /** Layers read at once, across all backends. */
  readonly concurrency?: number;
  /** Leave layers out, to see what earlier ones said. */
  readonly include?: (layer: LayerHeader) => boolean;
};

/** What a report says in numbers. Timings that only qualify a check are not counted as checks. */
export type ReportSummary = {
  readonly checks: StatusCounts & { readonly total: number };
  readonly byEnvironment: Readonly<Record<string, StatusCounts & { readonly total: number }>>;
  /** Specs in the outline with no result at all. */
  readonly specsWithoutEvidence: readonly string[];
};

export type CombinedReport = {
  readonly combined: CombinedEvidence;
  /** Every distinct layer that was read, newest first. A layer several backends hold is one layer. */
  readonly layers: readonly LayerHeader[];
  readonly backends: readonly BackendInfo[];
  /** What could not be read. A gate treats any of these as unknown, never as a pass. */
  readonly notices: readonly string[];
  readonly summary: ReportSummary;
};

const BACKEND_ID = /^[a-z0-9-]+$/;

export function countResults(results: readonly EvidenceResult[]): StatusCounts & { total: number } {
  const outcomes = results.some(result => !isDiagnosticKind(result.row.kind)) ? results.filter(result => !isDiagnosticKind(result.row.kind)) : results;
  const counts: Record<EvidenceStatus, number> = emptyCounts();
  for (const result of outcomes) counts[result.row.status] += 1;
  return { ...counts, total: outcomes.length };
}

export function summarize(combined: CombinedEvidence): ReportSummary {
  const results = [...combined.specs.flatMap(entry => entry.results), ...combined.unassigned];
  const environments = new Map<string, EvidenceResult[]>();
  for (const result of results) {
    const key = result.layer.environment ?? 'unspecified';
    const group = environments.get(key);
    if (group) group.push(result);
    else environments.set(key, [result]);
  }
  return {
    checks: countResults(results),
    byEnvironment: Object.fromEntries([...environments].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, value]) => [key, countResults(value)])),
    specsWithoutEvidence: combined.specs.filter(entry => entry.results.length === 0).map(entry => entry.spec.path)
  };
}

/**
 * Read every layer of every backend and lay them over the specs. Layers are the only input:
 * a report is a function of the set of layers, so the order of backends and layers, and how they
 * were split across machines, branches and runs, does not change it.
 *
 * A backend that cannot be read, or a layer that cannot be understood, is named in `notices` and
 * leaves everything else usable.
 */
export async function combineBackends(backends: readonly BackendInput[], options: CombineOptions = {}): Promise<CombinedReport> {
  const seen = new Set<string>();
  for (const backend of backends) {
    if (!BACKEND_ID.test(backend.id) || seen.has(backend.id)) throw new Error(`Invalid report backend id: "${backend.id}". Use unique lowercase letters, digits and hyphens`);
    seen.add(backend.id);
  }
  const notices: string[] = [];
  const info: BackendInfo[] = [];
  const entries: { backend: BackendInput; entry: string }[] = [];
  await Promise.all(backends.map(async backend => {
    try {
      for (const entry of await catalogEntries(backend.store)) entries.push({ backend, entry });
      info.push({ id: backend.id, label: backend.label ?? backend.id, live: false, available: true });
    } catch (error) {
      info.push({ id: backend.id, label: backend.label ?? backend.id, live: false, available: false });
      notices.push(`${backend.label ?? backend.id} is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  entries.sort((a, b) => (a.backend.id < b.backend.id ? -1 : a.backend.id > b.backend.id ? 1 : a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0));
  const loaded: LayerEvidence[] = [];
  const specs = new Map<string, { entry: SpecEntry; at: number }>();
  await eachLimited(entries, options.concurrency ?? 16, async ({ backend, entry }) => {
    try {
      for (const summary of await catalogLayers(backend.store, entry)) {
        loaded.push(layerEvidence(summary, backend.id));
        for (const spec of summary.specs) {
          const key = specPath(spec.path);
          const prior = specs.get(key);
          if (!prior || summary.recordedAtMs > prior.at) specs.set(key, { entry: { ...spec, path: key }, at: summary.recordedAtMs });
        }
      }
    } catch (error) {
      notices.push(`${backend.label ?? backend.id}: a layer could not be read, so its outcome is unknown (${error instanceof Error ? error.message : String(error)})`);
    }
  });
  const include = options.include;
  const layers = include ? loaded.filter(evidence => include(evidence.layer)) : loaded;
  const outline = options.outline ?? { specs: [...specs.values()].map(item => item.entry).sort((a, b) => (a.path < b.path ? -1 : 1)), sha: null, changedFiles: [] };
  const combined = combineEvidence(outline, layers);
  const headers = distinctHeaders(layers.map(evidence => evidence.layer)).sort((a, b) => b.recordedAtMs - a.recordedAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { combined, layers: headers, backends: info.sort((a, b) => (a.id < b.id ? -1 : 1)), notices: [...new Set(notices)].sort(), summary: summarize(combined) };
}
