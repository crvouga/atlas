/** @module Workspace population
 * Run the complete example workflow against the workspace server that is actually ready.
 * Application servers remain owned by the existing example drivers.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

async function command(root: string, args: string[], env: NodeJS.ProcessEnv, signal: AbortSignal) {
  if (signal.aborted) return;
  const grouped = process.platform !== 'win32';
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', detached: grouped });
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const kill = (kind: NodeJS.Signals) => {
    if (!child.pid || child.exitCode !== null) return;
    try {
      // This group belongs to the child just spawned here, never a PID read from a lease.
      if (grouped) process.kill(-child.pid, kind);
      else child.kill(kind);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  const stop = () => { kill('SIGTERM'); escalation = setTimeout(() => kill('SIGKILL'), 5000); };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    if (code !== 0 && !signal.aborted) throw new Error(`Populate command failed (${code}): bun ${args.join(' ')}`);
  } finally {
    clearTimeout(escalation);
    signal.removeEventListener('abort', stop);
  }
}

/** Install the default browser if needed, then run all example clients, documents, UI captures and report uploads. */
export async function populateWorkspace(root: string, url: string, signal: AbortSignal): Promise<void> {
  const { default: ffmpeg } = await import('ffmpeg-static');
  if (!ffmpeg) throw new Error('No FFmpeg binary is available for this platform.');
  const env = {
    ...process.env,
    PATH: `${path.dirname(ffmpeg)}${path.delimiter}${process.env.PATH ?? ''}`,
    ATLAS_SERVER_URL: url,
    ATLAS_STORE: url,
    ATLAS_PROJECT: process.env.ATLAS_PROJECT ?? 'todo-app',
    // The example drivers start their own application servers. Ephemeral ports isolate worktrees.
    TODO_EXAMPLE_PORT: process.env.TODO_EXAMPLE_PORT ?? '0',
    TODO_CLIENTS_PORT: process.env.TODO_CLIENTS_PORT ?? '0'
  };
  await command(root, ['scripts/media.ts'], env, signal);
  await command(root, ['scripts/examples.ts', 'all'], env, signal);
}
