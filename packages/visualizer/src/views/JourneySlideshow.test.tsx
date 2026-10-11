// @vitest-environment happy-dom
import * as Dialog from '@radix-ui/react-dialog';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadFixture } from '../data/testing/load-fixture';
import { JourneySlideshow } from './JourneySlideshow';
import { journeySlides } from './journey-media';

const { view } = loadFixture('full');
const journey = view.journeys.find((j) => j.name === 'Orders a drink and pays by card')!;
const slides = journeySlides(view, journey);
let root: Root;
let container: HTMLDivElement;
const onStep = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  onStep.mockClear();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('pause'));
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function mount(fixtureView = view, fixtureJourney = journey) {
  await act(async () =>
    root.render(
      <Dialog.Root open>
        <JourneySlideshow view={fixtureView} journey={fixtureJourney} onStep={onStep} onClose={vi.fn()} />
      </Dialog.Root>
    )
  );
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const position = () => document.querySelector('[class*="counter"]')?.textContent;
const video = () => document.querySelector('video')!;

it('chains screenshots and recordings, waits for video completion, and mounts one video at a time', async () => {
  await mount();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Pause slideshow');
  expect(position()).toBe(`1 / ${slides.length}`);
  await advance(2500);
  expect(position()).toBe(`2 / ${slides.length}`);
  expect(document.querySelectorAll('video')).toHaveLength(1);
  expect(video().muted).toBe(true);
  const clip = video();
  await advance(30000);
  expect(video()).toBe(clip);
  expect(position()).toBe(`2 / ${slides.length}`);
  await act(async () => clip.dispatchEvent(new Event('ended')));
  expect(position()).toBe(`3 / ${slides.length}`);
  expect(document.querySelectorAll('video')).toHaveLength(0);
  await advance(2500);
  expect(position()).toBe(`4 / ${slides.length}`);
  expect(onStep).toHaveBeenLastCalledWith(1);
});
it('pauses and resumes screenshot timers and video without stale pause events stopping playback', async () => {
  await mount();
  await click('Pause slideshow');
  await advance(10000);
  expect(position()).toBe(`1 / ${slides.length}`);
  await click('Play slideshow');
  await advance(2500);
  await click('Pause slideshow');
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  await click('Play slideshow');
  expect(document.querySelector('button[aria-label="Pause slideshow"]')).not.toBeNull();
  await advance(10000);
  expect(position()).toBe(`2 / ${slides.length}`);
});
it('skips broken and stalled media without stopping the journey', async () => {
  await mount();
  await advance(2500);
  await act(async () => video().dispatchEvent(new Event('error')));
  expect(document.body.textContent).toContain('This recording could not be played');
  await advance(2500);
  expect(position()).toBe(`3 / ${slides.length}`);
  await advance(2500);
  expect(video()).not.toBeNull();
  await act(async () => video().dispatchEvent(new Event('waiting')));
  await advance(15000);
  expect(document.body.textContent).toContain('This recording could not be played');
  await advance(2500);
  expect(position()).toBe(`5 / ${slides.length}`);
});
it('recovers from an autoplay rejection with explicit playback', async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('Autoplay blocked'));
  await mount();
  await advance(2500);
  expect(document.body.textContent).toContain('Playback paused by the browser');
  expect(document.querySelector('button[aria-label="Play slideshow"]')).not.toBeNull();
  await click('Play slideshow');
  expect(document.querySelector('button[aria-label="Pause slideshow"]')).not.toBeNull();
});
it('seeks to a journey step, supports sound and loop, and replays at the end', async () => {
  await mount();
  await click('Sound off');
  await advance(2500);
  expect(video().muted).toBe(false);
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Slideshow step"]')!;
  await act(async () => {
    select.value = String(journey.steps.length - 1);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onStep).toHaveBeenLastCalledWith(journey.steps.length - 1);
  await click('Pause slideshow');
  while (!document.querySelector('button[aria-label="Next slide"]')!.hasAttribute('disabled')) await click('Next slide');
  await click('Play slideshow');
  await advance(2500);
  expect(document.body.textContent).toContain('Journey complete');
  await click('Play slideshow');
  expect(position()).toBe(`1 / ${slides.length}`);
  await click('Loop');
  await click('Pause slideshow');
  while (!document.querySelector('button[aria-label="Next slide"]')!.hasAttribute('disabled')) await click('Next slide');
  await click('Play slideshow');
  await advance(2500);
  expect(position()).toBe(`1 / ${slides.length}`);
});
it('plays spec-only placeholders and clears playback timers on close', async () => {
  const fixture = loadFixture('spec-only');
  await mount(fixture.view, fixture.view.journeys[0]!);
  expect(document.querySelector('video')).toBeNull();
  expect(document.querySelector('[data-variant="sketch"]')).not.toBeNull();
  await advance(2500);
  expect(position()).toContain('2 /');
  const calls = onStep.mock.calls.length;
  await act(async () => root.render(null));
  await advance(60000);
  expect(onStep).toHaveBeenCalledTimes(calls);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
