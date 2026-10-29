/**
 * @module Critiques in report rows
 *
 * A check of a part of kind `critique` carries an automated reviewer's opinion in `extensions["atlas.critique"]`
 * (see `@crvouga/atlas/critics`). This module reads that extension into the optional `critique` field of a report row,
 * so a viewer can list critiques without a second request, exactly as `state` carries a UI state. It decides nothing:
 * the row's `status` says only whether the critic ran, a critique is never counted, and an extension this reader cannot
 * read (a missing subject, a score that is not a number, a version it does not know) leaves the row as it was, an
 * unknown opinion and never a pass.
 *
 * @see docs/critics.md
 */
import { CRITIQUE_EXTENSION, CRITIQUE_PART_KIND, CRITIQUE_SCHEMA_VERSION, CritiqueSchema, type Critique } from '../../schema/src/critique';
import type { Check } from '../../schema/src/layer';

/**
 * The critique a check of a part of `kind` carries, or `undefined` for any other kind and for an extension that cannot be
 * read. Unknown fields and values inside a readable critique are kept.
 */
export function critiqueOf(kind: string, check: Pick<Check, 'extensions'>): Critique | undefined {
  if (kind !== CRITIQUE_PART_KIND) return undefined;
  const raw = check.extensions?.[CRITIQUE_EXTENSION];
  if (raw === undefined) return undefined;
  const parsed = CritiqueSchema.safeParse(raw);
  return parsed.success && parsed.data.schema === CRITIQUE_SCHEMA_VERSION ? parsed.data : undefined;
}
