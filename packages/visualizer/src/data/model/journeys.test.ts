import { describe, expect, it } from 'vitest';

import { createIssueSink } from '../parse/issues';
import { parseSpec, type SpecFile } from '../parse/spec';
import { createJourneyReplayer } from './journeys';

const parent = (host: string) => `id: Shop
initial: Home
states:
  Home:
    meta: { description: The home screen. }
    on:
      Taps order a drink: { target: '#Ordering' }
  Ordering:
${host}
    on:
      Drink is ordered: { target: '#Waiting for the drink' }
      Leaves ordering: { target: '#Home' }
  Waiting for the drink:
    meta: { description: A drink on its way. }
    on:
      Goes back home: { target: '#Home' }
`;

const LEGACY_HOST = `    meta:
      description: Ordering runs as its own chart.
      childMachine: Ordering flow
      childFinalEvents:
        Ordered: Drink is ordered
        Gave up: Leaves ordering`;

const INVOKE_HOST = `    meta:
      description: Ordering runs as its own chart.
    invoke:
      src: Ordering flow
      id: ordering`;

const childYaml = (doneEvents: boolean) => `id: Ordering flow
initial: Picking a drink
states:
  Picking a drink:
    meta: { description: Drinks. }
    on:
      Picks a drink: '#Confirming the drink'
      Closes ordering: '#Gave up'
  Confirming the drink:
    meta: { description: Confirm. }
    on:
      Confirms the drink: '#Ordered'
  Ordered:
    type: final
    meta: { description: Done.${doneEvents ? ', doneEvent: Drink is ordered' : ''} }
  Gave up:
    type: final
    meta: { description: Left.${doneEvents ? ', doneEvent: Leaves ordering' : ''} }
`;

const CHILD_SCXML = `<?xml version="1.0" encoding="UTF-8"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml" xmlns:atlas="https://github.com/crvouga/atlas/ns/1" version="1.0" name="Ordering flow" initial="picking-a-drink">
  <state id="picking-a-drink" atlas:name="Picking a drink">
    <atlas:meta><atlas:description>Drinks.</atlas:description></atlas:meta>
    <transition event="picks-a-drink" atlas:name="Picks a drink" target="confirming-the-drink"/>
    <transition event="closes-ordering" atlas:name="Closes ordering" target="gave-up"/>
  </state>
  <state id="confirming-the-drink" atlas:name="Confirming the drink">
    <atlas:meta><atlas:description>Confirm.</atlas:description></atlas:meta>
    <transition event="confirms-the-drink" atlas:name="Confirms the drink" target="ordered"/>
  </state>
  <final id="ordered" atlas:name="Ordered" atlas:done-event="Drink is ordered">
    <atlas:meta><atlas:description>Done.</atlas:description></atlas:meta>
  </final>
  <final id="gave-up" atlas:name="Gave up" atlas:done-event="Leaves ordering">
    <atlas:meta><atlas:description>Left.</atlas:description></atlas:meta>
  </final>
</scxml>
`;

const JOURNEYS = `journeys:
  Orders a drink:
    events: [Taps order a drink, Picks a drink, Confirms the drink]
    endsIn: [Waiting for the drink]
  Leaves and comes back:
    events: [Taps order a drink, Closes ordering, Taps order a drink]
    endsIn: [Ordering, Picking a drink]
  Impossible event:
    events: [Taps order a drink, Goes back home, Picks a drink]
  Lists the hand-off itself:
    events: [Taps order a drink, Picks a drink, Confirms the drink, Drink is ordered]
  Ends in the wrong place:
    events: [Taps order a drink]
    endsIn: [Waiting for the drink]
`;

const COMPOSITIONS: [string, SpecFile[]][] = [
  ['legacy meta.childMachine', [
    { path: 'shop/ordering/machine.yaml', text: parent(LEGACY_HOST) },
    { path: 'shop/ordering/ordering-flow.machine.yaml', text: childYaml(false) }
  ]],
  ['XState invoke', [
    { path: 'shop/ordering/machine.yaml', text: parent(INVOKE_HOST) },
    { path: 'shop/ordering/ordering-flow.machine.yaml', text: childYaml(true) }
  ]],
  ['invoke of an SCXML chart', [
    { path: 'shop/ordering/machine.yaml', text: parent(INVOKE_HOST) },
    { path: 'shop/ordering/ordering-flow.scxml', text: CHILD_SCXML }
  ]]
];

function replayAll(charts: SpecFile[]) {
  const sink = createIssueSink();
  const doc = parseSpec({ ref: null, files: [...charts, { path: 'shop/ordering/journeys.yaml', text: JOURNEYS }] }, sink);
  expect(sink.issues.filter((i) => i.severity !== 'info')).toEqual([]);
  const replay = createJourneyReplayer(doc, sink);
  const results = new Map(doc.journeys.map((j) => [j.name, replay(j)]));
  return { results, issues: sink.issues };
}

describe.each(COMPOSITIONS)('journey replay with %s', (_label, charts) => {
  const { results, issues } = replayAll(charts);

  it('inserts the hand-off event when the child chart reaches a final state', () => {
    const result = results.get('Orders a drink')!;
    expect(result).toMatchObject({ ok: true, failedAt: null, missingEnds: [] });
    expect(result.steps.map((s) => [s.event, s.handOff])).toEqual([
      ['Taps order a drink', false],
      ['Picks a drink', false],
      ['Confirms the drink', false],
      ['Drink is ordered', true]
    ]);
    expect(result.steps[3]).toMatchObject({ transitionIds: ['Ordered :: Drink is ordered'], from: expect.arrayContaining(['Ordering', 'Ordered']), to: ['Waiting for the drink'] });
  });

  it('re-enters the child chart at its start after a hand-off back', () => {
    const result = results.get('Leaves and comes back')!;
    expect(result.ok).toBe(true);
    expect(result.steps.filter((s) => s.handOff).map((s) => s.event)).toEqual(['Leaves ordering']);
    expect(result.steps.at(-1)?.to).toEqual(['Ordering', 'Picking a drink']);
  });

  it.each<[string, string, number]>([
    ['Impossible event', 'Goes back home', 1],
    ['Lists the hand-off itself', 'Drink is ordered', 4]
  ])('stops "%s" at the event that cannot happen', (name, failedAt, stepsTaken) => {
    const result = results.get(name)!;
    expect(result).toMatchObject({ ok: false, failedAt, missingEnds: [] });
    expect(result.steps).toHaveLength(stepsTaken);
    expect(issues).toContainEqual({
      severity: 'warning',
      file: 'shop/ordering/journeys.yaml',
      path: `journeys › ${name}`,
      message: `"${failedAt}" can't happen at that point in the journey, so the journey stops there on the map.`
    });
  });

  it('reports the end states a journey misses', () => {
    expect(results.get('Ends in the wrong place')).toMatchObject({ ok: false, failedAt: null, missingEnds: ['Waiting for the drink'] });
    expect(issues.some((i) => i.path === 'journeys › Ends in the wrong place › endsIn' && i.severity === 'info')).toBe(true);
  });
});
