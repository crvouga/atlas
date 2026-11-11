/**
 * @module A CI kit for UI catalogs: matrix plans and attempt names
 *
 * The thin, scheduler-free part of running a UI catalog collection in CI. `planMatrix` turns one resolved definition into a
 * fan-out: a job per distinct combination of the dimensions chosen to split jobs, which together cover every allowed
 * profile (after the definition's `exclude` and the plan's `where`) exactly once, and a build per distinct combination of
 * the dimensions that change what is built, so each build runs once and every job names the build it needs. The jobs do
 * not divide the work: each one is an ordinary queue shard narrowed with `where`, so a slow or rerun job is covered by the
 * queue's leases and retry limits, never by the plan. `attemptArtifactName` names a job's bundle so a rerun attempt never
 * overwrites an earlier one.
 *
 * The same plan runs on a laptop with fewer workers: the definition, the bundles and the refresh are the same, only the
 * number of shards differs. Atlas never picks the fan-out: `maxParallel` is what the caller asked for, and a plan larger
 * than `maxJobs` (GitHub's matrix limit, 256, by default) is refused rather than trimmed.
 *
 * @see docs/ui-catalog.md#a-ci-kit-plan-capture-finalize
 */
import { createHash } from 'node:crypto';

import { UI_CATALOG_MATRIX_VERSION, type UiMatrixPlan } from '../../schema/src/ui-catalog-matrix';
import type { UiCatalogDefinitionDocument } from '../../schema/src/ui-catalog-queue';
import { CatalogDefinitionError, checkWhere, expandCatalog } from './ui-catalog-definition';

/** How to fan a definition out. */
export type MatrixPlanOptions = {
  /** Dimensions that split jobs: one job per distinct combination of their values. Default every dimension (a job per profile). */
  readonly jobDimensions?: readonly string[];
  /** Dimensions that change what is built: one build per distinct combination. Default none. */
  readonly buildDimensions?: readonly string[];
  /** Only these profiles (`{ device: ['mobile'] }`). */
  readonly where?: Readonly<Record<string, readonly string[]>>;
  /** `strategy.max-parallel`. Required in spirit: default 4, never more than the jobs. */
  readonly maxParallel?: number;
  /** Refuse a plan with more jobs than this. Default 256, GitHub's limit for one matrix. */
  readonly maxJobs?: number;
};

const SAFE = /[^A-Za-z0-9._-]+/g;
const short = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 8);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A value as one POSIX shell word: single-quoted unless it is plainly safe. */
export function shellWord(value: string): string {
  return /^[A-Za-z0-9._\-=/:,@+]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Name one combination of values, safely for an artifact name or shard id: `device-mobile.scheme-dark`, with a short hash when cleaning made two names equal. */
function nameOf(values: Readonly<Record<string, string>>, order: readonly string[], taken: Set<string>): string {
  const raw = order.map(name => `${name}-${values[name]}`).join('.') || 'all';
  let name = raw.replace(SAFE, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'job';
  if (taken.has(name)) name = `${name.slice(0, 71)}-${short(raw)}`;
  taken.add(name);
  return name;
}

/**
 * Plan a CI fan-out for a resolved definition: every allowed profile (honouring `exclude` and `where`) is covered by exactly
 * one job, each distinct build once. Throws a {@link CatalogDefinitionError} for an unknown dimension or value, a
 * `maxParallel` that is not a positive integer, or a plan with more jobs than `maxJobs`; it never trims a plan.
 *
 * @example
 * ```ts
 * const plan = planMatrix(await resolveCatalog(catalog), { jobDimensions: ['device', 'scheme'], buildDimensions: ['scheme'], maxParallel: 8 });
 * // strategy: { matrix: plan.matrix, 'max-parallel': plan.maxParallel }
 * ```
 */
export function planMatrix(resolved: { readonly version: string; readonly document: UiCatalogDefinitionDocument }, options: MatrixPlanOptions = {}): UiMatrixPlan {
  const { document, version } = resolved;
  const declared = document.dimensions.map(dimension => dimension.name);
  const known = (names: readonly string[], flag: string) => {
    for (const name of names) if (!declared.includes(name)) throw new CatalogDefinitionError(`${flag} names "${name}", which is not a dimension of this definition. Dimensions: ${declared.map(item => `"${item}"`).join(', ') || 'none'}`);
    return declared.filter(name => names.includes(name));
  };
  const jobs = known(options.jobDimensions ?? declared, '--job-dimension');
  const builds = known(options.buildDimensions ?? [], '--build-dimension');
  for (const name of builds) if (!jobs.includes(name)) throw new CatalogDefinitionError(`The build dimension "${name}" must also split jobs, so that each job needs exactly one build`);
  const where = options.where && Object.keys(options.where).length ? options.where : undefined;
  if (where) checkWhere(document, where);
  const maxParallel = options.maxParallel ?? 4;
  if (!Number.isSafeInteger(maxParallel) || maxParallel < 1) throw new CatalogDefinitionError(`--max-parallel takes a positive whole number (got ${maxParallel})`);
  const maxJobs = options.maxJobs ?? 256;
  const expanded = expandCatalog(document, version);
  const profiles = expanded.profiles.filter(profile => !where || Object.entries(where).every(([name, accepted]) => accepted.includes(profile.values[name]!)));
  const groups = new Map<string, { values: Record<string, string>; profiles: number }>();
  for (const profile of profiles) {
    const values = Object.fromEntries(jobs.map(name => [name, profile.values[name]!]));
    const key = JSON.stringify(jobs.map(name => values[name]));
    const group = groups.get(key);
    if (group) group.profiles++; else groups.set(key, { values, profiles: 1 });
  }
  // A unit is claimed only by a shard whose where matches all of its items: one that spans two jobs would be claimed by none.
  if (document.groups) {
    const allowed = new Set(profiles.map(profile => profile.key));
    for (const unit of expanded.units) {
      const keys = new Set(unit.items.map(i => expanded.profiles[expanded.items[i]!.profile]!).filter(profile => allowed.has(profile.key)).map(profile => JSON.stringify(jobs.map(name => profile.values[name]))));
      if (keys.size > 1) throw new CatalogDefinitionError(`The work unit "${unit.key}" groups items of several jobs, so no job could claim it. Split jobs only by dimensions the definition's group keeps together`);
    }
  }
  if (groups.size > maxJobs) throw new CatalogDefinitionError(`The plan has ${groups.size} jobs, more than ${maxJobs}. Split jobs by fewer dimensions (--job-dimension), narrow it with --where, or raise --max-jobs where the CI allows it`);
  const sorted = [...groups.values()].sort((a, b) => compare(JSON.stringify(jobs.map(name => a.values[name])), JSON.stringify(jobs.map(name => b.values[name]))));
  const jobNames = new Set<string>(), buildNames = new Set<string>();
  const buildOf = new Map<string, { build: string; values: Record<string, string>; jobs: number }>();
  const states = document.states.length;
  const include = sorted.map(group => {
    let build: string | null = null;
    if (builds.length) {
      const values = Object.fromEntries(builds.map(name => [name, group.values[name]!]));
      const key = JSON.stringify(builds.map(name => values[name]));
      let found = buildOf.get(key);
      if (!found) { found = { build: nameOf(values, builds, buildNames), values, jobs: 0 }; buildOf.set(key, found); }
      found.jobs++;
      build = found.build;
    }
    // A job's where: its own values, and the plan's where for the dimensions that do not split jobs.
    const scope: [string, readonly string[]][] = [...jobs.map(name => [name, [group.values[name]!]] as [string, string[]]), ...Object.entries(where ?? {}).filter(([name]) => !jobs.includes(name))];
    return {
      job: nameOf(group.values, jobs, jobNames), values: group.values,
      where: scope.flatMap(([name, values]) => values.map(value => `--where ${shellWord(`${name}=${value}`)}`)).join(' '),
      build, profiles: group.profiles, items: group.profiles * states
    };
  });
  return {
    ok: true, schemaVersion: UI_CATALOG_MATRIX_VERSION,
    definition: { version, name: document.name, document },
    dimensions: { jobs, builds },
    matrix: { include },
    builds: { include: [...buildOf.values()] },
    participants: include.map(job => job.job),
    maxParallel: Math.max(1, Math.min(maxParallel, include.length)),
    jobs: include.length, profiles: profiles.length, items: profiles.length * states
  };
}

/**
 * The name of a job's bundle artifact for one attempt: `<prefix>-<job>-<run>-<attempt>`, cleaned to what artifact stores
 * accept. Distinct attempts of one job never collide, so a rerun never overwrites the evidence of the attempt before it.
 * Throws for an empty job, run or attempt.
 *
 * @example
 * ```ts
 * attemptArtifactName({ job: 'device-mobile', runId: '123', runAttempt: '2' }); // 'atlas-ui-bundle-device-mobile-123-2'
 * ```
 */
export function attemptArtifactName(input: { readonly prefix?: string; readonly job: string; readonly runId: string; readonly runAttempt: string }): string {
  for (const [name, value] of [['job', input.job], ['runId', input.runId], ['runAttempt', input.runAttempt]] as const) if (!value) throw new Error(`attemptArtifactName needs a ${name}`);
  const clean = (text: string) => text.replace(SAFE, '-').replace(/^-+|-+$/g, '');
  return [clean(input.prefix ?? 'atlas-ui-bundle'), clean(input.job), clean(input.runId), clean(input.runAttempt)].join('-');
}
