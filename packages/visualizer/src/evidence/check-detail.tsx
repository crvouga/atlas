import { recordingPaths } from '@crvouga/atlas/reports/evidence-types';
import { checkHistory, type CheckSlot, type HistoryEntry } from '@crvouga/atlas/reports/evidence-view';
import { flattenFrames } from '@crvouga/atlas/reports/frames';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { boundaryOf, isProductLatency } from '@crvouga/atlas/reports/latency';
import type { EvidenceResult } from '@crvouga/atlas/reports/layer-merge';
import type { ReportStep, RunReport } from '@crvouga/atlas/reports/report-types';
import { Accordion, Alert, Badge, Button, Code, Divider, Group, List, NavLink, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { IconExternalLink, IconPlayerPlayFilled } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { TestProgress, useTestProgress } from '../live/test-progress';
import { reportJson } from './api';
import { ResultEvidence, useCheckDetail } from './artifacts';
import { useEvidence } from './evidence-context';
import { ago, duration, plural, statusWord, useNow } from './format';
import type { FeatureExamples, FeatureStep } from './gherkin';
import { Bounded, Origin, StatusMark } from './marks';
import { ModelTrace } from './model-trace';
import { OutcomeSummary } from './outcome-summary';
import { failedReportStep, failedStep, recordOf, sourceLabels, type ResultRecord } from './outcome';
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
            <Group gap="sm" wrap="nowrap" align="center">
              <StatusMark status={slot?.status ?? 'none'} />
              <Text data-result-label span fw={500} flex={1} miw={0}>
                {label}
                {marks.length > 0 && (
                  <Group component="span" display="inline-flex" gap="xs" align="center" wrap="wrap" ml="xs" fz="xs" fw={400}>
                    {marks.map((mark) => (
                      <Text key={mark.id || 'unspecified'} data-status={mark.status} span inherit c={mark.status === 'failed' ? 'red.7' : 'dimmed'}>
                        {environmentLabel(mark.id || null)} {statusWord(mark.status).toLowerCase()}
                      </Text>
                    ))}
                  </Group>
                )}
              </Text>
              {badge}
              {slot?.live && (
                <Badge color="blue" size="sm">
                  Running now
                </Badge>
              )}
              {interrupted && (
                <Badge color="orange" size="sm">
                  Interrupted
                </Badge>
              )}
              <Text span c="dimmed" size="xs" ta="right">
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
        <Text component="p" data-progress="true" role="status" c="dimmed" size="xs" px="md" my={4}>
          {current.check.detail || current.check.steps?.at(-1)?.name || 'Test in progress…'}
          {progress.error ? ` · ${progress.error}` : ''}
        </Text>
      )}
      {!open && interrupted && (
        <Text component="p" data-progress="true" role="status" c="dimmed" size="xs" px="md" my={4}>
          {interrupted.run.reason ?? 'The test run was interrupted.'}
        </Text>
      )}
      {!open && !current && failure && (
        <Text component="p" c="red.7" size="xs" px="md" my={4} lineClamp={2}>
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
      <Text span inherit c="dimmed" fw={600}>
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
    <List data-nested={nested || undefined} spacing={6} listStyleType="none" type="ordered">
      {steps.map((step) => (
        <List.Item key={step.index} data-status={step.status}>
          <Group gap="xs" align="flex-start" wrap="nowrap">
            <Group pt={3} lh={1} gap={0}>
              <StatusMark status={step.status} size={14} />
            </Group>
            <Text span flex={1} miw={0} fw={step.status === 'failed' ? 600 : undefined}>
              <StepLine title={step.title} />
            </Text>
            <Text span c="dimmed" size="xs">
              {duration(step.durationMs)}
            </Text>
          </Group>
          {step.error && !step.steps.some((inner) => inner.status === 'failed' && inner.error) && (
            <Code block c="red.7" mt={6} ml="lg">
              {step.error}
            </Code>
          )}
          {step.steps.length > 0 && (
            <Accordion variant="separated" mt={6} ml="lg" defaultValue={step.status === 'failed' ? 'content' : null}>
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
      <List spacing={6} listStyleType="none" type="ordered">
        {steps.map((step, index) => (
          <List.Item key={index}>
            <Text component="div">
              <Text span inherit>
                <Text span inherit c="dimmed" fw={600}>
                  {step.keyword}
                </Text>{' '}
                {step.text}
              </Text>
            </Text>
            {step.docString !== null && (
              <Code block mt={6}>
                {step.docString}
              </Code>
            )}
            {step.table.length > 0 && <Cells rows={step.table} />}
          </List.Item>
        ))}
      </List>
      {examples.map((example, index) => (
        <Stack key={index} gap="xs" miw={0}>
          <Text component="div" c="dimmed" size="xs" fw={500}>
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
    <Table.ScrollContainer minWidth={360}>
      <Table withTableBorder>
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
  /** The layer id of the current source the address selected (without pinning a run). Used with `onSource`; otherwise the choice is local. */
  source?: string;
  /** Called with the layer id when a source is chosen (null for the newest), so the page can keep the choice in its address. */
  onSource?: (layerId: string | null) => void;
  /** Whether the outcome summary states its own heading. False when the page already shows it. */
  headline?: boolean;
  /** Every record of this check the page knows (a node's history of it), when the layers held here are only the winners. */
  records?: readonly ResultRecord[];
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
          <Accordion variant="separated">
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
function RecordedCheckDetail({ slot, layerId, select, reads, written, pinned, pin, source, onSource, headline = true, records }: Props) {
  const { evidence, backends, ready, pending } = useEvidence();
  const now = useNow();
  const [variant, setVariant] = useState(0);
  const history = useMemo(() => checkHistory(evidence, slot.specPath, slot.id), [evidence, slot.specPath, slot.id]);
  const sourceAt = onSource && source ? slot.outcomes.findIndex((outcome) => outcome.layer.id === source) : -1;
  const index = Math.min(onSource ? Math.max(sourceAt, 0) : variant, slot.outcomes.length - 1);
  const winner = slot.outcomes[index]!;
  const earlier = pinned ?? (layerId ? history.find((entry) => entry.layer.id === layerId) : undefined);
  const chosen: HistoryEntry = earlier ?? { layer: winner.layer, row: winner.row };
  const superseded = !slot.outcomes.some((outcome) => outcome.layer.id === chosen.layer.id);
  const { paths, report } = useRecordedReport(chosen);
  const recorded = useCheckDetail(chosen.layer, chosen.row);
  const point = useMemo(
    () => (chosen.row.status === 'failed' ? (failedStep(recorded.data?.check.steps) ?? failedReportStep(report.data)) : undefined),
    [chosen.row.status, recorded.data, report.data]
  );
  const labels = sourceLabels(slot.outcomes, now);
  const choose = (at: number) => {
    setVariant(at);
    onSource?.(at === 0 ? null : slot.outcomes[at]!.layer.id);
  };
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
    <Stack gap="md" miw={0}>
      <OutcomeSummary
        slot={slot}
        selected={chosen}
        history={records && records.length > history.length ? records : history.map(recordOf)}
        point={point}
        detail={recorded.data}
        now={now}
        showHeadline={headline}
        choose={(layer) => {
          const at = slot.outcomes.findIndex((outcome) => outcome.layer.id === layer);
          if (at >= 0) choose(at);
          else select({ layer });
        }}
      />
      {slot.outcomes.length > 1 && !earlier && (
        <Group role="group" aria-label="Environments" gap={6} align="center" wrap="wrap">
          {slot.outcomes.map((outcome, at) => (
            <Button
              key={outcome.key}
              type="button"
              aria-pressed={at === index}
              onClick={() => choose(at)}
              variant={at === index ? 'light' : 'default'}
              size="compact-sm"
              leftSection={<StatusMark status={outcome.row.status} size={12} />}
            >
              {labels[at]!.text}
            </Button>
          ))}
        </Group>
      )}
      <Group gap="sm" align="center" wrap="wrap" c="dimmed" fz="sm">
        <Group gap={6} wrap="nowrap">
          <StatusMark status={chosen.row.status} size={14} />
          <Text data-status={chosen.row.status} span inherit fw={600} c="var(--mantine-color-text)">
            {statusWord(chosen.row.status)}
          </Text>
        </Group>
        {chosen.row.durationMs !== null && (
          <>
            <Divider orientation="vertical" />
            <Text span inherit>
              {duration(chosen.row.durationMs)}
            </Text>
          </>
        )}
        <Divider orientation="vertical" />
        <Origin layer={chosen.layer} backends={backends} now={now} />
      </Group>
      {(moments > 0 || chosen.layer.runUrl) && (
        <Group gap="xs" align="center" wrap="wrap">
          {moments > 0 && (
            <Button
              type="button"
              onClick={() => select({ view: 'recording', check: slot.id, layer: earlier || index > 0 ? chosen.layer.id : null })}
              variant="filled"
              leftSection={<IconPlayerPlayFilled size={14} aria-hidden="true" />}
              rightSection={
                <Badge size="sm" variant="white" color="dark" visibleFrom="xs">
                  {plural(moments, 'moment', 'moments')}
                </Badge>
              }
            >
              Open recording{' '}
            </Button>
          )}
          {chosen.layer.runUrl && (
            <Button
              component="a"
              href={chosen.layer.runUrl}
              target="_blank"
              rel="noreferrer"
              variant="default"
              rightSection={<IconExternalLink size={14} aria-hidden="true" />}
            >
              Open the run
            </Button>
          )}
        </Group>
      )}
      {note && <Alert color="blue">{note}</Alert>}
      {layerId && !earlier && ready && pending === 0 && (
        <Alert role="status" color="blue">
          The layer this link names is not among the results held for this check. Showing the current result instead.
        </Alert>
      )}
      {failure && (
        <Code block c="red.7">
          {failure}
        </Code>
      )}
      {report.isLoading && (
        <Stack gap="xs">
          <Text role="status" component="div" c="dimmed">
            Loading what was recorded…
          </Text>
          <Skeleton height="1rem" radius="sm" />
          <Skeleton height="1rem" radius="sm" w="80%" />
          <Skeleton height="1rem" radius="sm" w="60%" />
        </Stack>
      )}
      {report.isError && (
        <Alert role="alert" color="red">
          The recording could not be read. {report.error.message}{' '}
          <Button type="button" onClick={() => void report.refetch()} variant="subtle" size="compact-sm">
            Try again
          </Button>
        </Alert>
      )}
      {report.data && stepsShown && (
        <Stack gap="sm" component="section" miw={0}>
          <Title order={3}>Recorded steps</Title>
          <RecordedSteps steps={report.data.steps} />
        </Stack>
      )}
      {states.length > 0 && <ModelTrace states={states} />}
      {!report.data && written}
      {!paths && !written && (
        <Text component="div" c="dimmed">
          This check has an outcome and no recorded timeline.
        </Text>
      )}
      {timings.some((entry) => entry.row.measurements.length > 0) && (
        <Stack gap="xs" component="section" aria-label="Measurements" miw={0}>
          <Title order={3}>Measurements</Title>
          {timings.flatMap((entry) =>
            entry.row.measurements.map((measurement, index) => {
              const over = measurement.limit !== undefined && measurement.value > measurement.limit;
              return (
                <Text key={`${entry.key}:${index}`} data-over={over || undefined} component="div">
                  <Text span inherit c="dimmed">
                    {measurement.name}:
                  </Text>{' '}
                  <Text span inherit fw={600} c={over ? 'red.7' : undefined}>
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
        </Stack>
      )}
      <ResultEvidence layer={chosen.layer} row={chosen.row} />
      {history.length > 1 && (
        <Stack aria-label="Other runs of this check" component="section" gap="xs" miw={0}>
          <Title order={3}>Recorded in {plural(history.length, 'run', 'runs')}</Title>
          <List spacing={2} listStyleType="none">
            <Bounded items={history} size={6} more="Earlier runs">
              {(entry) => {
                const current = entry.layer.id === chosen.layer.id && entry.row.kind === chosen.row.kind;
                return (
                  <List.Item key={`${entry.layer.backend}|${entry.layer.id}|${entry.row.kind}`}>
                    <NavLink
                      component="button"
                      type="button"
                      aria-current={current || undefined}
                      active={current}
                      variant="light"
                      py={6}
                      px="xs"
                      onClick={() =>
                        select({
                          layer: !pin && slot.outcomes.some((outcome) => outcome.layer.id === entry.layer.id) ? null : entry.layer.id
                        })
                      }
                      leftSection={<StatusMark status={entry.row.status} size={14} />}
                      label={
                        <Group gap="sm" wrap="wrap" align="center">
                          <Text span inherit fw={current ? 600 : 500} miw="3.5rem">
                            {statusWord(entry.row.status)}
                          </Text>
                          <Origin layer={entry.layer} backends={backends} now={now} />
                        </Group>
                      }
                    />
                  </List.Item>
                );
              }}
            </Bounded>
          </List>
        </Stack>
      )}
    </Stack>
  );
}
