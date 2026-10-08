import { describe, expect, it } from 'vitest';

import { emptyCounts, worstOf } from './status';
import { ITEM_STATUSES, type ItemStatus } from './types';

describe('worstOf', () => {
  it.each<[ItemStatus[], ItemStatus, ItemStatus]>([
    [[], 'spec-only', 'spec-only'],
    [[], 'not-yet-run', 'not-yet-run'],
    [['passed'], 'not-yet-run', 'passed'],
    [['passed', 'failed', 'flaky'], 'not-yet-run', 'failed'],
    [['flaky', 'passed'], 'not-yet-run', 'flaky'],
    [['passed', 'not-reached', 'not-yet-run'], 'not-yet-run', 'passed'],
    [['not-reached', 'not-yet-run'], 'not-yet-run', 'not-reached'],
    [['not-yet-run', 'spec-only'], 'spec-only', 'not-yet-run'],
    [['spec-only', 'spec-only'], 'not-yet-run', 'spec-only'],
    [['not-reached', 'failed', 'not-yet-run'], 'not-yet-run', 'failed']
  ])('%j (empty: %s) is %s', (statuses, empty, expected) => {
    expect(worstOf(statuses, empty)).toBe(expected);
  });

  it('does not depend on order', () => {
    const statuses = [...ITEM_STATUSES];
    expect(worstOf(statuses, 'spec-only')).toBe(worstOf([...statuses].reverse(), 'spec-only'));
  });
});

describe('emptyCounts', () => {
  it('has a zero for every status and the total', () => {
    const counts = emptyCounts();
    expect(Object.keys(counts).sort()).toEqual([...ITEM_STATUSES, 'total'].sort());
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });
});
