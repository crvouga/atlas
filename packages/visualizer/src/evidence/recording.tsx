import { flattenSteps, neighborFailure, orderedUiBlobs, selectedFrame, testFrames } from '@crvouga/atlas/reports/frames';
import { performanceFrameIndex, performanceRows, type PerformanceRow } from '@crvouga/atlas/reports/performance';
import type { ReportStep, RunReport } from '@crvouga/atlas/reports/report-types';
import { Accordion, Box, Button, Code, List, NativeSelect, Progress, Stack, Tabs, Text, VisuallyHidden } from '@mantine/core';
import { useMemo, useState } from 'react';
import { reportLooks } from '../looks/collect';
import { Stage, type LookMode } from '../looks/Stage';
import { reportAssetUrl } from './api';
import { duration } from './format';
import { StatusMark } from './marks';
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
  const frame = selectedFrame(frames, {
    view: 'test',
    testId: report.meta.testId,
    params: { frame: moment === null ? '' : String(moment) }
  });
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
    <Stack gap="sm">
      {report.meta.error && (
        <Stack role="alert" gap="sm" c="red.7">
          {report.meta.error}
          {report.meta.errorStack && (
            <Accordion variant="separated" my="sm">
              <Accordion.Item value="content">
                <Accordion.Control>Where it failed</Accordion.Control>
                <Accordion.Panel>{report.meta.errorStack}</Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
        </Stack>
      )}
      <Tabs value={tab} onChange={(value) => setTab(value as typeof tab)} mb="md">
        <Tabs.List aria-label="Recording">
          <Tabs.Tab value="moments">Moments</Tabs.Tab>
          <Tabs.Tab value="timing">Timing</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {tab === 'timing' ? (
        <Timing rows={rows} canOpen={(step) => byStep.has(step)} open={jump} />
      ) : (
        <Stack gap="sm">
          <List aria-label="Recorded steps" spacing="xs" listStyleType="none" type="ordered">
            {steps.map((entry) => {
              const current = frame?.step === entry.step;
              return (
                <List.Item key={entry.index} pl={entry.depth ? 'md' : 0}>
                  <Button
                    type="button"
                    data-status={entry.step.status}
                    aria-current={current ? 'step' : undefined}
                    disabled={!byStep.has(entry.step)}
                    onClick={() => jump(entry.step)}
                    variant="light"
                  >
                    <StatusMark status={entry.step.status} size={14} />
                    <Text span inherit>
                      {entry.step.title}
                    </Text>
                    <Text span inherit c="dimmed">
                      {duration(entry.step.durationMs)}
                    </Text>
                  </Button>
                </List.Item>
              );
            })}
          </List>
          <Box aria-label="Recorded moment" component="section" mb="lg">
            {report.meta.actorIds.length > 1 && (
              <Box component="label">
                <VisuallyHidden>Person</VisuallyHidden>
                <NativeSelect value={actor} onChange={(event) => setActor(event.target.value)}>
                  <option value="all">Everyone</option>
                  {report.meta.actorIds.map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </NativeSelect>
              </Box>
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
              empty={
                extras.length > 0 ? (
                  <Text c="dimmed">This runner attached files instead of a step-by-step timeline. They are below.</Text>
                ) : (
                  <Text c="dimmed">This test recorded no picture, video, or timeline. Its steps and outcome are on the left.</Text>
                )
              }
              renderMoment={(at) => {
                const current = frames[at];
                if (!current) return null;
                const ui = orderedUiBlobs(current, test);
                const pictures = ui.filter(
                  (entry) => entry.blob && entry.blob.media !== 'video' && (actor === 'all' || entry.nodeId === actor)
                );
                const absent = ui.filter((entry) => !entry.blob && (actor === 'all' || !entry.nodeId || entry.nodeId === actor));
                const observations = current.frame.snapshots.filter(
                  (blob) =>
                    blob.media !== 'html' &&
                    blob.media !== 'png' &&
                    blob.media !== 'video' &&
                    (actor === 'all' || !blob.nodeId || blob.nodeId === actor)
                );
                return (
                  <>
                    <Text c="dimmed">
                      {current.step.status === 'failed' ? 'Failed' : 'Passed'} · at{' '}
                      {duration(Math.max(0, current.frame.capturedAtMs - report.meta.startedAtMs)) || '0 ms'}
                      {current.frame.hit && <> · acted on {current.frame.hit.path.join(' › ')}</>}
                    </Text>
                    {current.step.error && (
                      <Code role="alert" c="dimmed">
                        {current.step.error}
                      </Code>
                    )}
                    {current.step.detail && (
                      <Stack>
                        <SnapshotData text={current.step.detail} />
                      </Stack>
                    )}
                    <Stack aria-label="Recorded snapshots">
                      {pictures.map((entry) => (
                        <Snapshot
                          key={entry.blob!.file}
                          url={fileUrl(entry.blob!.file)}
                          blob={entry.blob!}
                          css={css}
                          hit={entry.stale ? null : (current.frame.hit ?? null)}
                          earlier={entry.stale}
                        />
                      ))}
                      {absent.map((entry) => (
                        <Text key={entry.nodeId} c="dimmed">
                          No picture of {entry.nodeId} had been recorded by this moment.
                        </Text>
                      ))}
                      {observations.map((blob) => (
                        <Snapshot key={blob.file} url={fileUrl(blob.file)} blob={blob} css={css} hit={null} />
                      ))}
                    </Stack>
                  </>
                );
              }}
            />
            {extras.length > 0 && (
              <Stack aria-label="Other attachments" gap="sm">
                {extras.map((artifact) => (
                  <Snapshot
                    key={artifact.file}
                    url={fileUrl(artifact.file)}
                    blob={{ name: artifact.name, media: artifact.media, file: artifact.file }}
                    css={css}
                    hit={null}
                  />
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      )}
    </Stack>
  );
}
/** Where the recorded time went. A step without a measurement is never shown as quick. */
function Timing({
  rows,
  canOpen,
  open
}: {
  rows: readonly PerformanceRow[];
  canOpen: (step: ReportStep) => boolean;
  open: (step: ReportStep) => void;
}) {
  const measured = rows.filter((row) => row.band !== 'unmeasured');
  if (!measured.length)
    return (
      <Text component="div" c="dimmed">
        Measurements are unavailable for this recording.
      </Text>
    );
  const longest = Math.max(...measured.map((row) => row.step.performance?.selfMs ?? 0), 1);
  return (
    <List aria-label="Recorded time per step" spacing="xs" listStyleType="none" type="ordered">
      {rows.map((row) => {
        const own = row.step.performance?.selfMs;
        return (
          <List.Item key={row.index} data-band={row.band}>
            <Button type="button" disabled={!canOpen(row.step)} onClick={() => open(row.step)} pl={row.depth ? 'lg' : 'sm'} variant="light">
              <Text span inherit>
                {row.step.title}
              </Text>
              {row.band === 'slow' && (
                <Text span inherit c="red.7">
                  Slow
                </Text>
              )}
              <Text aria-hidden="true" span inherit>
                <Progress value={own === undefined ? 0 : (own / longest) * 100} w="6rem" size="sm" />
              </Text>
              <Text span inherit c="dimmed">
                {own === undefined ? 'Not measured' : `${own.toFixed(1)} ms`}
              </Text>
            </Button>
          </List.Item>
        );
      })}
    </List>
  );
}
