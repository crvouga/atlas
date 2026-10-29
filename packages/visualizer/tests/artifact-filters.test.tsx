import { afterEach, beforeEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import type { RunList } from '@crvouga/atlas/reports/test-catalog';
import { act } from 'react';

import { runsAnswer } from '../src/explorer/catalog';
import { memoryStore, openAtlas, type Atlas } from './atlas';

class FinderResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FinderResizeObserver as unknown as typeof ResizeObserver;

let atlas: Atlas | null = null;
beforeEach(() => localStorage.clear());
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const PAY = 'specs/checkout/pay.feature';
const bytes = (text: string) => new TextEncoder().encode(text);
const movie = (name: string, text: string, extra: Record<string, unknown> = {}) => ({ name, contentType: 'video/webm', data: bytes(text), ...extra });
const RUN = (n: number) => `https://github.com/acme/app/actions/runs/${n}`;
const card = { id: 'pay', title: 'Pay with a card', specPath: PAY };

/** Demo videos from two producers on two devices, a later untagged attempt, and a tag with a space and a hash. */
async function seed() {
  const localStore = memoryStore();
  const specs = [{ path: PAY, domain: 'checkout', kind: 'feature', title: 'Pay' }];
  const base = { specs, branch: 'main' };
  await publishChecks(localStore, { ...base, producer: 'Demo-Recorder', environment: 'ios', sha: '1'.repeat(40), runUrl: RUN(1), recordedAtMs: 1_000, checks: [{ ...card, status: 'failed', labels: { device: 'iPhone' }, attachments: [movie('a.webm', 'one', { tags: ['#Demo', 'release #2'] })] }] });
  await publishChecks(localStore, { ...base, producer: 'checkout-demos', environment: 'desktop-web', sha: '2'.repeat(40), runUrl: RUN(2), recordedAtMs: 2_000, checks: [{ ...card, status: 'passed', attachments: [movie('b.webm', 'two', { tags: ['demo'] })] }] });
  await publishChecks(localStore, { ...base, producer: 'Demo-Recorder', environment: 'ios', sha: '3'.repeat(40), runUrl: RUN(3), recordedAtMs: 3_000, checks: [{ ...card, status: 'passed', labels: { device: 'iPhone' }, attachments: [movie('c.webm', 'three')] }] });
  return localStore;
}

async function open(at: string) {
  atlas = await openAtlas({ at, specs: {}, deps: { localStore: await seed() } });
  return atlas;
}
const artifactRows = () => [...document.querySelectorAll<HTMLElement>('section[aria-label="Artifacts"] tbody tr')];
const runRows = () => [...document.querySelectorAll<HTMLElement>('section[aria-label="Runs"] tbody tr')];
const chips = () => [...document.querySelectorAll<HTMLElement>('[aria-label="Active filters"] button')].map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');
const button = (label: string | RegExp) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => (typeof label === 'string' ? item.textContent?.trim() === label || item.getAttribute('aria-label') === label : label.test(item.textContent ?? '')))!;

test('the Artifacts tab finds demo videos across producers with the run, revision and status they were recorded with', async () => {
  const view = await open('/?tab=artifacts&artifactTag=demo&type=video');
  await view.until(() => artifactRows().length === 2, 'the two tagged recordings');
  // The historical, failed recording is found though the latest attempt (run #3) is untagged.
  const rows = artifactRows().map((row) => row.textContent ?? '');
  expect(rows.some((row) => row.includes('Demo-Recorder') && row.includes('Failed') && row.includes('#1') && row.includes('1111111'))).toBe(true);
  expect(rows.some((row) => row.includes('checkout-demos') && row.includes('#2'))).toBe(true);
  expect(rows.some((row) => row.includes('#3'))).toBe(false);
  expect(chips()).toEqual(['Remove Tag: #demo', 'Remove Type: video', 'Clear filters']);
  // The row opens exactly that result.
  const link = artifactRows()[1]!.querySelector<HTMLAnchorElement>('a[aria-label^="Open Pay with a card as recorded"]')!;
  expect(link.getAttribute('href')).toContain('layer=');
});

test('facets combine with AND across dimensions, and counts follow the list', async () => {
  const view = await open('/?tab=artifacts&artifactTag=demo&type=video');
  await view.until(() => artifactRows().length === 2, 'two recordings');
  await view.until(() => document.body.textContent!.includes('2 results matching'), 'the count line');
  // Add the device (an environment) and the feature through the address, as a link would.
  await act(async () => void view.router.navigate({ to: '/', search: { tab: 'artifacts', artifactTag: 'demo', type: 'video', env: 'ios', label: 'device=iPhone' } as never }));
  await view.until(() => artifactRows().length === 1, 'the iPhone demo only');
  expect(artifactRows()[0]!.textContent).toContain('Demo-Recorder');
  expect(view.router.state.location.search).toMatchObject({ artifactTag: 'demo', type: 'video', env: 'ios', label: 'device=iPhone' });
});

test('a filtered address restores after a reload, and tag values with a hash, a space or a comma are encoded safely', async () => {
  const tag = 'release #2,x';
  const address = `/?tab=artifacts&artifactTag=${encodeURIComponent('release #2\\,x')}`;
  const view = await open(address);
  await view.until(() => document.querySelector('section[aria-label="Artifacts"]') !== null, 'the artifacts');
  await view.until(() => chips().includes(`Remove Tag: #${tag}`), 'one chip with the whole value');
  // A tag that does not exist is listed so it can be removed, and nothing matches it.
  expect(artifactRows()).toHaveLength(0);

  await act(async () => void view.router.navigate({ to: '/', search: { tab: 'artifacts', artifactTag: 'release #2' } as never }));
  await view.until(() => artifactRows().length === 1, 'the tagged recording');
  // The hash is encoded in the address, and the tag normalizes as the report stores it (spaces become dashes).
  expect(view.router.state.location.href).toContain('%232');
  expect(view.router.state.location.href).not.toContain('#2');
  expect(artifactRows()[0]!.textContent).toContain('#release-#2');
});

test('a filter with no match says nothing matches and offers to clear it, never that nothing was recorded', async () => {
  const view = await open('/?tab=artifacts&artifactTag=unheard-of');
  await view.until(() => document.querySelector('[data-no-match]') !== null, 'the no-match message');
  const message = document.querySelector('[data-no-match]')!.textContent!;
  expect(message).toContain('Nothing matches these filters');
  expect(document.body.textContent).not.toContain('No recorded result carries evidence');
  await act(async () => button('Clear filters').click());
  await view.until(() => artifactRows().length === 3, 'every recording again');

  await act(async () => void view.router.navigate({ to: '/', search: { tab: 'runs', branch: 'nowhere' } as never }));
  await view.until(() => document.querySelector('section[aria-label="Runs"] [data-no-match]') !== null, 'the runs no-match message');
  expect(document.body.textContent).toContain('No run matches these filters');
  expect(document.body.textContent).not.toContain('No runs recorded yet');
  await act(async () => button('Clear filters').click());
  await view.until(() => runRows().length === 3, 'every run again');
});

test('the Runs tab filters by tag, type, outcome and label, and shows the tags a run carries', async () => {
  const view = await open('/?tab=runs&artifactTag=demo&type=video');
  await view.until(() => runRows().length === 2, 'the two runs with tagged videos');
  expect(runRows().every((row) => row.querySelector('[data-tags]')!.textContent!.includes('#demo'))).toBe(true);
  await act(async () => void view.router.navigate({ to: '/', search: { tab: 'runs', outcome: 'failed' } as never }));
  await view.until(() => runRows().length === 1, 'the failed run');
  expect(runRows()[0]!.textContent).toContain('1111111');
});

test('a saved view reopens its query and is shown as a live query, not a snapshot', async () => {
  const view = await open('/?tab=artifacts&artifactTag=demo&type=video');
  await view.until(() => artifactRows().length === 2, 'two recordings');
  await act(async () => button(/^Views/).click());
  await view.until(() => document.querySelector('input[placeholder="Demo review"]') !== null, 'the views popover');
  expect(document.body.textContent).toContain('not a snapshot');
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Demo review"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Demo review');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Save the current filters').click());
  await view.until(() => document.querySelector('a[aria-label="Open view Demo review"]') !== null, 'the saved view');
  expect(JSON.parse(localStorage.getItem('atlas.savedViews.v1')!)[0]).toMatchObject({ name: 'Demo review', tab: 'artifacts', filters: { artifactTag: 'demo', type: 'video' } });

  // Leave the query, then open the view: its query is restored and labelled as live.
  await act(async () => button('Clear filters').click());
  await view.until(() => artifactRows().length === 3, 'every recording');
  await act(async () => document.querySelector<HTMLAnchorElement>('a[aria-label="Open view Demo review"]')!.click());
  await view.until(() => artifactRows().length === 2, 'the view\'s two recordings');
  await view.until(() => document.querySelector('[aria-label="Live query Demo review"]') !== null, 'the live query badge');
  expect(document.body.textContent).toContain('A live query, not a snapshot');
});

test('the Tests tab filters by artifact tag, offers the tags with counts and clears them', async () => {
  const view = await open('/?artifactTag=demo');
  await view.until(() => document.querySelector('input[aria-label="Artifact tag"], [aria-label="Artifact tag"]') !== null, 'the artifact tag filter');
  await view.until(() => document.querySelector('section[aria-label="Tests"]') !== null, 'the tests');
  expect(document.body.textContent).toContain('Artifact tag: #demo');
  expect(document.querySelectorAll('section[aria-label="Tests"] li a').length).toBe(1);
  await act(async () => button('Clear filters').click());
  expect(view.router.state.location.search).not.toHaveProperty('artifactTag');
});

test('an older server that ignores a filter is not shown as if it had narrowed the list', () => {
  const run = (key: string, branch: string) =>
    ({ key, branch, sha: null, runUrl: null, startedAtMs: 1, endedAtMs: 2, spanMs: 1, producers: ['p'], environments: ['ios'], layers: 1, tests: 1, counts: { passed: 1, failed: 0, running: 0, 'not-run': 0 }, totalDurationMs: null, failing: [] }) as RunList['runs'][number];
  const everything: RunList = { schemaVersion: 1, version: 'v', total: 2, runs: [run('a', 'main'), run('b', 'dev')] };
  // The viewer filters what an old run summary can answer, and says it cannot filter by what it cannot.
  const answer = runsAnswer(everything, { branch: ['dev'], artifactTag: ['demo'] });
  expect(answer.runs.map((item) => item.key)).toEqual(['b']);
  expect(answer.total).toBe(1);
  expect(answer.notApplied).toEqual(['artifactTag']);
  expect(answer.facets.branches.map((facet) => facet.value).sort()).toEqual(['dev', 'main']);
  // A server that names the filters it applied is taken at its word.
  const current = runsAnswer({ ...everything, filters: ['branch', 'artifactTag'], facets: answer.facets }, { branch: ['dev'], artifactTag: ['demo'] });
  expect(current.notApplied).toEqual([]);
  expect(current.runs).toHaveLength(2);
});
