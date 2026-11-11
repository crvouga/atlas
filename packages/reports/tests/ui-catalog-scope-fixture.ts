import type { ObjectStore } from '../src/object-store';
import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { uiCatalog } from '../src/ui-catalog';
import { catalogPlanLayers, expandCatalog, resolveCatalog, type CatalogDefinition } from '../src/ui-catalog-definition';
import { uiStateLayer } from '../src/ui-catalog-publish';
import { memoryStore } from './memory-store';

/** Definition A: three states in four profiles. */
export const DEFINITION_A: CatalogDefinition = {
  name: 'web',
  matrix: { dimensions: { device: { values: ['mobile', 'desktop'] }, scheme: { values: ['light', 'dark'] } } },
  states: [{ id: 'cart' }, { id: 'home' }, { id: 'legacy' }]
};

/** Definition B: `legacy` removed, `search` added, and eight profiles none of which is one of A's. */
export const DEFINITION_B: CatalogDefinition = {
  name: 'web',
  matrix: { dimensions: { device: { values: ['phone', 'tablet'] }, scheme: { values: ['light', 'dark'] }, density: { values: ['1x', '2x'] } } },
  states: [{ id: 'cart' }, { id: 'home' }, { id: 'search' }]
};

/** A store holding A's plan and captures, then B's plan and some captures of B: what a matrix migration leaves behind. */
export async function migrated(store: ObjectStore = memoryStore()) {
  const a = await resolveCatalog(DEFINITION_A), b = await resolveCatalog(DEFINITION_B);
  const ea = expandCatalog(a.document, a.version), eb = expandCatalog(b.document, b.version);
  for (const plan of catalogPlanLayers(ea, 1_000)) await publishChecks(store, plan);
  for (const profile of ea.profiles) {
    await publishChecks(store, uiStateLayer({
      producer: 'capture', recordedAtMs: 2_000, ...(profile.environment ? { environment: profile.environment } : {}), profile: profile.parameters,
      states: [{ id: 'cart', title: 'Cart' }, { id: 'home', title: 'Home' }, { id: 'legacy', title: 'Legacy', status: 'failed', detail: 'old screen' }]
    }));
  }
  for (const plan of catalogPlanLayers(eb, 3_000)) await publishChecks(store, plan);
  // Of B, only two profiles are captured so far, and one state failed in one of them.
  for (const profile of eb.profiles.slice(0, 2)) {
    await publishChecks(store, uiStateLayer({
      producer: 'capture', recordedAtMs: 4_000, ...(profile.environment ? { environment: profile.environment } : {}), profile: profile.parameters,
      states: [{ id: 'cart', title: 'Cart' }, { id: 'home', title: 'Home', status: profile === eb.profiles[0] ? 'failed' : 'passed', detail: 'timeout' }, { id: 'search', title: 'Search' }]
    }));
  }
  const index = new ReportIndex([{ id: 'ci', store }]);
  await index.refresh();
  const snapshot = index.snapshot();
  return { store, a, b, ea, eb, whole: uiCatalog(snapshot.layers, { version: snapshot.version, backends: snapshot.backends, notices: snapshot.notices }) };
}
