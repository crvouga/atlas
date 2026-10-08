import { createHttpAdapter, type AtlasAdapter, type AtlasChange } from './adapter';

export * from './adapter';

const DEV_PREFIX = '/__atlas/';
const CHANGE_EVENT = 'atlas:change';

function createDevAdapter(): AtlasAdapter {
  const adapter = createHttpAdapter(DEV_PREFIX, 'dev');
  return {
    ...adapter,
    label: 'Live from disk',
    subscribe: (onChange) => {
      const hot = import.meta.hot;
      if (!hot) return () => undefined;
      const handler = (change: AtlasChange) => onChange(change);
      hot.on(CHANGE_EVENT, handler);
      return () => hot.off(CHANGE_EVENT, handler);
    }
  };
}

/** The dev adapter under `vite dev`, the static adapter everywhere else. */
export function createAdapter(): AtlasAdapter {
  if (import.meta.env.DEV && import.meta.hot) return createDevAdapter();
  return createHttpAdapter(import.meta.env.VITE_ATLAS_BASE_URL ?? './data/');
}
