import type { BackendInfo, LayerHeader, StatusCounts } from '@crvouga/atlas/reports/evidence-types';
import type { SpecStatus, SpecSummary } from '@crvouga/atlas/reports/evidence-view';
import { useState, type ReactNode } from 'react';

import styles from './evidence.module.css';
import { ago, exactTime, plural, shortSha, statusWord } from './format';

/** The outcome as a small mark. Its word is always available to a screen reader. */
export function StatusMark({ status, size = 16 }: { status: SpecStatus; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 16 16', className: styles.mark, 'data-status': status, role: 'img', 'aria-label': statusWord(status) } as const;
  if (status === 'passed') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path d="M4.7 8.3l2.2 2.2 4.4-4.7" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === 'failed') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === 'running') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={status === 'none' ? '2.2 2.2' : undefined} />
    </svg>
  );
}

/** What was recorded for a spec, short enough for an index row. */
export function Tally({ summary }: { summary: SpecSummary }) {
  if (summary.status === 'none') return <span className={styles.tally} data-status="none">No results</span>;
  if (summary.counts.failed) return <span className={styles.tally} data-status="failed">{summary.counts.failed} failed</span>;
  if (summary.counts.running) return <span className={styles.tally} data-status="running">Running</span>;
  if (!summary.counts.passed) return <span className={styles.tally} data-status="not-run">Not run</span>;
  return <span className={styles.tally} data-status="passed">{summary.counts.passed === summary.total ? `${summary.total} passed` : `${summary.counts.passed}/${summary.total}`}</span>;
}

const SEGMENTS = ['failed', 'running', 'passed', 'not-run'] as const;

/** Proportions of the recorded outcomes. With nothing recorded it is an empty track. */
export function Meter({ counts, missing = 0 }: { counts: StatusCounts; missing?: number }) {
  const total = SEGMENTS.reduce((sum, status) => sum + counts[status], 0) + missing;
  return (
    <span className={styles.meter} aria-hidden="true">
      {total > 0 && SEGMENTS.map((status) => counts[status] > 0 && <span key={status} data-status={status} style={{ flexGrow: counts[status] }} />)}
      {total > 0 && missing > 0 && <span data-status="none" style={{ flexGrow: missing }} />}
    </span>
  );
}

export function CountLine({ summary, noun, nouns }: { summary: SpecSummary; noun: string; nouns: string }) {
  if (summary.status === 'none') return <span>No {nouns} recorded yet</span>;
  const parts = [
    summary.counts.failed ? <strong key="failed" className={styles.failedText}>{summary.counts.failed} failed</strong> : null,
    summary.counts.passed ? <span key="passed">{summary.counts.passed} passed</span> : null,
    summary.counts.running ? <span key="running">{summary.counts.running} running</span> : null,
    summary.counts['not-run'] ? <span key="not-run">{summary.counts['not-run']} not run</span> : null
  ].filter(Boolean);
  return (
    <span className={styles.countLine}>
      <span>{plural(summary.total, noun, nouns)}</span>
      {parts}
    </span>
  );
}

export function backendLabel(backends: readonly BackendInfo[], id: string) {
  return backends.find((backend) => backend.id === id)?.label ?? id;
}

/** Where and when a result was recorded. A modified checkout is stated, not raised as an alarm. */
export function Origin({ layer, backends, now }: { layer: LayerHeader; backends: readonly BackendInfo[]; now: number }) {
  const sha = shortSha(layer.sha);
  return (
    <span className={styles.origin}>
      {layer.live && <span className={styles.liveTag}>Running now</span>}
      <span>{backendLabel(backends, layer.backend)}</span>
      {layer.branch && <span>{layer.branch}</span>}
      {sha && <code>{sha}</code>}
      {layer.freshness === 'modified' && <span>with local changes</span>}
      {layer.freshness === 'unknown' && <span>origin not captured</span>}
      {!layer.live && <time dateTime={new Date(layer.recordedAtMs).toISOString()} title={exactTime(layer.recordedAtMs)}>{ago(layer.recordedAtMs, now)}</time>}
      {Object.entries(layer.parameters).map(([name, value]) => (
        <span key={name} className={styles.param}>{name}: {value}</span>
      ))}
    </span>
  );
}

/** A long list in pages, so the page stays light however much has been recorded. */
export function Bounded<T>({ items, size, more, children }: { items: readonly T[]; size: number; more: string; children: (item: T, index: number) => ReactNode }) {
  const [shown, setShown] = useState(size);
  return (
    <>
      {items.slice(0, shown).map(children)}
      {items.length > shown && (
        <li className={styles.moreRow}>
          <button type="button" className={styles.quiet} onClick={() => setShown(shown + size)}>
            {more} ({items.length - shown} more)
          </button>
        </li>
      )}
    </>
  );
}
