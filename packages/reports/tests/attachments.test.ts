import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { CheckDetail } from '../src/evidence-detail';
import { evidenceFile, exportEvidence } from '../src/export-evidence';
import { readUtf8 } from '../src/object-io';
import { checksFromCtrf, checksFromJunit, checksFromManifest } from '../src/ingest';
import { createNode, type Node } from '../../server/tests/node-compat';
import { publishChecks } from '../src/publish-checks';
import { readLayer } from '../src/layer-store';
import { reportMain } from '../src/report-cli';
import type { EffectiveEvidence } from '../src/report-index';
import { memoryStore } from './memory-store';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const VIDEO = new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 251));
const nodes: Node[] = [];
afterAll(() => nodes.forEach(node => node.close()));

async function published() {
  const store = memoryStore();
  const layer = await publishChecks(store, {
    producer: 'e2e', environment: 'desktop-web', recordedAtMs: 10, branch: 'main',
    labels: { build: '42' }, links: [{ url: 'https://ci.example.com/42', name: 'CI' }],
    attachments: [{ name: 'ci.log', role: 'log', text: 'x'.repeat(20_000) }],
    checks: [{
      id: 'pay', title: 'Pays', status: 'failed', detail: 'no receipt', tags: ['smoke'], labels: { owner: 'payments' },
      steps: [{ id: 's1', name: 'Open', status: 'passed', offsetMs: 0, durationMs: 5, attachments: [{ name: 'step.png', data: PNG, contentType: 'image/png' }] }, { id: 's2', parentId: 's1', name: 'Click', status: 'failed' }],
      attachments: [
        { id: 'v', name: 'run.webm', role: 'video', data: VIDEO, contentType: 'video/webm', durationMs: 4200 },
        { name: 'shot.png', role: 'screenshot', data: PNG },
        { name: 'again.png', role: 'screenshot', data: PNG, contentType: 'image/png' },
        { name: 'note.txt', text: 'short note' },
        { name: 'trace.zip', uri: 'https://artifacts.example.com/trace.zip', role: 'trace' },
        { name: 'b64.png', base64: Buffer.from(PNG).toString('base64'), contentType: 'image/png' }
      ],
      annotations: [{ type: 'accessibility', level: 'warning', message: 'low contrast' }],
      attempts: [{ index: 0, status: 'failed', attachments: [{ name: 'retry-0.png', data: new Uint8Array([9, 9, 9]), contentType: 'image/png' }] }],
      extensions: { 'com.example.cost': { cents: 3 } }
    }, { id: 'plain', title: 'Plain', status: 'passed' }]
  });
  const node = createNode({ stores: [{ id: 'one', store }], refreshMs: 60_000 });
  nodes.push(node);
  await node.ready;
  return { store, layer, node };
}
const get = (node: Node, pathname: string, headers: Record<string, string> = {}) => node.fetch(new Request(`http://atlas${pathname}`, { headers }));

describe('publishing evidence', () => {
  test('bytes go into the layer, by content: the same file attached five times is stored once', async () => {
    const { store, layer } = await published();
    const stored = await readLayer(store, layer.id);
    const check = stored!.parts[0]!.checks[0]!;
    const named = Object.fromEntries(check.attachments!.map(item => [item.name, item]));
    expect(named['shot.png']).toMatchObject({ contentType: 'image/png', bytes: PNG.length });
    expect(named['shot.png']!.bundleKey).toMatch(/^attachments\/[0-9a-f]{64}$/);
    // Four copies of one picture (data, data, base64, a step's) are one stored file.
    const keys = new Set([named['shot.png']!.bundleKey, named['again.png']!.bundleKey, named['b64.png']!.bundleKey, check.steps![0]!.attachments![0]!.bundleKey]);
    expect(keys.size).toBe(1);
    // A name with a known extension needs no media type.
    expect(named['shot.png']!.sha256).toBe(named['again.png']!.sha256);
    expect(named['run.webm']).toMatchObject({ bundleKey: expect.any(String), bytes: 1000, durationMs: 4200 });
    // A short note stays in the document; an external file is a reference, untouched.
    expect(named['note.txt']).toMatchObject({ text: 'short note', bytes: 10 });
    expect(named['note.txt']!.bundleKey).toBeUndefined();
    expect(named['trace.zip']).toMatchObject({ uri: 'https://artifacts.example.com/trace.zip' });
    // A long text becomes a file; bytes the producer gave are never left in the document.
    expect(stored!.attachments![0]).toMatchObject({ name: 'ci.log', bytes: 20_000, bundleKey: expect.any(String) });
    expect(stored!.attachments![0]!.text).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain('"data"');
    expect(JSON.stringify(stored)).not.toContain('"base64"');
    expect(check.attempts![0]!.attachments![0]!.bundleKey).toMatch(/^attachments\//);
  });

  test('publishing the same evidence again is the same layer', async () => {
    const one = await published();
    const two = await published();
    expect(two.layer.id).toBe(one.layer.id);
  });

  test('a file named by path is for the command line; a file over the limit is refused with the way out', async () => {
    await expect(publishChecks(memoryStore(), { producer: 'p', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed', attachments: [{ name: 'x', path: './x.png' }] }] })).rejects.toThrow('names a file (path)');
    await expect(publishChecks(memoryStore(), { producer: 'p', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed', attachments: [{ name: 'big.bin', data: new Uint8Array(100) }] }] }, { maxAttachmentBytes: 50 })).rejects.toThrow('attach its uri');
    await expect(publishChecks(memoryStore(), { producer: 'p', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed', attachments: [{ role: 'screenshot' } as never] }] })).rejects.toThrow('attachments.0.name');
  });

  test('evidence rides along a result without changing what it is: the report is the same with and without it', async () => {
    const { node } = await published();
    const bare = createNode({ stores: [{ id: 'one', store: await (async () => { const s = memoryStore(); await publishChecks(s, { producer: 'e2e', environment: 'desktop-web', recordedAtMs: 10, branch: 'main', checks: [{ id: 'pay', title: 'Pays', status: 'failed', detail: 'no receipt' }, { id: 'plain', title: 'Plain', status: 'passed' }] }); return s; })() }], refreshMs: 60_000 });
    nodes.push(bare);
    await bare.ready;
    const rows = async (n: Node) => ((await (await get(n, '/api/reports/evidence/effective')).json()) as EffectiveEvidence).layers.flatMap(entry => entry.rows).map(row => [row.id, row.status, row.kind]).sort();
    expect(await rows(node)).toEqual(await rows(bare));
  });
});

describe('reading evidence back', () => {
  test('a row says there is evidence without carrying it, and the layer says what the run carried', async () => {
    const { node } = await published();
    const [entry] = ((await (await get(node, '/api/reports/evidence/effective')).json()) as EffectiveEvidence).layers;
    const pay = entry!.rows.find(row => row.id === 'pay')!;
    expect(pay.evidence).toMatchObject({ attachments: 8, steps: 2, annotations: 1, attempts: 1, tags: ['smoke'], labels: { owner: 'payments' }, roles: ['image', 'screenshot', 'text', 'trace', 'video'] });
    expect(JSON.stringify(pay)).not.toContain('bundleKey');
    expect(entry!.rows.find(row => row.id === 'plain')!.evidence).toBeUndefined();
    expect(entry!.layer.evidence).toMatchObject({ attachments: 1, links: 1, labels: { build: '42' } });
  });

  test('opening a result gives everything it carries, and the run it was part of', async () => {
    const { node, layer } = await published();
    const detail = await (await get(node, `/api/reports/evidence/detail/one/${layer.id}?check=pay`)).json() as CheckDetail;
    expect(detail.check.steps!.map(step => step.name)).toEqual(['Open', 'Click']);
    expect(detail.check.extensions).toEqual({ 'com.example.cost': { cents: 3 } });
    expect(detail.run.links![0]!.url).toBe('https://ci.example.com/42');
    expect((await get(node, `/api/reports/evidence/detail/one/${layer.id}?check=nope`)).status).toBe(404);
    expect((await get(node, `/api/reports/evidence/detail/one/${layer.id}`)).status).toBe(200);
    expect((await get(node, `/api/reports/evidence/detail/nope/${layer.id}?check=pay`)).status).toBe(404);
    expect((await get(node, '/api/reports/evidence/detail/one/not-a-layer?check=pay')).status).toBe(404);
  });

  test('an attachment is served as untrusted bytes: never sniffed, sandboxed, cached for good', async () => {
    const { node, store, layer } = await published();
    const key = (await readLayer(store, layer.id))!.parts[0]!.checks[0]!.attachments![1]!.bundleKey!;
    const response = await get(node, `/api/reports/layers/${layer.id}/blobs/${key}`);
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...PNG]);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('cache-control')).toContain('immutable');
    const again = await get(node, `/api/reports/layers/${layer.id}/blobs/${key}`, { 'if-none-match': response.headers.get('etag')! });
    expect(again.status).toBe(304);
  });

  test('a video can be sought: byte ranges are answered', async () => {
    const { node, store, layer } = await published();
    const key = (await readLayer(store, layer.id))!.parts[0]!.checks[0]!.attachments![0]!.bundleKey!;
    const url = `/api/reports/layers/${layer.id}/blobs/${key}`;
    const part = await get(node, url, { range: 'bytes=10-19' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([...VIDEO.slice(10, 20)]);
    const tail = await get(node, url, { range: 'bytes=-5' });
    expect([...new Uint8Array(await tail.arrayBuffer())]).toEqual([...VIDEO.slice(995)]);
    expect((await get(node, url, { range: 'bytes=990-' })).headers.get('content-range')).toBe('bytes 990-999/1000');
    expect((await get(node, url, { range: 'bytes=5000-6000' })).status).toBe(416);
    expect((await get(node, url)).headers.get('accept-ranges')).toBe('bytes');
  });

  test('only what a layer holds can be asked for, and nothing outside it', async () => {
    const { node, layer } = await published();
    for (const bad of ['attachments/' + 'f'.repeat(64), '../manifests/x', 'attachments/../../x', '']) expect((await get(node, `/api/reports/layers/${layer.id}/blobs/${bad}`)).status).toBe(404);
    expect((await get(node, `/api/reports/layers/${'0'.repeat(64)}/blobs/attachments/x`)).status).toBe(404);
  });

  test('a layer the node leaves out cannot be read through the evidence routes either', async () => {
    const store = memoryStore();
    const hidden = await publishChecks(store, { producer: 'p', branch: 'feat/x', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed', attachments: [{ name: 'x.png', data: PNG }] }] });
    const node = createNode({ stores: [{ id: 'one', store }], refreshMs: 60_000, include: layer => layer.branch === 'main' });
    nodes.push(node);
    await node.ready;
    expect((await get(node, `/api/reports/evidence/detail/one/${hidden.id}?check=a`)).status).toBe(404);
  });
});

describe('what test tools already write', () => {
  test('CTRF: steps, attachments, logs, a screenshot, retries, tags and the rest keep their place', () => {
    const { checks, labels } = checksFromCtrf({
      results: {
        tool: { name: 'playwright', version: '1.50' }, environment: { buildName: 'nightly', osPlatform: 'linux' }, summary: { stop: 5 },
        tests: [{
          name: 'pays', status: 'failed', filePath: 'specs/pay.feature', suite: ['Checkout'], message: 'no receipt', trace: 'at pay.ts:1', snippet: 'await pay()', line: 12,
          tags: ['smoke'], browser: 'chromium', flaky: true, stdout: ['a', 'b'], stderr: [],
          steps: [{ name: 'Open', status: 'passed' }, { name: 'Pay', status: 'failed' }],
          attachments: [{ name: 'video', contentType: 'video/webm', path: 'out/v.webm' }],
          screenshot: 'aGVsbG8=',
          retryAttempts: [{ attempt: 1, status: 'failed', duration: 10, message: 'first' }],
          extra: { owner: 'team' }
        }]
      }
    });
    expect(labels).toEqual({ buildName: 'nightly', osPlatform: 'linux', tool: 'playwright', 'tool.version': '1.50' });
    const check = checks[0]!;
    expect(check).toMatchObject({ tags: ['smoke'], labels: { browser: 'chromium', flaky: 'true' }, extensions: { 'ctrf.extra': { owner: 'team' } } });
    expect(check.steps!.map(step => [step.name, step.status])).toEqual([['Open', 'passed'], ['Pay', 'failed']]);
    expect(check.attachments!.map(item => [item.name, item.role ?? null])).toEqual([['video', null], ['screenshot.png', 'screenshot'], ['stdout', 'log'], ['stack trace', 'log']]);
    expect(check.attempts).toEqual([{ index: 0, status: 'failed', durationMs: 10, detail: 'first' }]);
    expect(check.annotations![0]).toMatchObject({ type: 'snippet', source: { file: 'specs/pay.feature', line: 12 } });
  });

  test('JUnit: output, errors, properties and Jenkins attachment lines', () => {
    const { checks } = checksFromJunit(`<testsuites><testsuite name="s"><properties><property name="build" value="7"/></properties>
      <testcase classname="C" name="a"><system-out><![CDATA[hello\n[[ATTACHMENT|/tmp/shot.png]]]]></system-out><system-err>oops</system-err><properties><property name="owner" value="me"/></properties></testcase></testsuite></testsuites>`);
    const check = checks[0]!;
    expect(check.labels).toEqual({ build: '7', owner: 'me' });
    expect(check.attachments!.map(item => [item.name, item.role ?? null])).toEqual([['stdout', 'log'], ['stderr', 'log'], ['shot.png', null]]);
    expect(check.attachments![2]).toMatchObject({ path: '/tmp/shot.png' });
  });

  test('an Atlas run: each path keeps its steps, with the transition each took', () => {
    const { checks } = checksFromManifest({ run: { id: 'r', startedAt: '2026-10-09T12:00:00Z', finishedAt: '2026-10-09T12:01:00Z', durationMs: 1 }, paths: [{ id: 'p', key: 'k', name: 'Pays', kind: 'journey', status: 'failed', journeys: ['Pays'], steps: [{ event: 'Picks card', status: 'passed', transition: 'Choosing :: Picks card' }, { event: 'Submits', status: 'failed', reason: 'declined' }] }] });
    expect(checks[0]!.steps).toEqual([
      { name: 'Picks card', kind: 'event', status: 'passed', extensions: { 'atlas.transition': 'Choosing :: Picks card' } },
      { name: 'Submits', kind: 'event', status: 'failed', detail: 'declined' }
    ]);
    expect(checks[0]).toMatchObject({ labels: { kind: 'journey' }, tags: ['Pays'] });
  });
});

describe('publishing evidence from the command line', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'atlas-evidence-'));
    await mkdir(path.join(root, 'out'), { recursive: true });
    await writeFile(path.join(root, 'out', 'shot.png'), PNG);
    await writeFile(path.join(root, 'out', 'run.webm'), VIDEO);
    await writeFile(path.join(root, 'ci.log'), 'build log');
    await writeFile(path.join(root, 'report.ctrf.json'), JSON.stringify({ results: { tool: { name: 'jest' }, summary: { stop: 10 }, tests: [{ name: 'pays', status: 'failed', attachments: [{ name: 'shot', contentType: 'image/png', path: 'out/shot.png' }, { name: 'gone', path: 'out/missing.png' }] }] } }));
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  const run = async (args: string[]) => { let output = ''; const code = await reportMain(args, { out: text => { output += text; }, env: {}, cwd: root, git: () => null }); return { code, output }; };

  test('files a report names are found beside it and stored; one that is missing is skipped with a warning, and the results still publish', async () => {
    const result = await run(['publish', '--store', 'cli-store', '--producer', 'unit', '--ctrf', 'report.ctrf.json', '--attach', 'ci.log', '--attach', 'video=out/run.webm', '--label', 'build=7', '--link', 'CI=https://ci.example.com/7']);
    expect(result.code).toBe(0);
    expect(result.output).toContain('3 attachment files');
    expect(result.output).toContain('! attachment skipped: gone: file not found');
    const { directoryStore } = await import('../src/directory-store');
    const store = directoryStore(path.join(root, 'cli-store'));
    const [manifest] = await store.listKeys('layers/manifests/');
    const layer = await readLayer(store, manifest!.split('/').at(-1)!.replace('.json', ''));
    expect(layer!.labels).toEqual({ build: '7', tool: 'jest' });
    expect(layer!.links).toEqual([{ name: 'CI', url: 'https://ci.example.com/7' }]);
    expect(layer!.attachments!.map(item => [item.name, item.role ?? null, item.contentType])).toEqual([['ci.log', null, 'text/plain; charset=utf-8'], ['run.webm', 'video', 'video/webm']]);
    expect(layer!.parts[0]!.checks[0]!.attachments!.map(item => item.name)).toEqual(['shot']);
  });

  test('a file over the limit is skipped, not published', async () => {
    const result = await run(['publish', '--store', 'cli-store-2', '--producer', 'unit', '--ctrf', 'report.ctrf.json', '--attach', 'out/run.webm', '--max-attachment-mb', '0']);
    expect(result.output).toContain('over the limit');
    expect(result.code).toBe(0);
  });
});

describe('a site with no server', () => {
  test('exporting the report takes every file a result points to, so the static viewer can show it', async () => {
    const { node, store, layer } = await published();
    const target = memoryStore();
    const result = await exportEvidence({ fetch: async path => node.fetch(new Request(`http://atlas/api/reports${path}`)), target });
    expect(result.missing).toEqual([]);
    const stored = await readLayer(store, layer.id);
    const check = stored!.parts[0]!.checks[0]!;
    const detail = JSON.parse((await readUtf8(target, evidenceFile(`/evidence/detail/one/${layer.id}?check=pay&kind=checks`)))!) as CheckDetail;
    expect(detail.check.steps!.length).toBe(2);
    for (const key of [check.attachments![0]!.bundleKey!, check.attachments![1]!.bundleKey!, check.steps![0]!.attachments![0]!.bundleKey!, stored!.attachments![0]!.bundleKey!]) {
      expect(await target.head(evidenceFile(`/layers/${layer.id}/blobs/${key}`))).toBe(true);
    }
    // The run's own evidence is exported too.
    expect(await target.head(evidenceFile(`/evidence/detail/one/${layer.id}`))).toBe(true);
  });
});

describe('the documentation is executable', () => {
  test('the checks file in docs/extending.md publishes, with its files found and its evidence stored', async () => {
    const guide = (await import('node:fs')).readFileSync(path.join(import.meta.dir, '..', '..', '..', 'docs', 'extending.md'), 'utf8');
    const block = /```json\n(\{\n  "producer": "playwright"[\s\S]*?\n\})\n```/.exec(guide)?.[1];
    expect(block).toBeDefined();
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-docs-evidence-'));
    try {
      await mkdir(path.join(root, 'evidence'), { recursive: true });
      await writeFile(path.join(root, 'evidence', 'failure.png'), PNG);
      await writeFile(path.join(root, 'evidence', 'run.webm'), VIDEO);
      await writeFile(path.join(root, 'checks.json'), block!);
      let output = '';
      const code = await reportMain(['publish', '--store', 'store', '--checks', 'checks.json'], { out: text => { output += text; }, env: {}, cwd: root, git: () => null });
      expect(code).toBe(0);
      expect(output).toContain('2 attachment files');
      expect(output).not.toContain('skipped');
      const { directoryStore } = await import('../src/directory-store');
      const store = directoryStore(path.join(root, 'store'));
      const [manifest] = await store.listKeys('layers/manifests/');
      const layer = await readLayer(store, manifest!.split('/').at(-1)!.replace('.json', ''));
      const check = layer!.parts[0]!.checks[0]!;
      expect(check.steps![1]!.attachments![0]).toMatchObject({ name: 'failure.png', role: 'screenshot', contentType: 'image/png' });
      expect(check.attachments!.map(item => [item.name, item.text ?? null, item.bundleKey ? 'stored' : 'inline'])).toEqual([['run.webm', null, 'stored'], ['console.log', 'warn: slow response', 'inline']]);
      expect(check.extensions).toEqual({ 'io.playwright': { retries: 1 } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('a report is data from a test run, not instructions', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'atlas-confine-'));
    await mkdir(path.join(root, 'reports', 'shots'), { recursive: true });
    await mkdir(path.join(root, 'elsewhere'), { recursive: true });
    await writeFile(path.join(root, 'reports', 'shots', 'ok.png'), PNG);
    await writeFile(path.join(root, 'reports', '.env'), 'SECRET=1');
    await writeFile(path.join(root, 'elsewhere', 'secret.txt'), 'top secret');
    await writeFile(path.join(root, 'elsewhere', 'wanted.txt'), 'allowed by a root');
    await (await import('node:fs/promises')).symlink(path.join(root, 'elsewhere', 'secret.txt'), path.join(root, 'reports', 'link.txt'));
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  const run = async (args: string[]) => { let output = ''; const code = await reportMain(args, { out: text => { output += text; }, env: {}, cwd: root, git: () => null }); return { code, output }; };
  const stored = async (store: string) => {
    const { directoryStore } = await import('../src/directory-store');
    const s = directoryStore(path.join(root, store));
    const [manifest] = await s.listKeys('layers/manifests/');
    return readLayer(s, manifest!.split('/').at(-1)!.replace('.json', ''));
  };

  test('a path in a CTRF report may name only files in its own folder: not an absolute path, not ../, not a hidden file, not a link out', async () => {
    const tests = [{ name: 't', status: 'passed', attachments: [
      { name: 'ok', path: 'shots/ok.png' },
      { name: 'absolute', path: path.join(root, 'elsewhere', 'secret.txt') },
      { name: 'up', path: '../elsewhere/secret.txt' },
      { name: 'hidden', path: '.env' },
      { name: 'link', path: 'link.txt' }
    ] }];
    await writeFile(path.join(root, 'reports', 'ctrf.json'), JSON.stringify({ results: { tool: { name: 'x' }, summary: { stop: 1 }, tests } }));
    const result = await run(['publish', '--store', 's1', '--producer', 'unit', '--ctrf', 'reports/ctrf.json']);
    expect(result.code).toBe(0);
    expect(result.output).toContain('1 attachment file ');
    for (const blocked of ['absolute', 'up', 'hidden', 'link']) expect(result.output).toContain(`! attachment skipped: ${blocked}:`);
    expect(result.output).toContain('--attach-root');
    expect((await stored('s1'))!.parts[0]!.checks[0]!.attachments!.map(item => item.name)).toEqual(['ok']);
  });

  test('JUnit output that says to attach a file cannot reach outside the report either', async () => {
    await writeFile(path.join(root, 'reports', 'out.xml'), `<testsuites><testsuite name="s"><testcase name="a"><system-out>[[ATTACHMENT|${path.join(root, 'elsewhere', 'secret.txt')}]]\n[[ATTACHMENT|shots/ok.png]]</system-out></testcase></testsuite></testsuites>`);
    const result = await run(['publish', '--store', 's2', '--producer', 'unit', '--junit', 'reports/out.xml']);
    expect(result.output).toContain('secret.txt: ');
    expect((await stored('s2'))!.parts[0]!.checks[0]!.attachments!.map(item => item.name)).toEqual(['stdout', 'ok.png']);
  });

  test('a folder the person names is allowed; a file they name with --attach is theirs to choose', async () => {
    await writeFile(path.join(root, 'reports', 'ctrf2.json'), JSON.stringify({ results: { tool: { name: 'x' }, summary: { stop: 1 }, tests: [{ name: 't', status: 'passed', attachments: [{ name: 'wanted', path: path.join(root, 'elsewhere', 'wanted.txt') }] }] } }));
    const blocked = await run(['publish', '--store', 's3', '--producer', 'unit', '--ctrf', 'reports/ctrf2.json']);
    expect(blocked.output).toContain('wanted: ');
    const allowed = await run(['publish', '--store', 's4', '--producer', 'unit', '--ctrf', 'reports/ctrf2.json', '--attach-root', 'elsewhere', '--attach', path.join(root, 'elsewhere', 'secret.txt')]);
    expect(allowed.output).toContain('2 attachment files');
    const layer = (await stored('s4'))!;
    expect(layer.parts[0]!.checks[0]!.attachments!.map(item => item.name)).toEqual(['wanted']);
    expect(layer.attachments!.map(item => item.name)).toEqual(['secret.txt']);
  });

  test('a layer attachment a checks file names that is missing is skipped, and the results still publish', async () => {
    await writeFile(path.join(root, 'reports', 'layer.json'), JSON.stringify({ producer: 'p', recordedAtMs: 1, attachments: [{ name: 'gone.log', path: 'gone.log' }], checks: [{ id: 'a', title: 'a', status: 'passed' }] }));
    const result = await run(['publish', '--store', 's5', '--checks', 'reports/layer.json']);
    expect(result.code).toBe(0);
    expect(result.output).toContain('! attachment skipped: gone.log: file not found');
    expect((await stored('s5'))!.attachments).toBeUndefined();
  });

  test('a command that is wrong writes nothing', async () => {
    await expect(run(['publish', '--store', 's6', '--producer', 'unit', '--junit', 'reports/out.xml', '--upload-run'])).rejects.toThrow('--upload-run goes with --manifest');
    const { directoryStore } = await import('../src/directory-store');
    expect(await directoryStore(path.join(root, 's6')).listKeys()).toEqual([]);
  });

  test('the files of one publish together cannot pass a budget', async () => {
    const result = await run(['publish', '--store', 's7', '--producer', 'unit', '--ctrf', 'reports/ctrf.json', '--max-total-attachment-mb', '0']);
    expect(result.output).toContain('pass the budget');
    await expect(publishChecks(memoryStore(), { producer: 'p', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed', attachments: [{ name: 'x', data: new Uint8Array(100) }, { name: 'y', data: new Uint8Array([1]) }] }] }, { maxTotalAttachmentBytes: 50 })).rejects.toThrow('Attach the largest by uri');
  });
});

describe('what the evidence routes serve', () => {
  test('files of a run are untrusted bytes too: an HTML report in one cannot run as part of the viewer', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-run-html-'));
    try {
      const dir = path.join(root, '2026-10-09T12-00-00-000Z-fast');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ run: { id: 'r', startedAt: '2026-10-09T12:00:00.000Z', finishedAt: '2026-10-09T12:01:00.000Z', durationMs: 1 }, paths: [], privacy: { passed: true, findings: [] } }));
      await writeFile(path.join(dir, 'report.html'), '<script>fetch("/api/reports/evidence/effective")</script>');
      const store = memoryStore();
      await (await import('../src/run-bundle')).publishRunBundle(store, dir);
      const node = createNode({ stores: [{ id: 'one', store }], refreshMs: 60_000 });
      nodes.push(node);
      await node.ready;
      const response = await get(node, '/api/data/runs/2026-10-09T12-00-00-000Z-fast/report.html');
      expect(response.headers.get('content-security-policy')).toContain('sandbox');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a layer the node leaves out gives up none of its files either', async () => {
    const store = memoryStore();
    const hidden = await publishChecks(store, { producer: 'p', branch: 'feat/x', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed', attachments: [{ name: 'x.png', data: PNG }] }] });
    const key = (await readLayer(store, hidden.id))!.parts[0]!.checks[0]!.attachments![0]!.bundleKey!;
    const open = createNode({ stores: [{ id: 'one', store }], refreshMs: 60_000 });
    const narrow = createNode({ stores: [{ id: 'one', store }], refreshMs: 60_000, include: layer => layer.branch === 'main' });
    nodes.push(open, narrow);
    await Promise.all([open.ready, narrow.ready]);
    expect((await get(open, `/api/reports/layers/${hidden.id}/blobs/${key}`)).status).toBe(200);
    expect((await get(narrow, `/api/reports/layers/${hidden.id}/blobs/${key}`)).status).toBe(404);
  });
});

describe('JUnit as tools nest it', () => {
  test('a case after an inner suite, a case in a self-closing neighbour and nested properties are all read', () => {
    const { checks } = checksFromJunit(`<testsuites>
      <testsuite name="outer" file="specs/a.feature"><properties><property name="build" value="9"/></properties>
        <testsuite name="inner"><testcase name="in-inner"/></testsuite>
        <testsuite name="empty" tests="0"/>
        <testcase name="after-inner"><failure message="boom"/></testcase>
      </testsuite>
      <testsuite name="sibling"><testcase name="in-sibling"/></testsuite>
    </testsuites>`);
    expect(checks.map(check => [check.title, check.status])).toEqual([['in-inner', 'passed'], ['after-inner', 'failed'], ['in-sibling', 'passed']]);
    expect(checks[0]!.labels).toEqual({ build: '9' });
    expect(checks[2]!.labels).toBeUndefined();
  });
});
