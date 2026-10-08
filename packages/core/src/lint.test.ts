import { describe, expect, it } from 'vitest';

import type { Chart, Journey, MachineConfig } from './spec/types';
import { lintBundle } from './lint';
import { bundleOf } from './spec/load';

const chart = (machine: MachineConfig): Chart => ({ file: `${machine.id}.machine.json`, format: 'xstate', machine });
const d = (description: string) => ({ description });

const DOOR: MachineConfig = {
  id: 'Door',
  initial: 'Closed',
  meta: d('A door.'),
  states: {
    Closed: { meta: d('Shut.'), on: { Opens: 'Open', Locks: 'Locked' } },
    Open: { meta: d('Open.'), on: { Closes: 'Closed' } },
    Locked: { meta: d('Locked.'), on: { Unlocks: 'Closed' } }
  }
};

const rules = (machine: MachineConfig, journeys: Journey[] = [], extra: Chart[] = []) =>
  lintBundle(bundleOf('.', [chart(machine), ...extra], journeys)).findings;

describe('lintBundle', () => {
  it('accepts a pure, reachable chart with no findings', () => {
    expect(rules(DOOR)).toEqual([]);
  });

  it('rejects guards, actions, context, delays and unknown keys', () => {
    const impure = {
      ...DOOR,
      context: { count: 0 },
      states: {
        ...DOOR.states,
        Closed: { meta: d('Shut.'), entry: ['beep'], on: { Opens: { target: 'Open', guard: 'isUnlocked', actions: ['log'] }, Locks: 'Locked' } },
        Open: { meta: d('Open.'), after: { 1000: 'Closed' }, on: { Closes: 'Closed' } },
        Locked: { meta: d('Locked.'), colour: 'red', on: { Unlocks: 'Closed' } }
      }
    } as MachineConfig;
    const findings = rules(impure);
    expect(findings.every((f) => f.rule === 'pure')).toBe(true);
    expect(findings.map((f) => f.message)).toEqual([
      'Door: "context" is not allowed',
      'Closed: "entry" is not allowed',
      'Closed --Opens-->: "guard" is not allowed (no guards, no actions)',
      'Closed --Opens-->: "actions" is not allowed (no guards, no actions)',
      'Open: "after" is not allowed',
      'Locked: unknown key "colour"'
    ]);
  });

  it('requires meta.description on every state, or the configured fields', () => {
    const bare: MachineConfig = { id: 'Bare', initial: 'A', states: { A: { on: { Go: 'B' } }, B: { meta: { description: 'B.' }, on: { Back: 'A' } } } };
    expect(rules(bare)).toEqual([{ rule: 'meta', message: 'A: meta.description is missing' }]);
    const custom = lintBundle(bundleOf('.', [chart(DOOR)], []), { requiredMeta: ['description', 'snapshot'] }).findings;
    expect(custom.map((f) => f.message)).toEqual(['Closed: meta.snapshot is missing', 'Open: meta.snapshot is missing', 'Locked: meta.snapshot is missing']);
  });

  it('rejects state names with dots, naming the problem rather than the XState error', () => {
    const dotted: MachineConfig = { id: 'D', initial: 'v1.0', states: { 'v1.0': { meta: d('x'), on: { Upgrades: 'v2' } }, v2: { meta: d('y'), on: { Downgrades: '#v1.0' } } } };
    expect(() => rules(dotted)).toThrow(/cannot be composed[\s\S]*\[naming\] v1\.0: state names cannot contain dots/);
  });

  it('flags unreachable states', () => {
    const orphan: MachineConfig = { ...DOOR, states: { ...DOOR.states, Broken: { meta: d('Off its hinges.'), on: { Repaired: 'Closed' } } } };
    expect(rules(orphan)).toEqual([{ rule: 'reachable', message: 'Broken is unreachable from the initial state' }]);
  });

  it('flags dead ends unless meta.deadEnd says why', () => {
    const stuck: MachineConfig = { ...DOOR, states: { ...DOOR.states, Open: { meta: d('Open.'), on: { Breaks: 'Broken' } }, Broken: { meta: d('Broken.') } } };
    expect(rules(stuck)).toEqual([{ rule: 'dead-end', message: 'Broken has no way out and no meta.deadEnd reason' }]);
    const documented: MachineConfig = { ...stuck, states: { ...stuck.states, Broken: { meta: { description: 'Broken.', deadEnd: 'Someone has to replace it.' } } } };
    expect(rules(documented)).toEqual([]);
  });

  it('does not call a leaf a dead end when an ancestor has a way out', () => {
    const nested: MachineConfig = {
      id: 'N',
      initial: 'Session',
      states: {
        Session: { meta: d('Signed in.'), initial: 'Home', on: { 'Signs out': 'Signed out' }, states: { Home: { meta: d('Home.') } } },
        'Signed out': { meta: d('Bye.'), on: { 'Signs in': 'Session' } }
      }
    };
    expect(rules(nested)).toEqual([]);
  });

  it('checks every journey replays and ends where it says', () => {
    const findings = rules(DOOR, [
      { name: 'Opens and closes', description: '', events: ['Opens', 'Closes'], endsIn: ['Closed'] },
      { name: 'Opens a locked door', description: '', events: ['Locks', 'Opens'], endsIn: [] },
      { name: 'Wrong ending', description: '', events: ['Opens'], endsIn: ['Locked'] }
    ]);
    expect(findings).toEqual([
      { rule: 'journey', message: 'Opens a locked door: "Opens" does not apply in "Locked"' },
      { rule: 'journey', message: 'Wrong ending: should end in Locked, ends in Open' }
    ]);
  });

  it('accepts invoke and inserts hand-offs when replaying journeys', () => {
    const parent: MachineConfig = {
      id: 'Shop',
      initial: 'Cart',
      meta: d('Shop.'),
      states: {
        Cart: { meta: d('Cart.'), on: { 'Checks out': 'Checking out' } },
        'Checking out': { meta: d('Paying.'), invoke: { src: 'Checkout', id: 'pay', onDone: '#Thanks' } },
        Thanks: { meta: { description: 'Thanks.', deadEnd: 'The order is done.' } }
      }
    };
    const child: MachineConfig = {
      id: 'Checkout',
      initial: 'Card',
      meta: d('Checkout.'),
      states: { Card: { meta: d('Card.'), on: { Pays: 'Paid' } }, Paid: { type: 'final', meta: d('Paid.') } }
    };
    const findings = rules(parent, [{ name: 'Buys', description: '', events: ['Checks out', 'Pays'], endsIn: ['Thanks'] }], [chart(child)]);
    expect(findings).toEqual([]);
  });

  it('rejects an invoke that does more than name another chart', () => {
    const parent = {
      id: 'P',
      initial: 'A',
      states: { A: { meta: d('A.'), invoke: { src: 'C', onDone: '#B', input: { x: 1 } } }, B: { meta: { description: 'B.', deadEnd: 'End.' } } }
    } as MachineConfig;
    const child: MachineConfig = { id: 'C', initial: 'c', states: { c: { type: 'final', meta: d('c.') } } };
    expect(rules(parent, [], [chart(child)])).toEqual([{ rule: 'pure', message: 'A: invoke "input" is not allowed; invoke only names another chart' }]);
  });

  it('lists events and leaf states without implementations, within a scope', () => {
    const { findings, unimplemented } = lintBundle(bundleOf('.', [chart(DOOR)], []), {
      implementations: { events: new Set(['Opens', 'Closes']), states: new Set(['Closed', 'Open']) }
    });
    expect(unimplemented).toEqual({ events: ['Locks', 'Unlocks'], states: ['Locked'] });
    expect(findings.filter((f) => f.rule === 'implemented').map((f) => f.message)).toEqual([
      'event "Locks" has no implementation',
      'event "Unlocks" has no implementation',
      'state "Locked" has no recognizer'
    ]);
    const scoped = lintBundle(bundleOf('.', [chart(DOOR)], []), {
      scope: { states: new Set(['Closed', 'Open']), events: new Set(['Opens', 'Closes']) },
      implementations: { events: new Set(['Opens', 'Closes']), states: new Set(['Closed', 'Open']) }
    });
    expect(scoped.unimplemented).toEqual({ events: [], states: [] });
  });
});
