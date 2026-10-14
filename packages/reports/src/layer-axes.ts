/**
 * @module Environment axis of a layer
 *
 * Owns how a layer's `environment` (the client that was checked: `ios`, `desktop-web`, ...) is normalised to a stable
 * slug, read from either the `environment` field or an `environment` parameter, and shown to people. The environment
 * is part of the slot a check fills, so two spellings of one client must normalise to one id or their results would
 * never replace each other; an unrecognised name is kept as its own slug rather than rejected.
 *
 * @see docs/report-contract.md
 */
import type { LayerParameters, LayerSummary } from './layer-types';

/**
 * The environments Atlas names and labels out of the box. Any other recorded name is kept, so a new
 * client layers beside these instead of being dropped or renamed away.
 */
export const REPORT_ENVIRONMENTS = ['desktop-web', 'mobile-web', 'ios', 'android'] as const;

const ALIASES: Readonly<Record<string, string>> = {
  desktop: 'desktop-web',
  'desktop-web': 'desktop-web',
  'desktop-browser': 'desktop-web',
  'web-desktop': 'desktop-web',
  'mobile-web': 'mobile-web',
  'mobile-browser': 'mobile-web',
  'web-mobile': 'mobile-web',
  ios: 'ios',
  iphone: 'ios',
  ipad: 'ios',
  android: 'android',
};

/**
 * Turns any spelling of a client name into a stable lowercase slug, or `null` when none was given.
 *
 * Trims, lowercases, turns whitespace and underscores into `-`, drops every other character outside `a-z0-9-`,
 * collapses repeated `-`, then maps known aliases (`iPhone` and `iPad` to `ios`, `mobile browser` to `mobile-web`,
 * `desktop` to `desktop-web`). A name with no alias is returned as its slug. `null`, `undefined` and a value that
 * slugs to nothing return `null`, which means "the layer did not say", so older layers still compose.
 *
 * @example
 * normalizeEnvironment('Desktop Web'); // 'desktop-web'
 * normalizeEnvironment('iPhone'); // 'ios'
 * normalizeEnvironment('Smart TV'); // 'smart-tv'
 * normalizeEnvironment('  '); // null
 */
export function normalizeEnvironment(value: string | null | undefined): string | null {
  if (value == null) return null;
  const slug = value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug) return null;
  return ALIASES[slug] ?? slug;
}

/**
 * Splits a layer into the two slot axes it fills: its normalised environment and its remaining parameters.
 *
 * The environment is the layer's `environment` field, or when that is `null` or absent the `environment` parameter
 * (an empty-string field does not fall back to the parameter). The `environment` parameter is always removed from
 * the returned `parameters`, so it is never both an environment and a free choice that splits the slot twice.
 */
export function layerPlace(summary: Pick<LayerSummary, 'environment' | 'parameters'>): { environment: string | null; parameters: LayerParameters } {
  const { environment: named, ...rest } = summary.parameters;
  return { environment: normalizeEnvironment(summary.environment ?? named), parameters: rest };
}

const LABELS: Readonly<Record<string, string>> = {
  'desktop-web': 'Desktop web',
  'mobile-web': 'Mobile web',
  ios: 'iOS',
  android: 'Android',
};

/**
 * The human label of an environment id: `Desktop web`, `Mobile web`, `iOS`, `Android` for the known ids,
 * `Unspecified` for a missing one, and otherwise the id with its first word capitalised and `-` shown as a space
 * (`smart-tv` reads `Smart tv`).
 */
export function environmentLabel(id: string | null | undefined): string {
  if (!id) return 'Unspecified';
  const known = LABELS[id];
  if (known) return known;
  const [first, ...rest] = id.split('-');
  return [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join(' ');
}
