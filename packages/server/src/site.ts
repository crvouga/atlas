/**
 * @module Finding the client
 *
 * Locates the built client a server serves: the folder named by `--site`, `./atlas-site`, or one built once into the user's
 * cache from the client source shipped in the package (`atlas client build --no-data`). The build is the same for every
 * project because the server writes its own address book into the page, so it is built at most once per installed version.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Run the Atlas client build tools. Returns the child's exit code; throws when the client is missing. */
export async function clientMain(argv: readonly string[]): Promise<number> {
  const root = visualizerRoot();
  if (!root) throw new Error('The Atlas client is not installed alongside the server.');
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(root, 'bin', 'atlas-client.mjs'), ...(argv.length ? argv : ['--help'])], { stdio: 'inherit' });
    child.on('error', () => resolve(1)); child.on('close', code => resolve(code ?? 1));
  });
}

function clientCacheKey(): string {
  const root = visualizerRoot();
  const hash = createHash('sha256');
  if (!root) return 'missing';
  const walk = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else { hash.update(path.relative(root, file)); hash.update(readFileSync(file)); }
    }
  };
  walk(path.join(root, 'src')); walk(path.join(root, 'vite'));
  hash.update(readFileSync(path.join(root, 'vite.config.ts')));
  hash.update(readFileSync(path.join(root, 'index.html')));
  hash.update(readFileSync(path.resolve(root, '../../package.json')));
  return hash.digest('hex').slice(0, 20);
}

/** Where the client's source is, in this repository and in an installed package. */
export function visualizerRoot(): string | null {
  for (const relative of ['../../visualizer', '../../../packages/visualizer']) {
    const dir = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(path.join(dir, 'bin', 'atlas-visualizer.mjs'))) return dir;
  }
  return null;
}

/** Build the client once into a folder, for a server that was not given a prebuilt one. */
export async function buildSite(out: string, log: (text: string) => void): Promise<boolean> {
  const root = visualizerRoot();
  if (!root) return false;
  log(`Building the Atlas client into ${out} (once; pass --site to use a prebuilt client)\n`);
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(root, 'bin', 'atlas-client.mjs'), 'build', '--no-data', '--out', out], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, INIT_CWD: process.cwd() } });
    child.on('error', () => resolve(false));
    child.on('close', code => resolve(code === 0 && existsSync(path.join(out, 'index.html'))));
  });
}

/** The client to serve: the one named, a build beside the project, or one built into the user's cache. */
export async function findSite(named: string | undefined, cwd: string, log: (text: string) => void): Promise<string | null> {
  if (named) return existsSync(path.join(named, 'index.html')) ? named : null;
  const cache = path.join(os.homedir(), '.cache', 'atlas', 'client', clientCacheKey());
  for (const candidate of [path.resolve(cwd, 'atlas-site'), cache]) if (existsSync(path.join(candidate, 'index.html'))) return candidate;
  return (await buildSite(cache, log)) ? cache : null;
}
