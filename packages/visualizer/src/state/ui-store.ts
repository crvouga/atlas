import { ALL_SOURCES, type SourceSelection } from '@crvouga/atlas-reports/evidence-view';
import type { Viewport } from '@xyflow/react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_DETAILS, type ChartDetails } from '../layout/graph';

/** Which specs the index lists, by what has been recorded for them. */
export type ResultFilter = 'all' | 'results' | 'failed' | 'none';

type UiState = {
  viewports: Record<string, Viewport>;
  issuesOpen: boolean;
  details: Record<string, ChartDetails>;
  compact: boolean;
  minimap: boolean;
  pathOnly: boolean;
  sourcesOpen: boolean;
  resultFilter: ResultFilter;
  /** Backends, branches and layers left out of the combined report. */
  excluded: SourceSelection;
  setPathOnly: (pathOnly: boolean) => void;
  setDetails: (chartId: string, details: ChartDetails) => void;
  toggleDetail: (chartId: string, state: string, childMachine: boolean) => void;
  setCompact: (compact: boolean) => void;
  setMinimap: (minimap: boolean) => void;
  saveViewport: (chartId: string, viewport: Viewport) => void;
  setIssuesOpen: (open: boolean) => void;
  setSourcesOpen: (open: boolean) => void;
  setResultFilter: (filter: ResultFilter) => void;
  setExcluded: (excluded: SourceSelection) => void;
};

/** UI state that outlives a data refresh: zoom and pan per chart, chosen sources, and open panels. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      viewports: {},
      issuesOpen: false,
      details: {},
      compact: false,
      minimap: true,
      pathOnly: false,
      sourcesOpen: false,
      resultFilter: 'all',
      excluded: ALL_SOURCES,
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
      setIssuesOpen: (issuesOpen) => set({ issuesOpen }),
      setSourcesOpen: (sourcesOpen) => set({ sourcesOpen }),
      setResultFilter: (resultFilter) => set({ resultFilter }),
      setExcluded: (excluded) => set({ excluded })
    }),
    {
      name: 'atlas-ui',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        viewports: s.viewports,
        details: s.details,
        compact: s.compact,
        minimap: s.minimap,
        pathOnly: s.pathOnly,
        excluded: s.excluded,
        resultFilter: s.resultFilter
      })
    }
  )
);
