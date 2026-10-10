import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';

import { useGazetteerQuery } from '../app/gazetteer';
import { useAtlas } from '../app/atlas-context';
import type { AtlasView } from '../data/model';
import { LATEST } from '../data/queries';
import { DataIssues } from './DataIssues';
import styles from './Header.module.css';

const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function formatRunTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unknown time' : dateTime.format(d);
}

function RunLine({ view }: { view: AtlasView | null }) {
  const { run } = useAtlas();
  if (!view) return <span className={styles.meta}>Loading the spec…</span>;
  if (run.loading) return <span className={styles.meta}>Loading the run…</span>;
  const count = view.totals.screens.total;
  const screens = `${count} ${count === 1 ? 'screen' : 'screens'}`;
  const when = view.run ? null : view.runs.length ? 'No finished run yet' : 'From the spec';
  return (
    <span className={styles.meta}>
      <span className={styles.metaText}>
        {when ? `${when} · ${screens}` : screens}
        {view.run?.outOfDate && <span className={styles.stale}> · spec has changed since</span>}
      </span>
    </span>
  );
}

function RunPicker({ view }: { view: AtlasView }) {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const { latestRunId } = useAtlas();
  if (view.runs.length === 0) return null;
  const latest = view.runs.find((run) => run.id === latestRunId);
  return (
    <label className={styles.picker}>
      <span className="sr-only">Run</span>
      <select
        className={styles.select}
        value={search.run ?? LATEST}
        onChange={(event) => void navigate({ to: '.', search: (prev) => ({ ...prev, run: event.target.value === LATEST ? undefined : event.target.value }) })}
      >
        <option value={LATEST}>Latest{latest ? ` · ${formatRunTime(latest.startedAt)}` : ''}</option>
        {view.runs.map((run) => (
          <option key={run.id} value={run.id} disabled={run.progress === 'running'}>
            {formatRunTime(run.startedAt)} · {run.progress === 'running' ? 'still running' : run.mode === 'showcase' ? 'with videos' : 'quick check'}
          </option>
        ))}
      </select>
    </label>
  );
}

function runOnly(prev: { run?: unknown }) {
  return typeof prev.run === 'string' ? { run: prev.run } : {};
}

export function Header() {
  const { view } = useAtlas();
  const { pathname } = useLocation();
  const { query, setQuery } = useGazetteerQuery();
  const mode = pathname === '/gherkin' ? 'gherkin' : pathname === '/quint' ? 'quint' : 'statechart';
  const placeholder = mode === 'gherkin' ? 'Find a feature' : mode === 'quint' ? 'Find a module' : 'Find a place';
  return (
    <header className={styles.header}>
      <Link to="/" search={(prev) => runOnly(prev)} className={styles.home}>
        {view?.title ?? 'Atlas'}
      </Link>
      <nav className={styles.modes} aria-label="Spec type">
        <Link to="/" search={(prev) => runOnly(prev)} aria-current={mode === 'statechart' ? 'page' : undefined}>Statecharts</Link>
        <Link to="/gherkin" search={{}} aria-current={mode === 'gherkin' ? 'page' : undefined}>Gherkin</Link>
        <Link to="/quint" search={{}} aria-current={mode === 'quint' ? 'page' : undefined}>Quint</Link>
      </nav>
      {mode === 'statechart' && <RunLine view={view} />}
      <input className={styles.search} type="search" value={query} placeholder={placeholder} onChange={(event) => setQuery(event.target.value)} />
      {mode === 'statechart' && (
        <div className={styles.tools}>
          {view && <RunPicker view={view} />}
          {view && <DataIssues issues={view.issues} onDark />}
        </div>
      )}
    </header>
  );
}
