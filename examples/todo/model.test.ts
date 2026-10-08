import { fileURLToPath } from 'node:url';

import type { CloudEvent, EventMatcher, EventSource, Implementation, StateImplementation } from '@crvouga/atlas';
import { defineConfig } from '@crvouga/atlas';
import { describeAtlas, functionDriver } from '@crvouga/atlas-vitest';
import { beforeAll, describe, expect, it } from 'vitest';

import { TodoModel } from './model';
import { DEFAULT_LIST_NAME, EVENT_TYPES, RETRY_AFTER_MS } from './server';

/**
 * The same charts and journeys as `atlas.config.ts`, run against the in-memory `TodoModel` instead
 * of a browser: only the driver and the implementation change. Each planned path is one test.
 */
const LIST_NAME = 'Weekend chores';

const published: CloudEvent[] = [];
let mark = 0;
const modelEvents: EventSource = {
  name: 'model',
  mark: () => {
    mark = published.length;
  },
  collect: async () => ({ events: published.slice(mark) })
};

const when = (signal: string, matches: (m: TodoModel) => boolean, extra: Partial<StateImplementation<TodoModel>> = {}): StateImplementation<TodoModel> => ({
  recognize: async (m) => {
    const visible = matches(m);
    return { matched: visible, signals: [{ signal, expected: 'visible', visible }] };
  },
  ...extra
});

const act = (how: string, run: (m: TodoModel) => void) => ({ kind: 'user' as const, how, run: async (m: TodoModel) => run(m) });

const implementation: Implementation<TodoModel> = {
  setup: async () => undefined,
  events: {
    'Starts setup': act('getStarted()', (m) => m.getStarted()),
    'Types a list name': act(`typeListName("${LIST_NAME}")`, (m) => m.typeListName(LIST_NAME)),
    'Creates the list': act('createList()', (m) => m.createList()),
    'Skips naming the list': act('skipNaming()', (m) => m.skipNaming()),
    'Setup completes': { kind: 'hand-off', how: 'The model opens the list itself.', run: async () => undefined },
    'Setup completes with the default list': { kind: 'hand-off', how: 'The model opens the list itself.', run: async () => undefined },
    'Adds a todo': act('addTodo()', (m) => m.addTodo('Water the plants')),
    'Marks all done': act('markAllDone()', (m) => m.markAllDone()),
    'Clears completed todos': act('clearCompleted()', (m) => m.clearCompleted()),
    'Starts over': act('startOver()', (m) => m.startOver()),
    'Sync fails': { kind: 'system', how: 'syncFails()', run: async (m) => m.syncFails() },
    'Retry timer elapses': { kind: 'time', how: `advanceClock(${RETRY_AFTER_MS})`, run: async (m) => m.advanceClock(RETRY_AFTER_MS) }
  },
  states: {
    Welcome: when('welcome screen', (m) => m.screen === 'welcome'),
    'Naming the list': when('naming, no name yet', (m) => m.screen === 'naming' && !m.nameDraft),
    'List name entered': when('naming, name typed', (m) => m.screen === 'naming' && Boolean(m.nameDraft)),
    'List ready': when('the named list', (m) => m.screen === 'list' && m.listName === LIST_NAME, { transient: true }),
    'Default list kept': when('the default list', (m) => m.screen === 'list' && m.listName === DEFAULT_LIST_NAME, { transient: true }),
    Synced: when('synced', (m) => m.screen === 'list' && m.sync === 'synced'),
    Offline: when('offline', (m) => m.screen === 'list' && m.sync === 'offline'),
    'No todos': when('empty list', (m) => m.screen === 'list' && m.todos.length === 0),
    'Some todos open': when('open todos', (m) => m.screen === 'list' && m.openCount > 0),
    'All todos done': when('all done', (m) => m.screen === 'list' && m.todos.length > 0 && m.openCount === 0)
  }
};

const config = defineConfig<TodoModel>({
  specs: fileURLToPath(new URL('./specs', import.meta.url)),
  driver: functionDriver(() => new TodoModel((event) => published.push(event)), { name: 'todo-model' }),
  implementation,
  eventSources: () => [modelEvents],
  eventMatchers: Object.fromEntries(Object.entries(EVENT_TYPES).map(([name, type]): [string, EventMatcher] => [name, { type }])),
  output: fileURLToPath(new URL('./test-results/atlas-model', import.meta.url)),
  stepTimeoutMs: 1_000
});

describeAtlas(config, { describe, it, beforeAll, expect }, { retry: false });
