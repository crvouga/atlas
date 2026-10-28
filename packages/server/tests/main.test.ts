import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { httpStore } from '../../reports/src/http-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { serveMain } from '../src/main';
import { fakeS3, S3_TEST_ENV } from './fake-s3';
import { storeOn } from './fake-s3-store';

const dirs: string[] = [];
const temp = async () => { const dir = await mkdtemp(path.join(tmpdir(), 'atlas-main-')); dirs.push(dir); return dir; };
afterAll(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });

/** Starts `atlas serve` on the given fake S3 and resolves once it says it is ready (or has exited). */
async function start(s3: ReturnType<typeof fakeS3>, options: { env?: Record<string, string | undefined>; argv?: string[]; cwd?: string } = {}) {
  const cwd = options.cwd ?? await temp();
  const controller = new AbortController();
  const state = { output: '' };
  const done = serveMain(['--port', '0', '--no-log', ...(options.argv ?? [])], { out: text => { state.output += text; }, env: { ...S3_TEST_ENV, ...options.env } as Record<string, string>, cwd, signal: controller.signal, fetch: s3.fetch });
  for (let i = 0; i < 400 && !state.output.includes('Atlas ready') && !state.output.includes('ATLAS CANNOT START'); i++) await new Promise(resolve => setTimeout(resolve, 25));
  const url = /ready on (http:\/\/[^:]+:\d+)/.exec(state.output)?.[1]?.replace('localhost', '127.0.0.1');
  return { state, url, cwd, stop: async () => { controller.abort(); return done; } };
}

describe('atlas serve', () => {
  test('starts on S3, takes uploads over HTTP into the bucket, writes nothing to the local disk, and stops when told', async () => {
    const s3 = fakeS3();
    await publishChecks(storeOn(s3), { producer: 'seed', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed' }] });
    const server = await start(s3);
    expect(server.url).toBeDefined();
    expect(server.state.output).toContain('Storage: s3://atlas-test/');
    expect(server.state.output).toContain('1 layers');
    await publishChecks(httpStore({ url: server.url! }), { producer: 'laptop', recordedAtMs: 2, checks: [{ id: 'b', title: 'b', status: 'failed' }] });
    // What was uploaded is in the bucket, and in the report.
    expect((await storeOn(s3).listKeys('layers/index/')).length).toBe(2);
    expect(((await (await fetch(`${server.url}/api/status`)).json()) as { checks: { total: number } }).checks.total).toBe(2);
    expect(await readdir(server.cwd)).toEqual([]);
    expect(await server.stop()).toBe(0);
    expect(server.state.output).toContain('Stopping');
  }, 30_000);

  test('with no policy saved yet it says so, is explicit that nothing is deleted, and does not write a state object on its own', async () => {
    const s3 = fakeS3();
    const server = await start(s3);
    expect(server.state.output).toContain('No garbage collection policy has been saved in S3 (server/state.json) yet');
    expect(server.state.output).toContain('nothing is deleted');
    expect(s3.text('server/state.json')).toBeNull();
    await server.stop();
  }, 30_000);

  test('missing storage settings: nothing listens, nothing is contacted, every variable is named, and it exits 2', async () => {
    const s3 = fakeS3();
    const server = await start(s3, { env: { ATLAS_S3_ENDPOINT: undefined, ATLAS_S3_BUCKET: undefined, ATLAS_S3_REGION: undefined, ATLAS_S3_ACCESS_KEY_ID: undefined, ATLAS_S3_SECRET_ACCESS_KEY: undefined } });
    expect(await server.stop()).toBe(2);
    expect(server.url).toBeUndefined();
    expect(s3.requests).toEqual([]);
    expect(server.state.output).toContain('ATLAS CANNOT START: S3 STORAGE IS NOT USABLE');
    expect(server.state.output).toContain('ALL reports and ALL user state');
    for (const name of ['ATLAS_S3_ENDPOINT', 'ATLAS_S3_BUCKET', 'ATLAS_S3_REGION', 'ATLAS_S3_ACCESS_KEY_ID', 'ATLAS_S3_SECRET_ACCESS_KEY', 'ATLAS_S3_PREFIX', 'ATLAS_S3_PATH_STYLE', 'ATLAS_S3_SESSION_TOKEN']) expect(server.state.output).toContain(name);
    expect(server.state.output.match(/\[MISSING\]/g)?.length).toBe(5);
  });

  test('a malformed variable is called out as invalid next to the ones that are fine', async () => {
    const server = await start(fakeS3(), { env: { ATLAS_S3_ENDPOINT: 'ftp://nope', ATLAS_S3_REGION: undefined } });
    expect(await server.stop()).toBe(2);
    expect(server.state.output).toMatch(/\[INVALID\] ATLAS_S3_ENDPOINT/);
    expect(server.state.output).toMatch(/\[MISSING\] ATLAS_S3_REGION/);
    expect(server.state.output).toMatch(/\[ok\]\s+ATLAS_S3_BUCKET/);
  });

  test('credentials the storage rejects fail at the start, with what S3 said and every variable listed, not at the first upload', async () => {
    const server = await start(fakeS3({ accessKey: 'someone-else' }));
    expect(await server.stop()).toBe(2);
    expect(server.url).toBeUndefined();
    expect(server.state.output).toContain('ATLAS CANNOT START');
    expect(server.state.output).toContain('S3 said:');
    expect(server.state.output).toContain('access key id is not known');
    expect(server.state.output).toContain('ATLAS_S3_SECRET_ACCESS_KEY');
    expect(server.state.output).not.toContain(S3_TEST_ENV.ATLAS_S3_SECRET_ACCESS_KEY);
  });

  test('a bucket that does not exist fails at the start', async () => {
    const server = await start(fakeS3({ bucket: 'another-bucket' }));
    expect(await server.stop()).toBe(2);
    expect(server.state.output).toContain('S3 said:');
    expect(server.state.output).toContain('ATLAS_S3_BUCKET');
  });

  test('a user state object in S3 that cannot be read stops the server and is left exactly as it was', async () => {
    const s3 = fakeS3();
    await storeOn(s3).put('server/state.json', new TextEncoder().encode('{ not json'), 'application/json');
    const server = await start(s3);
    expect(await server.stop()).toBe(2);
    expect(server.state.output).toContain('ATLAS CANNOT START');
    expect(server.state.output).toContain('server/state.json');
    expect(server.state.output).toContain('not valid JSON');
    expect(s3.text('server/state.json')).toBe('{ not json');
  });

  test('a mistake in the configuration is said and exits 2, before anything listens', async () => {
    const cwd = await temp();
    let output = '';
    expect(await serveMain(['--host', '0.0.0.0'], { out: text => { output += text; }, env: S3_TEST_ENV, cwd })).toBe(2);
    expect(output).toContain('no tokens');
    output = '';
    await writeFile(path.join(cwd, 'atlas.server.json'), '{ not json');
    expect(await serveMain([], { out: text => { output += text; }, env: S3_TEST_ENV, cwd })).toBe(2);
    expect(output).toContain('Cannot read');
    output = '';
    await writeFile(path.join(cwd, 'atlas.server.json'), '{ "data": "./atlas-data" }');
    expect(await serveMain([], { out: text => { output += text; }, env: S3_TEST_ENV, cwd })).toBe(2);
    expect(output).toContain('"data" is no longer supported');
  });

  test('the settings saved in S3 are applied when it starts, below the environment', async () => {
    const s3 = fakeS3();
    await storeOn(s3).put('server/state.json', new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, settings: { refreshSeconds: 31, outlineBranch: 'trunk' } })), 'application/json');
    const server = await start(s3, { env: { ATLAS_OUTLINE_BRANCH: 'release' } });
    const settings = await (await fetch(`${server.url}/api/settings`)).json() as { settings: unknown; active: { refreshSeconds: number; outlineBranch: string } };
    expect(settings.settings).toEqual({ refreshSeconds: 31, outlineBranch: 'trunk' });
    expect(settings.active).toMatchObject({ refreshSeconds: 31, outlineBranch: 'release' });
    await server.stop();
  }, 30_000);
});
