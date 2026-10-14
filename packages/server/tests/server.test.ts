import { afterEach, describe, expect, test } from 'bun:test';

import { combineBackends } from '../../reports/src/compose';
import { copyStore } from '../../reports/src/copy-store';
import { httpStore } from '../../reports/src/http-store';
import { verifyObjectStore } from '../../reports/src/object-store-conformance';
import { publishChecks } from '../../reports/src/publish-checks';
import { publishRunBundle } from '../../reports/src/run-bundle';
import { publishSpecSet } from '../../reports/src/spec-set';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { listen, type RunningServer } from '../src/host';

const running: { server: AtlasServer; http: RunningServer }[] = [];
afterEach(async () => {
  for (const { server, http } of running.splice(0)) { server.close(); await http.close(200); }
});

const TOKENS = [{ name: 'admin', role: 'admin' as const, token: 'admin-token-123456' }, { name: 'ci', role: 'publish' as const, token: 'publish-token-12345' }, { name: 'eyes', role: 'read' as const, token: 'read-token-1234567' }];

/** A real server on a real port, with a store of its own: what a client sees. */
async function start(options: { tokens?: typeof TOKENS; anonymousRead?: boolean; maxObjectMiB?: number } = {}) {
  const store = memoryStore();
  const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', ...(options.tokens ? { tokens: options.tokens } : {}), ...(options.anonymousRead ? { anonymousRead: true } : {}), limits: { maxObjectMiB: options.maxObjectMiB ?? 8 }, refreshMs: 60_000, heartbeatMs: 50 });
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
  running.push({ server, http });
  await server.ready;
  const url = `http://127.0.0.1:${http.port}`;
  return { server, http, store, url, client: (token?: string) => httpStore({ url, ...(token ? { token } : {}), retries: 0 }) };
}
const check = (id: string, status: 'passed' | 'failed' = 'passed') => ({ id, title: id, status });

describe('uploading results to the server', () => {
  test('anything that publishes to a store publishes to the server: the same code, over HTTP', async () => {
    const { url, store, server } = await start();
    const client = httpStore({ url });
    const layer = await publishChecks(client, { producer: 'e2e', environment: 'ios', recordedAtMs: 10, branch: 'main', checks: [check('a'), check('b', 'failed')], attachments: [{ name: 'ci.log', data: new Uint8Array(9000).fill(7) }] });
    expect(await store.head(`layers/manifests/${layer.id}.json`)).toBe(true);
    const status = await (await fetch(`${url}/api/status`)).json() as { ok: boolean; checks: { passed: number; failed: number }; failing: { check: string }[] };
    expect(status).toMatchObject({ ok: false, checks: { passed: 1, failed: 1 } });
    expect(status.failing.map(item => item.check)).toEqual(['b']);
    expect(server.index.stats().layers).toBe(1);
  });

  test('a layer is in the report the moment it is uploaded, not at the next refresh', async () => {
    const { url, server } = await start();
    expect((await (await fetch(`${url}/api/reports/evidence/effective`)).json() as { layers: unknown[] }).layers.length).toBe(0);
    await publishChecks(httpStore({ url }), { producer: 'p', recordedAtMs: 1, checks: [check('a')] });
    const effective = await (await fetch(`${url}/api/reports/evidence/effective`)).json() as { layers: { rows: { id: string }[] }[]; totalLayers: number };
    expect(effective.layers[0]!.rows[0]!.id).toBe('a');
    expect(effective.totalLayers).toBe(1);
    expect(server.index.stats().slots).toBe(1);
  });

  test('simple JSON works for anything that can make a request: the time defaults to now, the rest is the layer format', async () => {
    const { url } = await start();
    const response = await fetch(`${url}/api/checks`, { method: 'POST', body: JSON.stringify({ producer: 'curl', checks: [check('a'), check('b', 'failed')], environment: 'desktop-web', attachments: [{ name: 'note.txt', text: 'hello' }] }) });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, checks: 2 });
    const bad = await fetch(`${url}/api/checks`, { method: 'POST', body: JSON.stringify({ producer: 'curl', checks: [check('a'), check('a')] }) });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: string }).error).toContain('appears twice');
    expect((await fetch(`${url}/api/checks`, { method: 'POST', body: 'not json' })).status).toBe(422);
  });

  test('the server keeps the specs and the runs too: a spec set and a run upload become what the viewer reads', async () => {
    const { url } = await start();
    const client = httpStore({ url });
    await publishSpecSet(client, { files: [{ path: 'specs/cart.feature', text: 'Feature: Cart\n' }], branch: 'main', sha: 'a'.repeat(40), recordedAtMs: 5 });
    const index = await (await fetch(`${url}/api/data/specs/index.json`)).json() as { files: string[] };
    expect(index.files).toEqual(['cart.feature']);
    expect(await (await fetch(`${url}/api/data/specs/cart.feature`)).text()).toContain('Feature: Cart');
    const outline = await (await fetch(`${url}/api/reports/outline`)).json() as { specs: { path: string }[] };
    expect(outline.specs.map(spec => spec.path)).toEqual(['specs/cart.feature']);
  });
});

describe('sending a viewer only what changed', () => {
  test('asked since the version it holds, the server sends the layers that changed; asked since a stranger, all of it', async () => {
    const { applyEffectiveDelta, isEffectiveDelta } = await import('../../reports/src/effective-delta');
    const { url } = await start();
    const client = httpStore({ url });
    await publishChecks(client, { producer: 'e2e', environment: 'ios', recordedAtMs: 1, checks: [check('a'), check('b')] });
    const held = await (await fetch(`${url}/api/reports/evidence/effective`)).json() as { version: string; layers: { id: string }[] };
    await publishChecks(client, { producer: 'e2e', environment: 'ios', recordedAtMs: 2, checks: [check('a', 'failed')] });
    await publishChecks(client, { producer: 'e2e', environment: 'android', recordedAtMs: 3, checks: [check('a')] });
    const response = await fetch(`${url}/api/reports/evidence/effective?since=${held.version}`);
    const delta = await response.json() as { layers: { id: string }[]; removed: string[] };
    expect(isEffectiveDelta(delta)).toBe(true);
    expect(delta.layers.length).toBe(3);
    // The first layer still wins its check `b`, so it is changed (it lost `a`) and not removed.
    expect(delta.removed).toEqual([]);
    const { active: _none, ...full } = await (await fetch(`${url}/api/reports/evidence/effective`)).json() as { version: string; active: unknown[] };
    expect(applyEffectiveDelta(held as never, delta as never)).toEqual(full as never);
    expect(response.headers.get('etag')).toBe(`"${full.version}"`);

    const stranger = await (await fetch(`${url}/api/reports/evidence/effective?since=ffffffffffffffffffff`)).json() as { delta?: boolean; layers: unknown[] };
    expect(stranger.delta).toBeUndefined();
    expect(stranger.layers.length).toBe(3);
    const same = await (await fetch(`${url}/api/reports/evidence/effective?since=${full.version}`, { headers: { 'if-none-match': 'x' } })).json() as { layers: unknown[]; delta: boolean };
    expect(same).toMatchObject({ delta: true, layers: [] });
  });
});

describe('what the server refuses', () => {
  test('a layer is named by its content: one whose content is not its name is refused, whoever sends it', async () => {
    const { url, client } = await start();
    const layer = await publishChecks(memoryStore(), { producer: 'p', recordedAtMs: 1, checks: [check('a')] });
    const store = memoryStore();
    await publishChecks(store, { producer: 'p', recordedAtMs: 1, checks: [check('a')] });
    const manifest = new TextDecoder().decode(new Uint8Array(await new Response((await store.get(`layers/manifests/${layer.id}.json`))!.body).arrayBuffer()));
    const tampered = new TextEncoder().encode(manifest.replace('"status":"passed"', '"status":"failed"'));
    const refused = await fetch(`${url}/api/store/layers/manifests/${layer.id}.json`, { method: 'PUT', body: tampered });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toContain('does not match its id');
    expect(await client().head(`layers/manifests/${layer.id}.json`)).toBe(false);
  });

  test('a catalog entry is refused until what it names is there: nothing half-uploaded is ever visible', async () => {
    const { url, server } = await start();
    const id = 'a'.repeat(64);
    const entry = await fetch(`${url}/api/store/layers/index/0000000000000001-${id}.json`, { method: 'PUT', body: JSON.stringify({ id }) });
    expect(entry.status).toBe(409);
    expect(((await entry.json()) as { error: string }).error).toContain('not been uploaded yet');
    const orphan = await fetch(`${url}/api/store/layers/manifests/${id}.json`, { method: 'PUT', body: '{"schemaVersion":1}' });
    expect(orphan.status).toBe(422);
    expect(server.index.stats().layers).toBe(0);
  });

  test('a layer needs its files before its manifest', async () => {
    const { url } = await start();
    const store = memoryStore();
    const layer = await publishChecks(store, { producer: 'p', recordedAtMs: 1, checks: [{ ...check('a'), attachments: [{ name: 'x.png', data: new Uint8Array([1, 2, 3]) }] }] });
    const manifest = await new Response((await store.get(`layers/manifests/${layer.id}.json`))!.body).arrayBuffer();
    const early = await fetch(`${url}/api/store/layers/manifests/${layer.id}.json`, { method: 'PUT', body: manifest });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: string }).error).toContain('Upload blobs before the manifest');
  });

  test('layers are immutable: the same bytes again are fine, other bytes under the same key are not', async () => {
    const { url } = await start();
    const key = `layers/blobs/${'b'.repeat(64)}.gz`;
    expect((await fetch(`${url}/api/store/${key}`, { method: 'PUT', body: new Uint8Array([1, 2, 3]) })).status).toBe(201);
    expect((await fetch(`${url}/api/store/${key}`, { method: 'PUT', body: new Uint8Array([1, 2, 3]) })).status).toBe(200);
    const other = await fetch(`${url}/api/store/${key}`, { method: 'PUT', body: new Uint8Array([9]) });
    expect(other.status).toBe(409);
    expect(((await other.json()) as { error: string }).error).toContain('immutable');
  });

  test('only what Atlas writes is accepted, and keys cannot leave layers/', async () => {
    const { url } = await start();
    for (const key of ['elsewhere/x', 'layers/../x', 'layers//x', 'layers/unknown/x', 'layers/manifests/short.json']) {
      const status = (await fetch(`${url}/api/store/${key}`, { method: 'PUT', body: 'x' })).status;
      expect([404, 422]).toContain(status);
    }
    expect((await fetch(`${url}/api/store/layers/..%2Fetc/passwd`, { method: 'PUT', body: 'x' })).status).toBe(422);
    expect((await fetch(`${url}/api/store/layers/a%5Cb`, { method: 'PUT', body: 'x' })).status).toBe(422);
  });

  test('an object over the limit is refused as it arrives, not after it has been held', async () => {
    const { url } = await start({ maxObjectMiB: 1 });
    const response = await fetch(`${url}/api/store/layers/blobs/${'c'.repeat(64)}.gz`, { method: 'PUT', body: new Uint8Array(2 * 1024 * 1024) });
    expect(response.status).toBe(413);
  });

  test('a run that did not pass its privacy scan is never shared', async () => {
    const { url } = await start();
    const bad = await fetch(`${url}/api/store/layers/runs/2026-10-09T12-00-00-000Z-fast/manifest.json`, { method: 'PUT', body: JSON.stringify({ privacy: { passed: false } }) });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: string }).error).toContain('privacy scan');
    expect((await fetch(`${url}/api/store/layers/runs/2026-10-09T12-00-00-000Z-fast/manifest.json`, { method: 'PUT', body: JSON.stringify({ privacy: { passed: true } }) })).status).toBe(201);
  });

  test('nothing a report is made of can be deleted through the API; only the scratch objects `doctor` writes', async () => {
    const { url } = await start();
    const key = `layers/blobs/${'d'.repeat(64)}.gz`;
    await fetch(`${url}/api/store/${key}`, { method: 'PUT', body: 'x' });
    expect((await fetch(`${url}/api/store/${key}`, { method: 'DELETE' })).status).toBe(403);
    expect((await fetch(`${url}/api/store/${key}`, { method: 'HEAD' })).status).toBe(200);
  });

  test('the server meets the object store contract, so any tool that works against a store works against it', async () => {
    const { client } = await start();
    expect(await verifyObjectStore(client(), 'layers/doctor-conformance/')).toEqual({ ok: true, failures: [] });
  });

  test('copying a folder of layers up to the server is the same as publishing them there', async () => {
    const { url } = await start();
    const local = memoryStore();
    await publishChecks(local, { producer: 'p', environment: 'ios', recordedAtMs: 5, checks: [check('a'), check('b')], attachments: [{ name: 'x.png', data: new Uint8Array([1, 2]) }] });
    const client = httpStore({ url });
    expect((await copyStore(local, client)).copied).toBeGreaterThan(0);
    expect(await copyStore(local, client)).toMatchObject({ copied: 0 });
    const report = await combineBackends([{ id: 'server', store: client }]);
    expect(report.summary.checks).toMatchObject({ passed: 2, total: 2 });
  });

  test('a client that cannot reach the server says so', async () => {
    await expect(httpStore({ url: 'http://127.0.0.1:1', retries: 0 }).head('layers/x')).rejects.toThrow('cannot reach');
  });
});

describe('who may do what', () => {
  test('with tokens, nobody without one may look or upload; a reader may only look; a publisher may upload; the sign-in box cannot upload', async () => {
    const { url, client } = await start({ tokens: TOKENS });
    expect((await fetch(`${url}/api/status`)).status).toBe(401);
    expect((await fetch(`${url}/api/status`)).headers.get('www-authenticate')).toContain('Basic');
    const asReader = (path: string, init: RequestInit = {}) => fetch(`${url}${path}`, { ...init, headers: { authorization: `Bearer ${TOKENS[2]!.token}` } });
    expect((await asReader('/api/status')).status).toBe(200);
    expect((await asReader(`/api/store/layers/blobs/${'a'.repeat(64)}.gz`, { method: 'PUT', body: 'x' })).status).toBe(403);
    await expect(publishChecks(client(TOKENS[1]!.token), { producer: 'ci', recordedAtMs: 1, checks: [check('a')] })).resolves.toBeDefined();
    await expect(publishChecks(client(TOKENS[2]!.token), { producer: 'ci', recordedAtMs: 2, checks: [check('a')] })).rejects.toThrow('may not do that');
    await expect(publishChecks(client('wrong-token-123456'), { producer: 'ci', recordedAtMs: 3, checks: [check('a')] })).rejects.toThrow('wants a token');
    const basic = `Basic ${Buffer.from('anyone:' + TOKENS[1]!.token).toString('base64')}`;
    expect((await fetch(`${url}/api/status`, { headers: { authorization: basic } })).status).toBe(200);
    expect((await fetch(`${url}/api/store/layers/blobs/${'e'.repeat(64)}.gz`, { method: 'PUT', body: 'x', headers: { authorization: basic } })).status).toBe(403);
  });

  test('the probes need no token; anonymous reading can be allowed, and uploading still needs one', async () => {
    const { url } = await start({ tokens: TOKENS, anonymousRead: true });
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    expect((await fetch(`${url}/readyz`)).status).toBe(200);
    expect((await fetch(`${url}/api/status`)).status).toBe(200);
    expect((await fetch(`${url}/api/store/layers/blobs/${'f'.repeat(64)}.gz`, { method: 'PUT', body: 'x' })).status).toBe(401);
  });

  test('the server says who is asking and what it is, to a viewer and to `doctor`', async () => {
    const { url } = await start({ tokens: TOKENS });
    const info = await (await fetch(`${url}/api/server`, { headers: { authorization: `Bearer ${TOKENS[1]!.token}` } })).json() as { role: string; write: string; backends: { id: string; write: boolean }[]; capabilities: Record<string, boolean>; open: boolean };
    expect(info).toMatchObject({ role: 'publish', write: 'data', open: false, backends: [{ id: 'data', write: true }] });
    expect(info.capabilities.events).toBe(true);
    const ping = await httpStore({ url, token: TOKENS[1]!.token }).ping();
    expect(ping).toMatchObject({ ok: true, role: 'publish' });
    expect((await httpStore({ url, retries: 0 }).ping()).ok).toBe(false);
  });
});

describe('streaming the report down', () => {
  async function listenTo(url: string, token?: string) {
    const response = await fetch(`${url}/api/events`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const next = async (until: (text: string) => boolean, ms = 3000) => {
      const deadline = Date.now() + ms;
      while (!until(text) && Date.now() < deadline) {
        const result = await Promise.race([reader.read(), new Promise<null>(resolve => setTimeout(() => resolve(null), 100))]);
        if (result && !result.done) text += decoder.decode(result.value);
      }
      return text;
    };
    return { response, next, close: () => reader.cancel() };
  }

  test('a viewer is told, the moment results arrive, what arrived: and gets a heartbeat meanwhile', async () => {
    const { url } = await start();
    const stream = await listenTo(url);
    expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
    const hello = await stream.next(text => text.includes('event: hello'));
    expect(hello).toContain('retry: 3000');
    await publishChecks(httpStore({ url }), { producer: 'e2e', environment: 'ios', branch: 'main', recordedAtMs: 5, checks: [check('a'), check('b', 'failed')] });
    const text = await stream.next(value => value.includes('event: report'));
    const data = JSON.parse(/event: report\ndata: (.*)\n/.exec(text)![1]!) as { version: string; added: { producer: string; environment: string; counts: { failed: number } }[]; totalLayers: number };
    expect(data.added[0]).toMatchObject({ producer: 'e2e', environment: 'ios', counts: { failed: 1 } });
    expect(data.totalLayers).toBe(1);
    expect(await stream.next(value => value.includes(': ping'))).toContain(': ping');
    await stream.close();
  });

  test('specs and runs announce themselves, so the viewer reads them again', async () => {
    const { url } = await start();
    const stream = await listenTo(url);
    await stream.next(text => text.includes('event: hello'));
    await publishSpecSet(httpStore({ url }), { files: [{ path: 'specs/a.feature', text: 'Feature: A' }], branch: 'main', sha: null, recordedAtMs: 1 });
    expect(await stream.next(text => text.includes('event: atlas:change'))).toContain('"scope":"specs"');
    await stream.close();
  });

  test('every connected viewer hears it, and one that leaves is forgotten', async () => {
    const { url, server } = await start();
    const [one, two] = await Promise.all([listenTo(url), listenTo(url)]);
    await Promise.all([one.next(t => t.includes('hello')), two.next(t => t.includes('hello'))]);
    expect(server.events.count).toBe(2);
    await publishChecks(httpStore({ url }), { producer: 'p', recordedAtMs: 1, checks: [check('a')] });
    expect(await one.next(t => t.includes('event: report'))).toContain('event: report');
    expect(await two.next(t => t.includes('event: report'))).toContain('event: report');
    await one.close();
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(server.events.count).toBe(1);
    await two.close();
  });

  test('past the limit, a viewer is told to poll rather than refused the page', async () => {
    const store = memoryStore();
    const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', limits: { maxStreams: 1 }, refreshMs: 60_000 });
    running.push({ server, http: await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 1024 }) });
    await server.ready;
    const first = await server.fetch(new Request('http://x/api/events'));
    expect(first.status).toBe(200);
    const second = await server.fetch(new Request('http://x/api/events'));
    expect(second.status).toBe(503);
    expect(second.headers.get('retry-after')).toBe('30');
    await first.body!.cancel();
  });
});

describe('the gate, from the server', () => {
  test('it says what the report says, can be narrowed, and can require environments and specs', async () => {
    const { url } = await start();
    const client = httpStore({ url });
    await publishSpecSet(client, { files: [{ path: 'specs/a.feature', text: 'Feature: A' }, { path: 'specs/b.feature', text: 'Feature: B' }], branch: 'main', sha: 'a'.repeat(40), recordedAtMs: 1 });
    await publishChecks(client, { producer: 'e2e', environment: 'ios', branch: 'main', recordedAtMs: 10, checks: [{ ...check('a'), specPath: 'specs/a.feature' }] });
    await publishChecks(client, { producer: 'e2e', environment: 'ios', branch: 'feat/x', recordedAtMs: 20, checks: [{ ...check('a', 'failed'), specPath: 'specs/a.feature' }] });
    const status = async (query = '') => (await fetch(`${url}/api/status${query}`)).json() as Promise<{ ok: boolean; reasons: string[]; specsWithoutEvidence: string[] }>;
    expect((await status()).ok).toBe(false);
    expect((await status('?branch=main')).ok).toBe(true);
    const strict = await status('?branch=main&requireAllSpecs=1&requireEnvironments=ios,android');
    expect(strict.ok).toBe(false);
    expect(strict.specsWithoutEvidence).toEqual(['specs/b.feature']);
    expect(strict.reasons.join(' ')).toContain('"android"');
    const response = await fetch(`${url}/api/status?branch=main`);
    expect(response.headers.get('x-atlas-ok')).toBe('true');
  });
});

describe('being operated', () => {
  test('ready once the backends were read; an API path nothing answers is a JSON 404, never the page', async () => {
    const store = memoryStore();
    const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', refreshMs: 60_000 });
    running.push({ server, http: await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 1024 }) });
    await server.ready;
    expect((await server.fetch(new Request('http://x/readyz'))).status).toBe(200);
    const missing = await server.fetch(new Request('http://x/api/nope'));
    expect(missing.status).toBe(404);
  });

  test('a backend that is down does not stop uploads to the one that is up, and is named', async () => {
    const up = memoryStore(), down = memoryStore();
    down.down = true;
    const server = createAtlasServer({ backends: [{ id: 'data', store: up }, { id: 'lab', store: down, label: 'Device lab' }], write: 'data', refreshMs: 60_000 });
    running.push({ server, http: await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 1024 }) });
    await server.ready;
    await publishChecks(up, { producer: 'p', recordedAtMs: 1, checks: [check('a')] });
    await server.index.refresh();
    const info = await (await server.fetch(new Request('http://x/api/server'))).json() as { backends: { id: string; available: boolean }[] };
    expect(info.backends).toEqual([{ id: 'data', label: 'data', available: true, write: true }, { id: 'lab', label: 'Device lab', available: false, write: false }]);
    expect(server.index.stats().layers).toBe(1);
  });

  test('a write backend that does not exist is refused at the start', () => {
    expect(() => createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'nope' })).toThrow('not among the backends');
  });
});
