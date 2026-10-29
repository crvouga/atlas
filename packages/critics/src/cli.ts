/**
 * @module The `atlas critic` command
 *
 * `atlas critic list | setup | doctor | run`: run automated reviewers of the UI catalog on this machine and publish what they
 * think as critiques. The server stores and shows; it never runs a model and never holds a provider key. `criticMain` takes its
 * arguments, environment, working directory, clock and a prompt as parameters and returns the exit code, so it is driven the same
 * from a terminal, CI and tests; `runCriticCommand` is the terminal wrapper.
 *
 * Interactive when there is a terminal: missing choices are asked for, a run that sends images to a third party names the
 * destination and asks for confirmation. Without a terminal (or with `--non-interactive`, or `--format json`) nothing is ever asked:
 * every choice is a flag, a missing one exits 2 and names the flags, and sending images to a third party needs `--yes`.
 *
 * Exit codes: 0 it worked, 1 it ran and the answer is no (a critic failed on an entry, a gate was crossed, a check of `doctor`
 * found a problem), 2 the command itself was wrong (a missing flag, a gate refused for lack of evidence).
 *
 * @see docs/critics.md#the-atlas-critic-command
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { httpStore } from '../../reports/src/http-store';
import type { CatalogEntry, CatalogEntriesQuery } from '../../reports/src/ui-catalog-entries';
import { ServerInfoSchema } from '../../schema/src/api';
import type { Critique } from '../../schema/src/critique';
import { createCatalogClient, CatalogClientError } from './catalog-client';
import type { JudgeableEntry } from './contract';
import { resolveCredential } from './credentials';
import type { CritiqueOutcome } from './critique';
import { gateDecision, relativeVerdict, type Calibration, type GateDecision, type GateMode } from './judging';
import { publishCritiques } from './publish';
import { buildCritic, loadCriticsConfig, type BuiltCritic, type Inspection, type LoadedConfig } from './registry';
import { runCritic, type ProgressEvent, type RunResult } from './runner';
import { flushSpool, pendingInSpool, spoolingStore } from './spool';

/** The text `atlas critic --help` prints. Also the source of the command reference in `docs/reference/cli.md`. */
export const CRITIC_USAGE = `atlas critic — automated reviewers of the UI catalog

  atlas critic list    [--config atlas.critics.json] [--format text|json]
  atlas critic setup   <name> [--config atlas.critics.json] [--format text|json]
  atlas critic doctor  [--server <url>] [--critic <name>]... [--config atlas.critics.json] [--format text|json]
  atlas critic run     --critic <name>... ( --all | --unjudged | --since <version> | filters ) [--server <url>]
                       [--area a,b] [--profile key] [--state screen,overlay] [--route r] [--q words]
                       [--dry-run] [--yes] [--non-interactive] [--force]
                       [--max-images n] [--max-tokens n] [--max-cost usd] [--concurrency n] [--timeout-ms n]
                       [--mode report|warn|gate] [--threshold state=score]... [--calibration file.json]
                       [--spool dir] [--project slug] [--config atlas.critics.json] [--format text|json]

  A critic is a producer: it runs here (on a laptop, in CI or in a worker), reads the catalog from an Atlas server, and publishes
  what it thinks as layers of critiques. The server never runs a model and never holds a provider key. A critique is an opinion,
  not a test result: it never changes whether a report passes.

  Configuration is atlas.critics.json, which may be committed: it names credentials by reference (env:NAME, file:PATH) and a
  literal credential in it is refused. The server is --server, "server.url" there, ATLAS_SERVER_URL or an https ATLAS_STORE;
  the token is ATLAS_CRITIC_TOKEN (or ATLAS_TOKEN), never a flag, and is never sent over plain http beyond this machine.

  list      The critics available and configured: type, whether each is ready or needs setup, and where it sends images.
  setup     Provision a critic: fetch and verify a model checkpoint against its pinned SHA-256 (a bad checksum is an error), or
            check that a credential reference resolves. This is the only place anything is downloaded; judging never downloads.
  doctor    Check the server is reachable, the token is accepted and has the scope a critic needs (and warn when the server is
            open, so every caller is an administrator), that the server lists the catalog, and for each configured critic its
            model file, dependencies, credential and provider. Each problem is reported separately, with how to fix it.
  run       Judge the entries in the chosen scope. An entry that already has a current critique of the same critic, version,
            model, parameters and image is skipped without a call; a changed image is judged again. Failures are recorded
            with a reason code and retried by the next run. Critiques that cannot be sent (the server went away) are kept in
            the spool directory (default .atlas/critic-spool) and sent, byte for byte, by the next invocation.
            --dry-run        send and publish nothing: say how many entries would be judged or skipped, and where images would go
            --yes            allow sending images to a third party without asking (required without a terminal)
            --max-images n   stop cleanly after n images; --max-tokens and --max-cost likewise, from what critics report
            --mode           report (default): scores are shown and the exit code is 0; warn: also list scores below their threshold;
                             gate: exit 1 when a score is below its state kind's threshold, refused (exit 2) unless a calibration
                             with held-out evidence of this critic and version is given with --calibration

  --format json   prints one document (schemas: critic-list-result, critic-setup-result, critic-doctor-result, critic-run-result).
                  A command that is wrong is {"ok":false,"error":{"message":…,"code":"usage"}} on standard error.
  Exit codes: 0 ok, 1 the answer is no (a critic failed, a gate crossed, a problem found), 2 the command was wrong.
`;

type Env = Readonly<Record<string, string | undefined>>;

/** What `criticMain` is given besides arguments: where output goes, and, for tests and embedding, the environment, working directory, clock, `fetch`, module loading and a prompt. */
export type CriticIo = {
  readonly out: (text: string) => void;
  readonly env?: Env;
  readonly cwd?: string;
  readonly clock?: () => number;
  readonly fetch?: typeof fetch;
  readonly importModule?: (name: string) => Promise<unknown>;
  /** Waits between retries of a request to the server. Default `setTimeout`. Tests pass a fake. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Whether a person is at a terminal. Default: standard input and output are terminals. Nothing is asked when this is false. */
  readonly interactive?: boolean;
  /** Asks a question and returns the answer. Default: a line from standard input. */
  readonly ask?: (question: string) => Promise<string>;
};

const VALUE_FLAGS = ['config', 'server', 'project', 'critic', 'area', 'profile', 'state', 'route', 'q', 'since', 'format', 'max-images', 'max-tokens', 'max-cost', 'concurrency', 'timeout-ms', 'mode', 'threshold', 'calibration', 'spool'];

const values = (argv: readonly string[], name: string) => argv.flatMap((token, i) => (token === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));
const value = (argv: readonly string[], name: string) => values(argv, name)[0];
const list = (argv: readonly string[], name: string) => values(argv, name).flatMap(item => item.split(',')).map(item => item.trim()).filter(Boolean);
const wantsJson = (argv: readonly string[]) => value(argv, 'format') === 'json' || argv.includes('--json');

function positionals(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith('--')) { if (VALUE_FLAGS.includes(token.slice(2))) i++; continue; }
    out.push(token);
  }
  return out;
}

function numberFlag(argv: readonly string[], name: string, whole = false): number | undefined {
  const text = value(argv, name);
  if (text === undefined) return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0 || (whole && !Number.isInteger(n))) throw new Error(`--${name} takes a positive ${whole ? 'whole ' : ''}number (got "${text}")`);
  return n;
}

const isLoopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);

/** Where the server is and how to reach it, from flags, configuration and the environment. */
async function connection(argv: readonly string[], loaded: LoadedConfig, env: Env): Promise<{ url: string; token?: string; project?: string } | null> {
  const store = env.ATLAS_STORE && /^https?:\/\//.test(env.ATLAS_STORE) ? env.ATLAS_STORE : undefined;
  const url = value(argv, 'server') ?? loaded.config.server?.url ?? env.ATLAS_SERVER_URL ?? store;
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(`The server address "${url}" is not a URL`); }
  const reference = loaded.config.server?.token;
  const token = reference ? await resolveCredential(reference, { env }) : env.ATLAS_CRITIC_TOKEN || env.ATLAS_TOKEN || undefined;
  // A token is a credential: it goes over https, or to this machine.
  if (token && parsed.protocol !== 'https:' && !isLoopback(parsed)) throw new Error(`Refusing to send a token to ${parsed.host} over plain ${parsed.protocol.replace(':', '')}: use an https address (plain http is allowed only for this machine)`);
  const project = value(argv, 'project') ?? loaded.config.server?.project ?? env.ATLAS_PROJECT;
  return { url: url.replace(/\/+$/, ''), ...(token ? { token } : {}), ...(project ? { project } : {}) };
}

const redactIn = (text: string, secrets: readonly string[]) => secrets.reduce((acc, secret) => (secret.length >= 6 ? acc.split(secret).join('[redacted]') : acc), text);

async function defaultAsk(question: string): Promise<string> {
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question); } finally { rl.close(); }
}

const print = (io: CriticIo, document: unknown) => io.out(`${JSON.stringify(document, null, 2)}\n`);

function scopeOf(argv: readonly string[]): { query: CatalogEntriesQuery; chosen: Record<string, string> } {
  const chosen: Record<string, string> = {};
  const query: Record<string, unknown> = {};
  for (const name of ['area', 'profile', 'state', 'route'] as const) { const found = list(argv, name); if (found.length) { query[name] = found; chosen[name] = found.join(','); } }
  const q = value(argv, 'q');
  if (q) { query.q = q; chosen.q = q; }
  const since = value(argv, 'since');
  if (since) { query.since = since; chosen.since = since; }
  if (argv.includes('--all')) chosen.all = 'true';
  if (argv.includes('--unjudged')) chosen.unjudged = 'true';
  return { query: query as CatalogEntriesQuery, chosen };
}

function parseThresholds(argv: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of values(argv, 'threshold')) {
    const at = pair.indexOf('=');
    const score = Number(pair.slice(at + 1));
    if (at < 1 || !Number.isFinite(score)) throw new Error(`--threshold takes state=score, such as screen=0.6 (got "${pair}")`);
    out[pair.slice(0, at)] = score;
  }
  return out;
}

const toJudgeable = (entry: CatalogEntry): JudgeableEntry => ({
  key: entry.key, title: entry.title, state: entry.state, imageSha256: entry.image.sha256,
  ...(entry.route ? { route: entry.route } : {}), profile: { key: entry.profile.key, environment: entry.profile.environment, parameters: entry.profile.parameters }
});

/** `atlas critic list`. */
async function list_(argv: readonly string[], io: CriticIo, loaded: LoadedConfig): Promise<number> {
  const rows = [];
  for (const name of Object.keys(loaded.config.critics).sort()) {
    const entry = loaded.config.critics[name]!;
    try {
      const built = await buildCritic(loaded, name, io);
      const description = built.critic.describe();
      const problems = (await built.inspect()).filter(item => item.status === 'problem');
      rows.push({
        name, type: entry.type, kind: built.critic.kind ?? null, version: built.critic.version,
        status: problems.length ? (problems.some(item => item.aspect === 'model-file') ? 'needs-setup' as const : 'misconfigured' as const) : 'ready' as const,
        sendsImagesTo: description.sendsImagesTo, model: description.model?.id ?? null,
        ...(problems.length ? { detail: redactIn(problems.map(item => `${item.detail}${item.fix ? ` (${item.fix})` : ''}`).join('; '), built.secrets) } : {})
      });
    } catch (error) {
      rows.push({ name, type: entry.type, kind: null, version: null, status: 'misconfigured' as const, sendsImagesTo: null, model: null, detail: error instanceof Error ? error.message.split('\n')[0]! : String(error) });
    }
  }
  for (const type of ['uiclip', 'llm']) {
    if (!Object.values(loaded.config.critics).some(entry => entry.type === type)) {
      rows.push({ name: type, type: 'not-configured', kind: null, version: null, status: 'not-configured' as const, sendsImagesTo: null, model: null, detail: `Built in. Add a "${type}" entry under "critics" in atlas.critics.json to use it` });
    }
  }
  if (wantsJson(argv)) { print(io, { ok: true, config: loaded.file ? path.relative(io.cwd ?? process.cwd(), loaded.file) || path.basename(loaded.file) : null, critics: rows }); return 0; }
  io.out(`${loaded.file ? `Critics in ${path.basename(loaded.file)}` : 'No atlas.critics.json here'}\n`);
  for (const row of rows) io.out(`  ${row.status === 'ready' ? '✓' : row.status === 'not-configured' ? '·' : '✗'} ${row.name.padEnd(14)} ${String(row.type).padEnd(14)} ${row.status.padEnd(14)} ${row.sendsImagesTo ? `images go to ${row.sendsImagesTo}` : row.status === 'not-configured' ? '' : 'images stay on this machine'}${row.detail ? `\n      → ${row.detail}` : ''}\n`);
  return 0;
}

/** `atlas critic setup <name>`. */
async function setup_(argv: readonly string[], io: CriticIo, loaded: LoadedConfig): Promise<number> {
  const [name] = positionals(argv);
  if (!name) throw new Error(`setup needs the name of a critic: ${Object.keys(loaded.config.critics).join(', ') || 'none are configured in atlas.critics.json'}`);
  const built = await buildCritic(loaded, name, io);
  const type = loaded.config.critics[name]!.type;
  try {
    const done = await built.setup();
    if (wantsJson(argv)) print(io, { ok: true, critic: name, type, details: done.details }); else for (const line of done.details) io.out(`✓ ${line}\n`);
    return 0;
  } catch (error) {
    const message = redactIn(error instanceof Error ? error.message : String(error), built.secrets);
    if (wantsJson(argv)) print(io, { ok: false, critic: name, type, details: [], error: message }); else io.out(`✗ ${message}\n`);
    return 1;
  }
}

type DoctorCheck = { name: string; status: 'ok' | 'warning' | 'problem'; detail: string; fix?: string };

/** `atlas critic doctor`. */
async function doctor_(argv: readonly string[], io: CriticIo, loaded: LoadedConfig): Promise<number> {
  const env = io.env ?? process.env;
  const checks: DoctorCheck[] = [];
  const add = (check: DoctorCheck) => checks.push(check);
  let role: string | null = null, open: boolean | null = null, serverLabel: string | null = null;
  const wanted = list(argv, 'critic');
  const names = wanted.length ? wanted : Object.keys(loaded.config.critics);

  let target: Awaited<ReturnType<typeof connection>> = null;
  try { target = await connection(argv, loaded, env); } catch (error) { add({ name: 'server', status: 'problem', detail: error instanceof Error ? error.message : String(error), fix: 'Use an https address, or put the token in the environment for a server on this machine' }); }
  if (!target && !checks.length) add({ name: 'server', status: 'problem', detail: 'No server is configured', fix: 'Pass --server <url>, set "server.url" in atlas.critics.json, or export ATLAS_SERVER_URL' });
  if (target) {
    serverLabel = target.url;
    const doFetch = io.fetch ?? fetch;
    const headers: Record<string, string> = target.token ? { authorization: `Bearer ${target.token}` } : {};
    let response: Response | null = null;
    try { response = await doFetch(`${target.url}/api/server`, { headers, signal: AbortSignal.timeout(10_000) }); } catch (error) {
      add({ name: 'server', status: 'problem', detail: `${target.url} cannot be reached (${error instanceof Error ? error.message : 'error'})`, fix: 'Check the address, that the server is running, and the network' });
    }
    let authorized = false;
    if (response) {
      if (response.status === 401 || response.status === 403) {
        add({ name: 'server', status: 'ok', detail: `${target.url} is reachable` });
        add({ name: 'token', status: 'problem', detail: target.token ? 'The server did not accept this token' : 'The server wants a token and none was given', fix: 'Set ATLAS_CRITIC_TOKEN to a token with role critic (the server operator creates one with ATLAS_CRITIC_TOKEN or auth.tokens)' });
        await response.body?.cancel();
      } else if (!response.ok) {
        add({ name: 'server', status: 'problem', detail: `${target.url} answered ${response.status}`, fix: 'Check that this is an Atlas server, and that it is running' });
        await response.body?.cancel();
      } else {
        const info = ServerInfoSchema.safeParse(await response.json().catch(() => null));
        if (!info.success) add({ name: 'server', status: 'problem', detail: `${target.url} did not answer like an Atlas server`, fix: 'Check the address' });
        else {
          authorized = true; role = info.data.role; open = info.data.open;
          add({ name: 'server', status: 'ok', detail: `${target.url} is reachable${info.data.version ? ` (Atlas ${info.data.version})` : ''}` });
          if (open) add({ name: 'scope', status: 'warning', detail: 'The server has no tokens, so every caller is an administrator, critics included', fix: 'Give the server tokens (ATLAS_CRITIC_TOKEN for critics, ATLAS_PUBLISH_TOKEN for CI) so a critic can publish critiques and nothing else' });
          else if (info.data.role === 'critic') add({ name: 'scope', status: 'ok', detail: 'The token may read the catalog and publish critiques, and nothing else' });
          else if (info.data.role === 'read') add({ name: 'scope', status: 'problem', detail: 'The token may read but not publish critiques', fix: 'Use a token with role critic' });
          else add({ name: 'scope', status: 'warning', detail: `The token has role ${info.data.role}, which can do more than a critic needs (it could publish test results or change settings)`, fix: 'Use a token with role critic' });
          if (!info.data.capabilities.catalogEntries) add({ name: 'catalog', status: 'problem', detail: 'This server cannot list the catalog for critics', fix: 'Upgrade the server to a release with GET /api/reports/ui-catalog/entries' });
        }
      }
    }
    if (authorized && checks.every(check => check.name !== 'catalog')) {
      try {
        const page = await createCatalogClient({ url: target.url, ...(target.token ? { token: target.token } : {}), ...(target.project ? { project: target.project } : {}), ...(io.fetch ? { fetch: io.fetch } : {}), retries: 0 }).page({ limit: 1 });
        add({ name: 'catalog', status: 'ok', detail: `${page.total} captured ${page.total === 1 ? 'entry' : 'entries'} can be judged${page.unjudgeable ? `; ${page.unjudgeable} captured without a stored picture cannot` : ''}` });
      } catch (error) {
        add({ name: 'catalog', status: 'problem', detail: error instanceof CatalogClientError ? error.message : 'The catalog could not be read', fix: 'Check the token and the server version' });
      }
    }
  }

  const spool = path.resolve(loaded.directory, value(argv, 'spool') ?? loaded.config.spool ?? '.atlas/critic-spool');
  const waiting = await pendingInSpool(spool);
  add(waiting ? { name: 'spool', status: 'warning', detail: `${waiting} object${waiting === 1 ? '' : 's'} of critiques that could not be sent wait in ${path.relative(io.cwd ?? process.cwd(), spool) || spool}`, fix: 'The next `atlas critic run` sends them' } : { name: 'spool', status: 'ok', detail: 'Nothing is waiting to be sent' });

  for (const name of names) {
    let built: BuiltCritic;
    try { built = await buildCritic(loaded, name, io); } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0]! : String(error);
      add({ name: `${name}:${/credential/i.test(message) ? 'credential' : 'configuration'}`, status: 'problem', detail: message, fix: /not set/.test(message) ? `Export the variable that ${name} names` : 'Fix atlas.critics.json' });
      continue;
    }
    let found: Inspection[];
    try { found = await built.inspect(); } catch (error) { found = [{ aspect: 'inspect', status: 'problem', detail: error instanceof Error ? error.message : String(error) }]; }
    for (const item of found) add({ name: `${name}:${item.aspect}`, status: item.status, detail: redactIn(item.detail, built.secrets), ...(item.fix ? { fix: item.fix } : {}) });
  }
  if (wanted.length) for (const name of wanted) if (!loaded.config.critics[name]) add({ name: `${name}:configuration`, status: 'problem', detail: `No critic named "${name}" is configured`, fix: 'Add it under "critics" in atlas.critics.json' });

  const ok = checks.every(check => check.status !== 'problem');
  if (wantsJson(argv)) { print(io, { ok, server: serverLabel, role, open, checks }); return ok ? 0 : 1; }
  for (const check of checks) {
    io.out(`  ${check.status === 'ok' ? '✓' : check.status === 'warning' ? '!' : '✗'} ${check.name.padEnd(22)} ${check.detail}\n`);
    if (check.status !== 'ok' && check.fix) io.out(`      → ${check.fix}\n`);
  }
  io.out(ok ? 'No problems found.\n' : 'Something needs attention (see →).\n');
  return ok ? 0 : 1;
}

/** `atlas critic run`. */
async function run_(argv: readonly string[], io: CriticIo, loaded: LoadedConfig): Promise<number> {
  const env = io.env ?? process.env;
  const json = wantsJson(argv);
  const interactive = !argv.includes('--non-interactive') && !json && (io.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY));
  const ask = io.ask ?? defaultAsk;
  const dryRun = argv.includes('--dry-run');
  const clock = io.clock ?? Date.now;

  let names = list(argv, 'critic');
  let { query, chosen } = scopeOf(argv);
  let target = await connection(argv, loaded, env);
  const hasScope = () => Object.keys(chosen).length > 0;
  const missing = () => [...(names.length ? [] : ['--critic <name>']), ...(target ? [] : ['--server <url>']), ...(hasScope() ? [] : ['a scope: --all, --unjudged, --since <version>, or a filter such as --area or --state'])];

  if (missing().length && interactive) {
    if (!names.length) {
      const configured = Object.keys(loaded.config.critics);
      names = (await ask(`Which critic${configured.length ? ` (${configured.join(', ')})` : ''}? `)).split(/[,\s]+/).filter(Boolean);
    }
    if (!target) {
      const url = (await ask('Atlas server address? ')).trim();
      if (url) target = { url: url.replace(/\/+$/, ''), ...(env.ATLAS_CRITIC_TOKEN || env.ATLAS_TOKEN ? { token: (env.ATLAS_CRITIC_TOKEN || env.ATLAS_TOKEN)! } : {}) };
    }
    if (!hasScope()) {
      const answer = (await ask('Scope: judge (a)ll entries, or only those (u)njudged by this critic? ')).trim().toLowerCase();
      if (answer.startsWith('a')) chosen = { ...chosen, all: 'true' };
      else if (answer.startsWith('u')) chosen = { ...chosen, unjudged: 'true' };
    }
  }
  if (missing().length) throw new Error(`run needs ${missing().join(', ')}. Nothing was asked: ${interactive ? 'an answer was empty' : 'there is no terminal (or --non-interactive / --format json was given)'}`);
  const server = target!;
  const mode = (value(argv, 'mode') ?? 'report') as GateMode;
  if (!['report', 'warn', 'gate'].includes(mode)) throw new Error(`--mode takes report|warn|gate (got "${mode}")`);
  const thresholds = parseThresholds(argv);
  let calibration: Calibration | undefined;
  if (value(argv, 'calibration')) {
    try { calibration = JSON.parse(await readFile(path.resolve(io.cwd ?? process.cwd(), value(argv, 'calibration')!), 'utf8')) as Calibration; } catch { throw new Error(`--calibration ${value(argv, 'calibration')} cannot be read as a calibration document`); }
  }
  const budget = { ...(numberFlag(argv, 'max-images', true) ? { maxImages: numberFlag(argv, 'max-images', true)! } : {}), ...(numberFlag(argv, 'max-tokens', true) ? { maxTokens: numberFlag(argv, 'max-tokens', true)! } : {}), ...(numberFlag(argv, 'max-cost') ? { maxCostUsd: numberFlag(argv, 'max-cost')! } : {}) };
  const concurrency = numberFlag(argv, 'concurrency', true), timeoutMs = numberFlag(argv, 'timeout-ms', true);

  const builts: BuiltCritic[] = [];
  for (const name of names) builts.push(await buildCritic(loaded, name, io));
  const secrets = builts.flatMap(built => built.secrets);

  const client = createCatalogClient({ url: server.url, ...(server.token ? { token: server.token } : {}), ...(server.project ? { project: server.project } : {}), ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.sleep ? { sleep: io.sleep } : {}) });
  const spoolDir = path.resolve(loaded.directory, value(argv, 'spool') ?? loaded.config.spool ?? '.atlas/critic-spool');
  const base = httpStore({ url: server.url, ...(server.token ? { token: server.token } : {}), ...(server.project ? { project: server.project } : {}), ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.sleep ? { sleep: io.sleep } : {}) });
  const warnings: string[] = [];

  // What an earlier run could not send goes first, byte for byte; a dry run publishes nothing, so it sends nothing either.
  let flushed = 0;
  if (!dryRun) {
    const sent = await flushSpool(base, spoolDir);
    flushed = sent.sent;
    if (sent.error) warnings.push(`${sent.remaining} spooled object${sent.remaining === 1 ? '' : 's'} could not be sent yet: ${redactIn(sent.error, secrets)}`);
  }
  const store = spoolingStore(base, spoolDir);

  const scopeQuery: CatalogEntriesQuery = { ...query };
  const results: { built: BuiltCritic; result: RunResult; entries: number; decision: GateDecision | undefined; layer: string | null; critiques: number; failures: { entry: string; reason: string }[] }[] = [];
    for (const built of builts) {
    const name = built.critic.name;
    const wholeQuery: CatalogEntriesQuery = chosen.unjudged ? { ...scopeQuery, unjudgedBy: { name, version: built.critic.version } } : scopeQuery;
    const read = await client.read(wholeQuery);
    if (!read.sinceHonored) warnings.push(`The server does not remember version ${chosen.since}: the whole catalog was read`);
    for (const notice of read.notices) warnings.push(notice);

    // `gate` is refused before anything is spent when the evidence is not there.
    if (mode === 'gate') {
      const early = gateDecision({ mode, critic: built.critic, scores: read.entries.map(entry => ({ entryKey: entry.key, stateKind: entry.state, score: null })), ...(calibration ? { calibration } : {}), thresholds });
      if (early.exitCode === 2) throw new Error(`gate was refused for ${name}@${built.critic.version}:\n${early.refusal.map(line => `  ${line}`).join('\n')}`);
    }

    const description = built.critic.describe();
    if (!dryRun) {
      await built.ready();
      if (description.sendsImagesTo !== null) {
        const planned = read.entries.length;
        if (!argv.includes('--yes')) {
          if (!interactive) throw new Error(`${name} sends images to ${description.sendsImagesTo}: pass --yes to allow it (nothing was sent)`);
          const answer = await ask(`${name} will send up to ${planned} image${planned === 1 ? '' : 's'} to ${description.sendsImagesTo}. Continue? [y/N] `);
          if (!/^y(es)?$/i.test(answer.trim())) throw new Error(`Stopped: ${name} would send images to ${description.sendsImagesTo} and that was not confirmed (nothing was sent)`);
        }
      }
    }

    const existing: Critique[] = read.entries.flatMap(entry => entry.critiques.map(found => found.critique));
    const result = await runCritic({
      critic: built.critic, entries: read.entries.map(toJudgeable), existing, dryRun, ...(argv.includes('--force') ? { force: true } : {}),
      loadImage: judgeable => client.image(read.entries.find(entry => entry.key === judgeable.key)!),
      budget, secrets, ...(concurrency ? { concurrency } : {}), ...(timeoutMs ? { timeoutMs } : {}),
      ...(json || dryRun ? {} : { onProgress: (event: ProgressEvent) => io.out(`  ${event.result === 'judged' ? '✓' : event.result === 'skipped' ? '·' : '✗'} ${event.entryKey} (${event.judged} judged, ${event.skipped} skipped, ${event.failed} failed, ${event.waiting} waiting)\n`) })
    });

    // A raw score is read against the project's scores of the same state kind, and against the entry's previous image.
    const population = new Map<string, { stateKind: string; score: number }>();
    const whole = Object.keys(query).length === 0 && !chosen.unjudged ? read : await client.read({});
    for (const entry of whole.entries) for (const found of entry.critiques) if (found.currency === 'current' && found.critique.critic.name === name && found.critique.verdict?.score !== undefined) population.set(entry.key, { stateKind: entry.state, score: found.critique.verdict.score });
    for (const outcome of result.outcomes) if (outcome.critique.verdict?.score !== undefined) population.set(outcome.entry.key, { stateKind: outcome.entry.state, score: outcome.critique.verdict.score });
    const outcomes: CritiqueOutcome[] = result.outcomes.map(outcome => {
      const score = outcome.critique.verdict?.score;
      if (score === undefined || outcome.critique.verdict?.relative) return outcome;
      const entry = read.entries.find(candidate => candidate.key === outcome.entry.key);
      const previous = entry?.critiques.find(found => found.currency === 'earlier-image' && found.critique.critic.name === name && found.critique.verdict?.score !== undefined)?.critique.verdict?.score;
      const relative = relativeVerdict({ score, stateKind: outcome.entry.state, population: [...population.values()], ...(previous === undefined ? {} : { previousScore: previous }) });
      return { ...outcome, critique: { ...outcome.critique, verdict: { ...outcome.critique.verdict, relative } } };
    });

    let layer: string | null = null;
    if (!dryRun && outcomes.length) layer = (await publishCritiques(store, { critic: built.critic, outcomes, recordedAtMs: clock() }))?.id ?? null;

    const current = new Map<string, number | null>();
    for (const entry of read.entries) { const found = entry.critiques.find(c => c.currency === 'current' && c.critique.critic.name === name && c.critique.verdict?.score !== undefined); current.set(entry.key, found?.critique.verdict?.score ?? null); }
    for (const outcome of outcomes) current.set(outcome.entry.key, outcome.critique.verdict?.score ?? null);
    const decision = gateDecision({ mode, critic: built.critic, scores: read.entries.map(entry => ({ entryKey: entry.key, stateKind: entry.state, score: current.get(entry.key) ?? null })), ...(calibration ? { calibration } : {}), thresholds });
    results.push({ built, result, entries: read.entries.length, decision, layer, critiques: outcomes.length, failures: outcomes.filter(o => o.critique.failure).map(o => ({ entry: o.entry.key, reason: o.critique.failure!.reason })) });
  }

  const pending = await pendingInSpool(spoolDir);
  if (store.spooled() > 0) warnings.push(`The server could not be reached: ${store.spooled()} object${store.spooled() === 1 ? '' : 's'} of critiques were kept in ${path.relative(io.cwd ?? process.cwd(), spoolDir) || spoolDir} and will be sent by the next invocation`);
  const failed = results.some(item => item.result.failed > 0);
  const crossed = results.some(item => item.decision?.exitCode === 1);
  const ok = !failed && !crossed;
  const document = {
    ok, dryRun, server: server.url, scope: chosen,
    critics: results.map(({ built, result, entries, decision, layer, critiques, failures }) => ({
      critic: built.critic.name, version: built.critic.version, sendsImagesTo: result.sendsImagesTo, entries,
      judged: result.judged, skipped: result.skipped, failed: result.failed, waiting: result.waiting, ...(result.stoppedBy ? { stoppedBy: result.stoppedBy } : {}),
      failures, spent: result.spent, published: { layer, critiques },
      gate: { mode, exitCode: decision?.exitCode ?? 0, below: decision?.below.length ?? 0, warnings: decision?.warnings ?? [], refusal: decision?.refusal ?? [] }
    })),
    spool: { flushed, spooled: store.spooled(), pending },
    warnings: warnings.map(warning => redactIn(warning, secrets))
  };
  if (json) { print(io, document); return ok ? 0 : 1; }
  for (const item of document.critics) {
    io.out(`${dryRun ? 'Would judge' : 'Judged'} with ${item.critic}@${item.version}: ${item.entries} entries in scope, ${dryRun ? `${item.waiting} to judge` : `${item.judged} judged`}, ${item.skipped} skipped (already judged), ${item.failed} failed${item.waiting && !dryRun ? `, ${item.waiting} left` : ''}\n`);
    io.out(item.sendsImagesTo ? `  Images ${dryRun ? 'would go' : 'went'} to ${item.sendsImagesTo}\n` : '  Images stay on this machine\n');
    for (const failure of item.failures) io.out(`  ✗ ${failure.entry}: ${failure.reason}\n`);
    if (item.stoppedBy === 'budget') io.out('  The budget was reached: the run stopped and published what it had finished.\n');
    for (const line of item.gate.warnings) io.out(`  ! ${line}\n`);
    if (item.published.layer) io.out(`  Published ${item.published.critiques} critique${item.published.critiques === 1 ? '' : 's'} as layer ${item.published.layer.slice(0, 12)}\n`);
    if (mode === 'gate') io.out(item.gate.exitCode === 1 ? `  ✗ gate: ${item.gate.below} score${item.gate.below === 1 ? '' : 's'} below threshold\n` : '  ✓ gate: no score below threshold\n');
  }
  if (flushed) io.out(`Sent ${flushed} object${flushed === 1 ? '' : 's'} left by an earlier run\n`);
  for (const warning of document.warnings) io.out(`! ${warning}\n`);
  return ok ? 0 : 1;
}

/**
 * `atlas critic …`. Returns the exit code: 0 worked, 1 the answer is no. Throws on a mistake in the command (a missing flag, a
 * gate refused, a configuration that holds a credential), which {@link runCriticCommand} reports and turns into exit code 2.
 *
 * @param argv the arguments after `critic`.
 */
export async function criticMain(argv: readonly string[], io: CriticIo): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h' || rest.includes('--help')) { io.out(CRITIC_USAGE); return 0; }
  if (!['list', 'setup', 'doctor', 'run'].includes(command)) { io.out(CRITIC_USAGE); return 2; }
  const format = value(rest, 'format');
  if (format !== undefined && !['text', 'json'].includes(format)) throw new Error(`--format takes text|json (got "${format}")`);
  const loaded = await loadCriticsConfig(io.cwd ?? process.cwd(), value(rest, 'config'));
  if (command === 'list') return list_(rest, io, loaded);
  if (command === 'setup') return setup_(rest, io, loaded);
  if (command === 'doctor') return doctor_(rest, io, loaded);
  return run_(rest, io, loaded);
}

/** `atlas critic …` for a terminal: a mistake in the command is a message on stderr (a JSON document with `--format json`) and exit code 2. */
export async function runCriticCommand(argv: readonly string[], io: Partial<CriticIo> = {}): Promise<number> {
  try {
    return await criticMain(argv, { out: text => process.stdout.write(text), ...io });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(wantsJson(argv) ? `${JSON.stringify({ ok: false, error: { message, code: 'usage' } })}\n` : `atlas critic: ${message}\n`);
    return 2;
  }
}
