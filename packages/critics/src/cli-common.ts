/**
 * @module Shared parts of the `atlas critic` commands
 *
 * What every `atlas critic` subcommand reads the same way: flags, the server and token (a token is never sent over plain http beyond
 * this machine), the scope that narrows the catalog, the way output is printed, and `judgeEntries`, the one place where entries are
 * judged, read against their state kind and published, so `run` and `watch` cannot disagree about it.
 *
 * @see docs/critics.md#the-atlas-critic-command
 */
import type { ObjectStore } from '../../reports/src/object-store';
import type { CatalogEntry, CatalogEntriesQuery } from '../../reports/src/ui-catalog-entries';
import type { Critique } from '../../schema/src/critique';
import type { CatalogClient } from './catalog-client';
import type { Budget, ProgressEvent, RunResult } from './runner';
import type { JudgeableEntry } from './contract';
import { resolveCredential } from './credentials';
import type { CritiqueOutcome } from './critique';
import { relativeVerdict } from './judging';
import { publishCritiques } from './publish';
import type { BuiltCritic, LoadedConfig } from './registry';
import { runCritic } from './runner';

/** The environment a command reads: a map of names to values. */
export type Env = Readonly<Record<string, string | undefined>>;

/** What a command is given besides arguments: where output goes, and, for tests and embedding, the environment, working directory, clock, `fetch`, module loading, a prompt and a signal that ends a long-running command. */
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
  /** Ends `atlas critic watch` cleanly (what it finished is kept and published). The terminal wrapper aborts it on interrupt. */
  readonly signal?: AbortSignal;
};

/** The flags that take a value, so a value is not mistaken for a positional argument. */
export const VALUE_FLAGS = [
  'config', 'server', 'project', 'critic', 'area', 'profile', 'state', 'route', 'q', 'since', 'format', 'max-images', 'max-tokens', 'max-cost', 'concurrency', 'timeout-ms', 'mode', 'threshold', 'calibration', 'spool',
  'max-batches', 'entry', 'finding', 'note', 'reviewer', 'limit', 'good', 'bad', 'heldout-good', 'heldout-bad', 'out', 'critic-version'
];

/** Every value given for `--name`, in order. */
export const values = (argv: readonly string[], name: string) => argv.flatMap((token, i) => (token === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));
/** The first value given for `--name`. */
export const value = (argv: readonly string[], name: string) => values(argv, name)[0];
/** Every value of `--name`, comma-separated values split and trimmed. */
export const list = (argv: readonly string[], name: string) => values(argv, name).flatMap(item => item.split(',')).map(item => item.trim()).filter(Boolean);
/** Whether `--format json` (or `--json`) was given. */
export const wantsJson = (argv: readonly string[]) => value(argv, 'format') === 'json' || argv.includes('--json');

/** The arguments that are not flags or their values. */
export function positionals(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith('--')) { if (VALUE_FLAGS.includes(token.slice(2))) i++; continue; }
    out.push(token);
  }
  return out;
}

/** A positive number from `--name` (a whole number when `whole`), or undefined when it was not given. Throws for anything else. */
export function numberFlag(argv: readonly string[], name: string, whole = false): number | undefined {
  const text = value(argv, name);
  if (text === undefined) return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0 || (whole && !Number.isInteger(n))) throw new Error(`--${name} takes a positive ${whole ? 'whole ' : ''}number (got "${text}")`);
  return n;
}

const isLoopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);

/** Where the server is and how to reach it. */
export type Connection = { url: string; token?: string; project?: string };

/** Where the server is and how to reach it, from flags, configuration and the environment; `null` when no server is named. Throws for a token that would travel over plain http beyond this machine. */
export async function connection(argv: readonly string[], loaded: LoadedConfig, env: Env): Promise<Connection | null> {
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

/** `text` with every secret of six characters or more replaced by `[redacted]`. */
export const redactIn = (text: string, secrets: readonly string[]) => secrets.reduce((acc, secret) => (secret.length >= 6 ? acc.split(secret).join('[redacted]') : acc), text);

/** Asks a question on the terminal and returns the line typed. */
export async function defaultAsk(question: string): Promise<string> {
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question); } finally { rl.close(); }
}

/** Prints one JSON document, indented, with a final newline. */
export const print = (io: CriticIo, document: unknown) => io.out(`${JSON.stringify(document, null, 2)}\n`);

/** The catalog query and the readable summary of the choices that narrowed it (`--area`, `--profile`, `--state`, `--route`, `--q`, `--since`, `--all`, `--unjudged`). */
export function scopeOf(argv: readonly string[]): { query: CatalogEntriesQuery; chosen: Record<string, string> } {
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

/** A catalog entry as a critic is told about it. */
export const toJudgeable = (entry: CatalogEntry): JudgeableEntry => ({
  key: entry.key, title: entry.title, state: entry.state, imageSha256: entry.image.sha256,
  ...(entry.route ? { route: entry.route } : {}), profile: { key: entry.profile.key, environment: entry.profile.environment, parameters: entry.profile.parameters }
});

/** The scores a critic's current critiques already give, by entry key with the entry's state kind: the population a new score is read against. */
export function populationOf(entries: readonly CatalogEntry[], critic: string): Map<string, { stateKind: string; score: number }> {
  const population = new Map<string, { stateKind: string; score: number }>();
  for (const entry of entries) for (const found of entry.critiques) if (found.currency === 'current' && found.critique.critic.name === critic && found.critique.verdict?.score !== undefined) population.set(entry.key, { stateKind: entry.state, score: found.critique.verdict.score });
  return population;
}

/** What judging a set of entries did: the run, the outcomes read against their state kind, and the layer they were published as. */
export type Judged = { readonly result: RunResult; readonly outcomes: readonly CritiqueOutcome[]; readonly layer: string | null };

/**
 * Judges `entries` with one critic and publishes the outcomes as one layer. A raw score is read against the project's scores of the
 * same state kind (`population`, which is updated with the new scores) and against the entry's previous image. Nothing is published
 * on a dry run or when there is nothing to publish.
 *
 * @param args.population the critic's known scores by entry key (see {@link populationOf}); updated.
 * @param args.store where critiques are published (usually a spooling store).
 */
export async function judgeEntries(args: {
  readonly built: BuiltCritic;
  readonly entries: readonly CatalogEntry[];
  readonly client: Pick<CatalogClient, 'image'>;
  readonly store: ObjectStore;
  readonly population: Map<string, { stateKind: string; score: number }>;
  readonly dryRun: boolean;
  readonly force?: boolean;
  readonly budget?: Budget;
  readonly secrets: readonly string[];
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly clock: () => number;
  readonly onProgress?: (event: ProgressEvent) => void;
}): Promise<Judged> {
  const { built } = args;
  const name = built.critic.name;
  const existing: Critique[] = args.entries.flatMap(entry => entry.critiques.map(found => found.critique));
  const result = await runCritic({
    critic: built.critic, entries: args.entries.map(toJudgeable), existing, dryRun: args.dryRun, ...(args.force ? { force: true } : {}),
    loadImage: judgeable => args.client.image(args.entries.find(entry => entry.key === judgeable.key)!),
    ...(args.budget ? { budget: args.budget } : {}), secrets: args.secrets,
    ...(args.concurrency ? { concurrency: args.concurrency } : {}), ...(args.timeoutMs ? { timeoutMs: args.timeoutMs } : {}),
    ...(args.signal ? { signal: args.signal } : {}), ...(args.onProgress ? { onProgress: args.onProgress } : {})
  });
  for (const outcome of result.outcomes) if (outcome.critique.verdict?.score !== undefined) args.population.set(outcome.entry.key, { stateKind: outcome.entry.state, score: outcome.critique.verdict.score });
  const outcomes: CritiqueOutcome[] = result.outcomes.map(outcome => {
    const score = outcome.critique.verdict?.score;
    if (score === undefined || outcome.critique.verdict?.relative) return outcome;
    const entry = args.entries.find(candidate => candidate.key === outcome.entry.key);
    const previous = entry?.critiques.find(found => found.currency === 'earlier-image' && found.critique.critic.name === name && found.critique.verdict?.score !== undefined)?.critique.verdict?.score;
    const relative = relativeVerdict({ score, stateKind: outcome.entry.state, population: [...args.population.values()], ...(previous === undefined ? {} : { previousScore: previous }) });
    return { ...outcome, critique: { ...outcome.critique, verdict: { ...outcome.critique.verdict, relative } } };
  });
  let layer: string | null = null;
  if (!args.dryRun && outcomes.length) layer = (await publishCritiques(args.store, { critic: built.critic, outcomes, recordedAtMs: args.clock() }))?.id ?? null;
  return { result, outcomes, layer };
}
