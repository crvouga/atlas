import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { s3Store } from '../../reports/src/s3-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { combineBackends } from '../../reports/src/compose';
import { stopWorkspace, workspaceStatus } from '../../../scripts/workspace';

const cli = path.resolve(import.meta.dir, '../../../scripts/workspace.ts');
const roots: string[] = [];
const children: ReturnType<typeof Bun.spawn>[] = [];
afterEach(async () => {
  for (const root of roots) await stopWorkspace(root);
  for (const child of children) { if (child.exitCode === null) child.kill('SIGTERM'); await child.exited; }
  children.length = 0;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'atlas IDE workspace ')));
  roots.push(root);
  await mkdir(path.join(root, 'helper'));
  await writeFile(path.join(root, 'helper/package.json'), JSON.stringify({ name: 'workspace-fixture', version: '1.0.0' }));
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: '@crvouga/atlas', packageManager: `bun@${Bun.version}`, dependencies: { 'workspace-fixture': 'file:./helper' } })
  );
  const lock = Bun.spawn([process.execPath, 'install', '--lockfile-only'], { cwd: root, stdout: 'ignore', stderr: 'ignore' });
  expect(await lock.exited).toBe(0);
  return root;
}

async function start(root: string, mode = 'run', local = true) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ATLAS_S3_')));
  const child = Bun.spawn([process.execPath, cli, mode, '--port', '0'], {
    cwd: root,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...clean, ...(local ? { ATLAS_TOKEN: 'workspace-test-admin-token' } : {}), ATLAS_CONFIG: undefined, ATLAS_PORT: undefined, PORT: undefined }
  });
  const errors = new Response(child.stderr).text();
  children.push(child);
  for (let attempt = 0; attempt < 300; attempt++) {
    const runtime = (await workspaceStatus(root)).runtimes.find(
      (item) => item.mode === (mode === 'run' ? 'server' : 'preview') && item.state === 'running'
    );
    if (runtime) return { child, runtime };
    if (child.exitCode !== null) throw new Error(await errors);
    await Bun.sleep(100);
  }
  throw new Error('Workspace did not become ready.');
}


test('Run starts persistent S3 without external configuration, survives restarts, and isolates workspaces', async () => {
  const one = await fixture(), two = await fixture();
  const first = await start(one, 'run', true);
  const storage = first.runtime.storage!;
  expect(storage.kind).toBe('mockingbird');
  expect(storage.dataFile).toBe(path.join(one, '.atlas-workspace/s3/storage.sqlite'));
  const make = (endpoint: string) => s3Store({ endpoint, bucket: storage.bucket, region: 'us-east-1', credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture' }, retries: 0, env: {} });
  const store = make(storage.endpoint);
  const bytes = new Uint8Array([0, 255, 3, 10]);
  await store.put('attachments/screen with spaces.bin', bytes, 'application/octet-stream');
  await publishChecks(store, { producer: 'workspace', environment: 'local', recordedAtMs: 1, checks: [{ id: 'persisted', title: 'Persisted report', status: 'passed' }] });
  // The application saves its own settings through its normal authenticated API.
  const headers = { authorization: 'Bearer workspace-test-admin-token' };
  const settings = await (await fetch(`${first.runtime.url}/api/settings`, { headers })).json() as { revision: string };
  const saved = await fetch(`${first.runtime.url}/api/settings`, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json', 'if-match': `"${settings.revision}"` }, body: JSON.stringify({ refreshSeconds: 17 }) });
  expect(saved.status).toBe(200);
  await stopWorkspace(one);
  expect(await first.child.exited).toBe(0);
  expect(await fetch(storage.endpoint, { signal: AbortSignal.timeout(500) }).then(() => true, () => false)).toBe(false);
  const stamp = await readFile(path.join(one, 'node_modules/.atlas-workspace-setup'), 'utf8');
  const restarted = await start(one, 'run', true);
  expect(await readFile(path.join(one, 'node_modules/.atlas-workspace-setup'), 'utf8')).toBe(stamp);
  const restored = make(restarted.runtime.storage!.endpoint);
  expect(new Uint8Array(await new Response((await restored.get('attachments/screen with spaces.bin'))!.body).arrayBuffer())).toEqual(bytes);
  expect((await combineBackends([{ id: 'local', store: restored }])).summary.checks.passed).toBe(1);
  expect((await (await fetch(`${restarted.runtime.url}/api/settings`, { headers })).json() as { settings: { refreshSeconds: number } }).settings.refreshSeconds).toBe(17);
  const separate = await start(two, 'run', true);
  expect(await make(separate.runtime.storage!.endpoint).listKeys()).toEqual([]);
  await stopWorkspace(one);
  expect((await fetch(`${separate.runtime.url}/api/projects`, { headers })).status).toBe(200);
}, 60_000);

