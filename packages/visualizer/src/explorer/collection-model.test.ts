import { describe, expect, it } from 'bun:test';

import { formatTimecode, parseTagsField, parseTimecode, sourceSpread } from './collection-model';

describe('review collection helpers', () => {
  it('reads a moment as seconds, minutes and seconds, or hours; empty is no time and a mistake is told apart', () => {
    expect(parseTimecode('75')).toBe(75_000);
    expect(parseTimecode('1:15')).toBe(75_000);
    expect(parseTimecode('1:02:03')).toBe(3_723_000);
    expect(parseTimecode('0:01.5')).toBe(1_500);
    expect(parseTimecode('  ')).toBeNull();
    for (const bad of ['abc', '1:xx', '-3', '1:2:3:4', '1::2']) expect(parseTimecode(bad)).toBeUndefined();
  });

  it('writes a moment the way it is read back', () => {
    expect(formatTimecode(75_000)).toBe('1:15');
    expect(formatTimecode(3_723_000)).toBe('1:02:03');
    expect(formatTimecode(0)).toBe('0:00');
    for (const ms of [0, 1_000, 59_000, 3_599_000, 7_200_000]) expect(parseTimecode(formatTimecode(ms))).toBe(ms);
  });

  it('counts distinct runs and layers, so entries from several executions never read as one', () => {
    const entry = (layer: string, run: string) => ({ id: layer, source: { layer, check: 'c' }, snapshot: { run } }) as never;
    expect(sourceSpread({ entries: [entry('a', 'r1'), entry('b', 'r2'), entry('c', 'r2')] })).toEqual({ runs: 2, layers: 3 });
    expect(sourceSpread({ entries: [] })).toEqual({ runs: 0, layers: 0 });
  });

  it('splits a tags field on commas and spaces', () => {
    expect(parseTagsField('demo, #wip  demo')).toEqual(['demo', '#wip']);
  });
});
