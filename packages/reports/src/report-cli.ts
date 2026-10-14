/**
 * @module The `atlas report` command
 *
 * `reportMain` is `atlas report publish | stream | status | merge | doctor | policy`, written so it can be called from code and
 * tests as well as a terminal: it takes its arguments, environment, working directory, clock, git and standard input as
 * parameters and returns the exit code. Every command can print a JSON document (`--format json`) instead of prose, and a
 * command that is wrong throws, which `runReportCommand` turns into a message (or a JSON error) and exit code 2.
 *
 * Exit codes: 0 it worked, 1 it ran and the answer is no (a report that does not pass, a store that needs attention, checks
 * that could not be sent), 2 the command itself was wrong.
 *
 * @see docs/integrating.md
 * @see docs/agents.md
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PublishChecksSchema, ReportStatusSchema } from '../../schema/src/layer';
import type { HttpStore } from './http-store';
import { readAttachmentFiles } from './attachment-files';
import { backendsOf, layerFilter, value, values, writeStoreOf } from './cli-stores';
import { combineBackends } from './compose';
import { copyStore } from './copy-store';
import { loadDirectoryOutline } from './directory-outline';
import { iamPolicy, inspectStore, type Check, type Role } from './doctor';
import { checksFromCtrf, checksFromJunit, checksFromManifest, type IngestedChecks } from './ingest';
import { parseWith } from './parse-with';
import { publishChecks } from './publish-checks';
import { createReporter } from './reporter';
import { formatStatusMarkdown, formatStatusText, reportStatus } from './report-status';
import { publishRunBundle } from './run-bundle';
import { collectSpecFiles, latestSpecSet, publishSpecSet } from './spec-set';
import { linkChecksToSpecs } from './spec-link';
import { openStore, storeSpecs } from './store-url';

/** The text `atlas report --help` prints: every subcommand, its flags, what each does and the exit codes. Also the source of the command reference in `docs/reference/cli.md`. */
export const REPORT_USAGE = `atlas report — layered evidence for any kind of spec

  atlas report publish [--store <dir|s3://bucket/prefix>] [--producer <name>]
                       ( --ctrf <file> | --junit <file> | --manifest <file> | --checks <file.json> )
                       [--environment <name>] [--branch <b>] [--sha <s>] [--run-url <u>]
                       [--spec <path> | --specs <dir>] [--upload-run]
                       [--param key=value]... [--kind <k>] [--title <t>] [--recorded-at <iso|ms>]
                       [--attach [role=]<file>]... [--label key=value]... [--link [name=]<url>]...
                       [--attach-root <dir>]... [--max-attachment-mb <n>] [--max-total-attachment-mb <n>]
  atlas report stream  [--store <dir|s3://…|https://atlas.example.com>] --producer <name> [--environment <name>]
                       [--branch <b>] [--sha <s>] [--run-url <u>] [--kind <k>] [--param key=value]...
                       [--flush-ms 1000] [--batch 100]       (checks as JSON lines on standard input)
  atlas report status  [--store <dir|s3://…|id=url>]... [--backends <module>]
                       [--specs <dir>] [--format text|json|markdown]
                       [--require-environments a,b] [--require-all-specs]
                       [--branch <name>]... [--ignore-modified]
  atlas report merge   [--store …]... [--backends <module>] --into <dir|s3://…>
  atlas report doctor  [--store …]... [--role publisher|reader|both]
  atlas report policy  --store s3://bucket/prefix [--role publisher|reader|both]

  A store is a directory or s3://bucket/prefix (add ?region=…&endpoint=… for R2, MinIO and the
  rest). When no --store is given, ATLAS_STORE is used. Keys never go in the URL: set
  AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or sign in with \`aws sso login\`, or use a role.

  publish   Write one immutable layer: the checks of one producer, on one environment. Safe to repeat.
            --producer is required, unless the --checks file names one
            --spec <path>   every check in the report belongs to this spec (a report per feature file)
            --specs <dir>   link checks to the spec files in <dir> by path, or by the suite, class or
                            file name the report gives; also publishes the specs themselves, so the
                            node can show them without a checkout
            --upload-run    with --manifest: also upload the run's screenshots and clips for the viewer
            --attach <file>   attach a file to the whole layer: a CI log, a coverage report, a trace archive
                              (screenshots, videos and traces of a single test go in its CTRF or checks file)
            --label k=v       a fact about the run, not part of what it checks: build, os, browser
            --link [n=]<url>  a link to the run, a dashboard, an issue
            Files a report names (CTRF attachments, JUnit [[ATTACHMENT|path]] lines) come from the report's own
            folder and each --attach-root, and never from a hidden file or a link out: a report is data from a
            test run, not instructions. One that is missing or not allowed is skipped with a warning.
            From a checkout with uncommitted changes the layer is marked "modified".
  stream    Send checks as they finish: one JSON object per line on standard input (the fields of one
            check: id, title, status, and any evidence). Each second's worth becomes one layer, so a server
            shows the run while it is still going. A check sent again with the same id (running, then
            passed) is replaced by the later. Ends when the input does; exit 1 if anything could not be sent.
            Point it at an Atlas server with --store https://… and a token in ATLAS_TOKEN.
  status    Combine every layer of every store, and exit 1 unless the report passes.
            --specs <dir>          lay the results over these spec files (default: the specs in the store)
            --require-all-specs    fail while any spec has no results
            --branch <name>        only layers recorded on this branch (repeatable)
            --ignore-modified      leave out layers from modified checkouts and unknown origins
  merge     Copy the layers of several stores into one.
  doctor    Check that a store works: credentials, listing, writing, and what it holds.
  policy    Print the least-privilege IAM policy for publishers, readers, or both.

  --backends <module>  A TypeScript or JavaScript module whose default export is a list of
                       { id, label?, store } (or a function returning it): a device lab, anything
                       that implements ObjectStore.

  --format json (alias --json)   publish, stream, merge, doctor and status print one JSON document instead of prose
                       (schemas: publish-result, stream-result, merge-result, doctor-result, report-status). A command
                       that is wrong is {"ok":false,"error":{"message":…,"code":"usage"}} on standard error.
  A store may be an Atlas server (https://…): ATLAS_STORE=https://atlas.example.com, with ATLAS_TOKEN.

  Exit codes: 0 ok, 1 the report does not pass (or a check failed), 2 the command was wrong.
`;

type Env = Readonly<Record<string, string | undefined>>;
type Git = (args: readonly string[]) => string | null;
/** What `reportMain` is given besides arguments: where output goes (`out`), and, for tests and embedding, the environment, working directory, git, clock and standard input (`stdin`, where `stream` reads checks from). Defaults are the real ones. */
export type ReportIo = { readonly out: (text: string) => void; /** Where `stream` reads checks from. Default: standard input. */ readonly stdin?: AsyncIterable<string | Uint8Array>; readonly env?: Env; readonly cwd?: string; readonly git?: Git; readonly clock?: () => number };

function gitOutput(args: readonly string[]): string | null {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

/** Where the checks ran, from the CI's own variables and then git. Explicit flags win over both. */
export function detectOrigin(env: Env, git: Git = gitOutput): { sha: string | null; branch: string | null; runUrl: string | null; ci: boolean } {
  const first = (...names: string[]) => names.map(name => env[name]).find(value => value) ?? null;
  const runUrl = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : first('CI_PIPELINE_URL', 'BUILDKITE_BUILD_URL', 'CIRCLE_BUILD_URL');
  const fromCi = first('GITHUB_SHA', 'CI_COMMIT_SHA', 'BUILDKITE_COMMIT', 'CIRCLE_SHA1');
  return {
    sha: fromCi ?? git(['rev-parse', 'HEAD']),
    branch: first('GITHUB_HEAD_REF', 'GITHUB_REF_NAME', 'CI_COMMIT_REF_NAME', 'BUILDKITE_BRANCH', 'CIRCLE_BRANCH') ?? git(['branch', '--show-current']),
    runUrl,
    ci: fromCi !== null
  };
}

/**
 * Whether the checks ran on exactly the commit they name. A CI checkout does. A developer's worktree
 * with edits to tracked files does not: its layer is `modified`, shown with a warning and never mistaken
 * for the commit's own result. Outside git the origin is `unknown`.
 */
export function detectFreshness(origin: { sha: string | null; ci: boolean }, git: Git = gitOutput): 'modified' | 'unknown' | undefined {
  if (origin.ci) return undefined;
  if (!origin.sha) return 'unknown';
  // `git diff` is empty (so null) when clean; untracked files (test output, build products) do not count.
  return git(['status', '--porcelain', '--untracked-files=no']) ? 'modified' : undefined;
}

function keyValue(pair: string, flag: string): [string, string] {
  const at = pair.indexOf('=');
  if (at < 1) throw new Error(`${flag} takes key=value (got "${pair}")`);
  return [pair.slice(0, at), pair.slice(at + 1)];
}

/** `--attach <file>`, or `--attach <role>=<file>` when the part before the `=` is not itself a file. */
function attachmentSpec(spec: string, base: string): Record<string, unknown> {
  const role = /^([a-z][a-z0-9._-]*)=(.+)$/.exec(spec);
  const exists = (file: string) => { try { return statSync(path.resolve(base, file)).isFile(); } catch { return false; } };
  if (role && !exists(spec)) return { name: path.basename(role[2]!), role: role[1]!, path: role[2]! };
  return { name: path.basename(spec), path: spec };
}

/** `--link <url>` or `--link <name>=<url>`. */
function linkSpec(spec: string): Record<string, unknown> {
  const named = /^([^=/:]+)=(.+)$/.exec(spec);
  return named ? { name: named[1]!, url: named[2]! } : { url: spec };
}

function parseTime(text: string | undefined): number | null {
  if (text === undefined) return null;
  const numeric = Number(text);
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(text);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--recorded-at takes an ISO date or epoch milliseconds (got "${text}")`);
  return parsed;
}

function ingest(argv: readonly string[], base: string): { ingested: IngestedChecks; extra: Record<string, unknown>; modifiedAtMs: number; manifestFile?: string; sourceDir: string } {
  const read = (file: string) => readFileSync(path.resolve(base, file), 'utf8');
  const sources = ['ctrf', 'junit', 'manifest', 'checks'].filter(name => value(argv, name) !== undefined);
  if (sources.length !== 1) throw new Error('Give exactly one of --ctrf, --junit, --manifest or --checks');
  const [source] = sources;
  const file = value(argv, source!)!;
  // When the report does not say when it ran, the file does: the same file is the same time.
  const modifiedAtMs = Math.floor(statSync(path.resolve(base, file)).mtimeMs);
  const sourceDir = path.dirname(path.resolve(base, file));
  if (source === 'junit') return { ingested: checksFromJunit(read(file)), extra: {}, modifiedAtMs, sourceDir };
  const json = JSON.parse(read(file)) as unknown;
  if (source === 'ctrf') return { ingested: checksFromCtrf(json), extra: {}, modifiedAtMs, sourceDir };
  if (source === 'manifest') return { ingested: checksFromManifest(json), extra: {}, modifiedAtMs, manifestFile: path.resolve(base, file), sourceDir };
  const given = parseWith(PublishChecksSchema.partial({ producer: true, recordedAtMs: true }), json, file);
  return { ingested: { checks: given.checks, recordedAtMs: given.recordedAtMs ?? null, tool: null }, extra: given, modifiedAtMs, sourceDir };
}

/**
 * `atlas report …` for a terminal: a mistake in the command or a path is a message on stderr and exit
 * code 2, so a CI job can tell a broken invocation (2) from a report that does not pass (1).
 */
export async function runReportCommand(argv: readonly string[]): Promise<number> {
  try {
    return await reportMain(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // With --format json the mistake is a document too, so a caller never has to read prose.
    process.stderr.write(wantsJson(argv) ? `${JSON.stringify({ ok: false, error: { message, code: 'usage' } })}\n` : `atlas report: ${message}\n`);
    return 2;
  }
}

/** Does the command ask for a JSON document (`--format json` or `--json`) instead of prose? */
function wantsJson(argv: readonly string[]): boolean {
  return value(argv, 'format') === 'json' || argv.includes('--json');
}

function printChecks(out: (text: string) => void, label: string, checks: readonly Check[]): boolean {
  out(`${label}\n`);
  for (const check of checks) {
    out(`  ${check.ok ? '✓' : '✗'} ${check.name.padEnd(9)} ${check.detail}\n`);
    if (!check.ok && check.fix) out(`      → ${check.fix}\n`);
  }
  return checks.every(check => check.ok);
}

/** `atlas report …`. Returns the exit code: 0 passes, 1 does not. Throws on a mistake in the command (see {@link runReportCommand}). */
export async function reportMain(argv: readonly string[], io: ReportIo = { out: text => process.stdout.write(text) }): Promise<number> {
  const [command, ...rest] = argv;
  const base = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const clock = io.clock ?? Date.now;

  if (command === 'publish') {
    const target = writeStoreOf(value(rest, 'store'), base, env);
    const { ingested, extra, modifiedAtMs, manifestFile, sourceDir } = ingest(rest, base);
    // Checked before anything is written: a command that is wrong must not leave the store changed.
    if (rest.includes('--upload-run') && !manifestFile) throw new Error('--upload-run goes with --manifest <run>/manifest.json');
    const origin = detectOrigin(env, io.git);
    const producer = value(rest, 'producer') ?? (extra.producer as string | undefined);
    if (!producer) throw new Error('publish needs --producer <name>: a stable name for this suite, such as "web-e2e" or "gherkin"');
    const recordedAtMs = parseTime(value(rest, 'recorded-at')) ?? (extra.recordedAtMs as number | undefined) ?? ingested.recordedAtMs ?? modifiedAtMs;
    const parameters = Object.fromEntries(values(rest, 'param').map(pair => keyValue(pair, '--param')));
    const specsDirectory = value(rest, 'specs');
    const linked = await linkChecksToSpecs(ingested, { base, ...(specsDirectory ? { specsDirectory } : {}), ...(value(rest, 'spec') ? { spec: value(rest, 'spec')! } : {}) });
    const given = (extra.specs as { path: string }[] | undefined) ?? [];
    const sha = value(rest, 'sha') ?? (extra.sha as string | null | undefined) ?? origin.sha;
    const branch = value(rest, 'branch') ?? (extra.branch as string | null | undefined) ?? origin.branch;
    const freshness = (extra.freshness as 'modified' | 'unknown' | undefined) ?? detectFreshness({ sha, ci: origin.ci && !value(rest, 'sha') }, io.git);
    // Evidence: the files checks name, the files given with --attach, the labels and links given as flags.
    // What a report names is data from a test run: only its own folder and the roots given may be attached from.
    // What `--attach` names is what the person typed.
    const roots = [sourceDir, ...values(rest, 'attach-root').map(root => path.resolve(base, root))];
    const maxBytes = Number(value(rest, 'max-attachment-mb') ?? 512) * 1024 * 1024;
    const budget = { remaining: Number(value(rest, 'max-total-attachment-mb') ?? 2048) * 1024 * 1024 };
    const warnings: string[] = [];
    let attachedFiles = 0, attachedBytes = 0;
    const checksWithFiles: unknown[] = [];
    for (const check of linked.checks) {
      const read = await readAttachmentFiles(check as never, roots, { maxBytes, budget });
      checksWithFiles.push(read.value);
      attachedFiles += read.attached; attachedBytes += read.bytes; warnings.push(...read.warnings);
    }
    const fromFile = await readAttachmentFiles({ attachments: (extra.attachments as Record<string, unknown>[] | undefined) ?? [] }, roots, { maxBytes, budget });
    const fromFlags = await readAttachmentFiles({ attachments: values(rest, 'attach').map(spec => attachmentSpec(spec, base)) }, [base, ...roots], { maxBytes, budget, trusted: true });
    const layerAttachments = [...(fromFile.value.attachments as unknown[]), ...(fromFlags.value.attachments as unknown[])];
    for (const read of [fromFile, fromFlags]) { attachedFiles += read.attached; attachedBytes += read.bytes; warnings.push(...read.warnings); }
    const labels = { ...(ingested.labels ?? {}), ...((extra.labels as Record<string, string> | undefined) ?? {}), ...Object.fromEntries(values(rest, 'label').map(pair => keyValue(pair, '--label'))) };
    const links = [...((extra.links as unknown[] | undefined) ?? []), ...values(rest, 'link').map(linkSpec)];
    const layer = await publishChecks(target.store, {
      ...extra,
      producer,
      checks: checksWithFiles as never,
      // Always set, so a file that was skipped is not passed on by name.
      attachments: layerAttachments as never,
      ...(Object.keys(labels).length ? { labels } : {}),
      ...(links.length ? { links: links as never } : {}),
      specs: [...given, ...linked.specs.filter(entry => !given.some(other => other.path === entry.path))] as never,
      recordedAtMs,
      kind: value(rest, 'kind') ?? (extra.kind as string | undefined) ?? 'checks',
      ...(value(rest, 'title') ?? extra.title ? { title: (value(rest, 'title') ?? extra.title) as string } : {}),
      sha, branch,
      runUrl: value(rest, 'run-url') ?? (extra.runUrl as string | null | undefined) ?? origin.runUrl,
      ...(freshness ? { freshness } : {}),
      ...(value(rest, 'environment') ?? extra.environment ? { environment: (value(rest, 'environment') ?? extra.environment) as string } : {}),
      parameters: { ...((extra.parameters as Record<string, string> | undefined) ?? {}), ...parameters }
    });
    const counts = { passed: 0, failed: 0, other: 0 };
    for (const check of ingested.checks) counts[check.status === 'passed' ? 'passed' : check.status === 'failed' ? 'failed' : 'other'] += 1;
    const linkedCount = linked.checks.filter(check => check.specPath).length;
    const hint = linkedCount < linked.checks.length && !value(rest, 'spec') && !specsDirectory ? ' (pass --specs <dir> or --spec <path> to link checks to their specs)' : '';
    const json = wantsJson(rest);
    const result: { ok: true; store: string; layer: object; specSet?: object; run?: object; warnings: string[] } = {
      ok: true, store: target.label,
      layer: { id: layer.id, producer, environment: layer.environment ?? null, checks: ingested.checks.length, passed: counts.passed, failed: counts.failed, notRun: counts.other, linkedToSpec: linkedCount, ...(freshness ? { freshness } : {}), attachmentFiles: attachedFiles, attachmentBytes: attachedBytes },
      warnings: warnings.map(warning => `attachment skipped: ${warning}`)
    };
    if (!json) io.out(`Published layer ${layer.id.slice(0, 12)}: ${ingested.checks.length} checks (${counts.passed} passed, ${counts.failed} failed, ${counts.other} not run) as "${producer}"${layer.environment ? ` on ${layer.environment}` : ''}${freshness === 'modified' ? ' [from a modified checkout]' : ''}; ${linkedCount} of ${linked.checks.length} linked to a spec${hint}${attachedFiles ? `; ${attachedFiles} attachment file${attachedFiles === 1 ? '' : 's'} (${(attachedBytes / 1024 / 1024).toFixed(1)} MiB)` : ''}\n`);
    if (!json) for (const warning of warnings) io.out(`! attachment skipped: ${warning}\n`);

    if (specsDirectory) {
      const files = await collectSpecFiles(path.resolve(base, specsDirectory));
      // A spec named with --spec that the directory does not hold (or whose kind is not a spec file) is published too.
      for (const entry of linked.specs) {
        if (files.some(file => file.path === entry.path)) continue;
        const text = value(rest, 'spec') ? await readFile(path.resolve(base, value(rest, 'spec')!), 'utf8').catch(() => null) : null;
        if (text !== null) files.push({ path: entry.path, text });
      }
      // The commit's own time for a clean checkout, so publishing the same commit twice is one set.
      const committed = !freshness && sha ? Number((io.git ?? gitOutput)(['show', '-s', '--format=%ct', sha])) * 1000 : NaN;
      const set = await publishSpecSet(target.store, { files, branch, sha, recordedAtMs: Number.isFinite(committed) && committed > 0 ? committed : clock(), ...(freshness ? { freshness } : {}), domain: path.basename(base) || 'product' });
      result.specSet = { id: set.id, files: set.files.length, branch };
      if (!json) io.out(`Published spec set ${set.id.slice(0, 12)}: ${set.files.length} specs${branch ? ` from ${branch}` : ''}\n`);
    }
    if (rest.includes('--upload-run')) {
      const run = await publishRunBundle(target.store, path.dirname(manifestFile!));
      result.run = { id: run.id, files: run.files, bytes: run.bytes, alreadyPublished: run.alreadyPublished };
      if (!json) io.out(run.alreadyPublished ? `Run ${run.id} was already in the store\n` : `Uploaded run ${run.id}: ${run.files} files, ${(run.bytes / 1024 / 1024).toFixed(1)} MiB\n`);
    }
    if (json) io.out(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  if (command === 'stream') {
    const target = writeStoreOf(value(rest, 'store'), base, env);
    const producer = value(rest, 'producer');
    if (!producer) throw new Error('stream needs --producer <name>: a stable name for this suite, such as "web-e2e"');
    const origin = detectOrigin(env, io.git);
    const sha = value(rest, 'sha') ?? origin.sha;
    const branch = value(rest, 'branch') ?? origin.branch;
    const freshness = detectFreshness({ sha, ci: origin.ci && !value(rest, 'sha') }, io.git);
    const environment = value(rest, 'environment');
    const warnings: string[] = [];
    const reporter = createReporter({
      producer,
      kind: value(rest, 'kind') ?? 'checks',
      ...(value(rest, 'title') ? { title: value(rest, 'title')! } : {}),
      sha, branch,
      runUrl: value(rest, 'run-url') ?? origin.runUrl,
      ...(freshness ? { freshness } : {}),
      ...(environment ? { environment } : {}),
      parameters: Object.fromEntries(values(rest, 'param').map(pair => keyValue(pair, '--param')))
    }, {
      store: target.store,
      flushMs: Number(value(rest, 'flush-ms') ?? 1000),
      batchSize: Number(value(rest, 'batch') ?? 100),
      now: clock,
      onError: (error, willRetry) => { const line = `could not send${willRetry ? ' (will try again)' : ''}: ${error.message}`; if (wantsJson(rest)) warnings.push(line); else io.out(`! ${line}\n`); }
    });
    let lines = 0;
    let buffered = '';
    const decoder = new TextDecoder();
    const take = (line: string) => {
      if (!line.trim()) return;
      lines += 1;
      try {
        reporter.check(JSON.parse(line) as never);
      } catch (error) {
        warnings.push(`line ${lines} skipped: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      }
    };
    for await (const chunk of io.stdin ?? (process.stdin as AsyncIterable<Uint8Array>)) {
      buffered += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffered.indexOf('\n')) >= 0) { take(buffered.slice(0, newline)); buffered = buffered.slice(newline + 1); }
    }
    take(buffered);
    const result = await reporter.close();
    if (wantsJson(rest)) {
      io.out(`${JSON.stringify({ ok: result.lost === 0, producer, environment: environment ?? null, layers: result.layers, checks: result.checks, lost: result.lost, warnings }, null, 2)}\n`);
      return result.lost ? 1 : 0;
    }
    for (const warning of warnings) io.out(`! ${warning}\n`);
    io.out(`Streamed ${result.checks} checks in ${result.layers} layer${result.layers === 1 ? '' : 's'} as "${producer}"${environment ? ` on ${environment}` : ''}${result.lost ? `; ${result.lost} could not be sent` : ''}\n`);
    return result.lost ? 1 : 0;
  }

  if (command === 'status') {
    const format = value(rest, 'format') ?? 'text';
    if (!['text', 'json', 'markdown'].includes(format)) throw new Error(`--format takes text|json|markdown (got "${format}")`);
    const backends = await backendsOf(rest, base, env);
    const specsDirectory = value(rest, 'specs');
    // One Atlas server, asked nothing it cannot answer itself: it already holds the layers, so it works out the gate
    // and only the verdict travels, not every layer.
    const server = backends.length === 1 && !specsDirectory && !value(rest, 'outline-branch') ? (backends[0] as { server?: HttpStore }).server : undefined;
    if (server) {
      const query = new URLSearchParams();
      for (const branch of values(rest, 'branch')) query.append('branch', branch);
      for (const branch of (env.ATLAS_ONLY_BRANCH ?? '').split(/[\s,]+/).filter(Boolean)) query.append('branch', branch);
      if (rest.includes('--ignore-modified') || env.ATLAS_IGNORE_MODIFIED === '1' || env.ATLAS_IGNORE_MODIFIED === 'true') query.set('ignoreModified', '1');
      if (value(rest, 'require-environments')) query.set('requireEnvironments', value(rest, 'require-environments')!);
      if (rest.includes('--require-all-specs')) query.set('requireAllSpecs', '1');
      const answer = ReportStatusSchema.safeParse(await server.status(query));
      // A verdict this reader cannot read is unknown, never a pass.
      if (!answer.success) throw new Error(`${server.url} answered something that is not a report status. Upgrade @crvouga/atlas, or ask it with --format json to see it`);
      const status = answer.data as unknown as Parameters<typeof formatStatusText>[0];
      io.out(format === 'json' ? `${JSON.stringify(answer.data, null, 2)}\n` : format === 'markdown' ? formatStatusMarkdown(status) : formatStatusText(status));
      return answer.data.ok ? 0 : 1;
    }
    let outline = specsDirectory ? await loadDirectoryOutline(path.resolve(base, specsDirectory), { repoRoot: base }) : undefined;
    if (!outline) {
      // No checkout to read the specs from: the newest set published to the store is the outline.
      const found = await latestSpecSet(backends.map(backend => backend.store), value(rest, 'outline-branch')).catch(() => null);
      if (found) outline = { specs: found.set.files.map(({ path: file, domain, kind, title, fingerprint }) => ({ path: file, domain, kind, title, fingerprint })), sha: found.set.sha, changedFiles: [], readSpec: async () => null };
    }
    if (rest.includes('--require-all-specs') && !outline) throw new Error('--require-all-specs needs to know which specs to expect: pass --specs <dir>, or publish with --specs so the store holds a spec set');
    const include = layerFilter(rest, env);
    const report = await combineBackends(backends, { ...(outline ? { outline } : {}), ...(include ? { include } : {}) });
    const status = reportStatus(report, {
      requireEnvironments: (value(rest, 'require-environments') ?? '').split(',').map(name => name.trim()).filter(Boolean),
      requireAllSpecs: rest.includes('--require-all-specs')
    });
    io.out(format === 'json' ? `${JSON.stringify(status, null, 2)}\n` : format === 'markdown' ? formatStatusMarkdown(status) : formatStatusText(status));
    return status.ok ? 0 : 1;
  }

  if (command === 'merge') {
    const into = value(rest, 'into');
    if (!into) throw new Error('merge needs --into <dir or s3://bucket/prefix>');
    const destination = writeStoreOf(into, base, env, 'into');
    let copied = 0, skipped = 0, ignored = 0;
    for (const backend of await backendsOf(rest, base, env)) {
      const result = await copyStore(backend.store, destination.store);
      copied += result.copied;
      skipped += result.skipped;
      ignored += result.ignored;
    }
    if (wantsJson(rest)) { io.out(`${JSON.stringify({ ok: true, into, copied, skipped, ignored }, null, 2)}\n`); return 0; }
    io.out(`Merged into ${into}: ${copied} objects copied, ${skipped} already there${ignored ? `; ${ignored} objects outside layers/ were not copied (only layers are merged)` : ''}\n`);
    return 0;
  }

  if (command === 'doctor') {
    const role = (value(rest, 'role') ?? 'both') as Role;
    if (!['publisher', 'reader', 'both'].includes(role)) throw new Error(`--role takes publisher|reader|both (got "${role}")`);
    let healthy = true;
    const stores: { id: string; checks: readonly Check[] }[] = [];
    for (const backend of await backendsOf(rest, base, env)) {
      const checks = await inspectStore(backend, { role });
      stores.push({ id: backend.id, checks });
      if (wantsJson(rest)) healthy = checks.every(check => check.ok) && healthy;
      else healthy = printChecks(io.out, backend.id, checks) && healthy;
    }
    if (wantsJson(rest)) io.out(`${JSON.stringify({ ok: healthy, stores }, null, 2)}\n`);
    else io.out(healthy ? 'All good.\n' : 'Something needs attention (see →).\n');
    return healthy ? 0 : 1;
  }

  if (command === 'policy') {
    const specs = storeSpecs(values(rest, 'store'), env);
    const opened = specs.length === 1 ? openStore(specs[0]!, { base, env }) : null;
    if (!opened || opened.location.kind !== 's3') throw new Error('policy needs one --store s3://bucket/prefix (or ATLAS_STORE)');
    const role = (value(rest, 'role') ?? 'both') as Role;
    if (!['publisher', 'reader', 'both'].includes(role)) throw new Error(`--role takes publisher|reader|both (got "${role}")`);
    io.out(`${JSON.stringify(iamPolicy(opened.location, role), null, 2)}\n`);
    if (opened.location.endpoint) io.out(`\n# ${opened.location.endpoint} is not AWS: this is the AWS form. Grant the same actions in its own policy language.\n`);
    return 0;
  }

  io.out(REPORT_USAGE);
  return command && command !== '--help' && command !== '-h' ? 2 : 0;
}
