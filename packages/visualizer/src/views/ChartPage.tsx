import { Link, Navigate, useParams, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';

import { useAtlas } from '../app/atlas-context';
import { ChartMap } from '../map/ChartMap';
import { SidePanel } from './SidePanel';
import { JourneyNavigator } from './JourneyNavigator';
import { ExplorerPanel } from './ExplorerPanel';
import type { AtlasView } from '../data/model';
import type { ChartSearch } from '../app/router';
import styles from './views.module.css';

export function ChartPage() {
  const { chartId } = useParams({ from: '/chart/$chartId' });
  const search = useSearch({ from: '/chart/$chartId' });
  const { view } = useAtlas();
  if (!view) {
    return (
      <div className={styles.chartView}>
        <div className={styles.mapLoading} role="status">
          Loading the spec…
        </div>
      </div>
    );
  }
  if (!view.charts.has(chartId)) {
    return (
      <div className={styles.message}>
        <h1>This chart isn’t in the spec</h1>
        <p>It may have been renamed or removed since this link was shared.</p>
        <Link to="/" search={(prev) => ({ run: prev.run })} className={styles.button}>
          Back to the product map
        </Link>
      </div>
    );
  }
  return <ReadyChartPage view={view} chartId={chartId} search={search} />;
}

function ReadyChartPage({ view, chartId, search }: { view: AtlasView; chartId: string; search: ChartSearch }) {
  const choices = search.choices ?? [];
  const cursor = Math.min(search.cursor ?? choices.length, choices.length);
  const exploring = Boolean(search.explore);
  const simulation = useMemo(() => {
    if (!exploring) return null;
    try { return view.simulation(chartId); } catch { return null; }
  }, [view, chartId, exploring]);
  const result = useMemo(() => simulation?.replay(choices.slice(0, cursor)) ?? null, [simulation, choices, cursor]);
  const journey = exploring ? undefined : view.journeys.find((j) => j.id === search.journey);
  const step = journey && search.step !== undefined && search.step < journey.steps.length ? search.step : undefined;
  const selection = { screen: search.screen, event: search.event, journey: journey?.id, step, active: result && simulation ? simulation.leaves(result.config) : undefined, fired: result?.steps.at(-1)?.transitionIds };
  const open = Boolean(search.screen || search.event || (!exploring && search.journey && !journey));
  if (exploring && simulation && simulation.rootId !== chartId) return <Navigate to="/chart/$chartId" params={{ chartId: simulation.rootId }} search={search} replace />;
  return (
    <div className={styles.chartView} data-panel={open} data-journey={Boolean(journey)} data-explore={exploring}>
      {exploring && <ExplorerPanel view={view} chartId={chartId} simulation={simulation} result={result} choices={choices} cursor={cursor} />}
      {journey && <JourneyNavigator key={journey.id} view={view} chartId={chartId} journey={journey} selection={selection} />}
      <div className={styles.mapArea}>
        <ChartMap key={chartId} view={view} chartId={chartId} selection={selection} />
      </div>
      {open && <SidePanel view={view} chartId={chartId} selection={selection} />}
    </div>
  );
}
