import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { readLayer } from '@crvouga/atlas/reports/layer-store';

import { createNode } from '../../server/tests/node-compat';
import { verificationOfRun } from '../src/explorer/recording-verification';
import { memoryStore, openAtlas, type Atlas } from './atlas';

class FinderResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FinderResizeObserver as unknown as typeof ResizeObserver;

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const RUN = (n: number) => `https://github.com/acme/app/actions/runs/${n}`;
/** A WebM header and filler, so an intact file passes the container check. */
const webm = (fill: number) => { const data = new Uint8Array(24).fill(fill); data.set([0x1a, 0x45, 0xdf, 0xa3]); return data; };
const runRows = () => [...document.querySelectorAll<HTMLElement>('section[aria-label="Runs"] tbody tr')];
const rowOf = (n: number) => runRows().find((row) => row.querySelector(`a[aria-label="Open run #${n}"]`))!;

/** Three green runs with a recording each: run 1 intact, run 2 whose file is gone from storage, run 3 never read back. */
async function seed() {
  const store = memoryStore();
  const ids: string[] = [];
  for (const n of [1, 2, 3]) {
    const layer = await publishChecks(store, {
      producer: 'web', environment: 'desktop-web', branch: 'main', sha: String(n).repeat(40), runUrl: RUN(n), recordedAtMs: n * 1_000,
      checks: [{ id: 'a', title: 'A', status: 'passed', recordingExpectation: 'required', attachments: [{ name: `${n}.webm`, role: 'video', contentType: 'video/webm', data: webm(n) }] }]
    });
    ids.push(layer.id);
  }
  // Run 2 was stored and acknowledged, and its blob later disappeared.
  const gone = (await readLayer(store, ids[1]!))!;
  for (const entry of Object.values(gone.bundle)) for (const part of entry.parts) await store.delete(part.blob);
  return { store, ids };
}

async function open(search: string, options: { node?: boolean } = {}) {
  const { store, ids } = await seed();
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  // Only a publish token reads blobs: here the server is open, so the call stands for that token.
  const verify = async (layers: string[]) => node.fetch(new Request('http://atlas.test/api/reports/recordings/verification', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layers: layers.map((id) => id.slice(0, 12)) }) }));
  return { node, ids, verify, open: async (verified: string[]) => {
    if (verified.length) { const r = await verify(verified); expect(r.status).toBe(200); }
    atlas = await openAtlas({ at: search, specs: {}, deps: {}, node, ...(options.node === false ? {} : {}) });
    await atlas.until(() => runRows().length === 3, 'three runs');
    return atlas;
  } };
}

test('a run whose stored recording is gone is marked unavailable beside its green tests, with no Watch action', async () => {
  const seeded = await open('/?tab=runs');
  await seeded.open(seeded.ids);
  await atlas!.until(() => rowOf(2).querySelector('[data-stored-videos]') !== null, 'the read-back of run 2');
  const gone = rowOf(2);
  expect(gone.querySelector('[data-stored-videos="unavailable"]')!.textContent).toContain('Recording unavailable: 1 of 1 stored video failed the read-back (1 file gone from storage)');
  // Its tests still passed, and nothing offers to play what is not there.
  expect(gone.textContent).toContain('1 passed');
  expect(gone.querySelector('a[aria-label^="Watch"]')).toBeNull();
  expect(gone.querySelector('[data-video="unavailable"]')).not.toBeNull();
  // Run 1 is intact: verified, and still playable.
  expect(rowOf(1).querySelector('[data-stored-videos="verified"]')!.textContent).toContain('1 stored video verified');
  expect(rowOf(1).querySelector('a[aria-label^="Watch"]')).not.toBeNull();
});

test('a run that was never read back says nothing about its stored files: unknown is not verified', async () => {
  const seeded = await open('/?tab=runs');
  await seeded.open([seeded.ids[0]!]);
  await atlas!.until(() => rowOf(1).querySelector('[data-stored-videos]') !== null, 'the read-back of run 1');
  expect(rowOf(2).querySelector('[data-stored-videos]')).toBeNull();
  expect(rowOf(3).querySelector('[data-stored-videos]')).toBeNull();
  expect(rowOf(3).querySelector('a[aria-label^="Watch"]')).not.toBeNull();
});

test('the opened run repeats the finding with the problem named', async () => {
  const seeded = await open(`/?tab=runs`);
  await seeded.open(seeded.ids);
  await atlas!.until(() => rowOf(2).querySelector('[data-stored-videos]') !== null, 'the read-back');
  await act(async () => rowOf(2).querySelector<HTMLAnchorElement>('a[aria-label="Open run #2"]')!.click());
  await atlas!.until(() => document.querySelector('section[aria-label^="Run"] [data-stored-videos="unavailable"]') !== null, 'the opened run');
  expect(document.querySelector('section[aria-label^="Run"] [data-stored-videos]')!.textContent).toContain('file gone from storage');
});

test('an older server without the route changes nothing in the list', async () => {
  const seeded = await open('/?tab=runs');
  atlas = await openAtlas({ at: '/?tab=runs', specs: {}, deps: {}, node: seeded.node, intercept: (path) => (path.startsWith('/recordings/verification') ? new Response('{}', { status: 404 }) : undefined) });
  await atlas.until(() => runRows().length === 3, 'three runs');
  expect(document.querySelector('[data-stored-videos]')).toBeNull();
  expect(rowOf(2).querySelector('a[aria-label^="Watch"]')).not.toBeNull();
});

test('problems add up across a run’s layers, most common first, and an empty answer is null', () => {
  const layer = (run: string, gaps: string[], checked = 3) => ({ layer: 'x', run, verifiedAtMs: 5, checked, ok: checked - gaps.length, referenced: 0, gaps: gaps.map((problem) => ({ check: 'a', name: 'n', bundleKey: 'k', problem, reason: '' })) });
  const found = verificationOfRun({ schemaVersion: 1, notices: [], layers: [layer('r', ['blob-missing', 'blob-missing', 'checksum-mismatch']), layer('r', ['strange-new-problem'], 1), layer('other', ['blob-missing'])] }, 'r')!;
  expect(found).toMatchObject({ checked: 4, ok: 0, gaps: 4, atMs: 5 });
  expect(found.problems).toEqual(['2 file gone from storage', '1 content differs from what was published', '1 strange-new-problem']);
  expect(verificationOfRun(null, 'r')).toBeNull();
  expect(verificationOfRun({ schemaVersion: 1, notices: [], layers: [] }, 'r')).toBeNull();
});
