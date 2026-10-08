import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';

import { useAtlas } from '../app/atlas-context';
import { emptyCounts, type AtlasView } from '../data/model';
import { LATEST } from '../data/queries';
import { DataIssues } from './DataIssues';
import styles from './Header.module.css';
import { ChevronIcon } from './icons';
import { StatusDot, SummaryBar } from './Status';

const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function formatRunTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unknown time' : dateTime.format(d);
}

function minutes(ms: number | undefined) {
  if (!ms) return null;
  const m = Math.round(ms / 60_000);
  return m < 1 ? 'under a minute' : `${m} min`;
}

function RunMeta({ view }: { view: AtlasView | null }) {
  const { run, runs } = useAtlas();
  if (!view) return <span className={styles.meta}>Loading the spec…</span>;
  if (run.loading) return <span className={styles.meta}>Loading the run…</span>;
  if (!view.run) {
    return <span className={styles.meta}>{runs.loading ? 'Looking for runs…' : view.runs.length ? 'No finished run yet' : 'From the spec · not run yet'}</span>;
  }
  const info = view.run.info;
  const parts = [
    `Checked ${formatRunTime(info.startedAt)}`,
    minutes(info.durationMs),
    info.mode === 'showcase' ? 'with videos' : 'quick check',
    info.branch,
    info.commit?.slice(0, 7)
  ].filter(Boolean);
  return (
    <span className={styles.meta}>
      {parts.join(' · ')}
      {view.run.outOfDate && <span className={styles.stale}> · spec has changed since</span>}
      {view.run.reports.map((r) => (
        <span key={r.label}>
          {' · '}
          <a className={styles.report} href={r.url} target="_blank" rel="noreferrer">
            {r.label}
          </a>
        </span>
      ))}
    </span>
  );
}

function RunPicker({ view }: { view: AtlasView }) {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const { latestRunId } = useAtlas();
  if (view.runs.length === 0) return null;
  const latest = view.runs.find((r) => r.id === latestRunId);
  return (
    <label className={styles.picker}>
      <span className="sr-only">Run</span>
      <select
        className={styles.select}
        value={search.run ?? LATEST}
        onChange={(e) => void navigate({ to: '.', search: (prev) => ({ ...prev, run: e.target.value === LATEST ? undefined : e.target.value }) })}
      >
        <option value={LATEST}>Latest{latest ? ` · ${formatRunTime(latest.startedAt)}` : ''}</option>
        {view.runs.map((r) => (
          <option key={r.id} value={r.id} disabled={r.progress === 'running'}>
            {formatRunTime(r.startedAt)} · {r.progress === 'running' ? 'still running' : r.mode === 'showcase' ? 'with videos' : 'quick check'}
          </option>
        ))}
      </select>
    </label>
  );
}

function JourneyBar({ view, chartId }: { view: AtlasView; chartId: string }) {
  const search = useSearch({ strict: false });
  const chart = view.charts.get(chartId);
  const related = new Set([chartId, ...(chart?.childChartIds ?? []), ...(chart?.parent ? [chart.parent.chartId] : [])]);
  const journeys = view.journeys.filter((j) => j.chartIds.some((id) => related.has(id)) && j.chartIds.includes(chartId));
  if (journeys.length === 0) return null;
  return (
    <nav className={styles.journeys} aria-label="Journeys through this chart">
      <span className={styles.journeysLabel}>Journeys</span>
      <ul className={styles.journeyList}>
        {journeys.map((j) => {
          const active = search.journey === j.id;
          return (
            <li key={j.id}>
              <Link
                to="/chart/$chartId"
                params={{ chartId }}
                search={(prev) => ({ run: prev.run, journey: active ? undefined : j.id })}
                className={styles.journey}
                data-active={active}
                aria-current={active ? 'true' : undefined}
              >
                <StatusDot status={j.status} />
                {j.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Breadcrumbs({ view, chartId }: { view: AtlasView | null; chartId: string | undefined }) {
  const chart = chartId ? view?.charts.get(chartId) : undefined;
  const context = chart ? view?.contexts.find((c) => c.id === chart.contextId) : undefined;
  const parent = chart?.parent ? view?.charts.get(chart.parent.chartId) : undefined;
  return (
    <nav className={styles.crumbs} aria-label="Where you are">
      <Link to="/" search={(prev) => ({ run: prev.run })} className={styles.home}>
        {view?.title ?? 'Atlas'}
      </Link>
      {context && (
        <>
          <ChevronIcon size={12} className={styles.sep} />
          <span className={styles.crumb}>{context.name}</span>
        </>
      )}
      {parent && (
        <>
          <ChevronIcon size={12} className={styles.sep} />
          <Link to="/chart/$chartId" params={{ chartId: parent.id }} search={(prev) => ({ run: prev.run })} className={styles.crumbLink}>
            {parent.name}
          </Link>
        </>
      )}
      {chart && (
        <>
          <ChevronIcon size={12} className={styles.sep} />
          <span className={styles.crumbCurrent} aria-current="page">
            {chart.name}
          </span>
        </>
      )}
    </nav>
  );
}

export function Header() {
  const { view } = useAtlas();
  const params = useParams({ strict: false });
  const chartId = params.chartId;
  const chart = chartId ? view?.charts.get(chartId) : undefined;
  const counts = chart
    ? { screens: chart.screens, events: chart.events, journeys: summarize(view!, chart.journeyIds) }
    : view?.totals ?? { screens: emptyCounts(), events: emptyCounts(), journeys: emptyCounts() };
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <Breadcrumbs view={view} chartId={chartId} />
        <RunMeta view={view} />
      </div>
      <div className={styles.summaries} aria-label="Summary">
        {view ? (
          <>
            <SummaryBar noun="screen" nounPlural="screens" counts={counts.screens} verb="working" />
            <SummaryBar noun="event" nounPlural="events" counts={counts.events} verb="exercised" />
            <SummaryBar noun="journey" nounPlural="journeys" counts={counts.journeys} verb="passed" />
          </>
        ) : (
          <>
            <span className={styles.summarySkeleton} />
            <span className={styles.summarySkeleton} />
            <span className={styles.summarySkeleton} />
          </>
        )}
      </div>
      <div className={styles.tools}>
        {view && <RunPicker view={view} />}
        {view && <DataIssues issues={view.issues} />}
      </div>
      {view && chartId && <JourneyBar view={view} chartId={chartId} />}
    </header>
  );
}

function summarize(view: AtlasView, journeyIds: string[]) {
  const counts = emptyCounts();
  for (const j of view.journeys) {
    if (!journeyIds.includes(j.id)) continue;
    counts[j.status]++;
    counts.total++;
  }
  return counts;
}
