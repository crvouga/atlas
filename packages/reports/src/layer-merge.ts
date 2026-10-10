import type { LayerParameters, LayerResult, LayerSummary, ReportOutline } from './layer-types';
import type { SpecEntry } from './explorer-types';

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
function warning(layer: LayerSummary, path: string | undefined, current: SpecEntry | undefined, outline: ReportOutline, recorded: SpecEntry | undefined, relatedChanged: boolean): string | null {
  if (layer.freshness === 'modified') return 'Potentially outdated: recorded from a modified checkout';
  if (layer.freshness === 'unknown') return 'Freshness unknown: recording origin was not captured';
  if (!path || !current) return 'Spec is not in the current outline';
  if (!recorded?.fingerprint || !current.fingerprint) return 'Freshness unknown: no recorded spec fingerprint';
  if (recorded.fingerprint !== current.fingerprint) return 'Potentially outdated: spec changed';
  if (relatedChanged) return 'Potentially outdated: related files changed';
  if (!layer.sha || !outline.sha || layer.sha !== outline.sha) return 'Potentially outdated: related code has not been compared';
  return null;
}
/** One linear pass. Latest completed result wins only its own check/parameter slot. */
export function combineLayers(outline: ReportOutline, layers: readonly LayerSummary[]): { specs: readonly { spec: SpecEntry; results: LayerResult[] }[]; unassigned: LayerResult[] } {
  const specs = new Map(outline.specs.map(spec => [specPath(spec.path), { spec, results: [] as LayerResult[] }]));
  const changed = new Set(outline.changedFiles.map(specPath));
  const winners = new Map<string, LayerResult>();
  const rank = { passed: 0, 'not-run': 1, running: 2, failed: 3 };
  for (const layer of distinctLayers(layers)) {
    const fingerprints = new Map(layer.specs.map(spec => [specPath(spec.path), spec]));
    const scope = layer.source?.packageDir;
    const related = outline.changedFiles.some(file => scope ? file.startsWith(`${scope}/`) : !specPath(file).startsWith('specs/'));
    const tests = new Map(layer.source?.tests.map(test => [`${layer.source!.source}/${test.testId}`, test]) ?? []);
    for (const part of layer.parts) for (const check of part.checks) {
      const test = tests.get(check.id);
      const parameters = { ...layer.parameters, ...(test ? { system: test.system, runtime: test.runtime, seed: test.seed } : {}) };
      const path = check.specPath ? specPath(check.specPath) : '';
      const key = JSON.stringify([layer.producer, part.kind, path, check.id, parameterKey(parameters)]);
      const result: LayerResult = { key, layer, check, kind: part.kind, parameters, testId: test?.testId ?? null, warning: warning(layer, check.specPath, specs.get(path)?.spec, outline, fingerprints.get(path), related || changed.has(path)) };
      const prior = winners.get(key);
      const complete = check.status === 'passed' || check.status === 'failed';
      const priorComplete = prior?.check.status === 'passed' || prior?.check.status === 'failed';
      if (!prior || (complete && !priorComplete) || (complete === priorComplete && (layer.recordedAtMs > prior.layer.recordedAtMs || (layer.recordedAtMs === prior.layer.recordedAtMs && (rank[check.status] > rank[prior.check.status] || (rank[check.status] === rank[prior.check.status] && layer.id > prior.layer.id)))))) winners.set(key, result);
    }
  }
  const unassigned: LayerResult[] = [];
  for (const result of winners.values()) (specs.get(specPath(result.check.specPath ?? ''))?.results ?? unassigned).push(result);
  return { specs: [...specs.values()], unassigned };
}

/** Suppress the mutable address of an execution already archived as an immutable layer. */
export function distinctLayers(layers: readonly LayerSummary[]): LayerSummary[] {
  const archived = new Set(layers.filter(layer => /^[0-9a-f]{64}$/.test(layer.id)).map(layerExecutionKey));
  return [...new Map(layers.filter(layer => /^[0-9a-f]{64}$/.test(layer.id) || !archived.has(layerExecutionKey(layer))).map(layer => [layer.id, layer])).values()];
}

export function layerExecutionKey(layer: LayerSummary): string {
  return JSON.stringify([layer.producer, layer.sha, layer.recordedAtMs, layer.parts]);
}
