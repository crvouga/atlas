import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { fakeS3, listenFakeS3, S3_TEST_ENV } from '../packages/server/tests/fake-s3';
import { requireBun, setupWorkspace, stopWorkspace, workspacePort, workspaceStatus } from './workspace';

const repo = path.resolve(import.meta.dir, '..');
const cli = path.join(import.meta.dir, 'workspace.ts');
const roots: string[] = [];
const children: ReturnType<typeof Bun.spawn>[] = [];
const buckets: ReturnType<typeof listenFakeS3>[] = [];
afterEach(async () => {
  for (const bucket of buckets.splice(0)) await bucket.stop();
  for (const root of roots) await stopWorkspace(root);
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
    await child.exited;
  }
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

async function start(root: string, mode = 'run') {
  // The server keeps everything in S3 only: each workspace gets a bucket of its own to run against.
  const bucket = listenFakeS3(fakeS3());
  buckets.push(bucket);
  const child = Bun.spawn([process.execPath, cli, mode, '--port', '0'], {
    cwd: root,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...process.env, ...S3_TEST_ENV, ATLAS_S3_ENDPOINT: bucket.url, ATLAS_CONFIG: undefined, ATLAS_PORT: undefined, PORT: undefined }
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

test('all three IDEs call shared lifecycle commands; Orca reserves its first tab for the agent', async () => {
  const superset = JSON.parse(await readFile(path.join(repo, '.superset/config.json'), 'utf8'));
  const engineering = JSON.parse(await readFile(path.join(repo, '.super.engineering/config.json'), 'utf8'));
  const orca = parse(await readFile(path.join(repo, 'orca.yaml'), 'utf8'));
  expect(superset).toEqual({ setup: ['bun run workspace:setup'], run: ['bun run workspace:run'], teardown: ['bun run workspace:stop'] });
  expect(engineering.setup).toEqual(superset.setup);
  expect(engineering.teardown).toEqual(superset.teardown);
  expect(engineering.run.find((item: { default?: boolean }) => item.default)).toMatchObject({
    name: 'Atlas',
    commands: superset.run,
    stop_commands: ['bun run workspace:stop server']
  });
  expect(orca.scripts).toEqual({ setup: 'bun run workspace:setup', archive: 'bun run workspace:stop' });
  expect(orca.setupAgentStartupPolicy).toBe('wait-for-setup');
  expect(orca.defaultTabs[0].command).toBeUndefined();
  expect(orca.defaultTabs[1].command).toBe('bun run workspace:run');
});

test('setup is repeatable in a fresh directory with spaces and requires the pinned Bun', async () => {
  const root = await fixture();
  const lock = await readFile(path.join(root, 'bun.lock'), 'utf8');
  await setupWorkspace(root);
  await setupWorkspace(root);
  expect(await readFile(path.join(root, 'bun.lock'), 'utf8')).toBe(lock);
  expect((await workspaceStatus(root)).runtimes).toEqual([]);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@crvouga/atlas', packageManager: 'bun@0.0.0' }));
  await expect(requireBun(root)).rejects.toThrow('requires Bun 0.0.0');
});

test('explicit busy and invalid ports fail; an available ephemeral port is reported', () => {
  const occupied = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('another app') });
  try {
    expect(() => workspacePort('server', String(occupied.port))).toThrow();
    for (const invalid of ['', '-1', '65536', '1.5', 'abc']) expect(() => workspacePort('server', invalid)).toThrow('Port must');
    expect(workspacePort('server', '0')).toBeGreaterThan(0);
  } finally {
    occupied.stop(true);
  }
});

test('a busy default falls back, while simultaneous Run commands acquire only one target', async () => {
  let occupied;
  try {
    occupied = Bun.serve({ hostname: '127.0.0.1', port: 5180, fetch: () => new Response('another app') });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
  }
  try {
    expect(workspacePort('server')).not.toBe(5180);
  } finally {
    occupied?.stop(true);
  }
  const root = await fixture();
  const bucket = listenFakeS3(fakeS3());
  buckets.push(bucket);
  const racers = [0, 1].map(() => {
    const child = Bun.spawn([process.execPath, cli, 'run', '--port', '0'], { cwd: root, stdout: 'ignore', stderr: 'ignore', env: { ...process.env, ...S3_TEST_ENV, ATLAS_S3_ENDPOINT: bucket.url } });
    children.push(child);
    return child;
  });
  const firstExit = await Promise.race(racers.map((child) => child.exited));
  expect([0, 1]).toContain(firstExit); // Existing owner or an atomic lease conflict.
  for (let i = 0; i < 300 && !(await workspaceStatus(root)).runtimes.some((item) => item.state === 'running'); i++) await Bun.sleep(100);
  const live = (await workspaceStatus(root)).runtimes;
  expect(live).toHaveLength(1);
  expect(racers.filter((child) => child.exitCode === null).map((child) => child.pid)).toEqual([live[0]!.pid]);
  await stopWorkspace(root);
  await Promise.all(racers.map((child) => child.exited));
}, 60_000);

test('two fresh workspaces serve separate API/settings/data; stop cannot affect another workspace or trust a stale PID', async () => {
  const one = await fixture(),
    two = await fixture();
  const first = await start(one),
    second = await start(two);
  expect(first.runtime.url).not.toBe(second.runtime.url);
  for (const [runtime, root] of [[first.runtime, one], [second.runtime, two]] as const) {
    expect(((await (await fetch(`${runtime.url}/api/settings`)).json()) as { active: { refreshSeconds: number } }).active.refreshSeconds).toBe(10);
    // Nothing is kept on the workspace's disk: reports and user state are in the bucket.
    expect(await Bun.file(path.join(root, '.atlas-data')).exists()).toBe(false);
  }
  expect(await (await fetch(`${first.runtime.url}/admin`)).text()).toContain('Atlas server settings');
  expect(await (await fetch(first.runtime.url)).text()).toContain('__ATLAS_CONFIG__');
  const privateState = JSON.parse(await readFile(path.join(one, '.atlas-workspace/server.json'), 'utf8'));
  expect((await fetch(`${privateState.control}/stop`, { method: 'POST' })).status).toBe(403);
  expect(JSON.stringify(await workspaceStatus(one))).not.toContain(privateState.token);
  // An unrelated process's live PID in stale metadata grants no stopping authority.
  await mkdir(path.join(one, '.atlas-workspace'), { recursive: true });
  await writeFile(
    path.join(one, '.atlas-workspace/preview.json'),
    JSON.stringify({ ...privateState, mode: 'preview', pid: process.pid, token: crypto.randomUUID() })
  );
  await stopWorkspace(one);
  expect(await first.child.exited).toBe(0);
  expect((await workspaceStatus(one)).runtimes).toEqual([]);
  expect((await fetch(`${second.runtime.url}/api/projects`)).status).toBe(200);
  await stopWorkspace(one); // Repeated teardown is harmless.
  await stopWorkspace(two);
  expect(await second.child.exited).toBe(0);
}, 60_000);

test('the explicit examples target serves bundled specs and stops independently of the real server', async () => {
  const root = await fixture();
  await symlink(path.join(repo, 'packages'), path.join(root, 'packages'), 'dir');
  await symlink(path.join(repo, 'examples'), path.join(root, 'examples'), 'dir');
  const server = await start(root);
  const preview = await start(root, 'preview');
  expect(await (await fetch(preview.runtime.url)).text()).toContain('src/main.tsx');
  expect(preview.runtime).not.toHaveProperty('settingsUrl');
  await stopWorkspace(root, ['preview']);
  expect(await preview.child.exited).toBe(0);
  expect((await fetch(`${server.runtime.url}/api/projects`)).status).toBe(200);
  await stopWorkspace(root);
  expect(await server.child.exited).toBe(0);
}, 60_000);
