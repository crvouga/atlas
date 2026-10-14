/**
 * The address book an Atlas server writes into the page it serves (`window.__ATLAS_CONFIG__`), so one build
 * of the viewer works for every project and on every host. Under `atlas dev` the Vite dev server writes the
 * same thing, so the viewer cannot tell the two apart: both are one host, with `/api` behind it.
 */
export type RuntimeConfig = {
  readonly api?: string;
  readonly reportsUrl?: string;
  readonly dataUrl?: string;
  readonly eventsUrl?: string;
  readonly effective?: boolean;
};

export const runtimeConfig = (): RuntimeConfig | undefined => (globalThis as { __ATLAS_CONFIG__?: RuntimeConfig }).__ATLAS_CONFIG__;

/** An address from the config, resolved against the page, as an absolute URL. */
export function runtimeUrl(value: string | undefined): string | undefined {
  return value ? new URL(value, window.location.href).href : undefined;
}
