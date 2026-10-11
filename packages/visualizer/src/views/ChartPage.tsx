import { Link, useParams, useSearch } from '@tanstack/react-router';

import { useAtlas } from '../app/atlas-context';
import { mapFrame } from '../layout/graph';
import { ChartMap } from '../map/ChartMap';
import { SidePanel } from './SidePanel';
import styles from './views.module.css';

export function ChartPage() {
  const { chartId } = useParams({ from: '/chart/$chartId' });
  const search = useSearch({ from: '/chart/$chartId' });
  const { view } = useAtlas();
  if (!view) return <div className={styles.plateScroll} role="status">Loading the spec…</div>;
  if (!view.charts.has(chartId)) {
    return (
      <div className={styles.plateScroll}>
        <h1 className={styles.plateTitle}>This chart isn’t in the spec</h1>
        <p className={styles.lead}>It may have been renamed or removed since this link was shared.</p>
        <Link to="/" search={(prev) => ({ run: prev.run })} className={styles.button}>
          Back to the product map
        </Link>
      </div>
    );
  }
  const selection = { screen: search.screen, event: search.event, journey: search.journey };
  const open = Boolean(search.screen || search.event || search.journey);
  if (open) return <SidePanel view={view} chartId={chartId} selection={selection} />;
  const chart = view.charts.get(chartId)!;
  const frame = mapFrame(view, chartId, search.group ?? null);
  const homeFocus = mapFrame(view, chartId, null).focus;
  return (
    <div className={styles.mapPlate}>
      <div className={styles.mapHeading}>
        <h1>{chart.name}</h1>
        {chart.description && <p>{chart.description}</p>}
        {frame.focus && (
          <p className={styles.mapScope}>
            <span>{frame.focus}</span>
            {frame.wider && (
              <Link to="/chart/$chartId" params={{ chartId }} search={(prev) => ({ run: prev.run, group: frame.wider && frame.wider !== homeFocus ? frame.wider : undefined })}>
                Wider map
              </Link>
            )}
          </p>
        )}
      </div>
      <div className={styles.mapArea}>
        <ChartMap key={`${chartId}:${search.group ?? ''}`} view={view} chartId={chartId} selection={selection} group={search.group} />
      </div>
    </div>
  );
}
