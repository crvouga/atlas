import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { loadServerConfig } from '../src/config';
import { fileServerSettings } from '../src/settings';
import { ServerSettingsSnapshotSchema } from '../../schema/src/server-config';
import { memoryStore } from '../../reports/tests/memory-store';

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
async function setup() {
  const dir = await root();
  const original = { auth: { tokens: [{ name: 'admin', role: 'admin', token: 'admin-token-123' }] }, data: './reports' };
  await writeFile(path.join(dir, 'atlas.server.json'), JSON.stringify(original));
  const config = loadServerConfig([], {}, dir);
  const settings = fileServerSettings(config, [], {}, dir);
  const app = createAtlasServer({
    backends: [{ id: 'data', store: memoryStore() }],
    write: 'data',
    settings,
    tokens: [...config.tokens, { name: 'ci', role: 'publish', token: 'publish-token-123' }]
  });
  apps.push(app);
  await app.ready;
  const request = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.fetch(
      new Request('http://atlas/api/settings', {
        method,
        headers: { authorization: 'Bearer admin-token-123', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    );
  return { dir, app, original, settings, request };
}

test('admin settings exclude auth, preserve it on save and require restart and current revision', async () => {
  const { dir, original, request } = await setup();
  const response = await request('GET');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const data = ServerSettingsSnapshotSchema.parse(await response.json());
  expect(JSON.stringify(data)).not.toContain('admin-token-123');
  expect(data.active.data).toBe(path.join(dir, 'reports'));
  const saved = await request('PUT', { data: './new-reports', refreshSeconds: 5 }, { 'if-match': `"${data.revision}"` });
  expect(saved.status).toBe(200);
  expect((await saved.json()).restartRequired).toBe(true);
  expect(JSON.parse(await readFile(path.join(dir, 'atlas.server.json'), 'utf8')).auth).toEqual(original.auth);
  expect((await request('PUT', { data: './other' }, { 'if-match': `"${data.revision}"` })).status).toBe(409);
  expect((await request('PUT', {})).status).toBe(428);
});

test('reader/basic/cross-site writes and invalid settings cannot alter the file', async () => {
  const { dir, request } = await setup();
  const before = await readFile(path.join(dir, 'atlas.server.json'), 'utf8');
  const data = await (await request('GET')).json();
  const headers = { 'if-match': `"${data.revision}"` };
  expect((await request('GET', undefined, { authorization: 'Bearer publish-token-123' })).status).toBe(403);
  expect(
    (await request('PUT', {}, { ...headers, authorization: `Basic ${Buffer.from('user:admin-token-123').toString('base64')}` })).status
  ).toBe(403);
  expect((await request('PUT', {}, { ...headers, origin: 'http://evil' })).status).toBe(403);
  expect((await request('PUT', { auth: { insecure: true } }, headers)).status).toBe(422);
  expect((await request('PUT', { write: 'missing' }, headers)).status).toBe(422);
  expect((await request('PUT', { refreshSeconds: 0 }, headers)).status).toBe(422);
  expect((await request('PUT', { backends: [{ id: 'bad', url: 'ftp://example.com' }] }, headers)).status).toBe(422);
  expect(await readFile(path.join(dir, 'atlas.server.json'), 'utf8')).toBe(before);
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

test('settings preserve environment precedence and serialize concurrent saves', async () => {
  const dir = await root();
  const env = { ATLAS_DATA: './env-reports' };
  const settings = fileServerSettings(loadServerConfig([], env, dir), [], env, dir);
  const { revision } = await settings.read();
  const answers = await Promise.allSettled([settings.save({ data: './one' }, revision), settings.save({ data: './two' }, revision)]);
  expect(answers.map((answer) => answer.status)).toEqual(['fulfilled', 'rejected']);
  expect(loadServerConfig([], env, dir).data).toBe(path.join(dir, 'env-reports'));
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
