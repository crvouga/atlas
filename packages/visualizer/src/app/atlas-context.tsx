import { createContext, useContext, useState, type ReactNode } from 'react';

import { useAtlasData, useLiveUpdates, type AtlasData } from '../data/queries';

type AtlasSession = AtlasData & { live: boolean; setLive: (enabled: boolean) => void };
const AtlasContext = createContext<AtlasSession | null>(null);

export function AtlasProvider({ run, children }: { run: string | undefined; children: ReactNode }) {
  const [live, setLiveState] = useState(true);
  useLiveUpdates(live);
  const data = useAtlasData(run, live);
  const setLive = (enabled: boolean) => {
    setLiveState(enabled);
    if (enabled) data.refresh();
  };
  return <AtlasContext.Provider value={{ ...data, live, setLive }}>{children}</AtlasContext.Provider>;
}

export function useAtlas() {
  const data = useContext(AtlasContext);
  if (!data) throw new Error('useAtlas needs an AtlasProvider');
  return data;
}
