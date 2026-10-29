import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
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
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, 'dev.ts'), ...(mode === 'populate' ? [] : [mode === 'preview' ? '--preview' : '--server']), '--port', '0'], {
    cwd: root,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { ...process.env, ...S3_TEST_ENV, ATLAS_S3_ENDPOINT: bucket.url, ATLAS_CONFIG: undefined, ATLAS_PORT: undefined, PORT: undefined }
  });
  const errors = new Response(child.stderr).text();
  children.push(child);
  for (let attempt = 0; attempt < 300; attempt++) {
    const runtime = (await workspaceStatus(root)).runtimes.find(
      (item) => item.mode === (mode === 'preview' ? 'preview' : 'server') && item.state === 'running'
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
  expect(superset).toEqual({ setup: ['bun run dev --setup'], run: ['bun run dev'], teardown: ['bun run dev --stop'] });
  expect(engineering.setup).toEqual(superset.setup);
  expect(engineering.teardown).toEqual(superset.teardown);
  expect(engineering.run.find((item: { default?: boolean }) => item.default)).toMatchObject({
    name: 'Dev',
    commands: superset.run,
    stop_commands: ['bun run dev --stop server']
  });
  expect(engineering.run.map((item: { name: string }) => item.name).sort()).toEqual(['Build', 'Check', 'Dev', 'Docs', 'Smoke', 'Test']);
  expect(engineering.commands).toEqual([]);
  expect(orca.scripts).toEqual({ setup: 'bun run dev --setup', archive: 'bun run dev --stop' });
  expect(orca.setupAgentStartupPolicy).toBe('wait-for-setup');
  expect(orca.defaultTabs[0].command).toBeUndefined();
  expect(orca.defaultTabs[1].command).toBe('bun run dev');
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


test('partial external S3 configuration fails without starting or creating a local store', async () => {
  const root = await fixture();
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ATLAS_S3_')));
  const child = Bun.spawn([process.execPath, cli, 'run', '--port', '0'], { cwd: root, stdout: 'pipe', stderr: 'pipe', env: { ...clean, ATLAS_S3_BUCKET: 'explicit-bucket' } });
  children.push(child);
  const errors = new Response(child.stderr).text();
  const output = new Response(child.stdout).text();
  expect(await child.exited).toBe(1);
  expect(`${await output} ${await errors}`).toContain('ATLAS_S3_ENDPOINT');
  expect(await Bun.file(path.join(root, '.atlas-workspace/s3/storage.sqlite')).exists()).toBe(false);
  expect((await workspaceStatus(root)).runtimes).toEqual([]);
}, 30_000);

test('warm Run skips installation while changed manifests and removed node_modules trigger frozen setup', async () => {
  const root = await fixture();
  await setupWorkspace(root);
  const marker = path.join(root, 'node_modules/.atlas-workspace-setup');
  const original = await readFile(marker, 'utf8');
  await utimes(marker, new Date(0), new Date(0));
  await setupWorkspace(root, true);
  expect((await Bun.file(marker).stat()).mtimeMs).toBe(0);
  // A changed manifest must install; failure must invalidate the previous successful stamp.
  const pkgFile = path.join(root, 'package.json');
  const pkg = JSON.parse(await readFile(pkgFile, 'utf8'));
  await writeFile(pkgFile, JSON.stringify({ ...pkg, scripts: { preinstall: 'exit 23' } }));
  await expect(setupWorkspace(root, true)).rejects.toThrow('installation failed');
  expect(await Bun.file(marker).exists()).toBe(false);
  await writeFile(pkgFile, JSON.stringify(pkg));
  await setupWorkspace(root, true);
  expect(await readFile(marker, 'utf8')).toBe(original);
  await rm(path.join(root, 'node_modules'), { recursive: true });
  await setupWorkspace(root, true);
  expect(await readFile(marker, 'utf8')).toBe(original);
}, 30_000);


async function populationFixture(root: string, body: string) {
  const file = path.join(root, 'package.json');
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await writeFile(file, JSON.stringify(pkg));
  await writeFile(path.join(root, 'scripts/media.ts'), "await Bun.write('prepared.txt', 'ready');");
  await writeFile(path.join(root, 'scripts/examples.ts'), body);
}

async function untilPopulation(root: string, state: string) {
  for (let i = 0; i < 300; i++) {
    const runtime = (await workspaceStatus(root)).runtimes.find((item) => item.mode === 'server');
    if (runtime?.population === state) return runtime;
    await Bun.sleep(50);
  }
  throw new Error(`Population never became ${state}`);
}

test('populate starts services before the full workflow, uses the selected URL, and leaves the viewer running', async () => {
  const root = await fixture();
  await populationFixture(root, `
    if (await Bun.file('prepared.txt').text() !== 'ready') throw new Error('Preparation skipped');
    const response = await fetch(process.env.ATLAS_SERVER_URL + '/api/projects');
    if (!response.ok) throw new Error('Server unavailable during population');
    await Bun.write('populated.json', JSON.stringify({ url: process.env.ATLAS_SERVER_URL, store: process.env.ATLAS_STORE, project: process.env.ATLAS_PROJECT, ffmpeg: await Bun.spawn(['ffmpeg', '-version'], { stdout: 'ignore', stderr: 'ignore' }).exited }));
  `);
  const { child, runtime } = await start(root, 'populate');
  await untilPopulation(root, 'complete');
  expect(JSON.parse(await readFile(path.join(root, 'populated.json'), 'utf8'))).toEqual({ url: runtime.url, store: runtime.url, project: 'todo-app', ffmpeg: 0 });
  expect(child.exitCode).toBeNull();
  expect((await fetch(`${runtime.url}/api/projects`)).status).toBe(200);
  await stopWorkspace(root);
  expect(await child.exited).toBe(0);
}, 60_000);

test('a failed populate workflow is reported and its viewer remains available for inspecting evidence', async () => {
  const root = await fixture();
  await populationFixture(root, 'process.exit(7);');
  const { child, runtime } = await start(root, 'populate');
  await untilPopulation(root, 'failed');
  expect((await fetch(`${runtime.url}/api/projects`)).status).toBe(200);
  await stopWorkspace(root);
  expect(await child.exited).toBe(1);
}, 60_000);

test('populate can reuse an existing server without stopping its owner', async () => {
  const root = await fixture();
  await populationFixture(root, "await Bun.write('reused.txt', process.env.ATLAS_SERVER_URL!);");
  const { child: owner, runtime } = await start(root);
  const child = Bun.spawn([process.execPath, cli, 'populate'], { cwd: root, stdout: 'ignore', stderr: 'pipe' });
  children.push(child);
  const errors = new Response(child.stderr).text();
  expect(await child.exited, await errors).toBe(0);
  expect(await readFile(path.join(root, 'reused.txt'), 'utf8')).toBe(runtime.url);
  expect(owner.exitCode).toBeNull();
}, 60_000);

test('stopping populate cancels an in-progress workflow and closes its application service', async () => {
  const root = await fixture();
  await populationFixture(root, `
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('example') });
    await Bun.write('example-url.txt', server.url.href);
    setInterval(() => {}, 1000);
  `);
  const { child } = await start(root, 'populate');
  const file = path.join(root, 'example-url.txt');
  for (let i = 0; i < 300 && !(await Bun.file(file).exists()); i++) await Bun.sleep(50);
  const url = await readFile(file, 'utf8');
  expect((await fetch(url)).status).toBe(200);
  await stopWorkspace(root);
  expect(await child.exited).toBe(0);
  for (let i = 0; i < 50; i++) {
    if (!(await fetch(url, { signal: AbortSignal.timeout(200) }).then(() => true, () => false))) break;
    await Bun.sleep(50);
  }
  expect(await fetch(url, { signal: AbortSignal.timeout(200) }).then(() => true, () => false)).toBe(false);
}, 60_000);


test('populate help describes the workflow without starting services', async () => {
  const root = await fixture();
  const child = Bun.spawn([process.execPath, cli, 'populate', '--help'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  children.push(child);
  const output = new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  expect(await output).toContain('bun run dev');
  expect((await workspaceStatus(root)).runtimes).toEqual([]);
});
