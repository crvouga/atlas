import { lazy, Suspense, useState } from 'react';
import type { AtlasView } from '../data/model';
import { useEvidence } from '../evidence/evidence-context';
import { CheckDetail, ResultRow, type CheckSelection } from '../evidence/check-detail';
import { TestFilter, useRunningFilter } from '../evidence/test-filter';
import { Bounded } from '../evidence/marks';
import { outlinePath } from '../spec-kind';
import styles from '../evidence/evidence.module.css';

const RecordingPage = lazy(() => import('../evidence/recording-page').then(module => ({ default: module.RecordingPage })));

/** Statechart test reports stay in the chart, including while their recordings are still arriving. */
export function ChartTests({ view, chartId, compact = false }: { view: AtlasView; chartId: string; compact?: boolean }) {
  const evidence = useEvidence();
  const runningOnly = useRunningFilter();
  const [selection, setSelection] = useState<CheckSelection>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [moment, setMoment] = useState<number | null>(null);
  const files = new Set<string>();
  let chart = view.charts.get(chartId);
  while (chart && !files.has(outlinePath(chart.file))) {
    files.add(outlinePath(chart.file));
    chart = chart.parent ? view.charts.get(chart.parent.chartId) : undefined;
  }
  const slots = [...files].flatMap(file => evidence.view.specs.get(file)?.slots ?? []);
  const visible = slots.filter(slot => !runningOnly || slot.status === 'running');
  if (!slots.length) return null;
  return <section aria-label="Chart tests" className={styles.block} style={compact ? { maxHeight: '40vh', overflowY: 'auto', flexShrink: 0 } : undefined}>
    <h3 className={styles.blockTitle}>Tests</h3>
    <TestFilter slots={slots} />
    <ul className={styles.results}><Bounded items={visible} size={40} more="More tests">{slot =>
      <ResultRow key={slot.key} label={slot.title} slot={slot} open={selectedKey === slot.key}
        onToggle={() => { setSelectedKey(selectedKey === slot.key ? null : slot.key); setSelection({ check: slot.id }); setRecording(false); setMoment(null); }}>
        {recording ? <Suspense fallback={<p role="status">Loading the recording…</p>}><RecordingPage slot={slot} layerId={selection.layer} label={slot.title} back="Test report" moment={moment} onMoment={setMoment} onClose={() => setRecording(false)} /></Suspense>
          : <CheckDetail slot={slot} layerId={selection.layer} reads="steps" select={patch => {
            setSelection({ check: patch.check ?? slot.id, layer: patch.layer ?? undefined });
            if (patch.view === 'recording') { setRecording(true); setMoment(null); }
          }} />}
      </ResultRow>
    }</Bounded></ul>
  </section>;
}
