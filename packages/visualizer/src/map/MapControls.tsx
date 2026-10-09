import { getViewportForBounds, useReactFlow, useViewport } from '@xyflow/react';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AtlasView } from '../data/model';
import { FitIcon, MinusIcon, PlusIcon } from '../components/icons';
import { Legend } from '../components/Legend';
import { StatusDot } from '../components/Status';
import type { ChartLayout } from '../layout/layout';
import { useUiStore } from '../state/ui-store';
import type { MapSelection } from './ChartMap';
import { chartScope, initialState, journeyPath, stepFocus, visibleRepresentative } from './navigation';
import styles from './map.module.css';

import type { CameraController } from './use-camera';

function ZoomReadout() {
  const { zoom } = useViewport();
  return <span className={styles.zoomValue}>{Math.round(zoom * 100)}%</span>;
}

export function MapControls({
  view,
  chartId,
  layout,
  selection,
  busy,
  hadSavedViewport,
  camera
}: {
  view: AtlasView;
  chartId: string;
  layout: ChartLayout;
  selection: MapSelection;
  busy: boolean;
  hadSavedViewport: boolean;
  camera: CameraController;
}) {
  const flow = useReactFlow();
  const initialized = flow.viewportInitialized;
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [legend, setLegend] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchBox = useRef<HTMLDivElement>(null);
  const compact = useUiStore((s) => s.compact);
  const minimap = useUiStore((s) => s.minimap);
  const pathOnly = useUiStore((s) => s.pathOnly);
  const setDetails = useUiStore((s) => s.setDetails);
  const scope = useMemo(() => chartScope(view, chartId), [view, chartId]);
  const journey = view.journeys.find((j) => j.id === selection.journey);
  const path = useMemo(() => journeyPath(view, journey), [view, journey]);
  const visible = useMemo(() => new Set(layout.nodes.map((n) => n.id)), [layout]);
  const fit = useCallback(
    (ids?: string[], animate = true) => {
      const targets = ids ? [...new Set(ids.map((id) => visibleRepresentative(view, id, visible)).filter((id): id is string => Boolean(id)))] : undefined;
      if (targets?.length === 0) return;
      const placed = targets ? layout.nodes.filter((node) => targets.includes(node.id)) : layout.nodes;
      if (!placed.length) return;
      const x = Math.min(...placed.map((node) => node.absX));
      const y = Math.min(...placed.map((node) => node.absY));
      const width = Math.max(...placed.map((node) => node.absX + node.width)) - x;
      const height = Math.max(...placed.map((node) => node.absY + node.height)) - y;
      const element = searchBox.current?.closest('.react-flow');
      const top = (searchBox.current?.closest('[role="toolbar"]')?.clientHeight ?? 56) + 40;
      const viewport = getViewportForBounds(
        { x, y, width, height },
        Math.max(100, (element?.clientWidth ?? 1200) - 80),
        Math.max(100, (element?.clientHeight ?? 700) - top - 45),
        0.08,
        1,
        0.18
      );
      camera.moveTo({ ...viewport, x: viewport.x + 20, y: viewport.y + top }, animate);
    },
    [camera, view, visible, layout]
  );
  const zoomBy = (factor: number) => {
    const current = flow.getViewport();
    const zoom = Math.max(0.08, Math.min(2.5, current.zoom * factor));
    const element = searchBox.current?.closest('.react-flow');
    const cx = (element?.clientWidth ?? 1200) / 2;
    const cy = (element?.clientHeight ?? 700) / 2;
    const ratio = zoom / current.zoom;
    camera.moveTo({ x: cx - (cx - current.x) * ratio, y: cy - (cy - current.y) * ratio, zoom });
  };
  const lastFocus = useRef('');
  useEffect(() => {
    if (!initialized || busy) return;
    const key = JSON.stringify([selection, layout.key]);
    if (lastFocus.current === key) return;
    const first = !lastFocus.current;
    lastFocus.current = key;
    if (selection.screen) {
      fit([selection.screen], !first);
      return;
    }
    if (selection.event) {
      const edge = layout.edges.find((e) => e.transitionId === selection.event || view.transitions.get(e.transitionId)?.carriedBy === selection.event);
      if (edge) {
        fit([edge.source, edge.target], !first);
        return;
      }
    }
    const focus = stepFocus(view, journey, selection.step);
    if (focus.length) {
      fit(focus, !first);
      return;
    }
    if (journey) {
      fit([...path.states], !first);
      return;
    }
    if (first && hadSavedViewport) return;
    const el = searchBox.current?.closest('.react-flow');
    const readable = Math.min((el?.clientWidth ?? 1200) / layout.width, (el?.clientHeight ?? 700) / layout.height) > 0.42;
    if (readable) fit(undefined, !first);
    else fit([initialState(view, chartId) ?? layout.nodes[0]!.id], !first);
  }, [initialized, busy, selection, layout, fit, journey, path, view, chartId, hadSavedViewport]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')
      )
        return;
      if (event.key === '/') {
        event.preventDefault();
        searchInput.current?.focus();
        setSearching(true);
      }
      if (event.key.toLowerCase() === 'f' && !target?.closest('button, a')) {
        event.preventDefault();
        fit(journey ? [...path.states] : undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, journey, path]);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...view.states.values()]
      .filter((state) => (scope.has(state.chartId) || visible.has(state.name)) && `${state.name} ${state.description}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle)))
      .slice(0, 30);
  }, [view, scope, visible, query]);
  useEffect(() => {
    if (searching) document.getElementById(`state-result-${activeResult}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeResult, searching]);
  const choose = (name: string) => {
    setSearching(false);
    setQuery('');
    void navigate({ to: '/chart/$chartId', params: { chartId }, search: (prev) => ({ run: prev.run, journey: prev.journey, step: prev.step, screen: name }) });
  };
  const containers = [...view.states.values()].filter((state) => scope.has(state.chartId) && (state.childChartId || state.children.length));
  return (
    <>
      <div className={`${styles.toolbar} nodrag nopan`} role="toolbar" aria-label="Map controls">
        <div
          className={styles.searchBox}
          ref={searchBox}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSearching(false);
          }}
        >
          <input
            ref={searchInput}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveResult(0);
              setSearching(true);
            }}
            onFocus={() => setSearching(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setSearching(false);
                searchInput.current?.blur();
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setSearching(true);
                setActiveResult((index) => Math.max(0, Math.min(results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
              }
              if (event.key === 'Enter' && results[activeResult]) {
                event.preventDefault();
                choose(results[activeResult]!.name);
              }
            }}
            placeholder="Find a state…"
            role="combobox"
            aria-autocomplete="list"
            aria-activedescendant={searching && results[activeResult] ? `state-result-${activeResult}` : undefined}
            aria-label="Find a state"
            aria-expanded={searching}
            aria-controls="state-search-results"
            autoComplete="off"
          />
          <kbd>/</kbd>
          {searching && (
            <div id="state-search-results" className={styles.searchResults} role="listbox" aria-label="Matching states">
              <span className={styles.searchHint}>
                {query ? 'Matching states' : 'Jump to a state'} · {results.length}
                {results.length === 30 ? '+' : ''}
              </span>
              {results.map((state, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={activeResult === index}
                  id={`state-result-${index}`}
                  key={state.name}
                  onClick={() => choose(state.name)}
                >
                  <StatusDot status={state.status} />
                  <span>
                    {state.name}
                    <small>{state.childChartId ? 'Child machine' : state.chartId}</small>
                  </span>
                </button>
              ))}
              {!results.length && <p>No states match “{query}”.</p>}
            </div>
          )}
        </div>
        <div className={styles.toolbarGroup}>
          <button
            type="button"
            onClick={() => setDetails(chartId, { expanded: [], collapsed: containers.filter((s) => !s.childChartId).map((s) => s.name) })}
            title="Collapse child machines and nested groups"
            disabled={!containers.length}
          >
            Collapse all
          </button>
          <button
            type="button"
            onClick={() => setDetails(chartId, { expanded: containers.filter((s) => s.childChartId).map((s) => s.name), collapsed: [] })}
            disabled={!containers.length}
          >
            Expand all
          </button>
        </div>
        {journey && (
          <button
            type="button"
            aria-pressed={pathOnly}
            disabled={!journey.steps.length}
            onClick={() => useUiStore.getState().setPathOnly(!pathOnly)}
            title="Hide states and events outside this journey"
          >
            Path only
          </button>
        )}
        <button type="button" aria-pressed={compact} onClick={() => useUiStore.getState().setCompact(!compact)} title="Use smaller cards without screenshots">
          Compact
        </button>
        <button type="button" aria-pressed={minimap} onClick={() => useUiStore.getState().setMinimap(!minimap)}>
          Minimap
        </button>
        <button type="button" aria-expanded={legend} onClick={() => setLegend(!legend)}>
          Legend
        </button>
      </div>
      <div className={styles.mapContext} role="status">
        {busy ? 'Updating map…' : `${layout.nodes.filter((n) => !['group', 'region', 'parallel'].includes(n.kind)).length} visible states`}
        {journey && <span> · {selection.step === undefined ? 'Journey path highlighted' : `Following step ${selection.step + 1}`}</span>}
      </div>
      <div className={`${styles.zoom} nodrag nopan`} role="group" aria-label="Map viewport">
        {journey && (
          <button type="button" className={styles.fitPath} onClick={() => fit([...path.states])}>
            Fit journey
          </button>
        )}
        <button type="button" className={styles.zoomButton} onClick={() => zoomBy(1.2)} aria-label="Zoom in">
          <PlusIcon size={16} />
        </button>
        <ZoomReadout />
        <button type="button" className={styles.zoomButton} onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
          <MinusIcon size={16} />
        </button>
        <button type="button" className={styles.zoomButton} onClick={() => fit()} aria-label="Fit the whole map" title="Fit the whole map">
          <FitIcon size={16} />
        </button>
      </div>
      {legend && (
        <div className={styles.legendSlot}>
          <Legend showTime={[...view.transitions.values()].some((t) => scope.has(t.chartId) && t.kind === 'time')} />
        </div>
      )}
      <div className={styles.mapHint}>
        Drag to pan · Scroll to zoom · <kbd>F</kbd> to fit
      </div>
    </>
  );
}
