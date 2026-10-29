import { describe, expect, test } from 'bun:test';

import { activeIndex, alignStep, clock, mediaTimingOf, pausedMs, UNALIGNED } from './media-timing';

const video = (media: unknown) => ({ extensions: { 'atlas.media': media } });

describe('what a recording declares about its clock', () => {
  test('no declaration is no timing, never a timing that starts with the check', () => {
    expect(mediaTimingOf({})).toBeUndefined();
    expect(mediaTimingOf({ extensions: { 'com.example': {} } })).toBeUndefined();
    expect(alignStep({ id: 'a', offsetMs: 0 }, undefined, 5000)).toEqual({ state: 'unavailable', reason: UNALIGNED.noTiming });
  });

  test('a declaration that cannot be read as a whole places nothing', () => {
    for (const bad of [
      'text',
      [],
      { checkStartMs: '1000' },
      { checkStartMs: 0, pauses: [{ atMs: 10 }] },
      { checkStartMs: 0, pauses: 'long' },
      { checkStartMs: 0, marks: [{ step: 'a' }] }
    ]) {
      const timing = mediaTimingOf(video(bad));
      expect(timing?.problem).toBeDefined();
      const aligned = alignStep({ id: 'a', offsetMs: 1 }, timing, undefined);
      expect(aligned.state).toBe('unavailable');
    }
  });

  test('a declaration without an origin places only the steps it marks', () => {
    const timing = mediaTimingOf(video({ marks: [{ step: 'a', mediaMs: 700 }] }));
    expect(alignStep({ id: 'a', offsetMs: 5 }, timing, undefined)).toEqual({ state: 'aligned', mediaMs: 700, source: 'mark', pausedMs: 0 });
    expect(alignStep({ id: 'b', offsetMs: 5 }, timing, undefined)).toEqual({ state: 'unavailable', reason: UNALIGNED.noOrigin });
  });
});

describe('placing a step in a recording', () => {
  const timing = mediaTimingOf(video({ checkStartMs: 1200, pauses: [{ atMs: 2000, durationMs: 500 }, { atMs: 500, durationMs: 300, reason: 'title' }] }));

  test('the recording starts before the check: the step is the origin plus its offset', () => {
    expect(alignStep({ offsetMs: 0 }, timing, 20_000)).toMatchObject({ state: 'aligned', mediaMs: 1200, source: 'offset' });
    expect(alignStep({ offsetMs: 100 }, timing, 20_000)).toMatchObject({ mediaMs: 1300 });
  });

  test('delays put into the recording move the steps after them and not the ones before', () => {
    expect(alignStep({ offsetMs: 499 }, timing, undefined)).toMatchObject({ mediaMs: 1699, pausedMs: 0 });
    expect(alignStep({ offsetMs: 500 }, timing, undefined)).toMatchObject({ mediaMs: 2000, pausedMs: 300 });
    expect(alignStep({ offsetMs: 2000 }, timing, undefined)).toMatchObject({ mediaMs: 4000, pausedMs: 800 });
    expect(pausedMs(timing)).toBe(800);
    expect(timing!.pauses.map((pause) => pause.reason)).toEqual(['title', undefined]);
  });

  test('a mark states the moment outright and wins over the offset', () => {
    const marked = mediaTimingOf(video({ checkStartMs: 0, marks: [{ step: 'a', mediaMs: 9 }] }));
    expect(alignStep({ id: 'a', offsetMs: 5000 }, marked, undefined)).toMatchObject({ mediaMs: 9, source: 'mark' });
  });

  test('a step with no offset, before the start, or after the end is unavailable and is never clamped', () => {
    expect(alignStep({ id: 'a' }, timing, undefined)).toEqual({ state: 'unavailable', reason: UNALIGNED.noOffset });
    const early = mediaTimingOf(video({ checkStartMs: -500 }));
    expect(alignStep({ offsetMs: 100 }, early, undefined)).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('before the recording starts') });
    expect(alignStep({ offsetMs: 100 }, early, undefined)).not.toHaveProperty('mediaMs');
    expect(alignStep({ offsetMs: 9000 }, timing, 5000)).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('after the recording ends') });
    // A length that is not known never excludes a moment.
    expect(alignStep({ offsetMs: 9000 }, timing, undefined).state).toBe('aligned');
  });
});

describe('the step playing', () => {
  const placed = [[0, 1000], [1, 3000], [2, 3000], [3, 6000]] as const;
  test('is the latest step started, the innermost of several that started together, and none before the first', () => {
    expect(activeIndex(placed, 500)).toBeNull();
    expect(activeIndex(placed, 1000)).toBe(0);
    expect(activeIndex(placed, 2999)).toBe(0);
    expect(activeIndex(placed, 3000)).toBe(2);
    expect(activeIndex(placed, 99_000)).toBe(3);
    expect(activeIndex([], 10)).toBeNull();
  });

  test('a position reads as minutes, seconds and tenths', () => {
    expect(clock(0)).toBe('0:00.0');
    expect(clock(4250)).toBe('0:04.3');
    expect(clock(61_000)).toBe('1:01.0');
  });
});
