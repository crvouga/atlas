/**
 * Release every public package that changed since its last `<name>@<version>` tag.
 *
 * For each release (dependencies first):
 *   1. write its published manifest (version, pinned workspace deps, `publishConfig` overrides)
 *      and `bun pm pack`
 *   2. npm publish: Trusted Publishing (OIDC) in CI; an interactive maintainer login only
 *      for a brand-new package during `release:seed`
 *   3. push the `<name>@<version>` tag and create its GitHub Release
 * A local seed also attaches the Trusted Publisher to every published package that lacks one. CI
 * has no long-lived npm credential and cannot perform that account-management operation.
 *
 * Every step is idempotent: versions already on npm, existing tags and existing
 * GitHub Releases are skipped, so a failed run is fixed by re-running it.
 * A GitHub 500 while creating a release is retried. It does not abort the other
 * packages, and a tag that already exists is not published again.
 *
 *   bun scripts/release/publish.ts --dry-run   (plan + pack, no side effects)
 *   bun scripts/release/publish.ts             (CI, on main)
 *   bun scripts/release/publish.ts --local     (maintainer bootstrap: your npm login, no provenance)
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadPackageTrust, npmAuthToken } from '../health/trusted-publisher.ts';
import { must, run, sleep, type Result } from '../process.ts';
import { alertIfWaiting } from './attention.ts';
import { restoreOriginals } from './files.ts';
import {
  changelog,
  closedIssues,
  computePlan,
  githubRetryDelayMs,
  initialPackageBlocker,
  isRetryableGitHubError,
  missingEntryPoints,
  npmVersions,
  pack,
  packedFiles,
  packedManifest,
  publishManifest,
  REPO,
  type Release,
  redact,
  releaseInOrder,
  releaseNotes,
  root,
  seedSummary,
  TAG_GLOB,
  tagName,
  unresolvablePins,
  WORKFLOW_FILE
} from './lib.ts';
import { trustedPublisherReconciler } from './trust.ts';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const local = argv.includes('--local');
const inCi = process.env.GITHUB_ACTIONS === 'true';

if (!dryRun && !inCi && !local) {
  console.error('release:publish: runs in CI. Use --dry-run to preview, or bun scripts/release/seed.ts to bootstrap.');
  process.exit(1);
}

if (local && !dryRun) {
  await must('git', ['fetch', 'origin', 'main', '--tags'], { cwd: root });
  const head = (await must('git', ['rev-parse', 'HEAD'], { cwd: root })).trim();
  const main = (await must('git', ['rev-parse', 'origin/main'], { cwd: root })).trim();
  if (head !== main) {
    console.error('release:publish --local must run from a checkout of origin/main');
    process.exit(1);
  }
}

const plan = await computePlan();
if (plan.releases.length === 0) {
  console.log('release:publish: nothing to release');
} else {
  console.log(`release:publish: ${plan.releases.length} package(s) still to release${dryRun ? ' (dry-run)' : ''}`);
}

/** Files this run edits or creates, with what to put back (`null`: delete). */
const originals = new Map<string, string | null>();
function writeTemporarily(file: string, content: string): void {
  if (!originals.has(file)) originals.set(file, existsSync(file) ? readFileSync(file, 'utf8') : null);
  writeFileSync(file, content);
}
// Ctrl-C skips `finally`, and would leave pinned manifests behind in the checkout.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    restoreOriginals(originals);
    process.exit(130);
  });
}

// Pin every public package for packing: its own version, and its workspace
// dependencies rewritten to the versions this run resolves them to.
for (const pkg of plan.packages) {
  const version = plan.versions.get(pkg.name);
  if (!version) continue;
  writeTemporarily(pkg.manifestPath, publishManifest(readFileSync(pkg.manifestPath, 'utf8'), version, plan.versions));
}

// Each release ships its whole changelog, generated from the tags; removed again after packing.
for (const release of plan.releases) {
  writeTemporarily(path.join(release.pkg.dir, 'CHANGELOG.md'), await changelog(release.pkg, release));
}

const packDir = mkdtempSync(path.join(tmpdir(), 'atlas-release-'));
const failed = new Set<string>();
/** Never-published packages that need the interactive local seed. */
const needsSeed: string[] = [];
/** Published packages whose OIDC publish npm rejected; the local seed attaches their publisher. */
const needsTrust: string[] = [];
/** `<name>@<version>` of everything this run put on npm, which `npm view` may not show yet. */
const releasedNow = new Set<string>();
// OIDC is npm's fallback only when legacy token auth is absent. Locally, use the npm login.
const npmEnv: NodeJS.ProcessEnv = { ...process.env };
if (!local) delete npmEnv.NODE_AUTH_TOKEN;
const localTrustToken = local && !dryRun ? npmAuthToken() : undefined;

/** A seed is left running unattended, so a step that stalls on the maintainer's approval alerts. */
function attended<T>(what: string, work: () => Promise<T>): Promise<T> {
  if (!local) return work();
  return alertIfWaiting(`${what} is probably waiting for your npm approval (2FA) in this terminal or your browser`, work);
}

/** Runs npm with inherited stdio so a local run can answer 2FA prompts. */
async function npm(args: string[], cwd = root): Promise<number> {
  return (await attended(`npm ${args[0]}`, () => run('npm', args, { cwd, env: npmEnv, inherit: true }))).code;
}

function fail(name: string, lines: string[]): void {
  failed.add(name);
  console.error(`::error::release ${name} failed`);
  for (const line of lines) console.error(`  ${redact(line)}`);
}

/**
 * A consumer runs `npm i <pkg>` with no overrides, so every workspace pin in the
 * packed manifest has to be a real version that npm can already serve, and every entry point
 * it names has to be in the tarball. Releases are topologically ordered, so a dependency
 * released in this same run is there first.
 */
async function assertInstallable(release: Release, tarball: string): Promise<boolean> {
  const manifest = await packedManifest(tarball);
  const bad = unresolvablePins(manifest);
  if (bad.length > 0) {
    fail(release.pkg.name, ['packed manifest pins no consumer could resolve:', ...bad]);
    return false;
  }
  const missing = missingEntryPoints(manifest, await packedFiles(tarball));
  if (missing.length > 0) {
    fail(release.pkg.name, ['packed manifest names entry points the tarball does not contain (run bun run build):', ...missing]);
    return false;
  }
  for (const dep of release.pkg.runtimeDeps) {
    const pinned = manifest.dependencies?.[dep] ?? manifest.peerDependencies?.[dep] ?? manifest.optionalDependencies?.[dep];
    if (!pinned || releasedNow.has(`${dep}@${pinned}`)) continue;
    const published = await npmVersions(dep);
    if (!Array.isArray(published)) {
      fail(release.pkg.name, [`npm view ${dep}: ${published.error}`]);
      return false;
    }
    if (!published.includes(pinned)) {
      fail(release.pkg.name, [
        `pins ${dep}@${pinned}, which is not on npm, so installing it would fail.`,
        `Releases are ordered dependencies-first; check that ${dep} released in this run.`
      ]);
      return false;
    }
  }
  return true;
}

async function publish(release: Release): Promise<boolean> {
  const { pkg, version } = release;
  const published = await npmVersions(pkg.name);
  if (!Array.isArray(published)) {
    fail(pkg.name, [`npm view: ${published.error}`]);
    return false;
  }
  if (published.includes(version)) {
    console.log(`skip ${pkg.name}@${version} (already on npm)`);
    releasedNow.add(`${pkg.name}@${version}`);
    return true;
  }
  const isNew = published.length === 0;
  const blocker = initialPackageBlocker(published, { inCi, local, dryRun });
  if (blocker) {
    needsSeed.push(pkg.name);
    fail(pkg.name, blocker);
    return false;
  }

  const tarball = await pack(pkg.dir, packDir);
  if (!(await assertInstallable(release, tarball))) return false;
  if (dryRun) {
    console.log(`would publish ${pkg.name}@${version}${isNew ? ' (new package)' : ''}`);
    releasedNow.add(`${pkg.name}@${version}`);
    return true;
  }

  console.log(`publish ${pkg.name}@${version}${isNew ? ' (new package)' : ''}`);
  const provenance = local ? '--provenance=false' : '--provenance';
  const exitCode = await npm(['publish', tarball, '--access', 'public', provenance], pkg.dir);
  if (exitCode !== 0) {
    if (!isNew && !local) needsTrust.push(pkg.name);
    fail(pkg.name, [
      `npm publish exited ${exitCode}`,
      isNew
        ? 'Run bun scripts/release/seed.ts with an interactive maintainer login.'
        : `Check its Trusted Publisher (repo ${REPO}, workflow ${WORKFLOW_FILE}): https://www.npmjs.com/package/${pkg.name}/access`
    ]);
    return false;
  }
  releasedNow.add(`${pkg.name}@${version}`);
  return true;
}

const trust = trustedPublisherReconciler({
  async list(name) {
    if (typeof localTrustToken !== 'string') {
      throw new Error(localTrustToken?.error ?? 'npm trusted publisher lookup is unavailable');
    }
    const loaded = await attended('the trusted publisher lookup', () => loadPackageTrust([name], localTrustToken));
    if (!Array.isArray(loaded)) throw new Error(loaded.error);
    const pkg = loaded[0];
    if (!pkg || pkg.error) throw new Error(pkg?.error ?? 'npm returned no trusted publisher');
    return JSON.stringify(pkg.configs ?? []);
  },
  async revoke(name, id) {
    return (await npm(['trust', 'revoke', name, '--id', id])) === 0;
  },
  async create(name) {
    const args = ['trust', 'github', name, '--file', WORKFLOW_FILE, '--repository', REPO];
    if ((await npm([...args, '--allow-publish', '--yes'])) === 0) {
      console.log(`trust ${name}: GitHub Actions ${REPO}/${WORKFLOW_FILE}`);
      return true;
    }
    console.warn(`::warning::Could not attach Trusted Publisher for ${name}; add it at https://www.npmjs.com/package/${name}/access`);
    return false;
  },
  onError(name, error) {
    console.warn(`::warning::Trusted Publisher for ${name} failed: ${redact(String(error))}`);
  }
});
const trustFailed = trust.failed;

/** Attach the GitHub Actions Trusted Publisher so future releases need no token. */
async function ensureTrustedPublisher(name: string): Promise<void> {
  if (dryRun || !local) return;
  await trust.ensure(name);
}

const detailOf = (result: Result): string => redact(`${result.stderr}\n${result.stdout}`).trim();

/**
 * Create the GitHub Release for a tag that is already on origin.
 * Returns false only after the retries are exhausted. Never throws: one 500 must
 * not abort the rest of the run.
 */
async function createGitHubRelease(tag: string, notes: string): Promise<boolean> {
  const hasRelease = await run('gh', ['release', 'view', tag, '--repo', REPO]);
  if (hasRelease.code === 0) return true;
  const attempts = 6;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const created = await run('gh', ['release', 'create', tag, '--repo', REPO, '--title', tag, '--notes', notes, '--verify-tag', '--latest=false']);
    const detail = detailOf(created);
    if (created.code === 0 || /already exists/i.test(detail)) return true;
    const retry = attempt + 1 < attempts && isRetryableGitHubError(detail);
    if (!retry) {
      console.error(`::error::GitHub release for ${tag} failed\n  ${detail}`);
      return false;
    }
    const delay = githubRetryDelayMs(attempt);
    console.warn(`::warning::GitHub release for ${tag} failed; retrying in ${delay / 1000}s\n  ${detail}`);
    await sleep(delay);
  }
  return false;
}

/** Notes for a tag that was pushed by an earlier run, whose planned notes are gone with that run. */
function releaseNoteForTag(tag: string): string {
  const at = tag.lastIndexOf('@');
  const name = tag.slice(0, at);
  const version = tag.slice(at + 1);
  return `npm: [${name}@${version}](https://www.npmjs.com/package/${name}/v/${version})`;
}

/**
 * Tags from a run that died on `gh release create` are already the released version, so the
 * next plan skips them and would never create the release. Fill those in before publishing.
 * Returns how many are still missing.
 */
async function repairMissingReleases(): Promise<number> {
  const lines = (text: string) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  const tags = lines(await must('git', ['tag', '--list', TAG_GLOB], { cwd: root }));
  if (tags.length === 0) return 0;
  const remote = await run('gh', ['api', '--paginate', `repos/${REPO}/releases`, '--jq', '.[].tag_name']);
  if (remote.code !== 0) {
    console.warn(`::warning::could not list GitHub releases\n  ${detailOf(remote)}`);
    return 0;
  }
  const have = new Set(lines(remote.stdout));
  const missing = tags.filter((tag) => !have.has(tag));
  if (missing.length === 0) return 0;
  console.log(`release:publish: ${missing.length} existing tag(s) have no GitHub release`);
  let still = 0;
  for (const tag of missing) {
    if (dryRun) {
      console.log(`would create release ${tag}`);
      continue;
    }
    if (await createGitHubRelease(tag, releaseNoteForTag(tag))) console.log(`tagged ${tag}`);
    else still += 1;
  }
  return still;
}

async function tagAndRelease(release: Release): Promise<boolean> {
  const tag = tagName(release.pkg.name, release.version);
  const notes = releaseNotes(release, plan.versions);
  if (dryRun) {
    console.log(`would tag ${tag}\n${notes.replace(/^/gm, '    ')}`);
    return true;
  }
  const exists = await run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd: root });
  if (exists.code !== 0) {
    const tagged = await run('git', ['tag', '-a', tag, '-m', tag], { cwd: root });
    if (tagged.code !== 0) {
      console.error(`::error::git tag ${tag} failed\n  ${detailOf(tagged)}`);
      return false;
    }
  }
  const pushed = await run('git', ['push', 'origin', `refs/tags/${tag}`], { cwd: root });
  if (pushed.code !== 0) {
    console.error(`::error::git push ${tag} failed\n  ${detailOf(pushed)}`);
    return false;
  }
  if (!(await createGitHubRelease(tag, notes))) return false;
  console.log(`tagged ${tag}`);
  return true;
}

/** Issue number → the `<name>@<version>` releases of this run that close it. */
const closing = new Map<number, Release[]>();

/**
 * Tell each issue this run closes which versions carry the fix, so the project that reported it
 * knows what to upgrade to. One comment per issue. Best effort: a missed comment never fails a release.
 */
async function announceOnIssues(): Promise<void> {
  for (const [issue, releases] of closing) {
    const versions = releases.map((r) => `[\`${r.pkg.name}@${r.version}\`](https://www.npmjs.com/package/${r.pkg.name}/v/${r.version})`).join(', ');
    const body = `Released in ${versions}. Upgrade with \`bun update @crvouga/atlas --latest\`.`;
    if (dryRun) {
      console.log(`would comment on #${issue}: ${body}`);
      continue;
    }
    const commented = await run('gh', ['issue', 'comment', String(issue), '--repo', REPO, '--body', body]);
    if (commented.code !== 0) console.warn(`::warning::could not comment on #${issue}\n  ${detailOf(commented)}`);
  }
}

let githubReleaseGaps = 0;
try {
  githubReleaseGaps += await repairMissingReleases();
  // A package that cannot release never stops the independent ones; its dependents are skipped.
  // A GitHub release failure does not: the package is already on npm, and dependents may pin it.
  await releaseInOrder(
    plan.releases,
    async (release) => {
      try {
        if (!(await publish(release))) return false;
        await ensureTrustedPublisher(release.pkg.name);
        if (!(await tagAndRelease(release))) githubReleaseGaps += 1;
        for (const issue of closedIssues(release.commits)) closing.set(issue, [...(closing.get(issue) ?? []), release]);
        return true;
      } catch (error) {
        fail(release.pkg.name, [error instanceof Error ? error.message : String(error)]);
        return false;
      }
    },
    (release, blockedBy) => fail(release.pkg.name, [`skipped: dependency failed to release (${blockedBy.join(', ')})`])
  );
  // Reconcile: every published package is trusted for OIDC, including ones not released in this run.
  for (const pkg of plan.packages) {
    if (!pkg.isPublic || failed.has(pkg.name)) continue;
    const published = await npmVersions(pkg.name);
    if (Array.isArray(published) && published.length > 0) await ensureTrustedPublisher(pkg.name);
  }
  await announceOnIssues();
} finally {
  const skipped = restoreOriginals(originals);
  if (skipped > 0) console.warn(`::warning::release checkout disappeared; skipped restoring ${skipped} temporary file(s)`);
  rmSync(packDir, { recursive: true, force: true });
}

const ok = plan.releases.length - failed.size;
console.log(
  `release:publish: released=${ok} failed=${failed.size} trusted-publisher-failed=${trustFailed.size} github-releases-missing=${githubReleaseGaps}${dryRun ? ' (dry-run)' : ''}`
);
for (const line of seedSummary({ needsSeed, needsTrust, failed: failed.size })) console.error(line);
if (githubReleaseGaps > 0) {
  console.error(`::error::${githubReleaseGaps} GitHub release(s) still missing. Re-run the release; versions already on npm are skipped.`);
}
if (trustFailed.size > 0) {
  console.error(`::error::${trustFailed.size} npm Trusted Publisher(s) still missing: ${[...trustFailed].join(', ')}`);
  console.error('Re-run bun scripts/release/seed.ts; successful package, tag, and trust operations are skipped.');
}
if (failed.size > 0 || trustFailed.size > 0 || githubReleaseGaps > 0) process.exit(1);
