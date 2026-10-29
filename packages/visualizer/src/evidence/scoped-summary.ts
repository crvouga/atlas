/**
 * @module Scoped behavior summary
 *
 * The short account that sits beside a behavior's written promise and recording: what the selected result says, how
 * reliable the check has been, and how quickly the product responded. It does not compute anything of its own. The
 * outcome is {@link outcomeHeadline}; reliability is `reliability` and product latency is `latencyReview` from the
 * reports library, read over the history of the same check in the same environment as the recording shown. This module
 * only chooses the scope and puts the qualified figures into short sentences, keeping every qualification that makes a
 * figure honest: how many independent executions it rests on, that a small sample is not established, which notes warn
 * against reading it as representative, and that absent evidence is unknown, never good.
 */
import { formatLatency, latencyReview, type LatencyReview } from '@crvouga/atlas/reports/latency';
import { reliability, scopeText, type ReliabilityDocument, type ReliabilityScope } from '@crvouga/atlas/reports/reliability';
import type { TestResultEntry } from '@crvouga/atlas/reports/test-catalog';

import { plural } from './format';

/** One line of the summary: the figure in words, and what qualifies it. */
export type SummaryLine = {
  readonly headline: string;
  /** What a reader must keep in mind: sample size, scope, warnings. Never empty for a figure. */
  readonly qualifiers: readonly string[];
  /** `figure`: a number supported by evidence. `unknown`: there is no evidence to state. `weak`: a figure that its own qualifiers say not to rely on. */
  readonly tone: 'figure' | 'weak' | 'unknown';
};

/** The scope the summary describes: the environment of the shown result, so environments are never pooled silently. */
export type SummaryScope = {
  /** The environment of the result shown; null when it recorded none (then every environment is pooled and the summary says so). */
  readonly environment: string | null;
};

const percent = (rate: number | null) => (rate === null ? 'no rate' : `${Math.round(rate * 1000) / 10}%`);

/** The reliability scope for a summary scope. */
export function reliabilityScope(scope: SummaryScope): ReliabilityScope {
  return scope.environment === null ? {} : { environment: [scope.environment] };
}

/** The recorded results of the summary's scope: those of its environment, or all when it names none. */
export function entriesInScope(entries: readonly TestResultEntry[], scope: SummaryScope): readonly TestResultEntry[] {
  return scope.environment === null ? entries : entries.filter((entry) => entry.environment === scope.environment);
}

/**
 * Reliability in one sentence and its qualifiers. A count of independent executions always comes with the figure;
 * fewer than the minimum is "Insufficient evidence"; none is unknown. The library's warning notes are carried over.
 */
export function reliabilityLine(document: ReliabilityDocument): SummaryLine {
  const { eventual, firstAttempt } = document;
  const where = scopeText(document.scope);
  if (document.sample === 'none') {
    return {
      headline: 'Reliability is unknown: no independent execution is recorded in this scope.',
      qualifiers: [`Scope: ${where}.`],
      tone: 'unknown'
    };
  }
  const qualifiers = [`Scope: ${where}.`];
  if (document.sample === 'insufficient') {
    qualifiers.push(`Insufficient evidence: at least ${document.minimumExecutions} independent executions are needed before a rate means much.`);
  }
  qualifiers.push(
    firstAttempt.executions
      ? `${firstAttempt.passed} of ${plural(firstAttempt.executions, 'execution', 'executions')} passed first time.`
      : 'First-try success is unknown: no tries were recorded.'
  );
  for (const note of document.notes) if (note.severity === 'warning') qualifiers.push(note.message);
  return {
    headline: `${eventual.passed} of ${plural(eventual.executions, 'independent execution', 'independent executions')} passed in the end (${percent(eventual.rate)}).`,
    qualifiers,
    tone: document.sample === 'insufficient' || document.notes.some((note) => note.severity === 'warning') ? 'weak' : 'figure'
  };
}

/**
 * Product latency: one line per measurement a producer named as product latency. The test's own duration is never read
 * here. Percentiles the evidence cannot support are said to be withheld with their reason; with no measurement the
 * answer is unknown, not fast.
 */
export function latencyLines(review: LatencyReview): readonly SummaryLine[] {
  if (review.metrics.length === 0) {
    return [
      {
        headline: 'Product latency is unknown: no product-latency measurement is recorded.',
        qualifiers: ['The duration of the test is not product latency and is not shown here.'],
        tone: 'unknown'
      }
    ];
  }
  return review.metrics.flatMap(({ metric, groups }) =>
    groups.map<SummaryLine>((summary) => {
      const figures = [
        summary.p50 === undefined ? undefined : `p50 ${formatLatency(summary.p50, metric.unit)}`,
        summary.p95 === undefined ? undefined : `p95 ${formatLatency(summary.p95, metric.unit)}`
      ].filter((figure): figure is string => figure !== undefined);
      const qualifiers = [`${plural(summary.samples, 'observation', 'observations')}${summary.lowerBound ? ', including some that did not complete (lower bounds)' : ''}.`];
      if (summary.budget !== undefined) {
        qualifiers.push(`Budget ${formatLatency(summary.budget, metric.unit)}: ${plural(summary.breaches, 'observation', 'observations')} over it.`);
      }
      qualifiers.push(...summary.withheld, ...summary.gaps);
      return {
        headline: `${metric.name}${metric.boundary.label ? ` (${metric.boundary.label})` : ''}: ${figures.length ? figures.join(', ') : 'no percentile can be stated'}.`,
        qualifiers,
        tone: figures.length > 0 && summary.gaps.length === 0 ? 'figure' : 'weak'
      };
    })
  );
}

/** Reliability and product latency of one check in a scope, worked out from its recorded history. */
export function scopedFigures(key: string, history: readonly TestResultEntry[], scope: SummaryScope) {
  const entries = entriesInScope(history, scope);
  return {
    reliability: reliabilityLine(reliability(key, history, reliabilityScope(scope))),
    latency: latencyLines(latencyReview(entries))
  };
}
