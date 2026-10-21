/**
 * @module Test detail
 *
 * One test, opened beside the list: what it is (spec, domain, id), its current result in every environment, how it has
 * gone (pass rate, flips, durations, a duration trend and a strip of past outcomes), every recorded result, its tags and
 * labels, and what its current result carries (steps, screenshots, video, traces, the recording) through the same
 * evidence views as a spec page.
 */
import type { CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { formatMs, type TestResultEntry, type TestSummary } from '@crvouga/atlas/reports/test-catalog';
import { Link } from '@tanstack/react-router';
import { lazy, Suspense, useState } from 'react';

import { CheckDetail, type CheckSelection } from '../evidence/check-detail';
import { ago, exactTime, plural, shortSha, statusWord, useNow } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { useTestHistory } from './catalog';
import styles from './explorer.module.css';
import { Badges } from './parts';
import { patched } from './navigate';

const RecordingPage = lazy(() => import('../evidence/recording-page').then((module) => ({ default: module.RecordingPage })));

/** Results the history table shows before "Show more". */
const HISTORY_ROWS = 20;

function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

/** The open test. `slot` is the report's check for it, when the page holds one, for its evidence. */
export function TestDetail({ test, slot }: { test: TestSummary; slot: CheckSlot | undefined }) {
  const now = useNow();
  const history = useTestHistory(test.key);
  const [selection, setSelection] = useState<CheckSelection>({});
  const [recording, setRecording] = useState(false);
  const [moment, setMoment] = useState<number | null>(null);
  const [rows, setRows] = useState(HISTORY_ROWS);
  const entries = history.data?.history ?? [];
  const stats = test.stats;
  const d = stats.durations;

  if (recording && slot) {
    return (
      <Suspense fallback={<p className={styles.quiet} role="status">Loading the recording…</p>}>
        <RecordingPage slot={slot} layerId={selection.layer} label={test.title} back="Test detail" moment={moment} onMoment={setMoment} onClose={() => setRecording(false)} />
      </Suspense>
    );
  }

  return (
    <article className={styles.detail} aria-label={test.title}>
      <div className={styles.detailTop}>
        <Link to="/" search={patched({ test: undefined })} resetScroll={false} activeOptions={{ exact: true }} className={styles.close} aria-label="Close the test">×</Link>
      </div>
      <header className={styles.detailHead}>
        {test.spec && (
          <p className={styles.detailSpec}>
            {test.spec.domain && <Link to="/" search={patched({ domain: test.spec.domain, spec: undefined })} resetScroll={false} activeOptions={{ exact: true }}>{test.spec.domain}</Link>}
            <Link to="/" search={patched({ spec: test.spec.path, domain: undefined })} resetScroll={false} activeOptions={{ exact: true }}>{test.spec.title}</Link>
          </p>
        )}
        <h2 className={styles.detailTitle}>{test.title}</h2>
        <p className={styles.detailStatus}>
          <StatusMark status={test.status} />
          <strong data-status={test.status}>{statusWord(test.status)}</strong>
          {stats.flaky && <span className={styles.flaky} title={stats.flakyReason}>Flaky: {stats.flakyReason}</span>}
          <Badges test={test} />
        </p>
        {test.spec && <code className={styles.mono}>{test.spec.path}</code>}
        <code className={styles.mono} title="Check id">{test.id}</code>
      </header>

      <section className={styles.detailBlock} aria-label="Current results">
        <h3 className={styles.label}>Current result per environment</h3>
        {test.outcomes.length === 0 ? <p className={styles.quiet}>No completed result recorded yet.</p> : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Environment</th><th scope="col">Producer</th><th scope="col">Status</th><th scope="col">Duration</th><th scope="col">Branch</th><th scope="col">Commit</th><th scope="col">Recorded</th><th scope="col"><span className="sr-only">Run</span></th></tr></thead>
              <tbody>
                {test.outcomes.map((outcome) => (
                  <tr key={`${outcome.layer}|${outcome.producer}|${outcome.environment}|${JSON.stringify(outcome.parameters)}`} data-status={outcome.status}>
                    <td>{environmentLabel(outcome.environment)}{Object.entries(outcome.parameters).map(([name, value]) => <span key={name} className={styles.param}> {name}: {value}</span>)}</td>
                    <td>{outcome.producer}</td>
                    <td><span className={styles.cellStatus}><StatusMark status={outcome.status} size={12} />{statusWord(outcome.status)}</span></td>
                    <td className={styles.num}>{formatMs(outcome.durationMs)}</td>
                    <td className={styles.ellipsis} title={outcome.branch ?? ''}>{outcome.branch ?? '—'}</td>
                    <td><code>{shortSha(outcome.sha) ?? '—'}</code></td>
                    <td title={exactTime(outcome.at)}>{ago(outcome.at, now)}</td>
                    <td>{outcome.runUrl ? <a href={outcome.runUrl} target="_blank" rel="noreferrer">CI run</a> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.detailBlock} aria-label="Statistics">
        <h3 className={styles.label}>How it has gone</h3>
        <dl className={styles.stats}>
          <div><dt>Pass rate</dt><dd>{percent(stats.passRate)}</dd></div>
          <div><dt>Results</dt><dd>{stats.results} <span>({stats.passed} passed{stats.failed ? `, ${stats.failed} failed` : ''})</span></dd></div>
          <div><dt>Runs</dt><dd>{stats.runs}</dd></div>
          <div><dt>Flips</dt><dd>{stats.flips}</dd></div>
          <div><dt>Average</dt><dd>{formatMs(d?.avgMs)}</dd></div>
          <div><dt>p50</dt><dd>{formatMs(d?.p50Ms)}</dd></div>
          <div><dt>p95</dt><dd>{formatMs(d?.p95Ms)}</dd></div>
          <div><dt>Min – max</dt><dd>{d ? `${formatMs(d.minMs)} – ${formatMs(d.maxMs)}` : '—'}</dd></div>
          <div><dt>Last</dt><dd>{formatMs(d?.lastMs)}</dd></div>
          <div><dt>Last passed</dt><dd>{stats.lastPassedAtMs ? ago(stats.lastPassedAtMs, now) : '—'}</dd></div>
          <div><dt>Last failed</dt><dd>{stats.lastFailedAtMs ? ago(stats.lastFailedAtMs, now) : '—'}</dd></div>
          <div><dt>First seen</dt><dd>{stats.firstSeenMs ? ago(stats.firstSeenMs, now) : '—'}</dd></div>
        </dl>
        {stats.branches.length > 0 && <p className={styles.quiet}>Branches: {stats.branches.join(', ')}</p>}
        {!d && <p className={styles.quiet}>No duration recorded. Producers can send <code>durationMs</code> with each check.</p>}
        {entries.length > 1 && <Trend entries={entries} />}
      </section>

      {(test.tags.length > 0 || Object.keys(test.labels).length > 0) && (
        <section className={styles.detailBlock} aria-label="Tags and labels">
          <h3 className={styles.label}>Tags and labels</h3>
          <p className={styles.tags}>
            {test.tags.map((tag) => <Link key={tag} to="/" search={patched({ tag })} resetScroll={false} activeOptions={{ exact: true }}>{tag}</Link>)}
            {Object.entries(test.labels).map(([name, value]) => <span key={name}>{name}: {value}</span>)}
          </p>
        </section>
      )}

      <section className={styles.detailBlock} aria-label="Evidence">
        <h3 className={styles.label}>What the current result carries</h3>
        {slot ? (
          <CheckDetail
            slot={slot}
            layerId={selection.layer}
            reads="steps"
            select={(patch) => {
              setSelection({ check: patch.check ?? slot.id, layer: patch.layer ?? undefined });
              if (patch.view === 'recording') { setRecording(true); setMoment(null); }
            }}
          />
        ) : <p className={styles.quiet}>The evidence of this result is not loaded in this page.</p>}
      </section>

      <section className={styles.detailBlock} aria-label="History">
        <h3 className={styles.label}>History{entries.length ? ` · ${plural(entries.length, 'result', 'results')}` : ''}</h3>
        {history.isPending && <p className={styles.quiet} role="status">Reading the history…</p>}
        {history.isError && <p className={styles.notice} role="alert">The history could not be read. {history.error.message}</p>}
        {entries.length > 0 && (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Recorded</th><th scope="col">Environment</th><th scope="col">Status</th><th scope="col">Duration</th><th scope="col">Branch</th><th scope="col">Commit</th><th scope="col">Detail</th></tr></thead>
              <tbody>
                {entries.slice(0, rows).map((entry) => (
                  <tr key={`${entry.layer}|${entry.kind}|${entry.producer}|${entry.environment}|${JSON.stringify(entry.parameters)}`} data-status={entry.status}>
                    <td title={exactTime(entry.at)}>{entry.runUrl ? <a href={entry.runUrl} target="_blank" rel="noreferrer">{ago(entry.at, now)}</a> : ago(entry.at, now)}</td>
                    <td>{environmentLabel(entry.environment)}</td>
                    <td><span className={styles.cellStatus}><StatusMark status={entry.status} size={12} />{statusWord(entry.status)}</span></td>
                    <td className={styles.num}>{formatMs(entry.durationMs)}</td>
                    <td className={styles.ellipsis} title={entry.branch ?? ''}>{entry.branch ?? '—'}</td>
                    <td><code>{shortSha(entry.sha) ?? '—'}</code></td>
                    <td className={styles.detailCell} title={entry.detail}>{entry.detail.split('\n')[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {entries.length > rows && <button type="button" className={styles.link} onClick={() => setRows(rows + HISTORY_ROWS)}>Show more ({entries.length - rows} more)</button>}
      </section>
    </article>
  );
}

/** The duration of each completed result over time, and a strip of every outcome, oldest on the left. */
function Trend({ entries }: { entries: readonly TestResultEntry[] }) {
  const oldest = [...entries].reverse();
  const timed = oldest.filter((entry) => entry.durationMs !== null && (entry.status === 'passed' || entry.status === 'failed'));
  const width = 320, height = 56, pad = 4;
  const max = Math.max(1, ...timed.map((entry) => entry.durationMs!));
  const x = (index: number) => (timed.length === 1 ? width / 2 : pad + (index * (width - 2 * pad)) / (timed.length - 1));
  const y = (ms: number) => height - pad - (ms / max) * (height - 2 * pad);
  const points = timed.map((entry, index) => `${x(index).toFixed(1)},${y(entry.durationMs!).toFixed(1)}`).join(' ');
  return (
    <div className={styles.trend}>
      {timed.length > 1 && (
        <figure className={styles.spark}>
          <figcaption>Duration over the last {plural(timed.length, 'result', 'results')} · max {formatMs(max)}</figcaption>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Durations from ${formatMs(timed[0]!.durationMs)} to ${formatMs(timed.at(-1)!.durationMs)}`} preserveAspectRatio="none">
            <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className={styles.sparkBase} />
            <polyline points={points} className={styles.sparkLine} />
            {timed.map((entry, index) => (
              <circle key={index} cx={x(index)} cy={y(entry.durationMs!)} r={entry.status === 'failed' ? 3 : index === timed.length - 1 ? 2.5 : 0} data-status={entry.status}>
                <title>{`${exactTime(entry.at)} · ${environmentLabel(entry.environment)} · ${statusWord(entry.status)} · ${formatMs(entry.durationMs)}`}</title>
              </circle>
            ))}
            {/* Wide invisible targets, so a point is easy to hover. */}
            {timed.map((entry, index) => (
              <rect key={`hit${index}`} x={x(index) - (width / timed.length) / 2} y={0} width={width / timed.length} height={height} className={styles.sparkHit}>
                <title>{`${exactTime(entry.at)} · ${environmentLabel(entry.environment)} · ${statusWord(entry.status)} · ${formatMs(entry.durationMs)}`}</title>
              </rect>
            ))}
          </svg>
        </figure>
      )}
      <div className={styles.strip} role="img" aria-label={`Outcomes, oldest first: ${oldest.map((entry) => statusWord(entry.status)).join(', ')}`}>
        {oldest.map((entry, index) => (
          <span key={index} data-status={entry.status} title={`${exactTime(entry.at)} · ${environmentLabel(entry.environment)} · ${statusWord(entry.status)}${entry.durationMs !== null ? ` · ${formatMs(entry.durationMs)}` : ''}`} />
        ))}
      </div>
    </div>
  );
}
