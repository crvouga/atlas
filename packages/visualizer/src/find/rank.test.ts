import { describe, expect, test } from 'bun:test';

import { buildCorpus, type CorpusSource } from './corpus';
import { canonical, notationOf, rank, stem, type FindDoc } from './rank';

const FEATURE = `Feature: Working the list
  A person keeps a list of todos.

  Scenario: Finish every todo and clear them
    When they tap "Mark all done"
    And they clear completed

  Scenario: Add a todo
    When they add a todo

  Scenario: Evening routine
    When they tap "Mark all done"
`;

const QUINT = `module todo {
  action add = true
  action mark_all_done = true
  action clear_completed = true
}
`;

function todoSource(): CorpusSource {
  const screens = Array.from({ length: 12 }, (_, index) => ({
    name: `Open todo list ${index + 1}`,
    chartId: 'app',
    kind: 'screen',
    description: '',
    status: 'passed' as const
  }));
  return {
    charts: [{ id: 'app', name: 'Todo' }],
    states: [...screens, { name: 'No todos', chartId: 'app', kind: 'screen', description: '', status: 'passed' }],
    transitions: [
      { id: 'mark', chartId: 'app', event: 'Marks all done', source: 'Has items', target: 'Done', status: 'passed' },
      { id: 'add-carried', chartId: 'app', event: 'Adds a todo', source: 'Desktop', target: 'Has items', status: 'passed', carriedBy: 'phone' },
      { id: 'add', chartId: 'app', event: 'Adds a todo', source: 'No todos', target: 'Has items', status: 'passed' },
      { id: 'add-again', chartId: 'app', event: 'Adds a todo', source: 'Has items', target: 'Has items', status: 'passed' },
      { id: 'clear', chartId: 'app', event: 'Clears completed todos', source: 'Has items', target: 'No todos', status: 'passed' },
      { id: 'throw', chartId: 'app', event: 'Throw the list away', source: 'Has items', target: 'No todos', status: 'passed' }
    ],
    journeys: [
      {
        id: 'weekend',
        name: 'Plans a weekend',
        description: 'A person finishes it before Monday.',
        chartId: 'app',
        events: ['Adds a todo', 'Marks all done'],
        endsIn: ['Done'],
        status: 'failed',
        paths: [
          { id: 'slipped', name: 'Saturday slipped', status: 'failed', events: ['Adds a todo', 'Marks all done'] },
          { id: 'held', name: 'Saturday held', status: 'passed', events: ['Adds a todo', 'Marks all done'] }
        ]
      }
    ],
    files: [
      { path: 'working-the-list.feature', title: 'Working the list' },
      { path: 'todo.qnt', title: 'todo.qnt' },
      { path: 'todo-app.scxml', title: 'Todo app' }
    ],
    slots: [
      {
        key: 'lists/evening',
        id: 'lists/evening',
        title: 'Evening routine',
        specPath: 'specs/working-the-list.feature',
        status: 'passed',
        detail: 'Recorded on Saturday.',
        recording: true
      }
    ],
    texts: new Map([
      ['working-the-list.feature', FEATURE],
      ['todo.qnt', QUINT]
    ])
  };
}

const docs = buildCorpus(todoSource());

function titles(query: string) {
  return rank(docs, query).map((hit) => hit.doc.title);
}

function above(query: string, earlier: string, later: string) {
  const list = titles(query);
  const from = list.indexOf(earlier);
  const to = list.indexOf(later);
  expect(from, list.join(' | ')).toBeGreaterThanOrEqual(0);
  expect(to, list.join(' | ')).toBeGreaterThan(from);
}

describe('everyday words', () => {
  test('stems and classes meet', () => {
    expect(stem('marking')).toBe('mark');
    expect(stem('marked')).toBe('mark');
    expect(stem('marks')).toBe('mark');
    expect(stem('todos')).toBe('todo');
    expect(canonical('marking')).toBe('complete');
    expect(canonical('completed')).toBe('complete');
    expect(canonical('finished')).toBe('complete');
    expect(canonical('adds')).toBe('add');
    expect(canonical('clears')).toBe('remove');
  });

  test('marking a todo complete finds the flows that finish the list', () => {
    const list = titles('Marking todo as complete');
    for (const title of ['Marks all done', 'Finish every todo and clear them', 'mark_all_done', 'Plans a weekend']) {
      above('Marking todo as complete', title, 'No todos');
    }
    expect(list.indexOf('Marks all done'), list.join(' | ')).toBeGreaterThanOrEqual(0);
    const finish = rank(docs, 'Marking todo as complete').find((hit) => hit.doc.title === 'Finish every todo and clear them');
    expect(finish?.snippet).toContain('Mark all done');
  });

  test('a matched scenario lists its recorded check', () => {
    const hits = rank(docs, 'Marking todo as complete');
    const scenario = hits.findIndex((hit) => hit.doc.kind === 'scenario' && hit.doc.title === 'Evening routine');
    const run = hits.findIndex((hit) => hit.doc.id === 'run:lists/evening');
    expect(scenario, hits.map((hit) => hit.doc.title).join(' | ')).toBeGreaterThanOrEqual(0);
    expect(run).toBe(scenario + 1);
    expect(hits[run]?.doc.title).toBe('Evening routine');
    expect(hits[run]?.snippet).toContain('Mark all done');
  });

  test('adding a todo finds the add flows', () => {
    above('Add new todo', 'Adds a todo', 'No todos');
    above('Add new todo', 'Add a todo', 'No todos');
  });

  test('removing a todo finds clearing', () => {
    above('remove todo', 'Clears completed todos', 'No todos');
    above('remove todo', 'clear_completed', 'No todos');
    above('remove todo', 'Clears completed todos', 'Throw the list away');
  });

  test('a mistyped phrase still finds the flow', () => {
    above('makring todo complte', 'Marks all done', 'No todos');
  });

  test('an empty box lists journeys and then failing checks', () => {
    const list = titles('');
    expect(list[0]).toBe('Plans a weekend');
    expect(list).toContain('Saturday slipped');
    expect(list).not.toContain('Saturday held');
    expect(list).not.toContain('Open todo list 1');
    expect(titles('the')).toEqual(list);
  });
});

function quiet(title: string): FindDoc {
  return {
    id: title,
    group: 'Specs',
    kind: 'spec',
    title,
    subtitle: '',
    fields: [{ name: 'title', text: title }],
    status: null,
    related: [],
    target: { to: '/', search: {} },
    recording: null
  };
}

test('a kind word keeps only that kind of spec', () => {
  const marking = titles('Marking todo as complete');
  for (const query of ['gherkin', 'features', 'scenarios', 'cucumber']) {
    const list = titles(query);
    expect(list, query).toContain('Add a todo');
    expect(list, query).toContain('Finish every todo and clear them');
    expect(list, query).not.toContain('Adds a todo');
    expect(list, query).not.toContain('mark_all_done');
    expect(rank(docs, query).every((hit) => notationOf(hit.doc) === 'gherkin')).toBe(true);
  }
  for (const query of ['quint', 'models', 'qnt']) {
    const list = titles(query);
    expect(list, query).toContain('add');
    expect(list, query).toContain('mark_all_done');
    expect(list, query).not.toContain('Add a todo');
    expect(list, query).not.toContain('Adds a todo');
  }
  for (const query of ['statecharts', 'statechart', 'scxml', 'state machine']) {
    const list = titles(query);
    expect(list, query).toContain('Adds a todo');
    expect(list, query).toContain('Plans a weekend');
    expect(list, query).not.toContain('Add a todo');
    expect(list, query).not.toContain('mark_all_done');
    expect(rank(docs, query).every((hit) => notationOf(hit.doc) === 'statechart')).toBe(true);
  }
  const gherkinAdd = titles('add a feature');
  expect(gherkinAdd).toContain('Add a todo');
  expect(gherkinAdd).not.toContain('Adds a todo');
  expect(gherkinAdd).not.toContain('add');
  const quintAdd = titles('quint add');
  expect(quintAdd).toContain('add');
  expect(quintAdd).not.toContain('Add a todo');
  expect(titles('gherkn add todo')).toContain('Add a todo');
  expect(titles('gherkn add todo')).not.toContain('Adds a todo');
  expect(marking).toContain('Marks all done');
  expect(marking).toContain('Finish every todo and clear them');
});

test('decision tables, alloy, and openslo filter the same way', () => {
  const typed = (title: string, notation: string): FindDoc => ({
    id: title,
    group: 'Specs',
    kind: 'spec',
    title,
    subtitle: '',
    fields: [{ name: 'title', text: title }],
    status: null,
    related: [],
    target: { to: '/specs/$kind', kind: notation, search: { spec: title } },
    recording: null
  });
  const kinds = [typed('Ship the decision', 'dmn'), typed('Keep the alloy', 'alloy'), typed('Hold the slo', 'openslo'), typed('Add a todo', 'gherkin')];
  expect(rank(kinds, 'dmn').map((hit) => hit.doc.title)).toEqual(['Ship the decision']);
  expect(rank(kinds, 'decision table').map((hit) => hit.doc.title)).toEqual(['Ship the decision']);
  expect(rank(kinds, 'alloy').map((hit) => hit.doc.title)).toEqual(['Keep the alloy']);
  expect(rank(kinds, 'openslo').map((hit) => hit.doc.title)).toEqual(['Hold the slo']);
  const both = rank(kinds, 'gherkin alloy').map((hit) => hit.doc.title);
  expect(both).toContain('Add a todo');
  expect(both).toContain('Keep the alloy');
  expect(both).not.toContain('Ship the decision');
});

test('a word that is in most documents cannot win on its own', () => {
  const crowd = [quiet('Marks all done'), ...Array.from({ length: 8 }, (_, index) => quiet(`Todo note ${index}`))];
  const list = rank(crowd, 'complete the todo').map((hit) => hit.doc.title);
  expect(list[0]).toBe('Marks all done');
});
