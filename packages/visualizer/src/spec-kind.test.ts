import { describe, expect, it } from 'bun:test';

import { fileName, folderOf, kindOfFile, outlinePath, specFile, specKind } from './spec-kind';

describe('spec kinds', () => {
  it('gives each notation its own tab and leaves statecharts and notes to the map', () => {
    expect(kindOfFile('auth/sign-in.feature')?.id).toBe('gherkin');
    expect(kindOfFile('spaces/hosting.qnt')?.id).toBe('quint');
    expect(kindOfFile('billing/access.dmn')?.id).toBe('dmn');
    expect(kindOfFile('room/seats.als')?.id).toBe('alloy');
    expect(kindOfFile('health/api.openslo.yaml')?.id).toBe('openslo');
    expect(kindOfFile('product.machine.yaml')).toBeNull();
    expect(kindOfFile('journeys.yaml')).toBeNull();
    expect(kindOfFile('known-issues.md')).toBeNull();
    expect(specKind('quint')?.many).toBe('models');
    expect(specKind('unknown')).toBeNull();
  });

  it('names a spec the way reports do, whichever form it starts from', () => {
    expect(outlinePath('auth/sign-in.feature')).toBe('specs/auth/sign-in.feature');
    expect(outlinePath('specs/auth/sign-in.feature')).toBe('specs/auth/sign-in.feature');
    expect(specFile('specs/auth/sign-in.feature')).toBe('auth/sign-in.feature');
    expect(fileName('auth/sign-in.feature')).toBe('sign-in.feature');
    expect(folderOf('auth/sign-in.feature')).toBe('auth');
    expect(folderOf('atlas.yaml')).toBe('');
  });
});
