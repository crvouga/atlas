/**
 * @module OpenAPI document tests
 *
 * Hold the OpenAPI document to the server it describes: every route has an operation and every operation a route,
 * what the server really answers validates against the schemas the document names, errors are problem documents,
 * and the committed `openapi.json` is the one the code generates.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ChecksResultSchema, EffectiveDeltaSchema, EffectiveEvidenceSchema, EvidencePageSchema, HealthSchema, LayerRowsSchema, OutlineSchema, ProblemSchema, ReadySchema, ReportEventSchema, ServerInfoSchema, StoreListingSchema, StoreWriteResultSchema, CheckDetailSchema, HelloEventSchema } from '../../schema/src/api';
import { ReportStatusSchema } from '../../schema/src/layer';
import { httpStore } from '../../reports/src/http-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { publishSpecSet } from '../../reports/src/spec-set';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { listen, type RunningServer } from '../src/host';
import { NOT_OPERATIONS, OPERATIONS, openApiDocument } from '../src/openapi';

const running: { server: AtlasServer; http: RunningServer }[] = [];
afterEach(async () => { for (const { server, http } of running.splice(0)) { server.close(); await http.close(100); } });

async function start(tokens?: { name: string; role: 'admin' | 'publish' | 'read'; token: string }[]) {
  const server = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data', ...(tokens ? { tokens } : {}), refreshMs: 60_000 });
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 1 << 24 });
  running.push({ server, http });
  await server.ready;
  return { server, url: `http://127.0.0.1:${http.port}` };
}

describe('the document describes the server', () => {
  test('every route the server registers is an operation, and every operation is a route', async () => {
    const { server } = await start();
    const registered = new Set(server.routes.map(route => `${route.method} ${route.path}`));
    const described = new Set(OPERATIONS.map(operation => operation.route));
    const undocumented = [...registered].filter(route => !described.has(route) && !NOT_OPERATIONS.has(route));
    const phantom = [...described].filter(route => !registered.has(route));
    expect(undocumented).toEqual([]);
    expect(phantom).toEqual([]);
    expect(new Set(OPERATIONS.map(operation => operation.operationId)).size).toBe(OPERATIONS.length);
  });

  test('every path parameter in a template is declared, and every declared one is in the template', () => {
    for (const operation of OPERATIONS) {
      const inTemplate = [...operation.path.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort();
      const declared = (operation.parameters ?? []).filter(parameter => parameter.in === 'path').map(parameter => parameter.name).sort();
      expect(declared, `${operation.route}`).toEqual(inTemplate);
    }
  });

  test('it is OpenAPI 3.1 with a summary and a description on every operation, and every error response is a problem document', () => {
    const document = openApiDocument() as { openapi: string; paths: Record<string, Record<string, { summary: string; description: string; responses: Record<string, { content?: Record<string, unknown> }> }>> };
    expect(document.openapi).toBe('3.1.0');
    for (const [route, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(operation.summary.length, `${method} ${route}`).toBeGreaterThan(5);
        expect(operation.description.length, `${method} ${route}`).toBeGreaterThan(20);
        for (const [status, response] of Object.entries(operation.responses)) {
          // `/readyz` answers 503 with its own document, which says what is not ready yet.
          if (Number(status) >= 400 && response.content && route !== '/readyz') expect(Object.keys(response.content), `${method} ${route} ${status}`).toEqual(['application/problem+json']);
        }
      }
    }
  });

  test('the committed openapi.json is what the code generates (run `bun run docs`)', () => {
    const committed = readFileSync(path.join(import.meta.dirname, '..', 'openapi.json'), 'utf8');
    expect(committed).toBe(`${JSON.stringify(openApiDocument(), null, 2)}\n`);
  });
});

describe('what the server answers is what the document says', () => {
  test('identity, readiness, report, delta, gate, listing and uploads validate against their schemas', async () => {
    const { url } = await start();
    const client = httpStore({ url });
    await publishSpecSet(client, { files: [{ path: 'specs/a.feature', text: 'Feature: A' }], branch: 'main', sha: 'a'.repeat(40), recordedAtMs: 1 });
    await publishChecks(client, { producer: 'e2e', environment: 'ios', branch: 'main', recordedAtMs: 10, checks: [{ id: 'a', title: 'a', status: 'passed', specPath: 'specs/a.feature', measurements: [{ name: 'ms', value: 3, unit: 'ms' }], attachments: [{ name: 'log.txt', text: 'hi' }] }, { id: 'b', title: 'b', status: 'failed' }] });
    const get = async (p: string) => (await fetch(`${url}${p}`)).json() as Promise<unknown>;

    expect(HealthSchema.parse(await get('/healthz'))).toBeTruthy();
    expect(ReadySchema.parse(await get('/readyz')).ready).toBe(true);
    expect(ServerInfoSchema.parse(await get('/api/server')).name).toBe('atlas');
    const report = EffectiveEvidenceSchema.parse(await get('/api/reports/evidence/effective'));
    expect(report.layers.length).toBe(1);
    expect(ReportStatusSchema.parse(await get('/api/status')).checks.total).toBe(2);
    expect(OutlineSchema.parse(await get('/api/reports/outline')).specs.length).toBe(1);
    const page = EvidencePageSchema.parse(await get('/api/reports/evidence'));
    const layer = page.layers[0]!;
    expect(LayerRowsSchema.parse(await get(`/api/reports/evidence/rows/${layer.backend}/${layer.id}`)).rows.length).toBe(2);
    expect(CheckDetailSchema.parse(await get(`/api/reports/evidence/detail/${layer.backend}/${layer.id}?check=a`)).check.id).toBe('a');
    expect(StoreListingSchema.parse(await get('/api/store?prefix=layers/index/')).keys.length).toBe(1);

    await publishChecks(client, { producer: 'e2e', environment: 'ios', branch: 'main', recordedAtMs: 20, checks: [{ id: 'b', title: 'b', status: 'passed' }] });
    const delta = EffectiveDeltaSchema.parse(await get(`/api/reports/evidence/effective?since=${report.version}`));
    expect(delta.base).toBe(report.version);

    const posted = await fetch(`${url}/api/checks`, { method: 'POST', body: JSON.stringify({ producer: 'curl', checks: [{ id: 'x', title: 'x', status: 'passed' }] }) });
    expect(ChecksResultSchema.parse(await posted.json()).checks).toBe(1);
    const put = await fetch(`${url}/api/store/layers/runs/2026-10-09T12-00-00-000Z-fast/manifest.json`, { method: 'PUT', body: JSON.stringify({ privacy: { passed: true } }) });
    expect(StoreWriteResultSchema.parse(await put.json())).toMatchObject({ created: true, kind: 'run-manifest' });
  });

  test('the events carry what the document says', async () => {
    const { url } = await start();
    const stream = await fetch(`${url}/api/events`);
    const reader = stream.body!.getReader();
    let text = '';
    const read = async (until: string) => { while (!text.includes(until)) text += new TextDecoder().decode((await reader.read()).value); };
    await read('event: hello');
    await publishChecks(httpStore({ url }), { producer: 'p', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed' }] });
    await read('event: report');
    const data = (name: string) => JSON.parse(new RegExp(`event: ${name}\\ndata: (.*)\\n`).exec(text)![1]!) as unknown;
    expect(HelloEventSchema.parse(data('hello')).ready).toBe(true);
    expect(ReportEventSchema.parse(data('report')).addedTotal).toBe(1);
    await reader.cancel();
  });

  test('every error is a problem document, with the headers that say what to do', async () => {
    const { url } = await start([{ name: 'ci', role: 'publish', token: 'publish-token-12345' }]);
    const unauthorized = await fetch(`${url}/api/status`);
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('content-type')).toBe('application/problem+json');
    expect(unauthorized.headers.get('www-authenticate')).toContain('Basic');
    expect(ProblemSchema.parse(await unauthorized.json())).toMatchObject({ status: 401, title: 'Unauthorized', type: 'about:blank' });
    const auth = { authorization: 'Bearer publish-token-12345' };
    const missing = await fetch(`${url}/api/nope`, { headers: auth });
    expect(missing.status).toBe(404);
    expect(ProblemSchema.parse(await missing.json()).detail).toBe('Not found');
    const refused = await fetch(`${url}/api/store/layers/index/0000000000000001-${'a'.repeat(64)}.json`, { method: 'PUT', body: JSON.stringify({ id: 'a'.repeat(64) }), headers: auth });
    expect(refused.status).toBe(409);
    const problem = ProblemSchema.parse(await refused.json());
    expect(problem.detail).toContain('not been uploaded');
    expect(problem.error).toBe(problem.detail);
    const wrongMethod = await fetch(`${url}/api/status`, { method: 'POST', headers: auth });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('GET, HEAD');
  });

  test('the description and the guide are public: an agent with only an address can learn the API', async () => {
    const { url } = await start([{ name: 'ci', role: 'publish', token: 'publish-token-12345' }]);
    const document = await (await fetch(`${url}/api/openapi.json`)).json() as { openapi: string; paths: object };
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths).length).toBeGreaterThan(15);
    const guide = await (await fetch(`${url}/llms.txt`)).text();
    expect(guide).toContain(`# Atlas server at ${url}`);
    expect(guide).toContain(`${url}/api/openapi.json`);
    expect(guide).toContain('needs a token');
    expect(guide).toContain('init --server');
    expect((await fetch(`${url}/api/server`)).status).toBe(401);
  });

  test('behind a proxy, the guide and the document use the address clients used', async () => {
    const { url } = await start();
    const guide = await (await fetch(`${url}/llms.txt`, { headers: { 'x-forwarded-host': 'atlas.example.com', 'x-forwarded-proto': 'https' } })).text();
    expect(guide).toContain('# Atlas server at https://atlas.example.com');
    expect(guide).toContain('no tokens');
    const document = await (await fetch(`${url}/api/openapi.json`, { headers: { 'x-forwarded-host': 'atlas.example.com' } })).json() as { servers: { url: string }[] };
    expect(document.servers[0]!.url).toBe('https://atlas.example.com');
  });
});
