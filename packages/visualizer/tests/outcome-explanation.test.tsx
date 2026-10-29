import { afterEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import type { ObjectStore } from '@crvouga/atlas/reports/object-store';
import { act } from 'react';

import { createNode } from '../../server/tests/node-compat';
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

const SPEC = 'specs/lists/add.feature';
const PAY = { id: 'lists/add', title: 'Add an item', specPath: SPEC };
const KEY = JSON.stringify([SPEC, PAY.id]);

type Check = Record<string, unknown>;
async function publish(store: ObjectStore, at: number, producer: string, environment: string, check: Check, sha = 'a'.repeat(40)) {
  await publishChecks(store, { recordedAtMs: at, sha, branch: 'main', producer, environment, checks: [{ ...PAY, ...check }] });
}

async function open(prepare: (store: ObjectStore) => Promise<void>, at = `/?test=${encodeURIComponent(KEY)}`) {
  const store = memoryStore();
  await prepare(store);
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at, specs: {}, deps: {}, node });
  return atlas;
}
const ENVIRONMENTS = 'aside[aria-label="Test detail"] [role="group"][aria-label="Environments"] button';
const detail = () => document.querySelector('aside[aria-label="Test detail"]')?.textContent ?? '';
const summary = () => document.querySelector('[aria-label="Outcome summary"]')?.textContent ?? '';
const headline = () => document.querySelector('[data-outcome-headline]')?.textContent ?? '';

test('a passing selected source beside a failing one says both, and each source is one click away', async () => {
  const view = await open(async (store) => {
    await publish(store, 100, 'e2e-api', 'api', { status: 'failed', detail: 'Expected 200, got 500' });
    await publish(store, 200, 'e2e-web', 'desktop-web', { status: 'passed' });
  });
  await view.until(() => headline().includes('Selected result passed; another scoped source failed'), 'the heading');
  // The aggregate stays failed, and is labelled as the worst of the current sources, not as the selected one.
  expect(detail()).toContain('worst current result of 2 sources');
  await view.until(() => summary().includes('Other current sources'), 'the other source');
  await view.click('[aria-label="Other current sources"] button', /Api/);
  await view.until(() => headline().includes('Selected result failed; the other scoped source: 1 passed'), 'the failing selection');
  // The choice is kept in the address, and a copied link opens on the same source.
  const source = view.router.state.location.search.source as string;
  expect(source).toMatch(/^[0-9a-f]{64}$/);
  expect(view.router.state.location.search).not.toHaveProperty('layer');
  await view.go(`/?test=${encodeURIComponent(KEY)}&source=${source}`);
  await view.until(() => headline().includes('Selected result failed'), 'the copied link');
  expect(document.querySelector(`${ENVIRONMENTS}[aria-pressed="true"]`)?.textContent).toContain('Api');
});

test('sources that share an environment are told apart by status, time, revision and their place', async () => {
  const view = await open(async (store) => {
    await publish(store, 100, 'suite-a', 'desktop-web', { status: 'failed', detail: 'boom' }, 'a'.repeat(40));
    await publish(store, 200, 'suite-b', 'desktop-web', { status: 'passed' }, 'b'.repeat(40));
  });
  await view.until(() => document.querySelectorAll(ENVIRONMENTS).length === 2, 'both sources');
  const labels = [...document.querySelectorAll(ENVIRONMENTS)].map((button) => button.textContent ?? '');
  expect(new Set(labels).size).toBe(2);
  expect(labels[0]).toContain('Passed');
  expect(labels[0]).toContain('bbbbbbb');
  expect(labels[0]).toContain('result 1 of 2 from suite-b');
  expect(labels[1]).toContain('Failed');
  expect(labels[1]).toContain('aaaaaaa');
  expect(labels[1]).toContain('result 2 of 2 from suite-a');
});

test('setup failing before the behavior is not verified, and the execution stays failed', async () => {
  const view = await open(async (store) => {
    await publish(store, 100, 'e2e-web', 'desktop-web', {
      status: 'failed',
      detail: 'ECONNREFUSED seeding',
      steps: [
        { id: 's', name: 'Seed the database', kind: 'hook', status: 'failed', offsetMs: 0, durationMs: 40 },
        { id: 'w', name: 'Add tea', kind: 'when', status: 'skipped', offsetMs: 50 }
      ]
    });
  });
  await view.until(() => summary().includes('Behavior not verified'), 'the setup explanation');
  expect(summary()).toContain('setup failed at “Seed the database”');
  expect(summary()).toContain('still recorded as failed');
  expect(summary()).not.toContain('Expectation not met');
  expect(summary()).toContain('Closest step: Seed the database');
  expect(detail()).toContain('Failed');
  // The original diagnostic is kept.
  expect(detail()).toContain('ECONNREFUSED seeding');
  // Blame is never read from the wording of the message.
  expect(summary()).toContain('Cause: unknown');
});

test('a recorded expected and observed boundary leads, with the closest step and the video', async () => {
  const view = await open(async (store) => {
    await publish(store, 100, 'e2e-web', 'desktop-web', {
      status: 'failed',
      detail: 'AssertionError: very long raw output',
      attachments: [{ id: 'clip', name: 'run.webm', role: 'video', contentType: 'video/webm', data: new Uint8Array([1, 2, 3]) }],
      steps: [
        { id: 'a', name: 'Open the list', kind: 'action', status: 'passed', offsetMs: 0 },
        {
          id: 'b',
          name: 'The list includes tea',
          kind: 'then',
          status: 'failed',
          offsetMs: 1500,
          extensions: { 'atlas.failure': { expected: 'tea in the list', actual: 'the list is empty', attribution: 'product' } }
        }
      ]
    });
  });
  await view.until(() => summary().includes('Expectation not met'), 'the boundary');
  expect(summary()).toContain('Expected');
  expect(summary()).toContain('tea in the list');
  expect(summary()).toContain('Observed');
  expect(summary()).toContain('the list is empty');
  expect(summary()).toContain('Closest step: The list includes tea');
  expect(summary()).toContain('1.5 s into the check');
  expect(summary()).toContain('Closest video: run.webm');
  expect(summary()).toContain('Scope unknown');
  expect(summary()).toContain('Cause: the product, as declared by the producer');
  // The summary comes before the raw output.
  const raw = [...document.querySelectorAll('pre, code')].find((code) => code.textContent?.includes('very long raw output'));
  expect(raw).toBeDefined();
  const summaryEl = document.querySelector('[aria-label="Outcome summary"]')!;
  expect(summaryEl.compareDocumentPosition(raw!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('a failure with no recorded point says the behavior reach and the cause are unknown', async () => {
  const view = await open(async (store) => {
    await publish(store, 100, 'e2e-web', 'desktop-web', { status: 'failed', detail: 'timeout waiting for the environment' });
  });
  await view.until(() => summary().includes('Failure point unknown'), 'the unknown reach');
  expect(summary()).toContain('whether the behavior was reached is unknown');
  expect(summary()).toContain('Cause: unknown');
});

test('a later passing replay keeps the earlier failure in order and does not declare it fixed', async () => {
  const view = await open(async (store) => {
    await publish(store, 100, 'e2e-web', 'desktop-web', { status: 'failed', detail: 'boom' }, 'a'.repeat(40));
    await publish(store, 200, 'e2e-web', 'desktop-web', { status: 'passed' }, 'b'.repeat(40));
  });
  await view.until(() => document.querySelector('[aria-label="Chronology of this source"]') !== null, 'the chronology');
  const items = [...document.querySelectorAll('[aria-label="Chronology of this source"] li')].map((item) => item.textContent ?? '');
  expect(items).toHaveLength(2);
  expect(items[0]).toContain('Failed');
  expect(items[0]).toContain('aaaaaaa');
  expect(items[1]).toContain('Passed');
  expect(items[1]).toContain('selected');
  expect(summary()).toContain('Nothing recorded shows that the failure was fixed');
  expect(headline()).toBe('Selected result passed');
});
