import { describe, expect, it } from 'vitest';
import { inspectorFor, sameSpecFile } from './spec-kind';

describe('spec inspectors', () => {
  it('keeps each spec kind on its own inspector', () => {
    expect(inspectorFor('auth/sign-in.feature')).toBe('gherkin');
    expect(inspectorFor('specs/auth/outside-accounts.qnt')).toBe('quint');
    expect(inspectorFor('coffee/ordering/machine.yaml')).toBe('statechart');
    expect(inspectorFor('coffee/ordering/checkout.scxml')).toBe('statechart');
    expect(inspectorFor('notes/known-issues.md')).toBe('statechart');
  });

  it('matches a recorded check to its own file only', () => {
    expect(sameSpecFile('specs/auth/sign-in.feature', 'auth/sign-in.feature')).toBe(true);
    expect(sameSpecFile('specs/auth/sign-in.feature', 'auth/outside-accounts.qnt')).toBe(false);
  });
});
