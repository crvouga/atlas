import { createHash } from 'node:crypto';

import type { Config, StateValue } from './graph';
import type { ChartGraph } from './graph';
import { configKey } from './graph';
import type { Composition } from './spec/compose';
import type { SpecBundle } from './spec/types';
import { splitTransitionId, transitionId, walkStates } from './spec/types';

export type ChartScope = {
  chart: string;
  /** Set when the run covers one state of the chart and what is inside it. */
  state?: string;
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
  /** The same start and events give the same key on any machine and in any run. */
  key: string;
  name: string;
  kind: 'journey' | 'generated';
  description: string;
  steps: PlannedStep[];
  /** Active states the path starts in, for the implementation's setup. */
  start: string[];
  /** The seed that puts the system in the start configuration; `setup` does it when absent. */
  seed?: string;
  /** The journeys this stretch belongs to: a stretch several journeys share is run once. */
  journeys?: string[];
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
  /**
   * Cover only this state and what is inside it, with the transitions into and out of it: one
   * area of a chart that holds the whole product.
   */
  state?: string;
};

/**
 * The part of the composed product a run covers: every state of `chart`, the transitions that
 * enter it from outside, and the hand-offs back to its parent.
 */
export function chartScope(bundle: SpecBundle, composition: Composition, graph: ChartGraph, options: ScopeOptions = {}): ChartScope {
  const chart = options.chart ?? bundle.root;
  const states = new Set<string>();
  const area = options.state;
  if (area) {
    if (!graph.stateNames().includes(area)) throw new Error(`There is no state "${area}" to scope the run to`);
    const within = (name: string) => {
      for (let n: string | null = name; n; n = graph.parent(n)) if (n === area) return true;
      return false;
    };
    for (const name of graph.stateNames()) if (within(name)) states.add(name);
  } else {
    for (const [state, owner] of composition.chartOf) if (owner === chart) states.add(state);
    if (chart === bundle.root) for (const name of graph.stateNames()) states.add(name);
    const host = composition.hosts.get(chart);
    if (host) states.add(host);
  }
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
  if (area) {
    for (const id of transitions) {
      const { source, event } = splitTransitionId(id);
      const target = graph.target(source, event);
      if (target && !entries.has(id)) states.add(target);
    }
  }
  for (const id of entries) states.add(splitTransitionId(id).source);
  const start = options.start ?? graph.initial().value;
  return {
    chart,
    ...(area ? { state: area } : {}),
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

/** A named seed: a configuration the implementation can put the system in directly. */
export type SeedPoint = { name: string; at: StateValue; blocked?: string; for?: string[]; shows?: string };

/** A journey as the paths it is cut into, one per seeded stretch, in order. */
export type PlannedJourney = { name: string; description: string; paths: string[] };

export type PlanOptions = {
  /** Events that cannot run yet; paths stop before them. */
  isBlocked?: (event: string) => boolean;
  /** Whether the implementation can set a path up in this starting configuration. */
  canStart?: (active: string[]) => true | string;
  /**
   * Configurations the implementation can seed directly. Paths start from the nearest one, and
   * journeys are cut wherever they pass through one, so every stretch runs on its own.
   */
  seeds?: SeedPoint[];
  /** Whether `setup` can start a path at the scope's start; true when omitted. */
  hasSetup?: boolean;
};

/** The steps a path can actually run: everything before its first blocked event. */
export function runnableSteps(steps: PlannedStep[], isBlocked: (event: string) => boolean) {
  const stop = steps.findIndex((s) => isBlocked(s.event));
  return stop < 0 ? steps : steps.slice(0, stop);
}

export function pathKey(seed: string | undefined, start: Config, events: string[]) {
  return createHash('sha256')
    .update(JSON.stringify([seed ?? null, configKey(start.value), events]))
    .digest('hex')
    .slice(0, 16);
}

const leaves = (graph: ChartGraph, active: string[]) => active.filter((n) => graph.isLeaf(n));

/**
 * Paths for one chart. Every path starts at a start point: the scope's start (through `setup`)
 * or a seed. Each curated journey is replayed from the chart's initial state and cut into
 * stretches wherever it passes through a seeded configuration; identical stretches of different
 * journeys become one path. Then the shortest extra path from the nearest start point is added
 * for every transition still uncovered, and extra paths that are a prefix of another path are
 * dropped. Everything is ordered by the chart and the journeys, so the plan is deterministic.
 */
export function planChart(bundle: SpecBundle, graph: ChartGraph, scope: ChartScope, options: PlanOptions = {}) {
  const isBlocked = options.isBlocked ?? (() => false);
  const canStart = options.canStart ?? (() => true as const);
  const hasSetup = options.hasSetup !== false;
  const blockedEvents = (steps: PlannedStep[]) => [...new Set(steps.map((s) => s.event).filter(isBlocked))];
  const isRoot = scope.chart === bundle.root && !scope.state;

  const seeds = (options.seeds ?? []).map((seed) => ({ ...seed, config: graph.resolve(seed.at) }));
  type StartPoint = { seed?: string; config: Config; for?: string[]; shows?: string };
  const startPoints: StartPoint[] = [
    ...seeds.filter((s) => !s.blocked).map((s) => ({ seed: s.name, config: s.config, ...(s.for ? { for: s.for } : {}), ...(s.shows ? { shows: s.shows } : {}) })),
    ...(hasSetup ? [{ config: graph.resolve(scope.start) }] : [])
  ];
  const variantEvents = new Set(startPoints.flatMap((p) => p.for ?? []));
  /** A variant seed starts only paths that take one of its events; those events start only from it. */
  const suits = (point: StartPoint, events: string[]) => {
    const needed = events.filter((e) => variantEvents.has(e));
    return point.for ? needed.length > 0 && needed.every((e) => point.for!.includes(e)) : needed.length === 0;
  };
  /** The region of a parallel state a state sits in: the child of its nearest parallel ancestor. */
  const regionOf = (state: string) => {
    for (let n: string | null = state, p = graph.parent(state); p; n = p, p = graph.parent(p)) if (graph.node(p)?.type === 'parallel') return n;
    return null;
  };
  /** Whether the first event acts in the region whose screen the seed leaves open. */
  const sameRegion = (config: Config, event: string, shows: string) => {
    const sources = graph.firedBy(config, event).map((t) => splitTransitionId(t).source);
    return sources.some((source) => regionOf(source) === regionOf(shows));
  };
  const startsAt = (config: Config) => startPoints.filter((p) => configKey(p.config.value) === configKey(config.value));
  const startVerdict = (config: Config, events: string[]) => {
    const candidates = startsAt(config);
    const point = candidates.find((p) => suits(p, events));
    if (point?.seed) return { point, supported: true as const };
    const needed = events.filter((e) => variantEvents.has(e));
    if (!point && needed.length && candidates.length) return { point, supported: `no seed at ${leaves(graph, config.active).join(' + ')} is for ${needed.map((e) => `"${e}"`).join(', ')}` };
    if (!hasSetup) return { point, supported: `no seed puts the system in ${leaves(graph, config.active).join(' + ')}` };
    return { point, supported: canStart(config.active) };
  };

  const journeyPaths: PlannedPath[] = [];
  const byKey = new Map<string, PlannedPath>();
  const journeys: PlannedJourney[] = [];
  for (const journey of bundle.journeys) {
    const replay = graph.replay(graph.initial(), journey.events);
    const ids: string[] = [];
    let current: ReplayStep[] | null = null;
    const flush = () => {
      if (!current?.length) {
        current = null;
        return;
      }
      const startConfig = current[0]!.from;
      const steps = toSteps(current);
      current = null;
      const { point, supported } = startVerdict(startConfig, steps.map((s) => s.event));
      const key = pathKey(point?.seed, startConfig, steps.map((s) => s.event));
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.journeys!.includes(journey.name)) existing.journeys!.push(journey.name);
        if (!ids.includes(existing.id)) ids.push(existing.id);
        return;
      }
      const path: PlannedPath = {
        id: `journey-${journeyPaths.length + 1}`,
        key,
        name: journey.name,
        kind: 'journey',
        description: journey.description,
        steps,
        start: startConfig.active,
        ...(point?.seed ? { seed: point.seed } : {}),
        journeys: [journey.name],
        blockedBy: [...(supported === true ? [] : [`Start: ${supported}`]), ...blockedEvents(steps)]
      };
      byKey.set(key, path);
      journeyPaths.push(path);
      ids.push(path.id);
    };
    for (const step of replay.steps) {
      if (!inScope(scope, step.transitions)) {
        flush();
        continue;
      }
      const seeded = startsAt(step.from).length > 0;
      if (current && seeded) flush();
      if (!current) {
        const entering = isRoot || seeded || step.transitions.some((t) => scope.entries.has(t));
        if (!entering) continue;
        current = [];
      }
      current.push(step);
    }
    flush();
    if (ids.length) journeys.push({ name: journey.name, description: journey.description, paths: ids });
  }

  const startable = (p: PlannedPath) => !p.blockedBy.some((b) => b.startsWith('Start:'));
  const covered = new Set(journeyPaths.filter(startable).flatMap((p) => runnableSteps(p.steps, isBlocked).flatMap((s) => s.transitions)));
  const planned = new Set<string>();
  let generated: PlannedPath[] = [];
  if (startPoints.length) {
    for (const avoidBlocked of [true, false]) {
      const explored = startPoints.map((point) =>
        graph.explore(point.config, (event) => scope.events.has(event) && (!avoidBlocked || !isBlocked(event)) && (!variantEvents.has(event) || Boolean(point.for?.includes(event))))
      );
      for (const target of scope.transitions) {
        if (covered.has(target) || planned.has(target)) continue;
        const { source, event } = splitTransitionId(target);
        if (avoidBlocked && isBlocked(event)) continue;
        let best: { origin: StartPoint; path: string[] } | null = null;
        startPoints.forEach((point, i) => {
          const first = explored[i]!.firstFired.get(target);
          if (!first) return;
          const path = [...first.from.path, first.event];
          if (point.for && !path.some((e) => point.for!.includes(e))) return;
          if (point.shows && !sameRegion(point.config, path[0]!, point.shows)) return;
          if (!best || path.length < best.path.length) best = { origin: point, path };
        });
        if (!best) continue;
        const { origin, path: events } = best as { origin: StartPoint; path: string[] };
        const replay = graph.replay(origin.config, withoutAutomaticHandOffs(graph, origin.config, events));
        const steps = toSteps(replay.steps).filter((s) => inScope(scope, s.transitions));
        for (const s of runnableSteps(steps, isBlocked)) for (const t of s.transitions) covered.add(t);
        if (!avoidBlocked) for (const s of steps) for (const t of s.transitions) planned.add(t);
        generated.push({
          id: '',
          key: pathKey(origin.seed, origin.config, steps.map((s) => s.event)),
          name: `Covers: ${source} → ${event}`,
          kind: 'generated',
          description: `Shortest path from ${origin.seed ? `the seed "${origin.seed}"` : 'the start'} that reaches "${source}" and takes "${event}".`,
          steps,
          start: origin.config.active,
          ...(origin.seed ? { seed: origin.seed } : {}),
          blockedBy: blockedEvents(steps)
        });
      }
    }
  }

  const all = [...journeyPaths, ...generated];
  const startKey = (p: PlannedPath) => `${p.seed ?? ''}|${p.start.join('|')}`;
  const isPrefix = (short: PlannedPath, long: PlannedPath) =>
    short !== long && startable(long) && startKey(short) === startKey(long) && short.steps.length <= long.steps.length && short.steps.every((s, i) => s.event === long.steps[i]!.event);
  generated = generated.filter((p, i) => !all.some((q) => isPrefix(p, q) && (q.steps.length > p.steps.length || q.kind === 'journey' || generated.indexOf(q) < i)));
  generated.forEach((p, i) => (p.id = `generated-${i + 1}`));

  const everPlanned = new Set([...journeyPaths, ...generated].filter(startable).flatMap((p) => p.steps.flatMap((s) => s.transitions)));
  const unreachable = [...scope.transitions].filter((t) => !everPlanned.has(t));
  const runCovered = new Set<string>();
  const paths = [...journeyPaths, ...generated].map((p) => {
    const prefix = startable(p) ? runnableSteps(p.steps, isBlocked).flatMap((s) => s.transitions) : [];
    const adds = prefix.some((t) => !runCovered.has(t));
    for (const t of prefix) runCovered.add(t);
    return p.blockedBy.length && !adds ? { ...p, skipRun: true } : p;
  });
  return {
    paths,
    unreachable,
    journeys,
    seeds: seeds.map((s) => ({ name: s.name, active: s.config.active, ...(s.blocked ? { blocked: s.blocked } : {}) }))
  };
}
