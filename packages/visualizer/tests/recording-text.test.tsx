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

let atlas: Atlas | null = null;
beforeEach(() => localStorage.clear());
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const bytes = (text: string) => new TextEncoder().encode(text);
const movie = (name: string, extra: Record<string, unknown> = {}) => ({ name, contentType: 'video/webm', data: bytes(name), ...extra });
const cue = (from: string, to: string, text: string) => `${from} --> ${to}\n${text}\n`;
const vtt = (...cues: string[]) => `WEBVTT\n\n${cues.join('\n')}`;
const SPEC = 'specs/checkout/pay.feature';
const base = { specs: [{ path: SPEC, domain: 'checkout', kind: 'feature', title: 'Pay' }], producer: 'web', environment: 'desktop-web', branch: 'main', sha: 'a'.repeat(40), runUrl: 'https://github.com/acme/app/actions/runs/1', recordedAtMs: 1_000 };

/**
 * Seven results: spoken words, screen text only, a retried one whose attempts differ, a recording with no text, a silent
 * one, one whose text could not be indexed, and one whose text the producer left out.
 */
async function seed() {
  const store = memoryStore();
  await publishChecks(store, {
    ...base,
    checks: [
      {
        id: 'spoken', title: 'Confirm the address', specPath: SPEC, status: 'passed',
        attachments: [
          movie('spoken.webm', { id: 'v' }),
          { name: 'spoken.vtt', id: 't', contentType: 'text/vtt', role: 'transcript', extensions: { 'atlas.text': { recording: 'v' } }, data: bytes(vtt(cue('00:00:01.000', '00:00:03.500', 'Please confirm the delivery address'), cue('00:00:05.000', '00:00:06.000', 'Thank you'))) }
        ]
      },
      {
        id: 'screen', title: 'Show the basket', specPath: SPEC, status: 'passed',
        attachments: [
          movie('screen.webm'),
          { name: 'screen.json', contentType: 'application/json', role: 'ocr', extensions: { 'atlas.text': { generated: true, generator: 'ocr-tool' } }, data: bytes(JSON.stringify({ segments: [{ start: 2, end: 4, text: 'Subtotal 12.50 and free shipping', confidence: 0.62 }] })) }
        ]
      },
      {
        id: 'retry', title: 'Pay by card', specPath: SPEC, status: 'passed',
        attempts: [
          { index: 0, status: 'failed', attachments: [movie('first.webm'), { name: 'first.vtt', contentType: 'text/vtt', data: bytes(vtt(cue('00:00:09.000', '00:00:10.000', 'card declined banner'))) }] },
          { index: 1, status: 'passed', attachments: [movie('second.webm'), { name: 'second.vtt', contentType: 'text/vtt', data: bytes(vtt(cue('00:00:04.000', '00:00:05.000', 'payment accepted banner'))) }] }
        ]
      },
      { id: 'untexted', title: 'Plain recording', specPath: SPEC, status: 'passed', attachments: [movie('plain.webm')] },
      { id: 'silent', title: 'Silent recording', specPath: SPEC, status: 'passed', attachments: [movie('silent.webm', { scope: { audioCaptured: false } })] },
      {
        id: 'broken', title: 'Broken transcript', specPath: SPEC, status: 'failed', detail: 'boom',
        attachments: [movie('broken.webm'), { name: 'broken.vtt', contentType: 'text/vtt', extensions: { 'atlas.text': { state: 'failed', reason: 'The recognizer crashed.' } }, data: bytes('WEBVTT') }]
      },
      {
        id: 'withheld', title: 'Withheld transcript', specPath: SPEC, status: 'passed',
        attachments: [movie('withheld.webm'), { name: 'withheld.vtt', contentType: 'text/vtt', omitted: 'not-allowed' }]
      },
      {
        id: 'untimed', title: 'Untimed transcript', specPath: SPEC, status: 'passed',
        attachments: [movie('untimed.webm'), { name: 'untimed.vtt', contentType: 'text/vtt', data: bytes('WEBVTT\n\nlater --> sooner\nThe courier left the parcel at the side door') }]
      }
    ]
  });
  return store;
}

async function open(inside: string, intercept?: (path: string) => Response | undefined) {
  atlas = await openAtlas({ at: `/?tab=artifacts&inside=${encodeURIComponent(inside)}`, specs: {}, deps: { localStore: await seed() }, ...(intercept ? { intercept } : {}) });
  await atlas.until(() => document.querySelector('[data-recording-text]') !== null, 'the search');
  await atlas.until(() => document.querySelector('[data-reading]')?.textContent?.startsWith('Searched') === true, 'the reading to finish');
  return atlas;
}
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-recording-matches] tbody tr')];
const text = () => document.body.textContent ?? '';

test('a phrase finds the recording with its time range, owner and the result\'s own outcome', async () => {
  await open('delivery address');
  expect(rows()).toHaveLength(1);
  const row = rows()[0]!;
  expect(row.textContent).toContain('Please confirm the delivery address');
  expect(row.textContent).toContain('Spoken (transcript)');
  expect(row.querySelector('[data-time]')!.textContent).toBe('0:01–0:03');
  expect(row.textContent).toContain('Confirm the address');
  expect(row.textContent).toContain('spoken.webm');
  expect(row.textContent).toContain('Passed');
  expect(document.querySelector('[data-match-count]')!.textContent).toContain('does not change it');
});

test('screen text is identified as such, and generated text is labelled with its generator and confidence', async () => {
  await open('free shipping');
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.getAttribute('data-source-kind')).toBe('screen');
  expect(rows()[0]!.textContent).toContain('On screen (OCR)');
  expect(rows()[0]!.querySelector('[data-generated]')!.textContent).toBe('Generated by ocr-tool, confidence 62%. It may contain errors.');
  // The scenario title has none of these words.
  expect(rows()[0]!.textContent).toContain('Show the basket');
});

test('a misspelled query matches and the result shows the words as indexed', async () => {
  await open('delivry adress');
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.textContent).toContain('Please confirm the delivery address');
  expect(rows()[0]!.querySelector('[data-why]')!.textContent).toBe('Close spelling of the indexed words');
  expect(text()).not.toContain('delivry adress”');
});

test('recordings without text, silent ones and unreadable text are told apart from a searched recording with no match', async () => {
  await open('refund');
  expect(rows()).toHaveLength(0);
  const none = document.querySelector('[data-no-match]')!.textContent!;
  expect(none).toContain('No indexed text matches.');
  expect(none).toContain('not searched');
  await atlas!.click('button', /Recordings that were not searched/);
  const states = [...document.querySelectorAll<HTMLElement>('[data-unsearched]')].map((item) => [item.textContent!.replace(/\s+/g, ' '), item.getAttribute('data-unsearched')] as const);
  const stateOf = (title: string) => states.find(([content]) => content.includes(title))?.[1];
  expect(stateOf('Plain recording')).toBe('not-indexed');
  expect(stateOf('Silent recording')).toBe('unsupported');
  expect(stateOf('Broken transcript')).toBe('failed');
  expect(states.find(([content]) => content.includes('Broken transcript'))![0]).toContain('The recognizer crashed.');
  expect(stateOf('Withheld transcript')).toBe('failed');
  expect(states.find(([content]) => content.includes('Withheld transcript'))![0]).toContain('left this file out (not-allowed)');
  // A searched recording is not in that list.
  expect(stateOf('Confirm the address')).toBeUndefined();
  expect(document.querySelector('[data-coverage]')!.textContent).toContain('Not indexed: 1');
});

test('a failed and a passing retry hold different words, and a result opens the exact attempt\'s video at that time', async () => {
  const view = await open('card declined');
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.textContent).toContain('Attempt 1 of 2 (failed)');
  expect(rows()[0]!.textContent).toContain('first.webm');
  await act(async () => void rows()[0]!.querySelector('button')!.click());
  await view.until(() => document.querySelector('video[data-playing]') !== null, 'the player');
  const player = document.querySelector<HTMLVideoElement>('video[data-playing]')!;
  expect(player.getAttribute('aria-label')).toContain('first.webm');
  Object.defineProperty(player, 'duration', { value: 60, configurable: true });
  await act(async () => void player.dispatchEvent(new Event('loadedmetadata')));
  expect(player.currentTime).toBe(9);
  expect(document.querySelector('[data-found-moment]')!.textContent).toContain('Attempt 1 of 2 (failed)');
  expect(document.querySelector('[data-found-moment]')!.textContent).toContain('Indexed text: card declined banner');
  expect(document.querySelector('[data-seek-unavailable]')).toBeNull();
});

test('the second attempt\'s words open the second attempt\'s video', async () => {
  const view = await open('payment accepted');
  expect(rows()[0]!.textContent).toContain('Attempt 2 of 2 (passed)');
  await act(async () => void rows()[0]!.querySelector('button')!.click());
  await view.until(() => document.querySelector('video[data-playing]') !== null, 'the player');
  expect(document.querySelector('video[data-playing]')!.getAttribute('aria-label')).toContain('second.webm');
});

test('without a usable time the recording is offered and the missing seek is explained, not guessed', async () => {
  const view = await open('courier parcel');
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.querySelector('[data-time]')!.textContent).toBe('Time unusable');
  expect(rows()[0]!.querySelector('button')!.textContent).toBe('Open recording');
  await act(async () => void rows()[0]!.querySelector('button')!.click());
  await view.until(() => document.querySelector('video[data-playing]') !== null, 'the player');
  const player = document.querySelector<HTMLVideoElement>('video[data-playing]')!;
  Object.defineProperty(player, 'duration', { value: 60, configurable: true });
  await act(async () => void player.dispatchEvent(new Event('loadedmetadata')));
  expect(player.currentTime).toBe(0);
  expect(document.querySelector('[data-seek-unavailable]')!.textContent).toContain('Seeking is unavailable');
});

test('text the viewer may not read is not searched, counted or shown, and is reported as not searched', async () => {
  // The server refuses the transcript of one result, as an access rule would.
  const digest = await crypto.subtle.digest('SHA-256', bytes(vtt(cue('00:00:01.000', '00:00:03.500', 'Please confirm the delivery address'), cue('00:00:05.000', '00:00:06.000', 'Thank you'))));
  const sha = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const view = await open('delivery address', (path) => (path.includes('/blobs/') && path.endsWith(sha) ? new Response('forbidden', { status: 403 }) : undefined));
  expect(rows()).toHaveLength(0);
  expect(document.querySelector('[data-match-count]')).toBeNull();
  expect(text()).not.toContain('Please confirm the delivery address');
  expect(view.requests.some((url) => url.endsWith(sha))).toBe(true);
  await view.click('button', /Recordings that were not searched/);
  const item = [...document.querySelectorAll<HTMLElement>('[data-unsearched]')].find((entry) => entry.textContent!.includes('Confirm the address'))!;
  expect(item.getAttribute('data-unsearched')).toBe('failed');
  expect(item.textContent).toContain('You are not permitted to read this');
});

test('nothing is read from the recordings until words are typed', async () => {
  atlas = await openAtlas({ at: '/?tab=artifacts', specs: {}, deps: { localStore: await seed() } });
  await atlas.until(() => document.querySelector('[data-recording-text]') !== null, 'the search');
  expect(text()).toContain('Nothing is read from the recordings until you do');
  expect(atlas.requests.filter((url) => url.includes('/evidence/detail/') || url.includes('/blobs/'))).toHaveLength(0);
});
