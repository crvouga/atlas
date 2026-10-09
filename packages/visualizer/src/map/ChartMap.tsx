import { MiniMap, ReactFlow, ReactFlowProvider, type Node, type Viewport } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { AtlasView, ItemStatus } from '../data/model';
import { chartGraph, DEFAULT_DETAILS, isolateJourney } from '../layout/graph';
import type { ChartLayout } from '../layout/layout';
import { useChartLayout } from '../layout/use-chart-layout';
import { useUiStore } from '../state/ui-store';
import { EdgeMarkers, edgeTypes, type EventEdgeType } from './EventEdge';
import { ancestors, chartScope, journeyPath, stepFocus, visibleRepresentative } from './navigation';
import styles from './map.module.css';
import { MapControls } from './MapControls';
import { nodeTypes, type ChartLinkNodeType, type ContextNodeType, type GroupNodeType, type ScreenNodeType } from './nodes';

type MapNode = ScreenNodeType | GroupNodeType | ChartLinkNodeType | ContextNodeType;
export type MapSelection = { screen?: string; event?: string; journey?: string; step?: number };
const MINIMAP_COLOR: Record<ItemStatus, string> = {
  passed: '#86efac',
  flaky: '#fdba74',
  failed: '#fca5a5',
  'not-reached': '#e2e8f0',
  'not-yet-run': '#e2e8f0',
  'spec-only': '#ddd6fe'
};

function hiddenCount(view: AtlasView, name: string, seen = new Set<string>()): number {
  if (seen.has(name)) return 0;
  seen.add(name);
  const state = view.states.get(name);
  const children = state?.childChartId ? (view.charts.get(state.childChartId)?.rootStates ?? []) : (state?.children ?? []);
  return children.reduce((sum, child) => sum + 1 + hiddenCount(view, child, seen), 0);
}

function useFlowElements(view: AtlasView, chartId: string, layout: ChartLayout, selection: MapSelection, compact: boolean) {
  return useMemo(() => {
    const journey = view.journeys.find((j) => j.id === selection.journey);
    const path = journeyPath(view, journey);
    const visible = new Set(layout.nodes.map((n) => n.id));
    const active = new Set(stepFocus(view, journey, selection.step).map((id) => visibleRepresentative(view, id, visible)));
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
      const emphasis = { dimmed: Boolean(journey) && !path.states.has(n.id), active: active.has(n.id), onPath: Boolean(journey) && path.states.has(n.id) };
      switch (n.kind) {
        case 'group':
        case 'region':
        case 'parallel':
          return [{ ...base, type: 'group', zIndex: 0, data: { state, chartId, variant: n.kind, ...emphasis } }];
        case 'chart-link':
        case 'collapsed':
          return [
            {
              ...base,
              type: 'chartLink',
              zIndex: 2,
              data: {
                state,
                chartId,
                chart: state.childChartId ? (view.charts.get(state.childChartId) ?? null) : null,
                count: hiddenCount(view, n.id),
                ...emphasis
              }
            }
          ];
        case 'context':
          return [{ ...base, type: 'context', zIndex: 2, data: { state, chart: view.charts.get(state.chartId) ?? null, dimmed: emphasis.dimmed } }];
        default:
          return [{ ...base, type: 'screen', zIndex: 2, data: { state, chartId, selected: selection.screen === n.id, compact, ...emphasis } }];
      }
    });
    const edges: EventEdgeType[] = layout.edges.flatMap((e): EventEdgeType[] => {
      const transition = view.transitions.get(e.transitionId);
      if (!transition) return [];
      const indices = path.transitions.get(e.transitionId);
      const current = selection.step !== undefined && Boolean(indices?.includes(selection.step));
      const step = indices ? (current ? selection.step! : indices[0]!) + 1 : null;
      return [
        {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'event',
          zIndex: current ? 4 : 1,
          selectable: false,
          data: { placed: e, transition, chartId, selected: selection.event === e.transitionId, step, active: current, dimmed: Boolean(journey) && !indices }
        }
      ];
    });
    return { nodes, edges };
  }, [view, chartId, layout, selection.screen, selection.event, selection.journey, selection.step, compact]);
}

function Flow({
  view,
  chartId,
  layout,
  selection,
  busy,
  compact
}: {
  view: AtlasView;
  chartId: string;
  layout: ChartLayout;
  selection: MapSelection;
  busy: boolean;
  compact: boolean;
}) {
  const { nodes, edges } = useFlowElements(view, chartId, layout, selection, compact);
  const saved = useRef<Viewport | undefined>(useUiStore.getState().viewports[chartId]);
  const saveViewport = useUiStore((s) => s.saveViewport);
  const minimap = useUiStore((s) => s.minimap);
  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => saveViewport(chartId, viewport), [chartId, saveViewport]);
  return (
    <ReactFlow<MapNode, EventEdgeType>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultViewport={saved.current}
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
      <MapControls view={view} chartId={chartId} layout={layout} selection={selection} busy={busy} hadSavedViewport={Boolean(saved.current)} />
      {minimap && (
        <MiniMap<MapNode>
          pannable
          zoomable
          ariaLabel="Overview of the whole map"
          className={styles.minimap}
          nodeColor={(n: Node) => (n.type === 'group' ? 'transparent' : MINIMAP_COLOR[(n as ScreenNodeType).data.state.status])}
          nodeStrokeColor={(n: Node) => (n.type === 'group' ? '#ddd6fe' : 'transparent')}
          nodeBorderRadius={8}
          maskColor="rgba(248, 250, 252, 0.7)"
        />
      )}
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

export function ChartMap({ view, chartId, selection }: { view: AtlasView; chartId: string; selection: MapSelection }) {
  const details = useUiStore((s) => s.details[chartId] ?? DEFAULT_DETAILS);
  const compact = useUiStore((s) => s.compact);
  const pathOnly = useUiStore((s) => s.pathOnly);
  const revealedSelection = useRef('');
  // Reveal only when navigation changes. Users can subsequently collapse the current branch.
  useEffect(() => {
    const navigationKey = JSON.stringify([chartId, selection]);
    if (revealedSelection.current === navigationKey) return;
    revealedSelection.current = navigationKey;
    const journey = view.journeys.find((j) => j.id === selection.journey);
    const event = selection.event ? view.transitions.get(selection.event) : undefined;
    const targets = selection.screen
      ? [selection.screen]
      : event
        ? [event.source, ...(event.target ? [event.target] : [])]
        : stepFocus(view, journey, selection.step);
    if (!targets.length) return;
    const scope = chartScope(view, chartId);
    const parents = new Set(targets.flatMap((id) => ancestors(view, id)).filter((id) => scope.has(view.states.get(id)?.chartId ?? '')));
    const current = useUiStore.getState().details[chartId] ?? DEFAULT_DETAILS;
    const expanded = [...new Set([...current.expanded, ...[...parents].filter((id) => view.states.get(id)?.childChartId)])];
    const collapsed = current.collapsed.filter((id) => !parents.has(id));
    if (expanded.length !== current.expanded.length || collapsed.length !== current.collapsed.length)
      useUiStore.getState().setDetails(chartId, { expanded, collapsed });
  }, [chartId, selection.screen, selection.event, selection.journey, selection.step, view]);
  const input = useMemo(() => {
    let graph = chartGraph(view, chartId, details);
    if (!graph) return graph;
    const journey = view.journeys.find((j) => j.id === selection.journey);
    if (pathOnly && journey?.steps.length) graph = isolateJourney(view, graph, journey, selection);
    if (!compact) return graph;
    const nodes = graph.nodes.map((n) => (n.kind === 'screen' ? { ...n, width: 200, height: 100 } : n));
    return { ...graph, nodes, key: `${graph.key}:compact` };
  }, [view, chartId, details, compact, pathOnly, selection.journey, selection.screen, selection.event]);
  const chart = view.charts.get(chartId);
  // Saved pins describe the original expanded geometry, not alternative detail levels.
  const pinned = details.expanded.length || details.collapsed.length || compact || (pathOnly && selection.journey) ? null : (chart?.layout ?? null);
  const layout = useChartLayout(input, pinned);
  if (layout.error)
    return (
      <div className={styles.mapMessage} role="alert">
        <p>The map for this chart couldn’t be laid out.</p>
        <button type="button" className={styles.retryButton} onClick={() => void layout.refetch()}>
          Try again
        </button>
      </div>
    );
  if (!layout.data) return <MapSkeleton label={`Laying out ${chart?.name ?? 'the map'}…`} />;
  if (!layout.data.nodes.length)
    return (
      <div className={styles.mapMessage}>
        <p>This chart has no states yet.</p>
      </div>
    );
  return (
    <ReactFlowProvider>
      <Flow view={view} chartId={chartId} layout={layout.data} selection={selection} busy={layout.isFetching} compact={compact} />
    </ReactFlowProvider>
  );
}
