import { describe, expect, it } from 'vitest';

import { createIssueSink } from './issues';
import { parseSpec, type SpecFile } from './spec';

function parse(files: SpecFile[]) {
  const sink = createIssueSink();
  const doc = parseSpec({ ref: null, files }, sink);
  return { doc, issues: sink.issues, problems: sink.issues.filter((i) => i.severity !== 'info') };
}

const ROOT_SCXML = `<?xml version="1.0" encoding="UTF-8"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml" xmlns:atlas="https://github.com/crvouga/atlas/ns/1" version="1.0" name="Todo list" initial="listing">
  <atlas:meta>
    <atlas:eventKinds>{"Reminder is due": "time"}</atlas:eventKinds>
  </atlas:meta>
  <state id="listing" atlas:name="Listing todos">
    <atlas:meta>
      <atlas:description>All todos.</atlas:description>
      <atlas:hints>["A list of todos", "An add button"]</atlas:hints>
      <atlas:gherkin>features/todos.feature</atlas:gherkin>
    </atlas:meta>
    <transition event="adds-a-todo" atlas:name="Adds a todo" target="adding"/>
  </state>
  <state id="adding" atlas:name="Adding a todo">
    <invoke type="scxml" src="todo-editor.scxml" id="editor" atlas:name="Todo editor"/>
    <transition event="done.invoke.editor" target="reminders"/>
  </state>
  <parallel id="reminders" atlas:name="Reminders">
    <state id="sound" atlas:name="Sound" initial="sound-on">
      <state id="sound-on" atlas:name="Sound on"><transition event="mutes" atlas:name="Mutes" target="sound-off"/></state>
      <state id="sound-off" atlas:name="Sound off"><transition event="unmutes" atlas:name="Unmutes" target="sound-on"/></state>
    </state>
    <state id="due" atlas:name="Due" initial="waiting">
      <state id="waiting" atlas:name="Waiting"><transition event="reminder-is-due" atlas:name="Reminder is due" target="ringing"/></state>
      <state id="ringing" atlas:name="Ringing"/>
    </state>
  </parallel>
</scxml>
`;

const EDITOR_YAML = `id: Todo editor
initial: Typing
states:
  Typing:
    meta: { description: A text field. }
    on:
      Saves the todo: '#Saved'
  Saved:
    type: final
    meta: { description: Saved. }
`;

describe('SCXML charts', () => {
  const { doc, problems } = parse([
    { path: 'todo/todo-list.scxml', text: ROOT_SCXML },
    { path: 'todo/todo-editor.machine.yaml', text: EDITOR_YAML }
  ]);

  it('reads states, parallel regions and readable names', () => {
    expect(problems).toEqual([]);
    expect(doc.charts.map((c) => [c.id, c.format])).toEqual([
      ['Todo editor', 'xstate'],
      ['Todo list', 'scxml']
    ]);
    expect(doc.states.get('Reminders')?.type).toBe('parallel');
    expect(doc.states.get('Sound')).toMatchObject({ type: 'compound', initial: 'Sound on', parent: 'Reminders' });
    expect(doc.transitions.get('Sound on :: Mutes')?.target).toBe('Sound off');
  });

  it('reads list and map metadata carried as text', () => {
    expect(doc.states.get('Listing todos')?.meta).toMatchObject({ hints: ['A list of todos', 'An add button'], gherkin: ['features/todos.feature'] });
    expect(doc.charts.find((c) => c.id === 'Todo list')?.meta.eventKinds).toEqual({ 'Reminder is due': 'time' });
  });

  it('composes an <invoke> whose done.invoke transition becomes the hand-off', () => {
    expect(doc.states.get('Adding a todo')).toMatchObject({ childChartId: 'Todo editor', invoke: { src: 'Todo editor', id: 'editor', onDone: '#Reminders' } });
    expect(doc.charts.find((c) => c.id === 'Todo editor')?.parent).toEqual({ chartId: 'Todo list', state: 'Adding a todo' });
    expect(doc.transitions.get('Saved :: done.invoke.editor')).toMatchObject({ handOff: true, chartId: 'Todo editor', target: 'Reminders' });
    expect(doc.transitions.get('Adding a todo :: done.invoke.editor')).toMatchObject({ chartId: 'Todo list', target: 'Reminders', carriedBy: 'Saved :: done.invoke.editor' });
  });
});

describe('child chart problems', () => {
  it.each<[string, string, RegExp]>([
    ['an invoke of a chart that is not in the spec', "    invoke: { src: Nowhere }\n", /names the chart "Nowhere"/],
    ['an invoke with no src', '    invoke: { id: editor }\n', /should name the chart it runs/],
    ['a child final the parent does not handle', '    invoke: { src: Todo editor }\n', /"Saved" ends "Todo editor" and passes "done\.invoke\.Todo editor" up/]
  ])('reports %s', (_label, invoke, message) => {
    const parent = `id: Todos\ninitial: Adding\nstates:\n  Adding:\n    meta: { description: Adding. }\n${invoke}`;
    const { problems } = parse([
      { path: 'todo/machine.yaml', text: parent },
      { path: 'todo/todo-editor.machine.yaml', text: EDITOR_YAML }
    ]);
    expect(problems.map((p) => p.message)).toContainEqual(expect.stringMatching(message));
  });

  it('reports an SCXML file it cannot read and keeps the rest', () => {
    const { doc, problems } = parse([
      { path: 'todo/broken.scxml', text: '<statechart name="Broken"/>' },
      { path: 'todo/todo-editor.machine.yaml', text: EDITOR_YAML }
    ]);
    expect(problems).toEqual([expect.objectContaining({ severity: 'error', file: 'todo/broken.scxml', message: expect.stringMatching(/could not be read/) })]);
    expect(doc.charts.map((c) => c.id)).toEqual(['Todo editor']);
  });
});
