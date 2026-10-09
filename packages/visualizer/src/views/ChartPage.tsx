import { Link, useParams, useSearch } from '@tanstack/react-router';

import { useAtlas } from '../app/atlas-context';
import { ChartMap } from '../map/ChartMap';
import { SidePanel } from './SidePanel';
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
  const selection = { screen: search.screen, event: search.event, journey: search.journey };
  const open = Boolean(search.screen || search.event || search.journey);
  return (
    <div className={styles.chartView} data-panel={open}>
      <div className={styles.mapArea}>
        <ChartMap key={chartId} view={view} chartId={chartId} selection={selection} />
      </div>
      {open && <SidePanel view={view} chartId={chartId} selection={selection} />}
    </div>
  );
}
