/**
 * Seed npm: reconcile the npm registry with origin/main, from your own npm login.
 *
 * Trusted Publishing (OIDC) cannot create a package, so a maintainer publishes `@crvouga/atlas` the
 * first time with an interactive npm login. This is the only manual step in releasing, and it is
 * one command:
 *   - publish the package if it is not on npm yet,
 *   - attach the GitHub Actions Trusted Publisher to it,
 *   - push the tag and create the GitHub Release.
 *
 * Steps:
 *   1. make sure npm >= 11.15 is on PATH (`npm trust` needs it; a private copy is used if not)
 *   2. make sure you are logged in to npm (runs `npm login` if not)
 *   3. check out origin/main in a kept worktree, install and build it there. A rerun at the same
 *      commit reuses that build.
 *   4. `release:publish --local` on that worktree, using this checkout's scripts (so a fix to the
 *      release tooling applies before it is on main)
 *
 * The seed is slow enough to walk away from, so whenever it waits on you (`npm login`, or an
 * npm 2FA approval for a publish or trust change) it rings the terminal bell and posts a desktop
 * notification, repeating until you answer (scripts/release/attention.ts).
 *
 * After this, every later release is published by CI through OIDC.
 * Idempotent: packages, trust, tags and releases that already exist are skipped, so re-run it to
 * finish.
 *
 *   bun scripts/release/seed.ts             (reconcile)
 *   bun scripts/release/seed.ts --dry-run   (plan + pack, print what would change)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { must, run } from '../process.ts';
import { alertIfWaiting } from './attention.ts';
import { discoverPackages } from './lib.ts';
import { seedCachePath } from './seed-path.ts';

const dryRun = process.argv.includes('--dry-run');
const MIN_NPM = [11, 15] as const;
/** This checkout: its scripts run the release; the code released is origin/main's. */
const here = path.join(import.meta.dirname, '../..');

function npmIsRecentEnough(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > MIN_NPM[0] || (major === MIN_NPM[0] && minor >= MIN_NPM[1]);
}

const env: NodeJS.ProcessEnv = { ...process.env };
delete env.NODE_AUTH_TOKEN;
// The worktree's own install must not rewire this repository's git hooks.
env.HUSKY = '0';

async function interactive(command: string, args: string[], cwd: string, extra: NodeJS.ProcessEnv = {}): Promise<void> {
  const result = await run(command, args, { cwd, env: { ...env, ...extra }, inherit: true });
  if (result.code !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.code}`);
}

let npmScratch: string | undefined;

try {
  // 1. npm new enough for `npm trust`.
  const npmVersion = (await must('npm', ['--version'])).trim();
  if (!npmIsRecentEnough(npmVersion)) {
    console.log(`release:seed: npm ${npmVersion} is too old for \`npm trust\`; using npm@11 for this run`);
    npmScratch = mkdtempSync(path.join(tmpdir(), 'atlas-seed-npm-'));
    const prefix = path.join(npmScratch, 'npm');
    await must('npm', ['install', '--silent', '--no-audit', '--no-fund', '--prefix', prefix, 'npm@11']);
    env.PATH = `${path.join(prefix, 'node_modules/.bin')}${path.delimiter}${process.env.PATH}`;
  }

  // 2. npm login.
  if (!dryRun) {
    if ((await run('npm', ['whoami'], { env })).code !== 0) {
      console.log('release:seed: not logged in to npm; running `npm login`');
      await alertIfWaiting('npm login is waiting for you in this terminal', () => interactive('npm', ['login'], here), { afterMs: 0 });
    }
    console.log(`release:seed: publishing as ${(await must('npm', ['whoami'], { env })).trim()}`);
  }

  // 3. A clean origin/main. Kept across runs so a rerun does not reinstall and rebuild.
  await must('git', ['fetch', 'origin', 'main', '--tags'], { cwd: here });
  const sha = (await must('git', ['rev-parse', 'origin/main'], { cwd: here })).trim();
  const commonGitDir = (await must('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: here })).trim();
  const cache = seedCachePath(commonGitDir);
  const stampPath = `${cache}.sha`;
  if (!existsSync(path.join(cache, '.git'))) {
    mkdirSync(path.dirname(cache), { recursive: true });
    await must('git', ['worktree', 'prune'], { cwd: here });
    await must('git', ['worktree', 'add', '--detach', cache, sha], { cwd: here });
  } else {
    await must('git', ['reset', '--hard', sha], { cwd: cache });
  }

  const publicPackages = discoverPackages(cache).filter((pkg) => pkg.isPublic);
  if (publicPackages.length === 0) {
    throw new Error(`origin/main (${sha.slice(0, 7)}) has no public packages. Merge the change that sets publishConfig.access before seeding.`);
  }

  const built = existsSync(stampPath) && readFileSync(stampPath, 'utf8').trim() === sha && existsSync(path.join(cache, 'node_modules'));
  if (built) {
    console.log(`release:seed: reusing build of origin/main ${sha.slice(0, 7)}`);
  } else {
    console.log(`release:seed: installing and building origin/main ${sha.slice(0, 7)}`);
    await interactive('bun', ['install', '--frozen-lockfile'], cache);
    await interactive('bun', ['run', 'build'], cache);
    writeFileSync(stampPath, sha);
  }

  // 4. Publish, trust, tag, release.
  await interactive(process.execPath, [path.join(here, 'scripts/release/publish.ts'), dryRun ? '--dry-run' : '--local'], cache, { ATLAS_RELEASE_ROOT: cache });
} catch (error) {
  console.error(`release:seed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (npmScratch) rmSync(npmScratch, { recursive: true, force: true });
}
