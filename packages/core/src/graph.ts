import { createMachine, initialTransition, transition } from 'xstate';

import type { HandOff } from './spec/compose';
import type { MachineConfig, StateConfig } from './spec/types';
import { targetOf, transitionId, walkStates } from './spec/types';

export type StateValue = string | { [key: string]: StateValue };

export type Step = {
  event: string;
  transitions: string[];
  handOff: boolean;
};

export type Config = {
  value: StateValue;
  active: string[];
};

/** A configuration's identity: its state value with keys sorted, so equal configurations compare equal. */
export function configKey(value: StateValue): string {
  const canonical = (v: StateValue): unknown =>
    typeof v === 'string' ? v : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k]!)]));
  return JSON.stringify(canonical(value));
}

export function activeKeys(value: StateValue): string[] {
  if (typeof value === 'string') return [value];
  return Object.entries(value).flatMap(([key, child]) => [key, ...activeKeys(child)]);
}

/**
 * A pure simulator over a composed machine: XState computes the next configuration, and this
 * names which transitions fired, so coverage and the report can talk about transitions.
 */
export class ChartGraph {
  readonly machine;
  private readonly nodes = new Map<string, StateConfig>();
  private readonly parentOf = new Map<string, string | null>();
  readonly handOffStates: Map<string, string>;

  constructor(
    readonly config: MachineConfig,
    handOffs: HandOff[] = []
  ) {
    this.machine = createMachine(config as Parameters<typeof createMachine>[0]);
    for (const { name, node, trail } of walkStates(config)) {
      this.nodes.set(name, node);
      this.parentOf.set(name, trail.at(-1) ?? null);
    }
    this.handOffStates = new Map(handOffs.map((h) => [h.finalState, h.event]));
  }

  node(name: string) {
    return this.nodes.get(name);
  }

  /** The state a transition leads to, by name. */
  target(source: string, event: string) {
    return targetOf(this.nodes.get(source)?.on?.[event]);
  }

  isLeaf(name: string) {
    return !this.nodes.get(name)?.states;
  }

  parent(name: string) {
    return this.parentOf.get(name) ?? null;
  }

  stateNames() {
    return [...this.nodes.keys()];
  }

  /** The parallel regions a state sits in, outermost first: each the child of a parallel ancestor. */
  regionsOf(state: string): string[] {
    const regions: string[] = [];
    for (let child: string | null = state, parent = this.parent(state); parent; child = parent, parent = this.parent(parent)) {
      if (this.nodes.get(parent)?.type === 'parallel') regions.unshift(child);
    }
    return regions;
  }

  /**
   * Whether an event can matter to what happens in `regions`: some state that handles it sits in
   * those regions or outside them (never only in a sibling region). Regions of a statechart
   * without guards are independent, so exploring one region with the others held still loses
   * nothing and keeps the search from multiplying across regions.
   */
  actsIn(event: string, regions: string[]) {
    let handled = false;
    for (const [name, node] of this.nodes) {
      if (!node.on?.[event]) continue;
      handled = true;
      const own = this.regionsOf(name);
      if (own.every((region, i) => regions[i] === region)) return true;
    }
    return !handled;
  }

  /** Every distinct set of regions a state sits in, the empty set (outside every parallel) first. */
  regionSets() {
    const keyed = new Map<string, string[]>([['', []]]);
    for (const name of this.nodes.keys()) {
      const regions = this.regionsOf(name);
      keyed.set(regions.join('\u0000'), regions);
    }
    return [...keyed.values()];
  }

  initial(): Config {
    const [snapshot] = initialTransition(this.machine);
    return {
      value: snapshot.value as StateValue,
      active: activeKeys(snapshot.value as StateValue)
    };
  }

  /** The state value that names `state`: its ancestors down to it, defaults filled in by `resolve`. */
  valueOf(state: string): StateValue {
    if (!this.nodes.has(state)) throw new Error(`There is no state "${state}"`);
    const trail: string[] = [];
    for (let n: string | null = state; n; n = this.parent(n)) trail.unshift(n);
    return trail.reduceRight<StateValue | null>((inner, name) => (inner === null ? name : { [name]: inner }), null)!;
  }

  resolve(value: StateValue): Config {
    const snapshot = this.machine.resolveState({ value });
    return {
      value: snapshot.value as StateValue,
      active: activeKeys(snapshot.value as StateValue)
    };
  }

  enabledEvents(config: Config) {
    const events = new Set<string>();
    for (const name of config.active) {
      for (const event of Object.keys(this.nodes.get(name)?.on ?? {})) events.add(event);
    }
    return [...events];
  }

  /** The transitions `event` fires from `config`: in each region, the deepest active state that handles it. */
  firedBy(config: Config, event: string) {
    const candidates = config.active.filter((name) => this.nodes.get(name)?.on?.[event]);
    const hasActiveDescendantCandidate = (name: string) =>
      candidates.some((other) => other !== name && this.isDescendant(other, name));
    return candidates
      .filter((name) => !hasActiveDescendantCandidate(name))
      .map((name) => transitionId(name, event));
  }

  private isDescendant(name: string, ancestor: string) {
    for (let p = this.parentOf.get(name); p; p = this.parentOf.get(p)) {
      if (p === ancestor) return true;
    }
    return false;
  }

  step(config: Config, event: string): { config: Config; fired: string[] } | null {
    const fired = this.firedBy(config, event);
    if (fired.length === 0) return null;
    const snapshot = this.machine.resolveState({ value: config.value });
    const [next] = transition(this.machine, snapshot, { type: event });
    const value = next.value as StateValue;
    return { config: { value, active: activeKeys(value) }, fired };
  }

  /** Hand-off states active in `config` (a child's former final states), with the event each passes on. */
  pendingHandOffs(config: Config) {
    return config.active
      .filter((name) => this.handOffStates.has(name))
      .map((name) => ({ state: name, event: this.handOffStates.get(name)! }));
  }

  /**
   * Replay member- and system-sent events, inserting hand-off events whenever a hand-off state
   * becomes active, as the composed spec says the parent receives them automatically.
   */
  replay(start: Config, events: readonly string[]) {
    let config = start;
    const steps: (Step & { from: Config; to: Config })[] = [];
    const settle = () => {
      for (;;) {
        const pending = this.pendingHandOffs(config);
        if (pending.length === 0) return;
        const handOff = pending[0]!;
        const next = this.step(config, handOff.event);
        if (!next) return;
        steps.push({
          event: handOff.event,
          transitions: next.fired,
          handOff: true,
          from: config,
          to: next.config
        });
        config = next.config;
      }
    };
    for (const event of events) {
      const next = this.step(config, event);
      if (!next) {
        return { ok: false as const, steps, config, failedAt: event };
      }
      steps.push({ event, transitions: next.fired, handOff: false, from: config, to: next.config });
      config = next.config;
      settle();
    }
    return { ok: true as const, steps, config };
  }

  /**
   * Breadth-first from one or several starts at once: every configuration reachable using only
   * `allowed` events, each with the shortest event path from its nearest start (`origin` is that
   * start's index; ties go to the earlier start). `firstFired` holds, for every transition, the
   * shortest way to take it: the configuration it fires from and how that configuration was
   * reached. Exploration order is fixed by the chart, so the result is deterministic.
   */
  explore(start: Config | Config[], allowed: (event: string) => boolean, maxConfigs = 20_000) {
    const starts = Array.isArray(start) ? start : [start];
    const key = (c: Config) => configKey(c.value);
    type Seen = { config: Config; path: string[]; origin: number };
    const seen = new Map<string, Seen>();
    const queue: Config[] = [];
    starts.forEach((config, origin) => {
      if (seen.has(key(config))) return;
      seen.set(key(config), { config, path: [], origin });
      queue.push(config);
    });
    const edges: { from: string; event: string; to: string; fired: string[] }[] = [];
    const firstFired = new Map<string, { from: Seen; event: string }>();
    for (let head = 0; head < queue.length && seen.size < maxConfigs; head++) {
      const config = queue[head]!;
      const here = seen.get(key(config))!;
      for (const event of this.enabledEvents(config).filter(allowed)) {
        const next = this.step(config, event);
        if (!next) continue;
        edges.push({ from: key(config), event, to: key(next.config), fired: next.fired });
        for (const t of next.fired) if (!firstFired.has(t)) firstFired.set(t, { from: here, event });
        if (!seen.has(key(next.config))) {
          seen.set(key(next.config), { config: next.config, path: [...here.path, event], origin: here.origin });
          queue.push(next.config);
        }
      }
    }
    return { seen, edges, key, firstFired };
  }
}
