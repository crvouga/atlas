/**
 * @module Statechart spec types
 *
 * The data model every other module works on: a chart, a bundle of charts plus journeys, and the
 * helpers that walk and name states and transitions. Atlas reads statecharts in two open formats:
 *
 * - W3C SCXML (`*.scxml`), the standard for statecharts.
 * - XState v5 machine config (`*.machine.json`, `*.machine.yaml`), the JSON form Stately Studio
 *   imports and exports.
 *
 * Both load into the XState config shape below. Atlas executes only the pure subset that can be
 * walked without running code: states, nesting, parallel regions, final states, event
 * transitions, statically resolvable child charts (`invoke` with a `src` naming another chart),
 * and `meta`. Guards, actions, context, delays and `always` are rejected by the linter.
 * This module has no I/O and no Node built-ins.
 *
 * @see docs/statecharts.md
 */

/** The object form of a transition. `target` is a state name, optionally prefixed with `#` (a reference by name across the composed product). */
export type TransitionConfig = {
  /** The destination state, optionally prefixed with `#`. */
  target: string;
  /** Declarative provenance or business metadata; ignored while executing the chart. */
  meta?: Record<string, unknown>;
};

/** An `invoke` that runs another chart inside a state. It is never executed: `composeCharts` inlines the child chart statically. */
export type InvokeConfig = {
  /** The id of another chart in the bundle; composed statically. */
  src: string;
  /** Names the invocation; the parent hears `done.invoke.<id>` (`<src>` when omitted) when the child ends. */
  id?: string;
  /** Where the parent goes when the child reaches a final state (`done.invoke.<id>`). */
  onDone?: string | TransitionConfig;
};

/**
 * The `meta` of a state: the business-language facts about it that Atlas lints, shows and checks.
 * Open object: unknown keys are kept and ignored.
 *
 * @see docs/statecharts.md
 */
export type StateMeta = {
  /** What is true in this state. Required on every state by default (`requiredMeta` in the config changes that). */
  description?: string;
  /** What a person sees in this state, in words. */
  snapshot?: string;
  /** Business events that happen on entering the state, compared with what event sources observed. */
  events?: string[];
  /** Whether the behaviour is `confirmed` against the product or only `assumed`. */
  confidence?: 'confirmed' | 'assumed';
  /** Where the behaviour is documented. */
  source?: string[];
  /** Things to verify on screen, quoted from the spec; the implementation's `checks()` returns their results. */
  checks?: string[];
  /** Gherkin-style contracts attached to the state. Core does not read them; they are carried through for viewers. */
  contracts?: { id: string; name: string; source: string; description?: string; steps: { keyword: string; text: string; table?: string[][]; docString?: string }[] }[];
  /** Why a state with no way out is meant to be one. Without it, a state with no outgoing transition is a lint error. */
  deadEnd?: string;
  /** Legacy composition: the chart that runs inside this state. Prefer `invoke`. */
  childMachine?: string;
  /** Legacy composition: child final state → the event the parent receives. Prefer `invoke`. */
  childFinalEvents?: Record<string, string>;
  /** On a final state: the event the parent receives when this final is reached. */
  doneEvent?: string;
  [key: string]: unknown;
};

/**
 * One state of an XState-shaped chart, recursively. Keys not listed here (guards, actions, `after`,
 * ...) are accepted by the type so the linter can report them; the planner never executes them.
 */
export type StateConfig = {
  /** Set by `composeCharts` to the state's name when absent; used by `#<name>` targets. */
  id?: string;
  /** The child state entered first. */
  initial?: string;
  /** `parallel`: all child regions are active together. `final`: the state ends its chart (or hands off to the parent). */
  type?: 'parallel' | 'final';
  meta?: StateMeta;
  states?: Record<string, StateConfig>;
  /** Event name (exact business wording) to its transition: a target string or `{ target, meta? }`. */
  on?: Record<string, TransitionConfig | string>;
  /** Child chart(s) that run inside this state. */
  invoke?: InvokeConfig | InvokeConfig[];
  [key: string]: unknown;
};

/** A whole chart: a state config with a required `id`, which is the name other charts `invoke` it by. */
export type MachineConfig = StateConfig & { id: string };

/** A curated, named sequence of events, replayed by the linter and run as its own path(s). */
export type Journey = {
  /** The key in `journeys.yaml`. */
  name: string;
  /** Empty string when the file gives none. */
  description: string;
  /** Event names in order, using the exact spec wording. Hand-off events are never listed; the planner inserts them. */
  events: string[];
  /** State names that must all be active after the last event. Empty when the file gives none. */
  endsIn: string[];
};

/** One loaded chart file. */
export type Chart = {
  /** Path relative to the spec directory. */
  file: string;
  /** The notation the file was parsed from. */
  format: 'scxml' | 'xstate';
  machine: MachineConfig;
};

/** Everything loaded from a specs directory. */
export type SpecBundle = {
  /** The directory the files were read from. */
  directory: string;
  /** Charts in load order, one per chart id. */
  charts: Chart[];
  /** Journeys from every journeys file, in file then declaration order. */
  journeys: Journey[];
  /** The chart the others are composed into: the one no other chart invokes. */
  root: string;
};

/** The separator inside a transition id (`<source> :: <event>`). The ids are not escaped, so a state name containing it makes `splitTransitionId` ambiguous. */
export const TRANSITION_SEPARATOR = ' :: ';

/** The id of a transition: the source state's name and the event, joined by `TRANSITION_SEPARATOR`. */
export function transitionId(source: string, event: string) {
  return `${source}${TRANSITION_SEPARATOR}${event}`;
}

/** Splits a transition id at its first separator into `{ source, event }`; the inverse of `transitionId`. */
export function splitTransitionId(id: string) {
  const at = id.indexOf(TRANSITION_SEPARATOR);
  return { source: id.slice(0, at), event: id.slice(at + TRANSITION_SEPARATOR.length) };
}

/** The state name a transition leads to, with any leading `#` removed; `undefined` when there is no transition. */
export function targetOf(t: TransitionConfig | string | undefined) {
  if (t === undefined) return undefined;
  const raw = typeof t === 'string' ? t : t.target;
  return raw.startsWith('#') ? raw.slice(1) : raw;
}

/** A state found by `walkStates`: its name, its config, and the names of its ancestors from the outermost down. */
export type StateEntry = { name: string; node: StateConfig; trail: string[] };

/** Lists every state under `config` depth-first, parents before their children, in declaration order. The root `config` itself is not listed. */
export function walkStates(config: StateConfig, trail: string[] = []): StateEntry[] {
  return Object.entries(config.states ?? {}).flatMap(([name, node]) => [
    { name, node, trail },
    ...walkStates(node, [...trail, name])
  ]);
}

/** The `invoke` entries of a state as an array (empty when it has none). */
export function invokesOf(node: StateConfig): InvokeConfig[] {
  if (!node.invoke) return [];
  return Array.isArray(node.invoke) ? node.invoke : [node.invoke];
}
