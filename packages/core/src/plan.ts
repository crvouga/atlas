import type { Config, StateValue } from './graph';
import type { ChartGraph } from './graph';
import type { Composition } from './spec/compose';
import type { SpecBundle } from './spec/types';
import { splitTransitionId, transitionId, walkStates } from './spec/types';

export type ChartScope = {
  chart: string;
  /** The configuration each generated path starts from. */
  start: StateValue;
  startLabel: string;
  states: Set<string>;
  transitions: Set<string>;
  events: Set<string>;
  /** Transitions that enter the chart from outside it. */
  entries: Set<string>;
};

export type PlannedStep = { event: string; transitions: string[]; handOff: boolean; from: string[]; to: string[] };

export type PlannedPath = {
  id: string;
  name: string;
  kind: 'journey' | 'generated';
  description: string;
  steps: PlannedStep[];
  /** Active states the path starts in, for the implementation's setup. */
  start: string[];
  blockedBy: string[];
  /** A blocked path whose runnable part other paths already cover: reported, not run. */
  skipRun?: boolean;
};

export type ScopeOptions = {
  /** The chart to run; the root chart (the whole product) when omitted. */
  chart?: string;
  /** Where generated paths start; the root's initial configuration when omitted. */
  start?: StateValue;
  startLabel?: string;
  /** Only these events enter the chart from outside it; every entering transition when omitted. */
  entryEvents?: string[];
};

/**
 * The part of the composed product a run covers: every state of `chart`, the transitions that
 * enter it from outside, and the hand-offs back to its parent.
 */
export function chartScope(bundle: SpecBundle, composition: Composition, graph: ChartGraph, options: ScopeOptions = {}): ChartScope {
  const chart = options.chart ?? bundle.root;
  const states = new Set<string>();
  for (const [state, owner] of composition.chartOf) if (owner === chart) states.add(state);
  if (chart === bundle.root) for (const name of graph.stateNames()) states.add(name);
  const host = composition.hosts.get(chart);
  if (host) states.add(host);
  const transitions = new Set<string>();
  const entries = new Set<string>();
  for (const { name, node } of walkStates(composition.machine)) {
    for (const event of Object.keys(node.on ?? {})) {
      const id = transitionId(name, event);
      const target = graph.target(name, event);
      if (states.has(name)) transitions.add(id);
      else if (target && states.has(target) && (!options.entryEvents || options.entryEvents.includes(event))) {
        transitions.add(id);
        entries.add(id);
      }
    }
  }
  for (const h of composition.handOffs) {
    if (!states.has(h.finalState)) continue;
    const target = graph.target(h.finalState, h.event);
    if (target) states.add(target);
  }
  for (const id of entries) states.add(splitTransitionId(id).source);
  const start = options.start ?? graph.initial().value;
  return {
    chart,
    start,
    startLabel: options.startLabel ?? 'The start of the chart',
    states,
    transitions,
    events: new Set([...transitions].map((id) => splitTransitionId(id).event)),
    entries
  };
}

function inScope(scope: ChartScope, fired: string[]) {
  return fired.length > 0 && fired.every((t) => scope.transitions.has(t));
}

type ReplayStep = { event: string; transitions: string[]; handOff: boolean; from: Config; to: Config };

function toSteps(replaySteps: ReplayStep[]): PlannedStep[] {
  return replaySteps.map((s) => ({ event: s.event, transitions: s.transitions, handOff: s.handOff, from: s.from.active, to: s.to.active }));
}

/**
 * `explore` takes hand-off events as ordinary moves, but `replay` inserts them by itself as soon as
 * a hand-off state is active. Drop the ones `replay` will insert, so it does not see them twice.
 */
function withoutAutomaticHandOffs(graph: ChartGraph, start: Config, events: string[]) {
  const out: string[] = [];
  let config = start;
  for (const event of events) {
    const automatic = graph.pendingHandOffs(config).some((h) => h.event === event);
    const next = graph.step(config, event);
    if (!automatic) out.push(event);
    if (!next) break;
    config = next.config;
  }
  return out;
}

export type PlanOptions = {
  /** Events that cannot run yet; paths stop before them. */
  isBlocked?: (event: string) => boolean;
  /** Whether the implementation can set a path up in this starting configuration. */
  canStart?: (active: string[]) => true | string;
};

/** The steps a path can actually run: everything before its first blocked event. */
export function runnableSteps(steps: PlannedStep[], isBlocked: (event: string) => boolean) {
  const stop = steps.findIndex((s) => isBlocked(s.event));
  return stop < 0 ? steps : steps.slice(0, stop);
}

/**
 * Paths for one chart: each curated journey's stretch inside the chart, then the shortest extra
 * paths until every transition in scope is planned. Loops are bounded by breadth-first search.
 */
export function planChart(bundle: SpecBundle, graph: ChartGraph, scope: ChartScope, options: PlanOptions = {}) {
  const isBlocked = options.isBlocked ?? (() => false);
  const canStart = options.canStart ?? (() => true as const);
  const blockedEvents = (steps: PlannedStep[]) => [...new Set(steps.map((s) => s.event).filter(isBlocked))];
  const isRoot = scope.chart === bundle.root;
  const startActive = graph.resolve(scope.start).active;

  const journeys: PlannedPath[] = [];
  const seen = new Set<string>();
  for (const journey of bundle.journeys) {
    const replay = graph.replay(graph.initial(), journey.events);
    let current: ReplayStep[] = [];
    const flush = () => {
      if (current.length === 0) return;
      const steps = toSteps(current);
      current = [];
      const start = steps[0]!.from;
      const key = `${start.join('|')} ${steps.map((s) => s.event).join(' > ')}`;
      if (seen.has(key)) return;
      seen.add(key);
      const supported = canStart(start);
      journeys.push({
        id: `journey-${journeys.length + 1}`,
        name: journey.name,
        kind: 'journey',
        description: journey.description,
        steps,
        start,
        blockedBy: [...(supported === true ? [] : [`Start: ${supported}`]), ...blockedEvents(steps)]
      });
    };
    for (const step of replay.steps) {
      const entering = isRoot ? current.length === 0 : step.transitions.some((t) => scope.entries.has(t));
      if (current.length === 0 && entering && inScope(scope, step.transitions)) current.push(step);
      else if (current.length > 0 && inScope(scope, step.transitions)) current.push(step);
      else flush();
    }
    flush();
  }

  const covered = new Set(journeys.flatMap((p) => (p.blockedBy.some((b) => b.startsWith('Start:')) ? [] : runnableSteps(p.steps, isBlocked).flatMap((s) => s.transitions))));
  const planned = new Set<string>();
  const generated: PlannedPath[] = [];
  const start = graph.resolve(scope.start);
  for (const avoidBlocked of [true, false]) {
    const allowed = (event: string) => scope.events.has(event) && (!avoidBlocked || !isBlocked(event));
    const explored = graph.explore(start, allowed);
    for (const target of scope.transitions) {
      if (covered.has(target) || planned.has(target)) continue;
      const { source, event } = splitTransitionId(target);
      if (avoidBlocked && isBlocked(event)) continue;
      const reaching = [...explored.seen.values()]
        .filter(({ config }) => config.active.includes(source) && graph.firedBy(config, event).includes(target))
        .sort((a, b) => a.path.length - b.path.length)[0];
      if (!reaching) continue;
      const replay = graph.replay(start, withoutAutomaticHandOffs(graph, start, [...reaching.path, event]));
      const steps = toSteps(replay.steps).filter((s) => inScope(scope, s.transitions));
      for (const s of runnableSteps(steps, isBlocked)) for (const t of s.transitions) covered.add(t);
      if (!avoidBlocked) for (const s of steps) for (const t of s.transitions) planned.add(t);
      generated.push({
        id: `generated-${generated.length + 1}`,
        name: `Covers: ${source} → ${event}`,
        kind: 'generated',
        description: `Shortest path that reaches "${source}" and takes "${event}".`,
        steps,
        start: startActive,
        blockedBy: blockedEvents(steps)
      });
    }
  }

  const everPlanned = new Set([...journeys, ...generated].flatMap((p) => p.steps.flatMap((s) => s.transitions)));
  const unreachable = [...scope.transitions].filter((t) => !everPlanned.has(t));
  const runCovered = new Set<string>();
  const paths = [...journeys, ...generated].map((p) => {
    const prefix = runnableSteps(p.steps, isBlocked).flatMap((s) => s.transitions);
    const adds = prefix.some((t) => !runCovered.has(t));
    for (const t of prefix) runCovered.add(t);
    return p.blockedBy.length && !adds ? { ...p, skipRun: true } : p;
  });
  return { paths, unreachable };
}
