/**
 * @module Runs view
 *
 * The CI runs that produced the report, newest first: when, on which branch and commit, which environments, how many
 * tests and how they went, how long it took, and a link to the run. Opening one lists every test it ran, filterable,
 * with a way to show exactly those tests in the explorer.
 */
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { formatMs, type RunResult, type RunSummary } from '@crvouga/atlas/reports/test-catalog';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { ago, exactTime, plural, shortSha, statusWord, useNow } from '../evidence/format';
import { Meter, StatusMark } from '../evidence/marks';
import { useRunDetail, useRunList } from './catalog';
import styles from './explorer.module.css';
import { patched, useExplorerSearch } from './navigate';
import { runName } from './parts';

const RUN_ROWS = 50;
const RESULT_ROWS = 200;

/** The Runs tab: the run list, or the run opened in it. */
export function RunsView() {
  const search = useExplorerSearch();
  return search.openRun ? <RunDetailView runKey={search.openRun} /> : <RunTable />;
}

function Counts({ run }: { run: RunSummary }) {
  return (
    <span className={styles.runCounts}>
      {run.counts.failed > 0 && <strong>{run.counts.failed} failed</strong>}
      <span>{run.counts.passed} passed</span>
      {run.counts['not-run'] > 0 && <span>{run.counts['not-run']} not run</span>}
      {run.counts.running > 0 && <span data-status="running">{run.counts.running} running</span>}
    </span>
  );
}

function RunTable() {
  const runs = useRunList();
  const now = useNow();
  const [shown, setShown] = useState(RUN_ROWS);
  if (runs.isPending) return <p className={styles.quiet} role="status">Reading the runs…</p>;
  if (runs.isError) return <p className={styles.notice} role="alert">The runs could not be read. {runs.error.message}</p>;
  const list = runs.data.runs;
  if (!list.length) return <p className={styles.quiet}>No runs recorded yet.</p>;
  return (
    <section className={styles.runs} aria-label="Runs">
      <p className={styles.showing}>{runs.data.total > list.length ? `The newest ${list.length} of ${plural(runs.data.total, 'run', 'runs')}` : plural(list.length, 'run', 'runs')}</p>
      <div className={styles.tableScroll}>
        <table className={styles.table} data-runs>
          <thead>
            <tr><th scope="col">Ended</th><th scope="col">Branch</th><th scope="col">Commit</th><th scope="col">Environments</th><th scope="col">Tests</th><th scope="col">Outcomes</th><th scope="col">Span</th><th scope="col"><span className="sr-only">CI run</span></th></tr>
          </thead>
          <tbody>
            {list.slice(0, shown).map((run) => (
              <tr key={run.key} data-status={run.counts.failed ? 'failed' : 'passed'}>
                <td title={exactTime(run.endedAtMs)}><Link to="/" search={patched({ openRun: run.key })} resetScroll={false} activeOptions={{ exact: true }} aria-label={`Open run ${runName(run.key)}`}>{ago(run.endedAtMs, now)}</Link></td>
                <td className={styles.ellipsis} title={run.branch ?? ''}>{run.branch ?? '—'}</td>
                <td><code>{shortSha(run.sha) ?? '—'}</code></td>
                <td>{run.environments.map((env) => environmentLabel(env)).join(', ') || '—'}</td>
                <td className={styles.num}>{run.tests}</td>
                <td><span className={styles.runMeter}><Meter counts={run.counts} /></span><Counts run={run} /></td>
                <td className={styles.num}>{formatMs(run.spanMs)}</td>
                <td>{run.runUrl ? <a href={run.runUrl} target="_blank" rel="noreferrer">CI run</a> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > shown && <button type="button" className={styles.link} onClick={() => setShown(shown + RUN_ROWS)}>Show more ({list.length - shown} more)</button>}
    </section>
  );
}

const RESULT_FILTERS = [{ id: '', label: 'All' }, { id: 'failed', label: 'Failed' }, { id: 'passed', label: 'Passed' }, { id: 'not-run', label: 'Not run' }] as const;

function RunDetailView({ runKey }: { runKey: string }) {
  const detail = useRunDetail(runKey);
  const now = useNow();
  const [status, setStatus] = useState('');
  const [words, setWords] = useState('');
  const [shown, setShown] = useState(RESULT_ROWS);
  const results = detail.data?.results ?? [];
  const filtered = useMemo(() => {
    const terms = words.toLowerCase().split(/\s+/).filter(Boolean);
    return results.filter((result) => (!status || result.status === status) && terms.every((term) => `${result.title}\n${result.specPath ?? ''}\n${result.environment ?? ''}\n${result.producer}`.toLowerCase().includes(term)));
  }, [results, status, words]);
  const bySpec = useMemo(() => {
    const groups = new Map<string, RunResult[]>();
    for (const result of filtered.slice(0, shown)) {
      const key = result.specPath ?? '';
      const group = groups.get(key);
      if (group) group.push(result);
      else groups.set(key, [result]);
    }
    return [...groups];
  }, [filtered, shown]);
  const back = <Link to="/" search={patched({ openRun: undefined })} resetScroll={false} activeOptions={{ exact: true }} className={styles.back}><span aria-hidden="true">←</span> All runs</Link>;
  if (detail.isPending) return <>{back}<p className={styles.quiet} role="status">Reading the run…</p></>;
  if (detail.isError) return <>{back}<p className={styles.notice} role="alert">The run could not be read. {detail.error.message}</p></>;
  if (!detail.data) return <>{back}<p className={styles.notice}>That run is not in the report any more.</p></>;
  const { run } = detail.data;
  return (
    <section className={styles.runs} aria-label={`Run ${runName(run.key)}`}>
      {back}
      <h2 className={styles.runTitle}>Run {runName(run.key)}</h2>
      <p className={styles.runMeta}>
        {run.branch && <span>{run.branch}</span>}
        {run.sha && <code>{shortSha(run.sha)}</code>}
        <span title={exactTime(run.endedAtMs)}>ended {ago(run.endedAtMs, now)}</span>
        <span>took {formatMs(run.spanMs)}</span>
        {run.environments.length > 0 && <span>{run.environments.map((env) => environmentLabel(env)).join(', ')}</span>}
        <span>{run.producers.join(', ')}</span>
        {run.totalDurationMs !== null && <span>{formatMs(run.totalDurationMs)} of test time</span>}
      </p>
      <div className={styles.runSummary}>
        <span className={styles.runMeter}><Meter counts={run.counts} /></span>
        <span>{plural(run.tests, 'test', 'tests')}</span>
        <Counts run={run} />
      </div>
      <p className={styles.actionsLine}>
        <Link className={styles.primary} to="/" search={patched({ tab: undefined, openRun: undefined, inRun: run.key, test: undefined })} resetScroll={false} activeOptions={{ exact: true }}>Show these tests in the explorer</Link>
        {run.runUrl && <a href={run.runUrl} target="_blank" rel="noreferrer">Open the CI run</a>}
      </p>
      <div className={styles.searchRow}>
        <input type="search" className={styles.searchBox} aria-label="Search this run" placeholder="Search this run…" value={words} onChange={(event) => setWords(event.target.value)} />
      </div>
      <div className={styles.segments} role="group" aria-label="Result status">
        {RESULT_FILTERS.map((filter) => (
          <button key={filter.id || 'all'} type="button" aria-pressed={status === filter.id} data-status={filter.id || undefined} onClick={() => setStatus(filter.id)}>
            {filter.label} <span>{filter.id ? results.filter((result) => result.status === filter.id).length : results.length}</span>
          </button>
        ))}
      </div>
      {!filtered.length && <p className={styles.quiet}>No result matches.</p>}
      {bySpec.map(([spec, list]) => (
        <section key={spec} className={styles.group} data-open aria-label={spec || 'No spec'}>
          <div className={styles.groupHead} data-static>
            <span className={styles.groupName}><code>{spec || 'No spec'}</code></span>
            <span className={styles.groupTally}>{plural(list.length, 'result', 'results')}</span>
          </div>
          <ul className={styles.rows}>
            {list.map((result) => (
              <li key={`${result.key}|${result.environment}|${result.producer}|${result.layer}`} className={styles.row} data-status={result.status}>
                <Link to="/" search={patched({ tab: undefined, openRun: undefined, test: result.key })} resetScroll={false} activeOptions={{ exact: true }} className={styles.rowLink}>
                  <StatusMark status={result.status} size={14} />
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{result.title}</span>
                    <span className={styles.rowMeta}><span>{environmentLabel(result.environment)}</span><span>{result.producer}</span><span>{statusWord(result.status)}</span></span>
                    {result.status === 'failed' && result.detail && <span className={styles.rowError}>{result.detail.split('\n')[0]}</span>}
                  </span>
                  <span className={styles.columns} data-one><span>{formatMs(result.durationMs)}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {filtered.length > shown && <button type="button" className={styles.link} onClick={() => setShown(shown + RESULT_ROWS)}>Show more ({filtered.length - shown} more)</button>}
    </section>
  );
}
