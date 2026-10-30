import { afterEach, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createNode } from '../../server/tests/node-compat';
import { publishStatusExamples } from '../vite/example-statuses';
import { memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
let node: ReturnType<typeof createNode> | null = null;
afterEach(async () => { await atlas?.close(); node?.close(); atlas = null; node = null; });

async function open(at: string, withCharts = false) {
  const featureText = await readFile(path.join(import.meta.dir, '../../../examples/todo/specs/getting-started.feature'), 'utf8');
  const store = memoryStore();
  await publishStatusExamples(store, { featureText, recordedAtMs: 10 });
  node = createNode({ stores: [{ id: 'examples', store }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at, deps: {}, specs: {
    'getting-started.feature': featureText,
    ...(withCharts ? { 'flow.machine.json': JSON.stringify({ id: 'Flow', initial: 'Ready', states: { Ready: {} } }) } : {})
  }, node });
}

test('status examples show pending, running and errored catalog cards and truthful empty pictures', async () => {
  await open('/catalog');
  for (const label of ['Example: Pending capture', 'Example: Running capture', 'Example: Errored capture']) await atlas!.sees(label);
  expect(document.querySelector('[data-state="examples/status/pending"]')!.textContent).toContain('Not captured yet');
  expect(document.querySelector('[data-state="examples/status/running"]')!.textContent).toContain('Capturing');
  expect(document.querySelector('[data-state="examples/status/error"]')!.textContent).toContain('Capture failed');
  expect(document.querySelectorAll('[role="list"][aria-label="States"] img')).toHaveLength(0);
  await atlas!.go('/catalog?state=examples%2Fstatus%2Ferror');
  await atlas!.sees('Intentional error example');
  await atlas!.sees('No screenshot was produced');
});

test('status examples are browsable in Tests, Runs and Gherkin behavior coverage', async () => {
  await open('/catalog', true);
  await atlas!.sees('Example: Pending capture');
  expect(atlas!.requests.some(request => request.startsWith('/tests?'))).toBe(false);
  await atlas!.click('button', 'Spec type');
  await atlas!.until(() => !!atlas!.find('[role="menuitem"]', /^ Tests$/), 'Tests menu item');
  await atlas!.click('[role="menuitem"]', /^ Tests$/);
  await atlas!.until(() => atlas!.router.state.location.pathname === '/' && atlas!.router.state.location.search.view === 'tests', 'Tests address');
  await atlas!.sees('Name a list: Create a named list');
  expect(atlas!.router.state.location.search.view).toBe('tests');
  expect(atlas!.text()).toContain('Running');
  await atlas!.click('[role="tab"]', 'Runs');
  await atlas!.sees('Status examples');
  expect(atlas!.router.state.location.search.view).toBe('tests');
  expect(atlas!.requests.filter(request => request.startsWith('/tests?'))).toHaveLength(1);
  await atlas!.go('/behaviors');
  await atlas!.sees('Create a named list');
  for (const label of ['Running', 'Failed', 'Skipped']) expect(atlas!.text()).toContain(label);
  await atlas!.click('a', /^ Runs$/);
  await atlas!.sees('Status examples');
  expect(atlas!.router.state.location.search.view).toBe('tests');
  await atlas!.go('/');
  await atlas!.until(() => atlas!.router.state.location.pathname.startsWith('/chart/'), 'default chart home');
});
