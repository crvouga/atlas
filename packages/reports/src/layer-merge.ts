import type { EvidenceStatus, SpecEntry } from './explorer-types';
import type { LayerEvidence, LayerHeader, LayerRow, StatusCounts } from './evidence-types';
import type { LayerParameters, LayerSummary, ReportOutline } from './layer-types';

/** Advisory identity, never a cryptographic integrity check. */
export function textFingerprint(text: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
export function specPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^.*?(?=specs\/)/, '');
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
  const source = summary.source;
  const tests = new Map(source?.tests.map(test => [`${source.source}/${test.testId}`, test]) ?? []);
  const rows: LayerRow[] = summary.parts.flatMap(part => part.checks.map(check => {
    const test = tests.get(check.id);
    const variant: LayerParameters = test ? { system: test.system, runtime: test.runtime, seed: test.seed } : {};
    return {
      kind: part.kind,
      id: check.id,
      title: check.title,
      status: check.status,
      specPath: check.specPath ? specPath(check.specPath) : null,
      detail: check.detail,
      measurements: check.measurements,
      testId: test?.testId ?? null,
      variant,
      durationMs: test?.durationMs ?? null,
    };
  }));
  const recording = summary.recording;
  const layer: LayerHeader = {
    ...(summary.freshness ? { freshness: summary.freshness } : {}),
    id: summary.id,
    backend,
    producer: summary.producer,
    packageDir: source?.packageDir ?? null,
    recordedAtMs: summary.recordedAtMs,
    sha: summary.sha,
    branch: summary.branch,
    runUrl: summary.runUrl,
    parameters: summary.parameters,
    recording: recording === null ? null : recording.type === 'layer' ? { type: 'layer', layer: summary.id } : recording,
    live: false,
    counts: outcomeCounts(rows),
    execution: textFingerprint(layerExecutionKey(summary)),
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
function replaces(next: EvidenceResult, prior: EvidenceResult): boolean {
  const done = completed(next.row.status);
  const priorDone = completed(prior.row.status);
  if (done !== priorDone) return done;
  if (next.layer.recordedAtMs !== prior.layer.recordedAtMs) return next.layer.recordedAtMs > prior.layer.recordedAtMs;
  if (RANK[next.row.status] !== RANK[prior.row.status]) return RANK[next.row.status] > RANK[prior.row.status];
  return next.layer.id > prior.layer.id;
}

export type CombinedEvidence = {
  readonly specs: readonly { readonly spec: SpecEntry; readonly results: EvidenceResult[] }[];
  readonly unassigned: EvidenceResult[];
};

/** One linear pass. Latest completed result wins only its own check/parameter slot. */
export function combineEvidence(outline: ReportOutline, layers: readonly LayerEvidence[]): CombinedEvidence {
  const specs = new Map(outline.specs.map(spec => [specPath(spec.path), { spec, results: [] as EvidenceResult[] }]));
  const changed = new Set(outline.changedFiles.map(specPath));
  const winners = new Map<string, EvidenceResult>();
  for (const { layer, rows, fingerprints } of distinctEvidence(layers)) {
    const scope = layer.packageDir;
    const related = outline.changedFiles.some(file => scope ? file.startsWith(`${scope}/`) : !specPath(file).startsWith('specs/'));
    for (const row of rows) {
      const parameters = { ...layer.parameters, ...row.variant };
      const path = row.specPath ?? '';
      const key = JSON.stringify([layer.producer, row.kind, path, row.id, parameterKey(parameters)]);
      const result: EvidenceResult = { key, slot: slotKey(path, row.id), layer, row, parameters, warning: warning(layer, path, specs.get(path)?.spec, outline, fingerprints[path], related || changed.has(path)) };
      const prior = winners.get(key);
      if (!prior || replaces(result, prior)) winners.set(key, result);
    }
  }
  const unassigned: EvidenceResult[] = [];
  for (const result of winners.values()) (specs.get(result.row.specPath ?? '')?.results ?? unassigned).push(result);
  return { specs: [...specs.values()], unassigned };
}

export function slotKey(path: string, id: string): string {
  return JSON.stringify([path, id]);
}

function archived(id: string): boolean {
  return /^[0-9a-f]{64}$/.test(id);
}

/** Suppress the mutable address of an execution already archived as an immutable layer. */
export function distinctHeaders<T extends { readonly id: string; readonly execution: string }>(layers: readonly T[]): T[] {
  const kept = new Set(layers.filter(layer => archived(layer.id)).map(layer => layer.execution));
  return [...new Map(layers.filter(layer => archived(layer.id) || !kept.has(layer.execution)).map(layer => [layer.id, layer])).values()];
}

export function distinctEvidence(layers: readonly LayerEvidence[]): LayerEvidence[] {
  const kept = new Set(distinctHeaders(layers.map(entry => entry.layer)).map(layer => layer.id));
  return [...new Map(layers.filter(entry => kept.has(entry.id)).map(entry => [entry.id, entry])).values()];
}

/** Suppress the mutable address of an execution already archived as an immutable layer. */
export function distinctLayers(layers: readonly LayerSummary[]): LayerSummary[] {
  const kept = new Set(layers.filter(layer => archived(layer.id)).map(layerExecutionKey));
  return [...new Map(layers.filter(layer => archived(layer.id) || !kept.has(layerExecutionKey(layer))).map(layer => [layer.id, layer])).values()];
}

export function layerExecutionKey(layer: LayerSummary): string {
  return JSON.stringify([layer.producer, layer.sha, layer.recordedAtMs, layer.parts]);
}
