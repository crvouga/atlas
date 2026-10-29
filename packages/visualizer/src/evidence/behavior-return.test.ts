import { beforeEach, expect, test } from 'bun:test';

import { forgetReturn, recallReturn, rememberReturn, scopeKey } from './behavior-return';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key)
  };
});

test('a remembered point comes back only to the scope it was taken in', () => {
  const scope = scopeKey({ q: 'refund', coverage: 'failed' });
  rememberReturn({ scope, scrollY: 480, shown: 80, focus: 'a.feature#Refund' });
  expect(recallReturn(scope)).toEqual({ scope, scrollY: 480, shown: 80, focus: 'a.feature#Refund' });
  // Another search, or none, never gets the scroll of this one.
  expect(recallReturn(scopeKey({ q: 'pay' }))).toBeNull();
  expect(recallReturn(scopeKey({}))).toBeNull();
});

test('reading a point does not forget it until it is given back', () => {
  const scope = scopeKey({});
  rememberReturn({ scope, scrollY: 10, shown: 40, focus: null });
  expect(recallReturn(scope)).not.toBeNull();
  expect(recallReturn(scope)).not.toBeNull();
  forgetReturn();
  expect(recallReturn(scope)).toBeNull();
});

test('unreadable or unavailable storage only means nothing is restored', () => {
  store.set('atlas-behaviors-return', '{not json');
  expect(recallReturn(scopeKey({}))).toBeNull();
  store.set('atlas-behaviors-return', JSON.stringify({ scope: scopeKey({}), scrollY: 'far' }));
  expect(recallReturn(scopeKey({}))).toBeNull();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = undefined;
  expect(() => rememberReturn({ scope: 's', scrollY: 1, shown: 1, focus: null })).not.toThrow();
  expect(recallReturn('s')).toBeNull();
});
