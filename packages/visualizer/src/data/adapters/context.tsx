import { createContext, useContext } from 'react';

import type { AtlasAdapter } from './adapter';

export const AdapterContext = createContext<AtlasAdapter | null>(null);

export function useAdapter() {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error('useAdapter needs an AdapterContext provider');
  return adapter;
}
