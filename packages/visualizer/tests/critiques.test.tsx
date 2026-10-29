import { afterEach, expect, test } from 'bun:test';
import { buildCritique, defineCritic, publishCritiques, type CritiqueOutcome } from '@crvouga/atlas/critics';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { uiStateLayer, type UiStateCapture } from '@crvouga/atlas/reports/ui-catalog-publish';
import { catalogEntries } from '@crvouga/atlas/reports/ui-catalog-entries';
import { act } from 'react';

import { createNode } from '../../server/tests/node-compat';
import { memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const profile = { environment: 'desktop-web', profile: { viewport: '1280x800' } } as const;
const shot = (id: string, extra: Partial<UiStateCapture> = {}, picture = id): UiStateCapture => ({ id, title: `Screen ${id}`, route: `/${id}`, screenshot: { data: new TextEncoder().encode(`png:${picture}`), width: 100, height: 50 }, ...extra });
const rows = () => [...document.querySelectorAll<HTMLElement>('table[aria-label^="States ranked"] tbody tr')].map((row) => row.dataset.entry);

const critic = (name: string, version = '1.0.0') => defineCritic({ name, version, kind: 'model', describe: () => ({ sendsImagesTo: null, needsSetup: false }), evaluate: async () => ({ verdict: { score: 0 } }) });

/** What a critic would publish for every entry of a store, with the answer chosen per entry. */
async function critique(store: ReturnType<typeof memoryStore>, who: ReturnType<typeof critic>, answers: Record<string, Parameters<typeof buildCritique>[3]>, at = 100) {
  const index = (await import('@crvouga/atlas/reports/report-index')).ReportIndex;
  const reading = new index([{ id: 'data', store }]);
  await reading.refresh();
  const { entries } = catalogEntries(reading.snapshot().layers);
  const outcomes: CritiqueOutcome[] = entries.filter((entry) => answers[entry.stateId]).map((entry) => {
    const subject = { key: entry.key, title: entry.title, state: entry.state, imageSha256: entry.image.sha256 };
    return { entry: subject, critique: buildCritique(who, who.describe(), subject, answers[entry.stateId]!) };
  });
  await publishCritiques(store, { critic: who, outcomes, recordedAtMs: at });
}

async function open(store: ReturnType<typeof memoryStore>, at = '/critiques') {
  const node = createNode({ stores: [{ id: 'backend-0', store, label: 'Shared store' }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at, deps: {}, specs: {}, node });
  return node;
}

test('ranks the states a critic judged, lowest first, with opinions that are not test results', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...profile, states: [shot('home'), shot('cart'), shot('pay'), shot('help')] }));
  await critique(store, critic('uiclip'), { home: { verdict: { score: 0.8, label: 'ok' } }, cart: { verdict: { score: 0.2, label: 'needs-polish' } }, pay: { verdict: { score: 0.5 }, findings: [{ id: 'f1', category: 'spacing', severity: 'major', rationale: 'Cramped', suggestion: 'Pad it', region: { unit: 'px', x: 1, y: 2, w: 3, h: 4 } }] } });
  const node = await open(store);
  await atlas!.sees('Needs polish');
  await atlas!.until(() => rows().length === 3, 'three ranked states');
  expect(rows()).toEqual(['cart@desktop-web;viewport=1280x800', 'pay@desktop-web;viewport=1280x800', 'home@desktop-web;viewport=1280x800']);
  expect(atlas!.text()).toContain('1 not judged yet');
  expect(atlas!.text()).toContain('major');
  // An opinion is never a pass or a failure.
  expect(atlas!.text()).not.toMatch(/\bPassed\b|\bFailed\b/);
  // Only what is on screen is fetched, lazily.
  expect(document.querySelector<HTMLImageElement>('table img')!.getAttribute('loading')).toBe('lazy');
  node.close();
});

test('9. a state whose picture changed after it was judged is shown as judged on an earlier picture, not ranked, and counts as not judged', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...profile, states: [shot('home'), shot('cart')] }));
  await critique(store, critic('uiclip'), { home: { verdict: { score: 0.1 } }, cart: { verdict: { score: 0.9 } } });
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 200, ...profile, states: [shot('home', {}, 'home-redesigned')] }));
  const node = await open(store);
  await atlas!.sees('Not judged at the current picture');
  expect(rows()).toEqual(['cart@desktop-web;viewport=1280x800']);
  expect(atlas!.text()).toContain('The picture changed since it was judged');
  await atlas!.go('/critiques?entry=home%40desktop-web%3Bviewport%3D1280x800');
  await atlas!.sees('This critique judged an earlier picture');
  node.close();
});

test('12. a critic that could not judge says why and is not ranked; it says nothing about the picture', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...profile, states: [shot('home'), shot('cart')] }));
  await critique(store, critic('vision'), { home: { verdict: { score: 0.4 } }, cart: { failure: { reason: 'rate-limited', message: 'slow down' } } });
  const node = await open(store, '/critiques?entry=cart%40desktop-web%3Bviewport%3D1280x800');
  await atlas!.sees('The critic could not judge this picture');
  expect(atlas!.text()).toContain('rate-limited');
  expect(atlas!.text()).toContain('This says nothing about the picture');
  expect(rows()).toEqual(['home@desktop-web;viewport=1280x800']);
  node.close();
});

test('an open critique shows the findings, the score in context and where the opinion came from', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...profile, states: [shot('home', { kind: 'overlay' })] }));
  await critique(store, critic('vision'), { home: { verdict: { score: 0.3, label: 'needs-polish', confidence: 0.7, relative: { stateKind: 'overlay', percentile: 12, sampleSize: 9 } }, findings: [{ id: 'f1', category: 'spacing', severity: 'minor', rationale: 'Label touches both edges.', suggestion: 'Increase padding.' }, { id: 'f2', category: 'sparkle', severity: 'extreme' }], usage: { inputTokens: 10, outputTokens: 5 } } });
  const node = await open(store, '/critiques?entry=home%40desktop-web%3Bviewport%3D1280x800');
  await atlas!.sees('Label touches both edges.');
  expect(atlas!.text()).toContain('Increase padding.');
  expect(atlas!.text()).toContain('12th percentile among 9 scores of overlay');
  // An unknown category and severity are shown generically, never dropped.
  expect(atlas!.text()).toContain('sparkle');
  expect(atlas!.text()).toContain('extreme');
  expect(atlas!.text()).toContain('Confidence 70%');
  await act(async () => document.querySelector<HTMLElement>('button[aria-label="Close the critique"]')!.click());
  await atlas!.until(() => !document.body.textContent?.includes('Label touches both edges.'), 'closed');
  node.close();
});

test('with several critics each ranks apart, chosen in the address; a state kind narrows the list', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...profile, states: [shot('home'), shot('spin', { kind: 'loading' })] }));
  await critique(store, critic('uiclip'), { home: { verdict: { score: 0.9 } }, spin: { verdict: { score: 0.1 } } });
  await critique(store, critic('vision'), { home: { verdict: { score: 0.2 } }, spin: { verdict: { score: 0.8 } } }, 101);
  const node = await open(store, '/critiques?critic=vision');
  await atlas!.until(() => rows().length === 2, 'two rows');
  expect(rows()).toEqual(['home@desktop-web;viewport=1280x800', 'spin@desktop-web;viewport=1280x800']);
  await atlas!.go('/critiques?critic=uiclip&kind=loading');
  await atlas!.until(() => rows().length === 1, 'one row');
  expect(rows()).toEqual(['spin@desktop-web;viewport=1280x800']);
  node.close();
});

test('critiques never enter the numbers of the report: a store of opinions alone has no test results', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, ...profile, states: [shot('home')] }));
  await critique(store, critic('uiclip'), { home: { verdict: { score: 0.01 } } });
  const node = await open(store, '/');
  await atlas!.sees('Needs polish');
  expect(atlas!.text()).not.toMatch(/0\.01/);
  node.close();
});

test('a project with no critiques says how one is made', async () => {
  const node = await open(memoryStore());
  await atlas!.sees('No critic has judged a captured UI state yet');
  node.close();
});
