import { afterEach, describe, expect, test } from 'bun:test';

import { foldArtifactTags, targetKey, type ArtifactTagEntry } from '../../reports/src/artifact-tags';
import { publishChecks } from '../../reports/src/publish-checks';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../src/app';

const servers: AtlasServer[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

const TOKENS = [{ name: 'admin', role: 'admin' as const, token: 'admin-token-123456' }, { name: 'ana', role: 'publish' as const, token: 'publish-token-12345' }, { name: 'eyes', role: 'read' as const, token: 'read-token-1234567' }];
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function start(options: { open?: boolean; store?: ReturnType<typeof memoryStore>; now?: () => number; anonymousRead?: boolean } = {}) {
  const store = options.store ?? memoryStore();
  const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', ...(options.open ? {} : { tokens: TOKENS }), ...(options.anonymousRead ? { anonymousRead: true } : {}), refreshMs: 60_000, ...(options.now ? { now: options.now } : {}) });
  servers.push(server);
  await server.ready;
  const call = (path: string, init: RequestInit = {}) => server.fetch(new Request(`http://atlas.test${path}`, init));
  return { store, server, call };
}

async function recording(store: ReturnType<typeof memoryStore>) {
  return publishChecks(store, { producer: 'e2e', environment: 'web', recordedAtMs: 10, checks: [{ id: 'checkout', title: 'Checkout', status: 'passed', attachments: [{ id: 'movie', name: 'checkout.webm', data: new Uint8Array([1, 2, 3]), contentType: 'video/webm', role: 'video' }] }] });
}
const edit = (target: unknown, tags: { add?: string[]; remove?: string[] }) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target, ...tags }) });

describe('reviewer tags on attachments', () => {
  test('a reviewer tags an uploaded recording; it persists with author and time, and the layer, the result and the movie are untouched', async () => {
    const { store, call, server } = await start({ now: () => 5_000 });
    const layer = await recording(store);
    await server.index.refresh();
    const before = { keys: (await store.listKeys('layers/')).sort(), effective: await (await call('/api/reports/evidence/effective', { headers: bearer(TOKENS[2]!.token) })).text() };
    const target = { layer: layer.id, check: 'checkout', artifact: 'id:movie' };

    const response = await call('/api/reports/artifact-tags', { ...edit(target, { add: ['#Demo'] }), headers: { 'content-type': 'application/json', ...bearer(TOKENS[1]!.token) } });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ add: ['demo'], remove: [], by: 'ana', atMs: 5_000, target });

    // After a reload (a new server over the same store) the tag stands, with who and when.
    const { call: again } = await start({ store });
    const listed = await (await again('/api/reports/artifact-tags', { headers: bearer(TOKENS[2]!.token) })).json() as { schemaVersion: number; entries: ArtifactTagEntry[] };
    expect(listed.schemaVersion).toBe(1);
    expect(foldArtifactTags(listed.entries).get(targetKey(target))).toEqual([{ tag: 'demo', by: 'ana', atMs: 5_000 }]);

    expect((await store.listKeys('layers/')).sort()).toEqual(before.keys);
    expect(await (await again('/api/reports/evidence/effective', { headers: bearer(TOKENS[2]!.token) })).text()).toBe(before.effective);
  });

  test('a tag can be removed again, and every edit stays in the audit trail', async () => {
    const { store, call } = await start();
    const layer = await recording(store);
    const target = { layer: layer.id, check: 'checkout', artifact: 'id:movie' };
    const headers = { 'content-type': 'application/json', ...bearer(TOKENS[1]!.token) };
    await call('/api/reports/artifact-tags', { ...edit(target, { add: ['demo', 'wip'] }), headers });
    await call('/api/reports/artifact-tags', { ...edit(target, { remove: ['#WIP'] }), headers });
    const { entries } = await (await call('/api/reports/artifact-tags', { headers: bearer(TOKENS[2]!.token) })).json() as { entries: ArtifactTagEntry[] };
    expect(entries.length).toBe(2);
    expect(foldArtifactTags(entries).get(targetKey(target))?.map(item => item.tag)).toEqual(['demo']);
  });

  test('a read-only visitor can look and is refused an edit; so is an anonymous reader and a browser sign-in box', async () => {
    const { store, call } = await start({ anonymousRead: true });
    const layer = await recording(store);
    const target = { layer: layer.id, check: 'checkout', artifact: 'id:movie' };
    const json = { 'content-type': 'application/json' };
    expect((await call('/api/reports/artifact-tags', { headers: bearer(TOKENS[2]!.token) })).status).toBe(200);
    expect((await call('/api/reports/artifact-tags')).status).toBe(200);

    const reader = await call('/api/reports/artifact-tags', { ...edit(target, { add: ['demo'] }), headers: { ...json, ...bearer(TOKENS[2]!.token) } });
    expect(reader.status).toBe(403);
    expect((await reader.json() as { detail: string }).detail).toContain('needs "publish"');
    expect((await call('/api/reports/artifact-tags', { ...edit(target, { add: ['demo'] }), headers: json })).status).toBe(401);
    const basic = `Basic ${Buffer.from(`ana:${TOKENS[1]!.token}`).toString('base64')}`;
    expect((await call('/api/reports/artifact-tags', { ...edit(target, { add: ['demo'] }), headers: { ...json, authorization: basic } })).status).toBe(403);
    expect(await store.listKeys('curation/')).toEqual([]);
  });

  test('a server without tokens lets anyone on the machine edit, named open', async () => {
    const { store, call } = await start({ open: true });
    const layer = await recording(store);
    const response = await call('/api/reports/artifact-tags', edit({ layer: layer.id, check: 'checkout', artifact: 'id:movie' }, { add: ['demo'] }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ by: 'open' });
  });

  test('an edit that is not one is refused with a reason and records nothing', async () => {
    const { store, call } = await start();
    const headers = { 'content-type': 'application/json', ...bearer(TOKENS[1]!.token) };
    const layer = 'b'.repeat(64);
    const target = { layer, check: 'c', artifact: 'id:x' };
    for (const body of ['not json', '{}', JSON.stringify({ target: { ...target, layer: 'nope' }, add: ['x'] }), JSON.stringify({ target, add: ['#'] }), JSON.stringify({ target, add: [] })]) {
      const response = await call('/api/reports/artifact-tags', { method: 'POST', headers, body });
      expect(response.status).toBe(422);
      expect(((await response.json()) as { detail: string }).detail.length).toBeGreaterThan(5);
    }
    expect(await store.listKeys('curation/')).toEqual([]);
  });

  test('the server says it can tag artifacts', async () => {
    const { call } = await start();
    const info = await (await call('/api/server', { headers: bearer(TOKENS[2]!.token) })).json() as { capabilities: Record<string, boolean>; role: string };
    expect(info.capabilities.artifactTags).toBe(true);
    expect(info.role).toBe('read');
  });

  test('the tests API finds recordings by their producer tag, in either spelling', async () => {
    const { store, call, server } = await start();
    await publishChecks(store, { producer: 'e2e', environment: 'web', recordedAtMs: 10, checks: [{ id: 'checkout', title: 'Checkout', status: 'passed', attachments: [{ name: 'checkout.webm', data: new Uint8Array([1]), contentType: 'video/webm', tags: ['demo'] }] }, { id: 'plain', title: 'Plain', status: 'passed', attachments: [{ name: 'p.webm', data: new Uint8Array([2]), contentType: 'video/webm' }] }] });
    await server.index.refresh();
    for (const spelling of ['demo', '%23demo']) {
      const found = await (await call(`/api/reports/tests?artifactTag=${spelling}`, { headers: bearer(TOKENS[2]!.token) })).json() as { tests: { id: string; artifactTags: string[] }[] };
      expect(found.tests.map(test => [test.id, test.artifactTags])).toEqual([['checkout', ['demo']]]);
    }
  });
});
