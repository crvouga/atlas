import { describe, expect, it } from 'vitest';
import { SpecsSearch } from './specs-search';

describe('specs search parameters', () => {
  it('normalizes numeric query values to strings', () => {
    expect(SpecsSearch.parse({ moment: 2, tab: 'evidence' })).toEqual({ moment: '2', tab: 'evidence' });
  });
});
