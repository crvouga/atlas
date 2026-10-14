/**
 * @module Gherkin scenario view of a recorded run
 *
 * Recognises the Gherkin-keyword steps (`Given`, `When`, `Then`, `And`, `But`, `*`) at the top of a recorded step tree
 * and groups the harness actions nested under each, so the viewer can show a run as a readable script. Pure functions
 * over `ReportStep`.
 */
import type { ReportStep } from './report-types';

const GHERKIN = new Set(['given', 'when', 'then', 'and', 'but', '*']);

/** One Gherkin line of a scenario and what the harness did while it ran. */
export type ScenarioLine = {
  /** The Gherkin step itself. */
  readonly step: ReportStep;
  /** Nested harness steps: the actions taken while this line ran. */
  readonly actions: readonly ReportStep[];
};

/** Whether a step's `kind` (trimmed, any case) is a Gherkin keyword: `given`, `when`, `then`, `and`, `but` or `*`. */
export function isGherkinStep(step: ReportStep): boolean {
  return GHERKIN.has(step.kind.trim().toLowerCase());
}

/** The step's title with a leading copy of its `kind` removed (case-insensitively, not word-aware), so the script can show the keyword once. Returns the trimmed title unchanged when it does not start with the kind. */
export function gherkinText(step: ReportStep): string {
  const kind = step.kind.trim();
  const title = step.title.trim();
  if (title.toLowerCase().startsWith(kind.toLowerCase())) {
    return title.slice(kind.length).trim();
  }
  return title;
}

function walkActions(steps: readonly ReportStep[], out: ReportStep[]): void {
  for (const step of steps) {
    out.push(step);
    if (step.steps.length > 0) walkActions(step.steps, out);
  }
}

/**
 * Groups a run's top-level Gherkin steps with the actions nested under each, every descendant step flattened in
 * depth-first order. Returns `null` when no top-level step is a Gherkin step (a model check, a property), so the step
 * tree is the action log instead. Gherkin steps nested deeper than the top level are only listed as actions.
 */
export function scenarioScript(
  steps: readonly ReportStep[]
): readonly ScenarioLine[] | null {
  const lines = steps.filter(isGherkinStep);
  if (lines.length === 0) return null;
  return lines.map((step) => {
    const actions: ReportStep[] = [];
    walkActions(step.steps, actions);
    return { step, actions };
  });
}
