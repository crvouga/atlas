import { afterEach, describe, expect, test } from 'bun:test';

import { buildCritique, critiqueLayer, defineCritic, publishCritiques, type CritiqueOutcome } from '../../critics/src/index';
import { httpStore } from '../../reports/src/http-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { listen, type RunningServer } from '../src/host';

const running: { server: AtlasServer; http: RunningServer }[] = [];
afterEach(async () => {
  for (const { server, http } of running.splice(0)) { server.close(); await http.close(200); }
});

const TOKENS = [
  { name: 'admin', role: 'admin' as const, token: 'admin-token-123456' },
  { name: 'ci', role: 'publish' as const, token: 'publish-token-12345' },
  { name: 'critic', role: 'critic' as const, token: 'critic-token-12345' },
  { name: 'eyes', role: 'read' as const, token: 'read-token-1234567' }
];

async function start(tokens: typeof TOKENS | 'open' = TOKENS) {
  const store = memoryStore();
  const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', ...(tokens === 'open' ? {} : { tokens }), refreshMs: 60_000, heartbeatMs: 50 });
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
  running.push({ server, http });
  await server.ready;
  const url = `http://127.0.0.1:${http.port}`;
  return { server, store, url, client: (token?: string) => httpStore({ url, ...(token ? { token } : {}), retries: 0 }) };
}

const critic = defineCritic({ name: 'uiclip', version: '1.0.0', describe: () => ({ sendsImagesTo: null, needsSetup: false }), evaluate: async () => ({ verdict: { score: 0.1 } }) });
const entry = { key: 'home', title: 'Home', state: 'screen', imageSha256: 'a'.repeat(64) };
const outcomes: CritiqueOutcome[] = [{ entry, critique: buildCritique(critic, critic.describe(), entry, { verdict: { score: 0.1, label: 'needs-polish' } }) }];
const authorization = (token: string) => ({ authorization: `Bearer ${token}` });

describe('a critic-scoped token', () => {
  test('publishes critiques, which are stored and visible, and which change nothing about the report status', async () => {
    const { url, client, store } = await start();
    await publishChecks(client('publish-token-12345'), { producer: 'e2e', recordedAtMs: 1, checks: [{ id: 'pay', title: 'pay', status: 'passed' }] });
    const before = await (await fetch(`${url}/api/status`, { headers: authorization('read-token-1234567') })).json() as { ok: boolean; checks: unknown; failing: unknown[] };
    const layer = await publishCritiques(client('critic-token-12345'), { critic, outcomes, recordedAtMs: 2 });
    expect(await store.head(`layers/manifests/${layer!.id}.json`)).toBe(true);
    const after = await (await fetch(`${url}/api/status`, { headers: authorization('read-token-1234567') })).json() as { ok: boolean; checks: unknown; failing: unknown[] };
    expect(after).toMatchObject({ ok: true, checks: before.checks, failing: [] });
  });

  test('may read, and says what it is', async () => {
    const { url } = await start();
    const info = await (await fetch(`${url}/api/server`, { headers: authorization('critic-token-12345') })).json() as { role: string };
    expect(info.role).toBe('critic');
  });

  test('cannot publish a layer that has a part that is not a critique: the server says which rule and stores nothing', async () => {
    const { client, store } = await start();
    await expect(publishChecks(client('critic-token-12345'), { producer: 'critic.uiclip', kind: 'behavior', recordedAtMs: 1, checks: [{ id: 'pay', title: 'pay', status: 'passed' }] })).rejects.toThrow(/part of kind "behavior"/);
    expect(await store.listKeys('layers/')).toEqual([]);
  });

  test('cannot publish test results under a producer outside critic.*, even in a part of kind critique', async () => {
    const { client, store } = await start();
    await expect(publishChecks(client('critic-token-12345'), { ...critiqueLayer({ critic, outcomes, recordedAtMs: 1 }), producer: 'e2e' })).rejects.toThrow(/producer/);
    expect(await store.listKeys('layers/')).toEqual([]);
  });

  test('cannot make a layer of someone else visible by writing its catalog entry', async () => {
    const { url, client, store } = await start();
    // The publisher's layer is uploaded in full except for its catalog entry, as a half-finished upload would leave it.
    const layer = await publishChecks(client('publish-token-12345'), { producer: 'e2e', recordedAtMs: 1, checks: [{ id: 'pay', title: 'pay', status: 'passed' }] });
    const catalogKey = (await store.listKeys('layers/index/'))[0]!;
    await store.delete(catalogKey);
    const response = await fetch(`${url}/api/store/${catalogKey}`, { method: 'PUT', headers: authorization('critic-token-12345'), body: JSON.stringify({ id: layer.id }) });
    expect(response.status).toBe(403);
  });

  test.each([
    ['uploads a spec file', 'PUT', '/api/store/layers/specs/blobs/' + 'b'.repeat(64) + '.txt'],
    ['removes a scratch object', 'DELETE', '/api/store/layers/doctor-x/y'],
    ['posts checks', 'POST', '/api/checks'],
    ['reads the settings', 'GET', '/api/settings'],
    ['saves the settings', 'PUT', '/api/settings'],
    ['starts a live run', 'POST', '/api/live/run-1']
  ])('is answered 403 when it %s', async (_, method, path) => {
    const { url } = await start();
    const response = await fetch(`${url}${path}`, { method, headers: authorization('critic-token-12345'), body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
    expect(response.status).toBe(403);
  });
});

describe('who may publish a critique', () => {
  test('no token: 401', async () => {
    const { url } = await start();
    expect((await fetch(`${url}/api/store/layers/blobs/${'c'.repeat(64)}.gz`, { method: 'PUT', body: 'x' })).status).toBe(401);
    expect((await fetch(`${url}/api/status`)).status).toBe(401);
  });

  test('a read token: 403', async () => {
    const { client } = await start();
    await expect(publishCritiques(client('read-token-1234567'), { critic, outcomes, recordedAtMs: 1 })).rejects.toThrow(/may not do that|critic/);
    const { url } = await start();
    const response = await fetch(`${url}/api/store/layers/blobs/${'c'.repeat(64)}.gz`, { method: 'PUT', headers: authorization('read-token-1234567'), body: 'x' });
    expect(response.status).toBe(403);
  });

  test('a publish token may publish critiques too', async () => {
    const { client, store } = await start();
    const layer = await publishCritiques(client('publish-token-12345'), { critic, outcomes, recordedAtMs: 1 });
    expect(await store.head(`layers/manifests/${layer!.id}.json`)).toBe(true);
  });

  test('a server with no tokens is open: every caller is an administrator, a critic included', async () => {
    const { url, client } = await start('open');
    const info = await (await fetch(`${url}/api/server`)).json() as { open: boolean; role: string };
    expect(info).toMatchObject({ open: true, role: 'admin' });
    expect(await publishCritiques(client(), { critic, outcomes, recordedAtMs: 1 })).not.toBeNull();
  });
});
