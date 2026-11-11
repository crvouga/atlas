import { afterEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { uiStateLayer } from '@crvouga/atlas/reports/ui-catalog-publish';

import { createNode } from '../../server/tests/node-compat';
import { memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

test('#90: an opened state lists the supplemental evidence of its capture, and why any of it was left out', async () => {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({
    producer: 'capture', recordedAtMs: 1, environment: 'desktop-web', profile: { viewport: '1280x800' },
    states: [{ id: 'pay', title: 'Screen pay', status: 'failed', detail: 'never stabilised', screenshot: { data: new TextEncoder().encode('png:pay') },
      attachments: [{ label: 'Order summary', data: new TextEncoder().encode('png:summary') }, { role: 'trace', contentType: 'application/zip', omitted: 'too-large' }] }]
  }));
  const node = createNode({ stores: [{ id: 'backend-0', store, label: 'Shared store' }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at: '/catalog?state=pay', deps: {}, specs: {}, node });
  await atlas.sees('Image profile');
  await atlas.click('button', 'Capture details');
  await atlas.sees('Order summary');
  const list = document.querySelector('[aria-label="More evidence"]');
  expect(list).not.toBeNull();
  expect(list!.querySelector('a')?.getAttribute('href')).toContain('/blobs/');
  expect(list!.textContent).toContain('left out (too-large)');
  expect(atlas.text()).toContain('Capture failed');
});
