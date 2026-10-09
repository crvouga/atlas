import type { AtlasView, StateView } from '../data/model';

export const SIZES = {
  screen: { width: 156, height: 372 },
  context: { width: 132, height: 132 },
  chartLink: { width: 280, height: 200 },
  chip: { height: 28, minWidth: 64, maxWidth: 240, perChar: 6.3, padding: 46 },
  groupPadding: { top: 48, left: 24, bottom: 24, right: 24 }
} as const;

export type LayoutNodeKind = 'screen' | 'group' | 'region' | 'parallel' | 'chart-link' | 'context';

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

/**
 * What one chart's map shows, structure only: its states (child charts collapsed to one box),
 * the screens of other charts it hands off to as small context nodes, and the events between
 * them. Results never enter, so new screenshots never move anything.
 */
export function chartGraph(view: AtlasView, chartId: string): LayoutInput | null {
  const chart = view.charts.get(chartId);
  if (!chart) return null;
  const nodes: LayoutNode[] = [];
  const visible = new Set<string>();
  const add = (state: StateView, parent: string | null) => {
    const kind = nodeKind(state);
    const size = kind === 'chart-link' ? SIZES.chartLink : SIZES.screen;
    nodes.push({ id: state.name, parent, kind, width: size.width, height: size.height });
    visible.add(state.name);
    if (kind === 'chart-link') return;
    for (const child of state.children) {
      const c = view.states.get(child);
      if (c) add(c, state.name);
    }
  };
  for (const name of chart.rootStates) {
    const s = view.states.get(name);
    if (s) add(s, null);
  }

  const contextNode = (name: string) => {
    if (visible.has(name) || !view.states.has(name)) return;
    nodes.push({ id: name, parent: null, kind: 'context', width: SIZES.context.width, height: SIZES.context.height });
    visible.add(name);
  };

  const edges: LayoutEdge[] = [];
  const edge = (transitionId: string, source: string, target: string, event: string) => {
    edges.push({ id: `${transitionId}`, transitionId, source, target, labelWidth: chipWidth(event) });
  };

  for (const tid of chart.transitions) {
    const t = view.transitions.get(tid);
    if (!t?.target) continue;
    if (!visible.has(t.source)) continue;
    if (!visible.has(t.target)) contextNode(t.target);
    if (visible.has(t.target)) edge(t.id, t.source, t.target, t.event);
  }

  if (chart.parent && chart.initial && visible.has(chart.initial)) {
    for (const t of view.transitions.values()) {
      if (t.target !== chart.parent.state || t.chartId === chartId) continue;
      contextNode(t.source);
      edge(t.id, t.source, chart.initial, t.event);
    }
  }

  return { chartId, key: chart.structureKey, nodes, edges };
}
