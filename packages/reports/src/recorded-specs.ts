/**
 * @module Specs the layers recorded
 *
 * When no spec set was published, a report is laid over the specs its layers say they ran against (each layer's
 * `specs[]`). `RecordedSpecs` keeps one entry per spec path: the one from the newest layer, and at the same time the
 * one with the larger fingerprint, so the outline it gives does not depend on the order layers are read in. The CLI's
 * composition and the server's live report use it alike, so the two cannot disagree about which specs a report has.
 *
 * @see docs/report-contract.md#how-layers-compose
 */
import type { SpecEntry } from './explorer-types';
import { specPath } from './layer-merge';

/**
 * The specs layers recorded, newest first per path. Add every included layer's `specs[]` with its `recordedAtMs`;
 * `entries()` is the outline, sorted by path.
 *
 * @example
 * ```ts
 * const recorded = new RecordedSpecs();
 * for (const layer of layers) recorded.add(layer.specs, layer.recordedAtMs);
 * const outline = { specs: recorded.entries(), sha: null, changedFiles: [] };
 * ```
 */
export class RecordedSpecs {
  readonly #byPath = new Map<string, { entry: SpecEntry; at: number }>();
  #sorted: SpecEntry[] | null = null;

  /** Takes in the specs one layer recorded at `at` (epoch ms). A spec whose path is empty is ignored. */
  add(specs: readonly SpecEntry[], at: number): void {
    for (const spec of specs) {
      if (!spec.path) continue;
      const key = specPath(spec.path);
      const prior = this.#byPath.get(key);
      if (!prior || at > prior.at || (at === prior.at && (spec.fingerprint ?? '') > (prior.entry.fingerprint ?? ''))) {
        this.#byPath.set(key, { entry: { ...spec, path: key }, at });
        this.#sorted = null;
      }
    }
  }

  /** The recorded spec at a path (as `specPath` normalises it), or undefined. */
  get(path: string): SpecEntry | undefined {
    return this.#byPath.get(specPath(path))?.entry;
  }

  /** How many distinct specs were recorded. */
  get size(): number {
    return this.#byPath.size;
  }

  /** Every recorded spec, sorted by path. */
  entries(): readonly SpecEntry[] {
    this.#sorted ??= [...this.#byPath.values()].map(item => item.entry).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return this.#sorted;
  }
}
