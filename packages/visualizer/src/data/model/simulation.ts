import { createMachine, initialTransition, transition, type AnyMachineSnapshot } from 'xstate';

import type { SpecDocument } from '../parse/spec';
import type { JourneyStep } from './types';

type XNode = { id: string; initial?: string; type?: 'parallel' | 'final'; states?: Record<string, XNode>; on?: Record<string, { target: string }> };
export type Exploration = { active: string[]; snapshot: AnyMachineSnapshot };
export type ExplorationResult = { config: Exploration; steps: JourneyStep[]; error: string | null; failedAt: string | null };
export type RouteResult = { status: 'found'; events: string[]; visited: number; transient?: boolean } | { status: 'unreachable' | 'limit' | 'invalid'; events: []; visited: number };

/** One pure composed model shared by free exploration and named journey replay. */
export class ChartSimulation {
  readonly rootId: string;
  private readonly machine;
  private readonly nameOf = new Map<string, string>();
  private readonly parentOf = new Map<string, string | null>();
  private readonly handlers = new Map<string, Map<string, string>>();
  private readonly handOffs = new Map<string, { event: string; transitionId: string }>();

  constructor(doc: SpecDocument, chartId: string) {
    let top = doc.charts.find((c) => c.id === chartId);
    const parents = new Set<string>();
    while (top?.parent && !parents.has(top.id)) {
      parents.add(top.id);
      top = doc.charts.find((c) => c.id === top!.parent!.chartId);
    }
    if (!top || !top.rootStates.length) throw new Error('This chart has no starting states.');
    this.rootId = top.id;
    if (top.explorationError) throw new Error(top.explorationError);
    const keyOf = new Map<string, string>();
    const key = (name: string) => {
      if (!keyOf.has(name)) {
        const id = `s${keyOf.size}`;
        keyOf.set(name, id);
        this.nameOf.set(id, name);
      }
      return keyOf.get(name)!;
    };
    const visiting = new Set<string>();
    const build = (name: string, parent: string | null): XNode => {
      const state = doc.states.get(name);
      if (!state || visiting.has(name)) throw new Error(`Cannot compose the state “${name}”.`);
      visiting.add(name);
      this.parentOf.set(name, parent);
      const node: XNode = { id: key(name) };
      const on: Record<string, { target: string }> = {};
      const handled = new Map<string, string>();
      for (const tid of state.transitions) {
        const t = doc.transitions.get(tid);
        if (!t?.target || t.carriedBy) continue;
        on[t.event] = { target: `#${key(t.target)}` };
        handled.set(t.event, tid);
        if (t.handOff) this.handOffs.set(name, { event: t.event, transitionId: tid });
      }
      const child = state.childChartId ? doc.charts.find((c) => c.id === state.childChartId) : null;
      if (child?.explorationError) throw new Error(child.explorationError);
      const children = child ? child.rootStates : state.children;
      if (children.length) {
        node.states = {};
        for (const name of children) {
          const built = build(name, state.name);
          node.states[built.id] = built;
        }
        if (state.type === 'parallel' || child?.type === 'parallel') node.type = 'parallel';
        else node.initial = key(child?.initial ?? state.initial ?? children[0]!);
      } else if (state.type === 'final' && !this.handOffs.has(name)) node.type = 'final';
      if (Object.keys(on).length) node.on = on;
      this.handlers.set(name, handled);
      visiting.delete(name);
      return node;
    };
    const root: XNode = { id: 'root', states: {} };
    for (const name of top.rootStates) {
      const node = build(name, null);
      root.states![node.id] = node;
    }
    if (top.type === 'parallel') root.type = 'parallel';
    else root.initial = key(top.initial ?? top.rootStates[0]!);
    this.machine = createMachine(root as Parameters<typeof createMachine>[0]);
  }

  private config(snapshot: AnyMachineSnapshot): Exploration {
    const active: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === 'string') active.push(this.nameOf.get(value) ?? value);
      else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
        active.push(this.nameOf.get(key) ?? key);
        walk(child);
      }
    };
    walk(snapshot.value);
    return { active, snapshot };
  }

  private descendant(name: string, ancestor: string) {
    for (let p = this.parentOf.get(name); p; p = this.parentOf.get(p)) if (p === ancestor) return true;
    return false;
  }

  leaves(config: Exploration) {
    return config.active.filter((name) => !config.active.some((other) => other !== name && this.descendant(other, name)));
  }

  enabled(config: Exploration) {
    return [...new Set(config.active.flatMap((name) => [...(this.handlers.get(name)?.keys() ?? [])]))];
  }

  private step(config: Exploration, event: string, handOff: boolean): { config: Exploration; step: JourneyStep } | null {
    const candidates = config.active.filter((name) => this.handlers.get(name)?.has(event));
    const fired = candidates.filter((name) => !candidates.some((other) => other !== name && this.descendant(other, name)));
    if (!fired.length) return null;
    const [snapshot] = transition(this.machine, config.snapshot, { type: event });
    const next = this.config(snapshot);
    return { config: next, step: { index: 0, event, handOff, transitionIds: fired.map((name) => this.handlers.get(name)!.get(event)!), from: config.active, to: next.active } };
  }

  private settle(result: ExplorationResult): ExplorationResult {
    const seen = new Set<string>();
    for (let count = 0; count < 100; count++) {
      const pending = result.config.active.find((name) => this.handOffs.has(name));
      if (!pending) return result;
      const key = JSON.stringify(result.config.snapshot.value);
      if (seen.has(key)) return { ...result, error: 'Automatic hand-offs form a cycle. The model stopped safely.' };
      seen.add(key);
      const event = this.handOffs.get(pending)!.event;
      const next = this.step(result.config, event, true);
      if (!next) return { ...result, error: `The automatic hand-off “${event}” cannot complete.` };
      result = { ...result, config: next.config, steps: [...result.steps, { ...next.step, index: result.steps.length }] };
    }
    return { ...result, error: 'The model exceeded 100 automatic hand-offs. Exploration stopped safely.' };
  }

  initial(): ExplorationResult {
    const [snapshot] = initialTransition(this.machine);
    return this.settle({ config: this.config(snapshot), steps: [], error: null, failedAt: null });
  }

  advance(config: Exploration, event: string): ExplorationResult {
    const next = this.step(config, event, false);
    if (!next) return { config, steps: [], error: `“${event}” is unavailable in the current states.`, failedAt: event };
    return this.settle({ config: next.config, steps: [next.step], error: null, failedAt: null });
  }

  replay(events: readonly string[]): ExplorationResult {
    let result = this.initial();
    if (result.error) return result;
    for (const event of events) {
      const next = this.advance(result.config, event);
      result = { ...next, steps: [...result.steps, ...next.steps].map((step, index) => ({ ...step, index })) };
      if (result.error) return result;
    }
    return result;
  }

  /** Bounded BFS, including automatic hand-offs; no arbitrary teleporting to a state. */
  route(start: Exploration, target: string, maxConfigs = 2000): RouteResult {
    if (!this.handlers.has(target)) return { status: 'invalid', events: [], visited: 0 };
    const key = (config: Exploration) => JSON.stringify(config.snapshot.value);
    const budget = Number.isFinite(maxConfigs) ? Math.max(1, Math.min(20_000, Math.floor(maxConfigs))) : 2000;
    const queue = [{ config: start, events: [] as string[] }];
    const seen = new Set([key(start)]);
    for (let head = 0; head < queue.length; head++) {
      const here = queue[head]!;
      if (here.config.active.includes(target)) return { status: 'found', events: here.events, visited: seen.size };
      for (const event of this.enabled(here.config)) {
        const next = this.advance(here.config, event);
        if (next.error) continue;
        const events = [...here.events, event];
        if (next.config.active.includes(target)) return { status: 'found', events, visited: seen.size + 1 };
        if (next.steps.some((step) => step.to.includes(target))) return { status: 'found', events, visited: seen.size + 1, transient: true };
        if (seen.has(key(next.config))) continue;
        if (seen.size >= budget) return { status: 'limit', events: [], visited: seen.size };
        seen.add(key(next.config));
        queue.push({ config: next.config, events });
      }
    }
    return { status: 'unreachable', events: [], visited: seen.size };
  }
}

export function createSimulationFactory(doc: SpecDocument) {
  const cache = new Map<string, ChartSimulation>();
  return (chartId: string) => {
    if (!cache.has(chartId)) cache.set(chartId, new ChartSimulation(doc, chartId));
    return cache.get(chartId)!;
  };
}
