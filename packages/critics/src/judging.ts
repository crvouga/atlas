/**
 * @module State-aware judging, calibration and modes
 *
 * A raw score is not absolute. A loading overlay is not a full screen, so a score is read against the project's scores
 * of the same state kind (`relativeVerdict`), and a threshold is measured per critic and per state kind against labelled
 * examples (`calibrate`), recording sample sizes, precision and recall and whether the figures are in-sample or
 * held-out. What happens when a score is low is the project's choice (`gateDecision`): `report` (shown, never fails
 * anything), `warn` (surfaced on the command line) or `gate` (exit code 1 when a threshold is crossed, but only on a
 * calibration with enough held-out evidence). A gate is computed here, by the reader, from critique data. It never
 * changes a check's status, a slot or a winner.
 *
 * All scores are "higher is better". Everything here is pure.
 *
 * @see docs/critics.md#state-aware-judging-calibration-and-modes
 */
import type { Critique } from '../../schema/src/critique';

/** The relative reading of a score, as stored in `verdict.relative`. */
export type Relative = NonNullable<NonNullable<Critique['verdict']>['relative']>;

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Reads a score against the scores of the same state kind, and against the same entry's previous image.
 *
 * `percentile` is where the score falls among the population's scores of `stateKind` (ties count half), 0..100, higher
 * is better; it is absent when no score of that state kind is known. Scores of other state kinds are ignored, so a
 * loading overlay is compared with other loading overlays and never with full screens. `delta` is the score minus
 * `previousScore` when there was one.
 *
 * @param args.score the entry's raw score.
 * @param args.stateKind the kind of UI state of the entry.
 * @param args.population every known score of the critic, with its state kind. May include the entry's own.
 * @param args.previousScore the critic's score for the entry's previous image, when there was one.
 */
export function relativeVerdict(args: { readonly score: number; readonly stateKind: string; readonly population: readonly { readonly stateKind: string; readonly score: number }[]; readonly previousScore?: number }): Relative {
  const peers = args.population.filter(item => item.stateKind === args.stateKind && Number.isFinite(item.score));
  const below = peers.filter(item => item.score < args.score).length;
  const equal = peers.filter(item => item.score === args.score).length;
  return {
    stateKind: args.stateKind,
    sampleSize: peers.length,
    ...(peers.length ? { percentile: round(((below + equal / 2) / peers.length) * 100) } : {}),
    ...(args.previousScore !== undefined && Number.isFinite(args.previousScore) ? { previousScore: args.previousScore, delta: round(args.score - args.previousScore) } : {})
  };
}

/** A labelled example for calibration: the critic's score for a UI, its state kind, and whether people judged it bad (needs polish). */
export type LabelledExample = {
  readonly score: number;
  readonly stateKind: string;
  /** True when the UI needs polish: a positive for the critic to find. */
  readonly bad: boolean;
  /** True for an example the threshold was not chosen on. */
  readonly heldOut?: boolean;
};

/** The calibration of one state kind. `threshold` flags a score below it; `null` when the examples cannot tell (one class missing). */
export type KindCalibration = {
  readonly stateKind: string;
  /** Scores below this are flagged as needing polish. `null`: none could be chosen. */
  readonly threshold: number | null;
  /** Examples of this state kind, all together. */
  readonly samples: number;
  /** How many of them are bad, and how many good. */
  readonly positives: number;
  readonly negatives: number;
  /** Of what was flagged, the share that was bad; `null` when nothing was flagged. Measured on the examples named by `evaluatedOn`. */
  readonly precision: number | null;
  /** Of what was bad, the share that was flagged; `null` when nothing was bad. */
  readonly recall: number | null;
  /** True when the figures are measured on the examples the threshold was chosen on, which flatters them. */
  readonly inSample: boolean;
  /** Which examples the precision and recall are over: the `fit` examples (in-sample) or the `held-out` ones. */
  readonly evaluatedOn: 'fit' | 'held-out';
};

/** The result of `calibrate`: per state kind, with the critic's provenance. */
export type Calibration = {
  readonly schema: 1;
  readonly critic: { readonly name: string; readonly version: string };
  readonly kinds: readonly KindCalibration[];
};

function measure(examples: readonly LabelledExample[], threshold: number): { precision: number | null; recall: number | null; f1: number } {
  let tp = 0, fp = 0, fn = 0;
  for (const example of examples) {
    const flagged = example.score < threshold;
    if (flagged && example.bad) tp++;
    else if (flagged) fp++;
    else if (example.bad) fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  return { precision, recall, f1: precision && recall ? (2 * precision * recall) / (precision + recall) : 0 };
}

/**
 * Measures a critic against labelled examples, per state kind, and proposes a threshold for each.
 *
 * The threshold of a state kind is chosen on its examples that are not `heldOut` (best F1, then best precision, then
 * the lower threshold), among the midpoints between neighbouring scores. If there are held-out examples of that kind,
 * precision and recall are measured on them and `inSample` is false; otherwise they are measured on the same examples
 * the threshold was chosen on and `inSample` is true, so nobody mistakes them for evidence. A state kind without both
 * a good and a bad example gets `threshold: null`. State kinds come out sorted.
 *
 * @param critic the critic whose scores these are.
 * @param examples labelled examples; scores must be finite.
 */
export function calibrate(critic: { readonly name: string; readonly version: string }, examples: readonly LabelledExample[]): Calibration {
  const kinds = [...new Set(examples.map(example => example.stateKind))].sort();
  return {
    schema: 1,
    critic: { name: critic.name, version: critic.version },
    kinds: kinds.map(stateKind => {
      const own = examples.filter(example => example.stateKind === stateKind && Number.isFinite(example.score));
      const fit = own.filter(example => !example.heldOut);
      const held = own.filter(example => example.heldOut);
      const scores = [...new Set(fit.map(example => example.score))].sort((a, b) => a - b);
      const usable = fit.some(example => example.bad) && fit.some(example => !example.bad);
      let threshold: number | null = null;
      if (usable) {
        // Midpoints between neighbours, and one above the highest score (flag everything).
        const candidates = [...scores.slice(1).map((score, index) => (score + scores[index]!) / 2), scores[scores.length - 1]! + 1];
        let best = { f1: -1, precision: -1, threshold: 0 };
        for (const candidate of candidates) {
          const { f1, precision } = measure(fit, candidate);
          if (f1 > best.f1 || (f1 === best.f1 && (precision ?? 0) > best.precision)) best = { f1, precision: precision ?? 0, threshold: candidate };
        }
        threshold = round(best.threshold);
      }
      const evaluated = held.length ? held : fit;
      const figures = threshold === null ? { precision: null, recall: null } : measure(evaluated, threshold);
      return {
        stateKind, threshold,
        samples: own.length,
        positives: own.filter(example => example.bad).length,
        negatives: own.filter(example => !example.bad).length,
        precision: figures.precision === null ? null : round(figures.precision),
        recall: figures.recall === null ? null : round(figures.recall),
        inSample: held.length === 0,
        evaluatedOn: held.length ? 'held-out' as const : 'fit' as const
      };
    })
  };
}

/** What happens when a score is below its threshold. `report` shows it and never fails anything. `warn` surfaces it on the command line. `gate` exits 1. */
export type GateMode = 'report' | 'warn' | 'gate';

/** The least evidence a calibration must have before `gate` is allowed. */
export type MinimumEvidence = {
  /** Bad examples and good examples of the state kind, each. Default 10. */
  readonly perClass: number;
  /** Whether precision and recall must be measured on held-out examples. Default true. */
  readonly heldOut: boolean;
};

/** The default minimum evidence for `gate`: 10 bad and 10 good examples per state kind, measured on held-out examples. */
export const DEFAULT_MINIMUM_EVIDENCE: MinimumEvidence = { perClass: 10, heldOut: true };

/** A score below its state kind's threshold. */
export type BelowThreshold = { readonly entryKey: string; readonly stateKind: string; readonly score: number; readonly threshold: number };

/** The decision: the exit code and why. `refusal` is set when `gate` was asked for without enough evidence. */
export type GateDecision = {
  readonly mode: GateMode;
  /** 0 it passes (always, in `report` and `warn`), 1 a threshold was crossed in `gate`, 2 `gate` was refused for lack of evidence. */
  readonly exitCode: 0 | 1 | 2;
  /** Scores below their threshold, in the order given. */
  readonly below: readonly BelowThreshold[];
  /** Entries with no score to judge (the critic failed or gave none). Never counted as below, never as fine. */
  readonly unjudged: readonly string[];
  /** For `warn`: one line per score below its threshold. */
  readonly warnings: readonly string[];
  /** For a refused `gate`: what is missing, per state kind. */
  readonly refusal: readonly string[];
};

/**
 * Decides what a set of critic scores means for the exit code of a command.
 *
 * `report` and `warn` always give exit code 0 (`warn` also lists a warning for each score below its threshold).
 * `gate` gives 1 when any score is below its state kind's threshold, but first requires, for every state kind present, a
 * calibration of this critic and version with a threshold and at least `minimum.perClass` bad and good examples,
 * measured on held-out examples when `minimum.heldOut`. Without that it refuses (exit 2) and says what is missing.
 * An explicit `thresholds` entry replaces the calibrated threshold of its state kind but never waives the evidence.
 *
 * @param args.scores the critic's scores, one per entry; `score: null` for an entry it could not judge.
 * @param args.calibration the critic's calibration, when there is one.
 * @param args.thresholds thresholds by state kind that replace the calibrated ones.
 */
export function gateDecision(args: {
  readonly mode: GateMode;
  readonly critic: { readonly name: string; readonly version: string };
  readonly scores: readonly { readonly entryKey: string; readonly stateKind: string; readonly score: number | null }[];
  readonly calibration?: Calibration;
  readonly thresholds?: Readonly<Record<string, number>>;
  readonly minimum?: MinimumEvidence;
}): GateDecision {
  const minimum = args.minimum ?? DEFAULT_MINIMUM_EVIDENCE;
  const calibrated = args.calibration && args.calibration.critic.name === args.critic.name && args.calibration.critic.version === args.critic.version ? args.calibration : undefined;
  const thresholdOf = (stateKind: string) => args.thresholds?.[stateKind] ?? calibrated?.kinds.find(kind => kind.stateKind === stateKind)?.threshold ?? null;
  const unjudged = args.scores.filter(item => item.score === null).map(item => item.entryKey);
  const below: BelowThreshold[] = [];
  for (const item of args.scores) {
    const threshold = thresholdOf(item.stateKind);
    if (item.score !== null && threshold !== null && item.score < threshold) below.push({ entryKey: item.entryKey, stateKind: item.stateKind, score: item.score, threshold });
  }
  const refusal: string[] = [];
  if (args.mode === 'gate') {
    if (args.calibration && !calibrated) refusal.push(`The calibration is for ${args.calibration.critic.name}@${args.calibration.critic.version}, not ${args.critic.name}@${args.critic.version}: calibrate this version`);
    for (const stateKind of [...new Set(args.scores.map(item => item.stateKind))].sort()) {
      const kind = calibrated?.kinds.find(candidate => candidate.stateKind === stateKind);
      if (!kind) { if (!args.calibration || calibrated) refusal.push(`No calibration for state kind "${stateKind}": run \`atlas critic calibrate ${args.critic.name}\` with labelled examples of it`); continue; }
      if (kind.threshold === null) refusal.push(`Calibration for "${stateKind}" has no threshold: it needs both good and bad examples`);
      if (kind.positives < minimum.perClass || kind.negatives < minimum.perClass) refusal.push(`Calibration for "${stateKind}" has ${kind.positives} bad and ${kind.negatives} good examples; gate needs at least ${minimum.perClass} of each`);
      if (minimum.heldOut && kind.inSample) refusal.push(`Calibration for "${stateKind}" is in-sample: gate needs precision and recall measured on held-out examples`);
    }
  }
  const refused = refusal.length > 0;
  return {
    mode: args.mode,
    exitCode: refused ? 2 : args.mode === 'gate' && below.length ? 1 : 0,
    below: refused ? [] : below,
    unjudged,
    warnings: args.mode === 'warn' ? below.map(item => `${item.entryKey} (${item.stateKind}) scored ${item.score}, below ${item.threshold}`) : [],
    refusal
  };
}
