import { describe, expect, it } from 'vitest';
import { loadFixture } from '../data/testing/load-fixture';
import { ancestors } from '../map/navigation';
import { journeySlides } from './journey-media';

describe('journey media sequence', () => {
  it('interleaves starting screens, available recordings and resulting screens in event order', () => {
    const { view } = loadFixture('full');
    for (const journey of view.journeys) {
      const slides = journeySlides(view, journey);
      expect(slides[0]?.id).toBe('start');
      expect(slides.filter((slide) => slide.kind === 'screens')).toHaveLength(journey.steps.length + 1);
      journey.steps.forEach((step, index) => {
        const videos = [...new Set(step.transitionIds)].filter((id) => view.transitions.get(id)?.result?.clip.state === 'available');
        expect(slides.filter((slide) => slide.step === index && slide.id !== 'start').map((slide) => slide.kind)).toEqual([
          ...videos.map(() => 'video'),
          'screens'
        ]);
      });
      expect(new Set(slides.map((slide) => slide.id)).size).toBe(slides.length);
    }
  });
  it.each(['spec-only', 'partial', 'failures'])('keeps every traced step and never includes unavailable clips in %s', (fixture) => {
    const { view } = loadFixture(fixture);
    for (const journey of view.journeys) {
      const slides = journeySlides(view, journey);
      expect(slides.filter((slide) => slide.kind === 'screens')).toHaveLength(journey.steps.length + 1);
      for (const slide of slides)
        if (slide.kind === 'video') {
          expect(slide.clip.state).toBe('available');
          expect(slide.clip.src).toBeTruthy();
        }
    }
  });
  it('retains parallel leaves while omitting their containers', () => {
    const { view } = loadFixture('full');
    const journey = view.journeys.find((j) => j.name === 'Orders a drink and pays by card')!;
    const slides = journeySlides(view, journey);
    const parallel = slides.filter((s) => s.kind === 'screens' && s.frames.length > 1);
    expect(parallel.length).toBeGreaterThan(0);
    for (const slide of parallel) {
      if (slide.kind !== 'screens') continue;
      for (const frame of slide.frames)
        expect(slide.frames.some((other) => other !== frame && ancestors(view, other.state.name).includes(frame.state.name))).toBe(false);
    }
  });
  it('uses a screenshot captured on this journey rather than a different path', () => {
    const { view } = loadFixture('full');
    const journey = view.journeys[0]!;
    const name = journey.steps[0]!.from.at(-1)!;
    const state = view.states.get(name)!;
    const specific = { state: 'available' as const, full: '/specific.webp', thumb: null };
    state.result = {
      ...state.result!,
      screenshot: { state: 'available', full: '/other.webp', thumb: null },
      screenshotsByPath: [{ path: { id: journey.runPaths[0]!.id, name: journey.name }, image: specific }]
    };
    const first = journeySlides(view, journey)[0]!;
    expect(first.kind).toBe('screens');
    if (first.kind === 'screens') expect(first.frames.find((frame) => frame.state.name === name)?.image).toBe(specific);
  });
});
