import { afterEach, expect, test } from 'bun:test';
import { createNode } from '../../server/tests/node-compat';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { ALL_SOURCES } from '@crvouga/atlas/reports/evidence-view';
import { act } from 'react';

import { useUiStore } from '../src/state/ui-store';
import { FEATURE, memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const SPEC = 'specs/lists/add.feature';
const check = (status: 'passed' | 'failed') => ({ id: `${SPEC} > Add an item`, title: 'Add an item', status, specPath: SPEC });

test('a node gives the viewer the whole report in one request, however much history sits behind it', async () => {
  const store = memoryStore();
  for (let at = 1; at <= 25; at++) await publishChecks(store, { producer: 'e2e', environment: 'ios', branch: 'main', recordedAtMs: at, checks: [check(at === 25 ? 'failed' : 'passed')] });
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at: '/specs/gherkin', deps: {}, specs: { 'lists/add.feature': FEATURE }, node });
  await atlas.sees('1 failed');
  expect(atlas.requests.filter(request => request.startsWith('/evidence/effective')).length).toBeGreaterThan(0);
  // None of the 25 layers was asked for on its own, and the catalog was not paged through.
  expect(atlas.requests.some(request => request.startsWith('/evidence/rows/'))).toBe(false);
  expect(atlas.requests.some(request => request.startsWith('/evidence?') || request === '/evidence')).toBe(false);
  node.close();
});

test('leaving a source out needs the history, so the viewer then reads every layer', async () => {
  const store = memoryStore();
  await publishChecks(store, { producer: 'e2e', environment: 'ios', branch: 'main', recordedAtMs: 1, checks: [check('passed')] });
  await publishChecks(store, { producer: 'e2e', environment: 'ios', branch: 'feat/x', recordedAtMs: 2, checks: [check('failed')] });
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at: '/specs/gherkin', deps: { store }, specs: { 'lists/add.feature': FEATURE }, node });
  await atlas.sees('1 failed');
  await act(async () => useUiStore.getState().setExcluded({ ...ALL_SOURCES, branches: ['feat/x'] }));
  await atlas.until(() => atlas!.requests.some(request => request.startsWith('/evidence/rows/')), 'rows of the layers behind the report');
  await atlas.sees('1 passed');
  node.close();
});

test('holding a report, the viewer is sent only what changed since, and shows the result as if it had read it all', async () => {
  const store = memoryStore();
  await publishChecks(store, { producer: 'e2e', environment: 'ios', branch: 'main', recordedAtMs: 1, checks: [check('passed')] });
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at: '/specs/gherkin', deps: {}, specs: { 'lists/add.feature': FEATURE }, node });
  await atlas.sees('1 passed');
  const held = atlas.requests.filter(request => request.startsWith('/evidence/effective'));
  expect(held.every(request => !request.includes('since='))).toBe(true);

  await publishChecks(store, { producer: 'e2e', environment: 'ios', branch: 'main', recordedAtMs: 2, checks: [check('failed')] });
  await node.index.refresh();
  await atlas.pollReport();
  await atlas.sees('1 failed');
  expect(atlas.requests.some(request => /^\/evidence\/effective\?since=[0-9a-f]{20}$/.test(request))).toBe(true);
  node.close();
});
