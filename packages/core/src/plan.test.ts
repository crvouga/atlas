import { describe, expect, it } from 'vitest';

import type { Chart, Journey, MachineConfig } from './spec/types';
import { lintBundle } from './lint';
import { chartScope, planChart, runnableSteps } from './plan';
import { bundleOf } from './spec/load';
import { splitTransitionId } from './spec/types';

const chart = (machine: MachineConfig): Chart => ({ file: `${machine.id}.machine.json`, format: 'xstate', machine });

const SHOP: MachineConfig = {
  id: 'Shop',
  initial: 'Browsing',
  states: {
    Browsing: { on: { 'Adds to cart': 'Cart' } },
    Cart: { on: { 'Checks out': 'Checking out', 'Empties cart': 'Browsing' } },
    'Checking out': { invoke: { src: 'Checkout' }, on: { 'Payment accepted': 'Order placed', 'Checkout abandoned': 'Cart' } },
    'Order placed': { on: { 'Shops again': 'Browsing' } }
  }
};

const CHECKOUT: MachineConfig = {
  id: 'Checkout',
  initial: 'Entering details',
  states: {
    'Entering details': { on: { 'Submits details': 'Reviewing', 'Backs out': 'Abandoned' } },
    Reviewing: { on: { Pays: 'Paid', 'Edits details': 'Entering details' } },
    Paid: { type: 'final', meta: { doneEvent: 'Payment accepted' } },
    Abandoned: { type: 'final', meta: { doneEvent: 'Checkout abandoned' } }
  }
};

const BUYS: Journey = { name: 'Buys', description: 'Buys one thing.', events: ['Adds to cart', 'Checks out', 'Submits details', 'Pays', 'Shops again'], endsIn: ['Browsing'] };

function setUp(journeys: Journey[] = []) {
  const bundle = bundleOf('.', [chart(SHOP), chart(CHECKOUT)], journeys);
  const { composition, graph } = lintBundle(bundle, { requiredMeta: [] });
  return { bundle, composition, graph };
}

const plannedTransitions = (paths: { steps: { transitions: string[] }[] }[]) => new Set(paths.flatMap((p) => p.steps.flatMap((s) => s.transitions)));

describe('planChart', () => {
  it('plans every transition of the product, through child charts and their hand-offs', () => {
    const { bundle, composition, graph } = setUp();
    const scope = chartScope(bundle, composition, graph);
    const { paths, unreachable } = planChart(bundle, graph, scope);

    expect(scope.transitions.size).toBe(10);
    expect(unreachable).toEqual([]);
    expect(plannedTransitions(paths)).toEqual(scope.transitions);
    expect(paths.every((p) => p.kind === 'generated' && p.start.includes('Browsing'))).toBe(true);
  });

  it('ends every generated path on the transition it is named after, even past a hand-off', () => {
    const { bundle, composition, graph } = setUp();
    const { paths } = planChart(bundle, graph, chartScope(bundle, composition, graph));
    for (const path of paths) {
      const [source, event] = path.name.replace(/^Covers: /, '').split(' → ');
      const at = path.steps.findIndex((s) => s.transitions.some((t) => splitTransitionId(t).source === source && splitTransitionId(t).event === event));
      expect(at, path.name).toBeGreaterThanOrEqual(0);
      expect(path.steps.slice(at + 1).every((s) => s.handOff), path.name).toBe(true);
    }
    const shopsAgain = paths.find((p) => p.name === 'Covers: Order placed → Shops again');
    expect(shopsAgain?.steps.map((s) => (s.handOff ? `${s.event}*` : s.event))).toEqual([
      'Adds to cart',
      'Checks out',
      'Submits details',
      'Pays',
      'Payment accepted*',
      'Shops again'
    ]);
  });

  it('runs curated journeys first and generates only what they leave uncovered', () => {
    const { bundle, composition, graph } = setUp([BUYS, BUYS]);
    const { paths, unreachable } = planChart(bundle, graph, chartScope(bundle, composition, graph));
    expect(paths[0]).toMatchObject({ id: 'journey-1', kind: 'journey', name: 'Buys', start: ['Browsing'], blockedBy: [] });
    expect(paths.filter((p) => p.kind === 'journey')).toHaveLength(1);
    const journeyCovers = new Set(paths[0]!.steps.flatMap((s) => s.transitions));
    for (const generated of paths.filter((p) => p.kind === 'generated')) {
      expect(generated.steps.at(-1)!.transitions.some((t) => journeyCovers.has(t))).toBe(false);
    }
    expect(unreachable).toEqual([]);
  });

  it('cuts journeys to the stretch inside a child chart scope, entered only by the entry events', () => {
    const { bundle, composition, graph } = setUp([BUYS]);
    const scope = chartScope(bundle, composition, graph, { chart: 'Checkout', start: 'Cart', startLabel: 'A full cart', entryEvents: ['Checks out'] });

    expect(scope.startLabel).toBe('A full cart');
    expect([...scope.entries]).toEqual(['Cart :: Checks out']);
    expect([...scope.transitions].sort()).toEqual(
      [
        'Abandoned :: Checkout abandoned',
        'Cart :: Checks out',
        'Entering details :: Backs out',
        'Entering details :: Submits details',
        'Paid :: Payment accepted',
        'Reviewing :: Edits details',
        'Reviewing :: Pays'
      ].sort()
    );
    expect(scope.states.has('Checking out')).toBe(true);
    expect(scope.states.has('Order placed')).toBe(true);

    const { paths, unreachable } = planChart(bundle, graph, scope);
    expect(unreachable).toEqual([]);
    expect(paths[0]).toMatchObject({ kind: 'journey', start: ['Cart'] });
    expect(paths[0]!.steps.map((s) => s.event)).toEqual(['Checks out', 'Submits details', 'Pays', 'Payment accepted']);
    for (const path of paths) expect(path.steps[0]?.event, path.name).toBe('Checks out');
    expect(plannedTransitions(paths)).toEqual(scope.transitions);
  });

  it('stops paths before blocked events and reports, without running, those that add nothing', () => {
    const { bundle, composition, graph } = setUp([BUYS]);
    const isBlocked = (event: string) => event === 'Pays';
    const { paths, unreachable } = planChart(bundle, graph, chartScope(bundle, composition, graph), { isBlocked });

    const journey = paths[0]!;
    expect(journey.blockedBy).toEqual(['Pays']);
    expect(journey.skipRun).toBeUndefined();
    expect(runnableSteps(journey.steps, isBlocked).map((s) => s.event)).toEqual(['Adds to cart', 'Checks out', 'Submits details']);

    const blocked = paths.slice(1).filter((p) => p.blockedBy.length);
    expect(blocked.length).toBeGreaterThan(0);
    for (const path of blocked) expect(path.skipRun, path.name).toBe(true);
    for (const path of paths.filter((p) => !p.blockedBy.length)) expect(path.steps.some((s) => isBlocked(s.event))).toBe(false);
    expect(unreachable).toEqual([]);
  });

  it('marks journeys the implementation cannot start, and covers their transitions elsewhere', () => {
    const { bundle, composition, graph } = setUp([BUYS]);
    const { paths } = planChart(bundle, graph, chartScope(bundle, composition, graph), { canStart: () => 'no seed for this start' });
    expect(paths[0]!.blockedBy).toEqual(['Start: no seed for this start']);
    expect(paths.filter((p) => p.kind === 'generated').length).toBeGreaterThan(0);
  });

  it('scopes a run to one state of a single chart, with the transitions into and out of it', () => {
    const product: MachineConfig = {
      id: 'Product',
      initial: 'Browsing',
      states: {
        Browsing: { on: { 'Adds to cart': 'Cart' } },
        Cart: { on: { 'Checks out': 'Checking out', 'Empties cart': 'Browsing' } },
        'Checking out': {
          initial: 'Entering details',
          on: { 'Gives up': 'Cart' },
          states: {
            'Entering details': { on: { 'Submits details': 'Reviewing' } },
            Reviewing: { on: { Pays: '#Order placed', 'Edits details': 'Entering details' } }
          }
        },
        'Order placed': { id: 'Order placed', on: { 'Shops again': 'Browsing' } }
      }
    };
    const bundle = bundleOf('.', [chart(product)], [{ name: 'Buys', description: 'Buys.', events: ['Adds to cart', 'Checks out', 'Submits details', 'Pays', 'Shops again'], endsIn: ['Browsing'] }]);
    const { composition, graph } = lintBundle(bundle, { requiredMeta: [] });
    const scope = chartScope(bundle, composition, graph, { state: 'Checking out', start: 'Cart', entryEvents: ['Checks out'] });

    expect(scope.state).toBe('Checking out');
    expect([...scope.states].sort()).toEqual(['Cart', 'Checking out', 'Entering details', 'Order placed', 'Reviewing']);
    expect([...scope.transitions].sort()).toEqual([
      'Cart :: Checks out',
      'Checking out :: Gives up',
      'Entering details :: Submits details',
      'Reviewing :: Edits details',
      'Reviewing :: Pays'
    ]);
    const { paths, unreachable } = planChart(bundle, graph, scope);
    expect(unreachable).toEqual([]);
    expect(paths.every((p) => p.steps[0]?.event === 'Checks out')).toBe(true);
    expect(paths.find((p) => p.kind === 'journey')?.steps.map((s) => s.event)).toEqual(['Checks out', 'Submits details', 'Pays']);
  });
});
