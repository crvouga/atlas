/**
 * @module Publishing critiques
 *
 * `publishCritiques` publishes a critic's outcomes as one layer through any store, after checking that the layer is
 * within what a critic-scoped credential may publish. The layer is content-addressed, so publishing the same outcomes
 * again writes the same layer and changes nothing.
 *
 * @see docs/critics.md
 */
import type { ReportLayer } from '../../reports/src/layer-types';
import type { ObjectStore } from '../../reports/src/object-store';
import { publishChecks, type PublishChecksOptions } from '../../reports/src/publish-checks';
import { critiqueLayer } from './critique';
import { criticScopeViolation } from './scope';

/**
 * Publishes the layer {@link critiqueLayer} builds for `args`. Returns the stored layer, or `null` when there is nothing
 * to publish (no outcomes). Throws when the layer would be outside a critic's scope, which cannot happen for a layer
 * built here and is checked so that a change cannot make it happen quietly.
 *
 * @param store where to publish.
 * @param args see {@link critiqueLayer}.
 * @param options attachment limits, as for `publishChecks`.
 */
export async function publishCritiques(store: ObjectStore, args: Parameters<typeof critiqueLayer>[0], options: PublishChecksOptions = {}): Promise<ReportLayer | null> {
  if (!args.outcomes.length) return null;
  const input = critiqueLayer(args);
  const violation = criticScopeViolation({ producer: input.producer, parts: [{ kind: input.kind }] });
  if (violation) throw new Error(violation);
  return publishChecks(store, input, options);
}
