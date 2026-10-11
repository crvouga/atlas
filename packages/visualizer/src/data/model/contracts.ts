import type { BusinessContract } from '@crvouga/atlas-schema';
import type { AtlasView } from './types';

/** A capability's rules are inherited as a catalog, never claimed as per-screen assertions. */
export function contractsForState(view: AtlasView, name: string): { contracts: BusinessContract[]; owner: string } {
  const seen = new Set<string>();
  for (let current: string | null = name; current && !seen.has(current);) {
    seen.add(current);
    const state = view.states.get(current);
    if (!state) break;
    if (state.contracts.length) return { contracts: state.contracts, owner: state.name };
    const chart = view.charts.get(state.chartId);
    if (!state.parent && chart?.contracts.length) return { contracts: chart.contracts, owner: chart.name };
    current = state.parent ?? chart?.parent?.state ?? null;
  }
  return { contracts: [], owner: name };
}

export function contractCatalog(view: AtlasView, rootId: string) {
  const scope = new Set<string>();
  const visit = (id: string) => {
    if (scope.has(id)) return;
    scope.add(id);
    view.charts.get(id)?.childChartIds.forEach(visit);
  };
  visit(rootId);
  const catalog = new Map<string, { contract: BusinessContract; state: string | null }>();
  for (const chart of view.charts.values()) if (scope.has(chart.id))
    for (const contract of chart.contracts) catalog.set(contract.id, { contract, state: chart.initial });
  // Prefer the most specific owning capability over the whole-product catalog.
  const states = [...view.states.values()].filter((s) => scope.has(s.chartId)).sort((a, b) => a.depth - b.depth);
  for (const state of states) for (const contract of state.contracts) catalog.set(contract.id, { contract, state: state.name });
  return [...catalog.values()];
}

export function contractText(contract: BusinessContract) {
  return `${contract.name} ${contract.description ?? ''} ${contract.steps.map((s) => `${s.keyword} ${s.text} ${s.docString ?? ''} ${s.table?.flat().join(' ') ?? ''}`).join(' ')}`;
}
