/** Child processes for the maintainer scripts. Arguments are always an array, never a shell string. */
import { spawn } from 'node:child_process';

export type Result = { code: number; stdout: string; stderr: string };

export type RunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Hand the terminal to the child, so it can prompt (npm login, 2FA). Nothing is captured. */
  inherit?: boolean;
};

/** Run to completion. A non-zero exit is a result, not an exception; a command that cannot start exits 127. */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Run, and throw with the command's own output when it fails. */
export async function must(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.code}\n${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
