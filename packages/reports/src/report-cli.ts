import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { combineBackends, type BackendInput } from './compose';
import { loadDirectoryOutline } from './directory-outline';
import { copyStore } from './copy-store';
import { directoryStore } from './directory-store';
import { checksFromCtrf, checksFromJunit, checksFromManifest, type IngestedChecks } from './ingest';
import { publishChecks } from './publish-checks';
import { linkChecksToSpecs } from './spec-link';
import { formatStatusMarkdown, formatStatusText, reportStatus } from './report-status';
import { PublishChecksSchema } from '../../schema/src/layer';
import { parseWith } from './parse-with';

export const REPORT_USAGE = `atlas report — layered evidence for any kind of spec

  atlas report publish --store <dir> [--producer <name>]
                       ( --ctrf <file> | --junit <file> | --manifest <file> | --checks <file.json> )
                       [--environment <name>] [--branch <b>] [--sha <s>] [--run-url <u>]
                       [--spec <path> | --specs <dir>]
                       [--param key=value]... [--kind <k>] [--title <t>] [--recorded-at <iso|ms>]
  atlas report status  ( --store <dir> | --store <id>=<dir> | --backends <module> )...
                       [--specs <dir>] [--format text|json|markdown]
                       [--require-environments a,b] [--require-all-specs]
  atlas report merge   ( --store <dir> | --backends <module> )... --into <dir>

  publish   Write one immutable layer: the checks of one producer, on one environment. Safe to repeat.
            --producer is required, unless the --checks file names one
            --spec <path>   every check in the report belongs to this spec (a report per feature file)
            --specs <dir>   link checks to the spec files in <dir> by path, or by the suite, class or
                            file name the report gives (a Cucumber suite is named after its feature)
  status    Combine every layer of every store, and exit 1 unless the report passes.
            --specs <dir>          lay the results over these spec files, so specs with no results show
            --require-all-specs    fail while any spec has no results
  merge     Copy the layers of several stores into one. Stores are directories; --backends loads others.

  --backends <module>  A TypeScript or JavaScript module whose default export is a list of
                       { id, label?, store } (or a function returning it): S3, a device lab, anything
                       that implements ObjectStore.
`;

type Env = Readonly<Record<string, string | undefined>>;
type Git = (args: readonly string[]) => string | null;

function gitOutput(args: readonly string[]): string | null {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

/** Where the checks ran, from the CI's own variables and then git. Explicit flags win over both. */
export function detectOrigin(env: Env, git: Git = gitOutput): { sha: string | null; branch: string | null; runUrl: string | null } {
  const first = (...names: string[]) => names.map(name => env[name]).find(value => value) ?? null;
  const runUrl = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : first('CI_PIPELINE_URL', 'BUILDKITE_BUILD_URL', 'CIRCLE_BUILD_URL');
  return {
    sha: first('GITHUB_SHA', 'CI_COMMIT_SHA', 'BUILDKITE_COMMIT', 'CIRCLE_SHA1') ?? git(['rev-parse', 'HEAD']),
    branch: first('GITHUB_HEAD_REF', 'GITHUB_REF_NAME', 'CI_COMMIT_REF_NAME', 'BUILDKITE_BRANCH', 'CIRCLE_BRANCH') ?? git(['branch', '--show-current']),
    runUrl
  };
}

function values(argv: readonly string[], name: string): string[] {
  return argv.flatMap((token, i) => (token === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));
}
function value(argv: readonly string[], name: string): string | undefined {
  return values(argv, name)[0];
}

function parseTime(text: string | undefined): number | null {
  if (text === undefined) return null;
  const numeric = Number(text);
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(text);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--recorded-at takes an ISO date or epoch milliseconds (got "${text}")`);
  return parsed;
}

async function backendsOf(argv: readonly string[], base: string): Promise<BackendInput[]> {
  const backends: BackendInput[] = [];
  const used = new Set<string>();
  values(argv, 'store').forEach((spec, index) => {
    const named = /^([a-z0-9-]+)=(.+)$/.exec(spec);
    const directory = path.resolve(base, named ? named[2]! : spec);
    // A mistyped path must not read as an empty store: that would hide the layers it was meant to add.
    if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Error(`Store directory not found: ${named ? named[2] : spec}. If a node failed to publish or upload, fix that first`);
    const id = named ? named[1]! : `store-${index + 1}`;
    if (used.has(id)) throw new Error(`Two stores are named "${id}"`);
    used.add(id);
    backends.push({ id, label: named ? id : path.basename(directory), store: directoryStore(directory) });
  });
  for (const file of values(argv, 'backends')) {
    const mod = (await import(pathToFileURL(path.resolve(base, file)).href)) as { default?: BackendInput[] | (() => BackendInput[] | Promise<BackendInput[]>) };
    if (!mod.default) throw new Error(`${file} has no default export: a list of { id, label?, store }`);
    for (const backend of typeof mod.default === 'function' ? await mod.default() : mod.default) {
      if (used.has(backend.id)) throw new Error(`Two stores are named "${backend.id}"`);
      used.add(backend.id);
      backends.push(backend);
    }
  }
  if (!backends.length) throw new Error('Give at least one --store <dir> or --backends <module>');
  return backends;
}

function ingest(argv: readonly string[], base: string): { ingested: IngestedChecks; extra: Record<string, unknown>; modifiedAtMs: number } {
  const read = (file: string) => readFileSync(path.resolve(base, file), 'utf8');
  const sources = ['ctrf', 'junit', 'manifest', 'checks'].filter(name => value(argv, name) !== undefined);
  if (sources.length !== 1) throw new Error('Give exactly one of --ctrf, --junit, --manifest or --checks');
  const [source] = sources;
  const file = value(argv, source!)!;
  // When the report does not say when it ran, the file does: the same file is the same time.
  const modifiedAtMs = Math.floor(statSync(path.resolve(base, file)).mtimeMs);
  if (source === 'junit') return { ingested: checksFromJunit(read(file)), extra: {}, modifiedAtMs };
  const json = JSON.parse(read(file)) as unknown;
  if (source === 'ctrf') return { ingested: checksFromCtrf(json), extra: {}, modifiedAtMs };
  if (source === 'manifest') return { ingested: checksFromManifest(json), extra: {}, modifiedAtMs };
  const given = parseWith(PublishChecksSchema.partial({ producer: true, recordedAtMs: true }), json, file);
  return { ingested: { checks: given.checks, recordedAtMs: given.recordedAtMs ?? null, tool: null }, extra: given, modifiedAtMs };
}

/**
 * `atlas report …` for a terminal: a mistake in the command or a path is a message on stderr and exit
 * code 2, so a CI job can tell a broken invocation (2) from a report that does not pass (1).
 */
export async function runReportCommand(argv: readonly string[]): Promise<number> {
  try {
    return await reportMain(argv);
  } catch (error) {
    process.stderr.write(`atlas report: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

/** `atlas report …`. Returns the exit code: 0 passes, 1 does not. Throws on a mistake in the command (see {@link runReportCommand}). */
export async function reportMain(argv: readonly string[], io: { readonly out: (text: string) => void; readonly env?: Env; readonly cwd?: string; readonly git?: Git } = { out: text => process.stdout.write(text) }): Promise<number> {
  const [command, ...rest] = argv;
  const base = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;

  if (command === 'publish') {
    const store = value(rest, 'store');
    if (!store) throw new Error('publish needs --store <dir>');
    const { ingested, extra, modifiedAtMs } = ingest(rest, base);
    const origin = detectOrigin(env, io.git);
    const producer = value(rest, 'producer') ?? (extra.producer as string | undefined);
    if (!producer) throw new Error('publish needs --producer <name>: a stable name for this suite, such as "web-e2e" or "gherkin"');
    const recordedAtMs = parseTime(value(rest, 'recorded-at')) ?? (extra.recordedAtMs as number | undefined) ?? ingested.recordedAtMs ?? modifiedAtMs;
    const parameters = Object.fromEntries(values(rest, 'param').map(pair => {
      const at = pair.indexOf('=');
      if (at < 1) throw new Error(`--param takes key=value (got "${pair}")`);
      return [pair.slice(0, at), pair.slice(at + 1)];
    }));
    const linked = await linkChecksToSpecs(ingested, { base, ...(value(rest, 'specs') ? { specsDirectory: value(rest, 'specs')! } : {}), ...(value(rest, 'spec') ? { spec: value(rest, 'spec')! } : {}) });
    const given = (extra.specs as { path: string }[] | undefined) ?? [];
    const layer = await publishChecks(directoryStore(path.resolve(base, store)), {
      ...extra,
      producer,
      checks: linked.checks as never,
      specs: [...given, ...linked.specs.filter(entry => !given.some(other => other.path === entry.path))] as never,
      recordedAtMs,
      kind: value(rest, 'kind') ?? (extra.kind as string | undefined) ?? 'checks',
      ...(value(rest, 'title') ?? extra.title ? { title: (value(rest, 'title') ?? extra.title) as string } : {}),
      sha: value(rest, 'sha') ?? (extra.sha as string | null | undefined) ?? origin.sha,
      branch: value(rest, 'branch') ?? (extra.branch as string | null | undefined) ?? origin.branch,
      runUrl: value(rest, 'run-url') ?? (extra.runUrl as string | null | undefined) ?? origin.runUrl,
      ...(value(rest, 'environment') ?? extra.environment ? { environment: (value(rest, 'environment') ?? extra.environment) as string } : {}),
      parameters: { ...((extra.parameters as Record<string, string> | undefined) ?? {}), ...parameters }
    });
    const counts = { passed: 0, failed: 0, other: 0 };
    for (const check of ingested.checks) counts[check.status === 'passed' ? 'passed' : check.status === 'failed' ? 'failed' : 'other'] += 1;
    const linkedCount = linked.checks.filter(check => check.specPath).length;
    const hint = linkedCount < linked.checks.length && !value(rest, 'spec') && !value(rest, 'specs') ? ' (pass --specs <dir> or --spec <path> to link checks to their specs)' : '';
    io.out(`Published layer ${layer.id.slice(0, 12)}: ${ingested.checks.length} checks (${counts.passed} passed, ${counts.failed} failed, ${counts.other} not run) as "${producer}"${layer.environment ? ` on ${layer.environment}` : ''}; ${linkedCount} of ${linked.checks.length} linked to a spec${hint}\n`);
    return 0;
  }

  if (command === 'status') {
    const format = value(rest, 'format') ?? 'text';
    if (!['text', 'json', 'markdown'].includes(format)) throw new Error(`--format takes text|json|markdown (got "${format}")`);
    const specsDirectory = value(rest, 'specs');
    if (rest.includes('--require-all-specs') && !specsDirectory) throw new Error('--require-all-specs needs --specs <dir>: Atlas has to know which specs to expect');
    const outline = specsDirectory ? await loadDirectoryOutline(path.resolve(base, specsDirectory), { repoRoot: base }) : undefined;
    const report = await combineBackends(await backendsOf(rest, base), outline ? { outline } : {});
    const status = reportStatus(report, {
      requireEnvironments: (value(rest, 'require-environments') ?? '').split(',').map(name => name.trim()).filter(Boolean),
      requireAllSpecs: rest.includes('--require-all-specs')
    });
    io.out(format === 'json' ? `${JSON.stringify(status, null, 2)}\n` : format === 'markdown' ? formatStatusMarkdown(status) : formatStatusText(status));
    return status.ok ? 0 : 1;
  }

  if (command === 'merge') {
    const into = value(rest, 'into');
    if (!into) throw new Error('merge needs --into <dir>');
    const target = path.resolve(base, into);
    mkdirSync(target, { recursive: true });
    const destination = directoryStore(target);
    let copied = 0, skipped = 0, ignored = 0;
    for (const backend of await backendsOf(rest, base)) {
      const result = await copyStore(backend.store, destination);
      copied += result.copied;
      skipped += result.skipped;
      ignored += result.ignored;
    }
    io.out(`Merged into ${into}: ${copied} objects copied, ${skipped} already there${ignored ? `; ${ignored} objects outside layers/ were not copied (only layers are merged)` : ''}\n`);
    return 0;
  }

  io.out(REPORT_USAGE);
  return command && command !== '--help' && command !== '-h' ? 2 : 0;
}
