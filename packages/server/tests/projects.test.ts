import { afterEach, expect, test } from 'bun:test';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { memoryStore } from '../../reports/tests/memory-store';
import { httpStore } from '../../reports/src/http-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { publishSpecSet } from '../../reports/src/spec-set';
import { listen, type RunningServer } from '../src/host';
import { RunDetailSchema, RunListSchema } from '../../schema/src/api';

const servers: AtlasServer[] = [];
const listeners: RunningServer[] = [];
afterEach(async () => { servers.splice(0).forEach(server => server.close()); for (const listener of listeners.splice(0)) await listener.close(100); });
const upload = (status: string) => ({ producer: 'tests', recordedAtMs: 100, checks: [{ id: 'same-test', title: 'Same test', status, specPath: 'specs/same.feature' }] });
const req = (server: AtlasServer, route: string, init?: RequestInit) => server.fetch(new Request(`http://atlas.test${route}`, init));
const post = (status: string, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(upload(status)) });

test('project selection isolates matching checks, specs and object keys across projects and the default', async () => {
  const store = memoryStore();
  const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data' }); servers.push(server); await server.ready;
  expect((await req(server, '/api/checks?project=alpha', post('failed'))).status).toBe(201);
  expect((await req(server, '/api/checks', post('passed', { 'x-atlas-project': 'beta' }))).status).toBe(201);
  expect((await req(server, '/api/checks', post('passed'))).status).toBe(201);
  expect((await (await req(server, '/api/projects/alpha/status')).json()).ok).toBe(false);
  expect((await (await req(server, '/api/status?project=beta')).json()).ok).toBe(true);
  expect(server.index.stats().layers).toBe(1);
  expect((await (await req(server, '/api/projects')).json()).projects.map((project: { slug: string }) => project.slug)).toEqual(['default', 'alpha', 'beta']);
  const alphaKeys = (await (await req(server, '/api/projects/alpha/store?prefix=layers/')).json()).keys;
  const betaKeys = (await (await req(server, '/api/projects/beta/store?prefix=layers/')).json()).keys;
  expect(alphaKeys.length).toBeGreaterThan(0);
  expect(alphaKeys.some((key: string) => betaKeys.includes(key))).toBe(false);
  expect((await req(server, `/api/projects/beta/store/${alphaKeys.find((key: string) => key.endsWith('layer.json'))}`)).status).toBe(404);
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 32 << 20 }); listeners.push(http);
  const alpha = httpStore({ url: `http://127.0.0.1:${http.port}`, project: 'alpha' });
  const beta = alpha.forProject('beta');
  await publishSpecSet(alpha, { files: [{ path: 'specs/same.feature', text: 'Feature: Alpha\n' }], recordedAtMs: 10, sha: null, branch: null });
  await publishSpecSet(beta, { files: [{ path: 'specs/same.feature', text: 'Feature: Beta\n' }], recordedAtMs: 10, sha: null, branch: null });
  expect(await (await req(server, '/api/projects/alpha/data/specs/same.feature')).text()).toContain('Alpha');
  expect(await (await req(server, '/api/projects/beta/data/specs/same.feature')).text()).toContain('Beta');
  await publishChecks(beta, { ...upload('failed'), recordedAtMs: 200 } as never);
  expect((await beta.status() as { ok: boolean }).ok).toBe(false);
});

test('projects survive restart and the same live run id is independent in each project', async () => {
  const store = memoryStore();
  const options = { backends: [{ id: 'data', store }], write: 'data' };
  let server = createAtlasServer(options); servers.push(server); await server.ready;
  const id = '11111111-1111-4111-8111-111111111111';
  const start = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, producer: 'tests' }) };
  for (const slug of ['alpha', 'beta']) expect((await req(server, `/api/projects/${slug}/live/${id}`, start)).status).toBe(201);
  const patch = { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sequence: 1, checks: [{ id: 'check', title: 'Running Alpha', status: 'running' }] }) };
  expect((await req(server, `/api/projects/alpha/live/${id}`, patch)).status).toBe(200);
  expect((await (await req(server, '/api/projects/alpha/live')).json()).runs[0].running).toBe(1);
  expect((await (await req(server, '/api/projects/beta/live')).json()).runs[0].running).toBe(0);
  server.close(); server = createAtlasServer(options); servers.push(server); await server.ready;
  expect((await (await req(server, '/api/projects')).json()).projects.map((project: { slug: string }) => project.slug)).toEqual(['alpha', 'beta']);
  expect((await (await req(server, '/api/projects/alpha/live')).json()).runs[0].status).toBe('interrupted');
});

test('invalid, conflicting and unauthorized project requests cannot create or traverse namespaces', async () => {
  const store = memoryStore();
  const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', tokens: [{ name: 'read', role: 'read', token: 'read' }, { name: 'publish', role: 'publish', token: 'publish' }] }); servers.push(server); await server.ready;
  expect((await req(server, '/api/projects')).status).toBe(401);
  expect((await req(server, '/api/checks?project=alpha', post('passed', { authorization: 'Bearer read' }))).status).toBe(403);
  expect((await req(server, '/api/checks?project=../beta', post('passed', { authorization: 'Bearer publish' }))).status).toBe(422);
  expect((await req(server, '/api/projects/alpha/checks?project=beta', post('passed', { authorization: 'Bearer publish' }))).status).toBe(422);
  expect((await req(server, '/api/projects/alpha/checks', post('passed', { authorization: `Basic ${btoa('u:publish')}` }))).status).toBe(403);
  expect((await req(server, '/api/projects/alpha/status', { headers: { authorization: 'Bearer read' } })).status).toBe(404);
  expect((await req(server, '/api/projects/alpha/checks', post('passed', { authorization: 'Bearer publish', origin: 'https://evil.test' }))).status).toBe(403);
  expect(await store.listKeys('server/projects/')).toEqual([]);
});

test('project discovery reaches existing default and project event streams without leaking another project report', async () => {
  const server = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data' }); servers.push(server); await server.ready;
  await req(server, '/api/projects/alpha/checks', post('passed'));
  const readers = await Promise.all(['/api/events', '/api/projects/alpha/events'].map(async url => (await req(server, url)).body!.getReader()));
  try {
    // Each stream begins with retry and hello frames.
    for (const reader of readers) { await reader.read(); await reader.read(); }
    expect((await req(server, '/api/projects/beta/checks', post('failed'))).status).toBe(201);
    for (const reader of readers) {
      const frame = new TextDecoder().decode((await reader.read()).value);
      expect(frame).toContain('event: projects\n');
      expect(frame).not.toContain('failed');
      expect(frame).not.toContain('beta');
    }
  } finally { await Promise.all(readers.map(reader => reader.cancel())); }
});

test('an execution id names a run over the API, and the same id in two projects stays isolated', async () => {
  const server = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data' }); servers.push(server); await server.ready;
  const body = (status: string, recordedAtMs: number, run: object) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ producer: 'demo', sha: 'a'.repeat(40), branch: 'main', recordedAtMs, run, checks: [{ id: 'pay', title: 'Pay', status }] }) });
  expect((await req(server, '/api/projects/alpha/checks', body('failed', 1_000, { id: 'demo-1', title: 'Alpha demo' }))).status).toBe(201);
  expect((await req(server, '/api/projects/alpha/checks', body('passed', 5_000, { id: 'demo-2' }))).status).toBe(201);
  expect((await req(server, '/api/projects/beta/checks', body('passed', 2_000, { id: 'demo-1', title: 'Beta demo' }))).status).toBe(201);
  const runs = async (slug: string) => RunListSchema.parse(await (await req(server, `/api/projects/${slug}/reports/runs`)).json()).runs;
  const alpha = await runs('alpha'), beta = await runs('beta');
  expect(alpha.map(run => [run.key, run.title ?? null, run.counts.failed, run.counts.passed])).toEqual([['run:demo-2', null, 0, 1], ['run:demo-1', 'Alpha demo', 1, 0]]);
  expect(beta.map(run => [run.key, run.title ?? null, run.counts.failed, run.counts.passed])).toEqual([['run:demo-1', 'Beta demo', 0, 1]]);
  const detail = RunDetailSchema.parse(await (await req(server, `/api/projects/alpha/reports/runs/detail?key=${encodeURIComponent('run:demo-1')}`)).json());
  expect(detail.run).toMatchObject({ runId: 'demo-1', title: 'Alpha demo' });
  expect(detail.results.map(result => result.status)).toEqual(['failed']);
  expect((await req(server, '/api/projects/alpha/checks', body('passed', 1, { id: '' }))).status).toBe(422);
});
