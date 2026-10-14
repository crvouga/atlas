/**
 * @module Finding the viewer
 *
 * Locates the built viewer a server serves: the folder named by `--site`, `./atlas-site`, or one built once into the user's
 * cache from the viewer source shipped in the package (`atlas-visualizer build --no-data`). The build is the same for every
 * project because the server writes its own address book into the page, so it is built at most once per installed version.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the viewer's source is, in this repository and in an installed package. */
export function visualizerRoot(): string | null {
  for (const relative of ['../../visualizer', '../../../packages/visualizer']) {
    const dir = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(path.join(dir, 'bin', 'atlas-visualizer.mjs'))) return dir;
  }
  return null;
}

/** Build the viewer once into a folder, for a server that was not given a prebuilt one. */
export async function buildSite(out: string, log: (text: string) => void): Promise<boolean> {
  const root = visualizerRoot();
  if (!root) return false;
  log(`Building the viewer into ${out} (once; pass --site to use a prebuilt one)\n`);
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(root, 'bin', 'atlas-visualizer.mjs'), 'build', '--no-data', '--out', out], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, INIT_CWD: process.cwd() } });
    child.on('error', () => resolve(false));
    child.on('close', code => resolve(code === 0 && existsSync(path.join(out, 'index.html'))));
  });
}

/** The viewer to serve: the one named, a build beside the project, or one built into the user's cache. */
export async function findSite(named: string | undefined, cwd: string, log: (text: string) => void): Promise<string | null> {
  if (named) return existsSync(path.join(named, 'index.html')) ? named : null;
  const cache = path.join(os.homedir(), '.cache', 'atlas', 'site');
  for (const candidate of [path.resolve(cwd, 'atlas-site'), cache]) if (existsSync(path.join(candidate, 'index.html'))) return candidate;
  return (await buildSite(cache, log)) ? cache : null;
}
