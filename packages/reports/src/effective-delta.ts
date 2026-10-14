/**
 * @module Report deltas
 *
 * The client half of "send only what changed": `applyEffectiveDelta` turns the report a viewer holds and a delta from the
 * server (`GET /api/reports/evidence/effective?since=<version>`) into the current report. Pure and free of Node APIs, so a
 * browser bundle uses it. The server half is `ReportIndex.delta`; a test holds the two together over random runs.
 *
 * @see docs/server.md#reading-only-what-changed
 */

import type { LayerEvidence } from './evidence-types';
import type { EffectiveEvidence } from './report-index';

/**
 * What a server answers when a viewer asks for the report `since` a version it holds and the server still
 * remembers that version: only what changed. `layers` are whole layers (with the rows that win), replacing those
 * of the same id; `removed` are layers that no longer win anything. Everything else, `backends` and `notices`
 * and the count, is sent whole because it is small.
 *
 * It is an optimisation and nothing else: applying it gives exactly the report the server would have sent in
 * full, and a server that does not know it sends the full report, which a viewer takes as it always did.
 */
export type EffectiveDelta = Omit<EffectiveEvidence, 'layers'> & {
  readonly delta: true;
  /** The version this applies to. */
  readonly base: string;
  readonly layers: readonly LayerEvidence[];
  readonly removed: readonly string[];
};

/** Is `value` a delta (`delta: true`, a `base` version, `layers` and `removed`) and not a whole report? Decides which of the two a server answered. */
export const isEffectiveDelta = (value: unknown): value is EffectiveDelta =>
  typeof value === 'object' && value !== null && (value as { delta?: unknown }).delta === true && typeof (value as { base?: unknown }).base === 'string' && Array.isArray((value as { layers?: unknown }).layers) && Array.isArray((value as { removed?: unknown }).removed);

/** The report order: newest first, ties by id. */
const byRecency = (a: LayerEvidence, b: LayerEvidence) => b.layer.recordedAtMs - a.layer.recordedAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The report a delta leads to, or null when it does not apply to `held` (a different version): ask for the
 * whole report then.
 */
export function applyEffectiveDelta(held: EffectiveEvidence, delta: EffectiveDelta): EffectiveEvidence | null {
  if (held.version !== delta.base) return null;
  const gone = new Set(delta.removed);
  const replaced = new Set(delta.layers.map(layer => layer.id));
  const layers = [...held.layers.filter(layer => !gone.has(layer.id) && !replaced.has(layer.id)), ...delta.layers].sort(byRecency);
  return { version: delta.version, layers, backends: delta.backends, notices: delta.notices, totalLayers: delta.totalLayers };
}
