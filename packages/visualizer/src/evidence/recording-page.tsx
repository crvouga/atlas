import { IconArrowLeft } from '@tabler/icons-react';
import { checkHistory, type CheckSlot, type HistoryEntry } from '@crvouga/atlas/reports/evidence-view';
import type { RunReport } from '@crvouga/atlas/reports/report-types';
import { Alert, Box, Button, Container, Flex, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { TestProgress, useTestProgress } from '../live/test-progress';
import { reportText } from './api';
import { useRecordedReport } from './check-detail';
import { useEvidence } from './evidence-context';
import { duration, statusWord, useNow } from './format';
import { Origin, StatusMark } from './marks';
import { Timeline } from './recording';
type Props = {
  /** The check whose recording is open, once the combined report holds it. */
  slot: CheckSlot | undefined;
  layerId: string | undefined;
  /** The exact result to play, when the caller already found it (it wins over `layerId` and the combined winner). */
  entry?: HistoryEntry | undefined;
  label: string;
  back: string;
  moment: number | null;
  onMoment: (moment: number, replace: boolean) => void;
  onClose: () => void;
};
/** HTML snapshots are the only pictures that paint with the run's stylesheet. */
function needsStylesheet(report: RunReport | undefined): boolean {
  if (!report) return false;
  const visit = (steps: RunReport['steps']): boolean => {
    for (const step of steps) {
      for (const frame of step.frames) {
        if (frame.snapshots.some((blob) => blob.media === 'html')) return true;
      }
      if (visit(step.steps)) return true;
    }
    return false;
  };
  return visit(report.steps) || (report.artifacts ?? []).some((artifact) => artifact.media === 'html');
}
/** One recorded test, opened in place of its spec. */
export function RecordingPage({ slot, layerId, entry, label, back, moment, onMoment, onClose }: Props) {
  const progress = useTestProgress(slot ?? null);
  const { evidence, backends, pending, ready, unavailable } = useEvidence();
  const now = useNow();
  const history = useMemo(() => (slot ? checkHistory(evidence, slot.specPath, slot.id) : []), [evidence, slot]);
  const winner = slot?.outcomes[0];
  const chosen: HistoryEntry | null =
    entry ??
    (layerId ? history.find((earlier) => earlier.layer.id === layerId) : undefined) ??
    (winner ? { layer: winner.layer, row: winner.row } : null);
  const { paths, report } = useRecordedReport(chosen);
  const wantsCss = needsStylesheet(report.data);
  const css = useQuery({
    queryKey: ['evidence-css', paths?.css ?? ''],
    queryFn: ({ signal }) => reportText(paths!.css, signal),
    enabled: paths !== null && wantsCss,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
  const waiting = !chosen && !unavailable && (!ready || pending > 0);
  return (
    <Container data-wide="true" aria-label="Recorded test" component="article" size="xl" w="100%" py="xl">
      <Button type="button" onClick={onClose} variant="subtle">
        <Text aria-hidden="true" span inherit>
          <IconArrowLeft size={16} aria-hidden="true" />
        </Text>{' '}
        {back}
      </Button>
      <Box component="header" mb="lg">
        <Title order={1} mb="sm">
          {label}
        </Title>
        {chosen && (
          <Flex gap="xs" align="center" wrap="wrap" c="dimmed">
            <StatusMark status={chosen.row.status} />
            <Text data-status={chosen.row.status} span inherit fw={600}>
              {statusWord(chosen.row.status)}
            </Text>
            {chosen.row.durationMs !== null && (
              <Text span inherit>
                {duration(chosen.row.durationMs)}
              </Text>
            )}
            <Origin layer={chosen.layer} backends={backends} now={now} />
          </Flex>
        )}
      </Box>
      <TestProgress {...progress} />
      {waiting && (
        <Text role="status" component="div" c="dimmed">
          Loading the recording…
        </Text>
      )}
      {!chosen && !waiting && !progress.tests.length && (
        <Alert color={'blue'} my="sm">
          {unavailable ??
            'This result is not in the combined report any more. A newer run may have replaced it, or its source is switched off.'}
        </Alert>
      )}
      {chosen && !paths && (
        <Alert color={'blue'} my="sm">
          This result has an outcome and no recorded timeline.
        </Alert>
      )}
      {report.isLoading && (
        <Text role="status" component="div" c="dimmed">
          Loading the recording…
        </Text>
      )}
      {report.isError && (
        <Alert role="alert" color={'red'} my="sm">
          The recording could not be read. {report.error.message}{' '}
          <Button type="button" onClick={() => void report.refetch()} variant="subtle">
            Try again
          </Button>
        </Alert>
      )}
      {wantsCss && css.isError && (
        <Alert role="alert" color={'red'} my="sm">
          The recorded stylesheet could not be read, so pictures appear unstyled.{' '}
          <Button type="button" onClick={() => void css.refetch()} variant="subtle">
            Try again
          </Button>
        </Alert>
      )}
      {report.data && paths && (
        <Timeline report={report.data} fileUrl={paths.file} css={css.data ?? ''} moment={moment} onMoment={onMoment} />
      )}
    </Container>
  );
}
