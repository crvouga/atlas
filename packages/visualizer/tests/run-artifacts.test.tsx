import { afterEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { readLayer } from '@crvouga/atlas/reports/layer-store';
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
const nodes: { close(): void }[] = [];
afterEach(async () => {
  await atlas?.close();
  atlas = null;
  nodes.splice(0).forEach((node) => node.close());
});

const bytes = (text: string) => new TextEncoder().encode(text);
const movie = (name: string, text: string, extra: Record<string, unknown> = {}) => ({ name, contentType: 'video/webm', data: bytes(text), ...extra });
const RUN = (n: number) => `https://github.com/acme/app/actions/runs/${n}`;
const PAY = { id: 'billing/pay', title: 'Pay an invoice', specPath: 'specs/billing/pay.feature' };
const REFUND = { id: 'billing/refund', title: 'Refund a payment', specPath: 'specs/billing/pay.feature' };
const base = { producer: 'web', environment: 'desktop-web', branch: 'main', sha: 'a'.repeat(40) };

async function open(store: ObjectStore, at: string) {
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  nodes.push(node);
  await node.ready;
  atlas = await openAtlas({ at, specs: {}, deps: {}, node });
  return node;
}
const runAt = (n: number, extra = '') => `/?tab=runs&openRun=${encodeURIComponent(RUN(n))}${extra}`;
const hub = () => document.querySelector<HTMLElement>('section[aria-label="Run artifacts"]')!;
const keyOf = async (store: ObjectStore, id: string, name: string) => (await readLayer(store, id))!.attachments!.find((item) => item.name === name)!.bundleKey!;

/** One run: a review movie and a ZIP on the layer, and two tests that reference the very same recording bytes. */
async function publishReview(store: ObjectStore) {
  const layer = await publishChecks(store, {
    ...base,
    runUrl: RUN(1),
    recordedAtMs: 1_000,
    attachments: [
      movie('review.webm', 'the review', { role: 'demo', tags: ['demo'] }),
      { name: 'review.zip', contentType: 'application/zip', data: bytes('zip'), role: 'archive' }
    ],
    checks: [
      { ...PAY, status: 'passed', attachments: [movie('pay.webm', 'the review')] },
      { ...REFUND, status: 'passed', attachments: [movie('refund.webm', 'shared'), movie('again.webm', 'shared')] }
    ]
  });
  return layer;
}

test('a run shows its movie and archive without opening a test, and explains a recording that several tests share', async () => {
  const store = memoryStore();
  await publishReview(store);
  await open(store, runAt(1));
  await atlas!.until(() => !!hub()?.querySelector('video'), 'the run-level movie');
  const section = hub();
  expect(section.textContent).toContain('review.webm');
  expect(section.textContent).toContain('review.zip');
  // The movie plays inline, the archive is a safe download; the tag of the movie is visible.
  expect(section.querySelector('video')!.getAttribute('src')).toContain('/layers/');
  expect(section.querySelector('li[data-role="archive"] a[download]')).not.toBeNull();
  expect(section.textContent).toContain('demo');
  // Provenance: who recorded it and that the layer has checks of its own.
  expect(section.textContent).toContain('web');
  expect(section.textContent).toContain('2 checks recorded in this layer');
  // The movie is also a test's recording: one recording, said so, with links to the test.
  const shared = section.querySelector('[data-shared]')!;
  expect(shared.textContent).toContain('also referenced by 1 test');
  expect(shared.textContent).toContain('one recording, not 2');
  expect(shared.querySelector('a')!.textContent).toBe('Pay an invoice');
  // The two tests' identical bytes are listed once, not as two recordings.
  const recordings = [...section.querySelectorAll('[data-recording]')];
  expect(recordings.length).toBe(1);
  expect(recordings[0]!.textContent).toContain('2 references to the same recording');
  expect(recordings[0]!.textContent).toContain('Refund a payment');
});

test('a layer of only files is reachable, and a run of no checks is not shown as passed', async () => {
  const store = memoryStore();
  await publishChecks(store, { ...base, runUrl: RUN(7), recordedAtMs: 1_000, attachments: [movie('review.webm', 'only')], checks: [] });
  await open(store, '/?tab=runs');
  await atlas!.until(() => document.querySelectorAll('section[aria-label="Runs"] tbody tr').length === 1, 'the run');
  const row = document.querySelector('section[aria-label="Runs"] tbody tr')!;
  expect(row.textContent).toContain('No checks recorded');
  expect(row.textContent).not.toContain('0 passed');
  expect(row.getAttribute('data-status')).toBe('not-run');
  expect(row.textContent).toContain('1 run file');
  await atlas!.click('a', 'Open run');
  await atlas!.until(() => !!hub()?.querySelector('video'), 'the movie of the layer');
  expect(hub().textContent).toContain('No checks in this layer');
  expect(document.body.textContent).toContain('No tests');
  expect(document.body.textContent).not.toContain('0 passed');
});

test('a copied link selects the same file of the same layer, even after newer runs arrive', async () => {
  const store = memoryStore();
  const layer = await publishReview(store);
  const key = await keyOf(store, layer.id, 'review.webm');
  const link = runAt(1, `&layer=${layer.id}&artifact=${encodeURIComponent(`key:${key}`)}`);
  const node = await open(store, link);
  await atlas!.until(() => !!hub()?.querySelector('li[data-selected]'), 'the selected file');
  const selected = () => hub().querySelector('li[data-selected]')!;
  expect(selected().textContent).toContain('review.webm');
  expect(selected().textContent).toContain('Selected');
  expect(selected().querySelector('video')).not.toBeNull();
  // The file offers the address that reproduces this selection.
  const own = selected().querySelector<HTMLAnchorElement>('a[aria-label="Link to review.webm"]')!;
  expect(own.getAttribute('href')).toContain(`layer=${layer.id}`);
  expect(own.getAttribute('href')).toContain('artifact=');
  // Newer runs arrive: the selection stays on the historical run's file.
  await publishChecks(store, { ...base, runUrl: RUN(2), recordedAtMs: 9_000, attachments: [movie('review.webm', 'newer')], checks: [{ ...PAY, status: 'passed' }] });
  await act(async () => void (await node.index.refresh()));
  await atlas!.pollReport();
  expect(selected().textContent).toContain('review.webm');
  expect(hub().querySelectorAll('li[data-selected]').length).toBe(1);
  expect(atlas!.router.state.location.search).toMatchObject({ openRun: RUN(1), layer: layer.id });
  // The newer run did arrive: it is listed, and the historical selection is not the newest run's file.
  await atlas!.go('/?tab=runs');
  await atlas!.until(() => document.querySelectorAll('section[aria-label="Runs"] tbody tr').length === 2, 'both runs');
});

test('a link to a file the layer does not hold is said so, and nothing else is selected in its place', async () => {
  const store = memoryStore();
  const layer = await publishReview(store);
  await open(store, runAt(1, `&layer=${layer.id}&artifact=${encodeURIComponent('name:missing.webm')}`));
  await atlas!.until(() => !!hub()?.querySelector('video'), 'the files');
  expect(hub().textContent).toContain('That file is not in this run');
  expect(hub().querySelector('li[data-selected]')).toBeNull();
  await atlas!.go(runAt(1, `&layer=${'f'.repeat(64)}&artifact=${encodeURIComponent('name:review.webm')}`));
  await atlas!.until(() => hub()?.textContent?.includes('names a layer that is not part of this run') ?? false, 'the unknown layer');
});

test('a file that was never stored, or cannot be played, says so instead of an empty player', async () => {
  const store = memoryStore();
  const layer = await publishChecks(store, {
    ...base,
    runUrl: RUN(3),
    recordedAtMs: 1_000,
    attachments: [
      { name: 'gone.webm', contentType: 'video/webm' },
      { name: 'remote.webm', contentType: 'video/webm', uri: 'javascript:alert(1)' },
      { name: 'trace.holo', contentType: 'application/x-hologram', data: bytes('h') },
      movie('broken.webm', 'broken')
    ],
    checks: []
  });
  await open(store, runAt(3, `&layer=${layer.id}&artifact=${encodeURIComponent('name:gone.webm')}`));
  await atlas!.until(() => !!hub()?.querySelector('li[data-selected]'), 'the selected file');
  const gone = hub().querySelector('li[data-selected]')!;
  expect(gone.querySelector('video')).toBeNull();
  expect(gone.textContent).toContain('never stored');
  expect(gone.querySelector('[role="alert"]')).not.toBeNull();
  const remote = [...hub().querySelectorAll('li')].find((item) => item.textContent?.includes('remote.webm'))!;
  expect(remote.textContent).toContain('not a web address');
  expect(remote.innerHTML).not.toContain('javascript:');
  const holo = [...hub().querySelectorAll('li')].find((item) => item.textContent?.includes('trace.holo'))!;
  expect(holo.textContent).toContain('no preview');
  expect(holo.querySelector('a[download]')).not.toBeNull();
  // A movie the browser cannot load is replaced by an explanation and the file.
  const video = [...hub().querySelectorAll('video')].find((item) => item.getAttribute('aria-label') === 'broken.webm')!;
  await act(async () => void video.dispatchEvent(new Event('error')));
  const broken = [...hub().querySelectorAll('li')].find((item) => item.textContent?.includes('broken.webm'))!;
  expect(broken.querySelector('video')).toBeNull();
  expect(broken.textContent).toContain('This video cannot be played');
  expect(broken.querySelector('a[download]')).not.toBeNull();
});

test('an HTML archive stays sandboxed and is served by the protected route', async () => {
  const store = memoryStore();
  const layer = await publishChecks(store, {
    ...base,
    runUrl: RUN(4),
    recordedAtMs: 1_000,
    attachments: [{ name: 'gallery.html', contentType: 'text/html', data: bytes('<script>window.pwned=1</script>') }],
    checks: []
  });
  await open(store, runAt(4));
  await atlas!.until(() => !!hub()?.querySelector('iframe'), 'the archive');
  const frame = hub().querySelector('iframe')!;
  // An empty sandbox grants nothing: no scripts, no same-origin access.
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.getAttribute('src')).toContain(`/layers/${layer.id}/blobs/`);
  expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
});
