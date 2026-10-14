import { runtimeConfig, runtimeUrl } from '../../runtime';
import { createHttpAdapter, type AtlasAdapter, type AtlasChange } from './adapter';

export * from './adapter';

const DEV_PREFIX = '/__atlas/';
const CHANGE_EVENT = 'atlas:change';

export function createDevAdapter(base = DEV_PREFIX, label = 'Live from disk', sourceId = 'workspace'): AtlasAdapter {
  const adapter = createHttpAdapter(base, 'dev');
  return {
    ...adapter,
    label,
    subscribe: (onChange) => {
      const hot = import.meta.hot;
      if (!hot) return () => undefined;
      const handler = (change: AtlasChange) => {
        if (change.scope === 'specs' || (change.sourceId ?? 'workspace') === sourceId) onChange(change);
      };
      hot.on(CHANGE_EVENT, handler);
      return () => hot.off(CHANGE_EVENT, handler);
    }
  };
}

/** The server's own files, with its event stream: what a page served by `atlas serve` or `atlas dev` reads. */
export function createServerAdapter(dataUrl: string, eventsUrl: string | undefined): AtlasAdapter {
  return { ...createHttpAdapter(dataUrl, 'static', eventsUrl), label: 'Atlas server' };
}

/** The server's adapter when the page was served by one, the dev adapter under a bare `vite dev`, the static adapter everywhere else. */
export function createAdapter(): AtlasAdapter {
  const config = runtimeConfig();
  const dataUrl = runtimeUrl(config?.dataUrl);
  if (dataUrl) return createServerAdapter(dataUrl, runtimeUrl(config?.eventsUrl));
  if (import.meta.env.DEV && import.meta.hot) return createDevAdapter();
  return createHttpAdapter(import.meta.env.VITE_ATLAS_BASE_URL ?? './data/');
}
