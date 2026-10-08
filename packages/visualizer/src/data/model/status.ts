import { ITEM_STATUSES, type ItemStatus, type StatusCounts } from './types';

export function emptyCounts(): StatusCounts {
  return { passed: 0, flaky: 0, failed: 0, 'not-reached': 0, 'not-yet-run': 0, 'spec-only': 0, total: 0 };
}

const SEVERITY: Record<ItemStatus, number> = {
  failed: 5,
  flaky: 4,
  passed: 3,
  'not-reached': 2,
  'not-yet-run': 1,
  'spec-only': 0
};

/**
 * One status for a group of items: a failure anywhere shows, then flakiness; a group counts as
 * passed when something in it passed and nothing failed.
 */
export function worstOf(statuses: readonly ItemStatus[], empty: ItemStatus): ItemStatus {
  if (statuses.length === 0) return empty;
  return statuses.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst));
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  passed: 'Working',
  flaky: 'Unreliable',
  failed: 'Broken',
  'not-reached': 'Not reached',
  'not-yet-run': 'Not run yet',
  'spec-only': 'Spec only'
};

export const STATUS_DESCRIPTION: Record<ItemStatus, string> = {
  passed: 'The app did what the spec says.',
  flaky: 'It worked only on a retry.',
  failed: 'The app did not do what the spec says.',
  'not-reached': 'The run tried, but no path got here.',
  'not-yet-run': 'This run did not cover it.',
  'spec-only': 'No run has checked it yet.'
};

export { ITEM_STATUSES };
