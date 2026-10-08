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

  initial(): Config {
    const [snapshot] = initialTransition(this.machine);
    return {
      value: snapshot.value as StateValue,
      active: activeKeys(snapshot.value as StateValue)
    };
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

  /** Breadth-first: every configuration reachable from `start` using only `allowed` events. */
  explore(start: Config, allowed: (event: string) => boolean, maxConfigs = 5_000) {
    const key = (c: Config) => JSON.stringify(c.value);
    const seen = new Map<string, { config: Config; path: string[] }>([
      [key(start), { config: start, path: [] }]
    ]);
    const queue = [start];
    const edges: { from: string; event: string; to: string; fired: string[] }[] = [];
    while (queue.length && seen.size < maxConfigs) {
      const config = queue.shift()!;
      const here = seen.get(key(config))!;
      for (const event of this.enabledEvents(config).filter(allowed)) {
        const next = this.step(config, event);
        if (!next) continue;
        edges.push({ from: key(config), event, to: key(next.config), fired: next.fired });
        if (!seen.has(key(next.config))) {
          seen.set(key(next.config), { config: next.config, path: [...here.path, event] });
          queue.push(next.config);
        }
      }
    }
    return { seen, edges, key };
  }
}
