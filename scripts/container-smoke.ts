/** Prove a built image serves the viewer, applies its access mode, honors PORT, and retains reports across replacement. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { must, run, sleep } from './process';

const image = process.argv[2] ?? '';
if (!image) throw new Error('Usage: bun scripts/container-smoke.ts <image> [--insecure]');
const insecure = process.argv.includes('--insecure');
const name = `atlas-smoke-${randomUUID()}`;
const volume = `${name}-data`;
const token = randomUUID();
const port = 9137; // Different from EXPOSE and the server default: catches an image that masks Railway's PORT.
const authorization: Record<string, string> = insecure ? {} : { authorization: `Bearer ${token}` };
let url = '';

async function start(railway: boolean): Promise<void> {
  await must('docker', ['run', '-d', '--name', name, '-p', `127.0.0.1::${port}`, '-v', `${volume}:/data`,
    ...(railway ? ['--user', '0'] : []), '-e', `PORT=${port}`, ...(insecure ? [] : ['-e', `ATLAS_TOKEN=${token}`]), image]);
  const binding = (await must('docker', ['port', name, `${port}/tcp`])).trim();
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  url = `http://${binding}`;
  for (let i = 0; i < 120; i++) {
    if (await fetch(`${url}/readyz`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false)) return;
    await sleep(250);
  }
  throw new Error('Container never became ready');
}

async function stop(): Promise<void> {
  await must('docker', ['stop', '--time', '10', name]);
  assert.equal((await must('docker', ['inspect', '--format', '{{.State.ExitCode}}', name])).trim(), '0', 'SIGTERM must stop cleanly');
  await must('docker', ['rm', name]);
}

try {
  // Normal Docker named volumes inherit the image's bun ownership.
  await must('docker', ['volume', 'create', volume]);
  await start(false);
  assert.equal((await fetch(url)).status, insecure ? 200 : 401);
  const info = await (await fetch(`${url}/api/server`, { headers: authorization })).json() as { open: boolean; role: string };
  assert.equal(info.open, insecure);
  assert.equal(info.role, 'admin');
  const page = await fetch(url, { headers: authorization });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /window\.__ATLAS_CONFIG__/);
  const asset = /src="([^"]+\.js)"/.exec(html)?.[1];
  assert.ok(asset, 'The prebuilt viewer must have a JavaScript asset');
  assert.equal((await fetch(new URL(asset, url), { headers: authorization })).status, 200);
  const body = JSON.stringify({ producer: 'container-smoke', checks: [{ id: 'image', title: 'Image works', status: 'passed' }] });
  const endpoint = '/api/checks?project=container-smoke';
  if (!insecure) assert.equal((await fetch(url + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401);
  assert.equal((await fetch(url + endpoint, { method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body })).status, 201);
  const settings = await fetch(`${url}/api/settings`, { headers: authorization });
  assert.equal(settings.status, 200);
  const { revision } = await settings.json() as { revision: string };
  const saved = await fetch(`${url}/api/settings`, { method: 'PUT',
    headers: { ...authorization, 'content-type': 'application/json', 'if-match': `"${revision}"` },
    body: JSON.stringify({ refreshSeconds: 17 }) });
  assert.equal(saved.status, 200, 'The default user must be able to save server settings');
  const admin = await fetch(`${url}/admin`, { headers: authorization });
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /--font: -apple-system, BlinkMacSystemFont/, 'Settings must use the viewer design tokens');
  const healthcheck = JSON.parse(await must('docker', ['inspect', '--format', '{{json .Config.Healthcheck.Test}}', name])) as string[];
  assert.equal(healthcheck[0], 'CMD-SHELL');
  await must('docker', ['exec', name, 'sh', '-c', healthcheck[1]!]);
  await stop();

  // Railway mounts volumes as root; RAILWAY_RUN_UID=0 is its documented override for non-root images.
  await must('docker', ['run', '--rm', '--user', '0', '-v', `${volume}:/data`, '--entrypoint', 'sh', image, '-c', 'chown -R 0:0 /data && chmod 700 /data']);
  await start(true);
  const response = await fetch(`${url}/api/status?project=container-smoke`, { headers: authorization });
  assert.equal(response.status, 200);
  const status = await response.json() as { ok: boolean; checks: { total: number } };
  assert.equal(status.ok, true);
  assert.equal(status.checks.total, 1, 'Replacing the container must retain the uploaded report');
  const restored = await (await fetch(`${url}/api/settings`, { headers: authorization })).json() as { active: { refreshSeconds: number } };
  assert.equal(restored.active.refreshSeconds, 17, 'Saved settings must survive replacement and take effect');
  await stop();
  console.log(`Container smoke passed: viewer and assets, admin settings and styles, ${insecure ? 'anonymous read/publish/admin' : 'auth'}, PORT, healthcheck, durable reports and settings, Railway volume permissions, SIGTERM.`);
} catch (error) {
  const logs = await run('docker', ['logs', name]);
  console.error(logs.stdout + logs.stderr);
  throw error;
} finally {
  await run('docker', ['rm', '-f', name]);
  await run('docker', ['volume', 'rm', volume]);
}
