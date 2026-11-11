import { flattenSteps, neighborFailure, orderedUiBlobs, selectedFrame, testFrames } from '@crvouga/atlas/reports/frames';
import { performanceFrameIndex, performanceRows, type PerformanceRow } from '@crvouga/atlas/reports/performance';
import type { ReportStep, RunReport } from '@crvouga/atlas/reports/report-types';
import { Accordion, Alert, Badge, Box, Code, Grid, Group, List, NativeSelect, NavLink, Progress, ScrollArea, Stack, Tabs, Text, Title, UnstyledButton, VisuallyHidden } from '@mantine/core';
import { IconAlertTriangle, IconClockHour4, IconListDetails, IconUser } from '@tabler/icons-react';
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
    <Stack gap="md">
      {report.meta.error && (
        <Alert role="alert" color="red" icon={<IconAlertTriangle size={18} aria-hidden="true" />}>
          <Stack gap="sm">
            <Text component="div" c="red.7" fw={500}>
              {report.meta.error}
            </Text>
            {report.meta.errorStack && (
              <Accordion variant="separated">
                <Accordion.Item value="content">
                  <Accordion.Control>Where it failed</Accordion.Control>
                  <Accordion.Panel>
                    <Code block>{report.meta.errorStack}</Code>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            )}
          </Stack>
        </Alert>
      )}
      <Tabs value={tab} onChange={(value) => setTab(value as typeof tab)}>
        <Tabs.List aria-label="Recording">
          <Tabs.Tab value="moments" leftSection={<IconListDetails size={16} aria-hidden="true" />}>
            Moments
          </Tabs.Tab>
          <Tabs.Tab value="timing" leftSection={<IconClockHour4 size={16} aria-hidden="true" />}>
            Timing
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {tab === 'timing' ? (
        <Timing rows={rows} canOpen={(step) => byStep.has(step)} open={jump} />
      ) : (
        <Grid gap="lg" align="flex-start">
          <Grid.Col span={{ base: 12, md: 4 }} order={{ base: 2, md: 1 }}>
            <Stack gap="xs">
              <Title order={3}>Steps</Title>
              <ScrollArea.Autosize mah="70vh" type="auto" offsetScrollbars="y">
                <List aria-label="Recorded steps" spacing={2} listStyleType="none" type="ordered">
                  {steps.map((entry) => {
                    const current = frame?.step === entry.step;
                    return (
                      <List.Item key={entry.index} pl={entry.depth ? 'md' : 0}>
                        <NavLink
                          renderRoot={(props) => <UnstyledButton {...props} type="button" disabled={!byStep.has(entry.step)} />}
                          data-status={entry.step.status}
                          aria-current={current ? 'step' : undefined}
                          active={current}
                          variant="light"
                          disabled={!byStep.has(entry.step)}
                          onClick={() => jump(entry.step)}
                          py={6}
                          px="xs"
                          leftSection={<StatusMark status={entry.step.status} size={14} />}
                          label={
                            <Text span inherit fw={current ? 600 : undefined}>
                              {entry.step.title}
                            </Text>
                          }
                          rightSection={
                            <Text span c="dimmed" size="xs">
                              {duration(entry.step.durationMs)}
                            </Text>
                          }
                        />
                      </List.Item>
                    );
                  })}
                </List>
              </ScrollArea.Autosize>
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 8 }} order={{ base: 1, md: 2 }}>
          <Stack aria-label="Recorded moment" component="section" gap="sm" miw={0}>
            {report.meta.actorIds.length > 1 && (
              <Box component="label" w="fit-content">
                <VisuallyHidden>Person</VisuallyHidden>
                <NativeSelect
                  value={actor}
                  onChange={(event) => setActor(event.target.value)}
                  leftSection={<IconUser size={16} aria-hidden="true" />}
                >
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
                    <Text c="dimmed" size="xs">
                      {current.step.status === 'failed' ? 'Failed' : 'Passed'} · at{' '}
                      {duration(Math.max(0, current.frame.capturedAtMs - report.meta.startedAtMs)) || '0 ms'}
                      {current.frame.hit && <> · acted on {current.frame.hit.path.join(' › ')}</>}
                    </Text>
                    {current.step.error && (
                      <Code block role="alert" c="red.7">
                        {current.step.error}
                      </Code>
                    )}
                    {current.step.detail && (
                      <Stack>
                        <SnapshotData text={current.step.detail} />
                      </Stack>
                    )}
                    <Stack role="group" aria-label="Recorded snapshots">
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
              <Stack aria-label="Other attachments" gap="sm" mt="xs">
                <Title order={3}>Other attachments</Title>
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
          </Stack>
          </Grid.Col>
        </Grid>
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
    <List aria-label="Recorded time per step" spacing={2} listStyleType="none" type="ordered">
      {rows.map((row) => {
        const own = row.step.performance?.selfMs;
        return (
          <List.Item key={row.index} data-band={row.band}>
            <NavLink
              renderRoot={(props) => <UnstyledButton {...props} type="button" disabled={!canOpen(row.step)} />}
              disabled={!canOpen(row.step)}
              onClick={() => open(row.step)}
              pl={row.depth ? 'lg' : 'xs'}
              pr="xs"
              py={6}
              label={
                <Text span inherit>
                  {row.step.title}
                </Text>
              }
              rightSection={
                <Group gap="sm" wrap="nowrap">
                  {row.band === 'slow' && (
                    <Badge color="red" size="sm">
                      Slow
                    </Badge>
                  )}
                  <Box aria-hidden="true" visibleFrom="xs">
                    <Progress value={own === undefined ? 0 : (own / longest) * 100} w="8rem" size={6} radius="xl" color={row.band === 'slow' ? 'red' : 'gray.6'} />
                  </Box>
                  <Text span c="dimmed" size="xs" miw="5rem" ta="right">
                    {own === undefined ? 'Not measured' : `${own.toFixed(1)} ms`}
                  </Text>
                </Group>
              }
            />
          </List.Item>
        );
      })}
    </List>
  );
}
