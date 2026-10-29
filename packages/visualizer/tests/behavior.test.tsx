import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { textFingerprint } from '@crvouga/atlas/reports/layer-merge';

import { createNode } from '../../server/tests/node-compat';
import { FEATURE, memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const SPEC = 'specs/lists/add.feature';
const MINI = 'Feature: Share a list\n  Scenario: Add an item\n    Given a list\n    When adding tea\n    Then the list includes tea\n';
const bytes = (...values: number[]) => new Uint8Array(values);
const spec = (text: string) => ({
  path: SPEC,
  domain: 'lists',
  kind: 'gherkin',
  title: 'Share a list',
  fingerprint: textFingerprint(text)
});
const video = {
  id: 'tour',
  name: 'tour.webm',
  role: 'video',
  data: bytes(1, 2, 3),
  contentType: 'video/webm'
};
const check = (title: string, extra: Record<string, unknown> = {}) => ({
  id: `${SPEC} > ${title}`,
  title: `Share a list: ${title}`,
  status: 'passed' as const,
  specPath: SPEC,
  ...extra
});

async function open(
  checks: ReturnType<typeof check>[],
  options: {
    recorded?: string;
    now?: string;
    environment?: string;
    at?: string;
  } = {}
) {
  const store = memoryStore();
  await publishChecks(store, {
    producer: 'e2e',
    environment: options.environment ?? 'desktop-web',
    recordedAtMs: 5,
    branch: 'main',
    specs: [spec(options.recorded ?? MINI)],
    checks
  });
  const node = createNode({
    stores: [{ id: 'shared', store }],
    refreshMs: 60_000
  });
  await node.ready;
  atlas = await openAtlas({
    at: options.at ?? '/specs/gherkin?spec=lists/add.feature',
    deps: {},
    specs: { 'lists/add.feature': options.now ?? options.recorded ?? MINI },
    node
  });
  return atlas;
}

const states = () =>
  Object.fromEntries(
    [...document.body.querySelectorAll('section[aria-label="Coverage"] li[data-coverage]')].map((item) => [
      item.getAttribute('data-coverage'),
      Number(item.querySelector('span:nth-of-type(2), p')?.textContent ?? NaN)
    ])
  );
const coverage = () => document.body.querySelector('section[aria-label="Coverage"]')?.textContent ?? '';

test('a passing behavior with a recording of the current spec opens on Watch: expectation, player, provenance, illustrative label', async () => {
  const view = await open([check('Add an item', { attachments: [video] })]);
  await view.sees('1 behavior');
  await view.click('button', 'Add an item');
  // Watch comes first, with what should happen next to the recording.
  await view.until(() => document.querySelector('video') !== null, 'the player');
  const text = view.text();
  expect(text).toContain('Expected');
  expect(text).toContain('Then the list includes tea');
  expect(document.querySelector('video')!.getAttribute('src')).toContain('/blobs/');
  expect(document.querySelector('video')!.getAttribute('aria-label')).toContain('tour.webm');
  expect(text).toContain('does not approve the behavior for production');
  expect(text).toContain('Passed');
  expect(text).toContain('Desktop web');
  // Spec and evidence revisions are both named, and agree.
  expect(document.querySelector('[data-revision="same"]')).not.toBeNull();
  expect(text).toContain('Promise revision');
  expect(text).toContain('Evidence revision');
  expect(coverage()).toContain('1 of 1 behavior demonstrated');
  // Read and Inspect are one click away, in order.
  expect([...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(['Read', 'Watch', 'Inspect']);
});

test('only an older recording of a newer promise is not proof of it: the mismatch is stated and nothing is demonstrated', async () => {
  const view = await open([check('Add an item', { attachments: [video] })], {
    now: `${MINI}# Reworded promise\n`
  });
  await view.sees('Recording is older');
  expect(coverage()).toContain('0 of 1 behavior demonstrated');
  await view.click('button', 'Add an item');
  await view.sees('recorded against an earlier revision of the spec');
  expect(document.querySelector('[data-revision="different"]')).not.toBeNull();
  expect(view.text()).toContain('does not show that the current promise holds');
});

test('evidence with no recorded revision is unknown, never silently current', async () => {
  const store = memoryStore();
  await publishChecks(store, {
    producer: 'e2e',
    environment: 'desktop-web',
    recordedAtMs: 5,
    branch: 'main',
    specs: [],
    checks: [check('Add an item', { attachments: [video] })]
  });
  const node = createNode({
    stores: [{ id: 'shared', store }],
    refreshMs: 60_000
  });
  await node.ready;
  atlas = await openAtlas({
    at: '/specs/gherkin?spec=lists/add.feature',
    deps: {},
    specs: { 'lists/add.feature': MINI },
    node
  });
  await atlas.sees('1 behavior');
  await atlas.click('button', 'Add an item');
  await atlas.sees('cannot be compared');
  expect(document.querySelector('[data-revision="unknown"]')).not.toBeNull();
  expect(atlas.text()).toContain('not recorded');
});

test('coverage keeps failed, API-only, missing-recording and unexecuted behaviors apart, and counts each outline example once', async () => {
  const view = await open(
    [
      check('Add an item', { attachments: [video] }),
      check('Add several — Tea'),
      check('Remove an item', { status: 'failed', detail: 'no tea' })
    ],
    { environment: 'api', recorded: FEATURE }
  );
  // Add an item (recording on API env still has a video), Tea (API, no video), Remove (failed), Milk (never ran): four behaviors, no template.
  await view.sees('4 behaviors');
  expect(coverage()).toContain('1 of 4 behaviors demonstrated');
  const found = Object.keys(states());
  expect(found).toEqual(expect.arrayContaining(['demonstrated', 'api-only', 'failed', 'unexecuted']));
  expect(found).not.toContain('no-recording');
  const label = (state: string) => document.querySelector(`section[aria-label="Coverage"] li[data-coverage="${state}"]`)?.textContent ?? '';
  expect(label('unexecuted')).toContain('Not executed1');
  expect(label('api-only')).toContain('API only1');
  expect(label('failed')).toContain('Failed1');
  expect(view.text()).toContain('Add several — Milk');
});

test('a passing check that should have been recorded and was not is a recording gap, not a quiet pass', async () => {
  const view = await open([check('Add an item', { recordingExpectation: 'required' })], { environment: 'desktop-web' });
  await view.sees('Recording missing');
  expect(coverage()).toContain('0 of 1 behavior demonstrated');
  expect(document.querySelector('section[aria-label="Coverage"] li[data-coverage="recording-missing"]')).not.toBeNull();
});

test('an outline example reads with its own values filled in, and a parked scenario is parked rather than untested', async () => {
  const text = `Feature: Share a list\n  @parked\n  Scenario: Archive a list\n    When archiving\n\n  Scenario Outline: Add several\n    When adding "<item>"\n    Then "<item>" is listed\n    Examples:\n      | item |\n      | Tea |\n      | Milk |\n`;
  const view = await open([check('Add several — Tea')], {
    recorded: text,
    now: text
  });
  await view.sees('3 behaviors');
  expect(coverage()).toContain('Parked');
  expect(coverage()).toContain('Not executed');
  await view.click('button', 'Add several — Tea');
  await view.click('[role="tab"]', 'Read');
  await view.sees('Example: Tea');
  const row = document.querySelector('li[data-open]')!.textContent!;
  expect(row).toContain('adding "Tea"');
  expect(row).not.toContain('<item>');
});

test('the spec index searches meaningful titles and groups by the domain the specs declare', async () => {
  const store = memoryStore();
  atlas = await openAtlas({ at: '/specs/gherkin', deps: { localStore: store } });
  await atlas.sees('Empty the list');
  const nav = () => document.querySelector('nav[aria-label="Gherkin features"]')!;
  expect(nav().textContent).toContain('Share a list');
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(input.labels?.[0]?.textContent).toContain('Search features');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'empty');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await atlas.until(
    () =>
      nav().textContent!.includes('Empty the list') &&
      !nav().textContent!.includes('Share a list'),
    'only the matching title'
  );
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'nothing like it');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await atlas.sees('No features match "nothing like it".');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Grouped by the declared domain, the group is named for it.
  await atlas.click('label', 'Domain');
  await atlas.until(
    () => [...nav().querySelectorAll('h3')].some((heading) => heading.textContent?.startsWith('lists')),
    'the declared domain as the group'
  );
});

test('the recording on Watch says what it does and does not show, as its producer declared it', async () => {
  const view = await open([check('Add an item', { attachments: [{ ...video, scope: { surface: 'browser', dependencies: 'scripted' } }] })]);
  await view.sees('1 behavior');
  await view.click('button', 'Add an item');
  await view.until(() => document.querySelector('video') !== null, 'the player');
  const notice = document.querySelector('[aria-label="Evidence scope of tour.webm"]')!;
  expect(notice.textContent).toContain('Scripted dependencies');
});
