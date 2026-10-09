import type { Viewport } from '@xyflow/react';
import { create } from 'zustand';
import { DEFAULT_DETAILS, type ChartDetails } from '../layout/graph';
import { createJSONStorage, persist } from 'zustand/middleware';

type UiState = {
  viewports: Record<string, Viewport>;
  issuesOpen: boolean;
  details: Record<string, ChartDetails>;
  compact: boolean;
  minimap: boolean;
  pathOnly: boolean;
  setPathOnly: (pathOnly: boolean) => void;
  setDetails: (chartId: string, details: ChartDetails) => void;
  toggleDetail: (chartId: string, state: string, childMachine: boolean) => void;
  setCompact: (compact: boolean) => void;
  setMinimap: (minimap: boolean) => void;
  saveViewport: (chartId: string, viewport: Viewport) => void;
  setIssuesOpen: (open: boolean) => void;
};

/** UI state that outlives a data refresh: zoom and pan per chart, and open panels. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      viewports: {},
      issuesOpen: false,
      details: {},
      compact: false,
      minimap: true,
      pathOnly: false,
      setPathOnly: (pathOnly) => set({ pathOnly }),
      setDetails: (chartId, details) => set((s) => ({ details: { ...s.details, [chartId]: details } })),
      toggleDetail: (chartId, state, childMachine) =>
        set((s) => {
          const details = s.details[chartId] ?? DEFAULT_DETAILS;
          const key = childMachine ? 'expanded' : 'collapsed';
          const names = details[key];
          return {
            details: { ...s.details, [chartId]: { ...details, [key]: names.includes(state) ? names.filter((name) => name !== state) : [...names, state] } }
          };
        }),
      setCompact: (compact) => set({ compact }),
      setMinimap: (minimap) => set({ minimap }),
      saveViewport: (chartId, viewport) => set((s) => ({ viewports: { ...s.viewports, [chartId]: viewport } })),
      setIssuesOpen: (issuesOpen) => set({ issuesOpen })
    }),
    {
      name: 'atlas-ui',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ viewports: s.viewports, details: s.details, compact: s.compact, minimap: s.minimap, pathOnly: s.pathOnly })
    }
  )
);
