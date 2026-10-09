import * as Popover from '@radix-ui/react-popover';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';

import { useAtlas } from '../app/atlas-context';
import { emptyCounts, type AtlasView } from '../data/model';
import { LATEST } from '../data/queries';
import { DataIssues } from './DataIssues';
import styles from './Header.module.css';
import { CheckIcon, ChevronDownIcon, ChevronIcon, ExternalIcon } from './icons';
import { SummaryBar } from './Status';

const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function formatRunTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unknown time' : dateTime.format(d);
}

function minutes(ms: number | undefined) {
  if (!ms) return null;
  const m = Math.round(ms / 60_000);
  return m < 1 ? 'Under a minute' : `${m} min`;
}

function AtlasMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" />
      <path d="M7.5 7.5 16.5 12 7.5 16.5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="7.5" cy="7.5" r="2.4" fill="#fff" />
      <circle cx="16.5" cy="12" r="2.4" fill="#fff" />
      <circle cx="7.5" cy="16.5" r="2.4" fill="#fff" />
    </svg>
  );
}

function runLabel(view: AtlasView | null, loading: { run: boolean; runs: boolean }) {
  if (!view) return 'Loading the spec…';
  if (loading.run) return 'Loading the run…';
  if (!view.run) return loading.runs ? 'Looking for runs…' : view.runs.length ? 'Waiting for results…' : 'Not run yet';
  return formatRunTime(view.run.info.startedAt);
}

/** The run being shown, what it was, and every other run to switch to. */
function RunMenu({ view }: { view: AtlasView | null }) {
  const { run, runs, reports, latestRunId } = useAtlas();
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const label = runLabel(view, { run: run.loading, runs: runs.loading });
  const current = view?.run;
  const selected = search.run ? run.id ?? search.run : LATEST;
  const latest = view?.runs.find((r) => r.id === latestRunId);
  const choose = (id: string) => void navigate({ to: '.', search: (prev) => ({ ...prev, run: id === LATEST ? undefined : id }) });
  const info = current?.info;
  const rows: [string, string | null | undefined][] = info
    ? [
        ['Checked', formatRunTime(info.startedAt)],
        ['Took', minutes(info.durationMs)],
        ['Recording', info.mode === 'showcase' ? 'With videos' : 'Quick check'],
        ['Branch', info.branch],
        ['Commit', info.commit?.slice(0, 7)],
        ['Source', run.summary?.sourceLabel]
      ]
    : [];
  return (
    <Popover.Root>
      <Popover.Trigger className={styles.runTrigger} data-stale={Boolean(current?.outOfDate)} disabled={!view}>
        <span className={styles.runCaption}>{current ? (selected === LATEST ? 'Latest run' : 'Run') : 'Runs'}</span>
        <span className={styles.runValue}>{label}</span>
        {current?.outOfDate && <span className={styles.staleDot} aria-label="The spec has changed since this run" />}
        <ChevronDownIcon size={13} className={styles.runChevron} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={styles.runPop} align="end" sideOffset={8} collisionPadding={12}>
          {info ? (
            <section className={styles.runDetails} aria-label="This run">
              <dl>
                {rows
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
              </dl>
              {current.outOfDate && <p className={styles.stale}>The spec has changed since this run, so some results may not match the map.</p>}
              {current.reports.length > 0 && (
                <div className={styles.reports}>
                  {current.reports.map((r) => (
                    <a key={r.label} href={r.url} target="_blank" rel="noreferrer">
                      {r.label}
                      <ExternalIcon size={12} />
                    </a>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <p className={styles.runEmpty}>
              {view?.runs.length ? 'This report is starting. Screens and results appear as they arrive.' : 'Everything on the map comes from the spec. Run Atlas against the app to fill in screenshots and results.'}
            </p>
          )}
          {view && view.runs.length > 0 && (
            <div className={styles.runList} role="radiogroup" aria-label="Choose a run">
              <button type="button" role="radio" aria-checked={selected === LATEST} onClick={() => choose(LATEST)}>
                <span>
                  Always show the latest
                  {latest && <small>{formatRunTime(latest.startedAt)}</small>}
                </span>
                {selected === LATEST && <CheckIcon size={14} />}
              </button>
              {reports.map((r) => (
                <button key={r.id} type="button" role="radio" aria-checked={selected === r.id} onClick={() => choose(r.id)}>
                  <span>
                    {formatRunTime(r.startedAt)}
                    <small>{r.sourceLabel} · {r.progress === 'running' ? 'Still running' : r.mode === 'showcase' ? 'With videos' : 'Quick check'}</small>
                  </span>
                  {selected === r.id && <CheckIcon size={14} />}
                </button>
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Breadcrumbs({ view, chartId }: { view: AtlasView | null; chartId: string | undefined }) {
  const chart = chartId ? view?.charts.get(chartId) : undefined;
  const context = chart ? view?.contexts.find((c) => c.id === chart.contextId) : undefined;
  const parent = chart?.parent ? view?.charts.get(chart.parent.chartId) : undefined;
  return (
    <nav className={styles.crumbs} aria-label="Where you are">
      <Link to="/" search={(prev) => ({ run: prev.run })} className={styles.home} aria-current={chart ? undefined : 'page'}>
        <AtlasMark />
        <span>{view?.title ?? 'Atlas'}</span>
      </Link>
      {context && (
        <>
          <ChevronIcon size={11} className={styles.sep} />
          <span className={styles.crumb}>{context.name}</span>
        </>
      )}
      {parent && (
        <>
          <ChevronIcon size={11} className={styles.sep} />
          <Link to="/chart/$chartId" params={{ chartId: parent.id }} search={(prev) => ({ run: prev.run })} className={styles.crumbLink}>
            {parent.name}
          </Link>
        </>
      )}
      {chart && (
        <>
          <ChevronIcon size={11} className={styles.sep} />
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
    : (view?.totals ?? { screens: emptyCounts(), events: emptyCounts(), journeys: emptyCounts() });
  return (
    <header className={styles.header}>
      <Breadcrumbs view={view} chartId={chartId} />
      <div className={styles.health} aria-label={chart ? `Health of ${chart.name}` : 'Health of the product'}>
        {view ? (
          <>
            <SummaryBar variant="inline" noun="screen" nounPlural="screens" counts={counts.screens} verb="working" />
            <SummaryBar variant="inline" noun="event" nounPlural="events" counts={counts.events} verb="exercised" />
            <SummaryBar variant="inline" noun="journey" nounPlural="journeys" counts={counts.journeys} verb="passed" />
          </>
        ) : (
          <>
            <span className={styles.healthSkeleton} />
            <span className={styles.healthSkeleton} />
            <span className={styles.healthSkeleton} />
          </>
        )}
      </div>
      <div className={styles.tools}>
        <RunMenu view={view} />
        {view && <DataIssues issues={view.issues} />}
      </div>
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
