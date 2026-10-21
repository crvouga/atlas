/**
 * @module Combining backends into one report
 *
 * The entry point that turns stores of layers into a report: it reads every layer from every {@link BackendInput},
 * lays them over the specs, and counts the outcome. It owns reading and failure reporting (an unreadable backend or
 * layer becomes a notice, never a pass); the rule for which result wins a slot lives in `layer-merge.ts`. A report
 * is computed, never stored, and is a function of the set of layers: the order and split of backends does not
 * change it.
 *
 * @see docs/report-contract.md (how layers compose, guarantees)
 */
import { eachLimited } from './completion-order';
import type { BackendInfo, LayerEvidence, LayerHeader, StatusCounts } from './evidence-types';
import type { EvidenceStatus, SpecEntry } from './explorer-types';
import { catalogEntries, catalogLayers } from './layer-catalog';
import { combineEvidence, distinctHeaders, emptyCounts, isDiagnosticKind, layerEvidence, type CombinedEvidence, type EvidenceResult } from './layer-merge';
import { RecordedSpecs } from './recorded-specs';
import type { ReportOutline } from './layer-types';
import type { ObjectStore } from './object-store';

/** A store that contributes layers. Any {@link ObjectStore} is one: a directory, a bucket, a device lab. */
export type BackendInput = {
  /** Stable and unique: lowercase letters, digits and hyphens. It names where a result came from. */
  readonly id: string;
  /** What a person sees in notices and in the viewer. Defaults to `id`. */
  readonly label?: string;
  /** Where the layers are. Only read from. */
  readonly store: ObjectStore;
};

/** Options of {@link combineBackends}. */
export type CombineOptions = {
  /** The specs the report is laid out against. When omitted, the specs the layers recorded. */
  readonly outline?: ReportOutline;
  /** Layers read at once, across all backends. Default 16. */
  readonly concurrency?: number;
  /**
   * Leave layers out, to see what earlier ones said (a layer for which this returns false takes no part: not in the
   * results, the layer list, the counts, or the recorded specs). Layers are still read; this filters after reading.
   */
  readonly include?: (layer: LayerHeader) => boolean;
};

/** What a report says in numbers. Timings that only qualify a check are not counted as checks. */
export type ReportSummary = {
  /** Counts of the winning results by status, and their total. */
  readonly checks: StatusCounts & { readonly total: number };
  /** The same counts per environment slug, keys sorted; results with no environment are under `unspecified`. */
  readonly byEnvironment: Readonly<Record<string, StatusCounts & { readonly total: number }>>;
  /** Specs in the outline with no result at all. */
  readonly specsWithoutEvidence: readonly string[];
};

/** A report: the results laid over the specs, with what was read and what could not be. */
export type CombinedReport = {
  /** Every spec in the outline with the winning result of each of its slots, plus results that belong to no spec in the outline. */
  readonly combined: CombinedEvidence;
  /** Every distinct layer that was read, newest first. A layer several backends hold is one layer. */
  readonly layers: readonly LayerHeader[];
  /** Every backend given, sorted by id, with whether it could be read. */
  readonly backends: readonly BackendInfo[];
  /** What could not be read. A gate treats any of these as unknown, never as a pass. */
  readonly notices: readonly string[];
  /** The numbers of `combined`, computed once for the gate and the viewer. */
  readonly summary: ReportSummary;
};

const BACKEND_ID = /^[a-z0-9-]+$/;

/**
 * Counts results by status. Diagnostic results (parts of kind `performance`, which only qualify a check) are left out
 * whenever any other result is present; if only diagnostics exist, they are counted so the report is not empty.
 */
export function countResults(results: readonly EvidenceResult[]): StatusCounts & { total: number } {
  const outcomes = results.some(result => !isDiagnosticKind(result.row.kind)) ? results.filter(result => !isDiagnosticKind(result.row.kind)) : results;
  const counts: Record<EvidenceStatus, number> = emptyCounts();
  for (const result of outcomes) counts[result.row.status] += 1;
  return { ...counts, total: outcomes.length };
}

/** Counts a combined report's winning results in total and per environment, and lists the specs that have no result at all. */
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
 * Reads every layer of every backend and lays them over the specs. Layers are the only input:
 * a report is a function of the set of layers, so the order of backends and layers, and how they
 * were split across machines, branches and runs, does not change it.
 *
 * A backend that cannot be read, or a layer that cannot be understood, is named in `notices` and
 * leaves everything else usable; a gate must treat any notice as unknown, never as a pass. A layer held by
 * several backends is one layer. Only an invalid backend `id` (not lowercase letters, digits and hyphens, or
 * repeated) throws, before anything is read. Backends are only read from.
 *
 * When `options.outline` is omitted, the specs are the ones the included layers recorded (the newest
 * recording of each spec path wins), with no commit sha.
 *
 * @example
 * const outline = await loadDirectoryOutline('./specs'); // optional: without it the layers' own specs are used
 * const report = await combineBackends([{ id: 'ci', store: directoryStore('./atlas-reports') }], { outline });
 * report.summary.checks.failed; // number of slots whose winner failed
 * report.notices; // non-empty means something could not be read
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
  const loaded: { readonly evidence: LayerEvidence; readonly specs: readonly SpecEntry[] }[] = [];
  await eachLimited(entries, options.concurrency ?? 16, async ({ backend, entry }) => {
    try {
      for (const summary of await catalogLayers(backend.store, entry)) {
        loaded.push({ evidence: layerEvidence(summary, backend.id), specs: summary.specs });
      }
    } catch (error) {
      notices.push(`${backend.label ?? backend.id}: a layer could not be read, so its outcome is unknown (${error instanceof Error ? error.message : String(error)})`);
    }
  });
  const include = options.include;
  const kept = include ? loaded.filter(item => include(item.evidence.layer)) : loaded;
  const layers = kept.map(item => item.evidence);
  // The specs a report is laid over come from the layers that are in it, not from ones left out.
  const recorded = new RecordedSpecs();
  if (!options.outline) for (const { evidence, specs } of kept) recorded.add(specs, evidence.layer.recordedAtMs);
  const outline = options.outline ?? { specs: recorded.entries(), sha: null, changedFiles: [] };
  const combined = combineEvidence(outline, layers);
  const headers = distinctHeaders(layers.map(evidence => evidence.layer)).sort((a, b) => b.recordedAtMs - a.recordedAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { combined, layers: headers, backends: info.sort((a, b) => (a.id < b.id ? -1 : 1)), notices: [...new Set(notices)].sort(), summary: summarize(combined) };
}
