import { AtlasThemeProvider } from '../src/ui/theme';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import type { RunList } from '@crvouga/atlas/reports/test-catalog';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { LayerHeader } from '@crvouga/atlas/reports/evidence-types';
import { Origin } from '../src/evidence/marks';
import { runsAnswer } from '../src/explorer/catalog';
import { memoryStore, openAtlas, type Atlas } from './atlas';

class FinderResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FinderResizeObserver as unknown as typeof ResizeObserver;

let root: Root | null = null;
let atlas: Atlas | null = null;
beforeEach(() => localStorage.clear());
afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  await atlas?.close();
  atlas = null;
  document.body.innerHTML = '';
});

async function render(node: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AtlasThemeProvider env="test">{node}</AtlasThemeProvider>);
  });
  return host;
}

const layer = (extra: Partial<LayerHeader> = {}): LayerHeader => ({
  id: 'a'.repeat(64), backend: 'ci', producer: 'web-e2e', packageDir: null, recordedAtMs: 1, sha: null, branch: 'main', environment: null, runUrl: null,
  parameters: {}, recording: null, live: false, counts: { passed: 3, failed: 0, running: 0, 'not-run': 0 }, execution: 'x', ...extra
});
const backends = [{ id: 'ci', label: 'CI', live: false, available: true }];

test('a run with every expected recording published says so, beside its green results', async () => {
  const host = await render(<Origin layer={layer({ recordings: { expected: 3, uploaded: 3, referenced: 0, skipped: 0, unresolved: 0, notApplicable: 0 } })} backends={backends} now={2} />);
  expect(host.textContent).toContain('Recordings 3 of 3');
  expect(host.textContent).not.toContain('incomplete');
});

test('a run with a missing recording is marked incomplete in words, independent of its outcomes', async () => {
  const host = await render(<Origin layer={layer({ recordings: { expected: 3, uploaded: 2, referenced: 0, skipped: 0, unresolved: 1, notApplicable: 1 } })} backends={backends} now={2} />);
  expect(host.textContent).toContain('Recordings 2 of 3: incomplete');
});

test('an old run that declared no expectations claims nothing about recordings', async () => {
  const host = await render(<Origin layer={layer()} backends={backends} now={2} />);
  expect(host.textContent).not.toContain('Recordings');
});

const RUN = (n: number) => `https://github.com/acme/app/actions/runs/${n}`;
const webm = (text: string) => ({ name: `${text}.webm`, role: 'video', contentType: 'video/webm', data: new TextEncoder().encode(text) });

/** Four green runs: all recordings published, one missing, one that never declared expectations, and one whose video file is gone from its layer. */
async function seed() {
  const localStore = memoryStore();
  const run = (n: number) => ({ producer: 'web', environment: 'desktop-web', branch: 'main', sha: String(n).repeat(40), runUrl: RUN(n), recordedAtMs: n * 1_000 });
  const required = { recordingExpectation: 'required' as const, status: 'passed' as const };
  await publishChecks(localStore, { ...run(1), checks: [{ id: 'a', title: 'A', ...required, attachments: [webm('one')] }] });
  await publishChecks(localStore, { ...run(2), checks: [{ id: 'a', title: 'A', ...required }] });
  await publishChecks(localStore, { ...run(3), checks: [{ id: 'a', title: 'A', status: 'passed' }] });
  return localStore;
}
const runRows = () => [...document.querySelectorAll<HTMLElement>('section[aria-label="Runs"] tbody tr')];
const runNumbers = () => runRows().map((row) => row.querySelector('a')?.getAttribute('aria-label'));

test('the Runs tab filters by recording completeness, independent of green outcomes, and a link restores the filter', async () => {
  atlas = await openAtlas({ at: '/?tab=runs&recordings=incomplete', specs: {}, deps: { localStore: await seed() } });
  await atlas.until(() => runRows().length === 1, 'only the run with a missing recording');
  expect(runNumbers()).toEqual(['Open run #2']);
  // Its tests all passed; the row says the evidence is incomplete in words.
  expect(runRows()[0]!.textContent).toContain('1 passed');
  expect(runRows()[0]!.querySelector('[data-recordings="incomplete"]')!.textContent).toBe('Recordings 0 of 1: incomplete');
  expect([...document.querySelectorAll('[aria-label="Active filters"] button')].map((item) => item.getAttribute('aria-label'))).toContain('Remove Recordings: Incomplete');
  // The facet offers each state with the count the list would hold.
  expect(document.body.textContent).toContain('Recordings');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.getAttribute('aria-label') === 'Remove Recordings: Incomplete')!.click());
  await atlas.until(() => runRows().length === 3, 'every run again');
  expect(atlas.router.state.location.search).not.toHaveProperty('recordings');
  // A run that never declared expectations claims nothing; it is not shown as complete.
  const third = runRows().find((row) => row.querySelector('a[aria-label="Open run #3"]'))!;
  expect(third.querySelector('[data-recordings]')).toBeNull();
});

test('Unknown matches the run that declared nothing, never Complete', async () => {
  atlas = await openAtlas({ at: '/?tab=runs&recordings=unknown', specs: {}, deps: { localStore: await seed() } });
  await atlas.until(() => runRows().length === 1, 'the run with no receipt');
  expect(runNumbers()).toEqual(['Open run #3']);
});

test('zero matches say nothing matches and offer to clear the filters', async () => {
  atlas = await openAtlas({ at: '/?tab=runs&recordings=none-expected', specs: {}, deps: { localStore: await seed() } });
  await atlas.until(() => document.querySelector('[data-no-match]') !== null, 'the empty answer');
  expect(document.querySelector('[data-no-match]')!.textContent).toContain('No run matches these filters');
});

test('an older server that ignores the recordings filter is not shown as if it had narrowed the list', () => {
  const run = (key: string) =>
    ({ key, branch: 'main', sha: null, runUrl: null, startedAtMs: 1, endedAtMs: 2, spanMs: 1, producers: ['p'], environments: ['ios'], layers: 1, tests: 1, counts: { passed: 1, failed: 0, running: 0, 'not-run': 0 }, totalDurationMs: null, failing: [] }) as RunList['runs'][number];
  const everything: RunList = { schemaVersion: 1, version: 'v', total: 2, runs: [run('a'), run('b')], filters: ['branch'], facets: { artifactTags: [], types: [], labels: [], environments: [], producers: [], branches: [], outcomes: [] } };
  const answer = runsAnswer(everything, { recordings: ['incomplete'] });
  expect(answer.notApplied).toEqual(['recordings']);
  expect(answer.runs).toHaveLength(2);
});

test('a video the run names but its bundle no longer holds is explained as stored-then-gone, not offered to play', async () => {
  const localStore = memoryStore();
  const kept = await publishChecks(localStore, { producer: 'web', environment: 'desktop-web', recordedAtMs: 1_000, checks: [{ id: 'a', title: 'A', status: 'passed', attachments: [webm('one')] }] });
  const { readLayer, publishLayerBundle } = await import('@crvouga/atlas/reports/layer-store');
  const held = (await readLayer(localStore, kept.id))!;
  const [key] = Object.keys(held.bundle) as [string];
  await publishLayerBundle(localStore, {
    producer: 'lost', environment: 'desktop-web', recordedAtMs: 2_000, sha: null, branch: null, runUrl: RUN(9), parameters: {}, specs: [], source: null, recording: { type: 'layer' },
    parts: [{ kind: 'checks', id: 'lost', title: 'lost', recordedAtMs: 2_000, checks: [{ id: 'gone', title: 'Gone', status: 'passed', attachments: [{ name: 'gone.webm', role: 'video', contentType: 'video/webm', bundleKey: `attachments/${'9'.repeat(64)}`, sha256: '9'.repeat(64) }] }] }] as never
  }, { [key]: held.bundle[key]! });
  atlas = await openAtlas({ at: '/?tab=runs', specs: {}, deps: { localStore } });
  await atlas.until(() => runRows().length === 2, 'two runs');
  const row = runRows().find((item) => item.querySelector('a[aria-label="Open run #9"]'))!;
  expect(row.textContent).toContain('1 video unavailable');
  expect(row.querySelector('[data-video-missing]')!.textContent).toContain('no longer holds it');
  expect(row.textContent).not.toContain('never stored');
  expect(row.querySelector('a[aria-label^="Watch"]')).toBeNull();
});
