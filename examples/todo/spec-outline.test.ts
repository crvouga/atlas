import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { actionsIn, expandFeature, quintRuns, slug } from './spec-outline';

const specs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'specs');
const segment = /^[a-zA-Z0-9._-]+$/;

describe('example spec outline', () => {
  test('expands every Gherkin scenario, including outline rows', async () => {
    const started = expandFeature('specs/getting-started.feature', await readFile(path.join(specs, 'getting-started.feature'), 'utf8'));
    const working = expandFeature('specs/working-the-list.feature', await readFile(path.join(specs, 'working-the-list.feature'), 'utf8'));
    const scenarios = [...started, ...working];
    expect(scenarios.map((scenario) => scenario.title)).toEqual([
      'Name a list: Type a name',
      'Name a list: Create a named list',
      'Name a list: Skip naming',
      'Work the list: Add a todo',
      'Work the list: Add several todos — Water the plants',
      'Work the list: Add several todos — Buy coffee',
      'Work the list: Finish every todo and clear them',
      'Work the list: Keep working through an outage',
      'Work the list: Throw the list away',
      'Work the list: Start over while offline'
    ]);
    expect(scenarios[0]?.steps[0]).toEqual({ keyword: 'Given', text: 'the welcome screen says "Plan your day"' });
    expect(scenarios[3]?.steps[0]).toEqual({ keyword: 'Given', text: 'a list named "Weekend chores"' });
    expect(scenarios[4]?.steps.map((step) => step.text)).toContain('they add "Water the plants"');
    expect(scenarios[5]?.steps.map((step) => step.text)).toContain('they add "Buy coffee"');
    expect(scenarios.every((scenario) => segment.test(scenario.id))).toBe(true);
  });

  test('reads Quint runs and the actions each one takes', async () => {
    const { moduleName, runs } = quintRuns(await readFile(path.join(specs, 'todo.qnt'), 'utf8'));
    expect(moduleName).toBe('todo');
    expect(runs.map((run) => run.title)).toEqual([
      'Name a list',
      'Create needs a name',
      'Skip naming',
      'Add a todo',
      'Add several todos',
      'Finish every todo and clear them',
      'Keep working through an outage',
      'Throw the list away',
      'Start over while offline'
    ]);
    expect(runs.every((run) => run.name.endsWith('Test') && segment.test(run.id))).toBe(true);
    expect(actionsIn(runs[0]?.body ?? '').map((action) => action.name)).toEqual(['init', 'get_started', 'type_name', 'create_list', 'hold']);
    expect(actionsIn(runs[1]?.body ?? '').find((action) => action.name === 'create_list')?.disabled).toBe(true);
    expect(slug('Name a list')).toBe('name-a-list');
  });

  test('features tagged @unrecorded stay in the outline but are not run', async () => {
    const shared = expandFeature('specs/share-a-list.feature', await readFile(path.join(specs, 'share-a-list.feature'), 'utf8'));
    const started = expandFeature('specs/getting-started.feature', await readFile(path.join(specs, 'getting-started.feature'), 'utf8'));
    expect(shared.every((scenario) => !scenario.runnable)).toBe(true);
    expect(started.every((scenario) => scenario.runnable)).toBe(true);
  });

  test('share-a-list ids are the ones the layered example fills', async () => {
    const shared = expandFeature('specs/share-a-list.feature', await readFile(path.join(specs, 'share-a-list.feature'), 'utf8'));
    expect(shared.map((scenario) => scenario.id)).toEqual([
      'gherkin.share-a-list.plans-a-weekend',
      'gherkin.share-a-list.keeps-working-through-a-sync-outage',
      'gherkin.share-a-list.starts-over',
      'gherkin.share-a-list.starts-over-while-offline'
    ]);
  });
});