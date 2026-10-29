import { afterEach, describe, expect, test } from 'bun:test';

import { publishChecks } from '../../reports/src/publish-checks';
import { readLayer } from '../../reports/src/layer-store';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../src/app';

const clock = { at: 9_000 };
const servers: AtlasServer[] = [];
afterEach(() => { clock.at = 9_000; for (const server of servers.splice(0)) server.close(); });

const TOKENS = [{ name: 'ana', role: 'publish' as const, token: 'publish-token-12345' }, { name: 'eyes', role: 'read' as const, token: 'read-token-1234567' }];
const publisher = { authorization: `Bearer ${TOKENS[0]!.token}`, 'content-type': 'application/json' };
const reader = { authorization: `Bearer ${TOKENS[1]!.token}` };
const URL_ = '/api/reports/recordings/verification';

const webm = (fill: number) => { const bytes = new Uint8Array(24).fill(fill); bytes.set([0x1a, 0x45, 0xdf, 0xa3]); return bytes; };
const video = (name: string, fill: number) => ({ name, role: 'video', contentType: 'video/webm', data: webm(fill) });

async function start(store = memoryStore()) {
  const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', tokens: TOKENS, refreshMs: 60_000, now: () => clock.at });
  servers.push(server);
  await server.ready;
  const call = (path: string, init: RequestInit = {}) => server.fetch(new Request(`http://atlas.test${path}`, init));
  return { store, server, call };
}

async function seeded() {
  const { store, server, call } = await start();
  const layer = await publishChecks(store, {
    producer: 'web', environment: 'desktop-web', branch: 'main', sha: 'a'.repeat(40), runUrl: 'https://ci.test/runs/1', recordedAtMs: 1_000,
    checks: [
      { id: 'a', title: 'A', status: 'passed', attachments: [video('a.webm', 1)] },
      { id: 'b', title: 'B', status: 'passed', attachments: [video('b.webm', 2)] }
    ]
  });
  await server.index.refresh();
  return { store, server, call, layer: (await readLayer(store, layer.id))! };
}

const run = async (call: Awaited<ReturnType<typeof start>>['call'], body?: object) =>
  call(URL_, { method: 'POST', headers: publisher, ...(body ? { body: JSON.stringify(body) } : {}) });

describe('recording verification for the viewer', () => {
  test('nothing is verified until a publish token asks: the reader gets an empty answer, never "fine"', async () => {
    const { call } = await seeded();
    const answer = await (await call(URL_, { headers: reader })).json() as { layers: unknown[]; schemaVersion: number };
    expect(answer).toMatchObject({ schemaVersion: 1, layers: [], notices: [] });
  });

  test('a read-back of intact recordings is clean, and a reader sees it without reading any blob', async () => {
    const { call, layer } = await seeded();
    const posted = await (await run(call)).json() as { verified: number; layers: { layer: string; run: string; checked: number; ok: number; gaps: unknown[]; verifiedAtMs: number }[] };
    expect(posted.verified).toBe(1);
    expect(posted.layers[0]).toMatchObject({ layer: layer.id, run: 'https://ci.test/runs/1', checked: 2, ok: 2, gaps: [], verifiedAtMs: 9_000 });
    const read = await (await call(URL_, { headers: reader })).json() as typeof posted;
    expect(read.layers.map(item => item.ok)).toEqual([2]);
  });

  test('a blob that is gone is named per check, and the test results and statuses are untouched', async () => {
    const { store, call, layer } = await seeded();
    const effective = () => call('/api/reports/evidence/effective', { headers: reader }).then(response => response.text());
    const before = await effective();
    for (const part of layer.bundle[Object.keys(layer.bundle)[0]!]!.parts) await store.delete(part.blob);
    const posted = await (await run(call)).json() as { layers: { ok: number; gaps: { check: string; problem: string }[] }[] };
    expect(posted.layers[0]!.gaps.length).toBeGreaterThan(0);
    expect(posted.layers[0]!.gaps.every(gap => gap.problem === 'blob-missing')).toBe(true);
    expect(posted.layers[0]!.gaps.map(gap => gap.check)).toContain('a');
    // The report the viewer reads is the one it read before: only the verification document differs.
    expect(await effective()).toBe(before);
    const read = await (await call(`${URL_}?run=${encodeURIComponent('https://ci.test/runs/1')}`, { headers: reader })).json() as { layers: unknown[] };
    expect(read.layers).toHaveLength(1);
    expect(((await (await call(`${URL_}?run=other`, { headers: reader })).json()) as { layers: unknown[] }).layers).toEqual([]);
  });

  test('a later read-back replaces an earlier one, so repairing the blob clears the gap', async () => {
    const { store, call, layer } = await seeded();
    const part = layer.bundle[Object.keys(layer.bundle)[0]!]!.parts[0]!;
    const saved = await store.get(part.blob);
    const bytes = new Uint8Array(await new Response(saved!.body).arrayBuffer());
    await store.delete(part.blob);
    expect(((await (await run(call)).json()) as { layers: { gaps: unknown[] }[] }).layers[0]!.gaps.length).toBeGreaterThan(0);
    await store.put(part.blob, bytes, saved!.contentType);
    expect(((await (await run(call)).json()) as { layers: { gaps: unknown[] }[] }).layers[0]!.gaps).toEqual([]);
  });

  test('reading blobs needs a publish token in a Bearer header: a reader, a sign-in box and an anonymous caller are refused', async () => {
    const { call } = await seeded();
    expect((await call(URL_, { method: 'POST', headers: reader })).status).toBe(403);
    const basic = { authorization: `Basic ${btoa(`me:${TOKENS[0]!.token}`)}` };
    expect((await call(URL_, { method: 'POST', headers: basic })).status).toBe(403);
    expect((await call(URL_, { method: 'POST' })).status).toBe(401);
    expect((await call(URL_)).status).toBe(401);
  });

  test('a request is bounded and validated: the limit caps the layers read, a bad body is refused', async () => {
    const { store, server, call } = await seeded();
    await publishChecks(store, { producer: 'web', environment: 'desktop-web', branch: 'main', sha: 'b'.repeat(40), runUrl: 'https://ci.test/runs/2', recordedAtMs: 2_000, checks: [{ id: 'a', title: 'A', status: 'passed', attachments: [video('c.webm', 3)] }] });
    await server.index.refresh();
    const one = await (await run(call, { limit: 1 })).json() as { verified: number; layers: { run: string }[] };
    expect(one.verified).toBe(1);
    expect((await run(call, { limit: 5000 })).status).toBe(422);
    expect((await run(call, { layers: ['zz'] })).status).toBe(422);
    expect((await call(URL_, { method: 'POST', headers: publisher, body: 'not json' })).status).toBe(422);
    const all = await (await run(call, {})).json() as { verified: number };
    expect(all.verified).toBe(2);
  });

  test('a layer removed from storage (garbage collection) drops out of the answer', async () => {
    const { store, call, layer } = await seeded();
    await run(call);
    expect(((await (await call(URL_, { headers: reader })).json()) as { layers: unknown[] }).layers).toHaveLength(1);
    for (const key of await store.listKeys('layers/')) if (key.includes(layer.id)) await store.delete(key);
    clock.at += 60_000;
    expect(((await (await call(URL_, { headers: reader })).json()) as { layers: unknown[] }).layers).toEqual([]);
  });

  test('is advertised as a capability and described in the OpenAPI document', async () => {
    const { call } = await seeded();
    const info = await (await call('/api/server', { headers: reader })).json() as { capabilities: Record<string, boolean> };
    expect(info.capabilities.recordingVerification).toBe(true);
    const api = await (await call('/api/openapi.json')).json() as { paths: Record<string, Record<string, unknown>> };
    expect(Object.keys(api.paths[URL_]!).sort()).toEqual(['get', 'post']);
  });
});
