import { recordingPaths } from '@crvouga/atlas/reports/evidence-types';
import { checkHistory, type CheckSlot, type HistoryEntry } from '@crvouga/atlas/reports/evidence-view';
import { flattenFrames } from '@crvouga/atlas/reports/frames';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { boundaryOf, isProductLatency } from '@crvouga/atlas/reports/latency';
import type { EvidenceResult } from '@crvouga/atlas/reports/layer-merge';
import type { ReportStep, RunReport } from '@crvouga/atlas/reports/report-types';
import { Accordion, Alert, Anchor, Box, Button, Code, Flex, Group, List, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { TestProgress, useTestProgress } from '../live/test-progress';
import { reportJson } from './api';
import { ResultEvidence } from './artifacts';
import { useEvidence } from './evidence-context';
import { ago, duration, plural, statusWord, useNow } from './format';
import type { FeatureExamples, FeatureStep } from './gherkin';
import { Bounded, Origin, StatusMark } from './marks';
import { ModelTrace } from './model-trace';
import { recordedModelStates } from './quint';
/** What the address says is open: a check, and optionally one particular layer's record of it. */
export type CheckSelection = {
  readonly check?: string;
  readonly layer?: string;
};
export type SelectCheck = (patch: { check?: string | null; layer?: string | null; view?: 'recording' | null }) => void;
/** The recorded timeline of one result, read only when someone opens it. */
export function useRecordedReport(entry: HistoryEntry | null, enabled = true) {
  const address = entry?.layer.recording ?? null;
  const testId = entry?.row.testId ?? null;
  const paths = address && testId ? recordingPaths(address, testId) : null;
  const report = useQuery({
    queryKey: ['evidence-test', paths?.report ?? ''],
    queryFn: ({ signal }) => reportJson<RunReport>(paths!.report, signal),
    enabled: enabled && paths !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
  return { paths, report };
}
/** One check in a list: its outcome at a glance, and everything recorded for it when opened. */
const ENV_RANK = { passed: 0, 'not-run': 1, running: 2, failed: 3 } as const;
/** One mark per client when the same check was recorded on more than one. */
function environmentMarks(slot: CheckSlot) {
  const seen = new Map<string, CheckSlot['status']>();
  for (const outcome of slot.outcomes) {
    const id = outcome.layer.environment ?? '';
    const prior = seen.get(id);
    if (prior === undefined || ENV_RANK[outcome.row.status] > ENV_RANK[prior]) seen.set(id, outcome.row.status);
  }
  if (seen.size < 2) return [];
  return [...seen].map(([id, status]) => ({ id, status }));
}
function outcomeName(outcome: EvidenceResult) {
  const environment = outcome.layer.environment ? environmentLabel(outcome.layer.environment) : '';
  const parameters = Object.entries(outcome.parameters)
    .map(([name, value]) => `${name}: ${value}`)
    .join(', ');
  return [environment, parameters].filter(Boolean).join(' · ') || outcome.layer.producer;
}
export function ResultRow({
  label,
  slot,
  open,
  onToggle,
  badge,
  children
}: {
  label: string;
  slot: CheckSlot | null;
  open: boolean;
  onToggle: () => void;
  /** A short extra mark after the label, such as a coverage state. */
  badge?: ReactNode;
  children: ReactNode;
}) {
  const now = useNow();
  const progress = useTestProgress(slot);
  const current = progress.tests.find(({ run, check }) => run.status === 'running' && check.status === 'running');
  const interrupted = !current && progress.tests.find(({ run, check }) => run.status === 'interrupted' && check.status === 'not-run');
  const newest = slot?.outcomes[0];
  const marks = slot && !current ? environmentMarks(slot) : [];
  const failure =
    slot?.status === 'failed' ? slot.outcomes.find((outcome) => outcome.row.status === 'failed')?.row.detail.split('\n')[0] : '';
  return (
    <List.Item data-result-row data-status={slot?.status ?? 'none'} data-open={open || undefined}>
      <Accordion variant="separated" value={open ? 'result' : null} onChange={onToggle}>
        <Accordion.Item value="result">
          <Accordion.Control>
            <Group gap="sm" wrap="nowrap">
              <StatusMark status={slot?.status ?? 'none'} />
              <Text data-result-label span inherit>
                {label}
                {marks.length > 0 && (
                  <Flex component="span" display="inline-flex" gap="xs" align="center" wrap="wrap">
                    {marks.map((mark) => (
                      <Text key={mark.id || 'unspecified'} data-status={mark.status} span inherit>
                        {environmentLabel(mark.id || null)}
                      </Text>
                    ))}
                  </Flex>
                )}
              </Text>
              {badge}
              {slot?.live && (
                <Text span inherit>
                  Running now
                </Text>
              )}
              {interrupted && (
                <Text span inherit>
                  Interrupted
                </Text>
              )}
              <Text span inherit c="dimmed">
                {current
                  ? duration(current.check.durationMs ?? null) || 'In progress'
                  : interrupted
                    ? 'No completed result'
                    : newest
                      ? [
                          newest.row.evidence?.attachments ? plural(newest.row.evidence.attachments, 'attachment', 'attachments') : '',
                          duration(newest.row.durationMs),
                          slot.live ? '' : ago(slot.latestAtMs, now)
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : 'No result'}
              </Text>
              <Text aria-hidden="true" span />
            </Group>
          </Accordion.Control>
          <Accordion.Panel>{open && children}</Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      {!open && current && (
        <Text component="p" data-progress="true" role="status" c="dimmed">
          {current.check.detail || current.check.steps?.at(-1)?.name || 'Test in progress…'}
          {progress.error ? ` · ${progress.error}` : ''}
        </Text>
      )}
      {!open && interrupted && (
        <Text component="p" data-progress="true" role="status" c="dimmed">
          {interrupted.run.reason ?? 'The test run was interrupted.'}
        </Text>
      )}
      {!open && !current && failure && (
        <Text component="p" c="red.7">
          {failure}
        </Text>
      )}
    </List.Item>
  );
}
const KEYWORD = /^(Given|When|Then|And|But|\*)\s+/;
function StepLine({ title }: { title: string }) {
  const keyword = KEYWORD.exec(title)?.[1];
  return keyword ? (
    <Text span inherit>
      <Text span inherit>
        {keyword}
      </Text>{' '}
      {title.slice(keyword.length + 1)}
    </Text>
  ) : (
    <Text span inherit>
      {title}
    </Text>
  );
}
/** The steps a test recorded, each with what happened to it. */
export function RecordedSteps({ steps, nested = false }: { steps: readonly ReportStep[]; nested?: boolean }) {
  return (
    <List data-nested={nested || undefined} spacing="xs" listStyleType="none" type="ordered">
      {steps.map((step) => (
        <List.Item key={step.index} data-status={step.status}>
          <Flex gap="xs" align="center" wrap="wrap">
            <StatusMark status={step.status} size={14} />
            <StepLine title={step.title} />
            <Text span inherit c="dimmed">
              {duration(step.durationMs)}
            </Text>
          </Flex>
          {step.error && !step.steps.some((inner) => inner.status === 'failed' && inner.error) && (
            <Code block c="red.7">
              {step.error}
            </Code>
          )}
          {step.steps.length > 0 && (
            <Accordion variant="separated" my="sm" defaultValue={step.status === 'failed' ? 'content' : null}>
              <Accordion.Item value="content">
                <Accordion.Control>{plural(step.steps.length, 'recorded action', 'recorded actions')}</Accordion.Control>
                <Accordion.Panel>
                  <RecordedSteps steps={step.steps} nested />
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
        </List.Item>
      ))}
    </List>
  );
}
/** A scenario as written, for when nothing has been recorded against it. */
export function PlainSteps({ steps, examples = [] }: { steps: readonly FeatureStep[]; examples?: readonly FeatureExamples[] }) {
  return (
    <>
      <List spacing="xs" listStyleType="none" type="ordered">
        {steps.map((step, index) => (
          <List.Item key={index}>
            <Flex gap="xs" align="center" wrap="wrap">
              <Text span inherit>
                <Text span inherit>
                  {step.keyword}
                </Text>{' '}
                {step.text}
              </Text>
            </Flex>
            {step.docString !== null && <Code block>{step.docString}</Code>}
            {step.table.length > 0 && <Cells rows={step.table} />}
          </List.Item>
        ))}
      </List>
      {examples.map((example, index) => (
        <Stack key={index} gap="sm" miw={0}>
          <Text component="div" c="dimmed">
            Examples{example.name ? `: ${example.name}` : ''}
          </Text>
          <Cells header={example.header} rows={example.rows} />
        </Stack>
      ))}
    </>
  );
}
function Cells({ header, rows }: { header?: readonly string[]; rows: readonly (readonly string[])[] }) {
  return (
    <Table.ScrollContainer minWidth={600}>
      <Table>
        {header && (
          <Table.Thead>
            <Table.Tr>
              {header.map((cell, index) => (
                <Table.Th key={index} scope="col">
                  {cell}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
        )}
        <Table.Tbody>
          {rows.map((row, index) => (
            <Table.Tr key={index}>
              {row.map((cell, at) => (
                <Table.Td key={at}>{cell}</Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
function qualification(warning: string | null) {
  // The origin line already says a checkout had local changes or an unknown origin.
  if (!warning || warning.includes('modified checkout') || warning.includes('origin was not captured')) return null;
  return warning;
}
type Props = {
  slot: CheckSlot;
  /** The layer whose record to read. Without it, the result that won the combined report. */
  layerId: string | undefined;
  select: SelectCheck;
  /** How this kind of check reads its recording. */
  reads: 'steps' | 'trace';
  /** The check as written, shown until a recording is read or when there is none. */
  written?: ReactNode;
  /** An exact earlier result the caller found (for example on a server that only sends winners). It wins over `layerId`. */
  pinned?: HistoryEntry;
  /** Choosing a run in the history always names its layer, even when that result is a current one, so the choice stays pinned. */
  pin?: boolean;
};
/** Everything recorded for one check: the chosen result, how it went, and every other run of it. */
export function CheckDetail(props: Props) {
  const progress = useTestProgress(props.slot);
  const inProgress = progress.tests.some(
    ({ run, check }) =>
      (check.status === 'running' && run.status === 'running') || (check.status === 'not-run' && run.status === 'interrupted')
  );
  return (
    <>
      <TestProgress {...progress} />
      {props.slot.outcomes.length > 0 ? (
        inProgress && !props.layerId ? (
          <Accordion variant="separated" my="sm">
            <Accordion.Item value="content">
              <Accordion.Control>Previous recorded result</Accordion.Control>
              <Accordion.Panel>
                <RecordedCheckDetail {...props} />
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        ) : (
          <RecordedCheckDetail {...props} />
        )
      ) : (
        props.written
      )}
    </>
  );
}
function RecordedCheckDetail({ slot, layerId, select, reads, written, pinned, pin }: Props) {
  const { evidence, backends, ready, pending } = useEvidence();
  const now = useNow();
  const [variant, setVariant] = useState(0);
  const history = useMemo(() => checkHistory(evidence, slot.specPath, slot.id), [evidence, slot.specPath, slot.id]);
  const winner = slot.outcomes[Math.min(variant, slot.outcomes.length - 1)]!;
  const earlier = pinned ?? (layerId ? history.find((entry) => entry.layer.id === layerId) : undefined);
  const chosen: HistoryEntry = earlier ?? { layer: winner.layer, row: winner.row };
  const superseded = !slot.outcomes.some((outcome) => outcome.layer.id === chosen.layer.id);
  const { paths, report } = useRecordedReport(chosen);
  const moments = report.data ? flattenFrames(report.data.steps).length : 0;
  const timings = superseded ? [] : slot.diagnostics.filter((entry) => entry.layer.id === chosen.layer.id || slot.diagnostics.length === 1);
  const note = superseded ? 'An earlier result. A newer run replaced it in the combined report.' : qualification(winner.warning);
  const states = reads === 'trace' && report.data ? recordedModelStates(report.data.steps).map((entry) => entry.state) : [];
  const stepsShown = report.data !== undefined && report.data.steps.length > 0 && (reads === 'steps' || states.length === 0);
  // The failed step carries its own message when the steps are on screen.
  const failure =
    chosen.row.status === 'failed' && !(stepsShown && report.data?.steps.some((step) => step.error))
      ? (report.data?.meta.error ?? chosen.row.detail)
      : '';
  return (
    <Stack gap="sm" miw={0}>
      {slot.outcomes.length > 1 && !earlier && (
        <Flex role="group" aria-label="Environments" gap="xs" align="center" wrap="wrap">
          {slot.outcomes.map((outcome, index) => (
            <Button key={outcome.key} type="button" aria-pressed={index === variant} onClick={() => setVariant(index)} variant="light">
              <StatusMark status={outcome.row.status} size={12} />
              {outcomeName(outcome)}
            </Button>
          ))}
        </Flex>
      )}
      <Flex gap="xs" align="center" wrap="wrap" c="dimmed">
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
      {note && (
        <Alert color={'blue'} my="sm">
          {note}
        </Alert>
      )}
      {layerId && !earlier && ready && pending === 0 && (
        <Alert role="status" color={'blue'} my="sm">
          The layer this link names is not among the results held for this check. Showing the current result instead.
        </Alert>
      )}
      {failure && (
        <Code block c="red.7">
          {failure}
        </Code>
      )}
      {report.isLoading && (
        <Text role="status" component="div" c="dimmed">
          Loading what was recorded…
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
      {report.data && stepsShown && <RecordedSteps steps={report.data.steps} />}
      {states.length > 0 && <ModelTrace states={states} />}
      {!report.data && written}
      {!paths && !written && (
        <Text component="div" c="dimmed">
          This check has an outcome and no recorded timeline.
        </Text>
      )}
      {timings.flatMap((entry) =>
        entry.row.measurements.map((measurement, index) => {
          const over = measurement.limit !== undefined && measurement.value > measurement.limit;
          return (
            <Text key={`${entry.key}:${index}`} data-over={over || undefined} component="div">
              {measurement.name}:{' '}
              <Text span inherit fw={600}>
                {Number(measurement.value.toFixed(1))} {measurement.unit}
              </Text>
              {measurement.limit !== undefined && (
                <Text span inherit>
                  {' '}
                  against an allowance of {measurement.limit} {measurement.unit}
                </Text>
              )}
              {isProductLatency(measurement) && (
                <Text span inherit c="dimmed">
                  {' '}
                  · product latency, {boundaryOf(measurement).label}
                  {boundaryOf(measurement).state === 'partial' && ` (partial: not ${boundaryOf(measurement).intended})`}
                  {measurement.outcome !== undefined && measurement.outcome !== 'observed' && ` · ${measurement.outcome}: waited at least this long`}
                </Text>
              )}
            </Text>
          );
        })
      )}
      <ResultEvidence layer={chosen.layer} row={chosen.row} />
      {(moments > 0 || chosen.layer.runUrl) && (
        <Flex gap="xs" align="center" wrap="wrap">
          {moments > 0 && (
            <Button
              type="button"
              onClick={() => select({ view: 'recording', check: slot.id, layer: earlier || variant > 0 ? chosen.layer.id : null })}
              variant="filled"
            >
              Open recording{' '}
              <Text span inherit>
                {plural(moments, 'moment', 'moments')}
              </Text>
            </Button>
          )}
          {chosen.layer.runUrl && (
            <Anchor href={chosen.layer.runUrl} target="_blank" rel="noreferrer">
              Open the run
            </Anchor>
          )}
        </Flex>
      )}
      {history.length > 1 && (
        <Box aria-label="Other runs of this check" component="section" mb="lg">
          <Title order={4} mb="sm">
            Recorded in {plural(history.length, 'run', 'runs')}
          </Title>
          <List spacing="xs" listStyleType="none">
            <Bounded items={history} size={6} more="Earlier runs">
              {(entry) => {
                const current = entry.layer.id === chosen.layer.id && entry.row.kind === chosen.row.kind;
                return (
                  <List.Item key={`${entry.layer.backend}|${entry.layer.id}|${entry.row.kind}`}>
                    <Button
                      type="button"
                      aria-current={current || undefined}
                      onClick={() =>
                        select({
                          layer: !pin && slot.outcomes.some((outcome) => outcome.layer.id === entry.layer.id) ? null : entry.layer.id
                        })
                      }
                      variant="light"
                    >
                      <StatusMark status={entry.row.status} size={14} />
                      <Text span inherit>
                        {statusWord(entry.row.status)}
                      </Text>
                      <Origin layer={entry.layer} backends={backends} now={now} />
                    </Button>
                  </List.Item>
                );
              }}
            </Bounded>
          </List>
        </Box>
      )}
    </Stack>
  );
}
