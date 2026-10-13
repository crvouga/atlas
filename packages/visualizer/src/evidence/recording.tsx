import { flattenSteps, neighborFailure, orderedUiBlobs, selectedFrame, testFrames } from '@crvouga/atlas/reports/frames';
import { performanceFrameIndex, performanceRows, type PerformanceRow } from '@crvouga/atlas/reports/performance';
import type { ReportStep, RunReport } from '@crvouga/atlas/reports/report-types';
import { useMemo, useState } from 'react';

import { reportLooks } from '../looks/collect';
import { Stage, type LookMode } from '../looks/Stage';
import { reportAssetUrl } from './api';
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
  const [actor, setActor] = useState('all');
  const [tab, setTab] = useState<'moments' | 'timing'>('moments');
  const [mode, setMode] = useState<LookMode | null>(null);
  const test = useMemo(() => ({ report, blobs: {} }), [report]);
  const frames = useMemo(() => testFrames(test), [test]);
  const looks = useMemo(() => reportLooks(report, (file) => reportAssetUrl(fileUrl(file))), [report, fileUrl]);
  const extras = (report.artifacts ?? []).filter((artifact) => artifact.media !== 'png' && artifact.media !== 'video');
  const frame = selectedFrame(frames, { view: 'test', testId: report.meta.testId, params: { frame: moment === null ? '' : String(moment) } });
  const index = frame?.index ?? 0;
  const last = frames.length - 1;
  const go = (target: number) => {
    if (frames.length) onMoment(Math.max(0, Math.min(last, target)) + 1, true);
  };
  const steps = useMemo(() => flattenSteps(report.steps).filter((entry) => entry.step.kind !== 'quint'), [report.steps]);
  const rows = useMemo(() => performanceRows(report.steps, report.meta.performance?.slowStepMs ?? 50), [report]);
  const byStep = useMemo(() => performanceFrameIndex(rows, frames), [rows, frames]);
  const jump = (step: ReportStep) => {
    const target = byStep.get(step);
    if (!target) return;
    setMode('timeline');
    setTab('moments');
    go(target.index);
  };
  const nextFailure = () => {
    const failure = neighborFailure(frames, index, 1);
    if (failure) {
      setMode('timeline');
      go(failure.index);
    }
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
            <Stage
              looks={looks}
              prefer="timeline"
              mode={mode}
              onMode={setMode}
              moment={frames.length ? index : undefined}
              onMoment={go}
              failure={frames.some((entry) => entry.step.status === 'failed')}
              onFailure={nextFailure}
              empty={extras.length > 0
                ? <p className={styles.quietLine}>This runner attached files instead of a step-by-step timeline. They are below.</p>
                : <p className={styles.quietLine}>This test recorded no picture, video, or timeline. Its steps and outcome are on the left.</p>}
              renderMoment={(at) => {
                const current = frames[at];
                if (!current) return null;
                const ui = orderedUiBlobs(current, test);
                const pictures = ui.filter((entry) => entry.blob && entry.blob.media !== 'video' && (actor === 'all' || entry.nodeId === actor));
                const absent = ui.filter((entry) => !entry.blob && (actor === 'all' || !entry.nodeId || entry.nodeId === actor));
                const observations = current.frame.snapshots.filter((blob) => blob.media !== 'html' && blob.media !== 'png' && blob.media !== 'video' && (actor === 'all' || !blob.nodeId || blob.nodeId === actor));
                return (
                  <>
                    <p className={styles.quietLine}>
                      {current.step.status === 'failed' ? 'Failed' : 'Passed'} · at {duration(Math.max(0, current.frame.capturedAtMs - report.meta.startedAtMs)) || '0 ms'}
                      {current.frame.hit && <> · acted on {current.frame.hit.path.join(' › ')}</>}
                    </p>
                    {current.step.error && <pre className={styles.error} role="alert">{current.step.error}</pre>}
                    {current.step.detail && (
                      <div className={styles.observed}>
                        <SnapshotData text={current.step.detail} />
                      </div>
                    )}
                    <div className={styles.pictures} aria-label="Recorded snapshots">
                      {pictures.map((entry) => (
                        <Snapshot key={entry.blob!.file} url={fileUrl(entry.blob!.file)} blob={entry.blob!} css={css} hit={entry.stale ? null : current.frame.hit ?? null} earlier={entry.stale} />
                      ))}
                      {absent.map((entry) => (
                        <p key={entry.nodeId} className={styles.quietLine}>No picture of {entry.nodeId} had been recorded by this moment.</p>
                      ))}
                      {observations.map((blob) => (
                        <Snapshot key={blob.file} url={fileUrl(blob.file)} blob={blob} css={css} hit={null} />
                      ))}
                    </div>
                  </>
                );
              }}
            />
            {extras.length > 0 && (
              <div className={styles.pictures} aria-label="Other attachments">
                {extras.map((artifact) => (
                  <Snapshot key={artifact.file} url={fileUrl(artifact.file)} blob={{ name: artifact.name, media: artifact.media, file: artifact.file }} css={css} hit={null} />
                ))}
              </div>
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
