import { describe, expect, it } from 'bun:test';

import { fileName, folderOf, kindOfFile, outlinePath, resolveSpec, similarSpecs, specFile, specKind } from './spec-kind';

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

  it('reads a link to a spec by any form of its path and finds the listed spec it means', () => {
    expect(specFile('./auth/sign-in.feature')).toBe('auth/sign-in.feature');
    expect(specFile('/specs/auth\\sign-in.feature')).toBe('auth/sign-in.feature');
    const listed = ['auth/sign-in.feature', 'billing/Pay.feature', 'billing/pay-later.feature', 'a/x.feature', 'b/x.feature'];
    expect(resolveSpec('auth/sign-in.feature', listed)).toBe('auth/sign-in.feature');
    expect(resolveSpec('Auth/Sign-In.feature', listed)).toBe('auth/sign-in.feature');
    expect(resolveSpec('sign-in.feature', listed)).toBe('auth/sign-in.feature');
    // Two candidates, or none, leave the link as written.
    expect(resolveSpec('x.feature', listed)).toBe('x.feature');
    expect(resolveSpec('nothing.feature', listed)).toBe('nothing.feature');
    expect(similarSpecs('other/pay.feature', listed)).toEqual(['billing/Pay.feature']);
  });
});
