import { parseWith } from './parse-with';
import { PublishChecksSchema, type PublishChecksInput } from '../../schema/src/layer';
import type { ReportPart } from './explorer-types';
import { normalizeEnvironment } from './layer-axes';
import { publishLayerBundle } from './layer-store';
import type { LayerSummary, ReportLayer } from './layer-types';
import type { ObjectStore } from './object-store';

/**
 * Publish the checks of one producer as one immutable layer. This is the whole integration for a
 * suite that has no timelines to record: Gherkin scenarios, a Quint run, a DMN table test, an SLO
 * evaluation, a linter, anything that ends in "this check passed or failed".
 *
 * Nothing here reads a clock: `recordedAtMs` is when the checks ran, given by the caller. Publishing
 * the same input twice therefore writes the same layer, and a retried CI step changes nothing.
 * Each check's `id` is its identity across runs. It must be stable and unique within the layer.
 */
export async function publishChecks(store: ObjectStore, input: PublishChecksInput): Promise<ReportLayer> {
  const args = parseWith(PublishChecksSchema, input, 'publishChecks');
  const seen = new Set<string>();
  for (const check of args.checks) {
    if (seen.has(check.id)) throw new Error(`publishChecks: check id "${check.id}" appears twice; a check keeps one id across runs, so ids must be unique`);
    seen.add(check.id);
  }
  const environment = normalizeEnvironment(args.environment ?? args.parameters.environment);
  const { environment: _folded, ...parameters } = args.parameters;
  const part: ReportPart = {
    sha: args.sha ?? '',
    id: args.producer,
    kind: args.kind,
    title: args.title ?? args.producer,
    recordedAtMs: args.recordedAtMs,
    checks: args.checks as ReportPart['checks']
  };
  // Key order is part of the layer's identity: build it the one way.
  const summary: Omit<LayerSummary, 'id'> = {
    ...(args.freshness ? { freshness: args.freshness } : {}),
    producer: args.producer,
    recordedAtMs: args.recordedAtMs,
    sha: args.sha,
    branch: args.branch,
    runUrl: args.runUrl,
    ...(environment ? { environment } : {}),
    parameters: Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    specs: args.specs as LayerSummary['specs'],
    parts: [part],
    source: null,
    recording: null
  };
  return publishLayerBundle(store, summary, {});
}
