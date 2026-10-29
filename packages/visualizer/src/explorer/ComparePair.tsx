/**
 * @module Compare one behavior
 *
 * One behavior set side by side across the two pinned runs: its promise (wording, spec revision and recorded steps), each
 * side's outcome with its own provenance, the two recordings, and the figures that can honestly be set against each other
 * (product latency and reliability). The tabs read only what is on screen: steps and recordings are read when the
 * behavior is opened, the test's history when Figures is. Each recording keeps its own attempt, revision and time
 * origin; they are not synchronized, and seeking both to a recorded step uses each side's own step time. Nothing here
 * decides a status: an unsupported comparison says why instead of computing a change.
 */
import { attachmentIdentity, isVideoAttachment } from '@crvouga/atlas/reports/evidence-detail';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { formatLatency } from '@crvouga/atlas/reports/latency';
import { reliability } from '@crvouga/atlas/reports/reliability';
import {
  alignSteps,
  COMPARE_GROUP_TEXT,
  compareProductLatency,
  compareReliability,
  conditionId,
  conditionOf,
  reliabilityScopeAt,
  shortRevision,
  type ComparedResult,
  type MetricComparison,
  type RunComparison
} from '@crvouga/atlas/reports/run-compare';
import { formatMs, HISTORY_PER_TEST, type RunLayer, type RunResult, type RunSummary, type TestResultEntry } from '@crvouga/atlas/reports/test-catalog';
import { Alert, Anchor, Badge, Box, Button, Code, Group, List, NativeSelect, SimpleGrid, Stack, Table, Tabs, Text, Title } from '@mantine/core';
import { IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';

import { attachmentSource } from '../evidence/artifacts';
import { everyAttachment } from '../evidence/artifact-tags';
import { ScopeNotice } from '../evidence/evidence-scope';
import { duration, exactTime, plural, statusWord } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { useTestHistory } from './catalog';
import { patched } from './navigate';
import { entriesFromRun, playableVideo, RECORDING_STATE_TEXT, recordingState, type PlaylistEntry } from './playlist-entries';
import { useEntryDetail } from './playlist';

type Side = 'baseline' | 'candidate';
const SIDE_LABEL: Record<Side, string> = { baseline: 'Baseline', candidate: 'Candidate' };

/** The result of one side as a playlist entry, so its recording is judged and read the way the playlist does. */
function entryOf(result: RunResult | null, layers: readonly RunLayer[] | undefined): PlaylistEntry | null {
  if (!result) return null;
  return { ...entriesFromRun([result], layers)[0]!, kind: result.kind ?? null };
}

/** Both sides of a pair, written the same way, in a labelled region so each keeps its own identity. */
function Pair({ label, children }: { label: string; children: (side: Side) => React.ReactNode }) {
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} aria-label={label} role="group">
      {(['baseline', 'candidate'] as const).map((side) => (
        <Stack key={side} gap="xs" component="section" aria-label={`${SIDE_LABEL[side]}: ${label}`} data-side={side} miw={0}>
          <Title order={4}>{SIDE_LABEL[side]}</Title>
          {children(side)}
        </Stack>
      ))}
    </SimpleGrid>
  );
}

const PROMISE_BADGE = {
  same: { label: 'Same promise', color: 'green' },
  changed: { label: 'Promise changed', color: 'orange' },
  'revision-differs': { label: 'Spec revision differs', color: 'yellow' },
  unknown: { label: 'Promise sameness unknown', color: 'gray' }
} as const;

function Provenance({ result, run }: { result: RunResult; run: RunSummary }) {
  return (
    <Text component="div" c="dimmed" size="sm">
      {[environmentLabel(result.environment), result.producer, `recorded ${exactTime(result.at)}`, run.branch, run.sha?.slice(0, 7)].filter(Boolean).join(' · ')}
    </Text>
  );
}

function Missing({ side, item }: { side: Side; item: ComparedResult }) {
  return (
    <Text component="div" c="dimmed" role="status">
      The {side} run recorded no result for this behavior. {item.group === 'removed' || item.group === 'added' ? 'That is unknown, not a pass and not a failure.' : ''}
    </Text>
  );
}

function PromiseTab({ item, comparison, steps }: { item: ComparedResult; comparison: RunComparison; steps: Record<Side, readonly { name: string; kind?: string | undefined; offsetMs?: number | undefined }[] | null> }) {
  const promise = item.promise;
  const aligned = steps.baseline && steps.candidate ? alignSteps(steps.baseline, steps.candidate) : null;
  const only = (side: Side, name: string) => aligned?.steps.some((step) => step.name === name && (side === 'baseline' ? !step.onCandidate : !step.onBaseline));
  return (
    <Stack gap="md">
      <Group gap="xs">
        <Badge color={PROMISE_BADGE[promise.state].color} variant="light" tt="none" data-promise={promise.state}>
          {PROMISE_BADGE[promise.state].label}
        </Badge>
        {aligned?.differs && (
          <Badge color="orange" variant="light" tt="none" data-steps-differ>
            Recorded steps differ
          </Badge>
        )}
      </Group>
      {promise.reasons.length > 0 && (
        <List size="sm" c="dimmed" aria-label="About the promise">
          {promise.reasons.map((reason) => (
            <List.Item key={reason}>{reason}</List.Item>
          ))}
        </List>
      )}
      <Pair label="promise">
        {(side) => {
          const result = item[side];
          const run = comparison[side];
          const stepsOfSide = steps[side];
          if (!result) return <Missing side={side} item={item} />;
          return (
            <>
              <Text component="div" fw={600}>
                {side === 'baseline' ? promise.baselineTitle : promise.candidateTitle}
              </Text>
              <Text component="div" size="sm" c="dimmed">
                Spec revision <Code>{shortRevision(result.specRevision)}</Code>
                {result.specPath && (
                  <>
                    {' '}
                    in <Code>{result.specPath}</Code>
                  </>
                )}
              </Text>
              <Provenance result={result} run={run} />
              {stepsOfSide === null ? (
                <Text role="status" component="div" c="dimmed" size="sm">
                  Reading the recorded steps…
                </Text>
              ) : stepsOfSide.length === 0 ? (
                <Text component="div" c="dimmed" size="sm">
                  This result recorded no steps.
                </Text>
              ) : (
                <List type="ordered" spacing="xs" aria-label={`${SIDE_LABEL[side]} steps`}>
                  {stepsOfSide.map((step, index) => (
                    <List.Item key={`${step.name}:${index}`}>
                      {step.name}
                      {aligned?.differs && only(side, step.name) && (
                        <Badge ml="xs" size="sm" variant="light" color="orange" tt="none">
                          Only {side}
                        </Badge>
                      )}
                    </List.Item>
                  ))}
                </List>
              )}
            </>
          );
        }}
      </Pair>
    </Stack>
  );
}

function OutcomeTab({ item, comparison, onClose }: { item: ComparedResult; comparison: RunComparison; onClose: () => void }) {
  return (
    <Stack gap="md">
      <Pair label="outcome">
        {(side) => {
          const result = item[side];
          if (!result) return <Missing side={side} item={item} />;
          return (
            <>
              <Group gap="xs" data-outcome={result.status}>
                <StatusMark status={result.status} size={14} />
                <Text span inherit fw={600}>
                  {statusWord(result.status)}
                </Text>
              </Group>
              <Provenance result={result} run={comparison[side]} />
              <Text component="div" size="sm">
                Test execution time {duration(result.durationMs) || 'not measured'} <Text span inherit c="dimmed">(setup, waits and pacing included; not product latency)</Text>
              </Text>
              {result.status === 'failed' && result.detail && (
                <Alert color="red" title="Why it failed" role="status">
                  <Text component="div" lineClamp={6}>
                    {result.detail}
                  </Text>
                </Alert>
              )}
              <Anchor
                renderRoot={(props) => (
                  <Link {...props} to="/" search={patched({ tab: undefined, pair: undefined, test: result.key, layer: result.layer })} resetScroll={false} activeOptions={{ exact: true }} onClick={onClose} />
                )}
              >
                Open this {side} result
              </Anchor>
            </>
          );
        }}
      </Pair>
    </Stack>
  );
}

function RecordingSide({
  side,
  item,
  entry,
  detail,
  video,
  positions
}: {
  side: Side;
  item: ComparedResult;
  entry: PlaylistEntry | null;
  detail: ReturnType<typeof useEntryDetail>;
  video: React.RefObject<HTMLVideoElement | null>;
  positions: Map<string, number>;
}) {
  const result = item[side];
  const chosen = entry ? playableVideo(entry) : undefined;
  const state = entry ? recordingState(entry) : 'none';
  const movie = useMemo(() => {
    const videos = (detail.data ? everyAttachment(detail.data.check) : []).filter(isVideoAttachment);
    return videos.find((attachment) => attachmentIdentity(attachment) === chosen?.recording) ?? videos[0];
  }, [detail.data, chosen]);
  if (!result || !entry) return <Missing side={side} item={item} />;
  const url = movie ? attachmentSource(movie, entry.layer).url : null;
  let body;
  if (state !== 'playable') {
    body = (
      <Alert color="orange" title={RECORDING_STATE_TEXT[state].label} role="status" data-recording-state={state}>
        {RECORDING_STATE_TEXT[state].meaning}
      </Alert>
    );
  } else if (detail.isPending && detail.fetchStatus !== 'idle') {
    body = (
      <Text role="status" component="div" c="dimmed">
        Loading the recording…
      </Text>
    );
  } else if (detail.isError || !url) {
    body = (
      <Alert color="orange" role="alert" title="This recording cannot be played">
        <Stack gap="xs" align="flex-start">
          <Text component="div">{detail.isError ? 'Its evidence could not be read.' : 'The result names a recording, but no file can be played from here.'}</Text>
          {detail.isError && (
            <Button type="button" variant="light" onClick={() => void detail.refetch()}>
              Try again
            </Button>
          )}
        </Stack>
      </Alert>
    );
  } else {
    body = (
      <Stack gap="xs">
        <ScopeNotice scope={chosen?.scope} name={movie!.name} />
        <Box
          component="video"
          ref={video}
          src={url}
          controls
          preload="metadata"
          aria-label={`${SIDE_LABEL[side]} recording: ${movie!.description ?? movie!.name}`}
          w="100%"
          mah="50vh"
          data-compare-video={side}
          onLoadedMetadata={() => {
            const saved = positions.get(side);
            if (saved !== undefined && video.current && saved < (video.current.duration || Number.POSITIVE_INFINITY)) video.current.currentTime = saved;
          }}
          onTimeUpdate={() => video.current && positions.set(side, video.current.currentTime)}
        />
      </Stack>
    );
  }
  return (
    <>
      {body}
      <Text component="div" size="sm" c="dimmed">
        {chosen?.owner === 'attempt' && chosen.attempt !== undefined ? `Try ${chosen.attempt + 1}` : 'Whole test'} · spec revision {shortRevision(result.specRevision)} · recorded {exactTime(result.at)}. Time 0 is the start of this
        recording.
      </Text>
    </>
  );
}

function RecordingTab({
  item,
  entries,
  details,
  steps
}: {
  item: ComparedResult;
  entries: Record<Side, PlaylistEntry | null>;
  details: Record<Side, ReturnType<typeof useEntryDetail>>;
  steps: Record<Side, readonly { name: string; offsetMs?: number | undefined }[] | null>;
}) {
  const videos = { baseline: useRef<HTMLVideoElement>(null), candidate: useRef<HTMLVideoElement>(null) };
  const positions = useRef(new Map<string, number>());
  const [step, setStep] = useState('');
  const alignment = steps.baseline && steps.candidate ? alignSteps(steps.baseline, steps.candidate) : null;
  const both = entries.baseline && entries.candidate && recordingState(entries.baseline) === 'playable' && recordingState(entries.candidate) === 'playable';
  const each = (action: (element: HTMLVideoElement, side: Side) => void) => (['baseline', 'candidate'] as const).forEach((side) => videos[side].current && action(videos[side].current!, side));
  return (
    <Stack gap="md">
      <Pair label="recording">
        {(side) => <RecordingSide side={side} item={item} entry={entries[side]} detail={details[side]} video={videos[side]} positions={positions.current} />}
      </Pair>
      <Stack gap="xs" component="section" aria-label="Aligning the recordings">
        <Title order={4}>Aligning the recordings</Title>
        <Text component="div" size="sm" c="dimmed" data-alignment={alignment?.state ?? 'pending'}>
          {alignment ? alignment.explanation : 'Reading the recorded steps…'}
        </Text>
        {both && alignment && (
          <Group align="flex-end" gap="md" wrap="wrap">
            <Button type="button" variant="default" leftSection={<IconPlayerPlay size={16} aria-hidden="true" />} onClick={() => each((element) => void (element.play() as Promise<void> | undefined)?.catch(() => undefined))}>
              Play both
            </Button>
            <Button type="button" variant="default" leftSection={<IconPlayerPause size={16} aria-hidden="true" />} onClick={() => each((element) => element.pause())}>
              Pause both
            </Button>
            {alignment.seekable.length > 0 && (
              <NativeSelect
                label="Go to a step in both recordings"
                description="Each recording moves to its own recorded time of the step."
                value={step}
                onChange={(event) => {
                  const chosen = alignment.seekable.find((candidate) => candidate.name === event.currentTarget.value);
                  setStep(event.currentTarget.value);
                  if (chosen) each((element, side) => void (element.currentTime = (side === 'baseline' ? chosen.baselineOffsetMs : chosen.candidateOffsetMs) / 1000));
                }}
              >
                <option value="">Choose a step</option>
                {alignment.seekable.map((candidate, index) => (
                  <option key={`${candidate.name}:${index}`} value={candidate.name}>
                    {candidate.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Group>
        )}
      </Stack>
      <Text component="div" c="dimmed" size="sm">
        Illustrative recordings of one run each. Their length and speed are those of the recordings, not production latency, and neither approves the behavior for production.
      </Text>
    </Stack>
  );
}

const sign = (value: number) => (value > 0 ? '+' : value < 0 ? '−' : '');

function Metric({ metric }: { metric: MetricComparison }) {
  if ('summary' in metric) {
    return (
      <Alert color="gray" title={`${metric.name}: only the ${metric.state === 'baseline-only' ? 'baseline' : 'candidate'} measured it`} role="status" data-metric={metric.state}>
        {metric.reasons.join(' ')} Nothing is compared.
      </Alert>
    );
  }
  const unit = metric.baseline.metric.unit;
  const figure = (summary: typeof metric.baseline) => (summary.p50 === undefined ? `${formatLatency(summary.last, unit)} newest of ${plural(summary.samples, 'observation', 'observations')}` : `p50 ${formatLatency(summary.p50, unit)} of ${plural(summary.samples, 'observation', 'observations')}`);
  const delta = metric.state === 'compared' ? (metric.change.p50 ?? metric.change.p95 ?? metric.change.last) : undefined;
  return (
    <Stack gap="xs" role="group" aria-label={`Product latency: ${metric.name}`} data-metric={metric.state}>
      <Text fw={600}>{metric.name}</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Text component="div" size="sm">Baseline: {figure(metric.baseline)}</Text>
        <Text component="div" size="sm">Candidate: {figure(metric.candidate)}</Text>
      </SimpleGrid>
      {metric.state === 'compared' && delta ? (
        <Text component="div" size="sm" fw={600}>
          Change {sign(delta.absolute)}
          {formatLatency(Math.abs(delta.absolute), unit)} {delta.relative === null ? '' : `(${sign(delta.relative)}${Math.abs(Math.round(delta.relative * 1000) / 10)}%) `}
          {metric.change.basis === 'last' ? 'in the newest observation, not a percentile' : `in ${metric.change.basis}`}
        </Text>
      ) : (
        <Alert color="orange" title="Not compared" role="status">
          No change is computed. {metric.reasons.join(' ')}
        </Alert>
      )}
      {metric.state === 'compared' && metric.reasons.length > 0 && (
        <List size="sm" c="dimmed">
          {metric.reasons.map((reason) => (
            <List.Item key={reason}>{reason}</List.Item>
          ))}
        </List>
      )}
    </Stack>
  );
}

/** The entries of the test's history that one side's result was recorded as: its run, and the condition it was recorded under. */
function recordedBy(history: readonly TestResultEntry[], result: RunResult | null, run: RunSummary): TestResultEntry[] {
  if (!result) return [];
  const wanted = conditionId(conditionOf(result));
  return history.filter((entry) => {
    if (entry.run !== run.key) return false;
    const found = conditionOf({ kind: result.kind === undefined ? undefined : entry.kind, producer: entry.producer, environment: entry.environment, parameters: entry.parameters });
    return conditionId(found) === wanted;
  });
}

function Rate({ rate, sample }: { rate: { executions: number; passed: number; rate: number | null }; sample: string }) {
  if (rate.rate === null) return <Text span inherit>No completed execution: unknown</Text>;
  return (
    <>
      {Math.round(rate.rate * 1000) / 10}% of {plural(rate.executions, 'independent execution', 'independent executions')}
      {sample !== 'sufficient' && (
        <Badge ml="xs" color="orange" variant="light" tt="none">
          Insufficient evidence
        </Badge>
      )}
    </>
  );
}

function FiguresTab({ item, comparison }: { item: ComparedResult; comparison: RunComparison }) {
  const history = useTestHistory(item.key);
  const entries = useMemo(() => history.data?.history ?? [], [history.data]);
  const { baseline, candidate } = item;
  const figures = useMemo(() => {
    if (!baseline || !candidate || !history.data) return null;
    const left = recordedBy(entries, baseline, comparison.baseline);
    const right = recordedBy(entries, candidate, comparison.candidate);
    const reliable = (result: RunResult, run: RunSummary) => reliability(item.key, entries, reliabilityScopeAt(result, run));
    const base = reliable(baseline, comparison.baseline);
    const cand = reliable(candidate, comparison.candidate);
    return {
      left,
      right,
      latency: compareProductLatency(left, right, item.conditions),
      base,
      cand,
      reliability: compareReliability(base, cand, item.conditions)
    };
  }, [entries, baseline, candidate, comparison, item, history.data]);
  if (!baseline || !candidate)
    return (
      <Text component="div" c="dimmed" role="status">
        Only one run recorded this behavior, so there is nothing to set its figures against. Nothing is computed.
      </Text>
    );
  const sameConditions = item.conditions.length === 0;
  const timeDelta = baseline.durationMs !== null && candidate.durationMs !== null ? candidate.durationMs - baseline.durationMs : null;
  return (
    <Stack gap="lg">
      <Stack gap="xs" component="section" aria-label="Test execution time">
        <Title order={4}>Test execution time</Title>
        <Text component="div" size="sm">
          Baseline {duration(baseline.durationMs) || 'not measured'} · Candidate {duration(candidate.durationMs) || 'not measured'}.{' '}
          {sameConditions && timeDelta !== null
            ? `Change ${sign(timeDelta)}${formatMs(Math.abs(timeDelta))}. `
            : `No change is stated: ${!sameConditions ? 'the results were recorded under different conditions' : 'one side did not measure it'}. `}
          <Text span inherit c="dimmed">
            This is how long the test took, including setup, waits and pacing. It is not product latency.
          </Text>
        </Text>
      </Stack>
      {history.isPending && (
        <Text role="status" component="div" c="dimmed">
          Reading this behavior's history…
        </Text>
      )}
      {history.isError && (
        <Alert color="red" role="alert">
          Its history could not be read. {history.error.message}
        </Alert>
      )}
      {history.isSuccess && !history.data && (
        <Alert color="blue" role="status">
          The history holds no record of this behavior, so product latency and reliability are unknown.
        </Alert>
      )}
      {figures && (
        <>
          {(figures.left.length === 0 || figures.right.length === 0) && (
            <Alert color="blue" role="status">
              The history no longer holds this run's record for {figures.left.length === 0 ? 'the baseline' : 'the candidate'} (only the newest {HISTORY_PER_TEST} results of a test are kept), so its product latency is unknown.
            </Alert>
          )}
          <Stack gap="sm" component="section" aria-label="Product latency">
            <Title order={4}>Product latency</Title>
            {figures.latency.length === 0 ? (
              <Text component="div" c="dimmed" role="status">
                Neither run recorded product latency for this behavior, so it is unknown, not fast. Nothing is compared.
              </Text>
            ) : (
              figures.latency.map((metric) => <Metric key={`${metric.name}:${metric.state}`} metric={metric} />)
            )}
          </Stack>
          <Stack gap="xs" component="section" aria-label="Reliability">
            <Title order={4}>Reliability up to each run</Title>
            <Text component="div" size="sm" c="dimmed">
              Independent executions of this check in the same environment, producer and parameters, against the spec revision each result was recorded at, up to the end of each run.
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Text component="div">
                Baseline: <Rate rate={figures.base.eventual} sample={figures.base.sample} />
              </Text>
              <Text component="div">
                Candidate: <Rate rate={figures.cand.eventual} sample={figures.cand.sample} />
              </Text>
            </SimpleGrid>
            {figures.reliability.comparable ? (
              <Text component="div" fw={600} data-reliability={figures.reliability.direction}>
                {figures.reliability.direction === 'indistinguishable'
                  ? 'The two figures cannot be told apart.'
                  : `The candidate figure is ${figures.reliability.direction} by ${Math.abs(figures.reliability.points ?? 0)} points, beyond the uncertainty of both.`}
              </Text>
            ) : (
              <Alert color="orange" title="Not compared" role="status" data-reliability="not-comparable">
                No change is computed. {figures.reliability.reasons.join(' ')}
              </Alert>
            )}
            {figures.reliability.comparable && figures.reliability.reasons.length > 0 && (
              <Text component="div" size="sm" c="dimmed">
                {figures.reliability.reasons.join(' ')}
              </Text>
            )}
          </Stack>
        </>
      )}
    </Stack>
  );
}

/**
 * The detail of one compared behavior: promise, outcomes, recordings and figures for the baseline and the candidate.
 * `layers` say which backend each side's layers are read from; `onClose` is called when a link leaves the comparison.
 */
export function ComparePair({
  item,
  comparison,
  layers,
  onClose
}: {
  item: ComparedResult;
  comparison: RunComparison;
  layers: Record<Side, readonly RunLayer[] | undefined>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<string>('promise');
  const entries = { baseline: entryOf(item.baseline, layers.baseline), candidate: entryOf(item.candidate, layers.candidate) };
  const empty = { ...(entries.baseline ?? entries.candidate!), backend: null } as PlaylistEntry;
  const details = {
    baseline: useEntryDetail(entries.baseline ?? empty, entries.baseline !== null),
    candidate: useEntryDetail(entries.candidate ?? empty, entries.candidate !== null)
  };
  // Steps are null while they are being read; a result whose evidence cannot be read has none to show.
  const stepsOf = (detail: ReturnType<typeof useEntryDetail>) => (detail.data ? (detail.data.check.steps ?? []) : detail.isPending && detail.fetchStatus !== 'idle' ? null : []);
  const steps = { baseline: entries.baseline ? stepsOf(details.baseline) : [], candidate: entries.candidate ? stepsOf(details.candidate) : [] };
  const group = COMPARE_GROUP_TEXT[item.group];
  return (
    <Stack gap="md" aria-label={`Compare ${item.title}`} component="section">
      <Title order={3}>{item.title}</Title>
      <Group gap="xs">
        <Badge variant="light" tt="none" data-group={item.group}>
          {group.label}
        </Badge>
        {item.specPath && <Code>{item.specPath}</Code>}
      </Group>
      <Text component="div" data-pair-summary>
        {item.summary}
      </Text>
      {item.caveats.length > 0 && (
        <List size="sm" c="dimmed" aria-label="Before reading this change">
          {item.caveats.map((caveat) => (
            <List.Item key={caveat}>{caveat}</List.Item>
          ))}
        </List>
      )}
      <Tabs value={tab} onChange={(value) => setTab(value ?? 'promise')} keepMounted={false}>
        <Tabs.List aria-label="What to compare">
          <Tabs.Tab value="promise">Promise</Tabs.Tab>
          <Tabs.Tab value="outcome">Outcomes</Tabs.Tab>
          <Tabs.Tab value="recording">Recordings</Tabs.Tab>
          <Tabs.Tab value="figures">Figures</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="promise" pt="md">
          <PromiseTab item={item} comparison={comparison} steps={steps} />
        </Tabs.Panel>
        <Tabs.Panel value="outcome" pt="md">
          <OutcomeTab item={item} comparison={comparison} onClose={onClose} />
        </Tabs.Panel>
        <Tabs.Panel value="recording" pt="md">
          <RecordingTab item={item} entries={entries} details={details} steps={steps} />
        </Tabs.Panel>
        <Tabs.Panel value="figures" pt="md">
          <FiguresTab item={item} comparison={comparison} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
