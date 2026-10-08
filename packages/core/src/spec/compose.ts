import type { InvokeConfig, MachineConfig, SpecBundle, StateConfig, TransitionConfig } from './types';
import { invokesOf, targetOf, walkStates } from './types';

export type HandOff = { finalState: string; event: string; parentState: string; childChart: string };

export type Composition = {
  machine: MachineConfig;
  /** Which chart each state came from. */
  chartOf: Map<string, string>;
  /** A child's former final states and the event each hands to its parent. */
  handOffs: HandOff[];
  /** The state each child chart is inlined into. */
  hosts: Map<string, string>;
};

function asTransition(t: TransitionConfig | string | undefined): TransitionConfig | undefined {
  const target = targetOf(t);
  return target ? { target: `#${target}` } : undefined;
}

/**
 * Inline every child chart where its parent invokes it, so XState's graph traversal (which cannot
 * enter an invoked actor) walks straight through. Supports:
 *
 * - XState `invoke: { src, id, onDone }` and SCXML `<invoke>` + `done.invoke.<id>`;
 * - a final state's `meta.doneEvent`, naming the event the parent receives from that final;
 * - the legacy `meta.childMachine` + `meta.childFinalEvents` on the parent state.
 *
 * A child's final states stay as states (they keep their screenshots and checks) but stop being
 * final: each takes the parent's transition for its hand-off event.
 */
export function composeCharts(bundle: SpecBundle): Composition {
  const byId = new Map(bundle.charts.map((c) => [c.machine.id, c.machine]));
  const chartOf = new Map<string, string>();
  const handOffs: HandOff[] = [];
  const hosts = new Map<string, string>();
  const root = byId.get(bundle.root);
  if (!root) throw new Error(`Root chart "${bundle.root}" is not loaded`);

  const inline = (name: string, node: StateConfig, chart: string, stack: string[]): StateConfig => {
    chartOf.set(name, chart);
    const invoke: InvokeConfig | undefined =
      invokesOf(node)[0] ?? (typeof node.meta?.childMachine === 'string' ? { src: node.meta.childMachine } : undefined);
    if (invoke) {
      const child = byId.get(invoke.src);
      if (!child) throw new Error(`"${name}" invokes chart "${invoke.src}", which is not loaded`);
      hosts.set(invoke.src, name);
      if (stack.includes(invoke.src)) throw new Error(`Charts invoke each other in a cycle: ${[...stack, invoke.src].join(' → ')}`);
      const legacy = (node.meta?.childFinalEvents as Record<string, string> | undefined) ?? {};
      const doneEvent = `done.invoke.${invoke.id ?? invoke.src}`;
      const consumed = new Set<string>();
      const retarget = (states: Record<string, StateConfig>): Record<string, StateConfig> =>
        Object.fromEntries(
          Object.entries(states).map(([k, s]) => {
            if (s.type === 'final') {
              const event = legacy[k] ?? (typeof s.meta?.doneEvent === 'string' ? s.meta.doneEvent : doneEvent);
              const transition = asTransition(node.on?.[event]) ?? asTransition(invoke.onDone);
              if (!transition) throw new Error(`Child final "${k}" has nowhere to go in "${name}" (no "${event}" or onDone)`);
              consumed.add(event);
              handOffs.push({ finalState: k, event, parentState: name, childChart: invoke.src });
              const { type: _final, ...rest } = s;
              chartOf.set(k, invoke.src);
              return [k, { ...rest, on: { ...rest.on, [event]: transition } }];
            }
            return [k, inline(k, s, invoke.src, [...stack, invoke.src])];
          })
        );
      const states = retarget(child.states ?? {});
      const { invoke: _invoke, ...withoutInvoke } = node;
      const on = Object.fromEntries(Object.entries(node.on ?? {}).filter(([event]) => !consumed.has(event)));
      return { ...withoutInvoke, initial: child.initial, states, ...(Object.keys(on).length ? { on } : { on: undefined }) };
    }
    if (!node.states) return node;
    return {
      ...node,
      states: Object.fromEntries(Object.entries(node.states).map(([k, v]) => [k, inline(k, v, chart, stack)]))
    };
  };

  const states = Object.fromEntries(
    Object.entries(root.states ?? {}).map(([k, v]) => [k, inline(k, v, root.id, [root.id])])
  );
  const machine = JSON.parse(JSON.stringify({ ...root, states })) as MachineConfig;
  for (const { name, node } of walkStates(machine)) {
    if (!node.id) node.id = name;
  }
  return { machine, chartOf, handOffs, hosts };
}
