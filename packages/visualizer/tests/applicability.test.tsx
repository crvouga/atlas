import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { textFingerprint } from '@crvouga/atlas/reports/layer-merge';

import { createNode } from '../../server/tests/node-compat';
import { memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const SPEC = 'specs/lists/add.feature';
const MINI = 'Feature: Share a list\n  Scenario: Add an item\n    Given a list\n    When adding tea\n    Then the list includes tea\n\n  Scenario: Remove an item\n    When removing tea\n    Then the list is empty\n';
const bytes = (...values: number[]) => new Uint8Array(values);
const video = { id: 'tour', name: 'tour.webm', role: 'video', data: bytes(1, 2, 3), contentType: 'video/webm' };
const check = (title: string, extra: Record<string, unknown> = {}) => ({
  id: `${SPEC} > ${title}`,
  title: `Share a list: ${title}`,
  status: 'passed' as const,
  specPath: SPEC,
  ...extra
});

type Layer = { environment?: string; sha?: string; freshness?: 'modified' | 'unknown'; recordedAtMs?: number; recorded?: string; checks: ReturnType<typeof check>[] };

async function open(layers: Layer[], query = '', now: string = MINI) {
  const store = memoryStore();
  for (const [index, layer] of layers.entries()) {
    await publishChecks(store, {
      producer: `e2e-${index}`,
      environment: layer.environment ?? 'desktop-web',
      recordedAtMs: layer.recordedAtMs ?? 5,
      branch: 'main',
      sha: layer.sha ?? null,
      ...(layer.freshness ? { freshness: layer.freshness } : {}),
      specs: [{ path: SPEC, domain: 'lists', kind: 'gherkin', title: 'Share a list', fingerprint: textFingerprint(layer.recorded ?? MINI) }],
      checks: layer.checks
    });
  }
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at: `/specs/gherkin?spec=lists/add.feature${query}`, deps: {}, specs: { 'lists/add.feature': now }, node });
  return atlas;
}

const summary = () => document.querySelector('section[aria-label="Applicability of this evidence"]');
const type = async (label: string, value: string) => {
  const input = [...document.querySelectorAll<HTMLInputElement>('input')].find((each) => each.labels?.[0]?.textContent?.includes(label))!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

test('a promise changed after its only recording is stale: prominent, and the clip is not proof of the new promise', async () => {
  const view = await open([{ checks: [check('Add an item', { attachments: [video] })] }], '', `${MINI}# Reworded\n`);
  await view.sees('Recording is older');
  // The row says so before it is opened.
  expect(document.querySelector('li [data-applicability="stale"]')).not.toBeNull();
  await view.click('button', 'Add an item');
  await view.sees('recorded against an earlier revision of the spec');
  expect(summary()?.getAttribute('data-applicability')).toBe('stale');
  expect(summary()!.textContent).toContain('not proof of the current promise');
  // The outcome itself is untouched.
  expect(view.text()).toContain('Passed');
});

test('evidence uploaded today keeps the age of the day the checks ran', async () => {
  const day = 24 * 3_600_000;
  const view = await open([{ recordedAtMs: Date.now() - 40 * day, checks: [check('Add an item', { attachments: [video] })] }]);
  await view.click('button', 'Add an item');
  await view.until(() => summary() !== null, 'the summary');
  expect(summary()!.textContent).toContain('Checks ran:');
  expect(summary()!.textContent).toContain('40 d ago');
  expect(summary()!.textContent).toContain('not from when it was uploaded or annotated');
});

test('a desktop recording and a phone release: applicability stays unknown', async () => {
  const view = await open([{ checks: [check('Add an item', { attachments: [video], labels: { build: '90' } })] }], '&release=90&releasePlatform=ios');
  await view.click('button', 'Add an item');
  await view.until(() => summary() !== null, 'the summary');
  expect(summary()!.getAttribute('data-release')).toBe('unknown');
  expect(summary()!.textContent).toContain('Not known to apply to the release');
  expect(summary()!.textContent).toContain('desktop-web');
});

test('with a named release, a recording of another build is marked, and one of the release is not', async () => {
  const view = await open(
    [
      { checks: [check('Add an item', { attachments: [video], labels: { build: '90' } })] },
      { sha: 'b'.repeat(40), checks: [check('Remove an item', { attachments: [video], labels: { build: '91' } })] }
    ],
    '&release=91'
  );
  await view.sees('2 behaviors');
  await view.click('button', 'Add an item');
  await view.until(() => summary() !== null, 'the summary');
  expect(summary()!.getAttribute('data-release')).toBe('other');
  expect(summary()!.textContent).toContain('Recorded against build 90, not build 91.');
  expect(summary()!.textContent).toContain('not proof of the named release');
  await view.click('button', 'Remove an item');
  await view.until(() => summary()?.getAttribute('data-release') === 'exact', 'the exact match');
  expect(summary()!.textContent).not.toContain('not proof of the named release');
});

test('a modified checkout is never an exact build match', async () => {
  const sha = 'c'.repeat(40);
  const view = await open([{ sha, freshness: 'modified', checks: [check('Add an item', { attachments: [video], labels: { build: '91' } })] }], `&release=91&releaseSha=${sha}`);
  await view.click('button', 'Add an item');
  await view.until(() => summary() !== null, 'the summary');
  expect(summary()!.getAttribute('data-release')).toBe('unknown');
  expect(summary()!.textContent).toContain('cannot be an exact match');
  expect(summary()!.textContent).toContain('with local changes');
});

test('an assertion of compatibility shows who stands behind it, and is refused without one', async () => {
  const labels = { build: '90', 'applies-to': '91' };
  const view = await open(
    [
      { checks: [check('Add an item', { attachments: [video], labels: { ...labels, 'applies-to-by': 'release-policy-7: UI unchanged' } })] },
      { checks: [check('Remove an item', { attachments: [video], labels })] }
    ],
    '&release=91'
  );
  await view.sees('2 behaviors');
  await view.click('button', 'Add an item');
  await view.until(() => summary()?.getAttribute('data-release') === 'asserted', 'the accepted assertion');
  expect(summary()!.textContent).toContain('release-policy-7: UI unchanged');
  expect(summary()!.getAttribute('data-applicability')).toBe('applies');
  await view.click('button', 'Remove an item');
  await view.until(() => summary()?.getAttribute('data-release') === 'unknown', 'the refused assertion');
  expect(summary()!.textContent).toContain('no policy');
});

test('stale or unverified evidence can be filtered to without being turned into a failure', async () => {
  const view = await open([{ checks: [check('Add an item', { attachments: [video], labels: { build: '90' } })] }], '&release=91');
  await view.sees('2 behaviors');
  // One behavior has a recording of another build; the other was never executed: both lack applicable evidence.
  const filter = () => document.querySelector('[role="group"][aria-label="Evidence filter"]')!;
  expect(filter().textContent).toContain('Stale or unverified 2');
  await view.click('button', 'Stale or unverified');
  expect(filter().querySelector('[aria-pressed="true"]')!.textContent).toContain('Stale or unverified');
  expect(view.text()).toContain('Add an item');
  expect(view.text()).toContain('Remove an item');
  expect(document.querySelector('li [data-coverage="failed"]')).toBeNull();
  // Naming the build the recording was made against brings it back under applying evidence, so it leaves the filtered list.
  await type('Release build', '90');
  await view.until(() => filter().textContent!.includes('Stale or unverified 1'), 'one left');
  expect(document.querySelector('ul')?.textContent).not.toContain('Add an item');
});
