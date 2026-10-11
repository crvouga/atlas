import type { AtlasView, JourneyView, StateView } from '../data/model';
import { ancestors, journeyPath, visibleRepresentative } from '../map/navigation';

export const SIZES = {
  screen: { width: 156, height: 372 },
  context: { width: 132, height: 132 },
  chartLink: { width: 280, height: 200 },
  chip: { height: 28, minWidth: 64, maxWidth: 240, perChar: 6.3, padding: 46 },
  groupPadding: { top: 48, left: 24, bottom: 24, right: 24 }
} as const;

export type LayoutNodeKind = 'screen' | 'group' | 'region' | 'parallel' | 'chart-link' | 'context' | 'collapsed';

export type LayoutNode = {
  id: string;
  parent: string | null;
  kind: LayoutNodeKind;
  width: number;
  height: number;
};

export type LayoutEdge = {
  id: string;
  transitionId: string;
  source: string;
  target: string;
  labelWidth: number;
};

export type LayoutInput = {
  chartId: string;
  key: string;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
};

export function chipWidth(text: string) {
  const { minWidth, maxWidth, perChar, padding } = SIZES.chip;
  return Math.round(Math.min(maxWidth, Math.max(minWidth, padding + text.length * perChar)));
}

function nodeKind(state: StateView): LayoutNodeKind {
  switch (state.kind) {
    case 'chart-link':
      return 'chart-link';
    case 'group':
      return 'group';
    case 'region':
      return 'region';
    case 'parallel':
      return 'parallel';
    default:
      return 'screen';
  }
}

export type ChartDetails = { expanded: string[]; collapsed: string[] };
export const DEFAULT_DETAILS: ChartDetails = { expanded: [], collapsed: [] };

/** Collapse before layout so hidden interiors consume no space. Boundary events retain their IDs. */
export function chartGraph(view: AtlasView, chartId: string, details: ChartDetails = DEFAULT_DETAILS): LayoutInput | null {
  const chart = view.charts.get(chartId);
  if (!chart) return null;
  const nodes: LayoutNode[] = [];
  const visible = new Set<string>();
  const includedCharts = new Set([chartId]);
  const represented = new Set<string>();
  const keys = new Set([chart.structureKey]);
  const collect = (name: string) => {
    if (represented.has(name)) return;
    represented.add(name);
    const state = view.states.get(name);
    if (!state) return;
    state.children.forEach(collect);
    if (state.childChartId) {
      const child = view.charts.get(state.childChartId);
      if (child) {
        keys.add(child.structureKey);
        includedCharts.add(child.id);
        child.rootStates.forEach(collect);
      }
    }
  };
  chart.rootStates.forEach(collect);
  const add = (state: StateView, parent: string | null) => {
    if (visible.has(state.name)) return;
    const child = state.childChartId ? view.charts.get(state.childChartId) : undefined;
    const expanded = Boolean(child && details.expanded.includes(state.name));
    const collapsed = !child && state.children.length > 0 && details.collapsed.includes(state.name);
    const kind: LayoutNodeKind = collapsed ? 'collapsed' : expanded ? 'group' : nodeKind(state);
    const size = kind === 'chart-link' || kind === 'collapsed' ? SIZES.chartLink : SIZES.screen;
    nodes.push({ id: state.name, parent, kind, width: size.width, height: size.height });
    visible.add(state.name);
    if (kind === 'chart-link' || collapsed) return;
    for (const name of expanded ? child!.rootStates : state.children) {
      const next = view.states.get(name);
      if (next) add(next, state.name);
    }
  };
  for (const name of chart.rootStates) {
    const state = view.states.get(name);
    if (state) add(state, null);
  }
  const representative = (name: string) => visibleRepresentative(view, name, visible);
  const contextNode = (name: string) => {
    if (visible.has(name) || !view.states.has(name)) return;
    nodes.push({ id: name, parent: null, kind: 'context', ...SIZES.context });
    visible.add(name);
  };
  const edges: LayoutEdge[] = [];
  const edge = (transitionId: string, source: string, target: string, event: string) => {
    edges.push({ id: transitionId, transitionId, source, target, labelWidth: chipWidth(event) });
  };
  for (const t of view.transitions.values()) {
    if (!includedCharts.has(t.chartId) || !t.target) continue;
    // Expanded children carry their own final-state hand-offs; suppress the parent's duplicate.
    if (t.carriedBy) {
      const carried = view.transitions.get(t.carriedBy);
      if (carried && representative(carried.source) !== representative(t.source)) continue;
    }
    const source = representative(t.source);
    if (!source) continue;
    let target = representative(t.target);
    if (!target && !represented.has(t.target)) {
      contextNode(t.target);
      target = t.target;
    }
    if (!target) continue;
    // Interior events disappear with their container; actual self loops remain.
    if (source === target && (source !== t.source || target !== t.target)) continue;
    // A collapsed child exposes only its boundary events, never all interior events.
    if (view.states.get(source)?.chartId !== t.chartId && !t.handOff) continue;
    if (
      source !== t.source &&
      edges.some((e) => {
        const boundary = view.transitions.get(e.transitionId);
        return e.source === source && e.target === target && boundary?.carriedBy && boundary.event === t.event;
      })
    )
      continue;
    edge(t.id, source, target, t.event);
  }
  if (chart.parent && chart.initial && visible.has(chart.initial)) {
    for (const t of view.transitions.values()) {
      if (t.target !== chart.parent.state || t.chartId === chartId) continue;
      contextNode(t.source);
      edge(t.id, t.source, chart.initial, t.event);
    }
  }
  return { chartId, key: JSON.stringify([...keys, nodes, edges]), nodes, edges };
}

/** Keep the journey's ancestors and boundary representatives so the filtered hierarchy is valid. */
export function isolateJourney(view: AtlasView, graph: LayoutInput, journey: JourneyView, selection: { screen?: string; event?: string } = {}): LayoutInput {
  const path = journeyPath(view, journey);
  const visible = new Set(graph.nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => path.transitions.has(edge.transitionId) || edge.transitionId === selection.event);
  const included = new Set([...path.states, ...edges.flatMap((edge) => [edge.source, edge.target])]);
  if (selection.screen) {
    const representative = visibleRepresentative(view, selection.screen, visible);
    if (representative) included.add(representative);
    ancestors(view, selection.screen).forEach((id) => included.add(id));
  }
  // Selected off-path events can be nested inside otherwise hidden regions.
  for (const name of [...included]) ancestors(view, name).forEach((id) => included.add(id));
  const nodes = graph.nodes.filter((node) => included.has(node.id));
  return { ...graph, nodes, edges, key: `${graph.key}:path:${journey.id}:${nodes.map((node) => node.id).join('|')}:${selection.event ?? ''}` };
}
