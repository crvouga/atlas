import { ALL_SOURCES, type SourceSelection } from '@crvouga/atlas/reports/evidence-view';
import type { Viewport } from '@xyflow/react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Which specs the index lists, by what has been recorded for them. */
export type ResultFilter = 'all' | 'results' | 'failed' | 'none';

type UiState = {
  viewports: Record<string, Viewport>;
  issuesOpen: boolean;
  sourcesOpen: boolean;
  resultFilter: ResultFilter;
  /** Backends, branches, versions, environments and layers left out of the combined report. */
  excluded: SourceSelection;
  saveViewport: (chartId: string, viewport: Viewport) => void;
  setIssuesOpen: (open: boolean) => void;
  setSourcesOpen: (open: boolean) => void;
  setResultFilter: (filter: ResultFilter) => void;
  setExcluded: (excluded: SourceSelection) => void;
};

/** UI state that outlives a data refresh: zoom and pan per chart, the chosen sources, and open panels. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      viewports: {},
      issuesOpen: false,
      sourcesOpen: false,
      resultFilter: 'all',
      excluded: ALL_SOURCES,
      saveViewport: (chartId, viewport) => set((s) => ({ viewports: { ...s.viewports, [chartId]: viewport } })),
      setIssuesOpen: (issuesOpen) => set({ issuesOpen }),
      setSourcesOpen: (sourcesOpen) => set({ sourcesOpen }),
      setResultFilter: (resultFilter) => set({ resultFilter }),
      setExcluded: (excluded) => set({ excluded })
    }),
    {
      name: 'atlas-ui',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ viewports: s.viewports, excluded: s.excluded, resultFilter: s.resultFilter }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<UiState>;
        return { ...current, ...saved, excluded: { ...ALL_SOURCES, ...saved.excluded } };
      }
    }
  )
);
