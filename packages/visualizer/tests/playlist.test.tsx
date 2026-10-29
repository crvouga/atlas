import { afterEach, beforeEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { act } from 'react';

import { memoryStore, openAtlas, type Atlas } from './atlas';

class FinderResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FinderResizeObserver as unknown as typeof ResizeObserver;

/** A browser that refuses to start a video by itself, as autoplay policies do, and records what was asked of it. */
let plays: HTMLMediaElement[] = [];
let blockPlay = false;
const mediaPrototype = (globalThis as unknown as { window: { HTMLMediaElement: { prototype: { play: () => unknown } } } }).window.HTMLMediaElement.prototype;
const realPlay = mediaPrototype.play;
beforeEach(() => {
  localStorage.clear();
  plays = [];
  blockPlay = false;
  mediaPrototype.play = function (this: HTMLMediaElement) {
    plays.push(this);
    return blockPlay ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
  };
});

let atlas: Atlas | null = null;
afterEach(async () => {
  mediaPrototype.play = realPlay;
  await atlas?.close();
  atlas = null;
});

const bytes = (text: string) => new TextEncoder().encode(text);
const movie = (name: string, text: string, extra: Record<string, unknown> = {}) => ({ name, contentType: 'video/webm', data: bytes(text), ...extra });
const RUN = (n: number) => `https://github.com/acme/app/actions/runs/${n}`;
const SPEC = 'specs/checkout/pay.feature';
const specs = [{ path: SPEC, domain: 'checkout', kind: 'feature', title: 'Pay' }];
const base = { specs, producer: 'web', environment: 'desktop-web', branch: 'main', sha: 'a'.repeat(40), runUrl: RUN(1), recordedAtMs: 1_000 };

/** A passing and a failing recording (the failing one is paced and silent), a result with a screenshot only, and an API result. */
async function seed() {
  const store = memoryStore();
  await publishChecks(store, {
    ...base,
    checks: [
      {
        id: 'pay', title: 'Pay with a card', specPath: SPEC, status: 'passed',
        steps: [{ name: 'a card is on file', kind: 'given' }, { name: 'the customer pays', kind: 'when' }, { name: 'the order is paid', kind: 'then' }],
        attachments: [movie('pay.webm', 'pay')]
      },
      {
        id: 'decline', title: 'A declined card', specPath: SPEC, status: 'failed', detail: 'card_declined was not shown',
        attachments: [movie('decline.webm', 'decline', { poster: 'shot', scope: { pacing: 'paced', audioCaptured: false, dependencies: 'scripted' }, durationMs: 4_000 }), { id: 'shot', name: 'decline.png', contentType: 'image/png', data: bytes('poster') }, { name: 'captions.vtt', contentType: 'text/vtt', data: bytes('WEBVTT\n') }]
      },
      { id: 'receipt', title: 'Email a receipt', specPath: SPEC, status: 'passed', attachments: [{ name: 'receipt.png', contentType: 'image/png', data: bytes('png') }] }
    ]
  });
  await publishChecks(store, { ...base, environment: 'api', producer: 'api', runUrl: RUN(2), recordedAtMs: 2_000, checks: [{ id: 'quote', title: 'Quote an order', specPath: SPEC, status: 'passed', attachments: [{ name: 'quote.json', contentType: 'application/json', data: bytes('{}') }] }] });
  return store;
}

async function open(at = '/?tab=artifacts') {
  atlas = await openAtlas({ at, specs: {}, deps: { localStore: await seed() } });
  if (at.includes('tab=artifacts')) await atlas.until(() => document.querySelectorAll('section[aria-label="Artifacts"] tbody tr').length === 4, 'the four results');
  return atlas;
}
const watch = async (view: Atlas) => {
  await view.click('button', /Watch these 4 results/);
  await view.until(() => document.querySelector('section[aria-label="Playlist"]') !== null, 'the playlist');
};
const items = () => [...document.querySelectorAll<HTMLElement>('section[aria-label="Playlist"] li[data-entry]')];
const itemOf = (title: string) => items().find((item) => item.textContent!.includes(title))!;
const player = () => document.querySelector<HTMLVideoElement>('video[data-playing]');
const text = () => document.body.textContent ?? '';
const press = (label: string | RegExp) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => (typeof label === 'string' ? item.textContent?.trim() === label : label.test(item.textContent ?? '')))!;

test('Watch lists every result of the filtered set with its outcome, failures included, and says what has no recording', async () => {
  const view = await open();
  await watch(view);
  expect(items()).toHaveLength(4);
  const summary = document.querySelector('[data-playlist-summary]')!.textContent!;
  expect(summary).toContain('4 results: 2 with a recording');
  expect(summary).toContain('1 API only');
  expect(summary).toContain('1 with no recording');
  expect(summary).toContain('1 failed result kept in the playlist');
  expect(itemOf('A declined card').getAttribute('data-status')).toBe('failed');
  expect(itemOf('A declined card').getAttribute('data-recording-state')).toBe('playable');
  expect(itemOf('Email a receipt').getAttribute('data-recording-state')).toBe('none');
  expect(itemOf('Quote an order').getAttribute('data-recording-state')).toBe('api-only');
  // The order is the order of the table the set came from.
  const table = [...document.querySelectorAll('table[data-artifacts] tbody tr')].map((row) => row.querySelector('a')?.textContent);
  expect(items().map((item) => item.querySelector('button')!.textContent!.split(/Passed|Failed/)[0])).toEqual(table);
});

test('only the current clip is read: one player, metadata-only preload, and a result without a recording shows its state, not a player', async () => {
  const view = await open();
  await watch(view);
  await view.until(() => player() !== null, 'the first player');
  expect(document.querySelectorAll('video')).toHaveLength(1);
  expect(player()!.getAttribute('preload')).toBe('metadata');
  // Only the one clip's evidence was read; the other results' were not.
  expect(view.requests.filter((url: string) => url.includes('/evidence/detail/'))).toHaveLength(1);
  await act(async () => itemOf('Email a receipt').querySelector('button')!.click());
  await view.until(() => document.querySelector('[data-recording-state="none"][role="status"]') !== null, 'the no-recording state');
  expect(document.querySelectorAll('video')).toHaveLength(0);
  expect(text()).toContain('No recording was published for this result, so it is not demonstrated by one.');
  await act(async () => itemOf('Quote an order').querySelector('button')!.click());
  await view.until(() => text().includes('there is no screen to watch'), 'the API-only state');
});

test('selecting another clip leaves one player and returning resumes where the earlier clip stopped', async () => {
  const view = await open();
  await watch(view);
  await view.until(() => player() !== null, 'the first player');
  const first = player()!.getAttribute('aria-label');
  const firstTitle = document.querySelector('section[data-clip] h3')!.textContent!;
  const element = player()!;
  Object.defineProperty(element, 'duration', { value: 60, configurable: true });
  await act(async () => {
    element.currentTime = 12;
    element.dispatchEvent(new Event('timeupdate'));
  });
  const other = items().find((item) => item.getAttribute('data-recording-state') === 'playable' && !item.querySelector('button[aria-current]'))!;
  await act(async () => other.querySelector('button')!.click());
  await view.until(() => player() !== null && player()!.getAttribute('aria-label') !== first, 'the second clip');
  expect(document.querySelectorAll('video')).toHaveLength(1);
  await act(async () => itemOf(firstTitle).querySelector('button')!.click());
  await view.until(() => player()?.getAttribute('aria-label') === first, 'the first clip again');
  Object.defineProperty(player()!, 'duration', { value: 60, configurable: true });
  await act(async () => void player()!.dispatchEvent(new Event('loadedmetadata')));
  expect(player()!.currentTime).toBe(12);
});

test('previous and next skip results with nothing to play, and a failed clip stays listed with retry and next', async () => {
  const view = await open();
  await watch(view);
  await view.until(() => player() !== null, 'the player');
  const title = () => document.querySelector('section[data-clip] h3')!.textContent;
  const startedAt = title();
  expect(press(/Previous clip/).disabled).toBe(true);
  await act(async () => press(/Next clip/).click());
  await view.until(() => title() !== startedAt && player() !== null, 'the next clip');
  expect(press(/Next clip/).disabled).toBe(true);
  // This clip cannot be loaded.
  await act(async () => void player()!.dispatchEvent(new Event('error')));
  await view.until(() => document.querySelector('[data-clip-failed]') !== null, 'the failure');
  expect(text()).toContain('It stays in the playlist');
  expect(itemOf(title()!).textContent).toContain('Could not be loaded');
  expect(press('Retry')).toBeDefined();
  expect(press(/Previous clip/).disabled).toBe(false);
  await act(async () => press('Retry').click());
  await view.until(() => document.querySelector('[data-clip-failed]') === null && player() !== null, 'the player again');
  expect(items()).toHaveLength(4);
});

test('a clip that ends advances to the next playable one, and the browser blocking autoplay offers Play', async () => {
  const view = await open();
  await watch(view);
  await view.until(() => player() !== null, 'the player');
  const first = player()!.getAttribute('aria-label');
  blockPlay = true;
  await act(async () => void player()!.dispatchEvent(new Event('ended')));
  await view.until(() => player() !== null && player()!.getAttribute('aria-label') !== first, 'the advance');
  await act(async () => void player()!.dispatchEvent(new Event('loadedmetadata')));
  await view.until(() => document.querySelector('[data-autoplay-blocked]') !== null, 'the blocked-autoplay notice');
  blockPlay = false;
  const before = plays.length;
  await act(async () => press('Play').click());
  expect(plays.length).toBe(before + 1);
  await view.until(() => document.querySelector('[data-autoplay-blocked]') === null, 'the notice gone');
});

test('speed, repeat and advance are labelled controls, and a clip that ends replays when repeating without advancing', async () => {
  const view = await open();
  await watch(view);
  await view.until(() => player() !== null, 'the player');
  const speed = document.querySelector<HTMLSelectElement>('select')!;
  expect(document.querySelector(`label[for="${speed.id}"]`)!.textContent).toBe('Playback speed');
  await act(async () => {
    speed.value = '1.5';
    speed.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await view.until(() => player()!.playbackRate === 1.5, 'the speed applied');
  const labelled = [...document.querySelectorAll('input[type="checkbox"]')].map((box) => box.closest('div')!.textContent);
  expect(labelled.some((label) => label!.includes('Play the next clip when one ends'))).toBe(true);
  expect(labelled.some((label) => label!.includes('Repeat'))).toBe(true);
  const box = (name: string) => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((item) => item.closest('div')!.textContent!.includes(name))!;
  await act(async () => box('Play the next clip').click());
  await act(async () => box('Repeat').click());
  const first = player()!.getAttribute('aria-label');
  const before = plays.length;
  await act(async () => void player()!.dispatchEvent(new Event('ended')));
  expect(player()!.getAttribute('aria-label')).toBe(first);
  expect(plays.length).toBe(before + 1);
});

test('the scenario sits beside the player with its qualifications, captions and a link to developer details', async () => {
  const view = await open();
  await watch(view);
  await act(async () => itemOf('A declined card').querySelector('button')!.click());
  await view.until(() => player()?.getAttribute('aria-label') === 'Recording: decline.webm', 'the failing clip');
  await view.until(() => document.querySelector('track') !== null, 'the captions');
  expect(document.querySelector('track')!.getAttribute('kind')).toBe('captions');
  const clip = document.querySelector('section[data-clip]')!.textContent!;
  expect(clip).toContain('A declined card');
  expect(clip).toContain('Failed');
  expect(clip).toContain('card_declined was not shown');
  // The producer's qualifications are visible before playing, and the duration is not latency.
  expect(clip).toContain('Paced');
  expect(clip).toContain('Silent');
  expect(clip).toContain('Scripted dependencies');
  expect(clip).toContain('not production latency');
  expect(clip).toContain('Length of the recording: 4.0 s');
  expect(clip).toContain('Captions');
  // A passing clip lists its steps in words.
  await act(async () => itemOf('Pay with a card').querySelector('button')!.click());
  await view.until(() => text().includes('Given a card is on file'), 'the steps');
  const link = [...document.querySelectorAll<HTMLAnchorElement>('section[data-clip] a')].find((anchor) => anchor.textContent === 'Developer details')!;
  expect(link.getAttribute('href')).toContain('layer=');
  await act(async () => link.click());
  await view.until(() => document.querySelector('section[aria-label="Playlist"]') === null, 'the playlist closed');
});

test('a run can be watched too, with its filtered results', async () => {
  const view = await open(`/?tab=runs&openRun=${encodeURIComponent(RUN(1))}`);
  await view.until(() => document.querySelector('section[aria-label^="Run "]') !== null && text().includes('Watch these 3 results'), 'the run');
  await view.click('button', /Watch these 3 results/);
  await view.until(() => items().length === 3, 'the run playlist');
  await view.until(() => player() !== null, 'the player');
  expect(itemOf('A declined card').getAttribute('data-status')).toBe('failed');
  expect(itemOf('Email a receipt').getAttribute('data-recording-state')).toBe('none');
});

test('an unselected clip shows the poster and length the catalog named, loaded lazily, without reading its evidence', async () => {
  const view = await open();
  await watch(view);
  await view.until(() => player() !== null, 'the first player');
  const declined = itemOf('A declined card');
  const poster = declined.querySelector<HTMLImageElement>('img[data-poster]')!;
  expect(poster).not.toBeNull();
  expect(poster.getAttribute('loading')).toBe('lazy');
  expect(poster.getAttribute('alt')).toBe('');
  expect(poster.getAttribute('src')).toContain('/blobs/attachments/');
  expect(declined.textContent).toContain('4.0 s recording');
  expect(declined.querySelector('button')!.getAttribute('aria-label')).toContain('4.0 s long');
  // A clip that declared neither shows neither, and says nothing it was not told.
  expect(itemOf('Pay with a card').querySelector('img')).toBeNull();
  expect(itemOf('Pay with a card').textContent).not.toContain('recording ·');
  expect(itemOf('Email a receipt').querySelector('img')).toBeNull();
  // Still one evidence read for the clip on screen, however many entries carry hints, and one player.
  expect(view.requests.filter((url: string) => url.includes('/evidence/detail/'))).toHaveLength(1);
  expect(document.querySelectorAll('video')).toHaveLength(1);
});

test('the open playlist and its clip are in the address: a link restores them, Back and closing remove them', async () => {
  const view = await open();
  expect(view.router.state.location.search.watch).toBeUndefined();
  await watch(view);
  await view.until(() => player() !== null, 'the first player');
  const searched = () => view.router.state.location.search as { watch?: boolean; watchClip?: string };
  await view.until(() => searched().watch === true && typeof searched().watchClip === 'string', 'the playlist in the address');
  const playing = () => document.querySelector('section[data-clip]')!.getAttribute('data-clip')!;
  expect(searched().watchClip).toBe(playing());
  // Choosing another clip moves the address along, without adding a history entry.
  const before = view.router.history.length;
  await act(async () => itemOf('A declined card').querySelector('button')!.click());
  await view.until(() => playing() === itemOf('A declined card').getAttribute('data-entry'), 'the declined clip');
  await view.until(() => searched().watchClip === playing(), 'the clip in the address');
  expect(view.router.history.length).toBe(before);
  const link = `/?tab=artifacts&watch=true&watchClip=${encodeURIComponent(playing())}`;
  const clip = playing();
  // Closing removes both.
  await act(async () => document.querySelector<HTMLButtonElement>('.mantine-Modal-close')!.click());
  await view.until(() => document.querySelector('section[aria-label="Playlist"]') === null, 'the playlist closed');
  expect(searched().watch).toBeUndefined();
  expect(searched().watchClip).toBeUndefined();
  // A link restores the playlist on the same clip.
  await view.go(link);
  await view.until(() => document.querySelector('section[aria-label="Playlist"]') !== null && player() !== null, 'the playlist restored');
  expect(playing()).toBe(clip);
  expect(document.querySelector('section[data-clip] h3')!.textContent).toBe('A declined card');
  // A clip the set no longer holds falls back to the first watchable one, and the address says which.
  await act(async () => document.querySelector<HTMLButtonElement>('.mantine-Modal-close')!.click());
  await view.go('/?tab=artifacts&watch=true&watchClip=gone');
  await view.until(() => player() !== null, 'the fallback clip');
  await view.until(() => searched().watchClip === playing() && playing() !== 'gone', 'the address names the clip shown');
  // Back from an opened playlist closes it.
  await act(async () => document.querySelector<HTMLButtonElement>('.mantine-Modal-close')!.click());
  await view.click('button', /Watch these 4 results/);
  await view.until(() => document.querySelector('section[aria-label="Playlist"]') !== null, 'the playlist');
  await act(async () => view.router.history.back());
  await view.until(() => document.querySelector('section[aria-label="Playlist"]') === null, 'closed by Back');
});

test('an opened run restores its playlist from the address, and developer details leave it', async () => {
  const run = encodeURIComponent(RUN(1));
  const view = await open(`/?tab=runs&openRun=${run}&watch=true`);
  await view.until(() => document.querySelector('section[aria-label="Playlist"]') !== null && items().length === 3, 'the run playlist from the address');
  await view.until(() => player() !== null, 'the player');
  const link = [...document.querySelectorAll<HTMLAnchorElement>('section[data-clip] a')].find((anchor) => anchor.textContent === 'Developer details')!;
  await act(async () => link.click());
  await view.until(() => document.querySelector('section[aria-label="Playlist"]') === null, 'the playlist closed');
  const search = view.router.state.location.search as Record<string, unknown>;
  expect(search.watch).toBeUndefined();
  expect(search.watchClip).toBeUndefined();
  expect(search.test).toBeDefined();
});
