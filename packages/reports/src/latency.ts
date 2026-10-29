/**
 * @module Product latency
 *
 * Tells how quickly a product responded apart from how long a test took. A test's `durationMs` includes fixture setup,
 * deliberate waits, demo pacing, retries and cleanup, so it says nothing about a user's wait. Product latency is only
 * what a producer measured and named as such: a measurement of `kind` `product-latency` between two named events
 * (`from`, `to`), optionally with a budget (`limit`), an outcome (`observed`, `timeout`, `failed`), the instrumentation,
 * and labels (`device`, `build`) in its `labels`. Pure functions, safe in a browser.
 *
 * The rules, each of which keeps a number from looking healthier or more certain than the evidence is:
 *
 * - **Only named measurements are latency.** A check's duration, a video's length, a recorded step and a number with no
 *   `kind` are never product latency. No latency recorded is unknown, not fast.
 * - **Boundaries are part of the claim.** Without both `from` and `to`, nothing is claimed from the numbers. When
 *   `intended` names a longer interval than the one measured (speech end to TTS dispatch, claimed as microphone to
 *   audible response) the measurement is partial and says so.
 * - **Percentiles need samples.** p50 needs {@link MIN_P50_SAMPLES} observations and p95 {@link MIN_P95_SAMPLES}; below
 *   that they are withheld with the reason, never shown as if supported.
 * - **A timeout or failed observation is a sample.** Its value is how long it waited, so a lower bound: it counts
 *   in the sample, in the percentiles and as a budget breach, and the summary says the figures are lower bounds.
 * - **Comparisons are of the same metric.** Different boundaries are not compared; a change of instrumentation,
 *   environment, budget or other condition between the two sides is disclosed beside the change.
 *
 * It decides nothing: a latency, a budget breach and a comparison never change a status, a slot or a winner.
 *
 * @see docs/rich-evidence.md#product-latency
 */
import type { EvidenceMeasurement } from './explorer-types';

/** The `kind` of a measurement that is a user-visible product latency. */
export const PRODUCT_LATENCY = 'product-latency';
/** Observations needed before a p50 is shown. */
export const MIN_P50_SAMPLES = 5;
/** Observations needed before a p95 is shown. */
export const MIN_P95_SAMPLES = 20;

/** Whether a measurement is a product latency: only the producer's `kind` makes it one. A name, a unit or a value never does. */
export function isProductLatency(measurement: Pick<EvidenceMeasurement, 'kind'>): boolean {
  return measurement.kind === PRODUCT_LATENCY;
}

/**
 * The product-latency measurements of a check, or undefined when it has none (so a result with no latency carries
 * nothing). Measurements that are not well formed (no finite value, no name) are left out.
 */
export function productLatency(measurements: readonly EvidenceMeasurement[] | undefined): readonly EvidenceMeasurement[] | undefined {
  if (!measurements?.length) return undefined;
  const found = measurements.filter(m => isProductLatency(m) && typeof m.name === 'string' && m.name !== '' && Number.isFinite(m.value));
  return found.length ? found : undefined;
}

/** How well the ends of a measurement are known: `declared` (both named), `partial` (it stops short of, or starts after, what it claims) or `undeclared`. */
export type BoundaryState = 'declared' | 'partial' | 'undeclared';

/** The ends of a measurement, in words, and whether they support a claim about the user's wait. */
export type Boundary = {
  readonly state: BoundaryState;
  readonly from?: string;
  readonly to?: string;
  /** The interval the measurement's name claims, when it is longer than what was measured. */
  readonly intended?: string;
  /** `submit pressed to confirmation visible`, `to confirmation visible (start not declared)`. */
  readonly label: string;
};

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/**
 * What a measurement spans. `undeclared` when either end is missing: the numbers are shown and no product claim is made.
 * `partial` when `intended` names a different end than the measured one: the interval is the measured one, never the intended.
 */
export function boundaryOf(measurement: Pick<EvidenceMeasurement, 'from' | 'to' | 'intended'>): Boundary {
  const from = text(measurement.from), to = text(measurement.to);
  const intendedFrom = text(measurement.intended?.from), intendedTo = text(measurement.intended?.to);
  const base = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  if (!from || !to) {
    const label = from ? `from ${from} (end not declared)` : to ? `to ${to} (start not declared)` : 'boundaries not declared';
    return { state: 'undeclared', ...base, label };
  }
  const shorter = (intendedFrom !== undefined && intendedFrom !== from) || (intendedTo !== undefined && intendedTo !== to);
  const label = `${from} to ${to}`;
  if (!shorter) return { state: 'declared', ...base, label };
  return { state: 'partial', ...base, intended: `${intendedFrom ?? from} to ${intendedTo ?? to}`, label };
}

/** What happened to one observation: `observed`, or it `timeout`ed or `failed`, or the producer said something Atlas cannot read (`unclear`). */
export type ObservationOutcome = 'observed' | 'timeout' | 'failed' | 'unclear';

function outcomeOf(value: unknown): ObservationOutcome {
  if (value === undefined || value === 'observed') return 'observed';
  return value === 'timeout' || value === 'failed' ? value : 'unclear';
}

const TIME_UNITS: Readonly<Record<string, number>> = { ms: 1, millisecond: 1, milliseconds: 1, s: 1000, sec: 1000, second: 1000, seconds: 1000, us: 0.001, 'µs': 0.001 };

/** One recorded result, as much of it as this module reads. A `TestResultEntry` is one. */
export type LatencyEntry = {
  /** When it was recorded, epoch milliseconds. */
  readonly at: number;
  readonly environment: string | null;
  readonly parameters: Readonly<Record<string, string>>;
  readonly sha: string | null;
  readonly layer: string;
  readonly run?: string;
  readonly latency?: readonly EvidenceMeasurement[];
  readonly evidence?: { readonly labels: Readonly<Record<string, string>> };
};

/** One observation of a latency. Time units are converted to milliseconds. */
export type LatencyObservation = {
  readonly name: string;
  readonly unit: string;
  readonly value: number;
  readonly limit?: number;
  readonly outcome: ObservationOutcome;
  readonly boundary: Boundary;
  readonly source?: string;
  readonly instrumentation?: string;
  readonly cohort: Readonly<Record<string, string>>;
  readonly at: number;
  readonly layer: string;
  readonly environment: string | null;
  readonly parameters: Readonly<Record<string, string>>;
  readonly labels: Readonly<Record<string, string>>;
  readonly sha: string | null;
};

/** The observations in recorded results, in the order given. Entries with no latency contribute none. */
export function latencyObservations(entries: readonly LatencyEntry[]): LatencyObservation[] {
  const out: LatencyObservation[] = [];
  for (const entry of entries) {
    for (const m of productLatency(entry.latency) ?? []) {
      const factor = TIME_UNITS[m.unit.trim().toLowerCase()];
      const unit = factor === undefined ? m.unit : 'ms';
      const scale = (n: number) => (factor === undefined ? n : n * factor);
      const cohort: Record<string, string> = {};
      for (const [key, value] of Object.entries(m.labels ?? {})) if (typeof value === 'string') cohort[key] = value;
      const source = text(m.source), instrumentation = text(m.instrumentation);
      out.push({
        name: m.name, unit, value: scale(m.value), ...(Number.isFinite(m.limit) ? { limit: scale(m.limit!) } : {}),
        outcome: outcomeOf(m.outcome), boundary: boundaryOf(m), ...(source ? { source } : {}), ...(instrumentation ? { instrumentation } : {}),
        cohort, at: entry.at, layer: entry.layer, environment: entry.environment, parameters: entry.parameters, labels: entry.evidence?.labels ?? {}, sha: entry.sha
      });
    }
  }
  return out;
}

/** How observations are grouped: not at all, by `device`, by `build`, or by the UTC `window` (day) they were recorded in. */
export type LatencyGrouping = 'none' | 'device' | 'build' | 'window';
/** The groupings, in the order a control offers them. */
export const LATENCY_GROUPINGS: readonly LatencyGrouping[] = ['none', 'device', 'build', 'window'];

/**
 * The group an observation falls in. `device` is the measurement's cohort, else the result's label, parameter or
 * environment; `build` is the cohort or label, else the commit. One that names nothing is `unknown device` or
 * `unknown build`: it is never merged into a named group.
 */
export function groupOf(observation: LatencyObservation, by: LatencyGrouping): string {
  if (by === 'none') return 'All observations';
  if (by === 'window') return new Date(observation.at).toISOString().slice(0, 10);
  const { cohort, labels, parameters } = observation;
  if (by === 'device') return cohort.device ?? labels.device ?? parameters.device ?? observation.environment ?? 'unknown device';
  return cohort.build ?? labels.build ?? (observation.sha ? observation.sha.slice(0, 10) : 'unknown build');
}

/** A measured interval: the name, the unit and the ends. Observations of one metric are comparable; of two metrics they are not. */
export type LatencyMetric = {
  /** Equal for observations of the same name, unit and boundaries. */
  readonly key: string;
  readonly name: string;
  readonly unit: string;
  readonly boundary: Boundary;
};

/** What the observations of one metric in one group show, and what they cannot. */
export type LatencySummary = {
  readonly metric: LatencyMetric;
  /** The group (a device, a build, a day, or all). */
  readonly group: string;
  /** Every observation, including those that timed out or failed. */
  readonly samples: number;
  /** Observations that completed. */
  readonly observed: number;
  readonly timeouts: number;
  readonly failures: number;
  /** Observations over their budget, plus every timeout or failure when a budget is set. */
  readonly breaches: number;
  /** The budget, from the newest observation that has one. */
  readonly budget?: number;
  /** The median, or undefined with the reason in `withheld`. */
  readonly p50?: number;
  readonly p95?: number;
  /** Why a figure is not shown, in words. */
  readonly withheld: readonly string[];
  /** True when a timeout or failure's waiting time is in the figures: they are lower bounds. */
  readonly lowerBound: boolean;
  readonly max: number;
  /** The newest observation's value. */
  readonly last: number;
  readonly lastAt: number;
  /** Whether the numbers support a statement about the user's wait: false when the boundaries are not declared. */
  readonly claim: boolean;
  /** What the reader must not assume, in words: partial interval, missing boundaries, a single observation. */
  readonly gaps: readonly string[];
  readonly instrumentation: readonly string[];
  readonly environments: readonly string[];
  /** Other facts the observations differ by: cohort entries and parameters, as `key=value`. */
  readonly conditions: readonly string[];
  readonly budgets: readonly number[];
};

/** The metrics of a result set, each with its summary in every group, groups newest first. */
export type LatencyReview = {
  readonly by: LatencyGrouping;
  readonly metrics: readonly { readonly metric: LatencyMetric; readonly groups: readonly LatencySummary[] }[];
  /** Results that recorded no product latency. They are unknown, not fast. */
  readonly unmeasured: number;
  /** Results that did. */
  readonly measured: number;
};

const metricOf = (o: LatencyObservation): LatencyMetric => ({
  key: [o.name, o.unit, o.boundary.from ?? '', o.boundary.to ?? ''].join('\u0001'), name: o.name, unit: o.unit, boundary: o.boundary
});

const sorted = (set: Iterable<string>) => [...set].sort();

/** Nearest-rank percentile of ascending `values`, as the test duration statistics compute it. */
function percentile(values: readonly number[], q: number): number {
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(q * values.length) - 1))]!;
}

function summarize(metric: LatencyMetric, group: string, observations: readonly LatencyObservation[]): LatencySummary {
  const newest = [...observations].sort((a, b) => b.at - a.at || (a.layer < b.layer ? 1 : -1));
  const values = observations.map(o => o.value).sort((a, b) => a - b);
  const observed = observations.filter(o => o.outcome === 'observed').length;
  const timeouts = observations.filter(o => o.outcome === 'timeout').length;
  const failures = observations.length - observed - timeouts;
  const budgets = [...new Set(observations.flatMap(o => (o.limit === undefined ? [] : [o.limit])))].sort((a, b) => a - b);
  const breaches = observations.filter(o => o.limit !== undefined && (o.outcome !== 'observed' || o.value > o.limit)).length;
  const budget = newest.find(o => o.limit !== undefined)?.limit;
  const withheld: string[] = [];
  const gaps: string[] = [];
  const claim = metric.boundary.state !== 'undeclared';
  let p50: number | undefined, p95: number | undefined;
  if (!claim) {
    withheld.push(`Percentiles are withheld: ${metric.boundary.label}, so these numbers are not shown as how long a user waits.`);
    gaps.push(`${metric.boundary.label[0]!.toUpperCase()}${metric.boundary.label.slice(1)}: the evidence does not say what was timed.`);
  } else {
    if (values.length >= MIN_P50_SAMPLES) p50 = percentile(values, 0.5);
    else withheld.push(`p50 needs ${MIN_P50_SAMPLES} observations; there ${values.length === 1 ? 'is 1' : `are ${values.length}`}.`);
    if (values.length >= MIN_P95_SAMPLES) p95 = percentile(values, 0.95);
    else withheld.push(`p95 needs ${MIN_P95_SAMPLES} observations; there ${values.length === 1 ? 'is 1' : `are ${values.length}`}.`);
  }
  if (metric.boundary.state === 'partial') gaps.push(`Partial: measured ${metric.boundary.label}, not ${metric.boundary.intended}. It is not the full ${metric.boundary.intended} latency.`);
  if (values.length === 1) gaps.push('One observation: no spread, confidence or percentile can be drawn from it.');
  if (timeouts + failures > 0) gaps.push(`${timeouts + failures} of ${values.length} did not complete (${[timeouts ? `${timeouts} timed out` : '', failures ? `${failures} failed` : ''].filter(Boolean).join(', ')}); their value is how long they waited, so the figures are lower bounds.`);
  if (budgets.length > 1) gaps.push(`The budget changed across these observations (${budgets.join(', ')} ${metric.unit}).`);
  const conditions = new Set<string>();
  for (const o of observations) {
    for (const [key, value] of Object.entries(o.cohort)) if (key !== 'device' && key !== 'build') conditions.add(`${key}=${value}`);
    for (const [key, value] of Object.entries(o.parameters)) conditions.add(`${key}=${value}`);
  }
  return {
    metric, group, samples: observations.length, observed, timeouts, failures, breaches, ...(budget === undefined ? {} : { budget }),
    ...(p50 === undefined ? {} : { p50 }), ...(p95 === undefined ? {} : { p95 }), withheld, lowerBound: timeouts + failures > 0,
    max: values.at(-1)!, last: newest[0]!.value, lastAt: newest[0]!.at, claim, gaps,
    instrumentation: sorted(new Set(observations.map(o => o.instrumentation ?? 'not declared'))),
    environments: sorted(new Set(observations.map(o => o.environment ?? 'not declared'))), conditions: sorted(conditions), budgets
  };
}

/**
 * Reads recorded results (any order) into a review: for every metric, a summary in every group. A result with no
 * product latency counts only in `unmeasured`. Metrics are listed by name; groups newest first.
 *
 * @param by How observations are grouped. Default `none`.
 * @example
 * ```ts
 * const review = latencyReview(history.history, 'build');
 * review.metrics[0]?.groups[0]?.p95; // undefined until 20 observations of that build
 * ```
 */
export function latencyReview(entries: readonly LatencyEntry[], by: LatencyGrouping = 'none'): LatencyReview {
  const cells = new Map<string, { metric: LatencyMetric; groups: Map<string, LatencyObservation[]> }>();
  for (const o of latencyObservations(entries)) {
    const metric = metricOf(o);
    const cell = cells.get(metric.key) ?? { metric, groups: new Map() };
    cells.set(metric.key, cell);
    const group = groupOf(o, by);
    const list = cell.groups.get(group);
    if (list) list.push(o); else cell.groups.set(group, [o]);
  }
  const metrics = [...cells.values()].map(({ metric, groups }) => ({
    metric, groups: [...groups].map(([group, list]) => summarize(metric, group, list)).sort((a, b) => b.lastAt - a.lastAt || (a.group < b.group ? -1 : 1))
  })).sort((a, b) => (a.metric.name < b.metric.name ? -1 : a.metric.name > b.metric.name ? 1 : a.metric.key < b.metric.key ? -1 : 1));
  const measured = entries.filter(e => productLatency(e.latency)).length;
  return { by, metrics, unmeasured: entries.length - measured, measured };
}

/** A change of one figure from the baseline to the candidate. */
export type LatencyDelta = {
  readonly baseline: number;
  readonly candidate: number;
  /** Candidate minus baseline, in the metric's unit. Positive is slower. */
  readonly absolute: number;
  /** The absolute change over the baseline, or null when the baseline is zero. */
  readonly relative: number | null;
};

/** What changed between two summaries, or why that cannot be said. */
export type LatencyChange = {
  /** Whether a change is stated at all. */
  readonly comparable: boolean;
  /** `p50` or `p95` when both sides support it; `last` compares the newest observation of each, which is not a percentile. */
  readonly basis?: 'p50' | 'p95' | 'last';
  readonly p50?: LatencyDelta;
  readonly p95?: LatencyDelta;
  readonly last?: LatencyDelta;
  /** Why no change is stated. */
  readonly reasons: readonly string[];
  /** Differences in how the two sides were measured or run. A change should be read with them. */
  readonly disclosures: readonly string[];
};

const delta = (baseline: number, candidate: number): LatencyDelta => ({ baseline, candidate, absolute: candidate - baseline, relative: baseline === 0 ? null : (candidate - baseline) / baseline });
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * The change from a baseline to a candidate of the same metric. Different metrics (names, units or boundaries) are not
 * compared and the reason is given. When both sides support p50 (and p95) the change is of those; otherwise only the
 * newest observation of each is compared, labelled as such. Changes of instrumentation, environments, other
 * conditions, budget and partial or lower-bound figures are listed in `disclosures`, never hidden.
 */
export function compareLatency(baseline: LatencySummary, candidate: LatencySummary): LatencyChange {
  const reasons: string[] = [];
  const disclosures: string[] = [];
  if (baseline.metric.key !== candidate.metric.key) {
    reasons.push(baseline.metric.name === candidate.metric.name
      ? `The measured interval differs (${baseline.metric.boundary.label} against ${candidate.metric.boundary.label}), so the two are not the same measurement.`
      : 'These are different measurements.');
    return { comparable: false, reasons, disclosures };
  }
  if (!baseline.claim) return { comparable: false, reasons: ['The baseline does not say what it timed.'], disclosures };
  if (!sameSet(baseline.instrumentation, candidate.instrumentation)) disclosures.push(`Instrumentation changed: ${baseline.instrumentation.join(', ')} became ${candidate.instrumentation.join(', ')}.`);
  if (!sameSet(baseline.environments, candidate.environments)) disclosures.push(`Environments differ: ${baseline.environments.join(', ')} against ${candidate.environments.join(', ')}.`);
  if (!sameSet(baseline.conditions, candidate.conditions)) disclosures.push(`Test conditions differ: ${baseline.conditions.join(', ') || 'none declared'} against ${candidate.conditions.join(', ') || 'none declared'}.`);
  if (baseline.budget !== candidate.budget) disclosures.push(`The budget differs: ${baseline.budget ?? 'none'} against ${candidate.budget ?? 'none'} ${candidate.metric.unit}.`);
  if (baseline.lowerBound || candidate.lowerBound) disclosures.push('Timeouts or failures are in these figures, so they are lower bounds.');
  if (candidate.metric.boundary.state === 'partial') disclosures.push(`Only part of the interval is measured (${candidate.metric.boundary.label}, not ${candidate.metric.boundary.intended}).`);
  const p50 = baseline.p50 !== undefined && candidate.p50 !== undefined ? delta(baseline.p50, candidate.p50) : undefined;
  const p95 = baseline.p95 !== undefined && candidate.p95 !== undefined ? delta(baseline.p95, candidate.p95) : undefined;
  if (p50 || p95) return { comparable: true, basis: p50 ? 'p50' : 'p95', ...(p50 ? { p50 } : {}), ...(p95 ? { p95 } : {}), reasons, disclosures };
  disclosures.push(`Percentiles are not supported on both sides (${baseline.samples} against ${candidate.samples} observations), so only the newest observation of each is compared.`);
  return { comparable: true, basis: 'last', last: delta(baseline.last, candidate.last), reasons, disclosures };
}

/** `500 ms`, `1.2 s`: a latency in the largest unit that keeps it readable. Non-time units print as given. */
export function formatLatency(value: number | undefined, unit: string): string {
  if (value === undefined || !Number.isFinite(value)) return 'withheld';
  if (unit !== 'ms') return `${Number(value.toFixed(2))} ${unit}`;
  return Math.abs(value) >= 1000 ? `${Number((value / 1000).toFixed(2))} s` : `${Number(value.toFixed(1))} ms`;
}
