import { afterEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import type { ObjectStore } from '@crvouga/atlas/reports/object-store';
import { act } from 'react';

import { setFinderOpen } from '../src/find/open';
import { memoryStore, openAtlas, type Atlas } from './atlas';

class FinderResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FinderResizeObserver as unknown as typeof ResizeObserver;

let atlas: Atlas | null = null;
afterEach(async () => {
  await act(async () => setFinderOpen(false));
  await atlas?.close();
  atlas = null;
});

const SPEC = 'specs/billing/pay-an-invoice.feature';
const PAY = { id: 'billing/pay', title: 'Pay an invoice', specPath: SPEC };
const KEY = JSON.stringify([PAY.specPath, PAY.id]);
const SHA = 'a'.repeat(40);

/** Desktop passes twice (the first time after a retry, the second published as two snapshots); the phone fails once. */
async function publish(store: ObjectStore) {
  const where = { sha: SHA, branch: 'main', runUrl: null };
  await publishChecks(store, { ...where, producer: 'web', environment: 'desktop-web', recordedAtMs: 100_000, run: { id: 'r1' }, specs: [{ path: SPEC, domain: 'billing', kind: 'feature', title: 'Pay an invoice', fingerprint: 'rev-2' }], checks: [{ ...PAY, status: 'passed', attempts: [{ index: 0, status: 'failed' }, { index: 1, status: 'passed' }] }] });
  await publishChecks(store, { ...where, producer: 'web', environment: 'desktop-web', recordedAtMs: 200_000, run: { id: 'r2' }, specs: [{ path: SPEC, domain: 'billing', kind: 'feature', title: 'Pay an invoice', fingerprint: 'rev-2' }], checks: [{ ...PAY, status: 'passed' }] });
  await publishChecks(store, { ...where, producer: 'web', environment: 'desktop-web', recordedAtMs: 201_000, run: { id: 'r2' }, specs: [{ path: SPEC, domain: 'billing', kind: 'feature', title: 'Pay an invoice', fingerprint: 'rev-2' }], checks: [{ ...PAY, status: 'passed', attempts: [{ index: 0, status: 'passed' }] }] });
  await publishChecks(store, { ...where, producer: 'web', environment: 'ios', recordedAtMs: 300_000, run: { id: 'r3' }, specs: [{ path: SPEC, domain: 'billing', kind: 'feature', title: 'Pay an invoice', fingerprint: 'rev-2' }], checks: [{ ...PAY, status: 'failed', detail: 'Keyboard covered the pay button' }] });
}

const section = () => document.querySelector<HTMLElement>('[aria-label="Reliability"]');
const denominator = () => [...document.querySelectorAll('[aria-label="Reliability"] tbody tr[data-counted]')].map((row) => row.textContent ?? '');

test('reliability counts independent executions, separates first-try from eventual success and pools nothing silently', async () => {
  const localStore = memoryStore();
  await publish(localStore);
  atlas = await openAtlas({ at: `/?test=${encodeURIComponent(KEY)}`, specs: {}, deps: { localStore } });
  await atlas.until(() => (section()?.textContent ?? '').includes('independent execution'), 'the reliability section');
  const text = section()!.textContent!;
  // Three executions, though four snapshots were published; the sample is too small to read as established.
  expect(text).toContain('3 independent executions');
  expect(text).toContain('Insufficient evidence');
  expect(text).toContain('2 of 3 executions passed (66.7%)');
  // Only the tries the producer recorded are first-try evidence.
  expect(text).toContain('1 of 2 executions passed first time (50%)');
  expect(text).toContain('1 recorded no tries');
  expect(text).toContain('Executions from several environments are pooled');
  expect(text).toContain('4 behind the counted');
  // Environments each have their own rate.
  const cohorts = [...section()!.querySelectorAll('table:not([data-counted]) tbody tr')].map((row) => row.textContent ?? '');
  expect(cohorts.some((row) => row.includes('Ios') || row.includes('iOS'))).toBe(true);
});

test('a scope in the address leaves other environments out, and its executions can be opened and shared', async () => {
  const localStore = memoryStore();
  await publish(localStore);
  atlas = await openAtlas({ at: `/?test=${encodeURIComponent(KEY)}&relEnv=ios&relOpen=true`, specs: {}, deps: { localStore } });
  await atlas.until(() => denominator().length > 0, 'the executions behind the figure');
  const text = section()!.textContent!;
  expect(text).toContain('1 independent execution');
  expect(text).toContain('0 of 1 execution passed (0%)');
  expect(text).toContain('2 outside the scope');
  expect(text).not.toContain('Executions from several environments are pooled');
  expect(text).toContain('Insufficient evidence');
  expect(denominator()).toHaveLength(1);
  expect(denominator()[0]).toContain('Failed');
  expect(denominator()[0]).toContain('Yes');
  expect(section()!.textContent).toContain('Copy link to this scope');
  // Opening an execution pins the test to that result.
  await atlas.click('[aria-label="Reliability"] a[aria-label^="Open the Failed result"]', 'Open this result');
  await atlas.until(() => typeof atlas!.router.state.location.search.layer === 'string', 'the pinned result');
  expect(atlas.router.state.location.search).toMatchObject({ relEnv: 'ios', relOpen: true });
});

test('the revision the spec is at now counts; earlier ones are context until they are included', async () => {
  const localStore = memoryStore();
  await publishChecks(localStore, { sha: SHA, branch: 'main', runUrl: null, producer: 'web', environment: 'desktop-web', recordedAtMs: 100_000, run: { id: 'old' }, specs: [{ path: SPEC, domain: 'billing', kind: 'feature', title: 'Pay an invoice', fingerprint: 'rev-1' }], checks: [{ ...PAY, status: 'failed' }] });
  await publishChecks(localStore, { sha: SHA, branch: 'main', runUrl: null, producer: 'web', environment: 'desktop-web', recordedAtMs: 200_000, run: { id: 'new' }, specs: [{ path: SPEC, domain: 'billing', kind: 'feature', title: 'Pay an invoice', fingerprint: 'rev-2' }], checks: [{ ...PAY, status: 'passed' }] });
  atlas = await openAtlas({ at: `/?test=${encodeURIComponent(KEY)}`, specs: {}, deps: { localStore } });
  await atlas.until(() => (section()?.textContent ?? '').includes('independent execution'), 'the reliability section');
  expect(section()!.textContent).toContain('1 independent execution');
  expect(section()!.textContent).toContain('Earlier spec revisions, shown as context and not counted: 0 of 1 execution passed.');
  await atlas.go(`/?test=${encodeURIComponent(KEY)}&relRevision=any`);
  await atlas.until(() => (section()?.textContent ?? '').includes('2 independent executions'), 'every revision pooled');
  expect(section()!.textContent).toContain('different revisions of the spec are pooled');
});
