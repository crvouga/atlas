/**
 * @module The scope of a critic's credential
 *
 * A critic only needs to add opinions, so its credential may read and publish layers whose producer is `critic.<name>`
 * and whose parts are all of kind `critique`, and nothing else. `criticScopeViolation` names the rule a layer breaks;
 * the server applies it to every layer a critic-role token uploads, so a stolen critic token cannot forge test results.
 *
 * @see docs/critics.md#authentication-and-authorization
 */
import { CRITIC_PRODUCER_PREFIX, CRITIQUE_PART_KIND } from '../../schema/src/critique';

/**
 * The rule a layer breaks for a critic-scoped credential, or `null` when it is within scope. The message says which rule
 * and what was found, so the critic can fix it.
 */
export function criticScopeViolation(layer: { readonly producer?: unknown; readonly parts?: unknown }): string | null {
  if (typeof layer.producer !== 'string' || !layer.producer.startsWith(CRITIC_PRODUCER_PREFIX) || layer.producer.length === CRITIC_PRODUCER_PREFIX.length) {
    return `A critic token may publish only layers whose producer is "${CRITIC_PRODUCER_PREFIX}<name>"; this layer's producer is ${JSON.stringify(layer.producer ?? null)}`;
  }
  const parts = Array.isArray(layer.parts) ? layer.parts as { kind?: unknown }[] : [];
  if (!parts.length) return `A critic token may publish only layers of parts of kind "${CRITIQUE_PART_KIND}"; this layer has no parts`;
  const other = parts.find(part => part?.kind !== CRITIQUE_PART_KIND);
  if (other) return `A critic token may publish only parts of kind "${CRITIQUE_PART_KIND}"; this layer has a part of kind ${JSON.stringify(other?.kind ?? null)}`;
  return null;
}
