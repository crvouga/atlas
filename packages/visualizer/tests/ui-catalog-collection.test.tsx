import { afterEach, expect, test } from 'bun:test';
import { resolveCatalog } from '@crvouga/atlas/reports/ui-catalog-definition';

import { createNode } from '../../server/tests/node-compat';
import { memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

async function serve() {
  const node = createNode({ stores: [{ id: 'data', store: memoryStore(), label: 'Shared store' }], refreshMs: 60_000 });
  await node.ready;
  const send = (path: string, method: string, body?: unknown) => node.fetch(new Request(`http://atlas.test/api${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { node, send };
}

test('the Collection panel shows what is left by tier, the claims being collected and the shards', async () => {
  const { node, send } = await serve();
  const { version, document: definition } = await resolveCatalog({ name: 'web-app', matrix: { dimensions: { scheme: { values: ['light', 'dark'] } } }, states: [{ id: 'home' }, { id: 'cart' }] });
  expect((await send(`/ui-catalog/definitions/${version}`, 'PUT', definition)).status).toBe(201);
  expect((await send('/ui-catalog/claims', 'POST', { shard: 'ci-shard-1', definition: version, batchSize: 1 })).status).toBe(200);
  atlas = await openAtlas({ at: '/catalog', deps: {}, specs: {}, node, queue: true });
  await atlas.sees('Collection status');
  expect(atlas.text()).not.toContain('Collection of web-app');
  expect(atlas.requests.some(request => request.includes('/ui-catalog/queue'))).toBe(false);
  await atlas.click('button', 'Collection status');
  await atlas.sees('Collection of web-app');
  expect(atlas.text()).toContain('3 units to collect, 1 being collected');
  expect(atlas.text()).toContain('3 not collected yet');
  const claims = document.querySelector('table[aria-label="Being collected now"]')!;
  expect(claims.textContent).toContain('ci-shard-1');
  expect(claims.textContent).toContain('0 of 1');
  expect(document.querySelector('[data-shard="ci-shard-1"]')?.textContent).toContain('Active');
  node.close();
});

test('without a published definition the catalog shows no Collection panel', async () => {
  const { node } = await serve();
  atlas = await openAtlas({ at: '/catalog', deps: {}, specs: {}, node, queue: true });
  await atlas.sees('Collection status');
  await atlas.click('button', 'Collection status');
  // Give the queue request time to answer: with no definition it answers, and nothing is drawn.
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(atlas.text()).not.toContain('Collection of');
  expect(atlas.text()).toContain('No collection definition has been published');
  node.close();
});
