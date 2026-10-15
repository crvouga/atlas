import { afterEach, expect, test } from 'bun:test';
import type { LiveRun } from '@crvouga/atlas/schema';
import { memoryStore, openAtlas, publishRun, type Atlas } from './atlas';
import { resetLiveStreams } from '../src/live/live-stream';
import { indexLiveTests, testsForSlot } from '../src/live/report-progress';
import { useUiStore } from '../src/state/ui-store';
import { act } from 'react';

let atlas: Atlas | undefined;
afterEach(async () => { await atlas?.close(); atlas = undefined; resetLiveStreams(); });

const run = (): LiveRun => ({ id: 'run', producer: 'lists', environment: 'web', status: 'running', startedAtMs: 30, lastHeartbeatAtMs: 35, lastProgressAtMs: 35,
  sequence: 1, completed: 0, passed: 0, failed: 0, notRun: 0, running: 2, plannedChecks: 2,
  current: [
    { id: 'lists/add', title: 'Share a list: Add an item', specPath: 'specs/lists/add.feature', status: 'running', detail: 'Waiting for Add', steps: [{ name: 'Given a list', status: 'passed' }] },
    { id: 'lists/remove', title: 'Share a list: Remove an item', specPath: 'specs/lists/add.feature', status: 'running', detail: 'Removing tea' }
  ], recent: [] });

test('live tests appear in their scenario rows, filter by running, and stop spinning after heartbeat expiry', async () => {
  const localStore = memoryStore();
  await publishRun(localStore, { at: 20, checks: [
    { test: 'add', title: 'Share a list: Add an item', status: 'passed' },
    { test: 'several-tea', title: 'Share a list: Add several — Tea', status: 'passed' }
  ] });
  const live = run();
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature', deps: { localStore }, live: () => [live] });
  await atlas.sees('Waiting for Add');
  const rows = () => [...atlas!.host.querySelectorAll('li.result')];
  expect(rows().filter(row => row.getAttribute('data-status') === 'running')).toHaveLength(2);
  expect(atlas.host.querySelector('[aria-label="Live test feed"]')).toBeNull();
  await atlas.click('li.result button', 'Add an item');
  const add = rows().find(row => row.textContent?.includes('Add an item'))!;
  expect(add.querySelector('[aria-label="Progress log"]')?.textContent).toContain('Given a list');
  expect(add.querySelector('[aria-label="Running"]')).not.toBeNull();
  expect(add.textContent).toContain('Previous recorded result');
  await atlas.click('[aria-label="Test status"] button', 'Running');
  expect(rows()).toHaveLength(2);
  expect(atlas.find('nav[aria-label="Gherkin features"] a', 'Empty the list')).toBeUndefined();
  live.status = 'interrupted'; live.running = 0; live.finishedAtMs = 65;
  live.reason = 'Producer heartbeat timed out.';
  live.current = live.current.map(check => ({ ...check, status: 'not-run' }));
  await atlas.pollLive();
  await atlas.sees('No running tests.');
  expect(rows()).toHaveLength(0);
  await atlas.click('[aria-label="Test status"] button', 'All tests');
  await atlas.click('li.result button', 'Remove an item');
  await atlas.sees('Producer heartbeat timed out.');
  expect(rows().filter(row => row.getAttribute('data-status') === 'running')).toHaveLength(0);
  const removed = rows().find(row => row.textContent?.includes('Remove an item'))!;
  expect(removed.getAttribute('data-status')).toBe('not-run');
  expect(removed.querySelector('[aria-label="Running"]')).toBeNull();
  expect(removed.textContent).not.toContain('Passed');
});

test('completed tests leave the running filter as soon as their result arrives', async () => {
  const localStore = memoryStore();
  const live = run(); live.current = live.current.slice(0, 1); live.running = 1;
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature', deps: { localStore }, live: () => [live] });
  await atlas.sees('Waiting for Add');
  await atlas.click('[aria-label="Test status"] button', 'Running');
  await publishRun(localStore, { at: 60, checks: [{ test: 'add', title: 'Share a list: Add an item', status: 'passed' }] });
  live.status = 'completed'; live.finishedAtMs = 60; live.lastProgressAtMs = 60; live.running = 0; live.passed = live.completed = 1;
  live.recent = live.current.map(check => ({ ...check, status: 'passed' })); live.current = [];
  await atlas.pollLive(); await atlas.poll();
  await atlas.sees('No running tests.');
  expect(atlas.host.querySelector('li.result[data-status="running"]')).toBeNull();
});

test('progress matches ids and spec paths and a newer completion supersedes an older running invocation', () => {
  const older = run();
  const latest = { ...run(), id: 'newer', startedAtMs: 60, status: 'completed' as const, finishedAtMs: 70 };
  const check = older.current[0]!;
  const index = indexLiveTests([{ run: latest, check: { ...check, status: 'passed' } }, { run: older, check }]);
  const slot = { id: check.id, specPath: check.specPath!, latestAtMs: 20 };
  expect(testsForSlot(index, slot).map(test => test.check.status)).toEqual(['passed']);
  expect(testsForSlot(index, { ...slot, specPath: 'specs/another.feature' })).toHaveLength(0);
  expect(testsForSlot(index, { ...slot, latestAtMs: 80 })).toHaveLength(0);
});

test('switching a live environment off removes its running tests from the filter', async () => {
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature', deps: { localStore: memoryStore() }, live: () => [run()] });
  await atlas.sees('Waiting for Add');
  await atlas.click('[aria-label="Test status"] button', 'Running');
  await act(async () => useUiStore.setState(state => ({ excluded: { ...state.excluded, environments: ['web'] } })));
  await atlas.sees('No running tests.');
  expect(atlas.host.querySelector('li.result[data-status="running"]')).toBeNull();
});

test('a lost progress connection preserves the last log and explicitly marks it stale', async () => {
  let down = false;
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature', deps: { localStore: memoryStore() }, live: () => {
    if (down) throw new Error('Live progress unavailable; last update may be stale.');
    return [run()];
  } });
  await atlas.sees('Waiting for Add');
  await atlas.click('li.result button', 'Add an item');
  down = true;
  await atlas.pollLive();
  await atlas.sees('last update may be stale');
  expect(atlas.host.querySelector('[aria-label="Progress log"]')?.textContent).toContain('Given a list');
  expect(atlas.host.querySelector('[aria-label="Test progress"] [role="alert"]')).not.toBeNull();
});

test('SSE pushes a test lifecycle into report rows without polling the live endpoint', async () => {
  const original = globalThis.EventSource;
  const handlers = new Map<string, ((event: unknown) => void)[]>();
  let sources = 0, reads = 0;
  let snapshot!: (runs: readonly LiveRun[]) => void;
  class Source {
    static CLOSED = 2;
    readyState = 1;
    constructor() { sources++; }
    addEventListener(name: string, handler: (event: unknown) => void) { handlers.set(name, [...handlers.get(name) ?? [], handler]); }
    close() {}
  }
  globalThis.EventSource = Source as unknown as typeof EventSource;
  const push = async (name: string, data: unknown) => act(async () => { for (const handler of handlers.get(name) ?? []) handler({ data: JSON.stringify(data) }); });
  try {
    atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature', deps: { localStore: memoryStore() }, events: true, live: () => { reads++; return new Promise(resolve => { snapshot = resolve; }); } });
    await push('open', {});
    await atlas.until(() => reads > 0, 'initial snapshot');
    const before = reads;
    const live = { ...run(), id: 'edba2ba3-9c05-4fca-a762-ce3fa1fc4abc' };
    await push('run', live);
    await atlas.sees('Waiting for Add');
    await push('run', { ...live, sequence: 2, current: live.current.map(check => ({ ...check, detail: 'Saving the list' })) });
    await atlas.sees('Saving the list');
    // The initial snapshot was captured before either event, and must not erase them.
    await act(async () => snapshot([]));
    await atlas.sees('Saving the list');
    await push('run', { ...live, sequence: 3, status: 'interrupted', finishedAtMs: 80, running: 0, reason: 'Producer heartbeat timed out.' });
    await atlas.sees('Producer heartbeat timed out.');
    expect(atlas.host.querySelector('li.result[data-status="running"]')).toBeNull();
    expect(reads).toBe(before);
    expect(sources).toBe(1);
  } finally { await atlas?.close(); atlas = undefined; resetLiveStreams(); globalThis.EventSource = original; }
});

test('the spec picker indicates another running spec and clears it when the run ends', async () => {
  const live = run();
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/empty.feature', deps: { localStore: memoryStore() }, live: () => [live] });
  await atlas.sees('Empty the list');
  const picker = () => atlas!.host.querySelector<HTMLSelectElement>('select[aria-label="Spec"]')!;
  await atlas.until(() => !!picker()?.parentElement?.querySelector('[aria-label="Specs running"]'), 'spec picker activity');
  expect(picker().value).toBe('lists/empty.feature');
  expect([...picker().options].find(option => option.value === 'lists/add.feature')!.textContent).toContain('· Running');
  expect([...picker().options].find(option => option.value === 'lists/empty.feature')!.textContent).not.toContain('· Running');
  live.status = 'completed'; live.current = []; live.recent = []; live.running = 0; live.finishedAtMs = 80;
  await atlas.pollLive();
  await atlas.until(() => !picker().parentElement?.querySelector('[aria-label="Specs running"]'), 'idle picker');
  expect([...picker().options].some(option => option.textContent?.includes('· Running'))).toBe(false);
});
