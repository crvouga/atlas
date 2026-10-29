import { afterEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import type { ObjectStore } from '@crvouga/atlas/reports/object-store';
import { act } from 'react';

import { memoryStore, openAtlas, type Atlas } from './atlas';

class FinderResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FinderResizeObserver as unknown as typeof ResizeObserver;

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const SPEC = 'specs/pay.feature';
const CONFIRM = { id: 'pay/confirm', title: 'Confirm a payment', specPath: SPEC };
const SPEECH = { id: 'pay/speak', title: 'Answer by voice', specPath: SPEC };
const PACED = { id: 'pay/demo', title: 'Paced demo', specPath: SPEC };
const key = (check: { id: string; specPath: string }) => JSON.stringify([check.specPath, check.id]);

const latency = (value: number, extra: Record<string, unknown> = {}) => ({
  name: 'Confirmation', value, unit: 'ms', kind: 'product-latency', from: 'submit pressed', to: 'confirmation visible', limit: 800, ...extra
});

/** Five observations on build 41 and five on build 42, one of which timed out; a 30 s test with a 500 ms confirmation. */
async function publish(store: ObjectStore) {
  for (let i = 0; i < 5; i++) {
    await publishChecks(store, {
      producer: 'e2e', environment: 'ios', recordedAtMs: 1_000 + i, branch: 'main',
      checks: [{ ...CONFIRM, status: 'passed', durationMs: 30_000, measurements: [{ name: 'Fixture setup', value: 20_000, unit: 'ms' }, latency(i === 0 ? 500 : 400, { labels: { build: '41' }, instrumentation: 'spans-v1' })] }]
    });
  }
  for (let i = 0; i < 5; i++) {
    await publishChecks(store, {
      producer: 'e2e', environment: 'ios', recordedAtMs: 2_000 + i, branch: 'main',
      checks: [{ ...CONFIRM, status: 'passed', durationMs: 31_000, measurements: [latency(i === 4 ? 5_000 : 600, { labels: { build: '42' }, instrumentation: 'spans-v2', ...(i === 4 ? { outcome: 'timeout' } : {}) })] }]
    });
  }
  await publishChecks(store, {
    producer: 'voice', environment: 'ios', recordedAtMs: 3_000, branch: 'main',
    checks: [{ ...SPEECH, status: 'passed', durationMs: 9_000, measurements: [latency(350, { name: 'Speech to answer', from: 'end of speech', to: 'tts dispatch', intended: { from: 'end of speech', to: 'audible response' } })] }]
  });
  await publishChecks(store, {
    producer: 'e2e', environment: 'ios', recordedAtMs: 4_000, branch: 'main',
    checks: [{ ...PACED, status: 'passed', durationMs: 45_000, measurements: [{ name: 'Viewer pause', value: 40_000, unit: 'ms' }] }]
  });
}

async function open(check: { id: string; specPath: string }) {
  const localStore = memoryStore();
  await publish(localStore);
  atlas = await openAtlas({ at: `/?test=${encodeURIComponent(key(check))}`, specs: {}, deps: { localStore } });
  const section = () => document.querySelector<HTMLElement>('aside[aria-label="Test detail"] [aria-label="Product latency"]');
  await atlas.until(() => section() !== null && (document.querySelectorAll('[aria-label="History"] tbody tr').length ?? 0) > 0, 'the test detail');
  return { section: section as () => HTMLElement, atlas };
}

async function choose(label: string, value: string) {
  const control = [...document.querySelectorAll('label')].find((item) => item.textContent === label);
  const select = document.getElementById(control?.getAttribute('for') ?? '') as HTMLSelectElement;
  expect(select).toBeDefined();
  await act(async () => {
    Object.getOwnPropertyDescriptor((window as unknown as { HTMLSelectElement: typeof HTMLSelectElement }).HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('product latency is 500 ms and the test duration stays separately labelled', async () => {
  const { section } = await open(CONFIRM);
  const text = section().textContent!;
  expect(text).toContain('Confirmation');
  expect(text).toContain('submit pressed to confirmation visible');
  expect(text).toContain('not the test\'s duration');
  // The fixture setup number (no kind) is never latency; the 30 s duration is under test statistics.
  expect(text).not.toContain('Fixture setup');
  expect(text).not.toContain('20 s');
  const stats = document.querySelector('[aria-label="Statistics"]')!.textContent!;
  expect(stats).toContain('test execution time');
  expect(document.querySelector('svg[aria-label^="Durations from"]')).not.toBeNull();
});

test('with ten observations p50 is shown, p95 is withheld with its reason, and timeouts count against the budget', async () => {
  const { section } = await open(CONFIRM);
  const text = section().textContent!;
  expect(text).toContain('p50');
  expect(text).toContain('Withheld');
  expect(text).toContain('p95 needs 20 observations; there are 10.');
  expect(text).toContain('1 of 10 over');
  expect(text).toContain('did not complete');
  expect(text).toContain('lower bounds');
});

test('grouped by build, each build has its own samples and a baseline comparison discloses a change of instrumentation', async () => {
  const { section } = await open(CONFIRM);
  await choose('Group latency by', 'build');
  await atlas!.until(() => section().textContent!.includes('42') && section().textContent!.includes('41'), 'the builds');
  const rows = [...section().querySelectorAll('tbody tr')].map((row) => row.textContent ?? '');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain('42');
  expect(rows[0]).toContain('1 of 5 over');
  expect(rows[1]).toContain('41');
  expect(rows[1]).toContain('Baseline');
  expect(rows[0]).toMatch(/\+\d+ ms \(\+\d+(\.\d)?%\) in p50/);
  expect(section().textContent).toContain('Instrumentation changed: spans-v1 became spans-v2');
});

test('partial speech timing is not labelled microphone-to-audible-response and a single observation withholds percentiles', async () => {
  const { section } = await open(SPEECH);
  const text = section().textContent!;
  expect(text).toContain('end of speech to tts dispatch');
  expect(text).toContain('Partial interval');
  expect(text).toContain('not end of speech to audible response');
  expect(text).toContain('One observation');
  expect(text).toContain('p50 needs 5 observations; there is 1.');
});

test('a paced demo with a long duration has no product latency: it is unknown, not fast', async () => {
  const { section } = await open(PACED);
  expect(section().textContent).toContain('No product latency was recorded');
  expect(section().textContent).toContain('unknown, not fast');
  expect(section().textContent).not.toContain('Viewer pause');
  expect(section().querySelector('table')).toBeNull();
});
