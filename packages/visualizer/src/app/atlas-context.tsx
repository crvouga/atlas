import { createContext, useContext, type ReactNode } from 'react';

import { useAtlasData, useLiveUpdates, type AtlasData } from '../data/queries';

const AtlasContext = createContext<AtlasData | null>(null);

export function AtlasProvider({ run, children }: { run: string | undefined; children: ReactNode }) {
  useLiveUpdates();
  const data = useAtlasData(run);
  return <AtlasContext.Provider value={data}>{children}</AtlasContext.Provider>;
}

export function useAtlas() {
  const data = useContext(AtlasContext);
  if (!data) throw new Error('useAtlas needs an AtlasProvider');
  return data;
}
