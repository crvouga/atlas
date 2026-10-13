import { expect, test } from 'bun:test';

import { buildCorpus, type CorpusSource } from './corpus';

const FEATURE = `Feature: Working the list
  Scenario: Add a todo
    When they add a todo

  Scenario: Evening routine
    When they tap "Mark all done"
`;

function source(extra: Partial<CorpusSource> = {}): CorpusSource {
  return {
    charts: [{ id: 'app', name: 'Todo' }],
    states: [],
    transitions: [],
    journeys: [],
    files: [{ path: 'working-the-list.feature', title: 'Working the list' }],
    slots: [],
    texts: new Map([['working-the-list.feature', FEATURE]]),
    ...extra
  };
}

test('the same action on several states is one row, opened on a transition of its own', () => {
  const docs = buildCorpus(source({
    transitions: [
      { id: 'carried', chartId: 'app', event: 'Adds a todo', source: 'Desktop', target: 'Has items', status: 'passed', carriedBy: 'phone' },
      { id: 'real', chartId: 'app', event: 'Adds a todo', source: 'No todos', target: 'Has items', status: 'passed' },
      { id: 'again', chartId: 'app', event: 'Adds a todo', source: 'Has items', target: 'Has items', status: 'failed' }
    ]
  }));
  const events = docs.filter((doc) => doc.kind === 'event');
  expect(events.map((doc) => doc.title)).toEqual(['Adds a todo']);
  expect(events[0]?.subtitle).toContain('No todos');
  expect(events[0]?.target.search.event).toBe('real');
  expect(events[0]?.status).toBe('failed');
});

test('a scenario opens its recorded check, and a chart file stays on the map', () => {
  const docs = buildCorpus(source({
    files: [
      { path: 'working-the-list.feature', title: 'Working the list' },
      { path: 'todo.qnt', title: 'todo.qnt' },
      { path: 'todo-app.scxml', title: 'Todo app' }
    ],
    texts: new Map([
      ['working-the-list.feature', FEATURE],
      ['todo.qnt', 'module todo {\n  action add = true\n  action mark_all_done = true\n}\n']
    ]),
    slots: [
      {
        key: 'lists/evening',
        id: 'lists/evening',
        title: 'Evening routine',
        specPath: 'specs/working-the-list.feature',
        status: 'passed',
        detail: '',
        recording: true
      }
    ]
  }));
  expect(docs.some((doc) => doc.subtitle === 'todo-app.scxml' || doc.title === 'Todo app')).toBe(false);
  const add = docs.find((doc) => doc.kind === 'scenario' && doc.title === 'Add a todo');
  expect(add?.target).toMatchObject({ to: '/specs/$kind', kind: 'gherkin', search: { spec: 'working-the-list.feature', check: 'scenario:Add a todo' } });
  const evening = docs.find((doc) => doc.kind === 'scenario' && doc.title === 'Evening routine');
  expect(evening?.related).toEqual(['run:lists/evening']);
  expect(evening?.target.search.check).toBe('lists/evening');
  const run = docs.find((doc) => doc.id === 'run:lists/evening');
  expect(run?.group).toBe('Runs');
  expect(run?.target.search).toMatchObject({ spec: 'working-the-list.feature', check: 'lists/evening', view: 'recording' });
  expect(run?.recording?.search).toMatchObject({ spec: 'working-the-list.feature', check: 'lists/evening', view: 'recording' });
  expect(evening?.recording?.search).toMatchObject({ spec: 'working-the-list.feature', check: 'lists/evening', view: 'recording' });
  expect(evening?.target.search.view).toBeUndefined();
  expect(docs.filter((doc) => doc.kind === 'action').map((doc) => doc.title).sort()).toEqual(['add', 'mark_all_done']);
});
