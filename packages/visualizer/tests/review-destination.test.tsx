import { afterEach, beforeEach, expect, test } from 'bun:test';
import { textFingerprint } from '@crvouga/atlas/reports/layer-merge';
import { readLayer } from '@crvouga/atlas/reports/layer-store';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
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
let server: ReturnType<typeof createNode> | null = null;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(async () => {
  await atlas?.close();
  server?.close();
  atlas = null;
  server = null;
});

const PAY = `Feature: Pay an order
  Customers pay for what is in their cart.

  Rule: Cards

    Scenario: Pay by card
      Given a cart with one item
      When the customer pays by card
      Then the order is paid

    Scenario: Decline a card
      Given a cart with one item
      When the customer pays with a declined card
      Then a decline message is shown

    Scenario: Quote an order
      Given a cart with one item
      When the quote is requested
      Then the quote lists the total

    Scenario: Apply a coupon
      Given a cart with one item
      When the customer applies a coupon
      Then the total is reduced
`;
const SPECS = { 'checkout/pay.feature': PAY };
const PATH = 'specs/checkout/pay.feature';
const SPEC_ROWS = [{ path: PATH, domain: 'checkout', kind: 'gherkin', title: 'Pay an order', fingerprint: textFingerprint(PAY) }];
const SHA = (n: number) => String(n).repeat(40);
const RUN = (n: number) => `https://github.com/acme/app/actions/runs/${n}`;
const bytes = (text: string) => new TextEncoder().encode(text);
const movie = (name: string, extra: Record<string, unknown> = {}) => ({ name, role: 'video', contentType: 'video/webm', data: bytes(name), ...extra });
const check = (scenario: string) => ({ id: `${PATH} > ${scenario}`, title: `Pay an order: ${scenario}`, specPath: PATH });

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-behavior-row]')];
const row = (title: string) => rows().find((element) => element.textContent?.includes(title))!;
const text = () => document.body.textContent ?? '';

/** Opens the viewer on a server holding the given store, as a browser that has never been here before. */
async function open(store: ReturnType<typeof memoryStore>, at: string) {
  server = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await server.ready;
  return visit(at);
}

/** Opens the viewer afresh on the server already running: a reviewer coming back later. */
async function visit(at: string, intercept?: (path: string) => Response | undefined) {
  await atlas?.close();
  atlas = await openAtlas({ at, deps: {}, specs: SPECS, node: server!, ...(intercept ? { intercept } : {}) });
  return atlas;
}

test('1. one domain shows a definition-only scenario, an API-only execution, a failed UI recording and a passing demo as four distinct states', async () => {
  const store = memoryStore();
  const base = { producer: 'web-e2e', branch: 'main', specs: SPEC_ROWS };
  await publishChecks(store, {
    ...base, environment: 'desktop-web', sha: SHA(1), runUrl: RUN(1), recordedAtMs: 1_000,
    checks: [
      { ...check('Pay by card'), status: 'passed', attachments: [movie('pay.webm', { tags: ['demo'] })] },
      { ...check('Decline a card'), status: 'failed', detail: 'No decline message was shown', attachments: [movie('decline.webm')] }
    ]
  });
  await publishChecks(store, { ...base, producer: 'api', environment: 'api', sha: SHA(1), runUrl: RUN(2), recordedAtMs: 2_000, checks: [{ ...check('Quote an order'), status: 'passed' }] });
  const view = await open(store, '/behaviors?q=domain%3Acheckout');
  await view.until(() => rows().length === 4, 'the four behaviors of the checkout domain');
  const states = Object.fromEntries(rows().map((element) => [element.getAttribute('data-behavior-row')!.split('#')[1], element.getAttribute('data-coverage')]));
  expect(states).toEqual({ 'Pay by card': 'demonstrated', 'Decline a card': 'failed', 'Quote an order': 'api-only', 'Apply a coupon': 'unexecuted' });
  // Each state has its own words, and only the demonstrated one is a pass with proof.
  const label = (title: string) => row(title).textContent!;
  expect(label('Pay by card')).toContain('Demonstrated');
  expect(label('Decline a card')).toContain('Failed');
  expect(label('Quote an order')).toContain('API only');
  expect(label('Apply a coupon')).toContain('Not executed');
  expect(text()).toContain('1 of 4 behaviors demonstrated');
});

/** Several historical runs from different producers: two carry a demo-tagged recording, one is untagged, one is audio-free API work. */
async function history() {
  const store = memoryStore();
  const base = { branch: 'main', specs: SPEC_ROWS };
  await publishChecks(store, { ...base, producer: 'Demo-Recorder', environment: 'ios', sha: SHA(1), runUrl: RUN(1), recordedAtMs: 1_000, checks: [{ ...check('Decline a card'), status: 'failed', attachments: [movie('decline.webm', { tags: ['demo'] })] }] });
  await publishChecks(store, { ...base, producer: 'checkout-demos', environment: 'desktop-web', sha: SHA(2), runUrl: RUN(2), recordedAtMs: 2_000, checks: [{ ...check('Pay by card'), status: 'passed', attachments: [movie('pay.webm', { tags: ['demo'] })] }] });
  await publishChecks(store, { ...base, producer: 'web-e2e', environment: 'desktop-web', sha: SHA(3), runUrl: RUN(3), recordedAtMs: 3_000, checks: [{ ...check('Pay by card'), status: 'passed', attachments: [movie('plain.webm')] }] });
  await publishChecks(store, { ...base, producer: 'api', environment: 'api', sha: SHA(3), runUrl: RUN(4), recordedAtMs: 4_000, checks: [{ ...check('Quote an order'), status: 'passed', attachments: [{ name: 'quote.json', contentType: 'application/json', data: bytes('{}') }] }] });
  return store;
}
const artifactRows = () => [...document.querySelectorAll<HTMLElement>('section[aria-label="Artifacts"] tbody tr')];
const pick = async (label: string, option: string) => {
  const input = [...document.querySelectorAll<HTMLInputElement>('input')].find((item) => document.querySelector(`label[for="${item.id}"]`)?.textContent === label)!;
  expect(input, label).toBeDefined();
  await act(async () => input.click());
  const choice = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.startsWith(option))!;
  expect(choice, option).toBeDefined();
  await act(async () => choice.click());
};

test('2. a fresh browser chooses the demo tag and video from the offered values and plays the matching recordings without knowing a producer, commit or file', async () => {
  const view = await open(await history(), '/?tab=artifacts');
  await view.until(() => artifactRows().length === 4, 'every recorded result');
  await pick('Tag', '#demo');
  await view.until(() => artifactRows().length === 2, 'the two demo recordings');
  await pick('Type', 'video');
  expect(view.router.state.location.search).toMatchObject({ tab: 'artifacts', artifactTag: 'demo', type: 'video' });
  await view.click('button', /Watch these 2 results/);
  await view.until(() => document.querySelector('video[data-playing]') !== null, 'the player');
  expect(document.querySelectorAll('section[aria-label="Playlist"] li[data-entry]')).toHaveLength(2);
  expect(view.router.state.location.search).toMatchObject({ watch: true });
});

const link = (label: string | RegExp, within: ParentNode = document.body) =>
  [...within.querySelectorAll<HTMLAnchorElement>('a')].find((item) => (typeof label === 'string' ? item.textContent?.trim() === label : label.test(item.textContent ?? '')));

test('3. from a playlist item, Read shows the exact promise and its examples and Inspect keeps the source run, revision, environment and producer', async () => {
  const view = await open(await history(), '/?tab=artifacts&artifactTag=demo&type=video&watch=true');
  await view.until(() => document.querySelectorAll('section[aria-label="Playlist"] li[data-entry]').length === 2, 'the demo playlist');
  // Choose the older, failed recording: the newest passing one is not what is being reviewed.
  const entry = [...document.querySelectorAll<HTMLElement>('section[aria-label="Playlist"] li[data-entry]')].find((item) => item.textContent!.includes('Decline a card'))!;
  await act(async () => entry.querySelector('button')!.click());
  await view.until(() => document.querySelector('section[data-clip]')?.textContent?.includes('Decline a card') === true, 'the declined card clip');
  const clip = () => document.querySelector('section[data-clip]')!;
  const inspect = link('Developer details', clip())!;
  const layer = new URL(inspect.getAttribute('href')!, 'http://atlas.test').searchParams.get('layer')!;
  expect(layer).not.toBe('');

  // Read: the written promise of exactly this scenario, opened on its feature.
  const read = link(/^Read the promise/, clip());
  expect(read, 'a Read action on the playlist item').toBeDefined();
  await act(async () => read!.click());
  await view.until(() => view.router.state.location.pathname === '/specs/gherkin', 'the feature');
  expect(view.router.state.location.search).toMatchObject({ spec: 'checkout/pay.feature' });
  await view.sees('Then a decline message is shown');
  await view.until(() => document.querySelector('[role="tab"]') !== null, 'the behavior panel');
  expect(text()).toContain('Decline a card');

  // Back to the playlist, then Inspect: the same run, not the current combined evidence.
  await act(async () => view.router.history.back());
  await view.until(() => document.querySelector('section[data-clip]')?.textContent?.includes('Decline a card') === true, 'the playlist again');
  await act(async () => link('Developer details', clip())!.click());
  await view.until(() => document.querySelector('[aria-label="Evidence scope"], .mantine-Alert-root') !== null && text().includes('This run:'), 'the pinned run');
  expect(view.router.state.location.search).toMatchObject({ layer });
  expect(text()).toContain('Demo-Recorder');
  expect(text()).toContain('iOS');
  expect(text()).toContain('1111111');
  expect(text()).not.toContain('Latest combined evidence');
});

const type = (label: string, value: string) =>
  act(async () => {
    const named = [...document.querySelectorAll<HTMLLabelElement>('label')].find((item) => item.textContent?.startsWith(label));
    const field = (named ? document.getElementById(named.htmlFor) : null) as HTMLInputElement | HTMLTextAreaElement;
    expect(field, label).toBeDefined();
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
const entry = (n: number) => document.querySelector<HTMLElement>(`section[data-entry="e${n}"]`)!;

test('4. a frozen collection keeps its members and their recorded outcomes when newer runs arrive, while the filtered view moves on', async () => {
  const store = await history();
  const view = await open(store, '/?tab=artifacts&artifactTag=demo&type=video');
  await view.until(() => artifactRows().length === 2, 'the two demo recordings');
  await view.click('button', 'Freeze as review collection');
  await type('Title', 'Checkout demos');
  await view.click('button', /Freeze 2 results/);
  await view.until(() => document.querySelector('section[aria-label="Review collection"]') !== null, 'the collection');
  expect(text()).toContain('Frozen, revision 1 of 1');
  const recorded = [1, 2].map((n) => entry(n).textContent);
  expect([1, 2].map((n) => entry(n).getAttribute('data-status'))).toEqual(['passed', 'failed']);

  // Newer runs arrive: the declined card is fixed and recorded again, with the same tag.
  await publishChecks(store, { branch: 'main', specs: SPEC_ROWS, producer: 'checkout-demos', environment: 'desktop-web', sha: SHA(5), runUrl: RUN(5), recordedAtMs: 5_000, checks: [{ ...check('Decline a card'), status: 'passed', attachments: [movie('decline-fixed.webm', { tags: ['demo'] })] }] });
  await act(async () => void (await server!.index.refresh()));

  // The filtered view is a live query and now lists the new recording...
  await visit('/?tab=artifacts&artifactTag=demo&type=video');
  await view.until(() => artifactRows().length === 3, 'the live query with the newer run');
  // ...the collection does not: same members, same recorded outcomes, same runs, still its first revision.
  const back = await visit('/?tab=collections');
  await back.until(() => document.querySelector('table[data-collections] a') !== null, 'the collections list');
  await back.click('a', 'Checkout demos');
  await view.until(() => document.querySelector('section[aria-label="Review collection"]') !== null && entry(2) !== null, 'the collection again');
  expect(text()).toContain('Frozen, revision 1 of 1');
  expect(document.querySelectorAll('section[data-entry]')).toHaveLength(2);
  expect([1, 2].map((n) => entry(n).getAttribute('data-status'))).toEqual(['passed', 'failed']);
  expect([1, 2].map((n) => entry(n).textContent)).toEqual(recorded);
  expect(text()).not.toContain('run #5');
  expect(text()).toContain('recorded in 2 runs');
});

/** A WebM header and filler, so an intact file passes the container check of the server's read-back. */
const webm = (fill: number) => {
  const data = new Uint8Array(24).fill(fill);
  data.set([0x1a, 0x45, 0xdf, 0xa3]);
  return data;
};
const runRows = () => [...document.querySelectorAll<HTMLElement>('section[aria-label="Runs"] tbody tr')];
const runRow = (n: number) => runRows().find((item) => item.querySelector(`a[aria-label="Open run #${n}"]`))!;

test('5. a recording that was never uploaded and one that became unavailable are visible apart from the green tests, in the project and in the run', async () => {
  const store = memoryStore();
  const recordingExpectation = 'required' as const;
  const status = 'passed' as const;
  const run = (n: number) => ({ producer: 'web', environment: 'desktop-web', branch: 'main', specs: SPEC_ROWS, sha: SHA(n), runUrl: RUN(n), recordedAtMs: n * 1_000 });
  await publishChecks(store, { ...run(1), checks: [{ ...check('Pay by card'), status, recordingExpectation, attachments: [movie('pay.webm', { data: webm(1) })] }] });
  await publishChecks(store, { ...run(2), checks: [{ ...check('Decline a card'), status, recordingExpectation }] });
  const stored = await publishChecks(store, { ...run(3), checks: [{ ...check('Apply a coupon'), status, recordingExpectation, attachments: [movie('coupon.webm', { data: webm(3) })] }] });
  // Run 3 was stored and acknowledged, and its file later disappeared from storage.
  for (const held of Object.values((await readLayer(store, stored.id))!.bundle)) for (const part of held.parts) await store.delete(part.blob);

  const project = await open(store, '/behaviors');
  await project.until(() => rows().length === 4, 'the four behaviors');
  // In the project: three green tests, and only one of them is demonstrated; the other two say their recording is missing.
  expect(Object.fromEntries(rows().map((element) => [element.getAttribute('data-behavior-row')!.split('#')[1], element.getAttribute('data-coverage')]))).toMatchObject({
    'Pay by card': 'demonstrated',
    'Decline a card': 'recording-missing'
  });
  expect(row('Decline a card').textContent).toContain('Recording missing');
  expect(row('Decline a card').textContent).not.toContain('Demonstrated');

  // In the runs: every run passed, and the gaps are named beside the outcome, not instead of it.
  const read = await server!.fetch(new Request('http://atlas.test/api/reports/recordings/verification', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layers: [stored.id.slice(0, 12)] }) }));
  expect(read.status).toBe(200);
  const runs = await visit('/?tab=runs');
  await runs.until(() => runRows().length === 3, 'the three runs');
  await runs.until(() => runRow(3).querySelector('[data-stored-videos]') !== null, 'the read-back of run 3');
  expect(runRow(2).querySelector('[data-recordings="incomplete"]')!.textContent).toBe('Recordings 0 of 1: incomplete');
  expect(runRow(2).textContent).toContain('1 passed');
  expect(runRow(3).querySelector('[data-stored-videos="unavailable"]')!.textContent).toContain('Recording unavailable');
  expect(runRow(3).textContent).toContain('1 passed');
  expect(runRow(3).querySelector('a[aria-label^="Watch"]')).toBeNull();
  expect(runRow(1).querySelector('[data-recordings="incomplete"]')).toBeNull();
  // The gap is a filter of its own.
  const incomplete = await visit('/?tab=runs&recordings=incomplete');
  await incomplete.until(() => runRows().length === 1, 'only the run with the missing recording');
  expect(runRows()[0]!.querySelector('a[aria-label="Open run #2"]')).not.toBeNull();
});

test('6. a report from an older producer and a server without the newer routes stays readable, and what is unknown is never complete or passed', async () => {
  // An older producer: no spec fingerprints, no recording expectation, no tags, no environment axis beyond its name.
  const store = memoryStore();
  const legacy = SPEC_ROWS.map(({ fingerprint: _fingerprint, ...spec }) => spec);
  const run = (n: number) => ({ producer: 'legacy-e2e', environment: 'desktop-web', branch: 'main', specs: legacy, sha: SHA(n), runUrl: RUN(n), recordedAtMs: n * 1_000 });
  await publishChecks(store, { ...run(1), checks: [{ ...check('Pay by card'), status: 'passed', attachments: [movie('pay.webm')] }, { ...check('Decline a card'), status: 'failed', detail: 'No decline message was shown' }] });
  await publishChecks(store, { ...run(2), checks: [{ ...check('Pay by card'), status: 'passed', attachments: [movie('pay-again.webm')] }] });
  // A server that predates artifact search, read-back, review collections and catalog health answers those routes with 404.
  const older = (path: string) => (/^\/(artifacts|recordings\/verification|review-collections|tests\/health)/.test(path) ? new Response('{"error":"not_found"}', { status: 404 }) : undefined);
  const project = await open(store, '/behaviors');
  await project.until(() => rows().length === 4, 'the four behaviors');
  await visit('/behaviors', older);
  await atlas!.until(() => rows().length === 4, 'the behaviors from the older server');
  // Nothing that was not reported is a pass; the failure is still a failure; a missing fingerprint is not a match.
  expect(row('Decline a card').getAttribute('data-coverage')).toBe('failed');
  expect(row('Quote an order').getAttribute('data-coverage')).toBe('unexecuted');
  expect(row('Apply a coupon').getAttribute('data-coverage')).toBe('unexecuted');
  await act(async () => row('Pay by card')!.click());
  await atlas!.until(() => text().includes('not recorded'), 'the revision stated as not recorded');
  expect(text()).toContain('The revisions cannot be compared, so this evidence is not tied to the current promise.');
  expect(text()).not.toContain('Recording is older');

  // The runs claim nothing about their recordings: not complete, not incomplete; the filter for complete finds none.
  const runs = await visit('/?tab=runs', older);
  await runs.until(() => runRows().length === 2, 'the two runs');
  expect(document.querySelector('[data-recordings]')).toBeNull();
  expect(document.querySelector('[data-stored-videos]')).toBeNull();
  const complete = await visit('/?tab=runs&recordings=complete', older);
  await complete.until(() => document.querySelector('[data-no-match]') !== null, 'no run is complete');
  const unknown = await visit('/?tab=runs&recordings=unknown', older);
  await unknown.until(() => runRows().length === 2, 'both runs are of unknown completeness');

  // The artifact search is unavailable on that server and says so, instead of an empty or narrowed-looking list.
  const artifacts = await visit('/?tab=artifacts&artifactTag=demo', older);
  await artifacts.until(() => document.querySelector('[data-unsupported]') !== null, 'the unsupported notice');
  expect(document.querySelector('[data-unsupported]')!.textContent).toContain('cannot search artifacts');
  expect(artifactRows()).toHaveLength(0);
});

const latency = (value: number) => ({ name: 'Confirmation', value, unit: 'ms', kind: 'product-latency', from: 'pay pressed', to: 'receipt visible', limit: 800 });

/** Two independent desktop executions (the first needed a retry), one on a phone, and a behavior only the first execution covered. */
async function executions() {
  const store = memoryStore();
  const execution = (id: string, at: number, environment: string, build: string) => ({
    producer: 'web-e2e', environment, branch: 'main', specs: SPEC_ROWS, sha: SHA(at / 1_000), recordedAtMs: at, run: { id, title: id }, runUrl: null,
    labels: { build, platform: environment }
  });
  const steps = [{ name: 'a cart with one item', kind: 'given' }, { name: 'the customer pays by card', kind: 'when' }, { name: 'the order is paid', kind: 'then' }];
  await publishChecks(store, { ...execution('r1', 1_000, 'desktop-web', '41'), checks: [
    { ...check('Pay by card'), status: 'passed', steps, attempts: [{ index: 0, status: 'failed' }, { index: 1, status: 'passed' }], attachments: [movie('pay-1.webm')], measurements: [latency(400)] },
    { ...check('Decline a card'), status: 'passed', attachments: [movie('decline-1.webm')] },
    { ...check('Quote an order'), status: 'passed' }
  ] });
  await publishChecks(store, { ...execution('r2', 2_000, 'desktop-web', '42'), checks: [
    { ...check('Pay by card'), status: 'passed', steps, attempts: [{ index: 0, status: 'passed' }], attachments: [movie('pay-2.webm')], measurements: [latency(420)] },
    { ...check('Decline a card'), status: 'failed', detail: 'No decline message was shown', attachments: [movie('decline-2.webm')] }
  ] });
  await publishChecks(store, { ...execution('r3', 3_000, 'ios', '42'), checks: [{ ...check('Pay by card'), status: 'passed', attachments: [movie('pay-ios.webm')] }] });
  await publishChecks(store, { ...execution('r4', 4_000, 'desktop-web', '43'), checks: [{ ...check('Pay by card'), status: 'passed', steps, attempts: [{ index: 0, status: 'passed' }], attachments: [movie('pay-4.webm')], measurements: [latency(450)] }] });
  return store;
}

test('A1. approximate wording, a domain, a device and recordings find the right behavior and play it without a path, a producer or a commit', async () => {
  const view = await open(await executions(), '/behaviors');
  await view.until(() => rows().length === 4, 'the whole project');
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search behaviors"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'pay by crad domain:checkout env:ios has:video');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await view.until(() => rows().length === 1, 'the one behavior on the phone with a recording');
  expect(rows()[0]!.getAttribute('data-behavior-row')).toContain('Pay by card');
  await act(async () => rows()[0]!.click());
  await view.until(() => document.querySelector('video') !== null, 'the recording');
  expect(view.router.state.location.search).toMatchObject({ q: 'pay by crad domain:checkout env:ios has:video' });
});

const BY_CARD = encodeURIComponent('checkout/pay.feature#Pay by card');

const workspace = async (search: string) => {
  const view = await open(await executions(), `/behaviors?behavior=${BY_CARD}&workspace=true${search}`);
  await view.until(() => document.querySelector('video') !== null && document.querySelector('[aria-label="Scoped summary"] [aria-label="Reliability"]') !== null, 'the workspace');
  return view;
};
const summary = () => document.querySelector('[aria-label="Scoped summary"]')!.textContent!;

test('A2. one view states what should happen, what the selected execution did, what the recording does not show and whether it applies to the requested build and device', async () => {
  const view = await workspace('&release=43&releasePlatform=desktop-web');
  const article = document.querySelector('article')!.textContent!;
  expect(article).toContain('Then the order is paid');
  expect(summary()).toContain('Selected result passed');
  expect(article).toContain('The producer declared no scope for this recording');
  expect(article).toContain('does not approve the behavior for production');
  expect(article).toContain('Release build 43, desktop-web: Exact match of the release');

  // The same behavior read against another build, or another device, is not claimed to apply.
  await visit(`/behaviors?behavior=${BY_CARD}&workspace=true&release=44&releasePlatform=desktop-web`);
  await view.until(() => document.querySelector('video') !== null && text().includes('Release build 44'), 'the other build');
  expect(text()).not.toContain('Exact match of the release');
  await visit(`/behaviors?behavior=${BY_CARD}&workspace=true&release=43&releasePlatform=android`);
  await view.until(() => document.querySelector('video') !== null && text().includes('Release build 43, android'), 'the other device');
  expect(text()).toContain('Not known to apply to the release');
  expect(text()).not.toContain('Exact match of the release');

  // On the index the release is a control of the page, and "Stale or unverified" lists what does not apply.
  await visit('/behaviors?release=44&releasePlatform=desktop-web&evidence=stale');
  await view.until(() => rows().length > 0, 'the behaviors that do not apply');
  expect([...document.querySelectorAll<HTMLInputElement>('input')].find((input) => document.querySelector(`label[for="${input.id}"]`)?.textContent === 'Release build')!.value).toBe('44');
  expect(rows().map((element) => element.getAttribute('data-behavior-row'))).toContain('checkout/pay.feature#Pay by card');
});

test('A3. reliability names its independent executions and first-try semantics, product timing names its boundaries, and what is not measured stays unknown', async () => {
  await workspace('');
  expect(summary()).toContain('3 of 3 independent executions passed in the end');
  expect(summary()).toContain('Insufficient evidence');
  expect(summary()).toContain('at least 10 independent executions are needed');
  expect(summary()).toContain('2 of 3 executions passed first time');
  expect(summary()).toContain('Scope: environment desktop-web');
  expect(summary()).toContain('Confirmation (pay pressed to receipt visible): no percentile can be stated');
  expect(summary()).toContain('Budget 800 ms: 0 observations over it');
  expect(summary()).toContain('p50 needs 5 observations; there are 3');
  // A behavior nobody measured is unknown, not fast, and not reliable.
  await visit(`/behaviors?behavior=${encodeURIComponent('checkout/pay.feature#Apply a coupon')}&workspace=true`);
  await atlas!.until(() => text().includes('Nothing to watch'), 'the unexecuted behavior');
  await atlas!.until(() => document.querySelector('[aria-label="Scoped summary"]') !== null, 'its summary');
  expect(summary()).toContain('unknown');
  expect(summary()).not.toContain('independent executions passed');
});

test('A4. a baseline and a candidate are set side by side with the promise, each recording, each attempt and each source, and the behavior only one of them ran is a gap, not a pass', async () => {
  const view = await open(await executions(), '/?tab=compare&base=run%3Ar1&cand=run%3Ar2');
  await view.until(() => document.querySelectorAll('table[data-compare-results] tbody tr').length > 0, 'the comparison');
  const compared = (title: string) => [...document.querySelectorAll<HTMLElement>('table[data-compare-results] tbody tr')].find((item) => item.querySelector('td')!.textContent!.includes(title))!;
  expect(compared('Decline a card').getAttribute('data-group')).toBe('regressed');
  expect(compared('Quote an order').getAttribute('data-group')).toBe('removed');
  expect(compared('Quote an order').textContent).toContain('unknown, not a regression');
  expect(compared('Apply a coupon')).toBeUndefined();
  await view.click('a', 'Compare Pay an order: Pay by card');
  await view.until(() => document.querySelector('[role="tablist"][aria-label="What to compare"]') !== null, 'the behavior');
  const tab = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((item) => item.textContent === name)!;
  const panel = () => [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')].find((item) => item.textContent!.trim() !== '')!;
  await view.until(() => panel().textContent!.includes('the order is paid'), 'the recorded steps');
  expect(panel().textContent).toContain('Same promise');
  expect(panel().textContent).toContain('Spec revision 627:2c3a');
  await act(async () => tab('Outcomes').click());
  await view.until(() => panel().textContent!.includes('Passed'), 'the outcomes');
  expect(panel().textContent).toContain('web-e2e');
  expect(panel().textContent).toContain('1111111');
  expect(panel().textContent).toContain('2222222');
  await act(async () => tab('Recordings').click());
  await view.until(() => document.querySelector('video[data-compare-video="baseline"]') !== null && document.querySelector('video[data-compare-video="candidate"]') !== null, 'both recordings');
  expect(view.router.state.location.search).toMatchObject({ base: 'run:r1', cand: 'run:r2', pair: expect.any(String) });
  // The candidate's own result opens pinned to its run, not to the combined evidence.
  await act(async () => tab('Outcomes').click());
  await view.click('a', 'Open this candidate result');
  await view.until(() => text().includes('This run:'), 'the candidate run');
  expect(view.router.state.location.search).toMatchObject({ layer: expect.any(String) });
  expect(text()).toContain('2222222');
  expect(text()).not.toContain('Latest combined evidence');
});

test('7. Behaviors, Runs and Videos reach one another, and a result opened for inspection leads back to the promise', async () => {
  const view = await open(await executions(), '/behaviors');
  await view.until(() => rows().length === 4, 'the behaviors');
  const nav = () => document.querySelector('nav[aria-label="Where the evidence is"]')!;
  await act(async () => link('Runs', nav())!.click());
  await view.until(() => document.querySelector('section[aria-label="Runs"]') !== null, 'the Runs tab');
  expect(view.router.state.location.search).toMatchObject({ tab: 'runs' });
  await act(async () => void view.router.navigate({ to: '/behaviors', search: {} as never }));
  await view.until(() => rows().length === 4, 'the behaviors again');
  await act(async () => link('Videos and artifacts', nav())!.click());
  await view.until(() => document.querySelector('section[aria-label="Artifacts"]') !== null, 'the Artifacts tab');
  expect(view.router.state.location.search).toMatchObject({ tab: 'artifacts' });

  // From the explorer back to the promises, and from a result under Inspect to the promise it was recorded for.
  await view.click('a', /Behaviors: read what the project promises/);
  await view.until(() => view.router.state.location.pathname === '/behaviors' && rows().length === 4, 'the behaviors from the explorer');
  const key = JSON.stringify([PATH, `${PATH} > Decline a card`]);
  const detail = await visit(`/?test=${encodeURIComponent(key)}`);
  await detail.until(() => link('Read the promise') !== undefined, 'the Read action in the test detail');
  await act(async () => link('Read the promise')!.click());
  await detail.until(() => detail.router.state.location.pathname === '/specs/gherkin', 'the feature');
  await detail.until(() => document.querySelector('[role="tab"]') !== null, 'the opened behavior');
  expect(text()).toContain('Then a decline message is shown');
});
