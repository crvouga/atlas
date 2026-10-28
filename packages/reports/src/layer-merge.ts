/**
 * @module Layer composition: slots, winners and de-duplication
 *
 * The pure core of the composition rule: it flattens layers into rows, computes the slot key each row fills, decides
 * which result wins a slot, and removes the duplicate copies of one immutable layer held by several backends. It does
 * no I/O. The winner order (a completed result beats an unfinished one, then the newer `recordedAtMs`, then
 * `failed` over `passed` and `running` over `not-run`, then the greater `layerId|backendId`) is a total order and is
 * part of the stable report contract: changing it changes every report. `report-index.ts` folds layers into the same
 * winners incrementally and must always equal `combineEvidence`.
 *
 * @see docs/report-contract.md#how-layers-compose
 */
import type { EvidenceStatus, SpecEntry } from './explorer-types';
import type { LayerEvidence, LayerHeader, LayerRow, StatusCounts } from './evidence-types';
import { summarizeEvidence, summarizeLayerEvidence } from './evidence-detail';
import { layerPlace } from './layer-axes';
import type { LayerParameters, LayerSummary, ReportOutline } from './layer-types';

/**
 * A short, deterministic fingerprint of a spec's text, shaped `<length>:<hash>:<hash>` (the length in UTF-16 code
 * units and two 32-bit hashes in hex). A layer records it per spec so a reader can warn when the spec changed
 * since ("Potentially outdated: spec changed"). Advisory identity only: it is not collision resistant and never an
 * integrity check.
 */
export function textFingerprint(text: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
/**
 * Normalises a check's or spec's path to its `specs/<path inside the specs directory>` form, so the same spec
 * recorded from different checkouts is one spec.
 *
 * Converts `\` to `/`, drops a leading `./`, and drops everything before the first path segment named exactly
 * `specs`. A path with no such segment is returned unchanged (apart from the first two steps).
 *
 * @example
 * specPath('packages/app/specs/join.feature'); // 'specs/join.feature'
 * specPath('myspecs/x.feature'); // 'myspecs/x.feature'
 */
export function specPath(path: string): string {
  // Up to the first folder named exactly `specs`: `myspecs/x` is not in one.
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^(?:.*?\/)?(?=specs\/)/, '');
}
/** Serialises parameters as JSON key/value pairs sorted by key, so equal parameter sets compare equal as strings. */
export function parameterKey(parameters: LayerParameters): string {
  return JSON.stringify(Object.entries(parameters).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

/** Whether a part `kind` only qualifies an outcome (today only `performance`) and so is not counted as a check when anything else is recorded. */
export function isDiagnosticKind(kind: string): boolean {
  return kind === 'performance';
}

/** A fresh status tally with every status at zero. */
export function emptyCounts(): Record<EvidenceStatus, number> {
  return { passed: 0, failed: 0, running: 0, 'not-run': 0 };
}

/**
 * Counts rows by status, leaving out the diagnostic rows (see `isDiagnosticKind`) that only qualify an outcome.
 * When every row is diagnostic they are counted, so a layer of timings alone is not empty.
 */
export function outcomeCounts(rows: readonly LayerRow[]): StatusCounts {
  const outcomes = rows.some(row => !isDiagnosticKind(row.kind)) ? rows.filter(row => !isDiagnosticKind(row.kind)) : rows;
  const counts = emptyCounts();
  for (const row of outcomes) counts[row.status] += 1;
  return counts;
}

/**
 * Flattens a layer into what composition reads: a header (origin, normalised environment and parameters, counts,
 * evidence summary), one row per check of every part, and the spec fingerprints it recorded.
 *
 * `backend` is the id of the backend the layer was read from; it only breaks ties between copies. Paths in rows and
 * fingerprints go through `specPath`. When the layer has a recorded `source`, a row whose check id matches one of its
 * tests also gets that test's `testId`, `variant` and duration. The result is `live: false`: a layer read from a
 * store is never a run still in progress.
 */
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
  const layerSummaryEvidence = summarizeLayerEvidence(summary, ...summary.parts);
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

/** The winning result of one slot: which layer and row it came from, and whether it may be stale. */
export type EvidenceResult = {
  /** One producer's check of one kind under one parameter set. See `resultKey`. */
  readonly key: string;
  /** The check itself, whatever kind of evidence and parameters describe it. See `slotKey`. */
  readonly slot: string;
  /** The layer that recorded this result. */
  readonly layer: LayerHeader;
  /** The check as recorded. */
  readonly row: LayerRow;
  /** The layer's parameters other than the environment. */
  readonly parameters: LayerParameters;
  /** Why the result may be out of date, or `null` when nothing suggests it. Advisory: never changes the status. */
  readonly warning: string | null;
};

/**
 * The freshness warning for one result, or `null` when it is current. Checked in this order: a live run has none;
 * a `modified` or `unknown` layer; a spec that is not in the outline; a missing fingerprint on either side; a
 * fingerprint that differs from the current spec; related files that changed; a layer sha that differs from the
 * outline's (or either absent). Advisory only: a warning never changes a status.
 */
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

/**
 * Whether `next` should take the slot currently held by `prior`: the winner rule of the report contract.
 *
 * In order: a completed result (`passed`, `failed`) beats an unfinished one (`running`, `not-run`) whatever their
 * times; otherwise the greater `recordedAtMs` wins; at the same time `failed` beats `passed` and `running` beats
 * `not-run`; at the same status the greater `layerId|backendId` wins. The last step makes the order total, so the
 * answer never depends on the order results are offered in. Returns `false` for two identical results.
 */
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

/** The winners of every slot, grouped under the spec of the current outline they belong to. */
export type CombinedEvidence = {
  /** One entry per spec of the outline, in outline order (a spec with no results has an empty list). */
  readonly specs: readonly { readonly spec: SpecEntry; readonly results: EvidenceResult[] }[];
  /** Winners whose spec path is absent or not in the outline (a removed spec keeps its evidence here). */
  readonly unassigned: EvidenceResult[];
};

/**
 * Lays layers over the outline of current specs and returns the winner of every slot.
 *
 * One linear pass over the rows of the layers (after `distinctEvidence`). The slot is producer, kind, spec path,
 * check id, environment and parameters; `replaces` picks the winner, so the result does not depend on the order of
 * `layers`. Branch, sha, backend and run never split a slot. Each result carries a freshness `warning`, computed
 * against `outline`, that does not affect which result wins.
 *
 * @see docs/report-contract.md#how-layers-compose
 */
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

/**
 * The key of the slot a row fills: a JSON array of producer, kind, spec path (`''` when none), check id, environment
 * (`''` when none) and the sorted parameters. Two results with the same key compete; the winner is `replaces`.
 */
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

/** The key of a check regardless of producer, environment and parameters: a JSON array of its spec path and check id. */
export function slotKey(path: string, id: string): string {
  return JSON.stringify([path, id]);
}

/** Whether a layer id is a content digest (64 lowercase hex digits), that is an immutable layer rather than a mutable address. */
function archived(id: string): boolean {
  return /^[0-9a-f]{64}$/.test(id);
}

/**
 * De-duplicates layer headers: the same layer held by several backends is one layer.
 *
 * Suppresses the mutable address of an execution already archived as an immutable layer. An
 * immutable layer (64-hex id) held by several backends is one layer, reported by the backend whose id sorts
 * first, whatever order they were read in. A mutable one is its backend's own and is kept once per backend.
 * Returns the survivors, not necessarily in input order.
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

/** Keeps, in input order, only the layers `distinctHeaders` keeps, and each `backend|id` once. */
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

/** Drops each mutable layer whose execution is already archived as an immutable one, and keeps one summary per id. */
export function distinctLayers(layers: readonly LayerSummary[]): LayerSummary[] {
  const kept = new Set(layers.filter(layer => archived(layer.id)).map(layerExecutionKey));
  return [...new Map(layers.filter(layer => archived(layer.id) || !kept.has(layerExecutionKey(layer))).map(layer => [layer.id, layer])).values()];
}

/**
 * A string equal for the mutable and the archived address of one execution: its producer, sha, time and parts.
 * Object key order is ignored at every depth, including check evidence and extensions; array order is preserved.
 * This is an advisory execution identity, not the content digest that addresses an immutable layer in storage.
 */
export function layerExecutionKey(layer: LayerSummary): string {
  return JSON.stringify([layer.producer, layer.sha, layer.recordedAtMs, orderedValue(layer.parts)]);
}

/** Sort JSON objects recursively without changing array order or interpreting extension keys as prototypes. */
function orderedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedValue);
  if (value === null || typeof value !== 'object') return value;
  const ordered: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value).sort()) ordered[key] = orderedValue((value as Record<string, unknown>)[key]);
  return ordered;
}
