/**
 * @module The CI kit commands of `atlas ui-catalog`
 *
 * `atlas ui-catalog plan-matrix | refresh begin|status|finalize | bundle validate|merge|import`, and the `--refresh` and
 * `--journal` flags of `collect`: the commands a CI workflow (or a laptop running the same plan with fewer workers) uses
 * around the shared queue. `plan-matrix` fans a definition out into matrix JSON ({@link ./ui-catalog-ci}); `refresh` pins a
 * run and judges it whole ({@link ./ui-catalog-refresh}); `bundle` checks, merges and imports the journals shards wrote
 * ({@link ./ui-catalog-bundle}). None of them schedules anything: shards still coordinate only through the server.
 *
 * Exit codes as for every `atlas ui-catalog` command: 0 it worked (a refresh is complete, every bundle is valid), 1 the
 * answer is no (incomplete, failed or unknown; an invalid or missing bundle; a server that could not be reached), 2 the
 * command was wrong (thrown, and turned into a message by the caller).
 *
 * @see docs/ui-catalog.md#a-ci-kit-plan-capture-finalize
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { UiBundleManifest } from '../../schema/src/ui-catalog-bundle';
import type { UiRefreshStatus } from '../../schema/src/ui-catalog-refresh';
import { value, values, writeStoreOf } from './cli-stores';
import { AtlasHttpError, type HttpStore } from './http-store';
import { detectOrigin, parseTime, type ReportIo } from './report-cli';
import { captureJournal, findBundles, importBundle, mergeBundles, validateBundle, type BundleValidation, type CatalogJournal } from './ui-catalog-bundle';
import { planMatrix } from './ui-catalog-ci';
import type { CollectOptions } from './ui-catalog-collect';
import { CatalogDefinitionError, checkWhere, parseWhere, resolveCatalog, type CatalogDefinition } from './ui-catalog-definition';
import { beginRefresh, finalizeRefresh, joinRefresh, refreshStatus } from './ui-catalog-refresh';

type Env = Readonly<Record<string, string | undefined>>;

/** The synopsis lines of the kit commands, for `atlas ui-catalog --help`. */
export const UI_CATALOG_KIT_SYNOPSIS = `  atlas ui-catalog plan-matrix --catalog <atlas.catalog.ts> [--job-dimension <name>]... [--build-dimension <name>]...
                           [--where dimension=value]... [--max-parallel <n>] [--max-jobs <n>] [--out <plan.json>]
  atlas ui-catalog refresh begin --id <id> --catalog <atlas.catalog.ts> [--store https://…] [--where dimension=value]...
                           [--stale-before <iso|ms>] [--sha <s>] [--branch <b>] [--require-source] [--collection <id>]
                           [--participant <name>]... [--participants-from <plan.json>]
  atlas ui-catalog refresh status|finalize --id <id> [--store https://…] [--attempt <n>]
  atlas ui-catalog bundle validate <dir>... [--definition <version>] [--sha <s>]
  atlas ui-catalog bundle merge <dir>... --out <dir> [--expect <participant>]... [--expect-from <plan.json>]
  atlas ui-catalog bundle import <dir>... [--store <dir|s3://…|https://…>] [--reconcile retain|accept] [--plans|--no-plans]`;

/** The explanation of the kit commands and `collect`'s kit flags, for `atlas ui-catalog --help`. */
export const UI_CATALOG_KIT_HELP = `  collect --refresh <id> [--participant <name>] [--attempt <n>] [--journal <dir>]
            --refresh joins a refresh (atlas ui-catalog refresh begin) as <participant>#<attempt> (defaults: --shard or
            GITHUB_JOB, and GITHUB_RUN_ATTEMPT or 1) and collects under its collection, cutoff, scope and source.
            --journal writes every capture layer into a bundle folder before publishing it, with whether the publish
            succeeded: what was captured survives a server that stops answering. Upload the folder as a CI artifact.
  plan-matrix  Print a CI fan-out for the definition: a job per distinct combination of the --job-dimension values
            (default every dimension: a job per profile), covering every allowed profile once, and each distinct
            --build-dimension combination once as a build (build dimensions also split jobs). Each job has "job" (safe for
            artifact names), "where" (the --where flags for collect, shell-quoted) and "build". --max-parallel (default 4)
            is copied, never raised; more jobs than --max-jobs (default 256) is exit 2, never trimmed. --out writes the plan.
  refresh   begin pins a refresh on the server: the definition (published first), the source (--sha/--branch, default the
            checkout; --require-source counts only evidence at that commit), the scope (--where), the cutoff (--stale-before,
            default now: only evidence recorded since counts) and the collection its shards claim under (default the id).
            Beginning it again with the same values joins it. --participant names jobs expected to join (or every job of
            --participants-from), only to name one that never started. status judges it; finalize judges it and records
            the finalization. Exit 0 only when complete; incomplete names each outstanding unit and why (held by a live
            claim, pending, failed, stale, at another commit, out of retries); unknown when the server, the receipt or a
            backend cannot be read. Worker health (missing participants, lost claims) is reported apart.
  bundle    validate checks bundles without trusting them: every object's size and SHA-256, no path outside the bundle,
            every layer present, the definition and commit (--definition, --sha). merge joins bundles (or folders holding
            them) in any order into --out: every attempt and capture stays named; different definitions, commits or
            refreshes are refused; --expect names jobs whose bundle must be there. import copies valid bundles' layers into
            a store. A capture whose publish never succeeded answers a claim that has ended, so it is retained (listed,
            not imported) unless --reconcile accept. Plans are imported unless the store is a server (--plans to force).
            export --store <bundle>/store renders a bundle offline.`;

const BOOLEAN = new Set(['--json', '--require-source', '--plans', '--no-plans']);

/** The arguments that are not flags or flag values. */
function positionals(rest: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith('--')) { if (!BOOLEAN.has(token)) i++; continue; }
    out.push(token);
  }
  return out;
}

async function loadCatalog(file: string | undefined, base: string): Promise<Awaited<ReturnType<typeof resolveCatalog>>> {
  if (!file) throw new Error('give --catalog <atlas.catalog.ts>: a module whose default export is a defineCatalog(...) definition');
  let loaded: { default?: unknown; catalog?: unknown };
  try { loaded = await import(pathToFileURL(path.resolve(base, file)).href) as typeof loaded; }
  catch (error) { throw new Error(`Cannot load ${file}: ${error instanceof Error ? error.message : String(error)}`); }
  const definition = (loaded.default ?? loaded.catalog) as CatalogDefinition | undefined;
  if (!definition || typeof definition !== 'object') throw new Error(`${file} has no default export: export default defineCatalog({ name, matrix, states })`);
  try { return await resolveCatalog(definition); } catch (error) {
    if (error instanceof CatalogDefinitionError) throw new Error(error.message);
    throw error;
  }
}

function serverOf(rest: readonly string[], base: string, env: Env, command: string): { server: HttpStore; label: string } {
  const target = writeStoreOf(value(rest, 'store'), base, env);
  if (!target.server) throw new Error(`${command} needs an Atlas server (--store https://… or ATLAS_STORE), not ${target.label}: refreshes are kept beside the queue`);
  return { server: target.server, label: target.label };
}

async function participantsFrom(rest: readonly string[], base: string): Promise<string[]> {
  const names = [...values(rest, 'participant'), ...values(rest, 'expect')];
  const file = value(rest, 'participants-from') ?? value(rest, 'expect-from');
  if (file) {
    let plan: { participants?: unknown };
    try { plan = JSON.parse(await readFile(path.resolve(base, file), 'utf8')) as typeof plan; } catch { throw new Error(`Cannot read ${file} as a plan-matrix document`); }
    if (!Array.isArray(plan.participants) || !plan.participants.every(item => typeof item === 'string')) throw new Error(`${file} has no "participants" list: write it with atlas ui-catalog plan-matrix --out`);
    names.push(...plan.participants as string[]);
  }
  return [...new Set(names)];
}

function idOf(rest: readonly string[], env: Env): string {
  const id = value(rest, 'id') ?? env.GITHUB_RUN_ID;
  if (!id) throw new Error('give --id <refresh id> (in GitHub Actions it defaults to GITHUB_RUN_ID)');
  return id;
}

function summarize(validation: BundleValidation) {
  const manifest: UiBundleManifest | null = validation.manifest;
  const count = (publication: string) => manifest?.captures.filter(capture => capture.publication === publication).length ?? 0;
  return {
    bundle: validation.bundle, valid: validation.valid, definition: manifest?.definition?.version ?? null, refresh: manifest?.refresh ?? null, sha: manifest?.source.sha ?? null,
    attempts: (manifest?.attempts ?? []).map(item => ({ participant: item.participant, attempt: item.attempt, shard: item.shard })),
    captures: { total: manifest?.captures.length ?? 0, published: count('published'), failed: count('failed'), pending: count('pending') },
    problems: [...validation.problems]
  };
}

function printStatus(io: ReportIo, status: UiRefreshStatus): void {
  io.out(`Refresh ${status.refresh?.id ?? ''}: ${status.outcome} — ${status.capture.satisfied} of ${status.capture.units} units satisfied\n`);
  for (const reason of status.reasons) io.out(`  ${reason}\n`);
  for (const entry of status.outstanding.slice(0, 20)) io.out(`! ${entry.reason.padEnd(9)} ${entry.unit}${entry.shard ? ` (held by ${entry.shard})` : ''}${entry.attempts ? ` after ${entry.attempts} failed attempts` : ''}\n`);
  if (status.outstanding.length > 20) io.out(`! … and ${status.outstanding.length - 20} more (use --format json)\n`);
  io.out(`Workers: ${status.health.status}${status.health.missing.length ? `; never joined: ${status.health.missing.join(', ')}` : ''}${status.health.lost.length ? `; lost: ${status.health.lost.join(', ')}` : ''}\n`);
}

/**
 * `atlas ui-catalog plan-matrix | refresh … | bundle …`. Returns the exit code; throws on a mistake in the command (exit 2).
 *
 * @example
 * ```ts
 * const code = await uiCatalogKitMain('refresh', ['finalize', '--id', runId, '--store', url], { base, env, json: true, io });
 * ```
 */
export async function uiCatalogKitMain(command: string, rest: readonly string[], context: { readonly base: string; readonly env: Env; readonly json: boolean; readonly io: ReportIo }): Promise<number> {
  const { base, env, json, io } = context;
  const print = (document: unknown) => io.out(`${JSON.stringify(document, null, 2)}\n`);

  if (command === 'plan-matrix') {
    const resolved = await loadCatalog(value(rest, 'catalog'), base);
    const number = (name: string) => {
      const given = value(rest, name);
      if (given === undefined) return undefined;
      const parsed = Number(given);
      if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`--${name} takes a positive whole number (got "${given}")`);
      return parsed;
    };
    let plan;
    try {
      const where = parseWhere(values(rest, 'where'));
      plan = planMatrix(resolved, {
        ...(values(rest, 'job-dimension').length ? { jobDimensions: values(rest, 'job-dimension') } : {}), buildDimensions: values(rest, 'build-dimension'),
        ...(Object.keys(where).length ? { where } : {}), ...(number('max-parallel') !== undefined ? { maxParallel: number('max-parallel')! } : {}), ...(number('max-jobs') !== undefined ? { maxJobs: number('max-jobs')! } : {})
      });
    } catch (error) {
      if (error instanceof CatalogDefinitionError) throw new Error(error.message);
      throw error;
    }
    const out = value(rest, 'out');
    if (out) await writeFile(path.resolve(base, out), `${JSON.stringify(plan, null, 2)}\n`);
    if (json) print(plan);
    else {
      io.out(`Plan for ${plan.definition.name} (${plan.definition.version.slice(0, 12)}): ${plan.jobs} job${plan.jobs === 1 ? '' : 's'} over ${plan.profiles} profiles (${plan.items} items), ${plan.builds.include.length} build${plan.builds.include.length === 1 ? '' : 's'}, at most ${plan.maxParallel} at once\n`);
      for (const job of plan.matrix.include) io.out(`  ${job.job}${job.build ? ` [build ${job.build}]` : ''}: ${job.profiles} profiles  ${job.where}\n`);
      if (out) io.out(`Wrote ${out}\n`);
    }
    return 0;
  }

  if (command === 'refresh') {
    const [action] = positionals(rest);
    if (action === 'begin') {
      const id = idOf(rest, env);
      const resolved = await loadCatalog(value(rest, 'catalog'), base);
      const where = parseWhere(values(rest, 'where'));
      try { if (Object.keys(where).length) checkWhere(resolved.document, where); } catch (error) { throw new Error(error instanceof Error ? error.message : String(error)); }
      const { server, label } = serverOf(rest, base, env, 'refresh begin');
      const origin = detectOrigin(env, io.git);
      const participants = await participantsFrom(rest, base);
      const staleBeforeMs = parseTime(value(rest, 'stale-before'), '--stale-before');
      let document;
      try {
        const begun = await beginRefresh(server, {
          id, catalog: resolved, ...(Object.keys(where).length ? { where } : {}), ...(staleBeforeMs !== null ? { staleBeforeMs } : {}),
          ...(value(rest, 'collection') ? { collection: value(rest, 'collection')! } : {}), ...(participants.length ? { participants } : {}),
          source: { sha: value(rest, 'sha') ?? origin.sha, branch: value(rest, 'branch') ?? origin.branch, ...(rest.includes('--require-source') ? { require: true } : {}) }
        });
        document = { ok: true, store: label, created: begun.created, definition: begun.definition, refresh: begun.receipt };
      } catch (error) {
        if (!(error instanceof AtlasHttpError)) throw error;
        document = { ok: false, store: label, created: false, definition: { version: resolved.version, name: resolved.document.name }, refresh: null, error: error.message };
      }
      if (json) print(document);
      else if (document.ok) io.out(`${document.created ? 'Began' : 'Joined'} refresh ${id} of ${resolved.document.name} (${resolved.version.slice(0, 12)}): evidence counts from ${new Date(document.refresh!.staleBeforeMs).toISOString()}, collection ${document.refresh!.collection}\n`);
      else io.out(`! ${document.error}\n`);
      return document.ok ? 0 : 1;
    }
    if (action === 'status' || action === 'finalize') {
      const id = idOf(rest, env);
      const { server, label } = serverOf(rest, base, env, `refresh ${action}`);
      const attempt = value(rest, 'attempt') ?? env.GITHUB_RUN_ATTEMPT;
      const status = action === 'status' ? await refreshStatus(server, id) : await finalizeRefresh(server, id, attempt ? { attempt } : {});
      if (json) print({ ...status, store: label });
      else printStatus(io, status);
      return status.ok ? 0 : 1;
    }
    throw new Error('refresh takes begin, status or finalize');
  }

  if (command === 'bundle') {
    const [action, ...given] = positionals(rest);
    if (!['validate', 'merge', 'import'].includes(action ?? '')) throw new Error('bundle takes validate, merge or import');
    if (!given.length) throw new Error(`bundle ${action} needs one or more bundle folders (or folders holding them)`);
    const dirs = await findBundles(given.map(item => path.resolve(base, item)));
    const expect = { ...(value(rest, 'definition') ? { definition: value(rest, 'definition')! } : {}), ...(value(rest, 'sha') ? { sha: value(rest, 'sha')! } : {}) };
    if (action === 'validate') {
      const checked = await Promise.all(dirs.map(dir => validateBundle(dir, expect)));
      const problems = checked.flatMap(item => item.problems);
      const document = { ok: dirs.length > 0 && problems.length === 0, command: 'validate' as const, bundles: checked.map(summarize), problems, out: null, missing: [] };
      if (!dirs.length) document.problems.push({ code: 'manifest', bundle: given.join(', '), message: 'No bundle was found' });
      if (json) print(document);
      else {
        for (const item of document.bundles) io.out(`${item.valid ? 'valid  ' : 'INVALID'} ${item.bundle}: ${item.captures.total} captures (${item.captures.published} published, ${item.captures.failed} failed to publish, ${item.captures.pending} pending)\n`);
        for (const problem of document.problems) io.out(`! ${problem.code}: ${problem.message}\n`);
      }
      return document.ok ? 0 : 1;
    }
    if (action === 'merge') {
      const out = value(rest, 'out');
      if (!out) throw new Error('bundle merge needs --out <dir>');
      const merged = await mergeBundles(dirs, path.resolve(base, out), { ...expect, expect: await participantsFrom(rest, base) });
      const document = { ok: merged.ok, command: 'merge' as const, bundles: merged.bundles.map(summarize), problems: [...merged.problems], out: merged.out, missing: [...merged.missing],
        merged: merged.manifest ? summarize({ bundle: merged.out, valid: true, manifest: merged.manifest, problems: [] }) : null };
      if (json) print(document);
      else {
        if (document.merged) io.out(`Merged ${dirs.length} bundle${dirs.length === 1 ? '' : 's'} into ${out}: ${document.merged.attempts.length} attempts, ${document.merged.captures.total} captures (${document.merged.captures.published} published, ${document.merged.captures.failed} failed to publish, ${document.merged.captures.pending} pending)\n`);
        for (const problem of document.problems) io.out(`! ${problem.code}: ${problem.message}\n`);
        if (document.missing.length) io.out(`! No bundle arrived from: ${document.missing.join(', ')}\n`);
      }
      return document.ok ? 0 : 1;
    }
    const target = writeStoreOf(value(rest, 'store'), base, env);
    const reconcile = value(rest, 'reconcile') ?? 'retain';
    if (reconcile !== 'retain' && reconcile !== 'accept') throw new Error(`--reconcile takes retain|accept (got "${reconcile}")`);
    const plans = rest.includes('--plans') ? true : rest.includes('--no-plans') ? false : !target.server;
    const results = [];
    for (const dir of dirs) results.push(await importBundle(dir, target.store, { ...expect, reconcile, plans }));
    const document = {
      ok: dirs.length > 0 && results.every(item => item.ok), command: 'import' as const, store: target.label, bundles: results.map(item => summarize(item.bundle)), problems: results.flatMap(item => [...item.bundle.problems]), out: null, missing: [],
      imported: { layers: results.reduce((sum, item) => sum + item.layers, 0), copied: results.reduce((sum, item) => sum + item.copied, 0), skipped: results.reduce((sum, item) => sum + item.skipped, 0),
        retained: results.flatMap(item => item.retained.map(capture => ({ layer: capture.layer, shard: capture.shard, attempt: capture.attempt, claimId: capture.claimId, publication: capture.publication }))) }
    };
    if (!dirs.length) document.problems.push({ code: 'manifest', bundle: given.join(', '), message: 'No bundle was found' });
    if (json) print(document);
    else {
      io.out(`Imported ${document.imported.layers} layers into ${target.label} (${document.imported.copied} objects copied, ${document.imported.skipped} already there)\n`);
      if (document.imported.retained.length) io.out(`  ${document.imported.retained.length} captures never reached the server and were retained, not imported (--reconcile accept imports them)\n`);
      for (const problem of document.problems) io.out(`! ${problem.code}: ${problem.message}\n`);
    }
    return document.ok ? 0 : 1;
  }
  throw new Error(`Unknown ui-catalog command ${command}`);
}

/** What `collect` adds for `--refresh` and `--journal`: the options its `collectCatalog` call takes, the shard id, and a summary for its result. */
export type CollectKit = {
  readonly shard: string | null;
  readonly options: Pick<CollectOptions, 'collection' | 'staleBeforeMs' | 'journal'> & { readonly where?: Readonly<Record<string, string | readonly string[]>> };
  readonly origin: { readonly sha: string | null; readonly branch: string | null } | null;
  readonly summary: () => { readonly refresh?: { readonly id: string; readonly shard: string }; readonly journal?: { readonly dir: string; readonly captures: number; readonly published: number; readonly failed: number; readonly pending: number } };
};

/**
 * Join a refresh (`--refresh`) and open a journal (`--journal`) for `collect`. Throws a usage error for `--collection` or
 * `--stale-before` given with `--refresh` (the refresh decides them), and an `AtlasHttpError` when the refresh cannot be joined.
 */
export async function collectKit(rest: readonly string[], context: { readonly base: string; readonly env: Env; readonly server: HttpStore; readonly shard: string; readonly where: Readonly<Record<string, readonly string[]>> }): Promise<CollectKit> {
  const refresh = value(rest, 'refresh');
  const journalDir = value(rest, 'journal');
  const participant = value(rest, 'participant') ?? value(rest, 'shard') ?? context.env.GITHUB_JOB ?? context.shard;
  const attempt = value(rest, 'attempt') ?? context.env.GITHUB_RUN_ATTEMPT ?? '1';
  let options: CollectKit['options'] = {};
  let shard: string | null = null;
  let origin: CollectKit['origin'] = null;
  let collection: string | null = null;
  if (refresh) {
    if (value(rest, 'collection') !== undefined || value(rest, 'stale-before') !== undefined) throw new Error('--refresh decides the collection and the cutoff: leave out --collection and --stale-before');
    const joined = await joinRefresh(context.server, refresh, { participant, attempt, ...(Object.keys(context.where).length ? { where: context.where } : {}) });
    shard = joined.collect.shard.id;
    collection = joined.collect.collection;
    origin = joined.collect.origin;
    options = { collection: joined.collect.collection, staleBeforeMs: joined.collect.staleBeforeMs, ...(joined.collect.shard.where ? { where: joined.collect.shard.where } : {}) };
  }
  let journal: CatalogJournal | undefined;
  if (journalDir) {
    const id = shard ?? context.shard;
    journal = captureJournal(path.resolve(context.base, journalDir), { shard: id, participant: refresh ? participant : value(rest, 'participant') ?? id, attempt, refresh: refresh ?? null, collection, ...(origin ? { source: origin } : {}) });
    options = { ...options, journal };
  }
  return {
    shard, options, origin,
    summary: () => {
      const manifest = journal?.manifest();
      const count = (publication: string) => manifest?.captures.filter(capture => capture.publication === publication).length ?? 0;
      return {
        ...(refresh && shard ? { refresh: { id: refresh, shard } } : {}),
        ...(journal && manifest ? { journal: { dir: journal.dir, captures: manifest.captures.length, published: count('published'), failed: count('failed'), pending: count('pending') } } : {})
      };
    }
  };
}

