import { flattenSteps, neighborFailure, orderedUiBlobs, selectedFrame, testFrames } from '@crvouga/atlas-reports/frames';
import { performanceRows, performanceHotspots, performanceFrameIndex } from '@crvouga/atlas-reports/performance';
import type { RunReport } from '@crvouga/atlas-reports/report-types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { reportJson, reportText } from './api';
import { useReportLocation } from './location';
import { ModelTrace, recordedModelStates } from './trace';
import { Snapshot, SnapshotData } from './snapshot';

export function Recording({ sha, source, id, layer }: { sha: string; source: string; id: string; layer?: string }) {
  const base = layer ? `/layers/${layer}/tests/${encodeURIComponent(id)}` : `/${sha}/tests/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
  const report = useQuery({ queryKey: ['evidence-test', base], queryFn: ({ signal }) => reportJson<RunReport>(layer ? `${base}/report.json` : base, signal), retry: false });
  const css = useQuery({ queryKey: ['evidence-css', layer ?? sha], queryFn: ({ signal }) => reportText(layer ? `/layers/${layer}/frame.css` : `/${sha}/frame.css`, signal), retry: false });
  return <section aria-label="Recorded test">
    {report.isPending && <p>Loading recorded test…</p>}
    {report.isError && <p role="alert">{String(report.error)} <button onClick={() => void report.refetch()}>Try again</button></p>}
    {css.isError && <p role="alert">The recorded stylesheet could not be loaded. <button onClick={() => void css.refetch()}>Try again</button></p>}
    {report.data && <Timeline report={report.data} base={base} css={css.data ?? ''} />}
  </section>;
}
export function Timeline({ report, base, css }: { report: RunReport; base: string; css: string }) {
  const [location, updateLocation] = useReportLocation();
  const [playing, setPlaying] = useState(false);
  const [actor, setActor] = useState('all');
  const test = useMemo(() => ({ report, blobs: {} }), [report]);
  const frames = useMemo(() => testFrames(test), [test]);
  const frame = selectedFrame(frames, { view: 'test', testId: report.meta.testId, params: { frame: location.moment ?? '' } });
  const index = frame?.index ?? 0;
  const setIndex = (value: number | ((current: number) => number)) => updateLocation({ moment: String((typeof value === 'function' ? value(index) : value) + 1) }, true);
  const steps = useMemo(() => flattenSteps(report.steps), [report.steps]);
  const modelStates = useMemo(() => recordedModelStates(report.steps), [report.steps]);
  const rows = useMemo(() => performanceRows(report.steps, report.meta.performance?.slowStepMs ?? 50), [report]);
  const byStep = useMemo(() => performanceFrameIndex(rows, frames), [rows, frames]);
  useEffect(() => {
    if (!playing) return;
    if (index >= frames.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex(value => Math.min(frames.length - 1, value + 1)), Math.max(100, Math.min(frame?.frame.durationMs ?? 500, 2000)));
    return () => clearTimeout(timer);
  }, [playing, index, frames.length, frame]);
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !frames.length) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input, textarea, select, button'))) return;
      const target = event.key === 'ArrowRight' ? Math.min(frames.length - 1, index + 1)
        : event.key === 'ArrowLeft' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? frames.length - 1 : null;
      if (target !== null) { event.preventDefault(); setPlaying(false); setIndex(target); }
    };
    window.addEventListener('keydown', navigate);
    return () => window.removeEventListener('keydown', navigate);
  }, [index, frames.length, updateLocation]);
  const ui = frame ? orderedUiBlobs(frame, test) : [];
  const blobs = [...ui.flatMap(entry => entry.blob ? [entry.blob] : []), ...(frame?.frame.snapshots.filter(blob => blob.media !== 'html' && blob.media !== 'png') ?? [])];
  const jump = (step: typeof steps[number]['step']) => { const target = byStep.get(step); if (target) setIndex(target.index); };
  return <section>
    <h3>{report.meta.title}</h3><p data-status={report.meta.status}>{report.meta.status} · {report.meta.runtime} · seed {report.meta.seed} · {report.meta.sourceFile}</p>
    {report.meta.error && <pre role="alert">{report.meta.error}{'\n'}{report.meta.errorStack}</pre>}
    <div className="report-controls"><button disabled={!frames.length} onClick={() => { if (!playing && index === frames.length - 1) setIndex(0); setPlaying(value => !value); }}>{playing ? 'Pause' : 'Play'}</button><button disabled={index === 0} onClick={() => setIndex(value => Math.max(0, value - 1))}>Previous moment</button><button disabled={index >= frames.length - 1} onClick={() => setIndex(value => Math.min(frames.length - 1, value + 1))}>Next moment</button><button onClick={() => { const failure = neighborFailure(frames, index, 1); if (failure) setIndex(failure.index); }}>Next failure</button>
      <label>Recorded moment<input type="range" min={0} max={Math.max(0, frames.length - 1)} value={index} onChange={event => setIndex(Number(event.target.value))} /></label>
      <label>Actor<select value={actor} onChange={event => setActor(event.target.value)}><option value="all">All actors</option>{report.meta.actorIds.map(id => <option key={id}>{id}</option>)}</select></label>
    </div>
    {!frames.length && <p>No recorded frames. The action log and outcomes remain available.</p>}
    {frame && <><h4>Moment {index + 1} / {frames.length}: {frame.step.title}</h4><p>{frame.frame.capturedAtMs} ms · {frame.step.status}</p>{frame.step.error && <pre role="alert">{frame.step.error}</pre>}{frame.step.detail && <SnapshotData text={frame.step.detail} />}{frame.frame.hit && <p>Gesture target: {frame.frame.hit.path.join(' → ')}</p>}</>}
    <div className="report-frames">{blobs.filter(blob => actor === 'all' || !blob.nodeId || blob.nodeId === actor).map(blob => <div key={blob.file}>{ui.find(entry => entry.blob === blob)?.stale && <p>Last earlier snapshot for this actor</p>}<Snapshot base={base} blob={blob} css={css} hit={frame?.frame.hit ?? null} /></div>)}</div>
    {modelStates.length > 0 && <details open><summary>Recorded model states</summary><ModelTrace states={modelStates.map(entry => entry.state)} onSelect={index => { const entry = modelStates[index]; if (entry) jump(entry.step); }} /></details>}
    <details><summary>Performance heatmap and hotspots</summary><p>Measured execution time is separate from virtual time and snapshot capture.</p>
      <div className="report-heatmap">{rows.map(row => <button key={row.index} data-slow={row.band === 'slow'} onClick={() => jump(row.step)}>{row.step.title}: {row.step.performance ? `${row.step.performance.selfMs.toFixed(2)} ms` : 'unmeasured'}</button>)}</div>
      <ol>{performanceHotspots(rows).slice(0, 20).map(row => <li key={row.index}><button onClick={() => jump(row.step)}>{row.step.title} · {row.step.performance?.selfMs.toFixed(2)} ms</button></li>)}</ol>
    </details>
    <details open><summary>Scenario and action log</summary><ol>{steps.map(entry => <li key={entry.index}><button data-status={entry.step.status} onClick={() => jump(entry.step)}>{entry.step.kind} · {entry.step.title} · {entry.step.status}</button>{entry.step.detail && <pre>{entry.step.detail}</pre>}{entry.step.error && <pre role="alert">{entry.step.error}</pre>}</li>)}</ol></details>
  </section>;
}
