import { afterEach, beforeEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { act } from 'react';

import { memoryStore, openAtlas, type Atlas } from './atlas';

class FinderResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FinderResizeObserver as unknown as typeof ResizeObserver;

let plays: HTMLMediaElement[] = [];
const mediaPrototype = (globalThis as unknown as { window: { HTMLMediaElement: { prototype: { play: () => unknown } } } }).window.HTMLMediaElement.prototype;
const realPlay = mediaPrototype.play;
beforeEach(() => {
  localStorage.clear();
  plays = [];
  mediaPrototype.play = function (this: HTMLMediaElement) {
    plays.push(this);
    return Promise.resolve();
  };
});

let atlas: Atlas | null = null;
afterEach(async () => {
  mediaPrototype.play = realPlay;
  await atlas?.close();
  atlas = null;
});

const SPEC = 'specs/checkout/pay.feature';
const key = (id: string) => JSON.stringify([SPEC, id]);
const bytes = (text: string) => new TextEncoder().encode(text);
const movie = (name: string) => ({ name, contentType: 'video/webm', data: bytes(name) });
const latency = (value: number, extra: Record<string, unknown> = {}) => ({ name: 'Confirmation', value, unit: 'ms', kind: 'product-latency', from: 'pay pressed', to: 'receipt visible', ...extra });

type Check = Record<string, unknown> & { id: string; status: string };
const spec = (fingerprint: string) => [{ path: SPEC, domain: 'checkout', kind: 'feature', title: 'Pay', fingerprint }];
const publish = (store: ReturnType<typeof memoryStore>, run: string, at: number, fingerprint: string, checks: Check[], environment = 'desktop-web') =>
  publishChecks(store, {
    producer: 'web', environment, recordedAtMs: at, branch: 'main', sha: 'a'.repeat(40), runUrl: null, run: { id: run, title: run }, specs: spec(fingerprint),
    checks: checks.map((check) => ({ specPath: SPEC, title: check.id, ...check })) as never
  });

/** A baseline and a candidate: one regression, one behavior the candidate did not run, one reworded promise, one only the candidate has, one only the baseline has. */
async function seed() {
  const store = memoryStore();
  await publish(store, 'base', 1_000, 'rev-1', [
    { id: 'pay', title: 'Pay with a card', status: 'passed', steps: [{ name: 'open the cart', offsetMs: 0 }, { name: 'pay', offsetMs: 4_000 }], attachments: [movie('base-pay.webm')], measurements: [latency(400), latency(410), latency(420), latency(430), latency(440)] },
    { id: 'refund', title: 'Refund a payment', status: 'passed' },
    { id: 'tip', title: 'Add a tip', status: 'passed' },
    { id: 'gone', title: 'Print a receipt', status: 'passed' }
  ]);
  await publish(store, 'cand', 2_000, 'rev-2', [
    { id: 'pay', title: 'Pay with a card', status: 'failed', detail: 'card_declined was not shown', steps: [{ name: 'open the cart', offsetMs: 500 }, { name: 'pay', offsetMs: 9_000 }], attachments: [movie('cand-pay.webm')], measurements: [latency(900), latency(910), latency(920), latency(930), latency(940)] },
    { id: 'refund', title: 'Refund a payment', status: 'not-run' },
    { id: 'tip', title: 'Add a tip of ten percent', status: 'failed' },
    { id: 'fresh', title: 'Pay with a gift card', status: 'passed' }
  ]);
  return store;
}

const COMPARE = '/?tab=compare&base=run%3Abase&cand=run%3Acand';
async function open(at = COMPARE) {
  const localStore = await seed();
  atlas = await openAtlas({ at, specs: {}, deps: { localStore } });
  await atlas.until(() => document.querySelectorAll('table[data-compare-results] tbody tr').length > 0, 'the comparison');
  return { atlas, localStore };
}
const text = () => document.body.textContent ?? '';
const row = (title: string) => [...document.querySelectorAll<HTMLElement>('table[data-compare-results] tbody tr')].find((item) => item.querySelector('td')!.textContent!.startsWith(title))!;
/** The open panel: the tabs do not keep the others' content, and the closed ones are empty. */
const panel = () => [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')].find((item) => item.textContent!.trim() !== '')!;
const tab = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((item) => item.textContent === name)!;
const video = (side: string) => document.querySelector<HTMLVideoElement>(`video[data-compare-video="${side}"]`);
const openPair = async (view: Atlas, title: string) => {
  await view.click('a', `Compare ${title}`);
  await view.until(() => document.querySelector('[role="tablist"][aria-label="What to compare"]') !== null, 'the behavior');
};
const select = async (label: string, value: string) => {
  const control = [...document.querySelectorAll('label')].find((item) => item.textContent?.startsWith(label));
  const element = document.getElementById(control?.getAttribute('for') ?? '') as HTMLSelectElement;
  expect(element, label).toBeDefined();
  await act(async () => {
    Object.getOwnPropertyDescriptor((window as unknown as { HTMLSelectElement: typeof HTMLSelectElement }).HTMLSelectElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

test('1 and 2: behaviors are reconciled by identity and what the candidate did not run is unknown, not regressed or passed', async () => {
  const { atlas: view } = await open();
  expect(view.find('section', 'Baseline run')!.textContent).toContain('base');
  expect(view.find('section', 'Candidate run')!.textContent).toContain('cand');
  expect(row('Pay with a card').getAttribute('data-group')).toBe('regressed');
  expect(row('Pay with a card').textContent).toContain('Newly failing');
  // Not run in the candidate is unknown, in words that say so.
  expect(row('Refund a payment').getAttribute('data-group')).toBe('unknown');
  expect(row('Refund a payment').textContent).toContain('unknown, not a failure or a pass');
  // Present in one run only: never a regression, never a pass.
  expect(row('Print a receipt').getAttribute('data-group')).toBe('removed');
  expect(row('Print a receipt').textContent).toContain('unknown, not a regression');
  expect(row('Print a receipt').textContent).toContain('No result');
  expect(row('Pay with a gift card').getAttribute('data-group')).toBe('added');
  // The reworded behavior keeps its identity, but its two outcomes are not framed as one experiment.
  expect(row('Add a tip of ten percent').getAttribute('data-group')).toBe('not-comparable');
  expect(row('Add a tip of ten percent').textContent).toContain('Promise changed');
  expect(row('Add a tip of ten percent').textContent).toContain('no regression or recovery is claimed');
  const summary = document.querySelector('[data-compare-summary]')!.textContent!;
  expect(summary).toContain('5 behaviors across the two runs');
  expect(summary).toContain('1 newly failing');
});

test('the kind of change filters the list and stays in the address', async () => {
  const { atlas: view } = await open();
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Kind of change"] button')].find((item) => item.textContent!.startsWith('Newly failing'))!.click());
  await view.until(() => document.querySelectorAll('table[data-compare-results] tbody tr').length === 1, 'one row');
  expect(view.router.state.location.search).toMatchObject({ change: 'regressed', base: 'run:base', cand: 'run:cand' });
  expect(text()).toContain('Passed in the baseline run and failed in the candidate run');
});

test('6: both pinned runs stay as they are when a newer run arrives', async () => {
  const { atlas: view, localStore } = await open();
  const before = [...document.querySelectorAll('table[data-compare-results] tbody tr')].map((item) => item.textContent);
  await publish(localStore, 'newer', 3_000, 'rev-2', [{ id: 'pay', title: 'Pay with a card', status: 'passed' }, { id: 'refund', title: 'Refund a payment', status: 'passed' }]);
  view.time.clock.at += 2_000;
  await view.poll();
  await view.until(() => [...document.querySelectorAll('[data-compare-picker="Candidate run"] option')].some((item) => item.textContent!.includes('newer')), 'the newer run offered');
  expect([...document.querySelectorAll('table[data-compare-results] tbody tr')].map((item) => item.textContent)).toEqual(before);
  expect(view.router.state.location.search).toMatchObject({ base: 'run:base', cand: 'run:cand' });
  expect((document.querySelector('[data-compare-picker="Candidate run"]') as HTMLSelectElement).value).toBe('run:cand');
});

test('a pinned run that is not in the report is said to be missing, and no other run stands in', async () => {
  const localStore = await seed();
  atlas = await openAtlas({ at: '/?tab=compare&base=run%3Abase&cand=run%3Aexpired', specs: {}, deps: { localStore } });
  await atlas.until(() => document.querySelector('[data-compare-missing]') !== null, 'the missing run');
  expect(document.querySelector('[data-compare-missing="candidate"]')!.textContent).toContain('run:expired');
  expect(document.querySelector('table[data-compare-results]')).toBeNull();
});

test('swapping and choosing runs changes the address, and the Runs tab offers a run as baseline or candidate', async () => {
  const { atlas: view } = await open();
  await view.click('button', 'Swap baseline and candidate');
  await view.until(() => view.router.state.location.search.base === 'run:cand', 'swapped');
  expect(view.router.state.location.search).toMatchObject({ base: 'run:cand', cand: 'run:base' });
  // Swapped, the same behavior is now a recovery.
  await view.until(() => row('Pay with a card')?.getAttribute('data-group') === 'recovered', 'a recovery');
  await view.go('/?tab=runs&openRun=run%3Anewer');
  await view.go('/?tab=runs&openRun=run%3Acand');
  await view.until(() => view.find('a', 'Compare with this run as the baseline') !== undefined, 'the run');
  await view.click('a', 'Compare with this run as the baseline');
  await view.until(() => view.router.state.location.search.tab === 'compare', 'the compare tab');
  expect(view.router.state.location.search.base).toBe('run:cand');
});

test('4: opening a reworded behavior shows both wordings and the changed steps beside the outcomes', async () => {
  const { atlas: view } = await open();
  await openPair(view, 'Add a tip of ten percent');
  expect(document.querySelector('[data-promise]')!.getAttribute('data-promise')).toBe('changed');
  const promise = panel().textContent!;
  expect(promise).toContain('Add a tip');
  expect(promise).toContain('Add a tip of ten percent');
  expect(promise).toContain('worded differently');
  await act(async () => tab('Outcomes').click());
  const outcomes = panel().textContent!;
  expect(outcomes).toContain('Passed');
  expect(outcomes).toContain('Failed');
});

test('3: each recording keeps its own attempt, revision and time origin, and seeking both uses each side\'s own step time', async () => {
  const { atlas: view } = await open();
  await openPair(view, 'Pay with a card');
  expect(document.querySelector('[data-promise]')!.getAttribute('data-promise')).toBe('revision-differs');
  await view.until(() => document.querySelectorAll('[role="tabpanel"] ol').length === 2, 'both step lists');
  await act(async () => tab('Recordings').click());
  await view.until(() => video('baseline') !== null && video('candidate') !== null, 'both recordings');
  expect(video('baseline')!.getAttribute('aria-label')).toContain('base-pay.webm');
  expect(video('candidate')!.getAttribute('aria-label')).toContain('cand-pay.webm');
  expect(video('baseline')!.getAttribute('preload')).toBe('metadata');
  const facts = panel().textContent!;
  expect(facts).toContain('spec revision rev-1');
  expect(facts).toContain('spec revision rev-2');
  expect(facts).toContain('Time 0 is the start of this recording');
  await select('Go to a step', 'pay');
  expect(video('baseline')!.currentTime).toBe(4);
  expect(video('candidate')!.currentTime).toBe(9);
  expect(document.querySelector('[data-alignment]')!.getAttribute('data-alignment')).toBe('aligned');
});

test('3: absent alignment and a missing recording are explained', async () => {
  const { atlas: view } = await open();
  await openPair(view, 'Refund a payment');
  await act(async () => tab('Recordings').click());
  await view.until(() => document.querySelector('[data-alignment]') !== null, 'the explanation');
  expect(video('baseline')).toBeNull();
  expect(video('candidate')).toBeNull();
  expect(document.querySelector('[data-recording-state="none"]')!.textContent).toContain('No recording was published');
  expect(document.querySelector('[data-alignment]')!.textContent).toContain('cannot be aligned');
});

test('7: keyboard-only review: switching between promise, outcomes and recordings keeps the players and their controls operable', async () => {
  const { atlas: view } = await open();
  await openPair(view, 'Pay with a card');
  const list = document.querySelector('[role="tablist"][aria-label="What to compare"]')!;
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs.map((item) => item.textContent)).toEqual(['Promise', 'Outcomes', 'Recordings', 'Figures']);
  expect(tabs.every((item) => item.tabIndex >= -1)).toBe(true);
  // A tab is operated with the keyboard: arrow keys move through the tabs, Enter or Space activates.
  const outcomes = tab('Outcomes');
  await act(async () => tab('Promise').focus());
  await act(async () => void tab('Promise').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(outcomes);
  await act(async () => outcomes.click());
  expect(outcomes.getAttribute('aria-selected')).toBe('true');
  await act(async () => tab('Recordings').click());
  await view.until(() => video('baseline') !== null && video('candidate') !== null, 'both recordings');
  const before = plays.length;
  await view.click('button', 'Play both');
  expect(plays.length).toBe(before + 2);
  await act(async () => tab('Promise').click());
  await act(async () => tab('Recordings').click());
  await view.until(() => video('baseline') !== null, 'the recording again');
  const again = plays.length;
  await view.click('button', 'Play both');
  expect(plays.length).toBe(again + 2);
  await view.click('button', 'Pause both');
  // Every control has a name.
  expect([...document.querySelectorAll('[role="tabpanel"] button')].every((item) => item.textContent!.trim() !== '' || item.getAttribute('aria-label'))).toBe(true);
});

test('5: figures are compared like for like, and a difference of conditions or a missing metric is disclosed', async () => {
  const { atlas: view } = await open();
  await openPair(view, 'Pay with a card');
  await act(async () => tab('Figures').click());
  await view.until(() => document.querySelector('[data-metric]') !== null, 'the latency');
  expect(document.querySelector('[data-metric]')!.getAttribute('data-metric')).toBe('compared');
  expect(text()).toContain('Change +500');
  expect(text()).toContain('Test execution time');
  // Reliability rests on one execution each: shown with its count, flagged, and no change is computed.
  const reliability = document.querySelector('[aria-label="Reliability"]')!;
  expect(reliability.textContent).toContain('1 independent execution');
  expect(reliability.textContent).toContain('Insufficient evidence');
  expect(reliability.querySelector('[data-reliability="not-comparable"]')!.textContent).toContain('No change is computed');
  expect(reliability.textContent).toContain('different revisions of the spec');
});

test('5: results recorded under different devices are paired as different conditions and compare no figures', async () => {
  const localStore = memoryStore();
  await publish(localStore, 'base', 1_000, 'rev-1', [{ id: 'pay', title: 'Pay with a card', status: 'passed', measurements: [latency(400), latency(410), latency(420), latency(430), latency(440)] }], 'desktop-web');
  await publish(localStore, 'cand', 2_000, 'rev-1', [{ id: 'pay', title: 'Pay with a card', status: 'passed', measurements: [latency(200), latency(210), latency(220), latency(230), latency(240)] }], 'ios');
  atlas = await openAtlas({ at: COMPARE, specs: {}, deps: { localStore } });
  await atlas.until(() => document.querySelectorAll('table[data-compare-results] tbody tr').length === 1, 'the comparison');
  expect(row('Pay with a card').getAttribute('data-group')).toBe('not-comparable');
  expect(row('Pay with a card').textContent).toContain('Conditions differ');
  await atlas.click('a', 'Compare Pay with a card');
  await atlas.until(() => document.querySelector('[role="tablist"][aria-label="What to compare"]') !== null, 'the behavior');
  await act(async () => tab('Figures').click());
  await atlas.until(() => document.querySelector('[data-metric]') !== null, 'the latency');
  expect(document.querySelector('[data-metric]')!.getAttribute('data-metric')).toBe('incompatible');
  expect(text()).toContain('No change is computed');
  expect(text()).toContain('environment desktop-web against ios');
  expect(text()).not.toContain('Change −');
});
