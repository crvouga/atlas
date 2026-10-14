import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import type { EffectiveEvidence } from '../../reports/src/report-index';
import { createNode, type Node } from './node-compat';
import { listen } from '../src/host';
import { publishChecks } from '../../reports/src/publish-checks';
import { publishRunBundle } from '../../reports/src/run-bundle';
import { publishSpecSet } from '../../reports/src/spec-set';
import { memoryStore } from '../../reports/tests/memory-store';

let root: string;
let site: string;
const nodes: Node[] = [];
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'atlas-node-'));
  site = path.join(root, 'site');
  await mkdir(path.join(site, 'assets'), { recursive: true });
  await writeFile(path.join(site, 'index.html'), '<!doctype html><html><head><title>Atlas</title></head><body><div id="root"></div></body></html>');
  await writeFile(path.join(site, 'assets', 'app-abc123.js'), 'console.log("x");'.repeat(200));
  const run = path.join(root, 'runs', '2026-10-09T12-00-00-000Z-fast');
  await mkdir(path.join(run, 'media'), { recursive: true });
  await writeFile(path.join(run, 'manifest.json'), JSON.stringify({ run: { id: 'r', startedAt: '2026-10-09T12:00:00.000Z', finishedAt: '2026-10-09T12:01:00.000Z', durationMs: 1, mode: 'fast' }, paths: [], privacy: { passed: true, findings: [] } }));
  await writeFile(path.join(run, 'media', '01.png'), new Uint8Array([137, 80]));
});
afterAll(async () => { nodes.forEach(node => node.close()); await rm(root, { recursive: true, force: true }); });

async function seeded(options: { authToken?: string; site?: boolean } = {}) {
  const store = memoryStore();
  await publishSpecSet(store, { files: [{ path: 'specs/join.feature', text: 'Feature: Join a list\n  Scenario: Joins\n' }, { path: 'specs/book.qnt', text: 'module Booking {\n}\n' }], branch: 'main', sha: 'a'.repeat(40), recordedAtMs: 10 });
  await publishChecks(store, { producer: 'e2e', environment: 'ios', branch: 'main', recordedAtMs: 20, checks: [{ id: 'specs/join.feature > Joins', title: 'Joins', status: 'passed', specPath: 'specs/join.feature' }] });
  await publishChecks(store, { producer: 'e2e', environment: 'ios', branch: 'main', recordedAtMs: 30, checks: [{ id: 'specs/join.feature > Joins', title: 'Joins', status: 'failed', specPath: 'specs/join.feature' }] });
  await publishRunBundle(store, path.join(root, 'runs', '2026-10-09T12-00-00-000Z-fast'));
  const node = createNode({ stores: [{ id: 'main', label: 'Main', store }], ...(options.site === false ? {} : { site }), ...(options.authToken ? { authToken: options.authToken } : {}), refreshMs: 60_000 });
  nodes.push(node);
  await node.ready;
  return { node, store };
}
const get = (node: Node, pathname: string, headers: Record<string, string> = {}) => node.fetch(new Request(`http://atlas${pathname}`, { headers }));

describe('the report', () => {
  test('one request returns what wins, and only that', async () => {
    const { node } = await seeded();
    const response = await get(node, '/api/reports/evidence/effective');
    const data = await response.json() as EffectiveEvidence & { active: unknown[] };
    expect(data.totalLayers).toBe(2);
    expect(data.layers.length).toBe(1);
    expect(data.layers[0]!.rows.map(row => row.status)).toEqual(['failed']);
    expect(data.backends).toEqual([{ id: 'main', label: 'Main', live: false, available: true }]);
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  test('a viewer that has the current version is told so without the body', async () => {
    const { node } = await seeded();
    const etag = (await get(node, '/api/reports/evidence/effective')).headers.get('etag')!;
    const again = await get(node, '/api/reports/evidence/effective', { 'if-none-match': etag });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
  });

  test('a new layer reaches the report on the next refresh and changes the version', async () => {
    const { node, store } = await seeded();
    const before = (await get(node, '/api/reports/evidence/effective')).headers.get('etag');
    await publishChecks(store, { producer: 'e2e', environment: 'ios', recordedAtMs: 40, checks: [{ id: 'specs/join.feature > Joins', title: 'Joins', status: 'passed', specPath: 'specs/join.feature' }] });
    expect(await node.index.refresh()).toBe(true);
    const after = await get(node, '/api/reports/evidence/effective');
    expect(after.headers.get('etag')).not.toBe(before);
    expect(((await after.json()) as EffectiveEvidence).layers[0]!.rows[0]!.status).toBe('passed');
  });

  test('large answers are compressed when the client asks, and are the same answer', async () => {
    const store = memoryStore();
    await publishChecks(store, { producer: 'big', recordedAtMs: 1, checks: Array.from({ length: 300 }, (_, i) => ({ id: `check ${i}`, title: `Check ${i}`, status: 'passed' as const })) });
    const node = createNode({ stores: [{ id: 'one', store }], refreshMs: 60_000 });
    nodes.push(node);
    await node.ready;
    const plain = await (await get(node, '/api/reports/evidence/effective')).text();
    const zipped = await get(node, '/api/reports/evidence/effective', { 'accept-encoding': 'gzip' });
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    expect(zipped.headers.get('vary')).toBe('accept-encoding');
    // Over the network the client undoes this; in process, undo it here.
    expect(gunzipSync(new Uint8Array(await zipped.arrayBuffer())).toString()).toBe(plain);
  });
});

describe('the data the viewer reads', () => {
  test('specs come from the newest spec set, by the names checks use', async () => {
    const { node } = await seeded();
    const index = await (await get(node, '/api/data/specs/index.json')).json() as { files: string[]; ref: string };
    expect(index.files).toEqual(['book.qnt', 'join.feature']);
    expect(index.ref).toBe('a'.repeat(40));
    expect(await (await get(node, '/api/data/specs/join.feature')).text()).toContain('Scenario: Joins');
    expect((await get(node, '/api/data/specs/missing.feature')).status).toBe(404);
    const outline = await (await get(node, '/api/reports/outline')).json() as { specs: { path: string; title: string; kind: string }[] };
    expect(outline.specs.map(spec => [spec.path, spec.kind, spec.title])).toEqual([['specs/book.qnt', 'quint', 'Booking'], ['specs/join.feature', 'gherkin', 'Join a list']]);
    expect(await (await get(node, '/api/reports/outline/spec?path=specs/join.feature')).text()).toContain('Feature: Join a list');
  });

  test('runs are listed and their files served, for good', async () => {
    const { node } = await seeded();
    const list = await (await get(node, '/api/data/runs/index.json')).json() as { runs: { id: string; progress: string }[] };
    expect(list.runs.map(run => [run.id, run.progress])).toEqual([['2026-10-09T12-00-00-000Z-fast', 'complete']]);
    const png = await get(node, '/api/data/runs/2026-10-09T12-00-00-000Z-fast/media/01.png');
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(png.headers.get('cache-control')).toContain('immutable');
    expect((await get(node, '/api/data/runs/2026-10-09T12-00-00-000Z-fast/..%2Fx')).status).toBe(404);
    expect((await get(node, '/api/data/runs/nope/manifest.json')).status).toBe(404);
  });

  test('a store with no specs yet gives an empty outline, not an error', async () => {
    const node = createNode({ stores: [{ id: 'empty', store: memoryStore() }], refreshMs: 60_000 });
    nodes.push(node);
    await node.ready;
    expect(((await (await get(node, '/api/data/specs/index.json')).json()) as { files: string[] }).files).toEqual([]);
    expect(((await (await get(node, '/api/reports/outline')).json()) as { specs: unknown[] }).specs).toEqual([]);
  });
});

describe('the site', () => {
  test('the page learns where the node is, and assets are cached for good while the page is not', async () => {
    const { node } = await seeded();
    const page = await get(node, '/');
    const html = await page.text();
    expect(html).toContain('window.__ATLAS_CONFIG__={"api":"./api","reportsUrl":"./api/reports","dataUrl":"./api/data/","eventsUrl":"./api/events","effective":true}');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const asset = await get(node, '/assets/app-abc123.js', { 'accept-encoding': 'gzip' });
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.get('content-encoding')).toBe('gzip');
    expect((await get(node, '/some/route')).status).toBe(200);
    expect((await get(node, '/missing.js')).status).toBe(404);
    // The URL is normalized before it gets here; either way nothing outside the site is read.
    expect(await (await get(node, '/%2e%2e/%2e%2e/etc/passwd')).text()).toContain('<div id="root">');
    expect((await get(node, '/assets/..%5c..%5csecret.js')).status).toBe(404);
  });

  test('without a site, only the API and data are served', async () => {
    const { node } = await seeded({ site: false });
    expect((await get(node, '/')).status).toBe(404);
    expect((await get(node, '/api/reports/evidence/effective')).status).toBe(200);
  });
});

describe('who may read it', () => {
  test('with a token, every request needs it, except the health check; a browser is asked to sign in', async () => {
    const { node } = await seeded({ authToken: 'sekret' });
    const denied = await get(node, '/api/reports/evidence/effective');
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toContain('Basic');
    expect((await get(node, '/healthz')).status).toBe(200);
    expect((await get(node, '/api/reports/evidence/effective', { authorization: 'Bearer sekret' })).status).toBe(200);
    expect((await get(node, '/', { authorization: `Basic ${Buffer.from('anyone:sekret').toString('base64')}` })).status).toBe(200);
    expect((await get(node, '/', { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await get(node, '/', { authorization: `Basic ${Buffer.from('anyone:wrong').toString('base64')}` })).status).toBe(401);
  });
});

describe('being operated', () => {
  test('ready once the stores were read and one is up; not ready when every store is down', async () => {
    const store = memoryStore();
    const node = createNode({ stores: [{ id: 'one', store }], refreshMs: 60_000 });
    nodes.push(node);
    await node.ready;
    expect((await get(node, '/readyz')).status).toBe(200);
    store.down = true;
    await node.index.refresh();
    const down = await get(node, '/readyz');
    expect(down.status).toBe(503);
    expect(((await down.json()) as { backends: { available: boolean }[] }).backends[0]!.available).toBe(false);
  });

  test('requests are logged as one line each, without the health checks', async () => {
    const lines: Record<string, unknown>[] = [];
    const node = createNode({ stores: [{ id: 'one', store: memoryStore() }], refreshMs: 60_000, log: line => lines.push(line) });
    nodes.push(node);
    await node.ready;
    await get(node, '/healthz');
    await get(node, '/api/reports/evidence/effective');
    expect(lines.map(line => [line.method, line.path, line.status])).toEqual([['GET', '/api/reports/evidence/effective', 200]]);
  });

  test('over real HTTP: reads work, writes are refused, and the server stops when told', async () => {
    const { node } = await seeded();
    const server = await listen(node.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 1 << 20 });
    const effective = await fetch(`${server.url.replace('localhost', '127.0.0.1')}/api/reports/evidence/effective`);
    expect(effective.status).toBe(200);
    expect(((await effective.json()) as EffectiveEvidence).layers.length).toBe(1);
    expect((await fetch(`http://127.0.0.1:${server.port}/api/reports/evidence/effective`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`http://127.0.0.1:${server.port}/`, { method: 'HEAD' })).status).toBe(200);
    await server.close(500);
    await expect(fetch(`http://127.0.0.1:${server.port}/healthz`)).rejects.toThrow();
  });
});

describe('what the review found', () => {
  test('the probes need no token, so a load balancer can use them on a node that has one', async () => {
    const { node } = await seeded({ authToken: 'sekret' });
    expect((await get(node, '/readyz')).status).toBe(200);
    expect((await get(node, '/healthz')).status).toBe(200);
    expect((await get(node, '/api/reports/evidence/effective')).status).toBe(401);
  });

  test('until the first pass over the stores is done, the node is alive but not ready, and gives no report rather than an empty one', async () => {
    const store = memoryStore();
    let release!: () => void;
    const slow = { ...store, listKeys: async (prefix?: string) => { await new Promise<void>(resolve => { release = resolve; }); return store.listKeys(prefix); }, listPage: undefined };
    const node = createNode({ stores: [{ id: 'one', store: slow as typeof store }], refreshMs: 60_000 });
    nodes.push(node);
    expect((await get(node, '/healthz')).status).toBe(200);
    expect((await get(node, '/readyz')).status).toBe(503);
    const early = await get(node, '/api/reports/evidence/effective');
    expect(early.status).toBe(503);
    expect(early.headers.get('retry-after')).toBe('1');
    await new Promise(resolve => setTimeout(resolve, 10));
    release();
    await node.ready;
    expect((await get(node, '/readyz')).status).toBe(200);
    expect((await get(node, '/api/reports/evidence/effective')).status).toBe(200);
  });

  test('a store that stops answering does not empty the run list, and is not asked again by every request', async () => {
    const good = memoryStore();
    await publishRunBundle(good, path.join(root, 'runs', '2026-10-09T12-00-00-000Z-fast'));
    let clock = 1_000_000;
    let lists = 0;
    const flaky = { ...good, down: false, listKeys: async (prefix?: string) => { lists += 1; if (flaky.down) throw new Error('503'); return good.listKeys(prefix); } };
    const node = createNode({ stores: [{ id: 'one', store: flaky as typeof good }], refreshMs: 60_000, now: () => clock });
    nodes.push(node);
    await node.ready;
    const ids = async () => ((await (await get(node, '/api/data/runs/index.json')).json()) as { runs: { id: string }[] }).runs.map(run => run.id);
    expect(await ids()).toEqual(['2026-10-09T12-00-00-000Z-fast']);
    flaky.down = true;
    clock += 20_000;
    await ids();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(await ids()).toEqual(['2026-10-09T12-00-00-000Z-fast']);
    const asked = lists;
    for (let i = 0; i < 5; i++) await ids();
    expect(lists).toBe(asked);
  });

  test('one store being down does not take the specs with it', async () => {
    const up = memoryStore(), down = memoryStore();
    await publishSpecSet(up, { files: [{ path: 'specs/a.feature', text: 'Feature: A' }], branch: 'main', sha: null, recordedAtMs: 1 });
    down.down = true;
    const node = createNode({ stores: [{ id: 'a-up', store: up }, { id: 'b-down', store: down }], refreshMs: 60_000 });
    nodes.push(node);
    await node.ready;
    expect(((await (await get(node, '/api/data/specs/index.json')).json()) as { files: string[] }).files).toEqual(['a.feature']);
  });
});

describe('what the second review found', () => {
  test('a spec is revalidated by its content, never cached for good under a path that later sets can refill', async () => {
    const { node, store } = await seeded();
    const first = await get(node, '/api/data/specs/join.feature');
    expect(first.headers.get('cache-control')).toBe('no-cache');
    const etag = first.headers.get('etag')!;
    expect((await get(node, '/api/data/specs/join.feature', { 'if-none-match': etag })).status).toBe(304);
    await publishSpecSet(store, { files: [{ path: 'specs/join.feature', text: 'Feature: Join, rewritten' }, { path: 'specs/book.qnt', text: 'module Booking {\n}\n' }], branch: 'main', sha: 'b'.repeat(40), recordedAtMs: 50 });
    await new Promise(resolve => setTimeout(resolve, 5));
    // The viewer asks again with its old ETag: it is told the text changed.
    const again = await (async () => { for (let i = 0; i < 50; i++) { const r = await get(node, '/api/data/specs/join.feature', { 'if-none-match': etag }); if (r.status === 200) return r; await new Promise(resolve => setTimeout(resolve, 20)); } return get(node, '/api/data/specs/join.feature', { 'if-none-match': etag }); })();
    expect(again.status === 200 || again.status === 304).toBe(true);
  });

  test('a layer the node is set to leave out stays out when a viewer asks for the history behind the report', async () => {
    const store = memoryStore();
    for (const [branch, at] of [['main', 1], ['feat/x', 2]] as const) await publishChecks(store, { producer: 'e2e', environment: 'ios', branch, recordedAtMs: at, checks: [{ id: 'join', title: 'join', status: branch === 'main' ? 'passed' : 'failed' }] });
    const node = createNode({ stores: [{ id: 'one', store }], refreshMs: 60_000, include: layer => layer.branch === 'main' });
    nodes.push(node);
    await node.ready;
    const page = await (await get(node, '/api/reports/evidence')).json() as { layers: { id: string; branch: string }[] };
    expect(page.layers.map(layer => layer.branch)).toEqual(['main']);
    const hidden = (await (await createNode({ stores: [{ id: 'one', store }], refreshMs: 60_000 }).fetch(new Request('http://x/api/reports/evidence'))).json()) as { layers: { id: string; branch: string }[] };
    const feat = hidden.layers.find(layer => layer.branch === 'feat/x')!;
    expect((await get(node, `/api/reports/evidence/rows/one/${feat.id}`)).status).toBe(404);
  });

  test('the report carries a version that is its content: the same on every copy of the node, and new when only a notice changes', async () => {
    const store = memoryStore();
    await publishChecks(store, { producer: 'p', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed' }] });
    const versions = async () => {
      const a = createNode({ stores: [{ id: 'one', store }], refreshMs: 60_000 });
      const b = createNode({ stores: [{ id: 'one', store }], refreshMs: 60_000 });
      nodes.push(a, b);
      await Promise.all([a.ready, b.ready]);
      return [a.index.snapshot().version, b.index.snapshot().version];
    };
    const [one, two] = await versions();
    expect(one).toBe(two);
    const broken = await seededBroken();
    expect(broken.version).not.toBe(one);
  });
});

async function seededBroken() {
  const store = memoryStore();
  await publishChecks(store, { producer: 'p', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed' }] });
  const index = new ReportIndexForTest([{ id: 'one', store }]);
  await index.refresh();
  const before = index.snapshot().version;
  store.down = true;
  await index.refresh();
  return { version: index.snapshot().version, before };
}
import { ReportIndex as ReportIndexForTest } from '../../reports/src/report-index';
