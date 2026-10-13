import { addSummaries, NO_EVIDENCE, type SpecSummary } from '@crvouga/atlas/reports/evidence-view';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { folderOf, outlinePath, type SpecKind } from '../spec-kind';
import { useUiStore } from '../state/ui-store';
import { useEvidence } from './evidence-context';
import styles from './evidence.module.css';
import { ago, plural, useNow } from './format';
import { backendLabel, Bounded, CountLine, Meter, StatusMark, Tally } from './marks';

/** A kind's specs at a glance: how many have results, which are failing, and what just ran. */
export function Overview({ kind }: { kind: SpecKind }) {
  const evidence = useEvidence();
  const now = useNow();
  const setFilter = useUiStore((s) => s.setResultFilter);
  const setSourcesOpen = useUiStore((s) => s.setSourcesOpen);
  const files = useMemo(() => evidence.files.filter(kind.accepts), [evidence.files, kind]);
  const rows = useMemo(() => files.map((file) => ({ file, summary: evidence.view.specs.get(outlinePath(file))?.summary ?? NO_EVIDENCE })), [files, evidence.view]);
  const total = useMemo(() => addSummaries(rows.map((row) => row.summary)), [rows]);
  const withResults = rows.filter((row) => row.summary.status !== 'none');
  const failing = rows.filter((row) => row.summary.counts.failed > 0).sort((a, b) => b.summary.counts.failed - a.summary.counts.failed);
  const recent = [...withResults].sort((a, b) => (b.summary.latestAtMs ?? 0) - (a.summary.latestAtMs ?? 0)).slice(0, 8);
  const empty = rows.length - withResults.length;
  const specRow = (row: { file: string; summary: SpecSummary }) => (
    <li key={row.file}>
      <Link to="/specs/$kind" params={{ kind: kind.id }} search={{ spec: row.file }} className={styles.listRow}>
        <StatusMark status={row.summary.status} />
        <span className={styles.listName}>
          {evidence.titleOf(row.file)}
          <span className={styles.listPath}>{folderOf(row.file)}</span>
        </span>
        <Tally summary={row.summary} />
        {row.summary.latestAtMs !== null && <span className={styles.listTime}>{ago(row.summary.latestAtMs, now)}</span>}
      </Link>
    </li>
  );
  return (
    <article className={styles.page}>
      <header className={styles.specHead}>
        <h1 className={styles.title}>{kind.label}</h1>
        <div className={styles.summary}>
          <Meter counts={total.counts} />
          <p className={styles.summaryLine}>
            <span>{plural(files.length, kind.one, kind.many)}</span>
            {evidence.ready && <span>{withResults.length} with results</span>}
            {evidence.ready && empty > 0 && <span>{empty} without</span>}
          </p>
          {total.status !== 'none' && (
            <p className={styles.summaryLine}>
              <CountLine summary={total} noun={kind.check} nouns={`${kind.check}s`} />
            </p>
          )}
        </div>
      </header>

      {evidence.unavailable && (
        <p className={styles.notice} role="alert">
          Recorded results are unavailable. {evidence.unavailable}{' '}
          <button type="button" className={styles.link} onClick={evidence.retry}>Try again</button>
        </p>
      )}
      {evidence.notices.map((notice) => (
        <p key={notice} className={styles.notice} role="status">
          {notice}{' '}
          <button type="button" className={styles.link} onClick={evidence.retry}>Try again</button>
        </p>
      ))}
      {!evidence.ready && !evidence.unavailable && <p className={styles.aside} role="status">Loading recorded results…</p>}
      {evidence.ready && evidence.pending > 0 && <p className={styles.aside} role="status">Reading {plural(evidence.pending, 'more layer', 'more layers')}…</p>}

      {evidence.active.length > 0 && (
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Running now</h2>
          <ul className={styles.list}>
            {evidence.active.map((run) => (
              <li key={run.source} className={styles.listRow}>
                <StatusMark status="running" />
                <span className={styles.listName}>{run.packageDir}</span>
                <span className={styles.tally} data-status={run.failed ? 'failed' : 'running'}>
                  {plural(run.completed, 'result', 'results')} so far{run.failed ? `, ${run.failed} failed` : ''}
                </span>
                <span className={styles.listTime}>started {ago(run.startedAtMs, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {failing.length > 0 && (
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>
            Failing <span className={styles.aside}>{plural(failing.length, kind.one, kind.many)}</span>
          </h2>
          <ul className={styles.list}>
            <Bounded items={failing} size={12} more="More failing">
              {specRow}
            </Bounded>
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Latest results</h2>
          <ul className={styles.list}>{recent.map(specRow)}</ul>
        </section>
      )}

      {evidence.ready && evidence.pending === 0 && withResults.length === 0 && !evidence.unavailable && (
        <p className={styles.aside}>
          {evidence.layers.length === 0
            ? `Nothing has been recorded yet. Results appear here as a spec run finishes each test.`
            : `None of the ${plural(evidence.layers.length, 'layer', 'layers')} in the combined report checked a ${kind.one}.`}
        </p>
      )}

      {evidence.ready && (
        <p className={styles.footLine}>
          {plural(evidence.layers.length, 'layer', 'layers')} from {evidence.backends.filter((backend) => backend.available).map((backend) => backendLabel(evidence.backends, backend.id)).join(' and ') || 'no report store'}.{' '}
          <button type="button" className={styles.link} onClick={() => setSourcesOpen(true)}>Choose sources</button>
          {empty > 0 && (
            <>
              {' · '}
              <button type="button" className={styles.link} onClick={() => setFilter('none')}>
                Show the {empty} without results
              </button>
            </>
          )}
        </p>
      )}
    </article>
  );
}
