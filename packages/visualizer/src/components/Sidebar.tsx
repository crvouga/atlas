import { Link } from '@tanstack/react-router';

import { useAtlas } from '../app/atlas-context';
import { ClockIcon, MapIcon, RouteIcon, SearchIcon, SlidersIcon } from './icons';
import styles from './Workspace.module.css';

export function Sidebar() {
  const { view, reports, sources, live, setLive } = useAtlas();
  const running = reports.filter((report) => report.progress === 'running').length;
  const navigation = [
    { to: '/', label: 'Overview', icon: MapIcon, count: null },
    { to: '/screens', label: 'Screens', icon: SearchIcon, count: view?.totals.screens.total },
    { to: '/journeys', label: 'Journeys', icon: RouteIcon, count: view?.journeys.length },
    { to: '/runs', label: 'Reports', icon: ClockIcon, count: reports.length },
    { to: '/sources', label: 'Sources', icon: SlidersIcon, count: sources.filter((source) => source.enabled).length }
  ] as const;
  return (
    <aside className={styles.sidebar}>
      <Link to="/" search={(prev) => ({ run: prev.run })} className={styles.brand}>
        <span className={styles.brandIcon}>
          <MapIcon size={23} />
        </span>
        <span>
          Atlas<small>A living map of your product</small>
        </span>
      </Link>
      <div className={styles.productName}>
        <span>PRODUCT</span>
        <strong>{view?.title ?? 'Your product'}</strong>
      </div>
      <nav aria-label="Atlas navigation" className={styles.navigation}>
        {navigation.map(({ to, label, icon: Icon, count }) => (
          <Link
            key={to}
            to={to}
            search={(prev) => ({ run: prev.run })}
            activeOptions={{ exact: true }}
            activeProps={{ 'aria-current': 'page' }}
          >
            <Icon size={17} />
            <span>{label}</span>
            {count !== null && count !== undefined && <small aria-hidden="true">{count}</small>}
          </Link>
        ))}
      </nav>
      <div className={styles.sidebarFoot}>
        {running > 0 && (
          <Link to="/runs" search={(prev) => ({ run: prev.run })}>
            <span className={styles.liveDot} />
            {running} {running === 1 ? 'report' : 'reports'} in progress
          </Link>
        )}
        <label className={styles.liveSwitch}>
          <input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} />
          Live updates
        </label>
        <p>
          Explore the spec.
          <br />
          See the product as it runs.
        </p>
      </div>
    </aside>
  );
}

export function ReportActivity() {
  const { view, run, live, setLive, refreshing, refresh, sources } = useAtlas();
  const progress = view?.run?.info.progress ?? run.summary?.execution;
  const running = view?.run?.progress === 'running' || run.summary?.progress === 'running';
  const errors = sources.filter((source) => source.enabled && source.error).length;
  return (
    <div className={styles.activity} data-running={running}>
      <span className={live ? styles.liveDot : styles.pausedDot} />
      <span className={styles.activityCopy}>
        <strong>{!live ? 'Updates paused' : running ? 'Report in progress' : 'Live updates'}</strong>
        {run.waiting ? (
          <span>Waiting for the first snapshot</span>
        ) : running && progress ? (
          <span>
            {progress.completedPaths} of {progress.totalPaths} paths checked · {progress.activePaths.length} active
          </span>
        ) : (
          <span>
            {sources.filter((source) => source.enabled).length} report{' '}
            {sources.filter((source) => source.enabled).length === 1 ? 'source' : 'sources'}
          </span>
        )}
        {run.summary && <span className={styles.activitySource}>{run.summary.sourceLabel}</span>}
      </span>
      {errors > 0 && (
        <Link to="/sources" search={(prev) => ({ run: prev.run })} className={styles.sourceError}>
          {errors} {errors === 1 ? 'source needs' : 'sources need'} attention
        </Link>
      )}
      {run.error && (
        <Link to="/runs" search={(prev) => ({ run: prev.run })} className={styles.sourceError} title={run.error}>
          {view?.run ? 'Last snapshot · refresh failed' : 'Report unavailable'}
        </Link>
      )}
      <button type="button" className={styles.mobileLive} onClick={() => setLive(!live)}>
        {live ? 'Pause updates' : 'Resume updates'}
      </button>
      <button type="button" onClick={refresh} disabled={refreshing} className={styles.refresh}>
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
