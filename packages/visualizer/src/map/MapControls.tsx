import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { getViewportForBounds, useReactFlow, useViewport } from '@xyflow/react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AtlasView } from '../data/model';
import { CheckIcon, ChevronDownIcon, FitIcon, MinusIcon, PlusIcon, RouteIcon, SearchIcon, SlidersIcon } from '../components/icons';
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
  const chart = view.charts.get(chartId);
  const related = new Set([chartId, ...(chart?.childChartIds ?? []), ...(chart?.parent ? [chart.parent.chartId] : [])]);
  const journeys = view.journeys.filter((j) => j.chartIds.some((id) => related.has(id)) && j.chartIds.includes(chartId));
  const transitions = [...view.transitions.values()].filter((t) => scope.has(t.chartId));
  const stateCount = layout.nodes.filter((n) => !['group', 'region', 'parallel'].includes(n.kind)).length;
  return (
    <>
      <div className={`${styles.toolbar} nodrag nopan`} role="toolbar" aria-label="Map controls">
        {journeys.length > 0 && (
          <Popover.Root>
            <Popover.Trigger className={styles.toolButton} data-active={Boolean(journey)}>
              <RouteIcon size={15} />
              Journeys
              <span className={styles.count}>{journeys.length}</span>
              <ChevronDownIcon size={12} className={styles.chevron} />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className={styles.menu} align="start" sideOffset={8} collisionPadding={12}>
                <nav aria-label="Journeys through this chart">
                  <p className={styles.menuLead}>Follow a journey step by step through the map.</p>
                  <ul className={styles.journeyMenu}>
                    {journeys.map((j) => {
                      const active = selection.journey === j.id;
                      return (
                        <li key={j.id}>
                          <Popover.Close asChild>
                            <Link
                              to="/chart/$chartId"
                              params={{ chartId }}
                              search={(prev) => ({ run: prev.run, journey: active ? undefined : j.id })}
                              className={styles.journeyItem}
                              data-active={active}
                              aria-current={active ? 'true' : undefined}
                            >
                              <StatusDot status={j.status} />
                              <span>{j.name}</span>
                              {active && <CheckIcon size={14} />}
                            </Link>
                          </Popover.Close>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
        <div
          className={styles.searchBox}
          ref={searchBox}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSearching(false);
          }}
        >
          <SearchIcon size={15} className={styles.searchIcon} />
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
            placeholder="Find a state"
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
                {query ? `${results.length}${results.length === 30 ? '+' : ''} matching` : 'Jump to a state'}
              </span>
              {results.map((state, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={activeResult === index}
                  id={`state-result-${index}`}
                  key={state.name}
                  onClick={() => choose(state.name)}
                  onMouseEnter={() => setActiveResult(index)}
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
      </div>
      <div className={`${styles.viewbar} nodrag nopan`}>
        {journey && (
          <button
            type="button"
            className={styles.toolButton}
            aria-pressed={pathOnly}
            disabled={!journey.steps.length}
            onClick={() => useUiStore.getState().setPathOnly(!pathOnly)}
            title="Hide states and events outside this journey"
          >
            Path only
          </button>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className={styles.toolButton}>
            <SlidersIcon size={15} />
            View
            <ChevronDownIcon size={12} className={styles.chevron} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={styles.menu} align="end" sideOffset={8} collisionPadding={12}>
              <DropdownMenu.CheckboxItem
                className={styles.menuItem}
                checked={compact}
                onCheckedChange={(checked) => useUiStore.getState().setCompact(checked)}
                onSelect={(event) => event.preventDefault()}
              >
                <span className={styles.menuCheck}>
                  <DropdownMenu.ItemIndicator>
                    <CheckIcon size={14} />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span>
                  Compact
                  <small>Smaller cards without screenshots</small>
                </span>
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.CheckboxItem
                className={styles.menuItem}
                checked={minimap}
                onCheckedChange={(checked) => useUiStore.getState().setMinimap(checked)}
                onSelect={(event) => event.preventDefault()}
              >
                <span className={styles.menuCheck}>
                  <DropdownMenu.ItemIndicator>
                    <CheckIcon size={14} />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span>Minimap</span>
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.CheckboxItem className={styles.menuItem} checked={legend} onCheckedChange={setLegend} onSelect={(event) => event.preventDefault()}>
                <span className={styles.menuCheck}>
                  <DropdownMenu.ItemIndicator>
                    <CheckIcon size={14} />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span>Legend</span>
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.Separator className={styles.menuSeparator} />
              <DropdownMenu.Item
                className={styles.menuItem}
                disabled={!containers.length}
                onSelect={() => setDetails(chartId, { expanded: [], collapsed: containers.filter((s) => !s.childChartId).map((s) => s.name) })}
              >
                <span className={styles.menuCheck} />
                <span>
                  Collapse all
                  <small>Fold child machines and nested groups</small>
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={styles.menuItem}
                disabled={!containers.length}
                onSelect={() => setDetails(chartId, { expanded: containers.filter((s) => s.childChartId).map((s) => s.name), collapsed: [] })}
              >
                <span className={styles.menuCheck} />
                <span>
                  Expand all
                  <small>Open every child machine in place</small>
                </span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div className={styles.footer}>
        {legend && (
          <div className={`${styles.legendSlot} nodrag nopan`}>
            <Legend showTime={transitions.some((t) => t.kind === 'time')} showHandOff={transitions.some((t) => t.kind === 'hand-off')} />
          </div>
        )}
        <div className={styles.mapContext} role="status">
          {busy ? 'Updating the map…' : `${stateCount} ${stateCount === 1 ? 'state' : 'states'} shown`}
          {journey && <span>{selection.step === undefined ? ', journey highlighted' : `, following step ${selection.step + 1}`}</span>}
        </div>
      </div>
      <div className={`${styles.zoom} nodrag nopan`} role="group" aria-label="Map viewport">
        {journey && (
          <button type="button" className={styles.fitPath} onClick={() => fit([...path.states])}>
            <RouteIcon size={14} />
            Fit journey
          </button>
        )}
        <div className={styles.zoomBar}>
          <button type="button" className={styles.zoomButton} onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
            <MinusIcon size={15} />
          </button>
          <ZoomReadout />
          <button type="button" className={styles.zoomButton} onClick={() => zoomBy(1.2)} aria-label="Zoom in">
            <PlusIcon size={15} />
          </button>
          <span className={styles.zoomDivider} aria-hidden="true" />
          <button type="button" className={styles.zoomButton} onClick={() => fit()} aria-label="Fit the whole map" title="Fit the whole map (F)">
            <FitIcon size={15} />
          </button>
        </div>
      </div>
    </>
  );
}
