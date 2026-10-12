/**
 * Shared release planning. Atlas is one public package, `@crvouga/atlas`, at the repository root;
 * the planning stays general over workspace packages so a second one would need no new code.
 *
 * Versions live in git tags, not in committed package.json files (the semantic-release model, and
 * the one crvouga/mockingbird uses). Each public package is tagged `<name>@<version>` at the commit
 * it was released from; package.json keeps the `0.0.0-development` placeholder.
 *
 * A package is public when its manifest sets `publishConfig.access: "public"` and is not private.
 *
 * A package is released when:
 *   - it has never been tagged (initial release), or
 *   - a releasable Conventional Commit touched its sources since its last tag, or
 *   - a public workspace package it depends on at runtime is being released.
 *
 * Bump: BREAKING / `type!` → major, feat → minor, fix/perf/revert/refactor/build/docs → patch,
 * dependency-only release → patch. test/ci/chore/style never release on their own.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { must, run } from '../process.ts';

/** The checkout being released. The seed points this at its clean copy of origin/main. */
export const root = process.env.ATLAS_RELEASE_ROOT ? path.resolve(process.env.ATLAS_RELEASE_ROOT) : path.join(import.meta.dirname, '../..');
export const REPO = 'crvouga/atlas';
/** npm Trusted Publishing is pinned to this workflow filename. */
export const WORKFLOW_FILE = 'ci.yml';
export const PLACEHOLDER_VERSION = '0.0.0-development';
export const INITIAL_VERSION = '0.1.0';
/** Every tag this repo's releases create starts with this. */
export const TAG_GLOB = '@crvouga/atlas@*';

// ── Workspace discovery ────────────────────────────────────────────

export type Manifest = {
  name?: string;
  version?: string;
  private?: boolean;
  bin?: string | Record<string, string>;
  exports?: Record<string, unknown>;
  files?: string[];
  publishConfig?: { access?: string } & Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export type WorkspacePackage = {
  name: string;
  dir: string;
  relDir: string;
  manifestPath: string;
  isPublic: boolean;
  /** Workspace packages this one needs at runtime (dependencies / peer / optional). */
  runtimeDeps: string[];
  /** Paths whose changes release this package. */
  sources: string[];
};

/**
 * What a commit must touch to release the root package: what ships, and what shapes it. The rest of
 * the repository (docs, CI, the release scripts, the example) changes nothing a project installs.
 */
const ROOT_SOURCES = ['packages', 'package.json', 'README.md', 'tsconfig.base.json', 'tsconfig.build.json', 'scripts/build-package.ts'];

/** The root package first, then every directory the manifest's `workspaces` patterns match. */
function workspaceDirs(base: string): string[] {
  const dirs: string[] = ['.'];
  const { workspaces = [] } = JSON.parse(readFileSync(path.join(base, 'package.json'), 'utf8')) as { workspaces?: string[] };
  for (const pattern of workspaces) {
    if (!pattern.endsWith('/*')) {
      dirs.push(pattern);
      continue;
    }
    const parent = pattern.slice(0, -2);
    if (!existsSync(path.join(base, parent))) continue;
    for (const entry of readdirSync(path.join(base, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(`${parent}/${entry.name}`);
    }
  }
  return dirs;
}

export function discoverPackages(base: string = root): WorkspacePackage[] {
  const found = new Map<string, WorkspacePackage & { deps: string[] }>();
  for (const relDir of workspaceDirs(base)) {
    const sources = relDir === '.' ? ROOT_SOURCES : [relDir];
    const manifestPath = path.join(base, relDir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    if (!manifest.name) continue;
    found.set(manifest.name, {
      name: manifest.name,
      dir: path.join(base, relDir),
      relDir,
      manifestPath,
      isPublic: manifest.private !== true && manifest.publishConfig?.access === 'public',
      runtimeDeps: [],
      sources,
      deps: Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies })
    });
  }
  return [...found.values()].map(({ deps, ...pkg }) => ({ ...pkg, runtimeDeps: deps.filter((d) => found.has(d)) })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Dependencies before dependents, so every published pin already exists on npm. */
export function topoSort<T extends { name: string; runtimeDeps: string[] }>(pkgs: T[]): T[] {
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  const out: T[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (pkg: T) => {
    const s = state.get(pkg.name);
    if (s === 'done') return;
    if (s === 'visiting') throw new Error(`release: dependency cycle through ${pkg.name}`);
    state.set(pkg.name, 'visiting');
    for (const dep of pkg.runtimeDeps) {
      const d = byName.get(dep);
      if (d) visit(d);
    }
    state.set(pkg.name, 'done');
    out.push(pkg);
  };
  for (const pkg of pkgs) visit(pkg);
  return out;
}

// ── Versions ───────────────────────────────────────────────────────

const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

/** Orders plain `x.y.z` versions, ascending. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The highest plain `x.y.z` among `versions`; prereleases are ignored. */
export function highestVersion(versions: string[]): string | null {
  return versions.filter((v) => PLAIN_VERSION.test(v)).sort((a, b) => compareVersions(b, a))[0] ?? null;
}

// ── Publish manifests ──────────────────────────────────────────────

const RUNTIME_DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;

/**
 * Fields of `publishConfig` that replace the manifest's own when it is published. This is what
 * points the published package at `dist` while the repository keeps importing `src`. pnpm and Yarn
 * do this on pack; Bun and npm pack the manifest as written, so the release does it here.
 */
const PUBLISH_OVERRIDES = ['exports', 'main', 'types', 'bin'] as const;

/**
 * The manifest as it is published: its released version, every `workspace:` runtime dependency
 * rewritten to the exact version that dependency resolves to in this release, and the
 * `publishConfig` overrides applied.
 */
export function publishManifest(raw: string, version: string, versions: Map<string, string>): string {
  // Fields this script does not model are preserved: JSON.parse keeps them.
  const manifest = JSON.parse(raw) as Manifest;
  manifest.version = version;
  for (const field of PUBLISH_OVERRIDES) {
    const override = manifest.publishConfig?.[field];
    if (override === undefined) continue;
    (manifest as Record<string, unknown>)[field] = override;
    delete manifest.publishConfig?.[field];
  }
  for (const field of RUNTIME_DEP_FIELDS) {
    const deps = manifest[field];
    if (!deps) continue;
    for (const [dep, range] of Object.entries(deps)) {
      if (!range.startsWith('workspace:')) continue;
      const resolved = versions.get(dep);
      if (!resolved) throw new Error(`release: ${manifest.name ?? '(unnamed)'} depends on ${dep} (${range}), which has no published version`);
      deps[dep] = resolved;
    }
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Runtime dependency pins a consumer could not resolve from npm alone. */
export function unresolvablePins(manifest: Manifest): string[] {
  const bad: string[] = [];
  for (const field of RUNTIME_DEP_FIELDS) {
    for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
      if (range.startsWith('workspace:') || range.includes(PLACEHOLDER_VERSION)) bad.push(`${field}.${dep} = "${range}"`);
    }
  }
  return bad;
}

/**
 * Pack a package into `destination` and return the tarball's path. The manifest on disk is packed
 * as written, so write `publishManifest` first. Lifecycle scripts are skipped: `prepare` installs
 * git hooks, which has no place in a release.
 */
export async function pack(pkgDir: string, destination: string): Promise<string> {
  const out = await must('bun', ['pm', 'pack', '--destination', destination, '--quiet', '--ignore-scripts'], { cwd: pkgDir });
  const tarball = out.trim().split('\n').pop()?.trim();
  if (!tarball?.endsWith('.tgz')) throw new Error(`bun pm pack printed no tarball for ${pkgDir}`);
  return path.resolve(pkgDir, tarball);
}

/** The `package.json` a consumer would install, read back out of a packed tarball. */
export async function packedManifest(tarball: string): Promise<Manifest> {
  return JSON.parse(await must('tar', ['-xzOf', tarball, 'package/package.json'])) as Manifest;
}

/** Every file in a packed tarball, relative to the package root. */
export async function packedFiles(tarball: string): Promise<string[]> {
  return (await must('tar', ['-tzf', tarball]))
    .split('\n')
    .filter(Boolean)
    .map((file) => file.replace(/^package\//, ''));
}

/** Files an `exports` map (or `bin`) names that the tarball does not contain. Patterns (`*`) are skipped. */
export function missingEntryPoints(manifest: Manifest, files: string[]): string[] {
  const have = new Set(files);
  const targets: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === 'string') targets.push(value);
    else if (value && typeof value === 'object') for (const nested of Object.values(value)) collect(nested);
  };
  collect(manifest.exports);
  collect(manifest.bin);
  return [...new Set(targets)].filter((target) => !target.includes('*') && !have.has(target.replace(/^\.\//, '')));
}

// ── Git ────────────────────────────────────────────────────────────

export const tagName = (name: string, version: string): string => `${name}@${version}`;

/** Plain versions this package has been tagged at, newest first. */
export async function taggedVersions(name: string): Promise<string[]> {
  const result = await run('git', ['tag', '--list', `${name}@*`], { cwd: root });
  return result.stdout
    .split('\n')
    .map((t) => t.trim().slice(name.length + 1))
    .filter((v) => PLAIN_VERSION.test(v))
    .sort((a, b) => compareVersions(b, a));
}

export type Commit = { hash: string; subject: string; body: string };

/** Non-merge commits since `tag` that touched any of `paths`. */
export async function commitsTouching(tag: string, paths: string[], to = 'HEAD'): Promise<Commit[]> {
  const sep = '\u001e';
  const out = await must('git', ['log', '--no-merges', `--format=%H%x1f%s%x1f%b${sep}`, `${tag}..${to}`, '--', ...paths], { cwd: root });
  return out
    .split(sep)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [hash = '', subject = '', body = ''] = block.split('\u001f');
      return { hash: hash.trim(), subject: subject.trim(), body: body.trim() };
    });
}

// ── Conventional Commits ───────────────────────────────────────────

export type Bump = 'major' | 'minor' | 'patch';
const ORDER: Bump[] = ['patch', 'minor', 'major'];
const PATCH_TYPES = new Set(['fix', 'perf', 'revert', 'refactor', 'build', 'docs']);
const HEADER = /^(\w+)(\([^)]*\))?(!)?:\s*(.*)$/;

export function parseCommit(commit: Commit): { type: string | null; bump: Bump | null } {
  const m = commit.subject.match(HEADER);
  const type = m?.[1] ?? null;
  if (m?.[3] === '!' || /^BREAKING[ -]CHANGE:/m.test(commit.body)) return { type, bump: 'major' };
  if (type === 'feat') return { type, bump: 'minor' };
  if (type && PATCH_TYPES.has(type)) return { type, bump: 'patch' };
  return { type, bump: null };
}

const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;

/** Issues a set of commits closes (`Fixes #12`, `Closes #7`), in ascending order. */
export function closedIssues(commits: Commit[]): number[] {
  const issues = new Set<number>();
  for (const commit of commits) {
    for (const match of `${commit.subject}\n${commit.body}`.matchAll(CLOSES)) issues.add(Number(match[1]));
  }
  return [...issues].sort((a, b) => a - b);
}

export const stripType = (subject: string): string => subject.match(HEADER)?.[4] ?? subject;

export function maxBump(bumps: (Bump | null)[]): Bump | null {
  let best: Bump | null = null;
  for (const b of bumps) if (b && (!best || ORDER.indexOf(b) > ORDER.indexOf(best))) best = b;
  return best;
}

export function bumpVersion(version: string, bump: Bump): string {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// ── npm ────────────────────────────────────────────────────────────

/** Published versions, `[]` if the package does not exist, or an error string. */
export async function npmVersions(name: string): Promise<string[] | { error: string }> {
  const result = await run('npm', ['view', name, 'versions', '--json', '--prefer-online'], { cwd: root });
  const out = result.stdout.trim();
  if (result.code !== 0) {
    if (/E404|404 Not Found/.test(out + result.stderr)) return [];
    return { error: result.stderr.trim() || `npm view exited ${result.code}` };
  }
  if (!out) return [];
  const parsed = JSON.parse(out) as string | string[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Why a package cannot be published from this run, or null.
 * Trusted Publishing (OIDC) can only publish new versions of a package that exists on npm;
 * creating one needs an interactive local npm login. Only that package is blocked: the rest
 * of the run keeps releasing (docs/releasing.md).
 */
export function initialPackageBlocker(published: string[], runMode: { inCi: boolean; local: boolean; dryRun: boolean }): string[] | null {
  if (published.length > 0 || !runMode.inCi || runMode.local || runMode.dryRun) return null;
  return [
    'package does not exist on npm yet, and Trusted Publishing (OIDC) cannot create packages.',
    'First-publish it with an interactive maintainer login, attach this workflow as its Trusted',
    'Publisher, then re-run CI: bun run release:seed'
  ];
}

/**
 * The closing errors for releases only the local seed can finish: packages that are not on npm
 * yet, and published ones whose OIDC publish npm rejected (no usable Trusted Publisher).
 * "Every other package was released" is claimed only when nothing else failed.
 */
export function seedSummary(outcome: { needsSeed: string[]; needsTrust: string[]; failed: number }): string[] {
  const { needsSeed, needsTrust, failed } = outcome;
  if (needsSeed.length === 0 && needsTrust.length === 0) return [];
  const lines: string[] = [];
  if (needsSeed.length > 0) {
    lines.push(`::error::${needsSeed.length} initial npm package(s) need an interactive local seed: ${needsSeed.join(', ')}`);
  }
  if (needsTrust.length > 0) {
    lines.push(
      `::error::${needsTrust.length} published package(s) were rejected by npm Trusted Publishing and need their publisher attached by the local seed: ${needsTrust.join(', ')}`
    );
  }
  const others = failed === needsSeed.length + needsTrust.length;
  lines.push(`${others ? 'Every other package was released. ' : ''}Run bun run release:seed, then retry CI.`);
  return lines;
}

/**
 * Attempt every release in order (dependencies first). A release that fails, or whose
 * dependency failed, never stops the independent ones. Returns the names that did not release.
 */
export async function releaseInOrder<R extends { pkg: { name: string; runtimeDeps: string[] } }>(
  releases: R[],
  attempt: (release: R) => Promise<boolean>,
  onSkip: (release: R, blockedBy: string[]) => void
): Promise<Set<string>> {
  const failed = new Set<string>();
  for (const release of releases) {
    const blockedBy = release.pkg.runtimeDeps.filter((d) => failed.has(d));
    if (blockedBy.length > 0) {
      failed.add(release.pkg.name);
      onSkip(release, blockedBy);
    } else if (!(await attempt(release))) {
      failed.add(release.pkg.name);
    }
  }
  return failed;
}

export function redact(text: string): string {
  return text.replace(/npm_[A-Za-z0-9]{20,}/g, 'npm_***').replace(/_authToken=\S+/g, '_authToken=***');
}

const RETRYABLE_GITHUB = /HTTP (?:500|502|503|504)\b|secondary rate limit|abuse detection|rate limit exceeded/i;

/** GitHub occasionally returns 500 while creating many releases; those are worth retrying. */
export function isRetryableGitHubError(text: string): boolean {
  return RETRYABLE_GITHUB.test(text);
}

/** 5s, 10s, 20s, 40s, then 60s. `attempt` is 0-based. */
export function githubRetryDelayMs(attempt: number): number {
  return Math.min(5000 * 2 ** attempt, 60_000);
}

// ── Plan ───────────────────────────────────────────────────────────

export type Release = {
  pkg: WorkspacePackage;
  previous: string | null;
  version: string;
  bump: Bump | 'initial';
  commits: Commit[];
  /** Workspace dependencies released in the same run. */
  dependencyUpdates: string[];
};

export type Plan = {
  packages: WorkspacePackage[];
  /** Version every public package resolves to after this run (released or last tag). */
  versions: Map<string, string>;
  releases: Release[];
};

export async function computePlan(): Promise<Plan> {
  const packages = discoverPackages();
  const publicPkgs = packages.filter((p) => p.isPublic);
  const versions = new Map<string, string>();
  const releases = new Map<string, Release>();

  for (const pkg of publicPkgs) {
    const previous = (await taggedVersions(pkg.name))[0] ?? null;
    if (!previous) {
      // Never tagged: first release. If npm already has versions (a seed that published but
      // died before tagging), release the next patch above them.
      const published = await npmVersions(pkg.name);
      if (!Array.isArray(published)) throw new Error(`npm view ${pkg.name}: ${published.error}`);
      const latest = highestVersion(published);
      const version = latest ? bumpVersion(latest, 'patch') : INITIAL_VERSION;
      releases.set(pkg.name, { pkg, previous: null, version, bump: 'initial', commits: [], dependencyUpdates: [] });
      continue;
    }
    versions.set(pkg.name, previous);
    const commits = await commitsTouching(tagName(pkg.name, previous), pkg.sources);
    const bump = maxBump(commits.map((c) => parseCommit(c).bump));
    if (bump) {
      releases.set(pkg.name, {
        pkg,
        previous,
        version: bumpVersion(previous, bump),
        bump,
        commits: commits.filter((c) => parseCommit(c).bump),
        dependencyUpdates: []
      });
    }
  }

  // Workspace deps are pinned exactly at pack time, so dependents must re-release.
  let changed = true;
  while (changed) {
    changed = false;
    for (const pkg of publicPkgs) {
      const updated = pkg.runtimeDeps.filter((d) => releases.has(d));
      if (updated.length === 0) continue;
      const existing = releases.get(pkg.name);
      if (existing) {
        existing.dependencyUpdates = updated;
        continue;
      }
      const previous = versions.get(pkg.name);
      if (!previous) continue;
      releases.set(pkg.name, { pkg, previous, version: bumpVersion(previous, 'patch'), bump: 'patch', commits: [], dependencyUpdates: updated });
      changed = true;
    }
  }

  for (const r of releases.values()) versions.set(r.pkg.name, r.version);
  const ordered = topoSort(publicPkgs).filter((p) => releases.has(p.name));
  return { packages, versions, releases: ordered.map((p) => releases.get(p.name) as Release) };
}

/** Releasable commits grouped under Breaking / Features / Fixes headings, as Markdown lines. */
function commitSections(commits: Commit[]): string[] {
  const lines: string[] = [];
  const link = (c: Commit) => `- ${stripType(c.subject)} ([${c.hash.slice(0, 7)}](https://github.com/${REPO}/commit/${c.hash}))`;
  const sections: [string, (c: Commit) => boolean][] = [
    ['⚠️ Breaking changes', (c) => parseCommit(c).bump === 'major'],
    ['Features', (c) => parseCommit(c).bump === 'minor'],
    ['Fixes and improvements', (c) => parseCommit(c).bump === 'patch']
  ];
  for (const [title, match] of sections) {
    const matched = commits.filter(match);
    if (matched.length === 0) continue;
    lines.push(`### ${title}`, '', ...matched.map(link), '');
  }
  return lines;
}

export function releaseNotes(release: Release, versions: Map<string, string>): string {
  const lines: string[] = [];
  if (release.bump === 'initial') lines.push('Initial release.', '');
  lines.push(...commitSections(release.commits));
  if (release.dependencyUpdates.length > 0) {
    lines.push('### Dependencies', '', ...release.dependencyUpdates.map((d) => `- \`${d}@${versions.get(d)}\``), '');
  }
  const pkgUrl = `https://www.npmjs.com/package/${release.pkg.name}/v/${release.version}`;
  lines.push(`npm: [${release.pkg.name}@${release.version}](${pkgUrl})`);
  return lines.join('\n');
}

/**
 * The package's whole changelog, newest first: the release being cut (when given),
 * then every tagged release, each with the releasable commits since the tag before it.
 * Built from git tags at publish time, so nothing version-shaped is ever committed.
 */
export async function changelog(pkg: WorkspacePackage, upcoming?: Release): Promise<string> {
  const tagged = await taggedVersions(pkg.name);
  const lines = [`# Changelog: ${pkg.name}`, ''];
  if (upcoming) {
    lines.push(`## ${upcoming.version} (${new Date().toISOString().slice(0, 10)})`, '');
    if (upcoming.bump === 'initial') lines.push('Initial release.', '');
    lines.push(...commitSections(upcoming.commits));
    if (upcoming.dependencyUpdates.length > 0) {
      lines.push('### Dependencies', '', ...upcoming.dependencyUpdates.map((d) => `- \`${d}\``), '');
    }
  }
  for (const [index, version] of tagged.entries()) {
    const tag = tagName(pkg.name, version);
    const date = (await run('git', ['log', '-1', '--format=%as', tag], { cwd: root })).stdout.trim();
    lines.push(`## ${version}${date ? ` (${date})` : ''}`, '');
    const previous = tagged[index + 1];
    if (previous === undefined) {
      lines.push('Initial release.', '');
      continue;
    }
    const sections = commitSections(await commitsTouching(tagName(pkg.name, previous), pkg.sources, tag));
    lines.push(...(sections.length > 0 ? sections : ['Dependency updates only.', '']));
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
