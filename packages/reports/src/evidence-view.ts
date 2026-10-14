import type { EvidenceStatus } from './explorer-types';
import type { LayerEvidence, LayerHeader, LayerRow, StatusCounts } from './evidence-types';
import { emptyCounts, isDiagnosticKind, slotKey, type CombinedEvidence, type EvidenceResult } from './layer-merge';

const WORST = { passed: 0, 'not-run': 1, running: 2, failed: 3 } as const;

function worst(statuses: readonly EvidenceStatus[]): EvidenceStatus {
  let status: EvidenceStatus = 'passed';
  for (const next of statuses) if (WORST[next] > WORST[status]) status = next;
  return status;
}

/** Everything the combined report holds for one check. */
export type CheckSlot = {
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly specPath: string | null;
  /** The worst outcome across the check's parameter sets. */
  readonly status: EvidenceStatus;
  /** What happened, newest first. One entry per producer and parameter set. */
  readonly outcomes: readonly EvidenceResult[];
  /** Recorded timings of the same check. They never change its outcome. */
  readonly diagnostics: readonly EvidenceResult[];
  readonly latestAtMs: number;
  readonly live: boolean;
};

function newestFirst(a: EvidenceResult, b: EvidenceResult): number {
  return b.layer.recordedAtMs - a.layer.recordedAtMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** Group the combined results by check, in the order the checks were first seen. */
export function checkSlots(results: readonly EvidenceResult[]): CheckSlot[] {
  const groups = new Map<string, EvidenceResult[]>();
  for (const result of results) {
    const group = groups.get(result.slot);
    if (group) group.push(result);
    else groups.set(result.slot, [result]);
  }
  return [...groups].map(([key, group]) => {
    const checked = group.filter(result => !isDiagnosticKind(result.row.kind));
    const outcomes = (checked.length ? checked : group).slice().sort(newestFirst);
    const diagnostics = checked.length ? group.filter(result => isDiagnosticKind(result.row.kind)).sort(newestFirst) : [];
    const first = outcomes[0]!;
    return {
      key,
      id: first.row.id,
      title: first.row.title,
      specPath: first.row.specPath,
      status: worst(outcomes.map(result => result.row.status)),
      outcomes,
      diagnostics,
      latestAtMs: Math.max(...group.map(result => result.layer.recordedAtMs)),
      live: group.some(result => result.layer.live),
    };
  });
}

export type SpecStatus = EvidenceStatus | 'none';

export type SpecSummary = {
  readonly status: SpecStatus;
  readonly counts: StatusCounts;
  readonly total: number;
  readonly latestAtMs: number | null;
  readonly live: boolean;
};

export const NO_EVIDENCE: SpecSummary = { status: 'none', counts: emptyCounts(), total: 0, latestAtMs: null, live: false };

/** No recorded check is `none`, never a pass. */
export function summarizeSlots(slots: readonly CheckSlot[]): SpecSummary {
  if (!slots.length) return NO_EVIDENCE;
  const counts = emptyCounts();
  for (const slot of slots) counts[slot.status] += 1;
  const status: SpecStatus = counts.failed ? 'failed' : counts.running ? 'running' : counts.passed ? 'passed' : 'not-run';
  return {
    status,
    counts,
    total: slots.length,
    latestAtMs: Math.max(...slots.map(slot => slot.latestAtMs)),
    live: slots.some(slot => slot.live),
  };
}

export function addSummaries(summaries: readonly SpecSummary[]): SpecSummary {
  const counts = emptyCounts();
  let total = 0, latestAtMs: number | null = null, live = false;
  for (const summary of summaries) {
    for (const status of Object.keys(counts) as EvidenceStatus[]) counts[status] += summary.counts[status];
    total += summary.total;
    live ||= summary.live;
    if (summary.latestAtMs !== null) latestAtMs = Math.max(latestAtMs ?? 0, summary.latestAtMs);
  }
  if (!total) return NO_EVIDENCE;
  const status: SpecStatus = counts.failed ? 'failed' : counts.running ? 'running' : counts.passed ? 'passed' : 'not-run';
  return { status, counts, total, latestAtMs, live };
}

export type SpecEvidence = { readonly slots: readonly CheckSlot[]; readonly summary: SpecSummary };

export type EvidenceView = {
  /** Keyed by the spec path the outline uses (`specs/...`). */
  readonly specs: ReadonlyMap<string, SpecEvidence>;
  /** Results whose spec is no longer in the outline, or that name no spec. */
  readonly unassigned: readonly CheckSlot[];
  readonly total: SpecSummary;
};

export function evidenceView(combined: CombinedEvidence): EvidenceView {
  const specs = new Map<string, SpecEvidence>();
  for (const { spec, results } of combined.specs) {
    const slots = checkSlots(results);
    specs.set(spec.path, { slots, summary: summarizeSlots(slots) });
  }
  return { specs, unassigned: checkSlots(combined.unassigned), total: addSummaries([...specs.values()].map(entry => entry.summary)) };
}

/**
 * Sources left out of the combined report. An empty list means every layer
 * on that axis contributes, including layers that arrive later.
 */
export type SourceSelection = {
  readonly backends: readonly string[];
  readonly branches: readonly string[];
  readonly versions: readonly string[];
  readonly environments: readonly string[];
  readonly layers: readonly string[];
};

export const ALL_SOURCES: SourceSelection = { backends: [], branches: [], versions: [], environments: [], layers: [] };

/** A saved selection from before versions and environments were axes still means "exclude nothing new". */
export function sourceSelection(excluded: Partial<SourceSelection> | null | undefined): SourceSelection {
  return {
    backends: excluded?.backends ?? [],
    branches: excluded?.branches ?? [],
    versions: excluded?.versions ?? [],
    environments: excluded?.environments ?? [],
    layers: excluded?.layers ?? [],
  };
}

export function branchOf(layer: LayerHeader): string {
  return layer.branch ?? 'Unknown branch';
}

/** The commit a layer checked, or `unknown` when the layer did not record one. */
export function versionOf(layer: Pick<LayerHeader, 'sha'>): string {
  return layer.sha ?? 'unknown';
}

/** The client a layer checked, or `unspecified` when it did not say. */
export function environmentOf(layer: Pick<LayerHeader, 'environment'>): string {
  return layer.environment || 'unspecified';
}

export function contributes(layer: LayerHeader, excluded: Partial<SourceSelection>): boolean {
  const selection = sourceSelection(excluded);
  return !selection.backends.includes(layer.backend)
    && !selection.branches.includes(branchOf(layer))
    && !selection.versions.includes(versionOf(layer))
    && !selection.environments.includes(environmentOf(layer))
    && !selection.layers.includes(layer.id);
}

export type SourceFacet = { readonly id: string; readonly layers: number; readonly latestAtMs: number };

function facets(layers: readonly LayerHeader[], id: (layer: LayerHeader) => string): SourceFacet[] {
  const found = new Map<string, { layers: number; latestAtMs: number }>();
  for (const layer of layers) {
    const facet = found.get(id(layer)) ?? { layers: 0, latestAtMs: 0 };
    facet.layers += 1;
    facet.latestAtMs = Math.max(facet.latestAtMs, layer.recordedAtMs);
    found.set(id(layer), facet);
  }
  return [...found].map(([key, facet]) => ({ id: key, ...facet })).sort((a, b) => b.latestAtMs - a.latestAtMs || (a.id < b.id ? -1 : 1));
}

export function sourceFacets(layers: readonly LayerHeader[]) {
  return {
    backends: facets(layers, layer => layer.backend),
    branches: facets(layers, branchOf),
    versions: facets(layers, versionOf),
    environments: facets(layers, environmentOf),
  };
}

export type HistoryEntry = { readonly layer: LayerHeader; readonly row: LayerRow };

/** Every layer's own record of one check, newest first. A superseded result stays readable here. */
export function checkHistory(layers: readonly LayerEvidence[], path: string | null, id: string): HistoryEntry[] {
  const slot = slotKey(path ?? '', id);
  const entries: HistoryEntry[] = [];
  for (const { layer, rows } of layers) {
    const own = rows.filter(row => slotKey(row.specPath ?? '', row.id) === slot);
    const checked = own.filter(row => !isDiagnosticKind(row.kind));
    for (const row of checked.length ? checked : own) entries.push({ layer, row });
  }
  return entries.sort((a, b) => b.layer.recordedAtMs - a.layer.recordedAtMs || (a.layer.id < b.layer.id ? -1 : 1));
}
