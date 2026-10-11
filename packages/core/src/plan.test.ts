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
    for (const path of blocked) expect(path.skipRun, path.name).toBe(true);
    const events = (p: { steps: { event: string }[] }) => p.steps.map((s) => s.event).join(' > ');
    for (const path of paths.filter((p) => p.kind === 'generated')) {
      for (const other of paths) if (other !== path) expect(events(other).startsWith(events(path)), `${path.name} is a prefix of ${other.name}`).toBe(false);
    }
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

  describe('with seeds', () => {
    const product: MachineConfig = {
      id: 'Product',
      initial: 'Visitor',
      states: {
        Visitor: { on: { 'Signs up': 'Member' } },
        Member: {
          type: 'parallel',
          states: {
            Plan: { initial: 'Free', states: { Free: { on: { Upgrades: 'Paid' } }, Paid: { on: { Downgrades: 'Free' } } } },
            Orders: { initial: 'None', states: { None: { on: { Orders: 'Ordered' } }, Ordered: { on: { 'Order arrives': 'Delivered' } }, Delivered: {} } }
          }
        }
      }
    };
    const journeys: Journey[] = [
      { name: 'Free order', description: 'Orders on the free plan.', events: ['Signs up', 'Orders', 'Order arrives'], endsIn: ['Delivered'] },
      { name: 'Paid order', description: 'Upgrades, then orders.', events: ['Signs up', 'Upgrades', 'Orders', 'Order arrives'], endsIn: ['Delivered'] }
    ];
    const plan = (seeds: { name: string; at: string | Record<string, unknown> }[], extra: { hasSetup?: boolean } = {}) => {
      const bundle = bundleOf('.', [chart(product)], journeys);
      const { composition, graph } = lintBundle(bundle, { requiredMeta: [] });
      const scope = chartScope(bundle, composition, graph);
      return planChart(bundle, graph, scope, { seeds: seeds.map((s) => ({ name: s.name, at: typeof s.at === 'string' ? graph.valueOf(s.at) : (s.at as never) })), ...extra });
    };

    it('cuts journeys at seeded configurations and runs a stretch journeys share once', () => {
      const { paths, journeys: planned } = plan([
        { name: 'Free member', at: 'Member' },
        { name: 'Paid member', at: { Member: { Plan: 'Paid' } } }
      ]);
      const journeyPaths = paths.filter((p) => p.kind === 'journey');
      expect(journeyPaths.map((p) => [p.id, p.seed ?? 'setup', p.steps.map((s) => s.event), p.journeys])).toEqual([
        ['journey-1', 'setup', ['Signs up'], ['Free order', 'Paid order']],
        ['journey-2', 'Free member', ['Orders', 'Order arrives'], ['Free order']],
        ['journey-3', 'Free member', ['Upgrades'], ['Paid order']],
        ['journey-4', 'Paid member', ['Orders', 'Order arrives'], ['Paid order']]
      ]);
      expect(planned.map((j) => [j.name, j.paths])).toEqual([
        ['Free order', ['journey-1', 'journey-2']],
        ['Paid order', ['journey-1', 'journey-3', 'journey-4']]
      ]);
    });

    it('starts every generated path at the nearest seed, and plans the same every time', () => {
      const seeds = [{ name: 'Paid member', at: { Member: { Plan: 'Paid' } } }];
      const first = plan(seeds);
      const generated = first.paths.filter((p) => p.kind === 'generated');
      const downgrade = generated.find((p) => p.name === 'Covers: Paid → Downgrades')!;
      expect(downgrade).toMatchObject({ seed: 'Paid member' });
      expect(downgrade.steps.map((s) => s.event)).toEqual(['Downgrades']);
      expect(first.unreachable).toEqual([]);
      expect(plan(seeds).paths.map((p) => [p.id, p.key])).toEqual(first.paths.map((p) => [p.id, p.key]));
    });

    it('plans from seeds alone when there is no setup', () => {
      const { paths, unreachable } = plan([{ name: 'Free member', at: 'Member' }], { hasSetup: false });
      expect(paths.find((p) => p.steps[0]?.event === 'Signs up')?.blockedBy).toEqual(['Start: no seed puts the system in Visitor']);
      expect(paths.filter((p) => p.kind === 'generated').every((p) => p.seed === 'Free member')).toBe(true);
      expect(unreachable).toEqual(['Visitor :: Signs up']);
    });

    it('starts a variant seed only for its events, and those events only from it', () => {
      const bundle = bundleOf('.', [chart(product)], journeys);
      const { composition, graph } = lintBundle(bundle, { requiredMeta: [] });
      const scope = chartScope(bundle, composition, graph);
      const { paths } = planChart(bundle, graph, scope, {
        seeds: [
          { name: 'Free member', at: graph.valueOf('Member') },
          { name: 'Paid member', at: { Member: { Plan: 'Paid' } } },
          { name: 'Free member with a gift card', at: graph.valueOf('Member'), for: ['Orders'] }
        ]
      });
      const byEvents = (events: string[]) => paths.filter((p) => p.steps.map((s) => s.event).join(' > ') === events.join(' > '));
      expect(byEvents(['Orders', 'Order arrives']).map((p) => [p.seed, p.blockedBy])).toEqual([['Free member with a gift card', []]]);
      // Not cut where only a seed unsuited to what follows starts: the paid order runs from the variant.
      expect(byEvents(['Upgrades', 'Orders', 'Order arrives']).map((p) => [p.seed, p.blockedBy])).toEqual([['Free member with a gift card', []]]);
      expect(paths.filter((p) => p.seed === 'Free member with a gift card').every((p) => p.steps.some((s) => s.event === 'Orders'))).toBe(true);
      expect(paths.filter((p) => p.steps.some((s) => s.event === 'Orders') && !p.blockedBy.length).every((p) => p.seed === 'Free member with a gift card')).toBe(true);

      // A journey is not cut where only a variant seed for other events starts.
      const upgrades = bundleOf('.', [chart(product)], [{ name: 'Upgrades', description: 'Upgrades.', events: ['Signs up', 'Upgrades'], endsIn: ['Paid'] }]);
      const onlyVariant = planChart(upgrades, graph, chartScope(upgrades, composition, graph), {
        seeds: [{ name: 'Free member with a gift card', at: graph.valueOf('Member'), for: ['Orders'] }]
      });
      const stretches = onlyVariant.journeys[0]!.paths.map((id) => onlyVariant.paths.find((p) => p.id === id)!);
      expect(stretches.map((p) => [p.seed ?? 'setup', p.steps.map((s) => s.event)])).toEqual([['setup', ['Signs up', 'Upgrades']]]);

      // With no journey to cover it, the step after the variant's event still starts from the variant.
      const bare = bundleOf('.', [chart(product)], []);
      const lone = planChart(bare, graph, chartScope(bare, composition, graph), {
        seeds: [
          { name: 'Free member', at: graph.valueOf('Member') },
          { name: 'Free member with a gift card', at: graph.valueOf('Member'), for: ['Orders'] }
        ]
      });
      expect(lone.unreachable).toEqual([]);
      expect(lone.paths.find((p) => p.name === 'Covers: Ordered → Order arrives')).toMatchObject({ seed: 'Free member with a gift card' });
    });
  });

  it('explores one parallel region at a time, holding the others where the seed left them', () => {
    const chain = (prefix: string, n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix} ${i}`, i + 1 < n ? { on: { [`${prefix} next ${i}`]: `${prefix} ${i + 1}` } } : { on: { [`${prefix} back`]: `${prefix} 0` } }]));
    const machine: MachineConfig = {
      id: 'Product',
      initial: 'Member',
      states: {
        Member: {
          type: 'parallel',
          states: {
            Left: { initial: 'L 0', states: chain('L', 40) },
            Right: { initial: 'R 0', states: chain('R', 40) }
          }
        }
      }
    };
    const bundle = bundleOf('.', [chart(machine)], []);
    const { composition, graph, findings } = lintBundle(bundle, { requiredMeta: [] });
    expect(findings.filter((f) => f.rule === 'reachable')).toEqual([]);
    const { paths, unreachable } = planChart(bundle, graph, chartScope(bundle, composition, graph));
    expect(unreachable).toEqual([]);
    for (const path of paths) {
      const sides = new Set(path.steps.map((s) => s.event.charAt(0)));
      expect(sides.size, path.name).toBe(1);
    }
    expect(graph.regionsOf('L 3')).toEqual(['Left']);
    expect(graph.actsIn('R next 1', ['Left'])).toBe(false);
  });
});
