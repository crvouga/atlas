import type { EvidenceStatus, SpecEntry } from './explorer-types';
import type { LayerEvidence, LayerHeader, LayerRow, StatusCounts } from './evidence-types';
import { summarizeEvidence } from './evidence-detail';
import { layerPlace } from './layer-axes';
import type { LayerParameters, LayerSummary, ReportOutline } from './layer-types';

/** Advisory identity, never a cryptographic integrity check. */
export function textFingerprint(text: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
export function specPath(path: string): string {
  // Up to the first folder named exactly `specs`: `myspecs/x` is not in one.
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^(?:.*?\/)?(?=specs\/)/, '');
}
export function parameterKey(parameters: LayerParameters): string {
  return JSON.stringify(Object.entries(parameters).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

/** Recorded timings qualify an outcome. They are a result of their own only when nothing else checked the same thing. */
export function isDiagnosticKind(kind: string): boolean {
  return kind === 'performance';
}

export function emptyCounts(): Record<EvidenceStatus, number> {
  return { passed: 0, failed: 0, running: 0, 'not-run': 0 };
}

/** Outcomes of a layer: its checks, without the timings that only qualify them. */
export function outcomeCounts(rows: readonly LayerRow[]): StatusCounts {
  const outcomes = rows.some(row => !isDiagnosticKind(row.kind)) ? rows.filter(row => !isDiagnosticKind(row.kind)) : rows;
  const counts = emptyCounts();
  for (const row of outcomes) counts[row.status] += 1;
  return counts;
}

/** A layer as the explorer reads it: its origin, and each check as one row. */
export function layerEvidence(summary: LayerSummary, backend: string): LayerEvidence {
  const place = layerPlace(summary);
  const source = summary.source;
  const tests = new Map(source?.tests.map(test => [`${source.source}/${test.testId}`, test]) ?? []);
  // A layer's checks repeat a handful of spec paths; each is normalized once.
  const normalized = new Map<string, string>();
  const specOf = (path: string) => {
    let found = normalized.get(path);
    if (found === undefined) normalized.set(path, found = specPath(path));
    return found;
  };
  const rows: LayerRow[] = [];
  for (const part of summary.parts) {
    for (const check of part.checks) {
      const test = tests.get(check.id);
      const evidence = summarizeEvidence(check);
      rows.push({
        kind: part.kind,
        id: check.id,
        title: check.title,
        status: check.status,
        specPath: check.specPath ? specOf(check.specPath) : null,
        detail: check.detail,
        measurements: check.measurements,
        testId: test?.testId ?? null,
        variant: test ? { system: test.system, runtime: test.runtime, seed: test.seed } : {},
        durationMs: test?.durationMs ?? check.durationMs ?? null,
        ...(evidence ? { evidence } : {}),
      });
    }
  }
  const recording = summary.recording;
  const layerSummaryEvidence = summarizeEvidence(summary, ...summary.parts);
  const layer: LayerHeader = {
    ...(summary.freshness ? { freshness: summary.freshness } : {}),
    id: summary.id,
    backend,
    producer: summary.producer,
    packageDir: source?.packageDir ?? null,
    recordedAtMs: summary.recordedAtMs,
    sha: summary.sha,
    branch: summary.branch,
    environment: place.environment,
    runUrl: summary.runUrl,
    parameters: place.parameters,
    recording: recording === null ? null : recording.type === 'layer' ? { type: 'layer', layer: summary.id } : recording,
    live: false,
    counts: outcomeCounts(rows),
    execution: textFingerprint(layerExecutionKey(summary)),
    ...(layerSummaryEvidence ? { evidence: layerSummaryEvidence } : {}),
  };
  const fingerprints: Record<string, string> = {};
  for (const spec of summary.specs) if (spec.fingerprint) fingerprints[specPath(spec.path)] = spec.fingerprint;
  return { id: summary.id, layer, rows, fingerprints };
}

export type EvidenceResult = {
  /** One producer's check of one kind under one parameter set. */
  readonly key: string;
  /** The check itself, whatever kind of evidence and parameters describe it. */
  readonly slot: string;
  readonly layer: LayerHeader;
  readonly row: LayerRow;
  readonly parameters: LayerParameters;
  readonly warning: string | null;
};

function warning(layer: LayerHeader, path: string, current: SpecEntry | undefined, outline: ReportOutline, recorded: string | undefined, relatedChanged: boolean): string | null {
  if (layer.live) return null;
  if (layer.freshness === 'modified') return 'Potentially outdated: recorded from a modified checkout';
  if (layer.freshness === 'unknown') return 'Freshness unknown: recording origin was not captured';
  if (!path || !current) return 'Spec is not in the current outline';
  if (!recorded || !current.fingerprint) return 'Freshness unknown: no recorded spec fingerprint';
  if (recorded !== current.fingerprint) return 'Potentially outdated: spec changed';
  if (relatedChanged) return 'Potentially outdated: related files changed';
  if (!layer.sha || !outline.sha || layer.sha !== outline.sha) return 'Potentially outdated: related code has not been compared';
  return null;
}

const RANK = { passed: 0, 'not-run': 1, running: 2, failed: 3 } as const;

function completed(status: EvidenceStatus): boolean {
  return status === 'passed' || status === 'failed';
}

/** A newer completed result takes its slot. An unfinished one never replaces a completed one, and a tie fails. */
export function replaces(next: EvidenceResult, prior: EvidenceResult): boolean {
  const done = completed(next.row.status);
  const priorDone = completed(prior.row.status);
  if (done !== priorDone) return done;
  if (next.layer.recordedAtMs !== prior.layer.recordedAtMs) return next.layer.recordedAtMs > prior.layer.recordedAtMs;
  if (RANK[next.row.status] !== RANK[prior.row.status]) return RANK[next.row.status] > RANK[prior.row.status];
  // The last tie-break is total, so no input order can change the answer.
  return layerOrder(next.layer) > layerOrder(prior.layer);
}

function layerOrder(layer: LayerHeader): string {
  return `${layer.id}|${layer.backend}`;
}

export type CombinedEvidence = {
  readonly specs: readonly { readonly spec: SpecEntry; readonly results: EvidenceResult[] }[];
  readonly unassigned: EvidenceResult[];
};

/** One linear pass. The newest completed result wins only its own check, environment and parameter slot. */
export function combineEvidence(outline: ReportOutline, layers: readonly LayerEvidence[]): CombinedEvidence {
  const specs = new Map(outline.specs.map(spec => [specPath(spec.path), { spec, results: [] as EvidenceResult[] }]));
  const changed = new Set(outline.changedFiles.map(specPath));
  const winners = new Map<string, EvidenceResult>();
  for (const { layer, rows, fingerprints } of distinctEvidence(layers)) {
    const scope = layer.packageDir;
    const related = outline.changedFiles.some(file => scope ? file.startsWith(`${scope}/`) : !specPath(file).startsWith('specs/'));
    const keyOf = layerResultKeys(layer);
    for (const row of rows) {
      // Environment and the layer's other choices split the slot. A harness
      // seed does not: a focused rerun replaces the check it repeated.
      const parameters = layer.parameters;
      const path = row.specPath ?? '';
      const key = keyOf(row);
      const result: EvidenceResult = { key, slot: slotKey(path, row.id), layer, row, parameters, warning: warning(layer, path, specs.get(path)?.spec, outline, fingerprints[path], related || changed.has(path)) };
      const prior = winners.get(key);
      if (!prior || replaces(result, prior)) winners.set(key, result);
    }
  }
  const unassigned: EvidenceResult[] = [];
  for (const result of winners.values()) (specs.get(result.row.specPath ?? '')?.results ?? unassigned).push(result);
  return { specs: [...specs.values()], unassigned };
}

/** The slot a row fills: one producer's check of one kind, in one environment, under one parameter set. */
export function resultKey(layer: Pick<LayerHeader, 'producer' | 'environment' | 'parameters'>, row: Pick<LayerRow, 'kind' | 'specPath' | 'id'>): string {
  return JSON.stringify([layer.producer, row.kind, row.specPath ?? '', row.id, layer.environment ?? '', parameterKey(layer.parameters)]);
}

/**
 * `resultKey` for every row of one layer, which share all but three parts of it. The strings are exactly
 * those `resultKey` makes (they are keys that persist in no store, but two ways of making one must agree),
 * without sorting and writing the layer's parameters once per check.
 */
export function layerResultKeys(layer: Pick<LayerHeader, 'producer' | 'environment' | 'parameters'>): (row: Pick<LayerRow, 'kind' | 'specPath' | 'id'>) => string {
  const producer = JSON.stringify(layer.producer);
  const tail = `,${JSON.stringify(layer.environment ?? '')},${JSON.stringify(parameterKey(layer.parameters))}]`;
  return row => `[${producer},${JSON.stringify(row.kind)},${JSON.stringify(row.specPath ?? '')},${JSON.stringify(row.id)}${tail}`;
}

export function slotKey(path: string, id: string): string {
  return JSON.stringify([path, id]);
}

function archived(id: string): boolean {
  return /^[0-9a-f]{64}$/.test(id);
}

/**
 * Suppress the mutable address of an execution already archived as an immutable layer. An
 * immutable layer held by several backends is one layer, reported by the backend that sorts first,
 * whatever order they were read in. A mutable one is its backend's own.
 */
export function distinctHeaders<T extends { readonly id: string; readonly execution: string; readonly backend?: string }>(layers: readonly T[]): T[] {
  const kept = new Set(layers.filter(layer => archived(layer.id)).map(layer => layer.execution));
  const chosen = new Map<string, T>();
  for (const layer of layers) {
    if (!archived(layer.id) && kept.has(layer.execution)) continue;
    const key = archived(layer.id) ? layer.id : `${layer.backend ?? ''}|${layer.id}`;
    const prior = chosen.get(key);
    if (!prior || (layer.backend ?? '') < (prior.backend ?? '')) chosen.set(key, layer);
  }
  return [...chosen.values()];
}

export function distinctEvidence(layers: readonly LayerEvidence[]): LayerEvidence[] {
  const kept = new Set(distinctHeaders(layers.map(entry => entry.layer)).map(layer => `${layer.backend}|${layer.id}`));
  const emitted = new Set<string>();
  return layers.filter(entry => {
    const key = `${entry.layer.backend}|${entry.id}`;
    if (!kept.has(key) || emitted.has(key)) return false;
    emitted.add(key);
    return true;
  });
}

/** Suppress the mutable address of an execution already archived as an immutable layer. */
export function distinctLayers(layers: readonly LayerSummary[]): LayerSummary[] {
  const kept = new Set(layers.filter(layer => archived(layer.id)).map(layerExecutionKey));
  return [...new Map(layers.filter(layer => archived(layer.id) || !kept.has(layerExecutionKey(layer))).map(layer => [layer.id, layer])).values()];
}

export function layerExecutionKey(layer: LayerSummary): string {
  return JSON.stringify([layer.producer, layer.sha, layer.recordedAtMs, layer.parts]);
}
