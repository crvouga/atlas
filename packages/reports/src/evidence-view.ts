/**
 * @module The viewer's model of a combined report
 *
 * Pure functions that reshape a combined report for display: results grouped per check (a {@link CheckSlot}), rolled
 * up per spec and overall, the facets by which layers are included or left out, and the history of one check across
 * layers. They never change a result: statuses come from the composition (`layer-merge.ts`), and a spec with no
 * recorded check is `none`, never a pass.
 *
 * @see docs/report-contract.md
 */
import type { EvidenceStatus } from './explorer-types';
import type { LayerEvidence, LayerHeader, LayerRow, StatusCounts } from './evidence-types';
import { emptyCounts, isDiagnosticKind, isOpinionKind, slotKey, type CombinedEvidence, type EvidenceResult } from './layer-merge';

const WORST = { passed: 0, 'not-run': 1, running: 2, failed: 3 } as const;

function worst(statuses: readonly EvidenceStatus[]): EvidenceStatus {
  let status: EvidenceStatus = 'passed';
  for (const next of statuses) if (WORST[next] > WORST[status]) status = next;
  return status;
}

/** Everything the combined report holds for one check. */
export type CheckSlot = {
  /** The check's key (its spec path and id), shared by all of its results. */
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly specPath: string | null;
  /** The worst outcome across the check's parameter sets (failed, then running, then not-run, then passed). */
  readonly status: EvidenceStatus;
  /** What happened, newest first. One entry per producer, environment and parameter set. */
  readonly outcomes: readonly EvidenceResult[];
  /** Recorded timings of the same check. They never change its outcome. */
  readonly diagnostics: readonly EvidenceResult[];
  /** The newest `recordedAtMs` among all of its results, diagnostics included. */
  readonly latestAtMs: number;
  /** True when any result comes from a run that is still in progress. */
  readonly live: boolean;
};

function newestFirst(a: EvidenceResult, b: EvidenceResult): number {
  return b.layer.recordedAtMs - a.layer.recordedAtMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * Groups the combined results (the winners of the slots) by check, in the order the checks were first seen.
 * A check's status is the worst of its non-diagnostic results; if it has only diagnostics (timings), those are its
 * outcomes. The title and id shown are the newest result's. Opinions (parts of kind `critique`, see `isOpinionKind`) are
 * not checks and are left out.
 */
export function checkSlots(results: readonly EvidenceResult[]): CheckSlot[] {
  const groups = new Map<string, EvidenceResult[]>();
  for (const result of results) {
    if (isOpinionKind(result.row.kind)) continue;
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

/** A spec's rolled-up status: the worst of its checks, or `none` when nothing was recorded for it. */
export type SpecStatus = EvidenceStatus | 'none';

/** The rollup of a set of checks (one spec, or the whole report). */
export type SpecSummary = {
  /** `failed` if any check failed, else `running`, else `passed` if any passed, else `not-run`; `none` with no checks. */
  readonly status: SpecStatus;
  /** Checks by their own status. */
  readonly counts: StatusCounts;
  readonly total: number;
  /** The newest `recordedAtMs` among them, or null with no checks. */
  readonly latestAtMs: number | null;
  readonly live: boolean;
};

/** The summary of a spec with no recorded check: status `none`, which is not a pass. */
export const NO_EVIDENCE: SpecSummary = { status: 'none', counts: emptyCounts(), total: 0, latestAtMs: null, live: false };

/** Rolls the checks of one spec up into a {@link SpecSummary}. No recorded check is `none`, never a pass. */
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

/** Adds several summaries (for example every spec's) into one, with the same status rule; `none` when they hold no checks at all. */
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

/** One spec's checks and their rollup. */
export type SpecEvidence = { readonly slots: readonly CheckSlot[]; readonly summary: SpecSummary };

/** The combined report as the viewer draws it. */
export type EvidenceView = {
  /** Keyed by the spec path the outline uses (`specs/...`). */
  readonly specs: ReadonlyMap<string, SpecEvidence>;
  /** Results whose spec is no longer in the outline, or that name no spec. */
  readonly unassigned: readonly CheckSlot[];
  /** The rollup of the specs in the outline only; `unassigned` results are not counted in it. */
  readonly total: SpecSummary;
};

/** Builds the {@link EvidenceView} of a combined report: every spec of the outline gets an entry, with an empty one when it has no results. */
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
  /** Backend ids to leave out. */
  readonly backends: readonly string[];
  /** Branch names to leave out; `Unknown branch` stands for layers with no branch. */
  readonly branches: readonly string[];
  /** Commit shas to leave out; `unknown` stands for layers with no sha. */
  readonly versions: readonly string[];
  /** Environment slugs to leave out; `unspecified` stands for layers with none. */
  readonly environments: readonly string[];
  /** Layer ids to leave out. */
  readonly layers: readonly string[];
};

/** The selection that leaves nothing out: every layer contributes. */
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

/** The branch a layer was recorded on, or `Unknown branch` when it did not say. */
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

/** Whether a layer takes part given what is left out: false when its backend, branch, commit, environment or id is excluded. Missing axes in `excluded` exclude nothing. */
export function contributes(layer: LayerHeader, excluded: Partial<SourceSelection>): boolean {
  const selection = sourceSelection(excluded);
  return !selection.backends.includes(layer.backend)
    && !selection.branches.includes(branchOf(layer))
    && !selection.versions.includes(versionOf(layer))
    && !selection.environments.includes(environmentOf(layer))
    && !selection.layers.includes(layer.id);
}

/** One choice on an axis of the sources panel: its value, how many layers have it, and the newest `recordedAtMs` among them. */
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

/** Counts the layers per backend, branch, commit and environment, each list newest first (ties by name). */
export function sourceFacets(layers: readonly LayerHeader[]) {
  return {
    backends: facets(layers, layer => layer.backend),
    branches: facets(layers, branchOf),
    versions: facets(layers, versionOf),
    environments: facets(layers, environmentOf),
  };
}

/** One layer's record of a check. */
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
