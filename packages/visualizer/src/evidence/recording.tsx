import { flattenSteps, neighborFailure, orderedUiBlobs, selectedFrame, testFrames } from '@crvouga/atlas/reports/frames';
import { performanceFrameIndex, performanceRows, type PerformanceRow } from '@crvouga/atlas/reports/performance';
import type { ReportStep, RunReport } from '@crvouga/atlas/reports/report-types';
import { useEffect, useMemo, useRef, useState } from 'react';

import { duration } from './format';
import { StatusMark } from './marks';
import styles from './recording.module.css';
import { Snapshot, SnapshotData } from './snapshot';

type Props = {
  report: RunReport;
  /** Where a captured file of this test is read from. */
  fileUrl: (file: string) => string;
  css: string;
  /** The moment the address names, counted from one. Without it the recording opens at its first failure, or its end. */
  moment: number | null;
  onMoment: (moment: number, replace: boolean) => void;
};

/** A recorded test, one captured moment at a time. */
export function Timeline({ report, fileUrl, css, moment, onMoment }: Props) {
  const [playing, setPlaying] = useState(false);
  const [actor, setActor] = useState('all');
  const [tab, setTab] = useState<'moments' | 'timing'>('moments');
  const test = useMemo(() => ({ report, blobs: {} }), [report]);
  const frames = useMemo(() => testFrames(test), [test]);
  const frame = selectedFrame(frames, { view: 'test', testId: report.meta.testId, params: { frame: moment === null ? '' : String(moment) } });
  const index = frame?.index ?? 0;
  const last = frames.length - 1;
  const go = (target: number) => {
    if (frames.length) onMoment(Math.max(0, Math.min(last, target)) + 1, true);
  };
  // Timers and key handlers outlive a render; they always move from the moment on screen.
  const goNow = useRef(go);
  goNow.current = go;
  const steps = useMemo(() => flattenSteps(report.steps).filter((entry) => entry.step.kind !== 'quint'), [report.steps]);
  const rows = useMemo(() => performanceRows(report.steps, report.meta.performance?.slowStepMs ?? 50), [report]);
  const byStep = useMemo(() => performanceFrameIndex(rows, frames), [rows, frames]);
  const jump = (step: ReportStep) => {
    const target = byStep.get(step);
    if (!target) return;
    setPlaying(false);
    setTab('moments');
    go(target.index);
  };

  const pause = frame?.frame.durationMs;
  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => goNow.current(index + 1), Math.max(100, Math.min(pause ?? 500, 2000)));
    return () => clearTimeout(timer);
  }, [playing, index, last, pause]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !frames.length) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input, textarea, select, button'))) return;
      const target = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
      if (target === null) return;
      event.preventDefault();
      setPlaying(false);
      goNow.current(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, last, frames.length]);

  const ui = frame ? orderedUiBlobs(frame, test) : [];
  const pictures = ui.filter((entry) => entry.blob && (actor === 'all' || entry.nodeId === actor));
  const absent = ui.filter((entry) => !entry.blob && (actor === 'all' || entry.nodeId === actor));
  const observations = frame?.frame.snapshots.filter((blob) => blob.media !== 'html' && blob.media !== 'png' && (actor === 'all' || !blob.nodeId || blob.nodeId === actor)) ?? [];
  const nextFailure = () => {
    const failure = neighborFailure(frames, index, 1);
    if (failure) go(failure.index);
  };

  return (
    <div className={styles.recording}>
      {report.meta.error && (
        <div className={styles.error} role="alert">
          {report.meta.error}
          {report.meta.errorStack && (
            <details>
              <summary>Where it failed</summary>
              {report.meta.errorStack}
            </details>
          )}
        </div>
      )}
      <div className={styles.tabs} role="tablist" aria-label="Recording">
        <button type="button" role="tab" aria-selected={tab === 'moments'} onClick={() => setTab('moments')}>Moments</button>
        <button type="button" role="tab" aria-selected={tab === 'timing'} onClick={() => setTab('timing')}>Timing</button>
      </div>
      {tab === 'timing' ? (
        <Timing rows={rows} canOpen={(step) => byStep.has(step)} open={jump} />
      ) : (
        <div className={styles.split}>
          <ol className={styles.steps} aria-label="Recorded steps">
            {steps.map((entry) => {
              const current = frame?.step === entry.step;
              return (
                <li key={entry.index} style={{ paddingLeft: entry.depth * 14 }}>
                  <button type="button" data-status={entry.step.status} aria-current={current ? 'step' : undefined} disabled={!byStep.has(entry.step)} onClick={() => jump(entry.step)}>
                    <StatusMark status={entry.step.status} size={14} />
                    <span className={styles.stepTitle}>{entry.step.title}</span>
                    <span className={styles.stepTime}>{duration(entry.step.durationMs)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <section className={styles.stage} aria-label="Recorded moment">
            <div className={styles.transport}>
              <button type="button" className={styles.control} disabled={!frames.length} onClick={() => { if (!playing && index === last) go(0); setPlaying((value) => !value); }}>
                {playing ? 'Pause' : 'Play'}
              </button>
              <button type="button" className={styles.control} aria-label="Previous moment" disabled={index === 0} onClick={() => go(index - 1)}>‹</button>
              <button type="button" className={styles.control} aria-label="Next moment" disabled={index >= last} onClick={() => go(index + 1)}>›</button>
              <input className={styles.scrub} type="range" aria-label="Recorded moment" min={0} max={Math.max(0, last)} value={index} disabled={frames.length < 2} onChange={(event) => { setPlaying(false); go(Number(event.target.value)); }} />
              <span className={styles.position}>{frames.length ? `Moment ${index + 1} of ${frames.length}` : 'No recorded moments'}</span>
              <button type="button" className={styles.control} disabled={!frames.some((entry) => entry.step.status === 'failed')} onClick={nextFailure}>Next failure</button>
              {report.meta.actorIds.length > 1 && (
                <label className={styles.actor}>
                  <span className="sr-only">Person</span>
                  <select value={actor} onChange={(event) => setActor(event.target.value)}>
                    <option value="all">Everyone</option>
                    {report.meta.actorIds.map((id) => (
                      <option key={id}>{id}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {!frame && <p className={styles.quietLine}>This test recorded no moments. Its steps and outcome are on the left.</p>}
            {frame && (
              <>
                <h3 className={styles.momentTitle} data-status={frame.step.status}>{frame.step.title}</h3>
                <p className={styles.quietLine}>
                  {frame.step.status === 'failed' ? 'Failed' : 'Passed'} · at {duration(Math.max(0, frame.frame.capturedAtMs - report.meta.startedAtMs)) || '0 ms'}
                  {frame.frame.hit && <> · acted on {frame.frame.hit.path.join(' › ')}</>}
                </p>
                {frame.step.error && <pre className={styles.error} role="alert">{frame.step.error}</pre>}
                {frame.step.detail && (
                  <div className={styles.observed}>
                    <SnapshotData text={frame.step.detail} />
                  </div>
                )}
                <div className={styles.pictures} aria-label="Recorded snapshots">
                  {pictures.map((entry) => (
                    <Snapshot key={entry.blob!.file} url={fileUrl(entry.blob!.file)} blob={entry.blob!} css={css} hit={entry.stale ? null : frame.frame.hit ?? null} earlier={entry.stale} />
                  ))}
                  {absent.map((entry) => (
                    <p key={entry.nodeId} className={styles.quietLine}>No picture of {entry.nodeId} had been recorded by this moment.</p>
                  ))}
                  {observations.map((blob) => (
                    <Snapshot key={blob.file} url={fileUrl(blob.file)} blob={blob} css={css} hit={null} />
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** Where the recorded time went. A step without a measurement is never shown as quick. */
function Timing({ rows, canOpen, open }: { rows: readonly PerformanceRow[]; canOpen: (step: ReportStep) => boolean; open: (step: ReportStep) => void }) {
  const measured = rows.filter((row) => row.band !== 'unmeasured');
  if (!measured.length) return <p className={styles.quietLine}>Measurements are unavailable for this recording.</p>;
  const longest = Math.max(...measured.map((row) => row.step.performance?.selfMs ?? 0), 1);
  return (
    <ol className={styles.timing} aria-label="Recorded time per step">
      {rows.map((row) => {
        const own = row.step.performance?.selfMs;
        return (
          <li key={row.index} data-band={row.band}>
            <button type="button" disabled={!canOpen(row.step)} onClick={() => open(row.step)} style={{ paddingLeft: 8 + row.depth * 14 }}>
              <span className={styles.stepTitle}>{row.step.title}</span>
              {row.band === 'slow' && <span className={styles.slow}>Slow</span>}
              <span className={styles.bar} aria-hidden="true">
                <span style={{ width: `${own === undefined ? 0 : Math.max(2, (own / longest) * 100)}%` }} />
              </span>
              <span className={styles.stepTime}>{own === undefined ? 'Not measured' : `${own.toFixed(1)} ms`}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
