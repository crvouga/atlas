import { describe, expect, it } from 'vitest';

import type { Chart, MachineConfig } from './types';
import { ChartGraph } from '../graph';
import { composeCharts } from './compose';
import { bundleOf } from './load';

const chart = (machine: MachineConfig): Chart => ({ file: `${machine.id}.machine.json`, format: 'xstate', machine });

const CHECKOUT: MachineConfig = {
  id: 'Checkout',
  initial: 'Entering details',
  states: {
    'Entering details': { on: { 'Submits details': 'Reviewing', 'Backs out': 'Abandoned' } },
    Reviewing: { on: { Pays: 'Paid' } },
    Paid: { type: 'final', meta: { doneEvent: 'Payment accepted' } },
    Abandoned: { type: 'final', meta: { doneEvent: 'Checkout abandoned' } }
  }
};

describe('composeCharts', () => {
  it('inlines an invoked chart and hands its final to onDone as done.invoke.<id>', () => {
    const shop: MachineConfig = {
      id: 'Shop',
      initial: 'Cart',
      states: {
        Cart: { on: { 'Checks out': '#Checking out' } },
        'Checking out': { invoke: { src: 'Wizard', id: 'wizard', onDone: '#Order placed' } },
        'Order placed': { meta: { deadEnd: 'Final.' } }
      }
    };
    const wizard: MachineConfig = { id: 'Wizard', initial: 'Step one', states: { 'Step one': { on: { Continues: 'Finished' } }, Finished: { type: 'final' } } };
    const { machine, handOffs, hosts, chartOf } = composeCharts(bundleOf('.', [chart(shop), chart(wizard)], []));

    const host = machine.states?.['Checking out'];
    expect(host?.invoke).toBeUndefined();
    expect(host?.initial).toBe('Step one');
    expect(host?.states?.Finished).toEqual({ id: 'Finished', on: { 'done.invoke.wizard': { target: '#Order placed' } } });
    expect(handOffs).toEqual([{ finalState: 'Finished', event: 'done.invoke.wizard', parentState: 'Checking out', childChart: 'Wizard' }]);
    expect(hosts.get('Wizard')).toBe('Checking out');
    expect(chartOf.get('Step one')).toBe('Wizard');
    expect(chartOf.get('Cart')).toBe('Shop');

    const graph = new ChartGraph(machine, handOffs);
    const replay = graph.replay(graph.initial(), ['Checks out', 'Continues']);
    expect(replay.ok).toBe(true);
    expect(replay.config.active).toEqual(['Order placed']);
    expect(replay.steps.map((s) => [s.event, s.handOff])).toEqual([
      ['Checks out', false],
      ['Continues', false],
      ['done.invoke.wizard', true]
    ]);
  });

  it('uses the invoke src as the id when the invoke has none', () => {
    const shop: MachineConfig = { id: 'Shop', initial: 'Host', states: { Host: { invoke: { src: 'Wizard', onDone: '#After' } }, After: {} } };
    const wizard: MachineConfig = { id: 'Wizard', initial: 'Done', states: { Done: { type: 'final' } } };
    const { handOffs } = composeCharts(bundleOf('.', [chart(shop), chart(wizard)], []));
    expect(handOffs[0]?.event).toBe('done.invoke.Wizard');
  });

  it('routes each final by its meta.doneEvent, consuming those events on the host', () => {
    const shop: MachineConfig = {
      id: 'Shop',
      initial: 'Cart',
      states: {
        Cart: { on: { 'Checks out': '#Checking out' } },
        'Checking out': {
          invoke: { src: 'Checkout' },
          on: { 'Payment accepted': '#Order placed', 'Checkout abandoned': '#Cart', 'Session expires': '#Cart' }
        },
        'Order placed': { meta: { deadEnd: 'Final.' } }
      }
    };
    const { machine, handOffs } = composeCharts(bundleOf('.', [chart(shop), chart(CHECKOUT)], []));
    const host = machine.states?.['Checking out'];
    expect(host?.on).toEqual({ 'Session expires': '#Cart' });
    expect(host?.states?.Paid?.type).toBeUndefined();
    expect(host?.states?.Paid?.on).toEqual({ 'Payment accepted': { target: '#Order placed' } });
    expect(host?.states?.Abandoned?.on).toEqual({ 'Checkout abandoned': { target: '#Cart' } });
    expect(handOffs.map((h) => `${h.finalState} -> ${h.event}`)).toEqual(['Paid -> Payment accepted', 'Abandoned -> Checkout abandoned']);

    const graph = new ChartGraph(machine, handOffs);
    expect(graph.replay(graph.initial(), ['Checks out', 'Backs out']).config.active).toEqual(['Cart']);
    expect(graph.replay(graph.initial(), ['Checks out', 'Submits details', 'Pays']).config.active).toEqual(['Order placed']);
  });

  it('sends a final with a doneEvent the host does not handle to onDone', () => {
    const shop: MachineConfig = {
      id: 'Shop',
      initial: 'Checking out',
      states: { 'Checking out': { invoke: { src: 'Checkout', id: 'pay', onDone: '#Home' } }, Home: {} }
    };
    const { machine } = composeCharts(bundleOf('.', [chart(shop), chart(CHECKOUT)], []));
    expect(machine.states?.['Checking out']?.states?.Paid?.on).toEqual({ 'Payment accepted': { target: '#Home' } });
    expect(machine.states?.['Checking out']?.states?.Abandoned?.on).toEqual({ 'Checkout abandoned': { target: '#Home' } });
  });

  it('supports the legacy meta.childMachine and meta.childFinalEvents', () => {
    const shop: MachineConfig = {
      id: 'Shop',
      initial: 'Checking out',
      states: {
        'Checking out': {
          meta: { childMachine: 'Checkout', childFinalEvents: { Paid: 'Order confirmed', Abandoned: 'Gave up' } },
          on: { 'Order confirmed': '#Thanks', 'Gave up': '#Home' }
        },
        Thanks: {},
        Home: {}
      }
    };
    const { machine, handOffs, hosts } = composeCharts(bundleOf('.', [chart(shop), chart(CHECKOUT)], []));
    expect(hosts.get('Checkout')).toBe('Checking out');
    expect(handOffs.map((h) => h.event)).toEqual(['Order confirmed', 'Gave up']);
    expect(machine.states?.['Checking out']?.states?.Paid?.on).toEqual({ 'Order confirmed': { target: '#Thanks' } });
    expect(machine.states?.['Checking out']?.on).toBeUndefined();
  });

  it('composes a grandchild inside a child', () => {
    const root: MachineConfig = { id: 'Root', initial: 'A', states: { A: { invoke: { src: 'Middle', onDone: '#Z' } }, Z: {} } };
    const middle: MachineConfig = { id: 'Middle', initial: 'M', states: { M: { invoke: { src: 'Leaf', onDone: '#End of middle' } }, 'End of middle': { type: 'final' } } };
    const leaf: MachineConfig = { id: 'Leaf', initial: 'L', states: { L: { on: { Finishes: 'Leaf done' } }, 'Leaf done': { type: 'final' } } };
    const bundle = bundleOf('.', [chart(leaf), chart(middle), chart(root)], []);
    expect(bundle.root).toBe('Root');
    const { machine, handOffs, chartOf } = composeCharts(bundle);
    expect(chartOf.get('L')).toBe('Leaf');
    expect(chartOf.get('M')).toBe('Middle');
    const graph = new ChartGraph(machine, handOffs);
    expect(graph.replay(graph.initial(), ['Finishes']).config.active).toEqual(['Z']);
  });

  it('rejects a missing child, a cycle, and a final with nowhere to go', () => {
    const missing: MachineConfig = { id: 'Shop', initial: 'A', states: { A: { invoke: { src: 'Nope' } } } };
    expect(() => composeCharts(bundleOf('.', [chart(missing)], []))).toThrow(/invokes chart "Nope", which is not loaded/);

    const a: MachineConfig = { id: 'A', initial: 'x', states: { x: { invoke: { src: 'B', onDone: '#x' } } } };
    const b: MachineConfig = { id: 'B', initial: 'y', states: { y: { invoke: { src: 'B', onDone: '#y' } } } };
    expect(() => composeCharts(bundleOf('.', [chart(a), chart(b)], []))).toThrow(/cycle/);

    const stuck: MachineConfig = { id: 'Shop', initial: 'Host', states: { Host: { invoke: { src: 'Checkout' } } } };
    expect(() => composeCharts(bundleOf('.', [chart(stuck), chart(CHECKOUT)], []))).toThrow(/has nowhere to go/);
  });
});
