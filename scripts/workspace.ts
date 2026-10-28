/** @module IDE workspace lifecycle
 * Shared local development commands for Superset, super.engineering and Orca.
 * Runtime ownership stays in this checkout; stopping never signals a stored PID.
 */
import { mkdir, readFile, unlink, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

type Mode = 'server' | 'preview';
type Runtime = {
  root: string;
  mode: Mode;
  pid: number;
  url: string;
  settingsUrl?: string;
  storeUrl?: string;
  state: 'starting' | 'running';
  control: string;
  token: string;
};
const modes: Mode[] = ['server', 'preview'];
const stateFile = (root: string, mode: Mode) => path.join(root, '.atlas-workspace', `${mode}.json`);
const help = `Atlas IDE workspace commands (run from the repository root):
  bun run workspace:setup     Install the pinned Bun dependencies, without changing the lockfile
  bun run workspace:run       Start the API, settings and hot-reloading viewer
  bun run workspace:preview   Start the viewer with bundled example evidence
  bun run workspace:status    Print runtime URLs and state as JSON
  bun run workspace:stop      Stop both owned processes (optional: server or preview), preserving reports

Run/preview accept --port <0-65535>. ATLAS_PORT, then PORT, also select a port.
Without an explicit port, try 5180 (server) or 5181 (preview), then a free port.
Each checkout owns .atlas-workspace/. Setup and preview need no IDE CLI or credentials. "run" starts the Atlas server,
which keeps all reports and user state in S3 only: set the ATLAS_S3_* variables (copy .env.example to .env, which Bun
loads) or it exits at once and lists every missing one.
`;

/** Require the repository's pinned Bun; do not silently replace a user's runtime. */
export async function requireBun(root: string): Promise<void> {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== '@crvouga/atlas') throw new Error('Run workspace commands from the Atlas repository root.');
  const expected = String(pkg.packageManager).replace(/^bun@/, '');
  if (Bun.version !== expected) throw new Error(`Atlas requires Bun ${expected}; found ${Bun.version}. Install that version and retry.`);
}

/** Idempotent setup: frozen install only; no copied secrets, generated source or example runs. */
export async function setupWorkspace(root: string): Promise<void> {
  await requireBun(root);
  const install = Bun.spawn([process.execPath, 'install', '--frozen-lockfile'], {
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit'
  });
  const code = await install.exited;
  if (code !== 0) throw new Error(`Workspace dependency installation failed (${code}).`);
}

async function held(root: string, mode: Mode): Promise<Runtime | null> {
  try {
    const value: Runtime = JSON.parse(await readFile(stateFile(root, mode), 'utf8'));
    const control = new URL(value.control);
    if (
      value.root !== root ||
      value.mode !== mode ||
      control.protocol !== 'http:' ||
      control.hostname !== '127.0.0.1' ||
      !control.port ||
      !value.token
    )
      return null;
    const response = await fetch(`${control.origin}/status`, {
      headers: { authorization: `Bearer ${value.token}` },
      signal: AbortSignal.timeout(1000),
      redirect: 'error'
    });
    if (!response.ok) return null;
    const live = (await response.json()) as Runtime;
    return live.token === value.token && live.root === root && live.mode === mode ? live : null;
  } catch {
    return null;
  }
}

function publicRuntime({ token: _token, control: _control, ...value }: Runtime) {
  return value;
}

/** Discover live worktree servers without printing the private stop capability. */
export async function workspaceStatus(root: string) {
  const runtimes = await Promise.all(modes.map((mode) => held(root, mode)));
  return { root, runtimes: runtimes.filter((value): value is Runtime => value !== null).map(publicRuntime) };
}

/** Ask only authenticated, live owners to stop; stale metadata cannot kill another process. */
export async function stopWorkspace(root: string, selected: Mode[] = modes): Promise<void> {
  for (const mode of selected) {
    const runtime = await held(root, mode);
    if (!runtime) {
      // A hard-killed owner can leave a lease. Only remove it when its PID is gone.
      const stale = await readFile(stateFile(root, mode), 'utf8').then(
        (text) => JSON.parse(text) as Runtime,
        () => null
      );
      if (stale?.root === root && stale.mode === mode && Number.isInteger(stale.pid) && stale.pid > 0) {
        try {
          process.kill(stale.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') await unlink(stateFile(root, mode)).catch(() => {});
        }
      }
      continue;
    }
    const response = await fetch(`${runtime.control}/stop`, {
      method: 'POST',
      headers: { authorization: `Bearer ${runtime.token}` },
      signal: AbortSignal.timeout(2000),
      redirect: 'error'
    });
    if (!response.ok) throw new Error(`Could not stop the ${mode} process (${response.status}).`);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!(await held(root, mode))) break;
      if (attempt === 99) throw new Error(`The ${mode} process did not finish stopping.`);
      await Bun.sleep(100);
    }
  }
}

/** Select a free loopback port. Explicit port conflicts fail instead of targeting a different app. */
export function workspacePort(mode: Mode, value?: string): number {
  const requested = value === undefined ? (mode === 'server' ? 5180 : 5181) : Number(value);
  if (value?.trim() === '' || !Number.isInteger(requested) || requested < 0 || requested > 65535)
    throw new Error('Port must be an integer from 0 to 65535.');
  let probe;
  try {
    probe = Bun.serve({ hostname: '127.0.0.1', port: requested, fetch: () => new Response() });
  } catch (error) {
    if (value !== undefined || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  }
  const port = probe.port!;
  probe.stop(true);
  return port;
}

async function app(root: string, mode: Mode, port: number, signal: AbortSignal) {
  const source = path.resolve(import.meta.dir, '..');
  const args =
    mode === 'server'
      ? [
          path.join(source, 'packages/core/bin/atlas.mjs'),
          'dev',
          '--host',
          '127.0.0.1',
          '--port',
          String(port)
        ]
      : [
          path.join(source, 'node_modules/vite/bin/vite.js'),
          path.join(root, 'packages/visualizer'),
          '--config',
          path.join(root, 'packages/visualizer/vite.config.ts'),
          '--configLoader',
          'runner',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--strictPort'
        ];
  // Use the existing CLI entry points. Examples remain separate from the node's report store.
  const env =
    mode === 'server'
      ? process.env
      : {
          ...process.env,
          INIT_CWD: root,
          ATLAS_SPECS_ROOT: path.join(root, 'examples/todo/specs'),
          ATLAS_RUNS_ROOT: path.join(root, 'examples/todo/atlas-runs'),
          ATLAS_API_URL: undefined,
          ATLAS_FIXTURE: undefined,
          ATLAS_REPORTS_MODULE: undefined
        };
  const child = Bun.spawn([process.execPath, ...args], { cwd: root, env, stdout: 'inherit', stderr: 'inherit' });
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    escalation = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 5000);
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  try {
    const code = await child.exited;
    if (code !== 0 && !signal.aborted) throw new Error(`Atlas ${mode} failed (${code}).`);
  } finally {
    clearTimeout(escalation);
    signal.removeEventListener('abort', stop);
  }
}

/** Foreground IDE Run target with private worktree control and graceful shutdown. */
export async function runWorkspace(root: string, mode: Mode, portValue?: string): Promise<void> {
  await requireBun(root);
  const existing = await held(root, mode);
  if (existing) {
    console.log(`Atlas ${mode} already running: ${existing.url}`);
    return;
  }
  // Orca default tabs can start alongside its setup hook. A frozen install is safe to repeat.
  await setupWorkspace(root);
  const directory = path.dirname(stateFile(root, mode));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const controller = new AbortController();
  const abort = () => controller.abort();
  let runtime: Runtime | undefined;
  const control = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (!runtime || request.headers.get('authorization') !== `Bearer ${runtime.token}`) return new Response(null, { status: 403 });
      const route = new URL(request.url).pathname;
      if (route === '/status' && request.method === 'GET') return Response.json(runtime);
      if (route === '/stop' && request.method === 'POST') {
        setTimeout(abort, 10);
        return Response.json({ stopping: true });
      }
      return new Response(null, { status: 404 });
    }
  });
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  let running: Promise<void> | undefined;
  let failure: unknown;
  try {
    const port = workspacePort(mode, portValue);
    const url = `http://127.0.0.1:${port}`;
    runtime = {
      root,
      mode,
      pid: process.pid,
      url,
      ...(mode === 'server' ? { settingsUrl: `${url}/admin`, storeUrl: url } : {}),
      state: 'starting',
      control: `http://127.0.0.1:${control.port}`,
      token: crypto.randomUUID()
    };
    // Atomic lease acquisition prevents two simultaneous Run commands owning one target.
    await writeFile(stateFile(root, mode), JSON.stringify(runtime), { mode: 0o600, flag: 'wx' }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(
          `Atlas ${mode} already has a runtime lease. Check workspace:status; use workspace:stop to clear a stopped owner's lease.`
        );
      throw error;
    });
    await chmod(stateFile(root, mode), 0o600);
    running = app(root, mode, port, controller.signal).catch((error) => {
      failure = error;
      abort();
    });
    let ready = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !controller.signal.aborted) {
      ready = await fetch(`${url}${mode === 'server' ? '/api/projects' : '/'}`, {
        signal: AbortSignal.timeout(500),
        redirect: 'error'
      }).then(
        async (response) => {
          const available = mode === 'server' ? (response.headers.get('content-type')?.includes('application/json') ?? false) : response.ok;
          await response.body?.cancel();
          return available;
        },
        () => false
      );
      if (ready) break;
      await Bun.sleep(100);
    }
    if (!ready && !controller.signal.aborted) {
      failure = new Error('Atlas did not become ready within 30 seconds.');
      abort();
    }
    if (ready && !controller.signal.aborted) {
      runtime.state = 'running';
      await writeFile(stateFile(root, mode), JSON.stringify(runtime), { mode: 0o600 });
      console.log(`Atlas ${mode} ready: ${url}`);
      if (mode === 'server') console.log(`Settings: ${runtime.settingsUrl}\nPublish reports with ATLAS_STORE=${url}`);
    }
    await running;
    if (failure) throw failure;
  } finally {
    abort();
    await running;
    await control.stop(true);
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    // Do not remove a replacement owner's metadata.
    const saved = await readFile(stateFile(root, mode), 'utf8').then(
      (text) => JSON.parse(text) as Runtime,
      () => null
    );
    if (runtime && saved?.token === runtime.token) await unlink(stateFile(root, mode)).catch(() => {});
  }
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const root = process.cwd();
  try {
    if (command === '--help' || command === '-h' || !command) console.log(help);
    else if (command === 'setup' && !args.length) await setupWorkspace(root);
    else if (command === 'status' && !args.length) console.log(JSON.stringify(await workspaceStatus(root), null, 2));
    else if (command === 'stop' && (!args.length || (args.length === 1 && modes.includes(args[0] as Mode))))
      await stopWorkspace(root, args.length ? [args[0] as Mode] : modes);
    else if ((command === 'run' || command === 'preview') && (!args.length || (args.length === 2 && args[0] === '--port')))
      await runWorkspace(root, command === 'run' ? 'server' : 'preview', args[1] ?? process.env.ATLAS_PORT ?? process.env.PORT);
    else throw new Error(`Unknown workspace command or arguments.\n${help}`);
  } catch (error) {
    console.error(`workspace: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
  // All owned servers and child processes have finished before this CLI exits.
  process.exit(process.exitCode ?? 0);
}
