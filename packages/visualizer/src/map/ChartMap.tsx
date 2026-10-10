import { MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Node, type ReactFlowInstance, type Viewport } from '@xyflow/react';
import { useCallback, useMemo, useRef } from 'react';

import type { AtlasView, ItemStatus } from '../data/model';
import { FitIcon, MinusIcon, PlusIcon } from '../components/icons';
import { Legend } from '../components/Legend';
import { chartGraph } from '../layout/graph';
import type { ChartLayout } from '../layout/layout';
import { useChartLayout } from '../layout/use-chart-layout';
import { useUiStore } from '../state/ui-store';
import { EdgeMarkers, edgeTypes, type EventEdgeType } from './EventEdge';
import styles from './map.module.css';
import { nodeTypes, type ChartLinkNodeType, type ContextNodeType, type GroupNodeType, type ScreenNodeType, type SummaryNodeType } from './nodes';

type MapNode = ScreenNodeType | GroupNodeType | ChartLinkNodeType | ContextNodeType | SummaryNodeType;

export type MapSelection = { screen?: string; event?: string; journey?: string };

const MINIMAP_COLOR: Record<ItemStatus, string> = {
  passed: '#86efac',
  flaky: '#fdba74',
  failed: '#fca5a5',
  'not-reached': '#e2e8f0',
  'not-yet-run': '#e2e8f0',
  'spec-only': '#ddd6fe'
};

const START_ZOOM = 0.7;

function fitPadding() {
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
  if (narrow) return { top: '180px', right: '64px', bottom: '16px', left: '16px' } as const;
  return { top: '16px', right: '72px', bottom: '120px', left: '16px' } as const;
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useFlowElements(view: AtlasView, chartId: string, layout: ChartLayout | undefined, selection: MapSelection) {
  return useMemo(() => {
    if (!layout) return { nodes: [] as MapNode[], edges: [] as EventEdgeType[] };
    const journey = selection.journey ? view.journeys.find((j) => j.id === selection.journey) : undefined;
    const steps = new Map<string, number>();
    journey?.steps.forEach((step, i) => {
      for (const tid of step.transitionIds) {
        if (!steps.has(tid)) steps.set(tid, i + 1);
        const carried = [...view.transitions.values()].find((t) => t.carriedBy === tid);
        if (carried && !steps.has(carried.id)) steps.set(carried.id, i + 1);
      }
    });
    const onJourney = new Set<string>();
    for (const tid of steps.keys()) {
      const t = view.transitions.get(tid);
      if (t) {
        onJourney.add(t.source);
        if (t.target) onJourney.add(t.target);
      }
    }
    const dim = (id: string) => Boolean(journey) && !onJourney.has(id);
    const coversJourney = (id: string): boolean => {
      if (onJourney.has(id)) return true;
      const state = view.states.get(id);
      return Boolean(state?.children.some((child) => coversJourney(child)));
    };

    const nodes: MapNode[] = layout.nodes.flatMap((n): MapNode[] => {
      const state = view.states.get(n.id);
      if (!state) return [];
      const base = {
        id: n.id,
        position: { x: n.x, y: n.y },
        width: n.width,
        height: n.height,
        style: { width: n.width, height: n.height },
        ...(n.parent ? { parentId: n.parent } : {}),
        draggable: false,
        selectable: false
      };
      switch (n.kind) {
        case 'group':
        case 'region':
        case 'parallel':
          return [{ ...base, type: 'group', zIndex: 0, data: { state, variant: n.kind, dimmed: false } }];
        case 'chart-link':
          return [{ ...base, type: 'chartLink', zIndex: 2, data: { state, chart: state.childChartId ? view.charts.get(state.childChartId) ?? null : null, dimmed: dim(n.id) } }];
        case 'context':
          return [{ ...base, type: 'context', zIndex: 2, data: { state, chart: view.charts.get(state.chartId) ?? null, dimmed: dim(n.id) } }];
        case 'summary':
          return [
            {
              ...base,
              type: 'summary',
              zIndex: 2,
              data: { state, places: n.places ?? 0, status: n.status ?? state.status, dimmed: Boolean(journey) && !coversJourney(n.id) }
            }
          ];
        default:
          return [{ ...base, type: 'screen', zIndex: 2, data: { state, chartId, selected: selection.screen === n.id, dimmed: dim(n.id) } }];
      }
    });

    const edges: EventEdgeType[] = layout.edges.flatMap((e): EventEdgeType[] => {
      const transition = e.transitionId ? (view.transitions.get(e.transitionId) ?? null) : null;
      if (!transition && !e.bundle) return [];
      const step = e.transitionId ? (steps.get(e.transitionId) ?? null) : null;
      const dimmed = e.bundle ? Boolean(journey) && !(e.memberIds ?? []).some((id) => steps.has(id)) : Boolean(journey) && step === null;
      return [
        {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'event',
          zIndex: 1,
          selectable: false,
          data: { placed: e, transition, bundle: e.bundle, chartId, selected: Boolean(e.transitionId) && selection.event === e.transitionId, step, dimmed }
        }
      ];
    });
    return { nodes, edges };
  }, [view, chartId, layout, selection.screen, selection.event, selection.journey]);
}

function ZoomControls() {
  const flow = useReactFlow();
  const duration = reducedMotion() ? 0 : 250;
  return (
    <div className={styles.zoom} role="group" aria-label="Zoom">
      <button type="button" className={styles.zoomButton} onClick={() => void flow.zoomIn({ duration })} aria-label="Zoom in">
        <PlusIcon size={16} />
      </button>
      <button type="button" className={styles.zoomButton} onClick={() => void flow.zoomOut({ duration })} aria-label="Zoom out">
        <MinusIcon size={16} />
      </button>
      <button type="button" className={styles.zoomButton} onClick={() => void flow.fitView({ duration, padding: fitPadding() })} aria-label="Fit the whole map">
        <FitIcon size={16} />
      </button>
    </div>
  );
}

function Flow({ view, chartId, scopeKey, layout, selection }: { view: AtlasView; chartId: string; scopeKey: string; layout: ChartLayout; selection: MapSelection }) {
  const { nodes, edges } = useFlowElements(view, chartId, layout, selection);
  const saved = useRef<Viewport | undefined>(useUiStore.getState().viewports[scopeKey]);
  const saveViewport = useUiStore((s) => s.saveViewport);
  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => saveViewport(scopeKey, viewport), [scopeKey, saveViewport]);
  const onInit = useCallback(
    (flow: ReactFlowInstance<MapNode, EventEdgeType>) => {
      if (saved.current) return;
      const el = document.querySelector('.react-flow');
      const width = el?.clientWidth ?? 1200;
      const height = el?.clientHeight ?? 700;
      if (!selection.screen) {
        void flow.fitView({ padding: fitPadding() });
        return;
      }
      const focus = layout.nodes.find((n) => n.id === selection.screen);
      if (focus) {
        const zoom = START_ZOOM;
        flow.setViewport({ x: width / 2 - (focus.absX + focus.width / 2) * zoom, y: height / 2 - (focus.absY + focus.height / 2) * zoom, zoom });
        return;
      }
      const start = layout.nodes.find((n) => n.id === view.charts.get(chartId)?.initial) ?? layout.nodes[0]!;
      const zoom = START_ZOOM;
      flow.setViewport({ x: 32 - start.absX * zoom, y: height / 2 - (start.absY + start.height / 2) * zoom, zoom });
    },
    [layout, view, chartId, selection.screen]
  );
  const hasTime = useMemo(() => [...view.transitions.values()].some((t) => t.chartId === chartId && t.kind === 'time'), [view, chartId]);
  return (
    <ReactFlow<MapNode, EventEdgeType>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultViewport={saved.current}
      onInit={onInit}
      onMoveEnd={onMoveEnd}
      minZoom={0.08}
      maxZoom={2.5}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      onlyRenderVisibleElements
      className={styles.flow}
      aria-label="Map of screens and events. Drag to move, scroll or pinch to zoom."
    >
      <EdgeMarkers />
      <ZoomControls />
      <div className={styles.legendSlot}>
        <Legend showTime={hasTime} />
      </div>
      <MiniMap<MapNode>
        pannable
        zoomable
        ariaLabel="Overview of the whole map"
        className={styles.minimap}
        nodeColor={(n: Node) => {
          if (n.type === 'group') return 'transparent';
          const data = n.data as { status?: ItemStatus; state?: { status: ItemStatus } };
          return MINIMAP_COLOR[data.status ?? data.state?.status ?? 'spec-only'];
        }}
        nodeStrokeColor={(n: Node) => (n.type === 'group' ? '#ddd6fe' : 'transparent')}
        nodeBorderRadius={8}
        maskColor="rgba(248, 250, 252, 0.7)"
      />
    </ReactFlow>
  );
}

function MapSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.skeleton} role="status">
      <div className={styles.skeletonRow}>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={styles.skeletonPhone} style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
      <span className={styles.skeletonLabel}>{label}</span>
    </div>
  );
}

/** One chart's map. Positions come from the cached layout, statuses and media from the view. */
export function ChartMap({ view, chartId, selection, group }: { view: AtlasView; chartId: string; selection: MapSelection; group?: string }) {
  const input = useMemo(() => chartGraph(view, chartId, group ?? null), [view, chartId, group]);
  const chart = view.charts.get(chartId);
  const layout = useChartLayout(input, input?.scoped ? null : (chart?.layout ?? null));
  if (layout.error) {
    return (
      <div className={styles.mapMessage} role="alert">
        <p>The map for this chart couldn’t be laid out.</p>
        <button type="button" className={styles.retryButton} onClick={() => void layout.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (!layout.data) return <MapSkeleton label={`Laying out ${chart?.name ?? 'the map'}…`} />;
  if (layout.data.nodes.length === 0) {
    return (
      <div className={styles.mapMessage}>
        <p>This chart has no states yet.</p>
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <Flow view={view} chartId={chartId} scopeKey={`${chartId}:${input?.focus ?? ''}`} layout={layout.data} selection={selection} />
    </ReactFlowProvider>
  );
}
