import { describe, expect, test } from 'bun:test';

import { filterParams, parseArtifactFilter, usedFilters } from '../src/artifact-query';
import { runRecordings } from '../src/recording-receipt';

const counts = (extra: Partial<Record<'expected' | 'uploaded' | 'referenced' | 'skipped' | 'unresolved' | 'notApplicable', number>> = {}) => ({ expected: 0, uploaded: 0, referenced: 0, skipped: 0, unresolved: 0, notApplicable: 0, ...extra });

describe('the recording completeness of a run', () => {
  test('a run whose layers declared nothing claims nothing', () => {
    expect(runRecordings([])).toBeUndefined();
    expect(runRecordings([undefined, undefined])).toBeUndefined();
  });

  test('a gap always shows; a layer without a receipt keeps an otherwise complete run Unknown', () => {
    expect(runRecordings([counts({ expected: 2, uploaded: 2 })])).toMatchObject({ state: 'complete', expected: 2, published: 2 });
    expect(runRecordings([counts({ expected: 2, uploaded: 1, unresolved: 1 }), undefined])).toMatchObject({ state: 'incomplete', unresolved: 1, layersWithoutReceipt: 1 });
    expect(runRecordings([counts({ expected: 2, uploaded: 2 }), undefined])).toMatchObject({ state: 'unknown', layersWithoutReceipt: 1 });
    expect(runRecordings([counts({ notApplicable: 3 })])).toMatchObject({ state: 'none-expected', notApplicable: 3 });
    expect(runRecordings([counts({ expected: 1, referenced: 1 })])).toMatchObject({ state: 'complete', published: 1 });
  });
});

describe('the recordings filter in an address', () => {
  test('is read from and written to the address like every other dimension, and named when used', () => {
    const filter = parseArtifactFilter(new URLSearchParams('recordings=incomplete,unknown&outcome=passed'));
    expect(filter.recordings).toEqual(['incomplete', 'unknown']);
    expect(filterParams(filter).get('recordings')).toBe('incomplete,unknown');
    expect(usedFilters(filter)).toEqual(['outcome', 'recordings']);
  });
});
