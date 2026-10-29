import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { loadServerConfig } from '../src/config';
import { storedSettings } from '../src/settings';
import { userStateStore } from '../src/user-state';
import { ServerSettingsSnapshotSchema } from '../../schema/src/server-config';
import { memoryStore } from '../../reports/tests/memory-store';
import { fakeS3, S3_TEST_ENV } from './fake-s3';
import { storeOn } from './fake-s3-store';

const roots: string[] = [];
const apps: AtlasServer[] = [];
afterEach(async () => {
  apps.splice(0).forEach((app) => app.close());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
  const dir = await mkdtemp(path.join(tmpdir(), 'atlas-admin-'));
  roots.push(dir);
  return dir;
}
/** A server whose settings and garbage collection policy are kept in a fake S3 bucket, as `atlas serve` keeps them. */
async function setup() {
  const dir = await root();
  const s3 = fakeS3();
  const env = { ...S3_TEST_ENV };
  const config = loadServerConfig([], env, dir, () => '{}');
  const { settings, gc } = storedSettings(config, [], env, dir, userStateStore(storeOn(s3)));
  const app = createAtlasServer({
    backends: [{ id: 's3', store: memoryStore() }],
    write: 's3',
    settings,
    gc,
    tokens: [{ name: 'admin', role: 'admin', token: 'admin-token-123' }, { name: 'ci', role: 'publish', token: 'publish-token-123' }]
  });
  apps.push(app);
  await app.ready;
  const send = (url: string) => (method: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.fetch(
      new Request(`http://atlas${url}`, {
        method,
        headers: { authorization: 'Bearer admin-token-123', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    );
  return { dir, app, s3, settings, gc, request: send('/api/settings'), gcRequest: send('/api/settings/gc') };
}

test('admin settings exclude auth and storage, are saved to S3 not to disk, and need a restart and the current revision', async () => {
  const { dir, s3, request } = await setup();
  const response = await request('GET');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const raw = await response.clone().json();
  const data = ServerSettingsSnapshotSchema.parse(await response.json());
  expect(JSON.stringify(data)).not.toContain('admin-token-123');
  expect(JSON.stringify(data)).not.toContain('testsecret');
  expect('data' in data.active).toBe(false);
  expect(raw.settings).toEqual({});
  const saved = await request('PUT', { refreshSeconds: 5 }, { 'if-match': `"${data.revision}"` });
  expect(saved.status).toBe(200);
  expect((await saved.json()).restartRequired).toBe(true);
  // The settings are one JSON document in the bucket, exactly as chosen (no defaults pinned), and nothing is on the disk.
  expect(JSON.parse(s3.text('server/state.json')!)).toEqual({ schemaVersion: 1, settings: { refreshSeconds: 5 } });
  expect(await Bun.file(path.join(dir, 'atlas.server.json')).exists()).toBe(false);
  expect((await request('PUT', { refreshSeconds: 6 }, { 'if-match': `"${data.revision}"` })).status).toBe(409);
  expect((await request('PUT', {})).status).toBe(428);
});

test('reader/basic/cross-site writes and invalid settings cannot alter the state in S3', async () => {
  const { s3, request } = await setup();
  const data = await (await request('GET')).json();
  const headers = { 'if-match': `"${data.revision}"` };
  expect((await request('GET', undefined, { authorization: 'Bearer publish-token-123' })).status).toBe(403);
  expect(
    (await request('PUT', {}, { ...headers, authorization: `Basic ${Buffer.from('user:admin-token-123').toString('base64')}` })).status
  ).toBe(403);
  expect((await request('PUT', {}, { ...headers, origin: 'http://evil' })).status).toBe(403);
  expect((await request('PUT', { auth: { insecure: true } }, headers)).status).toBe(422);
  expect((await request('PUT', { data: './elsewhere' }, headers)).status).toBe(422);
  expect((await request('PUT', { backends: [{ id: 'a', url: 'x' }] }, headers)).status).toBe(422);
  expect((await request('PUT', { refreshSeconds: 0 }, headers)).status).toBe(422);
  expect(s3.text('server/state.json')).toBeNull();
});

test('same-origin browser saves work behind a TLS-terminating reverse proxy', async () => {
  const { request } = await setup();
  const data = await (await request('GET')).json();
  const response = await request(
    'PUT',
    { refreshSeconds: 5 },
    { 'if-match': `"${data.revision}"`, origin: 'https://atlas', 'sec-fetch-site': 'same-origin' }
  );
  expect(response.status).toBe(200);
});

test('settings serialize concurrent saves, and the environment still overrides what is saved', async () => {
  const dir = await root();
  const s3 = fakeS3();
  const env = { ...S3_TEST_ENV, ATLAS_REFRESH_SECONDS: '45' };
  const { settings } = storedSettings(loadServerConfig([], env, dir, () => '{}'), [], env, dir, userStateStore(storeOn(s3)));
  const { revision } = await settings.read();
  const answers = await Promise.allSettled([settings.save({ refreshSeconds: 11 }, revision), settings.save({ refreshSeconds: 12 }, revision)]);
  expect(answers.map((answer) => answer.status)).toEqual(['fulfilled', 'rejected']);
  expect(loadServerConfig([], env, dir, () => '{}', JSON.parse(s3.text('server/state.json')!).settings).refreshSeconds).toBe(45);
});

test('viewer escapes runtime script values, blocks symlinks, respects encoding quality and revalidates assets', async () => {
  const dir = await root();
  await writeFile(path.join(dir, 'index.html'), `<html><head></head><body>${'viewer'.repeat(400)}</body></html>`);
  const outside = await root();
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  await symlink(path.join(outside, 'secret.txt'), path.join(dir, 'leak.txt'));
  const app = createAtlasServer({
    backends: [{ id: 'data', store: memoryStore() }],
    write: 'data',
    site: dir,
    page: { title: '</script><script>alert(1)</script>' }
  });
  apps.push(app);
  const get = (file: string, headers = {}) => app.fetch(new Request(`http://atlas/${file}`, { headers }));
  expect((await get('leak.txt')).status).toBe(404);
  const response = await get('', { 'accept-encoding': 'br;q=0,gzip;q=0' });
  expect(response.headers.get('content-encoding')).toBeNull();
  const text = await response.text();
  expect(text).not.toContain('</script><script>alert');
  expect(text).toContain('\\u003c/script>');
  const encoded = text.match(/window.__ATLAS_CONFIG__=(.*?)<\/script>/)![1]!;
  expect(JSON.parse(encoded).title).toBe('</script><script>alert(1)</script>');
  expect((await get('', { 'if-none-match': response.headers.get('etag')! })).status).toBe(304);
  expect((await get('', { 'accept-encoding': 'br;q=0,gzip;q=1' })).headers.get('content-encoding')).toBe('gzip');
});

test('competing uploads cannot overwrite one immutable run file', async () => {
  const app = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data' });
  apps.push(app);
  const put = (body: string) => app.fetch(new Request('http://atlas/api/store/layers/runs/run/file.txt', { method: 'PUT', body }));
  const responses = await Promise.all([put('one'), put('two')]);
  expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
  const stored = await app.fetch(new Request('http://atlas/api/store/layers/runs/run/file.txt'));
  expect(await stored.text()).toBe('one');
});

test('settings page bundles the shared React and Mantine interface and keeps configuration behind admin access', async () => {
  const { app } = await setup();
  const response = await app.fetch(new Request('http://atlas/admin', { headers: { authorization: 'Bearer admin-token-123' } }));
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(html).toContain('--mantine-');
  expect(html).toContain('type="module"');
  expect(html).toContain('<title>Settings · Atlas</title>');
  expect(html).toContain('id="root"');
  expect(html).not.toContain('id="configuration"');
  expect(html).not.toContain('admin-token-123');
});

// A replacement string interprets $&, $` and $' from bundled dependencies as template substitutions.
// The resulting document can look complete while its embedded JavaScript is corrupt.
test('settings embeds a complete parseable bundle without interpreting replacement patterns', async () => {
  const { renderSettingsPage } = await import('../src/settings-page');
  const html = await renderSettingsPage();
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeDefined();
  expect(script).not.toContain('<!-- atlas-admin-script -->');
  expect(() => new Bun.Transpiler({ loader: 'js', target: 'browser' }).transformSync(script!, 'js')).not.toThrow();
});
