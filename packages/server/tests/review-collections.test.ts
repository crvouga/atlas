import { afterEach, describe, expect, test } from 'bun:test';

import { layerKey } from '../../reports/src/layer-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { memoryStore } from '../../reports/tests/memory-store';
import type { ReviewCollection, ReviewManifest, ReviewNote } from '../../reports/src/review-collection';
import { createAtlasServer, type AtlasServer } from '../src/app';

const servers: AtlasServer[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

const TOKENS = [{ name: 'admin', role: 'admin' as const, token: 'admin-token-123456' }, { name: 'ana', role: 'publish' as const, token: 'publish-token-12345' }, { name: 'eyes', role: 'read' as const, token: 'read-token-1234567' }];
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const json = { 'content-type': 'application/json' };
const publisher = { ...json, ...bearer(TOKENS[1]!.token) };
const reader = bearer(TOKENS[2]!.token);

async function start(options: { open?: boolean; store?: ReturnType<typeof memoryStore>; now?: () => number; anonymousRead?: boolean } = {}) {
  const store = options.store ?? memoryStore();
  const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', ...(options.open ? {} : { tokens: TOKENS }), ...(options.anonymousRead ? { anonymousRead: true } : {}), refreshMs: 60_000, ...(options.now ? { now: options.now } : {}) });
  servers.push(server);
  await server.ready;
  const call = (path: string, init: RequestInit = {}) => server.fetch(new Request(`http://atlas.test${path}`, init));
  return { store, server, call };
}

/** One execution (run A, B…) that recorded a movie for `checkout`. */
async function execution(store: ReturnType<typeof memoryStore>, input: { runUrl: string; at: number; status: 'passed' | 'failed' | 'running' | 'not-run'; movie: number; attempts?: ('failed' | 'passed')[] }) {
  return publishChecks(store, {
    producer: 'e2e', environment: 'web', recordedAtMs: input.at, runUrl: input.runUrl, sha: `${input.movie}`.repeat(40).slice(0, 40),
    checks: [{ id: 'checkout', title: 'Checkout', status: input.status, attachments: [{ id: 'movie', name: `take ${input.movie}/checkout.webm`, data: new Uint8Array([input.movie, 2, 3]), contentType: 'video/webm', role: 'video' }], ...(input.attempts ? { attempts: input.attempts.map((status, index) => ({ index, status })) } : {}) }]
  });
}
const publish = (call: ReturnType<typeof start> extends Promise<infer T> ? T extends { call: infer C } ? C : never : never, body: unknown, headers: Record<string, string> = publisher) =>
  call('/api/reports/review-collections', { method: 'POST', headers, body: JSON.stringify(body) });

describe('review collections', () => {
  test('1: recordings from runs A and B are recorded with each source layer, run, revision and status, and never as one execution', async () => {
    const { store, server, call } = await start({ now: () => 7_000 });
    const a = await execution(store, { runUrl: 'https://ci.test/runs/a', at: 100, status: 'passed', movie: 1 });
    const b = await execution(store, { runUrl: 'https://ci.test/runs/b', at: 200, status: 'failed', movie: 2 });
    await server.index.refresh();

    const response = await publish(call, { title: 'Checkout walkthrough', purpose: 'Show checkout', audience: 'Support', tags: ['#Demo'], entries: [{ layer: a.id, check: 'checkout', caption: 'The happy path' }, { layer: b.id, check: 'checkout' }] });
    expect(response.status).toBe(201);
    const collection = await response.json() as ReviewCollection;
    expect(collection).toMatchObject({ schemaVersion: 1, revision: 1, title: 'Checkout walkthrough', tags: ['demo'], createdBy: 'ana', createdAtMs: 7_000 });
    expect(collection.id).toMatch(/^rc-[0-9a-f]{16}$/);
    expect(collection.entries.map(entry => [entry.id, entry.source.layer, entry.snapshot.status, entry.snapshot.run === collection.entries[0]!.snapshot.run])).toEqual([['e1', a.id, 'passed', true], ['e2', b.id, 'failed', false]]);
    expect(collection.entries[0]!.snapshot.sha).toBe(a.sha ?? null);
    expect(collection.entries[0]!.snapshot.videos?.[0]).toMatchObject({ name: 'take 1/checkout.webm', available: true });
    // It is not a run: it has no status and added no layer or check.
    expect(collection).not.toHaveProperty('status');
    expect((await store.listKeys('layers/index/')).length).toBe(2);
    const listed = await (await call('/api/reports/review-collections', { headers: reader })).json() as { collections: { id: string; entries: number; revisions: number }[] };
    expect(listed.collections).toMatchObject([{ id: collection.id, entries: 2, revisions: 1 }]);
  });

  test('2: failed, retried and later passing entries stay in the order the curator chose, each with its own status and tries', async () => {
    const { store, server, call } = await start();
    const failed = await execution(store, { runUrl: 'https://ci.test/runs/1', at: 100, status: 'failed', movie: 1, attempts: ['failed', 'failed'] });
    const incomplete = await execution(store, { runUrl: 'https://ci.test/runs/2', at: 200, status: 'not-run', movie: 2 });
    const replay = await execution(store, { runUrl: 'https://ci.test/runs/3', at: 300, status: 'passed', movie: 3, attempts: ['failed', 'passed'] });
    await server.index.refresh();
    // The replay is listed first on purpose: the order is the curator's, not time's or status's.
    const response = await publish(call, { title: 'Takes', entries: [{ layer: replay.id, check: 'checkout' }, { layer: failed.id, check: 'checkout' }, { layer: incomplete.id, check: 'checkout' }] });
    const collection = await response.json() as ReviewCollection;
    expect(response.status, JSON.stringify(collection)).toBe(201);
    expect(collection.entries.map(entry => entry.snapshot.status)).toEqual(['passed', 'failed', 'not-run']);
    expect(collection.entries.map(entry => entry.snapshot.attemptStatuses)).toEqual([['failed', 'passed'], ['failed', 'failed'], undefined]);
    const detail = await (await call(`/api/reports/review-collections/detail?id=${collection.id}`, { headers: reader })).json() as { collection: ReviewCollection };
    expect(detail.collection.entries.map(entry => entry.snapshot.recordedAtMs)).toEqual([300, 100, 200]);
  });

  test('3: a frozen collection does not change when later runs arrive or source tags change; a new revision is explicit and the old one stays', async () => {
    const { store, server, call } = await start();
    const a = await execution(store, { runUrl: 'https://ci.test/runs/a', at: 100, status: 'passed', movie: 1 });
    await server.index.refresh();
    const created = await (await publish(call, { title: 'Demo', entries: [{ layer: a.id, check: 'checkout' }], gaps: [{ note: 'No refund recording', after: 1 }] })).json() as ReviewCollection;
    const before = await (await call(`/api/reports/review-collections/detail?id=${created.id}`, { headers: reader })).text();

    await execution(store, { runUrl: 'https://ci.test/runs/b', at: 500, status: 'passed', movie: 2 });
    await server.index.refresh();
    await call('/api/reports/artifact-tags', { method: 'POST', headers: publisher, body: JSON.stringify({ target: { layer: a.id, check: 'checkout', artifact: 'id:movie' }, add: ['wip'] }) });
    expect(await (await call(`/api/reports/review-collections/detail?id=${created.id}`, { headers: reader })).text()).toBe(before);

    // A second revision must name the newest one it is based on.
    const stale = await publish(call, { title: 'Demo v2', basedOn: { id: created.id, revision: 7 }, entries: [{ layer: a.id, check: 'checkout' }] });
    expect(stale.status).toBe(409);
    const next = await publish(call, { title: 'Demo v2', basedOn: { id: created.id, revision: 1 }, entries: [{ layer: a.id, check: 'checkout' }] });
    expect(next.status).toBe(201);
    expect(await next.json()).toMatchObject({ id: created.id, revision: 2, basedOn: { id: created.id, revision: 1 } });
    const old = await (await call(`/api/reports/review-collections/detail?id=${created.id}&revision=1`, { headers: reader })).json() as { collection: ReviewCollection; revisions: number[] };
    expect(old.revisions).toEqual([1, 2]);
    expect(old.collection).toEqual(created);
    const newest = await (await call(`/api/reports/review-collections/detail?id=${created.id}`, { headers: reader })).json() as { collection: ReviewCollection };
    expect(newest.collection.revision).toBe(2);
    expect(created.gaps).toEqual([{ id: 'g1', note: 'No refund recording', after: 1 }]);
  });

  test('4: a time-coded gap note and a reviewed mark keep who and when, and change no outcome, layer or winner', async () => {
    const { store, server, call } = await start({ now: () => 9_000 });
    const a = await execution(store, { runUrl: 'https://ci.test/runs/a', at: 100, status: 'failed', movie: 1 });
    await server.index.refresh();
    const created = await (await publish(call, { title: 'Review', entries: [{ layer: a.id, check: 'checkout' }] })).json() as ReviewCollection;
    const status = async () => (await call('/api/status', { headers: reader })).text();
    const effective = async () => (await call('/api/reports/evidence/effective', { headers: reader })).text();
    const [statusBefore, effectiveBefore, keysBefore] = [await status(), await effective(), (await store.listKeys('layers/')).sort()];

    const note = await call('/api/reports/review-collections/reviews', { method: 'POST', headers: publisher, body: JSON.stringify({ collection: created.id, revision: 1, entry: 'e1', kind: 'gap', text: 'Payment screen never shown', timecodeMs: 12_500 }) });
    expect(note.status).toBe(201);
    expect(await note.json()).toMatchObject({ kind: 'gap', entry: 'e1', timecodeMs: 12_500, by: 'ana', atMs: 9_001 });
    await call('/api/reports/review-collections/reviews', { method: 'POST', headers: publisher, body: JSON.stringify({ collection: created.id, revision: 1, entry: 'e1', kind: 'reviewed' }) });

    const detail = await (await call(`/api/reports/review-collections/detail?id=${created.id}`, { headers: reader })).json() as { reviews: ReviewNote[]; reviewed: Record<string, { by: string }>; collection: ReviewCollection };
    expect(detail.reviews.map(item => [item.kind, item.by])).toEqual([['gap', 'ana'], ['reviewed', 'ana']]);
    expect(detail.reviewed).toEqual({ e1: { by: 'ana', atMs: 9_002 } });
    expect(detail.collection.entries[0]!.snapshot.status).toBe('failed');
    expect(await status()).toBe(statusBefore);
    expect(await effective()).toBe(effectiveBefore);
    expect((await store.listKeys('layers/')).sort()).toEqual(keysBefore);

    // Taking the mark back is a new fact, not an edit: both stay in the trail.
    await call('/api/reports/review-collections/reviews', { method: 'POST', headers: publisher, body: JSON.stringify({ collection: created.id, revision: 1, entry: 'e1', kind: 'unreviewed' }) });
    const again = await (await call(`/api/reports/review-collections/detail?id=${created.id}`, { headers: reader })).json() as { reviews: ReviewNote[]; reviewed: Record<string, unknown> };
    expect(again.reviewed).toEqual({});
    expect(again.reviews.length).toBe(3);
  });

  test('4: notes that are not notes are refused with a reason and record nothing', async () => {
    const { store, server, call } = await start();
    const a = await execution(store, { runUrl: 'https://ci.test/runs/a', at: 100, status: 'passed', movie: 1 });
    await server.index.refresh();
    const created = await (await publish(call, { title: 'Review', entries: [{ layer: a.id, check: 'checkout' }] })).json() as ReviewCollection;
    const keys = (await store.listKeys('curation/review-notes/')).length;
    for (const body of [
      { collection: created.id, revision: 1, kind: 'note' },
      { collection: created.id, revision: 1, kind: 'note', text: 'x', entry: 'e9' },
      { collection: created.id, revision: 1, kind: 'reviewed' },
      { collection: created.id, revision: 1, kind: 'note', text: 'x', timecodeMs: 5 },
      { collection: created.id, revision: 1, kind: 'agreed', text: 'x' }
    ]) {
      const response = await call('/api/reports/review-collections/reviews', { method: 'POST', headers: publisher, body: JSON.stringify(body) });
      expect(response.status).toBe(422);
    }
    expect((await call('/api/reports/review-collections/reviews', { method: 'POST', headers: publisher, body: JSON.stringify({ collection: 'rc-0000000000000000', revision: 1, kind: 'note', text: 'x' }) })).status).toBe(404);
    expect((await store.listKeys('curation/review-notes/')).length).toBe(keys);
  });

  test('5: when a source disappears the entry stays in place with an explanation', async () => {
    const { store, server, call } = await start();
    const a = await execution(store, { runUrl: 'https://ci.test/runs/a', at: 100, status: 'passed', movie: 1 });
    const b = await execution(store, { runUrl: 'https://ci.test/runs/b', at: 200, status: 'passed', movie: 2 });
    await server.index.refresh();
    const created = await (await publish(call, { title: 'Review', entries: [{ layer: a.id, check: 'checkout' }, { layer: b.id, check: 'checkout' }] })).json() as ReviewCollection;
    const open = async () => await (await call(`/api/reports/review-collections/detail?id=${created.id}`, { headers: reader })).json() as { collection: ReviewCollection; availability: { entry: string; state: string; reason?: string }[] };
    expect((await open()).availability.map(item => item.state)).toEqual(['available', 'available']);

    await store.delete(layerKey(a.id));
    // The held-layer answer is kept for a moment; a new server over the same store sees the layer gone.
    const { call: fresh } = await start({ store });
    const detail = await (await fresh(`/api/reports/review-collections/detail?id=${created.id}`, { headers: reader })).json() as { collection: ReviewCollection; availability: { entry: string; state: string; reason?: string }[] };
    expect(detail.collection.entries.map(entry => entry.id)).toEqual(['e1', 'e2']);
    expect(detail.availability[0]).toMatchObject({ entry: 'e1', state: 'unavailable' });
    expect(detail.availability[0]!.reason).toContain('no longer in any backend');
    expect(detail.availability[1]).toMatchObject({ entry: 'e2' });
    expect(detail.collection.entries[0]!.snapshot.title).toBe('Checkout');
  });

  test('6: reading needs a reader and publishing a publish token; a read-only visitor, an anonymous reader and the sign-in box cannot publish', async () => {
    const { store, server, call } = await start({ anonymousRead: true });
    const a = await execution(store, { runUrl: 'https://ci.test/runs/a', at: 100, status: 'passed', movie: 1 });
    await server.index.refresh();
    const body = { title: 'Review', entries: [{ layer: a.id, check: 'checkout' }] };
    expect((await publish(call, body, { ...json, ...reader })).status).toBe(403);
    expect((await publish(call, body, json)).status).toBe(401);
    const basic = `Basic ${Buffer.from(`ana:${TOKENS[1]!.token}`).toString('base64')}`;
    expect((await publish(call, body, { ...json, authorization: basic })).status).toBe(403);
    expect(await store.listKeys('curation/')).toEqual([]);

    const created = await (await publish(call, body)).json() as ReviewCollection;
    expect((await call(`/api/reports/review-collections/detail?id=${created.id}`, { headers: reader })).status).toBe(200);
    // Sharing adds no access: without anonymous reading, an anonymous visitor is asked to sign in.
    const closed = await start({ store });
    expect((await closed.call(`/api/reports/review-collections/detail?id=${created.id}`)).status).toBe(401);
    expect((await closed.call('/api/reports/review-collections')).status).toBe(401);
    expect((await closed.call('/api/reports/review-collections/reviews', { method: 'POST', headers: { ...json, ...reader }, body: JSON.stringify({ collection: created.id, revision: 1, entry: 'e1', kind: 'reviewed' }) })).status).toBe(403);
  });

  test('7: the export names exact sources, digests and safe file names, and lists what is missing', async () => {
    const { store, server, call } = await start({ now: () => 3_000 });
    const a = await execution(store, { runUrl: 'https://ci.test/runs/a', at: 100, status: 'passed', movie: 1 });
    const b = await execution(store, { runUrl: 'https://ci.test/runs/b', at: 200, status: 'failed', movie: 2 });
    await server.index.refresh();
    const created = await (await publish(call, { title: 'Walkthrough', entries: [{ layer: a.id, check: 'checkout' }, { layer: b.id, check: 'checkout' }] })).json() as ReviewCollection;
    await call('/api/reports/review-collections/reviews', { method: 'POST', headers: publisher, body: JSON.stringify({ collection: created.id, revision: 1, entry: 'e2', kind: 'reviewed' }) });
    await store.delete(layerKey(b.id));
    const { call: fresh } = await start({ store, now: () => 3_000 });

    const response = await fresh(`/api/reports/review-collections/export?id=${created.id}`, { headers: reader });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain(`review-${created.id}-r1.json`);
    const manifest = await response.json() as ReviewManifest;
    expect(manifest.collection).toMatchObject({ id: created.id, revision: 1, title: 'Walkthrough' });
    expect(manifest.entries.map(entry => [entry.source.layer, entry.state, entry.reviewed])).toEqual([[a.id, 'available', false], [b.id, 'unavailable', true]]);
    const file = manifest.entries[0]!.files[0]!;
    expect(file).toMatchObject({ name: 'take 1/checkout.webm', safeName: 'checkout.webm', path: 'files/001-checkout.webm', missing: false });
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.entries[1]!.files[0]).toMatchObject({ missing: true, path: 'files/002-checkout.webm' });
    expect(manifest.missing).toMatchObject([{ entry: 'e2' }]);
    expect(manifest.notes).toContain('not one execution');
  });

  test('a request that cannot be resolved is refused with the entry that failed, and records nothing', async () => {
    const { store, server, call } = await start();
    const a = await execution(store, { runUrl: 'https://ci.test/runs/a', at: 100, status: 'passed', movie: 1 });
    await server.index.refresh();
    const keys = async () => (await store.listKeys('curation/')).length;
    const cases: [unknown, string][] = [
      [{ title: 'x', entries: [{ layer: a.id, check: 'checkout' }, { layer: 'c'.repeat(64), check: 'checkout' }] }, 'Entry 2'],
      [{ title: 'x', entries: [{ layer: a.id, check: 'checkout', recording: 'sha256:nope' }] }, 'Entry 1'],
      [{ title: 'x', entries: [{ layer: a.id, check: 'checkout' }, { layer: a.id, check: 'checkout' }] }, 'same source'],
      [{ title: 'x' }, 'at least one'],
      [{ title: '', entries: [{ layer: a.id, check: 'checkout' }] }, 'title'],
      [{ title: 'x', tags: ['#'], entries: [{ layer: a.id, check: 'checkout' }] }, 'tag'],
      [{ title: 'x', gaps: [{ note: 'n', after: 3 }] }, 'after more entries'],
      [{ title: 'x', basedOn: { id: 'rc-0000000000000000', revision: 1 }, entries: [{ layer: a.id, check: 'checkout' }] }, 'No collection']
    ];
    for (const [body, reason] of cases) {
      const response = await publish(call, body);
      expect([422, 404]).toContain(response.status);
      expect(((await response.json()) as { detail: string }).detail).toContain(reason);
    }
    expect((await publish(call, 'not json' as never)).status).toBe(422);
    expect(await keys()).toBe(0);
  });

  test('a recording can be named, and the server says it has collections', async () => {
    const { store, server, call } = await start();
    const a = await execution(store, { runUrl: 'https://ci.test/runs/a', at: 100, status: 'passed', movie: 1 });
    await server.index.refresh();
    const artifacts = await (await call('/api/reports/artifacts', { headers: reader })).json() as { results: { layer: string; id: string; kind: string; videos: { recording: string }[] }[] };
    const result = artifacts.results[0]!;
    const response = await publish(call, { title: 'One clip', entries: [{ layer: result.layer, check: result.id, kind: result.kind, recording: result.videos[0]!.recording }] });
    expect(response.status).toBe(201);
    expect(((await response.json()) as ReviewCollection).entries[0]!.source).toMatchObject({ layer: a.id, kind: 'checks', recording: result.videos[0]!.recording });
    const info = await (await call('/api/server', { headers: reader })).json() as { capabilities: Record<string, boolean> };
    expect(info.capabilities.reviewCollections).toBe(true);
    expect((await call('/api/reports/review-collections/detail', { headers: reader })).status).toBe(400);
    expect((await call('/api/reports/review-collections/detail?id=rc-0000000000000000', { headers: reader })).status).toBe(404);
    expect((await call('/api/reports/review-collections/detail?id=../../layers&revision=x', { headers: reader })).status).toBe(400);
  });
});
