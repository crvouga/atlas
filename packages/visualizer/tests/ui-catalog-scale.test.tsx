/**
 * Issue #94: the catalog page of a large catalog, served by an Atlas server, reads a bounded set of requests: the index (and
 * its first page), the evidence of the cards on screen, and deltas as results arrive. Never the report's whole evidence or
 * the test catalog. Budgets for decoded bytes, requests and time are recorded in `ui-catalog-budget.json`, measured over a
 * synthetic catalog here, and compared with the page reading everything (an older server).
 */
import { afterEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { uiStateLayer } from '@crvouga/atlas/reports/ui-catalog-publish';

import { createNode, type Node } from '../../server/tests/node-compat';
import { REPORTS_URL } from './preload';
import { memoryStore, openAtlas, type Atlas } from './atlas';
import BUDGET from './ui-catalog-budget.json';

let atlas: Atlas | null = null;
let node: Node | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
  node?.close();
  node = null;
});

const PROFILES = [
  { environment: 'desktop-web', profile: { viewport: '1280x800', scheme: 'light' } },
  { environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'dark' } }
] as const;
/** Every other check of the report: what a project's tests add to the evidence the catalog page must not read. */
const BEHAVIOR_CHECKS = 4000;

/** A synthetic project: `BUDGET.states` UI states in two profiles, in shards, beside a large suite of ordinary checks. */
async function project() {
  const store = memoryStore();
  for (const where of PROFILES) {
    for (let shard = 0; shard < 4; shard++) {
      const states = [];
      for (let n = shard; n < BUDGET.states; n += 4) states.push({ id: `area${n % 20}/screen${n}`, title: `Screen ${n} ${n % 7 ? 'settings' : 'payment failed'}`, route: `/area${n % 20}/${n}`, area: `area${n % 20}`, flags: [`flag${n % 5}`], covers: [`surface${n % 50}`], kind: 'screen', status: n % 50 === 0 ? 'failed' as const : 'passed' as const, screenshot: { data: new TextEncoder().encode(`png:${n}:${where.profile.scheme}`), width: 390, height: 844 } });
      await publishChecks(store, uiStateLayer({ producer: `capture-${shard}`, recordedAtMs: 100 + shard, ...where, shard: `${shard + 1}/4`, states }));
    }
  }
  await publishChecks(store, {
    producer: 'unit', kind: 'behavior', recordedAtMs: 50, branch: 'main', environment: 'ci',
    checks: Array.from({ length: BEHAVIOR_CHECKS }, (_, n) => ({ id: `unit/check-${n}`, title: `Check ${n} of the domain model`, status: 'passed' as const, detail: `It holds for case ${n} with a long enough description of what was verified`, specPath: `specs/domain/${n % 40}.feature` }))
  });
  node = createNode({ stores: [{ id: 'data', store, label: 'Store' }], refreshMs: 60_000 });
  await node.ready;
  return store;
}

/** The decoded bytes of what the page asked the reports API for, answered again by the same server. */
async function decodedBytes(paths: readonly string[]) {
  let bytes = 0;
  for (const path of paths) bytes += (await (await node!.fetch(new Request(`${REPORTS_URL}${path}`))).arrayBuffer()).byteLength;
  return bytes;
}

const cards = () => document.querySelectorAll('[role="list"][aria-label="States"] [role="listitem"]').length;

test('5. a filtered deep link into a large catalog stays within its recorded request, byte and time budgets', async () => {
  await project();
  const started = performance.now();
  atlas = await openAtlas({ at: '/catalog?find=area3', deps: {}, specs: {}, node: node! });
  await atlas.until(() => cards() > 0 && !document.querySelector('[data-catalog-partial]'), 'the first cards of the whole index');
  const openMs = performance.now() - started;
  const requests = [...atlas.requests];
  // 1. Only the catalog's own requests: the index, its first page, the evidence of the cards on screen, and the outline.
  expect(requests.filter(path => /^\/(evidence\/effective|evidence\?|evidence$|tests)/.test(path))).toEqual([]);
  expect(requests.length).toBeLessThanOrEqual(BUDGET.requests);
  const bytes = await decodedBytes(requests);
  expect(bytes).toBeLessThanOrEqual(BUDGET.decodedBytes);

  // Typing a search answers from what is held: no request, within the interaction budget.
  const typed = performance.now();
  await atlas.go('/catalog?find=area3%20payment');
  await atlas.until(() => atlas!.text().includes('payment failed'), 'the narrowed cards');
  const searchMs = performance.now() - typed;
  const afterSearch = atlas.requests.length;
  expect(afterSearch - requests.length).toBeLessThanOrEqual(1);
  expect(openMs).toBeLessThanOrEqual(BUDGET.openMs);
  expect(searchMs).toBeLessThanOrEqual(BUDGET.searchMs);

  // The same link, read the old way (a server that does not announce the index), decodes the report's whole evidence.
  await atlas.close();
  atlas = await openAtlas({ at: '/catalog?find=area3', deps: {}, specs: {}, node: node!, catalogIndex: false });
  await atlas.until(() => cards() > 0, 'the cards, composed in the browser');
  const legacy = await decodedBytes(atlas.requests.filter(path => path.startsWith('/evidence/effective')));
  expect(bytes * BUDGET.smallerThanWholeEvidenceBy).toBeLessThanOrEqual(legacy);
  console.log(JSON.stringify({ states: BUDGET.states, requests: requests.length, decodedBytes: bytes, legacyDecodedBytes: legacy, openMs: Math.round(openMs), searchMs: Math.round(searchMs) }));
});

test('2. a result that arrives is read as a delta: the changed state, never the whole evidence again', async () => {
  const store = await project();
  atlas = await openAtlas({ at: '/catalog?find=screen1', deps: {}, specs: {}, node: node! });
  await atlas.until(() => cards() > 0 && !document.querySelector('[data-catalog-partial]'), 'the catalog');
  const before = atlas.requests.length;
  await publishChecks(store, uiStateLayer({ producer: 'capture-late', recordedAtMs: 500, ...PROFILES[0], states: [{ id: 'area1/screen1', title: 'Screen 1 redesigned', route: '/area1/1', screenshot: { data: new TextEncoder().encode('png:new'), width: 390, height: 844 } }] }));
  await node!.index.refresh();
  await atlas.pollReport();
  await atlas.sees('Screen 1 redesigned');
  const after = atlas.requests.slice(before);
  expect(after.some(path => path.includes('view=index') && path.includes('since='))).toBe(true);
  expect(after.filter(path => path.includes('view=index') && !path.includes('since='))).toEqual([]);
  expect(after.filter(path => path.startsWith('/evidence'))).toEqual([]);
  // Only the changed state's evidence is read again.
  const reread = after.filter(path => path.startsWith('/ui-catalog?id='));
  expect(reread.length).toBe(1);
  const delta = await decodedBytes(after.filter(path => path.includes('since=')));
  console.log(JSON.stringify({ deltaBytes: delta }));
  expect(delta).toBeLessThanOrEqual(BUDGET.deltaBytes);
});

test('4. when the rest of a large catalog cannot be read, what was read stays usable and its counts are labelled partial', async () => {
  await project();
  const failing = { value: true };
  atlas = await openAtlas({
    at: '/catalog', deps: {}, specs: {}, node: node!,
    intercept: path => (failing.value && path.startsWith('/ui-catalog?view=index&limit=1000000') ? new Response('{"title":"busy"}', { status: 503 }) : undefined)
  });
  await atlas.sees('Part of the catalog could not be read');
  expect(atlas.text()).toContain(`48 of ${BUDGET.states} states`);
  expect(cards()).toBeGreaterThan(0);
  // A search over part of the catalog never says there is no such state.
  await atlas.go('/catalog?find=nothing-like-this');
  await atlas.sees('Nothing matches among the states read so far.');
  failing.value = false;
  await atlas.click('button', 'Try again');
  await atlas.until(() => !document.querySelector('[data-catalog-partial]'), 'the whole index');
  await atlas.sees('Nothing matches these filters.');
});
