/**
 * @module Run comparison
 *
 * Answers "what changed between these two runs?" without claiming more than the evidence supports. A run is a pinned
 * source: the comparison reads two {@link RunDetail}s as they are and never reaches for a newer run. Pure functions,
 * safe in a browser; nothing here changes a status, a slot or a winner.
 *
 * The rules, each of which keeps a comparison from looking more certain than it is:
 *
 * - **Identity is explicit.** Results are paired by the check they record (`TestSummary.key`: spec path and check id),
 *   then by the condition they were recorded under (kind, producer, environment, parameters). A title is never what
 *   pairs two results. A result with the same check but another condition is paired as well, marked as recorded under
 *   different conditions, and is not framed as the same experiment. Results of one side with no partner are `added`
 *   (only the candidate has them) or `removed` (only the baseline has them); a `removed` result is not a regression,
 *   because the candidate may not have run, renamed or dropped it, and the comparison cannot tell which.
 * - **Not run is not regressed.** A result that did not run, or is still running, on either side is `unknown`; it is
 *   counted as neither a pass nor a failure. Only a completed result against a completed result is a movement.
 * - **A changed promise is not the same experiment.** When the wording of a behavior differs between the two sides, the
 *   pair is `not-comparable` and both outcomes are shown beside the changed promise instead of as a regression or a
 *   recovery. A different spec-file revision with the same wording is disclosed beside the movement: a fingerprint is
 *   of the whole file, so it cannot say that this behavior's own promise changed. A revision that was not recorded is
 *   unknown, never the same.
 * - **Figures are compared like for like.** Product latency and reliability are compared only when both sides were
 *   recorded under the same conditions and support the figure; otherwise the reason is given and no improvement is
 *   computed. A metric only one side has is named, not compared.
 *
 * @see docs/ui.md
 */
import type { EvidenceStatus } from './explorer-types';
import { compareLatency, groupOf, latencyObservations, latencyReview, type LatencyChange, type LatencyEntry, type LatencySummary } from './latency';
import type { ReliabilityDocument, ReliabilityRate, ReliabilityScope } from './reliability';
import type { RunDetail, RunResult, RunSummary } from './test-catalog';

/** Where a pair of results (or one result with no partner) stands, in the order a review reads them. */
export const COMPARE_GROUPS = ['regressed', 'recovered', 'still-failing', 'not-comparable', 'unknown', 'removed', 'added', 'unchanged'] as const;
/** One of {@link COMPARE_GROUPS}. */
export type CompareGroup = (typeof COMPARE_GROUPS)[number];

/** What each group is called and what it does and does not say. */
export const COMPARE_GROUP_TEXT: Readonly<Record<CompareGroup, { readonly label: string; readonly meaning: string }>> = {
  regressed: { label: 'Newly failing', meaning: 'Passed in the baseline run and failed in the candidate run, under the same conditions and the same wording.' },
  recovered: { label: 'Recovered', meaning: 'Failed in the baseline run and passed in the candidate run. One later pass is not a proven fix.' },
  'still-failing': { label: 'Still failing', meaning: 'Failed in both runs.' },
  'not-comparable': { label: 'Promise or conditions differ', meaning: 'The behavior is worded differently, or the two results were recorded under different conditions, so the two outcomes are not the same experiment and no regression or recovery is claimed.' },
  unknown: { label: 'Not run or unfinished', meaning: 'One side did not run it or it is still running. That is unknown: not a failure and not a pass.' },
  removed: { label: 'Not in the candidate run', meaning: 'Only the baseline run recorded it. The candidate may not have run it, or it was renamed or dropped: unknown, not a regression and not a pass.' },
  added: { label: 'Not in the baseline run', meaning: 'Only the candidate run recorded it. It may be new, or the baseline may not have run it.' },
  unchanged: { label: 'Same outcome', meaning: 'Passed in both runs, or not run in both.' }
};

/**
 * Whether the promise (what the behavior says should happen) is the same on both sides: `same` (same wording and the
 * same recorded spec revision), `changed` (the wording differs), `revision-differs` (same wording, another spec-file
 * revision), or `unknown` (a revision was not recorded on a side, so nothing can be said).
 */
export type PromiseState = 'same' | 'changed' | 'revision-differs' | 'unknown';

/** What is known about whether the promise changed, and why. */
export type PromiseReading = {
  readonly state: PromiseState;
  readonly baselineTitle: string | null;
  readonly candidateTitle: string | null;
  readonly baselineRevision: string | null;
  readonly candidateRevision: string | null;
  /** In words, for a person. */
  readonly reasons: readonly string[];
};

/** The condition a result was recorded under: with the check, what makes it its own result. */
export type Condition = {
  readonly kind: string | null;
  readonly producer: string;
  readonly environment: string | null;
  readonly parameters: Readonly<Record<string, string>>;
};

/** The condition of a result. A server that does not send `kind` leaves it null: unknown, equal only to another unknown. */
export function conditionOf(result: Pick<RunResult, 'kind' | 'producer' | 'environment' | 'parameters'>): Condition {
  return { kind: result.kind ?? null, producer: result.producer, environment: result.environment, parameters: result.parameters ?? {} };
}

/** A stable text for a condition, equal exactly when two conditions are. */
export function conditionId(condition: Condition): string {
  const parameters = Object.keys(condition.parameters).sort().map(name => `${name}=${condition.parameters[name]}`).join(',');
  return [condition.kind ?? '', condition.producer, condition.environment ?? '', parameters].join('/');
}

/** How two conditions differ, in words; empty when they are the same. */
export function conditionDifferences(baseline: Condition, candidate: Condition): string[] {
  const out: string[] = [];
  if (baseline.environment !== candidate.environment) out.push(`environment ${baseline.environment ?? 'not declared'} against ${candidate.environment ?? 'not declared'}`);
  if (baseline.producer !== candidate.producer) out.push(`producer ${baseline.producer} against ${candidate.producer}`);
  if ((baseline.kind ?? '') !== (candidate.kind ?? '')) out.push(`kind ${baseline.kind ?? 'not declared'} against ${candidate.kind ?? 'not declared'}`);
  for (const name of [...new Set([...Object.keys(baseline.parameters), ...Object.keys(candidate.parameters)])].sort()) {
    if (baseline.parameters[name] !== candidate.parameters[name]) out.push(`${name} ${baseline.parameters[name] ?? 'not set'} against ${candidate.parameters[name] ?? 'not set'}`);
  }
  return out;
}

/** One behavior's results on the two sides. */
export type ComparedResult = {
  /** Identifies the pair within one comparison: the check, and the condition of each side. Stable for the same two runs. */
  readonly id: string;
  /** The check's identity (`TestSummary.key`). */
  readonly key: string;
  /** The check's title: the candidate's when it has one, else the baseline's. */
  readonly title: string;
  readonly specPath: string | null;
  readonly baseline: RunResult | null;
  readonly candidate: RunResult | null;
  readonly group: CompareGroup;
  /** One sentence saying what happened, and what is not known. */
  readonly summary: string;
  readonly promise: PromiseReading;
  /** How the two conditions differ, in words, when both sides have a result and they were recorded under different conditions. */
  readonly conditions: readonly string[];
  /** What a reader must not assume about this pair, in words. */
  readonly caveats: readonly string[];
};

/** The whole comparison of two pinned runs. */
export type RunComparison = {
  readonly baseline: RunSummary;
  readonly candidate: RunSummary;
  /** Every pair and every unpaired result, in the order of {@link COMPARE_GROUPS}, then spec and title. */
  readonly results: readonly ComparedResult[];
  readonly counts: Readonly<Record<CompareGroup, number>>;
  /** What a reader must not assume about the two runs as a whole: the same run on both sides, different branches, a candidate older than the baseline. */
  readonly notes: readonly string[];
};

const completed = (status: EvidenceStatus) => status === 'passed' || status === 'failed';
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Short form of a spec fingerprint, to show. */
export function shortRevision(revision: string | null | undefined): string {
  return revision ? revision.slice(0, 8) : 'not recorded';
}

/** The wording a run recorded for a check: what that run's layer called it, else the check's newest title. */
export function recordedTitle(result: Pick<RunResult, 'title' | 'recordedTitle'>): string {
  return result.recordedTitle ?? result.title;
}

function readPromise(baseline: RunResult | null, candidate: RunResult | null): PromiseReading {
  const baselineTitle = baseline ? recordedTitle(baseline) : null;
  const candidateTitle = candidate ? recordedTitle(candidate) : null;
  const baselineRevision = baseline?.specRevision ?? null;
  const candidateRevision = candidate?.specRevision ?? null;
  const reasons: string[] = [];
  const base = { baselineTitle, candidateTitle, baselineRevision, candidateRevision };
  if (!baseline || !candidate) return { ...base, state: 'unknown', reasons: ['Only one run recorded this behavior, so its promise cannot be compared.'] };
  const titleDiffers = baselineTitle !== candidateTitle;
  const revisionKnown = baselineRevision !== null && candidateRevision !== null;
  const revisionDiffers = revisionKnown && baselineRevision !== candidateRevision;
  if (titleDiffers) reasons.push(`The behavior is worded differently: “${baselineTitle}” became “${candidateTitle}”.`);
  if (revisionDiffers) reasons.push(`The spec file was recorded at revision ${shortRevision(baselineRevision)} and then ${shortRevision(candidateRevision)}. A revision is of the whole file, so it does not say that this behavior's own promise changed.`);
  if (titleDiffers) return { ...base, state: 'changed', reasons };
  if (revisionDiffers) return { ...base, state: 'revision-differs', reasons };
  if (!revisionKnown) {
    reasons.push(`${baselineRevision === null && candidateRevision === null ? 'Neither run' : baselineRevision === null ? 'The baseline run' : 'The candidate run'} recorded no spec revision, so whether the promise is the same is unknown.`);
    return { ...base, state: 'unknown', reasons };
  }
  return { ...base, state: 'same', reasons };
}

function movement(baseline: RunResult, candidate: RunResult): { group: CompareGroup; summary: string } {
  const b = baseline.status;
  const c = candidate.status;
  if (!completed(b) || !completed(c)) {
    const where = !completed(c) ? 'candidate' : 'baseline';
    const what = (status: EvidenceStatus) => (status === 'running' ? 'still running' : 'not run');
    const side = !completed(c) ? c : b;
    return { group: 'unknown', summary: `${what(side)[0]!.toUpperCase()}${what(side).slice(1)} in the ${where} run, so there is no outcome to compare. That is unknown, not a failure or a pass.` };
  }
  if (b === 'passed' && c === 'failed') return { group: 'regressed', summary: 'Passed in the baseline run, failed in the candidate run.' };
  if (b === 'failed' && c === 'passed') return { group: 'recovered', summary: 'Failed in the baseline run, passed in the candidate run.' };
  if (b === 'failed') return { group: 'still-failing', summary: 'Failed in both runs.' };
  return { group: 'unchanged', summary: 'Passed in both runs.' };
}

function pairOf(key: string, baseline: RunResult | null, candidate: RunResult | null, differences: readonly string[]): ComparedResult {
  const promise = readPromise(baseline, candidate);
  const id = [key, baseline ? conditionId(conditionOf(baseline)) : '', candidate ? conditionId(conditionOf(candidate)) : ''].join('\u0001');
  const title = candidate ? recordedTitle(candidate) : recordedTitle(baseline!);
  const specPath = (candidate ?? baseline)!.specPath;
  const caveats: string[] = [];
  const common = { id, key, title, specPath, baseline, candidate, promise, conditions: differences, caveats };
  if (!baseline) return { ...common, group: 'added', summary: 'Only the candidate run recorded it. It may be new, or the baseline may not have run it.' };
  if (!candidate) return { ...common, group: 'removed', summary: 'The candidate run recorded no result for it. It may not have run it, or it was renamed or dropped: unknown, not a regression.' };
  if (promise.state === 'changed' || differences.length > 0) {
    const why = [...(promise.state === 'changed' ? ['the behavior is worded differently'] : []), ...(differences.length ? [`it was recorded under different conditions (${differences.join('; ')})`] : [])];
    return { ...common, group: 'not-comparable', summary: `Not the same experiment: ${why.join(' and ')}. Both outcomes are shown; no regression or recovery is claimed.` };
  }
  const moved = movement(baseline, candidate);
  if (promise.state === 'revision-differs') caveats.push(...promise.reasons);
  else if (promise.state === 'unknown' && moved.group !== 'unknown') caveats.push(...promise.reasons);
  return { ...common, ...moved };
}

/**
 * Pairs the results of two runs and reads what changed. Results are paired by check identity and then by condition (see
 * the module comment); titles never pair two results. Each side's results are those the run recorded last for each
 * check and condition (`RunDetail.results`).
 *
 * @param baseline - The run to compare against.
 * @param candidate - The run under review. Both are used as given: a newer run never replaces either.
 * @returns Every result of either run, grouped by what changed, with the reasons.
 * @example
 * ```ts
 * const comparison = compareRuns(await runDetail('run:ci-100'), await runDetail('run:ci-101'));
 * comparison.results.filter(item => item.group === 'regressed');
 * ```
 */
export function compareRuns(baseline: RunDetail, candidate: RunDetail): RunComparison {
  const byKey = (results: readonly RunResult[]) => {
    const map = new Map<string, RunResult[]>();
    for (const result of results) {
      const list = map.get(result.key);
      if (list) list.push(result);
      else map.set(result.key, [result]);
    }
    return map;
  };
  const left = byKey(baseline.results);
  const right = byKey(candidate.results);
  const pairs: ComparedResult[] = [];
  for (const key of [...new Set([...left.keys(), ...right.keys()])]) {
    const sides = { base: [...(left.get(key) ?? [])], cand: [...(right.get(key) ?? [])] };
    const order = (a: RunResult, b: RunResult) => compareText(conditionId(conditionOf(a)), conditionId(conditionOf(b))) || compareText(a.layer, b.layer);
    sides.base.sort(order);
    sides.cand.sort(order);
    // First the same condition on both sides, then whatever is left of the same check under other conditions.
    const restBase: RunResult[] = [];
    for (const result of sides.base) {
      const at = sides.cand.findIndex(other => conditionId(conditionOf(other)) === conditionId(conditionOf(result)));
      if (at < 0) restBase.push(result);
      else pairs.push(pairOf(key, result, sides.cand.splice(at, 1)[0]!, []));
    }
    while (restBase.length && sides.cand.length) {
      const result = restBase.shift()!;
      const other = sides.cand.shift()!;
      pairs.push(pairOf(key, result, other, conditionDifferences(conditionOf(result), conditionOf(other))));
    }
    for (const result of restBase) pairs.push(pairOf(key, result, null, []));
    for (const result of sides.cand) pairs.push(pairOf(key, null, result, []));
  }
  pairs.sort(
    (a, b) =>
      COMPARE_GROUPS.indexOf(a.group) - COMPARE_GROUPS.indexOf(b.group) ||
      compareText(a.specPath ?? '', b.specPath ?? '') ||
      compareText(a.title, b.title) ||
      compareText(a.id, b.id)
  );
  const counts = Object.fromEntries(COMPARE_GROUPS.map(group => [group, 0])) as Record<CompareGroup, number>;
  for (const pair of pairs) counts[pair.group] += 1;
  const notes: string[] = [];
  if (baseline.run.key === candidate.run.key) notes.push('The same run is on both sides, so nothing can differ.');
  if (baseline.run.branch !== candidate.run.branch) notes.push(`The runs are on different branches (${baseline.run.branch ?? 'none recorded'} and ${candidate.run.branch ?? 'none recorded'}).`);
  if (candidate.run.endedAtMs < baseline.run.endedAtMs) notes.push('The candidate run ended before the baseline run.');
  for (const [name, side] of [['baseline', baseline], ['candidate', candidate]] as const) {
    if (side.run.freshness === 'modified') notes.push(`The ${name} run was recorded from a checkout with uncommitted changes.`);
    if (side.run.counts.running > 0) notes.push(`The ${name} run still has results running, so its outcomes may change.`);
  }
  return { baseline: baseline.run, candidate: candidate.run, results: pairs, counts, notes };
}

/** What one product-latency metric shows on the two sides. */
export type MetricComparison =
  | { readonly state: 'compared'; readonly name: string; readonly baseline: LatencySummary; readonly candidate: LatencySummary; readonly change: LatencyChange; readonly reasons: readonly string[] }
  | { readonly state: 'incompatible'; readonly name: string; readonly baseline: LatencySummary; readonly candidate: LatencySummary; readonly change: LatencyChange | null; readonly reasons: readonly string[] }
  | { readonly state: 'baseline-only' | 'candidate-only'; readonly name: string; readonly summary: LatencySummary; readonly reasons: readonly string[] };

const devicesOf = (entries: readonly LatencyEntry[]) => [...new Set(latencyObservations(entries).map(o => groupOf(o, 'device')))].sort();

/**
 * Compares the product latency recorded in two sets of results of one check, one per side. A metric is compared only
 * when it is the same measurement (name, unit, boundaries) and both sides were measured on the same devices, in the
 * same environments, with the same instrumentation and other conditions; otherwise it is `incompatible` and no change
 * is computed, with the reasons. A metric only one side recorded is named as such. A side without any latency is unknown,
 * not fast: it contributes no metric. `conditionsDiffer` names differences of the results' own conditions, which make
 * every metric incompatible.
 */
export function compareProductLatency(baseline: readonly LatencyEntry[], candidate: readonly LatencyEntry[], conditionsDiffer: readonly string[] = []): MetricComparison[] {
  const left = latencyReview(baseline).metrics;
  const right = latencyReview(candidate).metrics;
  const sameDevices = devicesOf(baseline).join('\u0001') === devicesOf(candidate).join('\u0001');
  const out: MetricComparison[] = [];
  for (const { metric, groups } of left) {
    const base = groups[0]!;
    const other = right.find(item => item.metric.key === metric.key)?.groups[0];
    if (!other) {
      const renamed = right.find(item => item.metric.name === metric.name);
      out.push({ state: 'baseline-only', name: metric.name, summary: base, reasons: [renamed ? `The candidate measures ${metric.name} over a different interval (${renamed.metric.boundary.label}), so the two are not the same measurement.` : 'The candidate recorded no such measurement.'] });
      continue;
    }
    const change = compareLatency(base, other);
    const reasons = [...conditionsDiffer.map(line => `Recorded under different conditions: ${line}.`)];
    if (!sameDevices) reasons.push(`Devices differ: ${devicesOf(baseline).join(', ')} against ${devicesOf(candidate).join(', ')}.`);
    if (change.comparable) {
      reasons.push(...change.disclosures.filter(line => /^(Environments differ|Test conditions differ|Instrumentation changed)/.test(line)));
    } else reasons.push(...change.reasons);
    if (reasons.length) out.push({ state: 'incompatible', name: metric.name, baseline: base, candidate: other, change: null, reasons });
    else out.push({ state: 'compared', name: metric.name, baseline: base, candidate: other, change, reasons: change.disclosures });
  }
  for (const { metric, groups } of right) {
    if (!left.some(item => item.metric.key === metric.key) && !left.some(item => item.metric.name === metric.name)) {
      out.push({ state: 'candidate-only', name: metric.name, summary: groups[0]!, reasons: ['The baseline recorded no such measurement.'] });
    }
  }
  return out;
}

/** How reliable a check was on each side, and whether the two figures can be set against each other. */
export type ReliabilityComparison = {
  /** True only when both figures are established, were counted in the same scope and against the same recorded spec revision. */
  readonly comparable: boolean;
  readonly baseline: ReliabilityRate;
  readonly candidate: ReliabilityRate;
  /** Candidate minus baseline, in percentage points, only when comparable. */
  readonly points?: number;
  /** `higher` or `lower` only when the two intervals do not overlap; `indistinguishable` when they do. Absent when not comparable. */
  readonly direction?: 'higher' | 'lower' | 'indistinguishable';
  /** Why no change is stated, or what qualifies one. */
  readonly reasons: readonly string[];
};

/**
 * The scope that counts the independent executions of one result's check up to the end of its run: the same
 * environment, producer and parameters, and the spec revision that result was recorded against (executions against
 * another revision are other promises). A result that recorded no revision is counted across revisions, which
 * {@link compareReliability} will not compare. Use it for each side, with that side's result and run.
 */
export function reliabilityScopeAt(result: Pick<RunResult, 'environment' | 'producer' | 'parameters' | 'specRevision'>, run: Pick<RunSummary, 'endedAtMs'>): ReliabilityScope {
  return {
    ...(result.environment ? { environment: [result.environment] } : {}),
    producer: [result.producer],
    ...(result.parameters && Object.keys(result.parameters).length ? { parameter: Object.entries(result.parameters).map(([name, value]) => `${name}=${value}`).sort() } : {}),
    ...(result.specRevision ? { specRevision: [result.specRevision] } : { revision: 'any' as const }),
    until: run.endedAtMs
  };
}

/**
 * Sets the reliability of a check up to the baseline run against its reliability up to the candidate run. A change is
 * stated only when both samples are established (at least `minimumExecutions` independent executions), both counted the
 * same recorded spec revision (see {@link reliabilityScopeAt}) and the conditions match; whether the difference exceeds the uncertainty is
 * said by `direction`. Otherwise each figure stands alone and the reasons say why.
 */
export function compareReliability(baseline: ReliabilityDocument, candidate: ReliabilityDocument, conditionsDiffer: readonly string[] = []): ReliabilityComparison {
  const reasons: string[] = conditionsDiffer.map(line => `Counted under different conditions: ${line}.`);
  for (const [name, document] of [['baseline', baseline], ['candidate', candidate]] as const) {
    if (document.sample === 'none') reasons.push(`The ${name} figure has no completed execution, so it is unknown, not reliable.`);
    else if (document.sample === 'insufficient') reasons.push(`The ${name} figure rests on ${document.eventual.executions} independent ${document.eventual.executions === 1 ? 'execution' : 'executions'}; at least ${document.minimumExecutions} are needed.`);
  }
  const revisionOf = (document: ReliabilityDocument) => document.scope.specRevision?.join(',') ?? null;
  if (revisionOf(baseline) === null || revisionOf(candidate) === null) reasons.push('A side recorded no spec revision, so whether both count the same promise is unknown.');
  else if (revisionOf(baseline) !== revisionOf(candidate)) reasons.push('The executions were counted against different revisions of the spec, so they describe different promises.');
  const base = baseline.eventual;
  const cand = candidate.eventual;
  if (reasons.length || base.rate === null || cand.rate === null) return { comparable: false, baseline: base, candidate: cand, reasons };
  const separate = baseline.interval && candidate.interval ? baseline.interval.upper < candidate.interval.lower || candidate.interval.upper < baseline.interval.lower : false;
  const points = Math.round((cand.rate - base.rate) * 1000) / 10;
  return {
    comparable: true,
    baseline: base,
    candidate: cand,
    points,
    direction: !separate ? 'indistinguishable' : cand.rate > base.rate ? 'higher' : 'lower',
    reasons: separate ? [] : ['The two intervals overlap, so the difference may be chance. It is not shown as an improvement or a decline.']
  };
}

/** The part of a recorded step this module reads. */
export type StepLike = { readonly name: string; readonly offsetMs?: number | undefined };

/** One step, found on one or both sides. */
export type AlignedStep = {
  readonly name: string;
  /** Milliseconds after the check began, on each side; absent when that side did not record it or its time. */
  readonly baselineOffsetMs?: number;
  readonly candidateOffsetMs?: number;
  readonly onBaseline: boolean;
  readonly onCandidate: boolean;
};

/** How the recorded steps of two results line up. */
export type StepAlignment = {
  /** `aligned`: some step is on both sides with a time on both (a recording can be sought to it); `unaligned`: otherwise. */
  readonly state: 'aligned' | 'unaligned';
  readonly steps: readonly AlignedStep[];
  /** The steps with a time on both sides: where both recordings can be sought together. */
  readonly seekable: readonly (AlignedStep & { readonly baselineOffsetMs: number; readonly candidateOffsetMs: number })[];
  /** Whether the two lists of step names differ (the steps themselves are part of the promise). */
  readonly differs: boolean;
  /** In words, why the recordings are or are not aligned. */
  readonly explanation: string;
};

/**
 * Lines up the recorded steps of two results by name (the n-th step of a name on one side with the n-th of that name on
 * the other), keeping each side's own time origin: an offset is milliseconds after that side's check began. Nothing is
 * aligned by position or by fuzzy wording. When nothing lines up, `explanation` says why.
 */
export function alignSteps(baseline: readonly StepLike[], candidate: readonly StepLike[]): StepAlignment {
  const keyed = (steps: readonly StepLike[]) => {
    const seen = new Map<string, number>();
    return steps.map(step => {
      const n = seen.get(step.name) ?? 0;
      seen.set(step.name, n + 1);
      return { step, id: `${n}\u0001${step.name}` };
    });
  };
  const left = keyed(baseline);
  const right = keyed(candidate);
  const rightById = new Map(right.map(item => [item.id, item.step]));
  const leftIds = new Set(left.map(item => item.id));
  const steps: AlignedStep[] = [];
  for (const { step, id } of left) {
    const other = rightById.get(id);
    steps.push({
      name: step.name,
      ...(step.offsetMs === undefined ? {} : { baselineOffsetMs: step.offsetMs }),
      ...(other?.offsetMs === undefined ? {} : { candidateOffsetMs: other.offsetMs }),
      onBaseline: true,
      onCandidate: other !== undefined
    });
  }
  for (const { step, id } of right) {
    if (!leftIds.has(id)) steps.push({ name: step.name, ...(step.offsetMs === undefined ? {} : { candidateOffsetMs: step.offsetMs }), onBaseline: false, onCandidate: true });
  }
  const seekable = steps.filter((step): step is AlignedStep & { baselineOffsetMs: number; candidateOffsetMs: number } => step.baselineOffsetMs !== undefined && step.candidateOffsetMs !== undefined);
  const shared = steps.filter(step => step.onBaseline && step.onCandidate).length;
  const differs = steps.some(step => !(step.onBaseline && step.onCandidate));
  let explanation: string;
  if (seekable.length > 0) explanation = `${seekable.length} recorded ${seekable.length === 1 ? 'step is' : 'steps are'} on both sides with a time. Seeking uses each side's own step time from the start of its own check; the recordings are otherwise not synchronized.`;
  else if (!baseline.length && !candidate.length) explanation = 'Neither side recorded steps, so the recordings cannot be aligned. Each plays from its own start.';
  else if (!baseline.length || !candidate.length) explanation = `Only the ${baseline.length ? 'baseline' : 'candidate'} recorded steps, so the recordings cannot be aligned. Each plays from its own start.`;
  else if (shared === 0) explanation = 'The two sides share no step name, so the recordings cannot be aligned. Each plays from its own start.';
  else explanation = 'The shared steps carry no time on both sides, so the recordings cannot be aligned. Each plays from its own start.';
  return { state: seekable.length > 0 ? 'aligned' : 'unaligned', steps, seekable, differs, explanation };
}
