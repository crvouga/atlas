import type { SpecBundle, StateConfig } from './spec/types';
import { ChartGraph } from './graph';
import { composeCharts } from './spec/compose';
import { invokesOf, walkStates } from './spec/types';

export type LintFinding = { rule: string; message: string };

const STATE_KEYS = new Set(['id', 'initial', 'type', 'meta', 'states', 'on', 'invoke', 'description']);
const INVOKE_KEYS = new Set(['src', 'id', 'onDone']);
const REQUIRED_META = ['description'] as const;
const FORBIDDEN = ['entry', 'exit', 'actions', 'assign', 'after', 'always', 'context', 'guard', 'cond', 'delay', 'output', 'onError'];

export type LintOptions = {
  /** Meta fields every state must carry; `description` by default. */
  requiredMeta?: readonly string[];
  /** Only these states and events need implementations (a chart being brought up). */
  scope?: { states: ReadonlySet<string>; events: ReadonlySet<string> };
  implementations?: { events: ReadonlySet<string>; states: ReadonlySet<string> };
};

function checkShape(node: StateConfig, name: string, requiredMeta: readonly string[], out: LintFinding[]) {
  for (const key of Object.keys(node)) {
    if (FORBIDDEN.includes(key)) out.push({ rule: 'pure', message: `${name}: "${key}" is not allowed` });
    else if (!STATE_KEYS.has(key)) out.push({ rule: 'pure', message: `${name}: unknown key "${key}"` });
  }
  if (name.includes('.')) out.push({ rule: 'naming', message: `${name}: state names cannot contain dots` });
  for (const key of requiredMeta) {
    if (!(key in (node.meta ?? {}))) out.push({ rule: 'meta', message: `${name}: meta.${key} is missing` });
  }
  for (const [event, t] of Object.entries(node.on ?? {})) {
    if (typeof t === 'string') continue;
    if (typeof t !== 'object' || t === null) {
      out.push({ rule: 'pure', message: `${name} --${event}--> must be a target` });
      continue;
    }
    for (const key of Object.keys(t)) {
      if (key !== 'target') out.push({ rule: 'pure', message: `${name} --${event}-->: "${key}" is not allowed (no guards, no actions)` });
    }
  }
  for (const invoke of invokesOf(node)) {
    for (const key of Object.keys(invoke)) {
      if (!INVOKE_KEYS.has(key)) out.push({ rule: 'pure', message: `${name}: invoke "${key}" is not allowed; invoke only names another chart` });
    }
    if (typeof invoke.src !== 'string') out.push({ rule: 'pure', message: `${name}: invoke src must name another chart` });
  }
}

/** A copy with forbidden keys removed, so reachability can be analysed after a purity finding. */
function sanitized(bundle: SpecBundle): SpecBundle {
  const clean = (node: StateConfig): StateConfig => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) if (STATE_KEYS.has(key)) out[key] = value;
    if (node.on) {
      out['on'] = Object.fromEntries(
        Object.entries(node.on).map(([event, t]) => [event, typeof t === 'string' ? t : { target: (t as { target: string }).target }])
      );
    }
    if (node.states) out['states'] = Object.fromEntries(Object.entries(node.states).map(([k, v]) => [k, clean(v)]));
    return out as StateConfig;
  };
  return { ...bundle, charts: bundle.charts.map((c) => ({ ...c, machine: clean(c.machine) as typeof c.machine })) };
}

/**
 * Checks a spec bundle is executable: pure (no guards, actions, context or delays), every state
 * reachable, no dead ends without `meta.deadEnd`, every journey replays to its `endsIn` states, and
 * (when implementations are given) every event and state in scope has one.
 */
export function lintBundle(bundle: SpecBundle, options: LintOptions = {}) {
  const findings: LintFinding[] = [];
  const requiredMeta = options.requiredMeta ?? REQUIRED_META;
  for (const chart of bundle.charts) {
    checkShape(chart.machine, chart.machine.id, [], findings);
    for (const { name, node } of walkStates(chart.machine)) checkShape(node, name, requiredMeta, findings);
  }

  let composition: ReturnType<typeof composeCharts>;
  let graph: ChartGraph;
  try {
    composition = composeCharts(sanitized(bundle));
    graph = new ChartGraph(composition.machine, composition.handOffs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const listed = findings.map((f) => `\n  [${f.rule}] ${f.message}`).join('');
    throw new Error(`The charts cannot be composed: ${reason}${listed}`);
  }

  const reached = new Set<string>();
  for (const regions of graph.regionSets()) {
    for (const { config } of graph.explore(graph.initial(), (event) => graph.actsIn(event, regions)).seen.values()) {
      for (const name of config.active) reached.add(name);
    }
  }
  for (const name of graph.stateNames()) {
    if (!reached.has(name)) findings.push({ rule: 'reachable', message: `${name} is unreachable from the initial state` });
  }

  for (const { name, node, trail } of walkStates(composition.machine)) {
    if (node.states || node.type === 'final') continue;
    const hasExit = [name, ...trail].some((n) => Object.keys(graph.node(n)?.on ?? {}).length > 0);
    if (!hasExit && !node.meta?.deadEnd) {
      findings.push({ rule: 'dead-end', message: `${name} has no way out and no meta.deadEnd reason` });
    }
  }

  const journeys = bundle.journeys.map((journey) => {
    const replay = graph.replay(graph.initial(), journey.events);
    if (!replay.ok) {
      findings.push({ rule: 'journey', message: `${journey.name}: "${replay.failedAt}" does not apply in ${JSON.stringify(replay.config.value)}` });
    } else {
      const missing = journey.endsIn.filter((s) => !replay.config.active.includes(s));
      if (missing.length) {
        findings.push({ rule: 'journey', message: `${journey.name}: should end in ${missing.join(', ')}, ends in ${replay.config.active.join(' > ')}` });
      }
    }
    return { journey, replay };
  });

  const unimplemented = { events: [] as string[], states: [] as string[] };
  if (options.implementations) {
    const { scope, implementations } = options;
    const events = new Set(walkStates(composition.machine).flatMap(({ node }) => Object.keys(node.on ?? {})));
    for (const event of events) {
      if (scope && !scope.events.has(event)) continue;
      if (!implementations.events.has(event)) unimplemented.events.push(event);
    }
    for (const name of graph.stateNames()) {
      if (scope && !scope.states.has(name)) continue;
      if (!graph.isLeaf(name)) continue;
      if (!implementations.states.has(name)) unimplemented.states.push(name);
    }
    for (const e of unimplemented.events) findings.push({ rule: 'implemented', message: `event "${e}" has no implementation` });
    for (const s of unimplemented.states) findings.push({ rule: 'implemented', message: `state "${s}" has no recognizer` });
  }

  return { findings, composition, graph, journeys, unimplemented };
}
