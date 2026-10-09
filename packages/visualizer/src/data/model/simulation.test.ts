import { describe, expect, it } from 'vitest';
import { parseSpec } from '../parse/spec';
import { ChartSimulation } from './simulation';

const root = {
  id: 'Product', initial: 'App', states: {
    App: { type: 'parallel', states: {
      Identity: { initial: 'Guest', states: {
        Guest: { on: { 'Signs in': '#Account', 'A broadcast arrives': '#Account' } },
        Account: { on: { 'Signs out': '#Guest' } }
      } },
      Place: { initial: 'Home', states: {
        Home: { on: { 'Opens checkout': '#Checkout host', 'A broadcast arrives': '#News' } },
        News: { on: { 'Returns home': '#Home' } },
        'Checkout host': { invoke: { src: 'Checkout' }, on: { 'Paid': '#Receipt', 'Closes checkout': '#Home' } },
        Receipt: { on: { 'Returns home': '#Home' } },
        Unreachable: {}
      } }
    } }
  }
};
const child = { id: 'Checkout', initial: 'Card form', states: {
  'Card form': { on: { 'Pays successfully': '#Payment complete' } },
  'Payment complete': { type: 'final', meta: { doneEvent: 'Paid' } }
} };
const document = () => parseSpec({ ref: null, files: [
  { path: 'product.machine.json', text: JSON.stringify(root) },
  { path: 'checkout.machine.json', text: JSON.stringify(child) }
] });

describe('free exploration of composed statecharts', () => {
  it('keeps parallel active states and broadcasts one event to both regions', () => {
    const simulation = new ChartSimulation(document(), 'Product');
    expect(simulation.leaves(simulation.initial().config)).toEqual(['Guest', 'Home']);
    const result = simulation.replay(['A broadcast arrives']);
    expect(result.error).toBeNull();
    expect(simulation.leaves(result.config)).toEqual(['Account', 'News']);
    expect(result.steps[0]?.transitionIds).toEqual(['Guest :: A broadcast arrives', 'Home :: A broadcast arrives']);
  });

  it('shares the composed root from a nested chart and settles child hand-offs', () => {
    const simulation = new ChartSimulation(document(), 'Checkout');
    expect(simulation.rootId).toBe('Product');
    const result = simulation.replay(['Signs in', 'Opens checkout', 'Pays successfully']);
    expect(simulation.leaves(result.config)).toEqual(['Account', 'Receipt']);
    expect(result.steps.map((s) => [s.event, s.handOff])).toEqual([
      ['Signs in', false], ['Opens checkout', false], ['Pays successfully', false], ['Paid', true]
    ]);
    expect(simulation.enabled(result.config)).not.toContain('Paid');
  });

  it('rejects unavailable events and preserves the exact previous configuration', () => {
    const simulation = new ChartSimulation(document(), 'Product');
    const initial = simulation.initial();
    const result = simulation.advance(initial.config, 'Pays successfully');
    expect(result).toMatchObject({ steps: [], failedAt: 'Pays successfully' });
    expect(result.config).toBe(initial.config);
    expect(result.error).toContain('unavailable');
  });

  it('finds a shortest route through nested states including automatic hand-offs', () => {
    const simulation = new ChartSimulation(document(), 'Product');
    const start = simulation.initial().config;
    expect(simulation.route(start, 'Card form')).toMatchObject({ status: 'found', events: ['Opens checkout'] });
    const route = simulation.route(start, 'Receipt');
    expect(route).toMatchObject({ status: 'found', events: ['Opens checkout', 'Pays successfully'] });
    expect(simulation.replay(route.events).config.active).toContain('Receipt');
    expect(simulation.route(start, 'Payment complete')).toMatchObject({ status: 'found', events: ['Opens checkout', 'Pays successfully'], transient: true });
    expect(simulation.route(start, 'Guest')).toMatchObject({ status: 'found', events: [] });
  });

  it('distinguishes exhaustive unreachability, a search limit and an unknown state', () => {
    const simulation = new ChartSimulation(document(), 'Product');
    const start = simulation.initial().config;
    expect(simulation.route(start, 'Unreachable')).toMatchObject({ status: 'unreachable', events: [] });
    expect(simulation.route(start, 'Receipt', 1)).toMatchObject({ status: 'limit', visited: 1, events: [] });
    expect(simulation.route(start, 'Unknown')).toMatchObject({ status: 'invalid', visited: 0, events: [] });
  });

  it('replays a history prefix without retaining later choices or mutating the initial state', () => {
    const simulation = new ChartSimulation(document(), 'Product');
    const choices = ['Signs in', 'Opens checkout', 'Pays successfully'];
    expect(simulation.leaves(simulation.replay(choices.slice(0, 1)).config)).toEqual(['Account', 'Home']);
    expect(simulation.leaves(simulation.replay([]).config)).toEqual(['Guest', 'Home']);
    expect(simulation.leaves(simulation.replay(choices).config)).toEqual(['Account', 'Receipt']);
  });

  it('preserves a chart whose root is parallel', () => {
    const doc = parseSpec({ ref: null, files: [{ path: 'parallel.machine.json', text: JSON.stringify({ id: 'Parallel', type: 'parallel', states: {
      Left: { initial: 'Left start', states: { 'Left start': {} } },
      Right: { initial: 'Right start', states: { 'Right start': {} } }
    } }) }] });
    const simulation = new ChartSimulation(doc, 'Parallel');
    expect(simulation.leaves(simulation.initial().config)).toEqual(['Left start', 'Right start']);
  });

  it('keeps a tolerant map but refuses to simulate guards that the model cannot execute', () => {
    const doc = parseSpec({ ref: null, files: [{ path: 'guarded.machine.json', text: JSON.stringify({ id: 'Guarded', initial: 'A', states: {
      A: { on: { Go: { target: '#B', guard: 'Has account' } } }, B: {}
    } }) }] });
    expect(doc.states.has('A')).toBe(true);
    expect(() => new ChartSimulation(doc, 'Guarded')).toThrow('cannot be explored safely');
  });

  // regression: atlas-automatic-handoff-cycle
  it('stops a literal automatic hand-off cycle instead of hanging', () => {
    const doc = parseSpec({ ref: null, files: [
      { path: 'cycle.machine.json', text: JSON.stringify({ id: 'Cycle', initial: 'Host', states: { Host: { invoke: { src: 'Child' }, on: { Again: '#Host' } } } }) },
      { path: 'child.machine.json', text: JSON.stringify({ id: 'Child', initial: 'Done', states: { Done: { type: 'final', meta: { doneEvent: 'Again' } } } }) }
    ] });
    const result = new ChartSimulation(doc, 'Cycle').initial();
    expect(result.error).toContain('cycle');
    expect(result.steps).toHaveLength(1);
  });
});
