import { List } from '@mantine/core';
import { lazy, Suspense, useState } from 'react';
import { Panel } from '../components/Page';
import type { AtlasView } from '../data/model';
import { CheckDetail, ResultRow, type CheckSelection } from '../evidence/check-detail';
import { useEvidence } from '../evidence/evidence-context';
import { Bounded } from '../evidence/marks';
import { TestFilter, useRunningFilter } from '../evidence/test-filter';
import { outlinePath } from '../spec-kind';
const RecordingPage = lazy(() => import('../evidence/recording-page').then((module) => ({ default: module.RecordingPage })));
/** Statechart test reports stay in the chart, including while their recordings are still arriving. */
export function ChartTests({ view, chartId }: { view: AtlasView; chartId: string }) {
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
  const slots = [...files].flatMap((file) => evidence.view.specs.get(file)?.slots ?? []);
  const visible = slots.filter((slot) => !runningOnly || slot.status === 'running');
  if (!slots.length) return null;
  return (
    <Panel aria-label="Chart tests" component="section" title="Tests" description="What the recorded tests of this chart say.">
      <TestFilter slots={slots} />
      <List spacing="xs" listStyleType="none">
        <Bounded items={visible} size={40} more="More tests">
          {(slot) => (
            <ResultRow
              key={slot.key}
              label={slot.title}
              slot={slot}
              open={selectedKey === slot.key}
              onToggle={() => {
                setSelectedKey(selectedKey === slot.key ? null : slot.key);
                setSelection({ check: slot.id });
                setRecording(false);
                setMoment(null);
              }}
            >
              {recording ? (
                <Suspense fallback={<p role="status">Loading the recording…</p>}>
                  <RecordingPage
                    slot={slot}
                    layerId={selection.layer}
                    label={slot.title}
                    back="Test report"
                    moment={moment}
                    onMoment={setMoment}
                    onClose={() => setRecording(false)}
                  />
                </Suspense>
              ) : (
                <CheckDetail
                  slot={slot}
                  layerId={selection.layer}
                  reads="steps"
                  select={(patch) => {
                    setSelection({ check: patch.check ?? slot.id, layer: patch.layer ?? undefined });
                    if (patch.view === 'recording') {
                      setRecording(true);
                      setMoment(null);
                    }
                  }}
                />
              )}
            </ResultRow>
          )}
        </Bounded>
      </List>
    </Panel>
  );
}
