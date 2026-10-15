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
  readonly projectsUrl?: string;
};

/** The project selected in the page address. A full navigation on change isolates caches and connections. */
export const currentProject = () => typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('project');

export const runtimeConfig = (): RuntimeConfig | undefined => {
  const config = (globalThis as { __ATLAS_CONFIG__?: RuntimeConfig }).__ATLAS_CONFIG__;
  const project = currentProject();
  if (!config?.api || !project || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(project) || project.length > 64) return config;
  const api = new URL(config.api, window.location.href).href.replace(/\/$/, '');
  const scoped = `${api}/projects/${project}`;
  const scope = (address: string | undefined) => {
    if (!address) return address;
    const absolute = new URL(address, window.location.href).href;
    return absolute === api || absolute.startsWith(`${api}/`) ? scoped + absolute.slice(api.length) : absolute;
  };
  return { ...config, api: scoped, reportsUrl: scope(config.reportsUrl), dataUrl: scope(config.dataUrl), eventsUrl: scope(config.eventsUrl) };
};

/** An address from the config, resolved against the page, as an absolute URL. */
export function runtimeUrl(value: string | undefined): string | undefined {
  return value ? new URL(value, window.location.href).href : undefined;
}
