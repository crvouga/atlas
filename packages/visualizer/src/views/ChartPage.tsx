import { Link, useParams, useSearch } from '@tanstack/react-router';

import { useAtlas } from '../app/atlas-context';
import { ChartMap } from '../map/ChartMap';
import { SidePanel } from './SidePanel';
import { JourneyNavigator } from './JourneyNavigator';
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
  const journey = view.journeys.find((j) => j.id === search.journey);
  const step = journey && search.step !== undefined && search.step < journey.steps.length ? search.step : undefined;
  const selection = { screen: search.screen, event: search.event, journey: search.journey, step };
  const open = Boolean(search.screen || search.event || (search.journey && !journey));
  return (
    <div className={styles.chartView} data-panel={open} data-journey={Boolean(journey)}>
      {journey && <JourneyNavigator key={journey.id} view={view} chartId={chartId} journey={journey} selection={selection} />}
      <div className={styles.mapArea}>
        <ChartMap key={chartId} view={view} chartId={chartId} selection={selection} />
      </div>
      {open && <SidePanel view={view} chartId={chartId} selection={selection} />}
    </div>
  );
}
