/**
 * @module Garbage collection policy tests
 *
 * The policy is defined through the API the Atlas UI uses, stored as JSON in S3 (a fake S3 here) and nowhere else, read
 * back from S3 every time the server collects, and applied to every project. With no policy saved, nothing is deleted.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { publishChecks } from '../../reports/src/publish-checks';
import { writeUtf8 } from '../../reports/src/object-io';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { loadServerConfig } from '../src/config';
import { storedSettings } from '../src/settings';
import { USER_STATE_KEY, userStateStore } from '../src/user-state';
import { fakeS3, S3_TEST_ENV } from './fake-s3';
import { storeOn } from './fake-s3-store';

const DAY = 86_400_000;
const NOW = 1000 * DAY;
const apps: AtlasServer[] = [];
const dirs: string[] = [];
afterEach(async () => { apps.splice(0).forEach(app => app.close()); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function layersOf(store: ReturnType<typeof storeOn>, days: number[]) {
  for (const day of days) await publishChecks(store, { producer: 'suite', recordedAtMs: day * DAY, checks: [{ id: 'login', title: 'login', status: 'passed', attachments: [{ name: 'log.txt', text: `day ${day} `.repeat(3000) }] }] });
}

async function setup(options: { gcCheckMs?: number; days?: number[] } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'atlas-gc-'));
  dirs.push(dir);
  const s3 = fakeS3();
  await layersOf(storeOn(s3), options.days ?? [1, 2, 3, 4]);
  const config = loadServerConfig([], S3_TEST_ENV, dir, () => '{}');
  const { settings, gc } = storedSettings(config, [], S3_TEST_ENV, dir, userStateStore(storeOn(s3)));
  const app = createAtlasServer({
    backends: [{ id: 's3', store: storeOn(s3) }], write: 's3', settings, gc, now: () => NOW, refreshMs: 60_000,
    tokens: [{ name: 'admin', role: 'admin', token: 'admin-token-123' }, { name: 'ci', role: 'publish', token: 'publish-token-123' }],
    ...(options.gcCheckMs ? { gcCheckMs: options.gcCheckMs } : {})
  });
  apps.push(app);
  await app.ready;
  const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.fetch(new Request(`http://atlas${url}`, { method, headers: { authorization: 'Bearer admin-token-123', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const read = async () => (await (await call('GET', '/api/settings/gc')).json()) as { revision: string; policy: unknown; saved: boolean; lastRuns: { project: string; deletedLayers: number }[]; stateKey: string };
  const save = async (policy: unknown) => call('PUT', '/api/settings/gc', policy, { 'if-match': `"${(await read()).revision}"` });
  return { dir, s3, app, call, read, save, layerKeys: () => storeOn(s3).listKeys('layers/index/') };
}

const POLICY = { enabled: true, maxAgeDays: 30, keepLatest: 1, intervalHours: 24 };

describe('the garbage collection policy', () => {
  test('before one is saved, the API says so explicitly, nothing is deleted, and nothing is written to S3', async () => {
    const { read, call, s3, layerKeys } = await setup();
    expect(await read()).toMatchObject({ policy: null, saved: false, lastRuns: [], stateKey: 'server/state.json' });
    const run = await call('POST', '/api/settings/gc/run');
    expect(run.status).toBe(409);
    expect((await run.json()).detail).toContain('No garbage collection policy has been saved yet');
    expect((await layerKeys()).length).toBe(4);
    expect(s3.text(USER_STATE_KEY)).toBeNull();
  });

  test('a policy saved through the API is stored as JSON in S3 and read back from there, and nowhere on disk', async () => {
    const { save, read, s3, dir } = await setup();
    const saved = await save(POLICY);
    expect(saved.status).toBe(200);
    expect(JSON.parse(s3.text(USER_STATE_KEY)!)).toEqual({ schemaVersion: 1, gc: POLICY });
    expect(await read()).toMatchObject({ saved: true, policy: POLICY });
    expect(await readdir(dir)).toEqual([]);
    // Defaults are filled for a partial policy, so what is stored is complete.
    expect((await (await save({ enabled: false, maxAgeDays: 7 })).json()).policy).toEqual({ enabled: false, maxAgeDays: 7, keepLatest: 20, intervalHours: 24 });
  });

  test('it is validated, needs the current revision and an admin, and a refused save changes nothing', async () => {
    const { call, read, s3 } = await setup();
    const { revision } = await read();
    const ifMatch = { 'if-match': `"${revision}"` };
    expect((await call('PUT', '/api/settings/gc', { ...POLICY, maxAgeDays: 0 }, ifMatch)).status).toBe(422);
    expect((await call('PUT', '/api/settings/gc', { ...POLICY, extra: 1 }, ifMatch)).status).toBe(422);
    expect((await call('PUT', '/api/settings/gc', { enabled: true }, ifMatch)).status).toBe(422);
    expect((await call('PUT', '/api/settings/gc', POLICY)).status).toBe(428);
    expect((await call('PUT', '/api/settings/gc', POLICY, { ...ifMatch, authorization: 'Bearer publish-token-123' })).status).toBe(403);
    expect((await call('GET', '/api/settings/gc', undefined, { authorization: 'Bearer publish-token-123' })).status).toBe(403);
    expect((await call('PUT', '/api/settings/gc', POLICY, { ...ifMatch, origin: 'http://evil' })).status).toBe(403);
    expect(s3.text(USER_STATE_KEY)).toBeNull();
    expect((await call('PUT', '/api/settings/gc', POLICY, ifMatch)).status).toBe(200);
    expect((await call('PUT', '/api/settings/gc', { ...POLICY, maxAgeDays: 5 }, ifMatch)).status).toBe(409);
  });

  test('saving the policy leaves the saved settings alone, and saving the settings leaves the policy alone', async () => {
    const { call, read, s3 } = await setup();
    const settings = async (body: unknown) => call('PUT', '/api/settings', body, { 'if-match': `"${(await read()).revision}"` });
    expect((await settings({ refreshSeconds: 12 })).status).toBe(200);
    expect((await call('PUT', '/api/settings/gc', POLICY, { 'if-match': `"${(await read()).revision}"` })).status).toBe(200);
    expect((await settings({ refreshSeconds: 13 })).status).toBe(200);
    expect(JSON.parse(s3.text(USER_STATE_KEY)!)).toEqual({ schemaVersion: 1, gc: POLICY, settings: { refreshSeconds: 13 } });
  });

  test('a policy the server cannot read is an error, never an empty policy, and the object is left alone', async () => {
    const { call, s3 } = await setup();
    await writeUtf8(storeOn(s3), USER_STATE_KEY, '{"schemaVersion":1,"gc":{"enabled":"yes"}}', 'application/json');
    const response = await call('GET', '/api/settings/gc');
    expect(response.status).toBe(503);
    expect((await response.json()).detail).toContain('Atlas will not overwrite it');
    expect((await call('POST', '/api/settings/gc/run')).status).toBeGreaterThanOrEqual(500);
    expect(s3.text(USER_STATE_KEY)).toBe('{"schemaVersion":1,"gc":{"enabled":"yes"}}');
  });
});

describe('applying the policy', () => {
  test('a disabled policy deletes nothing, but can be previewed', async () => {
    const { save, call, layerKeys } = await setup();
    await save({ ...POLICY, enabled: false });
    expect((await call('POST', '/api/settings/gc/run')).status).toBe(409);
    const preview = await (await call('POST', '/api/settings/gc/run?dryRun=1')).json();
    expect(preview.runs[0]).toMatchObject({ project: 'default', dryRun: true, candidates: 3, deletedLayers: 0 });
    expect((await layerKeys()).length).toBe(4);
  });

  test('a preview deletes nothing; a run deletes the old superseded layers and the files only they used, from S3', async () => {
    const { save, call, layerKeys, s3, read } = await setup();
    await save(POLICY);
    const preview = await (await call('POST', '/api/settings/gc/run?dryRun=1')).json();
    expect(preview.runs[0]).toMatchObject({ candidates: 3, deletedLayers: 0, keptLayers: 1 });
    expect((await layerKeys()).length).toBe(4);
    expect([...s3.objects.keys()].filter(key => key.startsWith('layers/blobs/')).length).toBe(4);

    const run = await (await call('POST', '/api/settings/gc/run')).json();
    expect(run.runs[0]).toMatchObject({ project: 'default', dryRun: false, candidates: 3, deletedLayers: 3, deletedBlobs: 3, keptLayers: 1 });
    expect((await layerKeys()).length).toBe(1);
    expect([...s3.objects.keys()].filter(key => key.startsWith('layers/blobs/')).length).toBe(1);
    expect((await read()).lastRuns[0]).toMatchObject({ project: 'default', deletedLayers: 3 });
    // The report still shows the newest result.
    const effective = await (await call('GET', '/api/reports/evidence/effective')).json();
    expect(effective.layers.length).toBe(1);
  });

  test('the policy is read from S3 each time, so a change made in S3 is the one applied', async () => {
    const { save, call, layerKeys, s3 } = await setup();
    await save({ ...POLICY, keepLatest: 100 });
    expect((await (await call('POST', '/api/settings/gc/run')).json()).runs[0]).toMatchObject({ candidates: 0, deletedLayers: 0 });
    const state = JSON.parse(s3.text(USER_STATE_KEY)!);
    await writeUtf8(storeOn(s3), USER_STATE_KEY, JSON.stringify({ ...state, gc: { ...state.gc, keepLatest: 0 } }), 'application/json');
    expect((await (await call('POST', '/api/settings/gc/run')).json()).runs[0]).toMatchObject({ deletedLayers: 3 });
    expect((await layerKeys()).length).toBe(1);
  });

  test('every project is collected, each over its own part of the bucket', async () => {
    const { save, call, s3, app } = await setup();
    await layersOf(storeOn(s3, 'projects/alpha'), [5, 6, 7]);
    await writeUtf8(storeOn(s3), 'server/projects/alpha.json', '{"slug":"alpha"}', 'application/json');
    await save(POLICY);
    const run = await (await call('POST', '/api/settings/gc/run')).json();
    expect(run.runs.map((item: { project: string }) => item.project)).toEqual(['default', 'alpha']);
    expect(run.runs.map((item: { deletedLayers: number }) => item.deletedLayers)).toEqual([3, 2]);
    expect((await storeOn(s3, 'projects/alpha').listKeys('layers/index/')).length).toBe(1);
    expect(app.routes.some(route => route.path === '/api/settings/gc/run')).toBe(true);
  });

  test('the server applies the saved policy on its own schedule', async () => {
    const { save, layerKeys } = await setup({ gcCheckMs: 20 });
    expect((await layerKeys()).length).toBe(4);
    await save(POLICY);
    for (let i = 0; i < 200 && (await layerKeys()).length > 1; i++) await new Promise(resolve => setTimeout(resolve, 25));
    expect((await layerKeys()).length).toBe(1);
  });

  test('without a policy the schedule deletes nothing', async () => {
    const { layerKeys } = await setup({ gcCheckMs: 20 });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect((await layerKeys()).length).toBe(4);
  });

  test('running needs an admin and a same-origin request', async () => {
    const { save, call, layerKeys } = await setup();
    await save(POLICY);
    expect((await call('POST', '/api/settings/gc/run', undefined, { authorization: 'Bearer publish-token-123' })).status).toBe(403);
    expect((await call('POST', '/api/settings/gc/run', undefined, { origin: 'http://evil' })).status).toBe(403);
    expect((await call('POST', '/api/settings/gc/run', undefined, { authorization: '' })).status).toBe(401);
    expect((await layerKeys()).length).toBe(4);
  });
});
