/**
 * @module Evidence scope
 *
 * Reads what a producer declared a piece of evidence shows (`EvidenceScope`): which declaration applies to an
 * attachment, the short badges a reviewer sees before playing a recording, the facts split into declared and
 * independently verified, and the filter tokens (`device:physical`, `audio:recorded`) a query narrows by. Pure
 * functions, safe in a browser.
 *
 * The one rule: what is not declared is unknown. A missing scope, or a missing field, never reads as live, physical,
 * audible or end to end, and a filter for a value never matches evidence that did not say it. A scope describes
 * evidence; it never decides a status, a slot or a winner.
 *
 * @see docs/rich-evidence.md#evidence-scope
 */
import type { EvidenceScope } from '../../schema/src/layer';

/** The fields of a scope that say something about the evidence and that `verified` may name, in the order they are shown. */
export const SCOPE_DIMENSIONS = ['surface', 'deviceKind', 'syntheticData', 'dependencies', 'audioCaptured', 'pacing'] as const;
/** One of {@link SCOPE_DIMENSIONS}. */
export type ScopeDimension = (typeof SCOPE_DIMENSIONS)[number];

/** The filter token of a recording that declares no scope at all. */
export const UNKNOWN_SCOPE = 'unknown';

/**
 * The declaration that applies to something: the nearest one wins as a whole, never field by field, so a recording
 * never shows a limitation or a device that was declared for another source. Pass the candidates nearest first
 * (attachment, attempt, check, part, layer); absent ones are skipped. Undefined when none declares a scope.
 *
 * @example
 * ```ts
 * effectiveScope(attachment.scope, attempt.scope, check.scope, layer.scope);
 * ```
 */
export function effectiveScope(...candidates: readonly (EvidenceScope | undefined)[]): EvidenceScope | undefined {
  return candidates.find((candidate): candidate is EvidenceScope => candidate !== undefined);
}

const word = (value: string) => value.normalize('NFC').trim().toLowerCase().replace(/\s+/g, '-');

/** A stable string that is equal for equal declarations (key order never matters), to tell one scope from another. */
export function scopeKey(scope: EvidenceScope | undefined): string {
  if (!scope) return UNKNOWN_SCOPE;
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, sort(item)])) : value;
  return JSON.stringify(sort(scope));
}

/**
 * The filter tokens one declaration states, normalized (letter case and spaces never matter): `surface:<value>`,
 * `device:<value>`, `data:synthetic` or `data:real`, `dependencies:<value>`, `audio:recorded` or `audio:silent`,
 * `pacing:<value>`. A field that is not declared adds no token. No scope at all is the single token
 * {@link UNKNOWN_SCOPE}, so a filter can ask for the unknown on purpose; a scope that declares nothing readable is
 * also unknown.
 */
export function scopeTokens(scope: EvidenceScope | undefined): string[] {
  const tokens: string[] = [];
  if (scope?.surface) tokens.push(`surface:${word(scope.surface)}`);
  if (scope?.deviceKind) tokens.push(`device:${word(scope.deviceKind)}`);
  if (scope?.syntheticData !== undefined) tokens.push(scope.syntheticData ? 'data:synthetic' : 'data:real');
  if (scope?.dependencies) tokens.push(`dependencies:${word(scope.dependencies)}`);
  if (scope?.audioCaptured !== undefined) tokens.push(scope.audioCaptured ? 'audio:recorded' : 'audio:silent');
  if (scope?.pacing) tokens.push(`pacing:${word(scope.pacing)}`);
  return tokens.length ? tokens : [UNKNOWN_SCOPE];
}

/**
 * Whether one recording's tokens satisfy a filter: every wanted token must be among them. Tokens compare normalized.
 * An empty filter matches everything. The token {@link UNKNOWN_SCOPE} matches only a recording with no declared
 * fields, so asking for `device:physical` never includes a recording that did not say what it ran on.
 */
export function matchesScope(tokens: readonly string[], wanted: readonly string[]): boolean {
  const have = new Set(tokens.map(word));
  return wanted.every(token => have.has(word(token)));
}

/** How a fact is known: `verified` (independently checked), `declared` (the producer's word) or `undeclared` (unknown). */
export type ScopeBasis = 'verified' | 'declared' | 'undeclared';

/** One line of what a scope says: the dimension, a sentence for a person, and how well it is known. */
export type ScopeFact = {
  readonly dimension: ScopeDimension;
  /** A name for the dimension: `Device`, `Audio`. */
  readonly label: string;
  /** The value as words: `Physical device`, `Silent`, `Not declared`. */
  readonly value: string;
  readonly basis: ScopeBasis;
};

/** A short qualification to show beside a recording: `Device: Simulator`, `Scripted dependencies`, `Silent`. */
export type ScopeBadge = {
  readonly dimension: ScopeDimension | 'unknown';
  readonly text: string;
  readonly basis: ScopeBasis;
};

const title = (value: string) => { const text = value.replace(/[-_]+/g, ' ').trim(); return text.charAt(0).toUpperCase() + text.slice(1); };

const LABELS: Record<ScopeDimension, string> = { surface: 'Surface', deviceKind: 'Device', syntheticData: 'Data', dependencies: 'Dependencies', audioCaptured: 'Audio', pacing: 'Pacing' };

function valueOf(scope: EvidenceScope, dimension: ScopeDimension): string | undefined {
  switch (dimension) {
    case 'surface': return scope.surface ? title(scope.surface) : undefined;
    case 'deviceKind': return scope.deviceKind ? title(scope.deviceKind) : undefined;
    case 'syntheticData': return scope.syntheticData === undefined ? undefined : scope.syntheticData ? 'Synthetic' : 'Real';
    case 'dependencies': return scope.dependencies ? title(scope.dependencies) : undefined;
    case 'audioCaptured': return scope.audioCaptured === undefined ? undefined : scope.audioCaptured ? 'Recorded' : 'Silent';
    case 'pacing': return scope.pacing ? title(scope.pacing) : undefined;
  }
}

/**
 * Every dimension of a scope with its value and how it is known, in a fixed order, including the ones nobody declared
 * (`Not declared`, basis `undeclared`). A dimension is `verified` only when the scope's `verified` names it and it has
 * a value; everything else a producer wrote is `declared`. With no scope every dimension is undeclared.
 */
export function scopeFacts(scope: EvidenceScope | undefined): ScopeFact[] {
  const verified = new Set(scope?.verified ?? []);
  return SCOPE_DIMENSIONS.map(dimension => {
    const value = scope ? valueOf(scope, dimension) : undefined;
    return { dimension, label: LABELS[dimension], value: value ?? 'Not declared', basis: value === undefined ? 'undeclared' : verified.has(dimension) ? 'verified' : 'declared' };
  });
}

/**
 * The concise badges for a scope: one per declared dimension, in a fixed order (`Surface: Browser`, `Device: Simulator`, `Synthetic
 * data`, `Scripted dependencies`, `Silent`, `Paced`). With no declared dimension the one badge `Scope unknown`, so
 * a reviewer is told nothing was claimed rather than shown nothing.
 */
export function scopeBadges(scope: EvidenceScope | undefined): ScopeBadge[] {
  const badges: ScopeBadge[] = [];
  for (const fact of scopeFacts(scope)) {
    if (fact.basis === 'undeclared') continue;
    const text = fact.dimension === 'surface' || fact.dimension === 'deviceKind' ? `${fact.label}: ${fact.value}`
      : fact.dimension === 'syntheticData' ? `${fact.value} data`
      : fact.dimension === 'dependencies' ? `${fact.value} dependencies`
      : fact.dimension === 'audioCaptured' ? (fact.value === 'Silent' ? 'Silent' : 'Audio recorded')
      : fact.value;
    badges.push({ dimension: fact.dimension, text, basis: fact.basis });
  }
  return badges.length ? badges : [{ dimension: 'unknown', text: 'Scope unknown', basis: 'undeclared' }];
}

/**
 * What a reviewer must not read into evidence: a sentence per thing that is not shown. It names the assertions the
 * result stands on when there are some (so activity visible beyond them is not verified), and every kind of reality
 * that was not declared. Empty only for a scope that declares and verifies everything and lists no limitation.
 */
export function scopeCaveats(scope: EvidenceScope | undefined): string[] {
  const out: string[] = [];
  if (!scope || scopeTokens(scope)[0] === UNKNOWN_SCOPE) return ['Scope not declared: do not assume this ran live, on a physical device, with real audio or end to end.'];
  if (scope.asserted?.length) out.push(`Only these were asserted: ${scope.asserted.join('; ')}. Other activity visible in the recording is not verified.`);
  else out.push('No assertion boundary was declared: activity visible in the recording is not verified behavior.');
  if (scope.syntheticData === true) out.push('Uses synthetic data: not a statement about production data.');
  if (scope.dependencies === undefined) out.push('Whether dependencies were scripted or live is not declared.');
  else if (word(scope.dependencies) !== 'live') out.push(`Dependencies were ${word(scope.dependencies)}, not live.`);
  if (scope.audioCaptured === undefined) out.push('Whether audio was captured is not declared.');
  else if (!scope.audioCaptured) out.push('Silent: nothing audible was recorded.');
  if (scope.deviceKind === undefined) out.push('The kind of device is not declared.');
  for (const limit of scope.limitations ?? []) out.push(limit);
  return out;
}
