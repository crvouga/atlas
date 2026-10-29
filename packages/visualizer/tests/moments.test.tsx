import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import type { ObjectStore } from '@crvouga/atlas/reports/object-store';
import { act } from 'react';

import { createNode } from '../../server/tests/node-compat';
import { memoryStore, openAtlas, type Atlas } from './atlas';

class FinderResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FinderResizeObserver as unknown as typeof ResizeObserver;

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const SPEC = 'specs/lists/add.feature';
const PAY = { id: 'lists/add', title: 'Add an item', specPath: SPEC };
const KEY = JSON.stringify([SPEC, PAY.id]);
const bytes = (text: string) => new TextEncoder().encode(text);
const identityOf = (text: string) => `sha256:${createHash('sha256').update(bytes(text)).digest('hex')}`;

/** A recording that starts 2 s before the check and has a 1 s title card put in at 3 s of the check. */
const TIMING = { 'atlas.media': { checkStartMs: 2000, pauses: [{ atMs: 3000, durationMs: 1000, reason: 'title card' }] } };
const STEPS = [
  { id: 'a', name: 'a list exists', kind: 'given', status: 'passed', offsetMs: 0, durationMs: 400 },
  { id: 'b', name: 'adding tea', kind: 'when', status: 'passed', offsetMs: 1500, durationMs: 300 },
  { id: 'c', name: 'the list includes tea', kind: 'then', status: 'failed', offsetMs: 3000, durationMs: 100 }
];
const movie = (text: string, extra: Record<string, unknown> = {}) => ({ name: `${text}.webm`, role: 'video', contentType: 'video/webm', data: bytes(text), durationMs: 12_000, ...extra });

async function publish(store: ObjectStore, at: number, check: Record<string, unknown>) {
  return publishChecks(store, { recordedAtMs: at, sha: 'a'.repeat(40), branch: 'main', producer: 'e2e-web', environment: 'desktop-web', checks: [{ ...PAY, ...check }] });
}

async function open<T = void>(prepare: (store: ObjectStore) => Promise<T>, address: (prepared: T) => string = () => `/?test=${encodeURIComponent(KEY)}`, waitForVideo = true) {
  const store = memoryStore();
  const at = address(await prepare(store));
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at, specs: {}, deps: {}, node });
  if (waitForVideo) await atlas.until(() => document.querySelector('video') !== null, 'the recording');
  return atlas;
}

const videos = () => [...document.querySelectorAll<HTMLVideoElement>('video')];
const seek = (name: RegExp) => [...document.querySelectorAll<HTMLButtonElement>('button[data-seek]')].find((button) => name.test(button.getAttribute('aria-label') ?? ''))!;
const row = (name: string) => [...document.querySelectorAll<HTMLElement>('[data-evidence-step]')].find((item) => item.textContent!.includes(name))!;
const press = async (button: HTMLButtonElement) => act(async () => button.click());
const playAt = async (video: HTMLVideoElement, seconds: number) =>
  act(async () => {
    video.currentTime = seconds;
    video.dispatchEvent(new Event('timeupdate'));
  });
const text = () => document.body.textContent ?? '';

test('selecting a step seeks the recording to the moment its timing gives, by the recording clock and not the check clock', async () => {
  await open((store) => publish(store, 100, { status: 'failed', detail: 'no tea', steps: STEPS, attachments: [movie('run', { extensions: TIMING })] }));
  const video = videos()[0]!;
  expect(video.currentTime).toBe(0);
  // 2 s before the check + 1.5 s into it.
  await press(seek(/adding tea/));
  expect(video.currentTime).toBe(3.5);
  // 2 s + 3 s + the 1 s title card put into the recording before this step.
  await press(seek(/includes tea/));
  expect(video.currentTime).toBe(6);
  expect(seek(/includes tea/).getAttribute('aria-label')).toContain('at 0:06.0');
  // The test clock stays visible beside the recording's.
  expect(row('adding tea').textContent).toContain('+1.5 s');
});

test('a paced recording discloses its pauses as pacing, not application latency', async () => {
  await open((store) => publish(store, 100, { status: 'failed', steps: STEPS, attachments: [movie('run', { extensions: TIMING })] }));
  const pacing = document.querySelector('[data-pacing]')!.textContent!;
  expect(pacing).toContain('Paced recording');
  expect(pacing).toContain('a pause totalling 1.0 s');
  expect(pacing).toContain('title card');
  expect(pacing).toContain('not application latency');
  expect(document.querySelector('[data-moments]')!.textContent).toContain('the check starts 0:02.0 into the recording');
});

test('playback marks the step playing without taking focus from the keyboard', async () => {
  await open((store) => publish(store, 100, { status: 'failed', steps: STEPS, attachments: [movie('run', { extensions: TIMING })] }));
  const video = videos()[0]!;
  const focused = seek(/a list exists/);
  focused.focus();
  expect(document.activeElement).toBe(focused);
  await playAt(video, 2.5);
  expect(row('a list exists').getAttribute('aria-current')).toBe('step');
  await playAt(video, 3.6);
  expect(row('a list exists').getAttribute('aria-current')).toBeNull();
  expect(row('adding tea').getAttribute('aria-current')).toBe('step');
  expect(row('adding tea').textContent).toContain('Playing now');
  await playAt(video, 6.2);
  expect(row('the list includes tea').getAttribute('aria-current')).toBe('step');
  expect(document.activeElement).toBe(focused);
});

test('a recording without timing, a step without an offset, and a moment outside the recording explain themselves and move nothing', async () => {
  await open((store) =>
    publish(store, 100, {
      status: 'failed',
      steps: [...STEPS, { id: 'd', name: 'the list is saved', kind: 'then', status: 'passed' }, { id: 'e', name: 'it is shown later', kind: 'then', status: 'passed', offsetMs: 1 }],
      attachments: [
        movie('bare'),
        movie('timed', { extensions: { 'atlas.media': { checkStartMs: 0, marks: [{ step: 'e', mediaMs: 99_000 }] } } })
      ]
    })
  );
  const [bare, timed] = videos();
  // The recording that carries timing is the one steps are shown in at first; choose the other.
  const select = document.querySelector<HTMLSelectElement>('[data-moments] select')!;
  const choose = async (at: number) =>
    act(async () => {
      select.value = select.options[at]!.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  await choose(0);
  // The first recording carries no timing: it is never assumed to start with the check.
  await press(seek(/adding tea/));
  expect(bare!.currentTime).toBe(0);
  expect(document.querySelector('[data-moment-notice]')!.textContent).toContain('carries no timing metadata');
  expect(document.querySelector('[data-alignment]')!.getAttribute('data-alignment')).toBe('unavailable');
  expect(seek(/adding tea/).textContent).toBe('Not aligned');
  // Choosing the recording that does carry timing: a step with no offset, and one whose mark is past the end.
  await choose(1);
  await press(seek(/the list is saved/));
  expect(document.querySelector('[data-moment-notice]')!.textContent).toContain('recorded no start offset');
  await press(seek(/it is shown later/));
  expect(document.querySelector('[data-moment-notice]')!.textContent).toContain('after the recording ends');
  expect(timed!.currentTime).toBe(0);
  await press(seek(/adding tea/));
  expect(timed!.currentTime).toBe(1.5);
  expect(document.querySelector('[data-moment-notice]')).toBeNull();
});

test('a retry is aligned by its own recording and timing, never by the previous try', async () => {
  await open((store) =>
    publish(store, 100, {
      status: 'passed',
      attempts: [
        { index: 0, status: 'failed', steps: [{ id: 'x', name: 'first try taps', status: 'failed', offsetMs: 100 }], attachments: [movie('first', { extensions: { 'atlas.media': { checkStartMs: 1000 } } })] },
        { index: 1, status: 'passed', steps: [{ id: 'x', name: 'second try taps', status: 'passed', offsetMs: 100 }], attachments: [movie('second', { extensions: { 'atlas.media': { checkStartMs: 5000 } } })] }
      ]
    })
  );
  const [first, second] = videos();
  expect(videos()).toHaveLength(2);
  await press(seek(/second try taps/));
  expect(second!.currentTime).toBe(5.1);
  expect(first!.currentTime).toBe(0);
  await press(seek(/first try taps/));
  expect(first!.currentTime).toBe(1.1);
  expect(second!.currentTime).toBe(5.1);
});

test('the failing moment is one click from the failure summary, and says when it cannot be placed', async () => {
  await open((store) => publish(store, 100, { status: 'failed', detail: 'no tea', steps: STEPS, attachments: [movie('run', { extensions: TIMING })] }));
  const video = videos()[0]!;
  const jump = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Outcome summary"] button')].find((button) => /Jump to the failing moment/.test(button.textContent ?? ''))!;
  await press(jump);
  expect(video.currentTime).toBe(6);
  expect(document.querySelector('[data-jump-result]')!.textContent).toContain('Moved the recording to 0:06.0');
});

test('the failing moment of a recording without timing is reported unavailable, not guessed', async () => {
  await open((store) => publish(store, 100, { status: 'failed', detail: 'no tea', steps: STEPS, attachments: [movie('run')] }));
  const jump = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Outcome summary"] button')].find((button) => /Jump to the failing moment/.test(button.textContent ?? ''))!;
  await press(jump);
  expect(videos()[0]!.currentTime).toBe(0);
  expect(document.querySelector('[data-jump-result]')!.textContent).toContain('cannot be shown in the recording');
});

test('a copied link names the run, the recording and the position, and reopens that moment even when a newer run exists', async () => {
  const written: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => void written.push(value) }, configurable: true });
  const view = await open(
    async (store) => {
      const old = await publish(store, 100, { status: 'failed', steps: STEPS, attachments: [movie('old', { extensions: TIMING })] });
      await publish(store, 200, { status: 'passed', steps: STEPS, attachments: [movie('new', { extensions: TIMING })] });
      return old.id;
    },
    (layer) => `/?test=${encodeURIComponent(KEY)}&layer=${layer}`
  );
  const layer = view.router.state.location.search.layer as string;
  await playAt(videos()[0]!, 4.25);
  await press([...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => /Copy link to this moment/.test(button.textContent ?? ''))!);
  expect(written).toHaveLength(1);
  const link = new URL(written[0]!);
  expect(link.searchParams.get('layer')).toBe(layer);
  expect(link.searchParams.get('clip')).toContain(identityOf('old').replace(/"/g, ''));
  expect(link.searchParams.get('clipAt')).toBe('4250');
  expect(text()).toContain('Link copied');
});

/** The browser tells the player how long the file is, which is when a requested position can be checked and applied. */
const loaded = async (video: HTMLVideoElement, seconds: number) =>
  act(async () => {
    Object.defineProperty(video, 'duration', { value: seconds, configurable: true });
    video.dispatchEvent(new Event('loadedmetadata'));
  });

/** An older failing run and a newer passing one, each with its own recording; the page opens at `at(oldLayer, oldRecording)`. */
async function twoRuns(at: (layer: string, clip: string) => string) {
  return open(
    async (store) => {
      const old = await publish(store, 100, { status: 'failed', steps: STEPS, attachments: [movie('old', { extensions: TIMING })] });
      await publish(store, 200, { status: 'passed', steps: STEPS, attachments: [movie('new', { extensions: TIMING })] });
      return old.id;
    },
    (layer) => at(layer, identityOf('old'))
  );
}

test('a shared link selects the exact recording of the named run, seeks to the position, and does not switch to a newer run', async () => {
  const view = await twoRuns(
    (layer, clip) => `/?test=${encodeURIComponent(KEY)}&layer=${layer}&clip=${encodeURIComponent(clip)}&clipAt=4250`
  );
  const layer = view.router.state.location.search.layer as string;
  const video = videos()[0]!;
  expect(videos()).toHaveLength(1);
  expect(video.getAttribute('src')).toContain(`/layers/${layer}/`);
  expect(text()).toContain('This run');
  expect(text()).toContain('A newer result exists');
  await loaded(video, 12);
  expect(video.currentTime).toBe(4.25);
  // The step under that position is marked after the seek.
  expect(row('adding tea').getAttribute('aria-current')).toBe('step');
});

test('a shared position past the end of the recording is reported and nothing is moved', async () => {
  await twoRuns(
    (layer, clip) => `/?test=${encodeURIComponent(KEY)}&layer=${layer}&clip=${encodeURIComponent(clip)}&clipAt=99000`
  );
  const video = videos()[0]!;
  await loaded(video, 12);
  expect(video.currentTime).toBe(0);
  expect(document.querySelector('[data-moment-notice]')!.textContent).toContain('after the end of the recording');
});

test('a shared link whose recording is not in the named run says so and plays nothing in its place', async () => {
  await twoRuns(
    (layer) => `/?test=${encodeURIComponent(KEY)}&layer=${layer}&clip=${encodeURIComponent(identityOf('some other run'))}&clipAt=1000`
  );
  const video = videos()[0]!;
  await loaded(video, 12);
  expect(video.currentTime).toBe(0);
  expect(document.querySelector('[data-moment-missing]')!.textContent).toContain('no other run is');
});

test('the Watch tab of a behavior shows its recorded steps beside the recording and seeks it', async () => {
  const store = memoryStore();
  await publishChecks(store, {
    recordedAtMs: 100,
    sha: 'a'.repeat(40),
    branch: 'main',
    producer: 'e2e-web',
    environment: 'desktop-web',
    checks: [{ id: `${SPEC} > Add an item`, title: 'Add an item', specPath: SPEC, status: 'passed', steps: STEPS, attachments: [movie('run', { extensions: TIMING })] }]
  });
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  const { FEATURE } = await import('./atlas');
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature', deps: {}, specs: { 'lists/add.feature': FEATURE }, node });
  await atlas.until(() => [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('Add an item')), 'the behavior');
  await atlas.click('button', 'Add an item');
  await atlas.until(() => document.querySelector('video') !== null, 'the recording on Watch');
  await press(seek(/adding tea/));
  expect(videos()[0]!.currentTime).toBe(3.5);
  expect(document.querySelector('[role="tabpanel"] [aria-label="Recording moments"]')).not.toBeNull();
});

test('a watch session seeks its clip from the scenario steps and links to the result it is a clip of', async () => {
  const written: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => void written.push(value) }, configurable: true });
  const store = memoryStore();
  await publish(store, 100, { status: 'failed', steps: STEPS, attachments: [movie('run', { extensions: TIMING })] });
  atlas = await openAtlas({ at: '/?tab=artifacts', specs: {}, deps: { localStore: store } });
  await atlas!.until(() => document.querySelectorAll('section[aria-label="Artifacts"] tbody tr').length > 0, 'the result');
  await atlas!.click('button', /Watch these 1 result/);
  await atlas!.until(() => document.querySelector('video[data-playing]') !== null, 'the clip');
  const video = document.querySelector<HTMLVideoElement>('video[data-playing]')!;
  await act(async () => void seek(/includes tea/).click());
  expect(video.currentTime).toBe(6);
  await playAt(video, 6);
  expect(document.querySelector('section[aria-label="Scenario"] [aria-current="step"]')!.textContent).toContain('the list includes tea');
  await press([...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => /Copy link to this moment/.test(button.textContent ?? ''))!);
  const link = new URL(written[0]!);
  expect(link.searchParams.get('test')).toContain(PAY.id);
  expect(link.searchParams.get('layer')).toMatch(/^[0-9a-f]{64}$/);
  expect(link.searchParams.has('tab')).toBe(false);
  expect(link.searchParams.get('clipAt')).toBe('6000');
});
