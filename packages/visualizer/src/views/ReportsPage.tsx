import { Link, useSearch } from '@tanstack/react-router';

import { useAtlas } from '../app/atlas-context';
import { formatRunTime } from '../components/Header';
import { ChevronIcon, ExternalIcon } from '../components/icons';
import { StatusBadge, SummaryBar } from '../components/Status';
import styles from './application.module.css';

function duration(ms: number | null | undefined) {
  if (ms === undefined || ms === null) return '—';
  return ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function ReportsPage() {
  const { view, reports, sources, run, runs, refresh } = useAtlas();
  const search = useSearch({ strict: false });
  const query = search.q?.toLowerCase().trim() ?? '';
  const filtered = reports.filter(
    (report) =>
      (!search.source || report.sourceId === search.source) &&
      (!search.phase || (report.progress ?? 'complete') === search.phase) &&
      `${report.nativeId} ${report.sourceLabel} ${report.branch ?? ''} ${report.commit ?? ''}`.toLowerCase().includes(query)
  );
  const current = view?.run;
  const running = reports.filter((report) => report.progress === 'running').length;
  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <span className={styles.eyebrow}>EVIDENCE AS IT ARRIVES</span>
        <h1>
          Reports <span className={styles.headingCount}>{reports.length}</span>
        </h1>
        <p>Browse finished runs and follow work in progress across all connected backends.</p>
      </div>
      <div className={styles.reportStats}>
        <span>
          <strong>{running}</strong> in progress
        </span>
        <span>
          <strong>{reports.length - running}</strong> complete
        </span>
        <span>
          <strong>{sources.filter((source) => source.enabled).length}</strong> connected sources
        </span>
      </div>
      <div className={styles.reportFilters}>
        <Link to="/runs" replace search={(prev) => ({ ...prev, phase: undefined })} data-active={!search.phase}>
          All reports
        </Link>
        <Link to="/runs" replace search={(prev) => ({ ...prev, phase: 'running' })} data-active={search.phase === 'running'}>
          In progress
        </Link>
        <Link to="/runs" replace search={(prev) => ({ ...prev, phase: 'complete' })} data-active={search.phase === 'complete'}>
          Complete
        </Link>
        <div className={styles.reportSourceFilters}>
          {sources
            .filter((source) => source.enabled)
            .map((source) => (
              <Link
                key={source.id}
                to="/runs"
                replace
                search={(prev) => ({ ...prev, source: prev.source === source.id ? undefined : source.id })}
                data-active={search.source === source.id}
              >
                {source.label}
              </Link>
            ))}
        </div>
      </div>
      {runs.error && (
        <div className={styles.warning} role="status">
          One or more report sources are unavailable. Available reports remain visible.{' '}
          <Link to="/sources" search={(prev) => ({ run: prev.run })}>
            Inspect sources
          </Link>
        </div>
      )}
      {runs.loading && !reports.length ? (
        <p className={styles.empty} role="status">
          Looking for reports…
        </p>
      ) : !filtered.length ? (
        <div className={styles.empty}>
          <h2>{reports.length ? 'No reports match these filters' : 'Your product map is ready for evidence'}</h2>
          <p>
            {reports.length
              ? 'Choose another source or report state.'
              : 'Run Atlas against your product or connect a report source. Screens and journeys are available from the spec now.'}
          </p>
          <Link to="/sources" search={(prev) => ({ run: prev.run })}>
            Manage sources
            <ChevronIcon />
          </Link>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.reportTable}>
            <thead>
              <tr>
                <th>Report</th>
                <th>Source</th>
                <th>State</th>
                <th>Progress</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((report) => (
                <tr key={report.id} data-selected={run.id === report.id}>
                  <td>
                    <Link to="/runs" search={(prev) => ({ ...prev, run: report.id })}>
                      {formatRunTime(report.startedAt)}
                      <ChevronIcon />
                    </Link>
                    <small>
                      {report.branch ?? report.nativeId}
                      {report.commit && ` · ${report.commit.slice(0, 7)}`}
                    </small>
                  </td>
                  <td>{report.sourceLabel}</td>
                  <td>
                    <span className={report.progress === 'running' ? styles.runningPill : styles.completePill}>
                      {report.progress === 'running' ? 'In progress' : 'Complete'}
                    </span>
                  </td>
                  <td>
                    {report.execution
                      ? `${report.execution.completedPaths}/${report.execution.totalPaths} paths`
                      : report.coverage?.states
                        ? `${report.coverage.states.passed}/${report.coverage.states.total} states`
                        : 'Awaiting evidence'}
                  </td>
                  <td>{duration(report.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {run.waiting && (
        <div className={styles.empty} role="status">
          <h2>This report is starting</h2>
          <p>The first snapshot will appear here as soon as it arrives.</p>
        </div>
      )}
      {run.error && (
        <div className={styles.warning} role="alert">
          {run.error}{' '}
          <button type="button" onClick={refresh}>
            Try again
          </button>
        </div>
      )}
      {current && (
        <section className={styles.runDetail} aria-label="Selected report">
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.eyebrow}>{run.summary?.sourceLabel ?? 'SELECTED REPORT'}</span>
              <h2>{formatRunTime(current.info.startedAt)}</h2>
              <p>
                {current.info.mode === 'showcase' ? 'Showcase with recordings' : 'Fast check'} · {current.info.branch ?? 'Unknown branch'} ·{' '}
                {duration(current.info.durationMs)}
              </p>
            </div>
            <Link to="/" search={{ run: current.id }}>
              View on product map
              <ChevronIcon />
            </Link>
          </div>
          {current.info.progress && (
            <div className={styles.runProgress}>
              <progress
                aria-label="Paths completed"
                max={Math.max(1, current.info.progress.totalPaths)}
                value={current.info.progress.completedPaths}
              />
              <span>
                {current.info.progress.completedPaths} of {current.info.progress.totalPaths} paths checked
                {current.progress === 'running' ? ' · still running' : ''}
              </span>
            </div>
          )}
          <div className={styles.runHealth}>
            <SummaryBar noun="screen" nounPlural="screens" counts={view.totals.screens} verb="working" />
            <SummaryBar noun="event" nounPlural="events" counts={view.totals.events} verb="exercised" />
            <SummaryBar noun="journey" nounPlural="journeys" counts={view.totals.journeys} verb="passed" />
          </div>
          {current.outOfDate && (
            <p className={styles.warning}>The spec has changed since this report. Some results no longer match the product map.</p>
          )}
          {current.privacyPassed === false && (
            <p className={styles.warning}>This report failed its privacy check and will be excluded from published data.</p>
          )}
          <div className={styles.reportDownloads}>
            {current.reports.map((report) => (
              <a key={report.label} href={report.url} target="_blank" rel="noreferrer">
                {report.label}
                <ExternalIcon />
              </a>
            ))}
          </div>
          <h3 className={styles.sectionLabel}>Paths in this report</h3>
          <div className={styles.pathList}>
            {current.paths.map((path) => (
              <details key={path.id} className={styles.path}>
                <summary>
                  <span className={styles.pathName}>
                    {path.name}
                    <small>
                      {path.seed ? `From ${path.seed}` : 'From the start'} · {path.steps} steps checked
                    </small>
                  </span>
                  {path.progress === 'running' ? (
                    <span className={styles.runningPill}>Running</span>
                  ) : path.progress === 'queued' ? (
                    <span className={styles.completePill}>Queued</span>
                  ) : (
                    <StatusBadge status={path.status} />
                  )}
                </summary>
                <div className={styles.pathBody}>
                  {path.error ? (
                    <p>{path.error}</p>
                  ) : (
                    <p>
                      {path.progress === 'queued'
                        ? 'This path has not started yet.'
                        : path.progress === 'running'
                          ? 'Evidence updates after each reached screen and completed step.'
                          : `Checked in ${duration(path.durationMs)}.`}
                    </p>
                  )}
                  {path.stoppedAt && <p>Stopped at {path.stoppedAt}</p>}
                  {path.traces.map((trace) => (
                    <a key={`${trace.label}-${trace.url}`} href={trace.url} target="_blank" rel="noreferrer">
                      Download trace: {trace.label}
                    </a>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
