/**
 * @module UI catalog data
 *
 * The UI catalog of the report the viewer already holds. It is computed here, from the same layers the rest of the viewer
 * shows (`uiCatalog` from `@crvouga/atlas/reports/ui-catalog`), so it fills in as layers arrive over the server's event stream
 * and `?since=` deltas, and works unchanged when the viewer reads a store or a static export without a server.
 */
import { uiCatalog, type UiCatalog } from '@crvouga/atlas/reports/ui-catalog';
import { createContext, useContext, useDeferredValue, useMemo, type ReactNode } from 'react';

import { useEvidence } from '../evidence/evidence-context';

const CatalogContext = createContext<UiCatalog | null>(null);

/** Computes the catalog for its children, only while `enabled` (the catalog page is open): other pages pay nothing. */
export function UiCatalogProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const held = useEvidence();
  const { backends, notices, version } = held;
  // While layers stream in, the catalog is rebuilt for the newest layers only when the page has nothing more urgent to do, so typing a
  // filter or scrolling is never held up by a layer that has just arrived.
  const evidence = useDeferredValue(held.evidence);
  const catalog = useMemo(() => (enabled ? uiCatalog(evidence, { backends, notices, ...(version ? { version } : {}) }) : null), [enabled, evidence, backends, notices, version]);
  return <CatalogContext.Provider value={catalog}>{children}</CatalogContext.Provider>;
}

/** The whole catalog (before the address's filters), or null when the catalog page is not open. */
export function useUiCatalog(): UiCatalog | null {
  return useContext(CatalogContext);
}
