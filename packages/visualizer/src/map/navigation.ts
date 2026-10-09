import type { AtlasView, JourneyView } from '../data/model';

/** The composition parent also crosses invoked-machine boundaries. */
export function parentState(view: AtlasView, name: string): string | null {
  const state = view.states.get(name);
  if (!state) return null;
  return state.parent ?? view.charts.get(state.chartId)?.parent?.state ?? null;
}

export function ancestors(view: AtlasView, name: string): string[] {
  const result: string[] = [];
  const seen = new Set([name]);
  for (let parent = parentState(view, name); parent && !seen.has(parent); parent = parentState(view, parent)) {
    result.push(parent);
    seen.add(parent);
  }
  return result;
}

export function visibleRepresentative(view: AtlasView, name: string, visible: Set<string>): string | null {
  return [name, ...ancestors(view, name)].find((id) => visible.has(id)) ?? null;
}

export function journeyPath(view: AtlasView, journey: JourneyView | undefined) {
  const states = new Set<string>();
  const transitions = new Map<string, number[]>();
  journey?.steps.forEach((step, index) => {
    for (const name of [...step.from, ...step.to]) {
      states.add(name);
      for (const parent of ancestors(view, name)) states.add(parent);
    }
    for (const id of step.transitionIds) transitions.set(id, [...(transitions.get(id) ?? []), index]);
  });
  for (const t of view.transitions.values()) {
    if (t.carriedBy && transitions.has(t.carriedBy)) transitions.set(t.id, transitions.get(t.carriedBy)!);
  }
  return { states, transitions };
}

/** Focus the deepest active states, including every branch of a parallel state. */
export function stepFocus(view: AtlasView, journey: JourneyView | undefined, index: number | undefined) {
  const step = index === undefined ? undefined : journey?.steps[index];
  const names = step?.to.length ? step.to : (step?.from ?? []);
  return names.filter((name) => !names.some((other) => other !== name && ancestors(view, other).includes(name)));
}

export function chartScope(view: AtlasView, chartId: string): Set<string> {
  const scope = new Set<string>();
  const visit = (id: string) => {
    if (scope.has(id)) return;
    scope.add(id);
    view.charts.get(id)?.childChartIds.forEach(visit);
  };
  visit(chartId);
  return scope;
}

/** Keep a journey in its composed root when a step leaves a drilled-in child chart. */
export function journeyChart(view: AtlasView, chartId: string, journey: JourneyView, index: number | undefined): string {
  const scope = chartScope(view, chartId);
  const targets = index === undefined ? journey.steps.flatMap((_, step) => stepFocus(view, journey, step)) : stepFocus(view, journey, index);
  if (targets.every((name) => scope.has(view.states.get(name)?.chartId ?? ''))) return chartId;
  let root = view.charts.get(chartId);
  const visited = new Set<string>();
  while (root?.parent && !visited.has(root.id)) {
    visited.add(root.id);
    root = view.charts.get(root.parent.chartId);
  }
  return root?.id ?? chartId;
}

/** Start at a readable leaf rather than fitting an entire initial compound region. */
export function initialState(view: AtlasView, chartId: string): string | null {
  let name = view.charts.get(chartId)?.initial ?? null;
  const seen = new Set<string>();
  while (name && !seen.has(name)) {
    seen.add(name);
    const state = view.states.get(name);
    const next = state?.childChartId ? view.charts.get(state.childChartId)?.initial : state?.initial;
    if (!next) return name;
    name = next;
  }
  return name;
}
