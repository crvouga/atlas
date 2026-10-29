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
const THEN = 'Feature: Share a list\n  Scenario: Add an item\n    Then the list includes tea\n';
const NOW = `${THEN}# Reworded\n`;
const check = (title: string, extra: Record<string, unknown> = {}) => ({
  id: `${SPEC} > ${title}`,
  title: `Share a list: ${title}`,
  status: 'passed' as const,
  specPath: SPEC,
  ...extra
});
const keyOf = (title: string) => JSON.stringify([SPEC, `${SPEC} > ${title}`]);

type Layer = { environment?: string; recordedAtMs: number; recorded: string; sha?: string; checks: ReturnType<typeof check>[] };

/** The server's catalog reads the promise as the newest fingerprint a layer recorded, so a later layer of reworded text makes the earlier one's evidence of an earlier promise. */
async function open(layers: Layer[], query = '') {
  const store = memoryStore();
  for (const [index, layer] of layers.entries()) {
    await publishChecks(store, {
      producer: `e2e-${index}`,
      environment: layer.environment ?? 'desktop-web',
      recordedAtMs: layer.recordedAtMs,
      branch: 'main',
      sha: layer.sha ?? null,
      specs: [{ path: SPEC, domain: 'lists', kind: 'gherkin', title: 'Share a list', fingerprint: textFingerprint(layer.recorded) }],
      checks: layer.checks
    });
  }
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at: `/${query}`, deps: {}, specs: { 'lists/add.feature': NOW }, node });
  return atlas;
}

const DAY = 24 * 3_600_000;
const STALE_AND_CURRENT: Layer[] = [
  { recordedAtMs: 1_000, recorded: THEN, checks: [check('Old promise')] },
  { recordedAtMs: 2_000, recorded: NOW, checks: [check('Current promise')] }
];
const rows = () => [...document.querySelectorAll('section[aria-label="Tests"] li[data-status]')].map((row) => row.textContent ?? '');
const detail = () => document.querySelector('[aria-label="Test detail"] section[aria-label="Applicability of this evidence"]');
const type = async (label: string, value: string) => {
  const input = [...document.querySelectorAll<HTMLInputElement>('input')].find((each) => each.labels?.[0]?.textContent?.includes(label))!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

test('a test whose promise changed after its only result is marked stale in the list, and stays passed', async () => {
  const view = await open(STALE_AND_CURRENT);
  await view.until(() => rows().length === 2, 'both tests');
  const [old, current] = [rows().find((row) => row.includes('Old promise'))!, rows().find((row) => row.includes('Current promise'))!];
  expect(old).toContain('Stale');
  expect(current).not.toContain('Stale');
  // Staleness is a reading of the evidence: the outcome itself is untouched.
  expect(document.querySelector('li[data-status="failed"]')).toBeNull();
  expect(document.querySelectorAll('li[data-status="passed"]').length).toBe(2);
});

test('the stale or unverified facet lists tests without applying evidence and changes no status', async () => {
  const view = await open(STALE_AND_CURRENT);
  await view.until(() => rows().length === 2, 'both tests');
  const facet = () => document.querySelector<HTMLButtonElement>('button[aria-label^="Stale or unverified evidence"]')!;
  expect(facet().getAttribute('aria-label')).toBe('Stale or unverified evidence: 1 test');
  await view.click('button', 'Stale or unverified');
  await view.until(() => rows().length === 1, 'only the stale test');
  expect(rows()[0]).toContain('Old promise');
  expect(facet().getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('li[data-status="failed"]')).toBeNull();
  expect(view.text()).toContain('Passed');
});

test('sorting by evidence puts stale evidence first, whatever order the spec gives', async () => {
  // Spec order lists the current promise first (alphabetical: Current before Old).
  const view = await open(STALE_AND_CURRENT);
  await view.until(() => rows().length === 2, 'both tests');
  expect(rows()[0]).toContain('Current promise');
  const sort = document.querySelector<HTMLSelectElement>('select[aria-label="Sort"]')!;
  expect([...sort.options].map((option) => option.value)).toContain('evidence');
  await act(async () => {
    sort.value = 'evidence';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await view.until(() => rows()[0]?.includes('Old promise') === true, 'stale first');
  expect(rows()).toHaveLength(2);
});

test('the test detail says the old result is not proof of the current promise, and its age counts from when the checks ran', async () => {
  const published = Date.now() - DAY;
  const view = await open(
    [
      { recordedAtMs: Date.now() - 40 * DAY, recorded: THEN, checks: [check('Old promise', { labels: { 'published-at': String(published), 'enriched-at': new Date(published).toISOString() } })] },
      { recordedAtMs: Date.now() - 39 * DAY, recorded: NOW, checks: [check('Current promise')] }
    ],
    `?test=${encodeURIComponent(keyOf('Old promise'))}`
  );
  await view.until(() => detail() !== null, 'the applicability summary');
  expect(detail()!.getAttribute('data-applicability')).toBe('stale');
  expect(detail()!.textContent).toContain('not proof of the current promise');
  expect(detail()!.textContent).toContain('Checks ran:');
  expect(detail()!.textContent).toContain('40 d ago');
  // Publication and enrichment are shown apart, and are never the age of the evidence.
  expect(detail()!.querySelector('[data-published]')!.textContent).toContain('1 d ago');
  expect(detail()!.querySelector('[data-enriched]')!.textContent).toContain('1 d ago');
  expect(view.text()).toContain('Passed');
});

test('a named release marks a test of another build in the list and in the detail, and a modified checkout is not exact', async () => {
  const sha = 'c'.repeat(40);
  const view = await open(
    [
      { recordedAtMs: 1_000, recorded: NOW, checks: [check('Older build', { labels: { build: '90' } })] },
      { recordedAtMs: 2_000, recorded: NOW, checks: [check('Same build', { labels: { build: '91' } })] },
      { recordedAtMs: 3_000, recorded: NOW, sha, checks: [check('Dirty build', { labels: { build: '91' } })] }
    ],
    `?release=91&releaseSha=${sha}`
  );
  await view.until(() => rows().length === 3, 'three tests');
  expect(rows().find((row) => row.includes('Older build'))).toContain('Stale');
  // A build alone with no commit recorded cannot be compared with the named commit.
  expect(rows().find((row) => row.includes('Same build'))).toContain('Applicability unknown');
  // A branch name or a green check supplies nothing: every one of them passed.
  expect(document.querySelectorAll('li[data-status="passed"]').length).toBe(3);
  await view.click('a', 'Older build');
  await view.until(() => detail() !== null, 'the detail');
  expect(detail()!.getAttribute('data-release')).toBe('other');
  expect(detail()!.textContent).toContain('Recorded against build 90');
});

test('a release can be named from the explorer and stays in the address', async () => {
  const view = await open([{ recordedAtMs: 1_000, recorded: NOW, checks: [check('Older build', { labels: { build: '90' } })] }]);
  await view.until(() => rows().length === 1, 'the test');
  expect(rows()[0]).not.toContain('Stale');
  await view.click('button', 'Release the evidence is read against');
  await type('Release build', '91');
  await view.until(() => rows()[0]?.includes('Stale') === true, 'the release applied');
  expect(view.router.state.location.search).toMatchObject({ release: '91' });
});
