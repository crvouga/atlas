import { createMachine, initialTransition, transition, type AnyMachineSnapshot } from 'xstate';

import type { IssueSink } from '../parse/issues';
import type { ParsedJourney, SpecDocument } from '../parse/spec';
import type { JourneyStep } from './types';

type XNode = {
  id: string;
  initial?: string;
  type?: 'parallel';
  states?: Record<string, XNode>;
  on?: Record<string, { target: string }>;
};

type Composition = {
  machine: ReturnType<typeof createMachine>;
  nameOf: Map<string, string>;
  parentOf: Map<string, string | null>;
  /** Events each state responds to, with the transition each fires. */
  handlers: Map<string, Map<string, string>>;
  /** Former final states of a child chart, with the event they hand to the parent. */
  handOffs: Map<string, { event: string; transitionId: string }>;
};

/**
 * The group's top chart with each child chart inlined at the state that names it, as the runner
 * composes them: the child's final states keep their hand-off transition instead of ending.
 */
function compose(doc: SpecDocument, chartIds: string[]): Composition | null {
  const top = doc.charts.find((c) => chartIds.includes(c.id) && !c.parent);
  if (!top || top.rootStates.length === 0) return null;
  const keyOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const parentOf = new Map<string, string | null>();
  const handlers = new Map<string, Map<string, string>>();
  const handOffs = new Map<string, { event: string; transitionId: string }>();
  const key = (name: string) => {
    if (!keyOf.has(name)) {
      const k = `s${keyOf.size}`;
      keyOf.set(name, k);
      nameOf.set(k, name);
    }
    return keyOf.get(name)!;
  };
  const visiting = new Set<string>();

  const build = (name: string, parent: string | null): XNode | null => {
    const state = doc.states.get(name);
    if (!state || visiting.has(name)) return null;
    visiting.add(name);
    parentOf.set(name, parent);
    const node: XNode = { id: key(name) };
    const on: Record<string, { target: string }> = {};
    const handled = new Map<string, string>();
    for (const tid of state.transitions) {
      const t = doc.transitions.get(tid);
      if (!t?.target || t.carriedBy) continue;
      on[t.event] = { target: `#${key(t.target)}` };
      handled.set(t.event, tid);
      if (t.handOff) handOffs.set(name, { event: t.event, transitionId: tid });
    }
    const child = state.childChartId ? doc.charts.find((c) => c.id === state.childChartId) : null;
    const childNames = child ? child.rootStates : state.children;
    const childInitial = child ? child.initial : state.initial;
    if (childNames.length) {
      node.states = {};
      for (const c of childNames) {
        const built = build(c, name);
        if (built) node.states[built.id] = built;
      }
      if (state.type === 'parallel') node.type = 'parallel';
      else if (childInitial && keyOf.has(childInitial)) node.initial = keyOf.get(childInitial);
      else node.initial = Object.keys(node.states)[0];
    }
    if (Object.keys(on).length) node.on = on;
    handlers.set(name, handled);
    visiting.delete(name);
    return node;
  };

  const root: XNode = { id: 'root', states: {} };
  for (const name of top.rootStates) {
    const built = build(name, null);
    if (built) root.states![built.id] = built;
  }
  root.initial = top.initial && keyOf.has(top.initial) ? keyOf.get(top.initial) : Object.keys(root.states!)[0];
  const machine = createMachine(root as Parameters<typeof createMachine>[0]);
  return { machine, nameOf, parentOf, handlers, handOffs };
}

function activeNames(snapshot: AnyMachineSnapshot, nameOf: Map<string, string>) {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      out.push(nameOf.get(value) ?? value);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        out.push(nameOf.get(k) ?? k);
        walk(v);
      }
    }
  };
  walk(snapshot.value);
  return out;
}

function isDescendant(c: Composition, name: string, ancestor: string) {
  for (let p = c.parentOf.get(name); p; p = c.parentOf.get(p) ?? null) if (p === ancestor) return true;
  return false;
}

/** In each region, the deepest active state that handles the event. */
function firedBy(c: Composition, active: string[], event: string) {
  const candidates = active.filter((name) => c.handlers.get(name)?.has(event));
  return candidates
    .filter((name) => !candidates.some((other) => other !== name && isDescendant(c, other, name)))
    .map((name) => c.handlers.get(name)!.get(event)!);
}

export type ReplayResult = {
  steps: JourneyStep[];
  ok: boolean;
  failedAt: string | null;
  missingEnds: string[];
};

export function createJourneyReplayer(doc: SpecDocument, sink: IssueSink) {
  const cache = new Map<string, Composition | null>();
  const compositionFor = (dir: string) => {
    if (!cache.has(dir)) {
      const group = doc.groups.find((g) => g.dir === dir);
      try {
        cache.set(dir, group ? compose(doc, group.chartIds) : null);
      } catch (error) {
        sink.add('warning', group ? doc.charts.find((ch) => ch.id === group.chartIds[0])?.file ?? dir : dir, [], `Journeys can't be traced through this chart: ${error instanceof Error ? error.message : 'unknown problem'}.`);
        cache.set(dir, null);
      }
    }
    return cache.get(dir) ?? null;
  };

  return (journey: ParsedJourney): ReplayResult => {
    const c = compositionFor(journey.dir);
    if (!c) return { steps: [], ok: false, failedAt: journey.events[0] ?? null, missingEnds: journey.endsIn };
    let [snapshot] = initialTransition(c.machine);
    const steps: JourneyStep[] = [];
    const apply = (event: string, handOff: boolean) => {
      const from = activeNames(snapshot, c.nameOf);
      const fired = firedBy(c, from, event);
      if (fired.length === 0) return false;
      [snapshot] = transition(c.machine, snapshot, { type: event });
      steps.push({ index: steps.length, event, transitionIds: fired, handOff, from, to: activeNames(snapshot, c.nameOf) });
      return true;
    };
    const settle = () => {
      for (let guard = 0; guard < 20; guard++) {
        const pending = activeNames(snapshot, c.nameOf).find((name) => c.handOffs.has(name));
        if (!pending || !apply(c.handOffs.get(pending)!.event, true)) return;
      }
    };
    for (const event of journey.events) {
      if (!apply(event, false)) {
        sink.add('warning', journey.file, ['journeys', journey.name], `"${event}" can't happen at that point in the journey, so the journey stops there on the map.`);
        return { steps, ok: false, failedAt: event, missingEnds: [] };
      }
      settle();
    }
    const active = new Set(activeNames(snapshot, c.nameOf));
    const missingEnds = journey.endsIn.filter((s) => !active.has(s));
    if (missingEnds.length) {
      sink.add('info', journey.file, ['journeys', journey.name, 'endsIn'], `The journey should end in ${missingEnds.map((s) => `"${s}"`).join(', ')}, but the chart doesn't take it there.`);
    }
    return { steps, ok: missingEnds.length === 0, failedAt: null, missingEnds };
  };
}
