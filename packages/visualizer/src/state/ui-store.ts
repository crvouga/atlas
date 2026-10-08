import type { Viewport } from '@xyflow/react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type UiState = {
  viewports: Record<string, Viewport>;
  issuesOpen: boolean;
  saveViewport: (chartId: string, viewport: Viewport) => void;
  setIssuesOpen: (open: boolean) => void;
};

/** UI state that outlives a data refresh: zoom and pan per chart, and open panels. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      viewports: {},
      issuesOpen: false,
      saveViewport: (chartId, viewport) => set((s) => ({ viewports: { ...s.viewports, [chartId]: viewport } })),
      setIssuesOpen: (issuesOpen) => set({ issuesOpen })
    }),
    {
      name: 'atlas-ui',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ viewports: s.viewports })
    }
  )
);
