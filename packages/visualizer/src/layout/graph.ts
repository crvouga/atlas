import { worstOf, type AtlasView, type ChartView, type ItemStatus, type StateView, type TransitionView } from '../data/model';

export const SIZES = {
  screen: { width: 156, height: 372 },
  context: { width: 132, height: 132 },
  chartLink: { width: 280, height: 200 },
  summary: { width: 220, height: 96 },
  chip: { height: 28, minWidth: 64, maxWidth: 240, perChar: 6.3, padding: 46 },
  groupPadding: { top: 48, left: 24, bottom: 24, right: 24 }
} as const;

/** A section with more places than this is drawn as one layer of boxes, not every nested screen. */
export const MAP_PLACE_CAP = 24;

export type LayoutNodeKind = 'screen' | 'group' | 'region' | 'parallel' | 'chart-link' | 'context' | 'summary';

export type LayoutNode = {
  id: string;
  parent: string | null;
  kind: LayoutNodeKind;
  width: number;
  height: number;
  /** Atomic screens inside a collapsed box. */
  places?: number;
  /** Rolled-up status of those screens. A failure anywhere shows on the box. */
  status?: ItemStatus;
};

export type LayoutBundle = {
  label: string;
  status: ItemStatus;
  count: number;
  group: string | null;
  screen: string | null;
};

export type LayoutEdge = {
  id: string;
  transitionId: string | null;
  source: string;
  target: string;
  labelWidth: number;
  bundle: LayoutBundle | null;
  /** Transitions folded into a bundle, so a journey can still dim the chip. */
  memberIds?: string[];
};

export type LayoutInput = {
  chartId: string;
  key: string;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  /** A committed layout file describes the whole chart, so a scoped map ignores it. */
  scoped: boolean;
  focus: string | null;
  mode: 'full' | 'subtree' | 'level';
};

export type MapFrame = {
  mode: 'full' | 'subtree' | 'level';
  focus: string | null;
  scoped: boolean;
  /** Parent of the focused section. The wider map draws that parent. */
  wider: string | null;
};

export function chipWidth(text: string) {
  const { minWidth, maxWidth, perChar, padding } = SIZES.chip;
  return Math.round(Math.min(maxWidth, Math.max(minWidth, padding + text.length * perChar)));
}

function isPlace(state: StateView) {
  return state.kind === 'screen' || state.kind === 'final' || state.kind === 'chart-link';
}

function placeCount(view: AtlasView, name: string, memo: Map<string, number>): number {
  const hit = memo.get(name);
  if (hit !== undefined) return hit;
  const state = view.states.get(name);
  if (!state || state.kind === 'chart-link') {
    memo.set(name, 0);
    return 0;
  }
  if (state.kind === 'screen' || state.kind === 'final') {
    memo.set(name, 1);
    return 1;
  }
  let count = 0;
  for (const child of state.children) count += placeCount(view, child, memo);
  memo.set(name, count);
  return count;
}

function chartPlaces(view: AtlasView, chart: ChartView, memo: Map<string, number>) {
  return chart.rootStates.reduce((count, name) => count + placeCount(view, name, memo), 0);
}

function autoFocus(view: AtlasView, chart: ChartView, memo: Map<string, number>) {
  if (chart.rootStates.length !== 1) return null;
  const name = chart.rootStates[0]!;
  const state = view.states.get(name);
  if (!state || isPlace(state) || placeCount(view, name, memo) <= MAP_PLACE_CAP) return null;
  return name;
}

/** Which section the map draws. A small chart is always the whole chart. */
export function mapFrame(view: AtlasView, chartId: string, requested: string | null): MapFrame {
  const chart = view.charts.get(chartId);
  const whole: MapFrame = { mode: 'full', focus: null, scoped: false, wider: null };
  if (!chart) return whole;
  const memo = new Map<string, number>();
  if (chartPlaces(view, chart, memo) <= MAP_PLACE_CAP) return whole;
  const auto = autoFocus(view, chart, memo);
  let focus = requested;
  const requestedState = focus ? view.states.get(focus) : undefined;
  if (!requestedState || requestedState.chartId !== chartId) focus = auto;
  else if (isPlace(requestedState)) {
    const parent = requestedState.parent ? view.states.get(requestedState.parent) : undefined;
    focus = parent && parent.chartId === chartId ? parent.name : auto;
  }
  if (!focus) return { mode: 'level', focus: null, scoped: true, wider: null };
  const state = view.states.get(focus);
  if (!state) return { mode: 'level', focus: null, scoped: true, wider: null };
  const wider = state.parent && view.states.get(state.parent)?.chartId === chartId ? state.parent : null;
  if (placeCount(view, focus, memo) <= MAP_PLACE_CAP) return { mode: 'subtree', focus, scoped: true, wider };
  return { mode: 'level', focus, scoped: true, wider };
}

/**
 * The section a place belongs on. Null when the whole chart is small enough to draw.
 * A place inside a small section opens that section. A place inside a large section
 * opens the section, one layer at a time.
 */
export function mapScope(view: AtlasView, chartId: string, stateName: string): string | null {
  const chart = view.charts.get(chartId);
  const state = view.states.get(stateName);
  if (!chart || !state || state.chartId !== chartId) return null;
  const memo = new Map<string, number>();
  if (chartPlaces(view, chart, memo) <= MAP_PLACE_CAP) return null;
  if (!isPlace(state)) return state.name;
  let node = state;
  while (node.parent) {
    const parent = view.states.get(node.parent);
    if (!parent || parent.chartId !== chartId) break;
    if (placeCount(view, parent.name, memo) > MAP_PLACE_CAP) break;
    node = parent;
  }
  if (node !== state) return node.name;
  return state.parent;
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

function rollup(view: AtlasView, name: string): ItemStatus {
  const statuses: ItemStatus[] = [];
  const walk = (id: string) => {
    const state = view.states.get(id);
    if (!state) return;
    if (state.kind === 'screen' || state.kind === 'final') statuses.push(state.status);
    else for (const child of state.children) walk(child);
  };
  walk(name);
  return worstOf(statuses, view.states.get(name)?.status ?? 'spec-only');
}

function expandGraph(view: AtlasView, chart: ChartView, focus: string | null, key: string, scoped: boolean, mode: 'full' | 'subtree'): LayoutInput {
  const nodes: LayoutNode[] = [];
  const visible = new Set<string>();
  const add = (state: StateView, parent: string | null) => {
    const kind = nodeKind(state);
    const size = kind === 'chart-link' ? SIZES.chartLink : SIZES.screen;
    nodes.push({ id: state.name, parent, kind, width: size.width, height: size.height });
    visible.add(state.name);
    if (kind === 'chart-link') return;
    for (const child of state.children) {
      const next = view.states.get(child);
      if (next) add(next, state.name);
    }
  };
  const roots = focus ? [focus] : chart.rootStates;
  for (const name of roots) {
    const state = view.states.get(name);
    if (state) add(state, null);
  }

  const contextNode = (name: string) => {
    if (visible.has(name) || !view.states.has(name)) return;
    nodes.push({ id: name, parent: null, kind: 'context', width: SIZES.context.width, height: SIZES.context.height });
    visible.add(name);
  };
  const edges: LayoutEdge[] = [];
  const edge = (transitionId: string, source: string, target: string, event: string) => {
    edges.push({ id: transitionId, transitionId, source, target, labelWidth: chipWidth(event), bundle: null });
  };
  for (const tid of chart.transitions) {
    const transition = view.transitions.get(tid);
    if (!transition?.target || !visible.has(transition.source)) continue;
    if (!visible.has(transition.target)) contextNode(transition.target);
    if (visible.has(transition.target)) edge(transition.id, transition.source, transition.target, transition.event);
  }
  if (chart.parent && chart.initial && visible.has(chart.initial)) {
    for (const transition of view.transitions.values()) {
      if (transition.target !== chart.parent.state || transition.chartId === chart.id) continue;
      contextNode(transition.source);
      edge(transition.id, transition.source, chart.initial, transition.event);
    }
  }
  return { chartId: chart.id, key, nodes, edges, scoped, focus, mode };
}

function lift(view: AtlasView, name: string, visible: Set<string>, focus: string | null) {
  let current: string | null = name;
  while (current) {
    if (visible.has(current)) return current;
    if (focus && current === focus) return null;
    current = view.states.get(current)?.parent ?? null;
  }
  return null;
}

function levelKind(state: StateView): LayoutNodeKind {
  if (state.kind === 'chart-link') return 'chart-link';
  if (state.kind === 'screen' || state.kind === 'final') return 'screen';
  return 'summary';
}

function levelSize(kind: LayoutNodeKind) {
  if (kind === 'chart-link') return SIZES.chartLink;
  if (kind === 'summary') return SIZES.summary;
  return SIZES.screen;
}

/** One layer: direct children are boxes, and events between the same pair share one chip. */
function levelGraph(view: AtlasView, chart: ChartView, focus: string | null, key: string): LayoutInput {
  const memo = new Map<string, number>();
  const childNames = focus ? (view.states.get(focus)?.children ?? []) : chart.rootStates;
  const nodes: LayoutNode[] = [];
  const visible = new Set<string>();
  for (const name of childNames) {
    const state = view.states.get(name);
    if (!state) continue;
    const kind = levelKind(state);
    const size = levelSize(kind);
    nodes.push({
      id: name,
      parent: null,
      kind,
      width: size.width,
      height: size.height,
      ...(kind === 'summary' ? { places: placeCount(view, name, memo), status: rollup(view, name) } : {})
    });
    visible.add(name);
  }

  const groups = new Map<string, { source: string; target: string; transitions: TransitionView[] }>();
  for (const tid of chart.transitions) {
    const transition = view.transitions.get(tid);
    if (!transition?.target || transition.carriedBy) continue;
    const source = lift(view, transition.source, visible, focus);
    const target = lift(view, transition.target, visible, focus);
    if (!source || !target || source === target) continue;
    const id = `${source}>${target}`;
    const bucket = groups.get(id) ?? { source, target, transitions: [] };
    bucket.transitions.push(transition);
    groups.set(id, bucket);
  }

  const edges: LayoutEdge[] = [];
  for (const bucket of groups.values()) {
    const only = bucket.transitions[0];
    if (bucket.transitions.length === 1 && only) {
      edges.push({ id: only.id, transitionId: only.id, source: bucket.source, target: bucket.target, labelWidth: chipWidth(only.event), bundle: null });
      continue;
    }
    const label = `${bucket.transitions.length} events`;
    const targetState = view.states.get(bucket.target);
    const opensGroup = Boolean(targetState && !isPlace(targetState));
    edges.push({
      id: `bundle:${bucket.source}>${bucket.target}`,
      transitionId: null,
      source: bucket.source,
      target: bucket.target,
      labelWidth: chipWidth(label),
      memberIds: bucket.transitions.map((transition) => transition.id),
      bundle: {
        label,
        status: worstOf(
          bucket.transitions.map((transition) => transition.status),
          'spec-only'
        ),
        count: bucket.transitions.length,
        group: opensGroup ? bucket.target : null,
        screen: opensGroup ? null : bucket.target
      }
    });
  }
  return { chartId: chart.id, key, nodes, edges, scoped: true, focus, mode: 'level' };
}

/**
 * What one chart's map shows. A small chart expands every screen. A large chart shows one
 * section at a time: its direct children as boxes, or the whole section when that section is small.
 */
export function chartGraph(view: AtlasView, chartId: string, requested: string | null = null): LayoutInput | null {
  const chart = view.charts.get(chartId);
  if (!chart) return null;
  const frame = mapFrame(view, chartId, requested);
  const key = `${chart.structureKey}\n${frame.mode}\n${frame.focus ?? ''}`;
  if (frame.mode === 'level') return levelGraph(view, chart, frame.focus, key);
  return expandGraph(view, chart, frame.mode === 'subtree' ? frame.focus : null, key, frame.scoped, frame.mode);
}
