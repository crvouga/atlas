/**
 * Atlas reads statecharts in two open formats:
 *
 * - W3C SCXML (`*.scxml`), the standard for statecharts.
 * - XState v5 machine config (`*.machine.json`, `*.machine.yaml`), the JSON form Stately Studio
 *   imports and exports.
 *
 * Both load into the XState config shape below. Atlas executes only the pure subset that can be
 * walked without running code: states, nesting, parallel regions, final states, event
 * transitions, statically resolvable child charts (`invoke` with a `src` naming another chart),
 * and `meta`. Guards, actions, context, delays and `always` are rejected by the linter.
 */
export type TransitionConfig = { target: string };

export type InvokeConfig = {
  /** The id of another chart in the bundle; composed statically. */
  src: string;
  id?: string;
  /** Where the parent goes when the child reaches a final state (`done.invoke.<id>`). */
  onDone?: string | TransitionConfig;
};

export type StateMeta = {
  description?: string;
  snapshot?: string;
  events?: string[];
  confidence?: 'confirmed' | 'assumed';
  source?: string[];
  checks?: string[];
  contracts?: { id: string; name: string; source: string; description?: string; steps: { keyword: string; text: string; table?: string[][]; docString?: string }[] }[];
  deadEnd?: string;
  /** Legacy composition: the chart that runs inside this state. Prefer `invoke`. */
  childMachine?: string;
  /** Legacy composition: child final state → the event the parent receives. Prefer `invoke`. */
  childFinalEvents?: Record<string, string>;
  /** On a final state: the event the parent receives when this final is reached. */
  doneEvent?: string;
  [key: string]: unknown;
};

export type StateConfig = {
  id?: string;
  initial?: string;
  type?: 'parallel' | 'final';
  meta?: StateMeta;
  states?: Record<string, StateConfig>;
  on?: Record<string, TransitionConfig | string>;
  invoke?: InvokeConfig | InvokeConfig[];
  [key: string]: unknown;
};

export type MachineConfig = StateConfig & { id: string };

export type Journey = {
  name: string;
  description: string;
  events: string[];
  endsIn: string[];
};

export type Chart = {
  /** Path relative to the spec directory. */
  file: string;
  format: 'scxml' | 'xstate';
  machine: MachineConfig;
};

export type SpecBundle = {
  directory: string;
  charts: Chart[];
  journeys: Journey[];
  /** The chart the others are composed into: the one no other chart invokes. */
  root: string;
};

export const TRANSITION_SEPARATOR = ' :: ';

export function transitionId(source: string, event: string) {
  return `${source}${TRANSITION_SEPARATOR}${event}`;
}

export function splitTransitionId(id: string) {
  const at = id.indexOf(TRANSITION_SEPARATOR);
  return { source: id.slice(0, at), event: id.slice(at + TRANSITION_SEPARATOR.length) };
}

export function targetOf(t: TransitionConfig | string | undefined) {
  if (t === undefined) return undefined;
  const raw = typeof t === 'string' ? t : t.target;
  return raw.startsWith('#') ? raw.slice(1) : raw;
}

export type StateEntry = { name: string; node: StateConfig; trail: string[] };

export function walkStates(config: StateConfig, trail: string[] = []): StateEntry[] {
  return Object.entries(config.states ?? {}).flatMap(([name, node]) => [
    { name, node, trail },
    ...walkStates(node, [...trail, name])
  ]);
}

export function invokesOf(node: StateConfig): InvokeConfig[] {
  if (!node.invoke) return [];
  return Array.isArray(node.invoke) ? node.invoke : [node.invoke];
}
