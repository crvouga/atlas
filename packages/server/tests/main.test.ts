import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { directoryStore } from '../../reports/src/directory-store';
import { httpStore } from '../../reports/src/http-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { serveMain } from '../src/main';

const dirs: string[] = [];
const temp = async () => { const dir = await mkdtemp(path.join(tmpdir(), 'atlas-main-')); dirs.push(dir); return dir; };
afterAll(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });

describe('atlas serve', () => {
  test('starts on its data folder, takes uploads over HTTP into it, and stops when told', async () => {
    const cwd = await temp();
    await publishChecks(directoryStore(path.join(cwd, 'atlas-data')), { producer: 'seed', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed' }] });
    const controller = new AbortController();
    let output = '';
    const done = serveMain(['--port', '0', '--no-log'], { out: text => { output += text; }, env: {}, cwd, signal: controller.signal });
    for (let i = 0; i < 400 && !output.includes('Atlas ready'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    const url = /ready on (http:\/\/[^:]+:\d+)/.exec(output)?.[1]?.replace('localhost', '127.0.0.1');
    expect(url).toBeDefined();
    expect(output).toContain('1 layers');
    await publishChecks(httpStore({ url: url! }), { producer: 'laptop', recordedAtMs: 2, checks: [{ id: 'b', title: 'b', status: 'failed' }] });
    // What was uploaded is on the server's disk, and in the report.
    expect((await directoryStore(path.join(cwd, 'atlas-data')).listKeys('layers/index/')).length).toBe(2);
    expect(((await (await fetch(`${url}/api/status`)).json()) as { checks: { total: number } }).checks.total).toBe(2);
    controller.abort();
    expect(await done).toBe(0);
    expect(output).toContain('Stopping');
  }, 30_000);

  test('a mistake in the configuration is said and exits 2, before anything listens', async () => {
    const cwd = await temp();
    let output = '';
    expect(await serveMain(['--host', '0.0.0.0'], { out: text => { output += text; }, env: {}, cwd })).toBe(2);
    expect(output).toContain('no tokens');
    output = '';
    await writeFile(path.join(cwd, 'atlas.server.json'), '{ not json');
    expect(await serveMain([], { out: text => { output += text; }, env: {}, cwd })).toBe(2);
    expect(output).toContain('Cannot read');
  });

  test('an upload target that cannot be written to is found at the start', async () => {
    const cwd = await temp();
    await writeFile(path.join(cwd, 'atlas-data'), 'a file, not a folder');
    let output = '';
    const code = await serveMain(['--no-log'], { out: text => { output += text; }, env: {}, cwd }).catch(() => 2);
    expect(code).toBe(2);
  });
});
