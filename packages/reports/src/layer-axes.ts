import type { LayerParameters, LayerSummary } from './layer-types';

/**
 * Clients a product is checked on. Any other recorded name is kept, so a new
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

/** A stable environment id. Blank means the layer did not say, so older layers still compose. */
export function normalizeEnvironment(value: string | null | undefined): string | null {
  if (value == null) return null;
  const slug = value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug) return null;
  return ALIASES[slug] ?? slug;
}

/**
 * Environment is its own axis. A layer may name it on the field or as a
 * parameter; the parameter is then not also a free choice.
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

/** How an environment id reads in the report. */
export function environmentLabel(id: string | null | undefined): string {
  if (!id) return 'Unspecified';
  const known = LABELS[id];
  if (known) return known;
  const [first, ...rest] = id.split('-');
  return [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join(' ');
}
