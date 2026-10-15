import { afterAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { publishChecks } from '../../packages/reports/src/publish-checks';
import { directoryStore } from '../../packages/reports/src/directory-store';
import { createAtlasServer } from '../../packages/server/src/app';
import { listen } from '../../packages/server/src/host';
import { memoryStore } from '../../packages/reports/tests/memory-store';
import { publishExampleReports } from './publish';
import { httpStore } from '../../packages/reports/src/http-store';

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });

test('example publication populates the singleton with specs, chart runs, document results and recordings', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atlas-example-upload-'));
  roots.push(root);
  await mkdir(path.join(root, 'specs'));
  await writeFile(path.join(root, 'specs', 'flow.machine.json'), JSON.stringify({ id: 'Flow', initial: 'Start', states: { Start: {} } }));
  await writeFile(path.join(root, 'specs', 'todo.qnt'), 'module Todo {}');
  const runs = path.join(root, 'atlas-runs');
  const run = path.join(runs, '2026-10-14T12-00-00-000Z-fast');
  await mkdir(path.join(run, 'media'), { recursive: true });
  await writeFile(path.join(run, 'media', 'proof.txt'), 'recorded evidence');
  await writeFile(path.join(run, 'manifest.json'), JSON.stringify({ run: { id: path.basename(run), mode: 'fast', startedAt: '2026-10-14T12:00:00Z', finishedAt: '2026-10-14T12:00:01Z', specDirectory: 'specs' }, privacy: { passed: true }, charts: [{ file: 'flow.machine.json' }], paths: [{ id: 'p', key: 'path', name: 'Completes flow', status: 'passed' }] }));
  // A newer unfinished run must not hide the completed one.
  const newer = path.join(runs, '2026-10-14T13-00-00-000Z-fast');
  await mkdir(newer);
  await writeFile(path.join(newer, 'manifest.json'), JSON.stringify({ run: { finishedAt: null }, privacy: { passed: false } }));
  const documents = path.join(root, 'atlas-reports');
  await mkdir(documents);
  await publishChecks(directoryStore(documents), { producer: 'todo', recordedAtMs: 1, checks: [{ id: 'invariant', title: 'Invariant', status: 'passed', specPath: 'specs/todo.qnt' }] });
  const app = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data' });
  const http = await listen(app.fetch, { host: '127.0.0.1', port: 0, maxBodyBytes: 32 << 20 });
  await app.ready;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const project = `${http.url}/api/projects/todo-app`;
    await httpStore({ url: http.url, project: 'todo-app' }).put('layers/doctor-example/probe', new TextEncoder().encode('probe'), 'text/plain');
    const events = await fetch(`${project}/events`);
    reader = events.body!.getReader(); await reader.read();
    await publishExampleReports(http.url, { root, out: () => {} });
    const get = async (file: string) => (await fetch(`${project}${file.replace(/^\/api/, '')}`)).json();
    const evidence = await get('/api/reports/evidence/effective');
    expect(evidence.totalLayers).toBe(2);
    expect(evidence.layers.map((entry: { layer: { producer: string } }) => entry.layer.producer).sort()).toEqual(['todo', 'todo-statecharts']);
    expect((await get('/api/data/specs/index.json')).files).toEqual(['flow.machine.json', 'todo.qnt']);
    expect((await get('/api/data/runs/index.json')).runs.map((item: { id: string }) => item.id)).toEqual([path.basename(run)]);
    expect(await (await fetch(`${project}/data/runs/${path.basename(run)}/media/proof.txt`)).text()).toBe('recorded evidence');
    let heard = '';
    while (!heard.includes('event: report')) heard += new TextDecoder().decode((await reader.read()).value);
    expect(heard).toContain('event: report');
    await publishExampleReports(http.url, { root, out: () => {} });
    expect((await get('/api/reports/evidence/effective')).totalLayers).toBe(2);
  } finally { await reader?.cancel(); app.close(); await http.close(); }
});
