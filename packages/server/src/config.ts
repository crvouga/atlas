/**
 * @module Server configuration
 *
 * Loads how the server runs: the settings saved in S3 (the user state), then `atlas.server.json`, then environment
 * variables, then flags, each overriding the last, checked against `ServerConfigSchema` and resolved (storage read from
 * the required `ATLAS_S3_*` variables, tokens read). Storage is never optional: all reports and user state live in
 * S3-compatible object storage, so missing or invalid storage variables are an `S3ConfigError` naming every variable.
 * Every other mistake is a `ConfigError` that says what to change, and a server that would listen beyond this machine
 * with no tokens refuses to start. `SERVER_SETTINGS` documents every setting once; the table in docs/server.md is
 * generated from it and a test proves each row.
 *
 * @see docs/server.md#configuration
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { ServerConfigSchema, type ServerConfig, type ServerRole } from '../../schema/src/server-config';
import { resolveS3Config, S3_VARIABLES, type S3Config } from './storage';

type Env = Readonly<Record<string, string | undefined>>;

/** A token as the server holds it: the `name` it is shown under in logs, its `role`, and the secret `token`. */
export type ResolvedToken = { readonly name: string; readonly role: ServerRole; readonly token: string };
/** The configuration the server runs with: the file, then the environment, then the flags, checked and resolved. */
export type ResolvedServerConfig = Omit<ServerConfig, 'auth'> & {
  /** The S3-compatible storage that holds every report and all user state. Required; there is no other. */
  readonly s3: S3Config;
  readonly tokens: readonly ResolvedToken[];
  readonly anonymousRead: boolean;
  readonly insecure: boolean;
  /** Where the config came from, for the first line of the log. */
  readonly configFile: string | null;
};

/** A configuration that cannot be used. The message says what to change; `atlas serve` prints it and exits 2. */
export class ConfigError extends Error {}

const DEFAULT_FILE = 'atlas.server.json';
const MIN_TOKEN = 12;

const OPTIONS = {
  config: { type: 'string' },
  host: { type: 'string' }, port: { type: 'string' }, site: { type: 'string' }, 'outline-branch': { type: 'string' },
  branch: { type: 'string', multiple: true }, 'ignore-modified': { type: 'boolean' }, refresh: { type: 'string' },
  insecure: { type: 'boolean' }, 'no-log': { type: 'boolean' }, 'anonymous-read': { type: 'boolean' }
} as const;

/** Every flag `atlas serve` accepts, with its `--`. */
export const SERVER_FLAGS: readonly string[] = Object.keys(OPTIONS).map(name => `--${name}`);

/** One setting of the server as an operator meets it: the config key, the flag, the environment variables, and what it does. */
export type ServerSetting = {
  /** What it sets, in words. */
  readonly summary: string;
  /** The key in `atlas.server.json` (dotted for nested keys). */
  readonly key: string;
  /** The command-line flag, with its value placeholder, or null when there is none. */
  readonly flag: string | null;
  /** The environment variables, the first that is set wins; empty when there are none. */
  readonly env: readonly string[];
  /** What it is when nothing sets it. */
  readonly default: string;
  /**
   * How the documentation is held to the code: giving `value` through the environment variable (or the flag) must make
   * `read` of the resolved configuration equal `expected`. A test runs every setting's example both ways.
   */
  readonly example: { readonly value: string; readonly read: (config: ResolvedServerConfig) => unknown; readonly expected: unknown };
};

/**
 * Every setting that can be given by flag or environment, documented once. `docs/server.md` renders its table from
 * this list, and a test proves each row: its example, through the flag and through the environment, changes the
 * configuration as the row says. A setting added to the loader without a row here is therefore not documented in the
 * table; one documented here that the loader ignores fails the test.
 */
export const SERVER_SETTINGS: readonly ServerSetting[] = [
  // Storage is required and comes only from the environment: reports and user state live in S3 and nowhere else.
  ...(Object.entries({
    ATLAS_S3_ENDPOINT: ['endpoint', 'S3 endpoint URL', c => c.s3.endpoint, 'https://s3.example.com'],
    ATLAS_S3_BUCKET: ['bucket', 'Bucket for all reports and user state', c => c.s3.bucket, 'atlas-reports'],
    ATLAS_S3_REGION: ['region', 'Bucket region', c => c.s3.region, 'eu-west-1'],
    ATLAS_S3_ACCESS_KEY_ID: ['accessKeyId', 'Access key id', c => c.s3.accessKeyId, 'AKIAEXAMPLE'],
    ATLAS_S3_SECRET_ACCESS_KEY: ['secretAccessKey', 'Secret access key', c => c.s3.secretAccessKey, 'secret-example-key'],
    ATLAS_S3_PREFIX: ['prefix', 'Folder in the bucket for everything Atlas writes', c => c.s3.prefix, 'atlas'],
    ATLAS_S3_PATH_STYLE: ['pathStyle', 'Path-style bucket addressing (`0` for virtual-hosted)', c => c.s3.pathStyle, '0'],
    ATLAS_S3_SESSION_TOKEN: ['sessionToken', 'Session token for temporary credentials', c => c.s3.sessionToken, 'session-example-token']
  } as Record<string, [string, string, (config: ResolvedServerConfig) => unknown, string]>).map(([variable, [field, summary, read, value]]): ServerSetting => {
    const required = S3_VARIABLES.find(item => item.name === variable)!.required;
    const expected = field === 'pathStyle' ? false : value;
    return { summary: `${summary} (${required ? '**required**' : 'optional'})`, key: `storage.s3.${field}`, flag: null, env: [variable], default: required ? '**none: the server refuses to start**' : field === 'pathStyle' ? 'yes' : field === 'prefix' ? 'the bucket root' : 'none', example: { value, read, expected } };
  })),
  { summary: 'Address to listen on', key: 'host', flag: '--host <address>', env: ['ATLAS_HOST', 'HOST'], default: '`127.0.0.1`', example: { value: '0.0.0.0', read: c => c.host, expected: '0.0.0.0' } },
  { summary: 'Port (`0` picks a free one)', key: 'port', flag: '--port <n>', env: ['ATLAS_PORT', 'PORT'], default: '`8080`', example: { value: '9191', read: c => c.port, expected: 9191 } },
  { summary: 'The built client', key: 'site', flag: '--site <dir>', env: ['ATLAS_SITE'], default: '`./atlas-site`, else built once', example: { value: 'client', read: c => path.basename(c.site ?? ''), expected: 'client' } },
  { summary: 'Whose specs the report is laid over', key: 'outlineBranch', flag: '--outline-branch <branch>', env: ['ATLAS_OUTLINE_BRANCH'], default: '`main`, then `master`, then the newest', example: { value: 'trunk', read: c => c.outlineBranch, expected: 'trunk' } },
  { summary: 'Only layers recorded on these branches take part', key: 'include.branches', flag: '--branch <name>` (repeatable)', env: ['ATLAS_ONLY_BRANCH'], default: 'all', example: { value: 'main', read: c => c.include.branches, expected: ['main'] } },
  { summary: 'Leave out layers from modified checkouts and unknown origins', key: 'include.ignoreModified', flag: '--ignore-modified', env: ['ATLAS_IGNORE_MODIFIED'], default: 'no', example: { value: '1', read: c => c.include.ignoreModified, expected: true } },
  { summary: 'How often (seconds) the backends are looked at for layers written by something else', key: 'refreshSeconds', flag: '--refresh <seconds>', env: ['ATLAS_REFRESH_SECONDS'], default: '`10`', example: { value: '30', read: c => c.refreshSeconds, expected: 30 } },
  { summary: 'Let anyone look, not upload', key: 'auth.anonymousRead', flag: '--anonymous-read', env: ['ATLAS_ANONYMOUS_READ'], default: 'no', example: { value: '1', read: c => c.anonymousRead, expected: true } },
  { summary: 'Listen publicly with no tokens (something in front signs people in)', key: 'auth.insecure', flag: '--insecure', env: ['ATLAS_INSECURE'], default: 'no', example: { value: '1', read: c => c.insecure, expected: true } },
  { summary: 'The admin token (also `ATLAS_PUBLISH_TOKEN` and `ATLAS_READ_TOKEN` for the other roles, or `auth.tokens` in the file)', key: 'auth.tokens', flag: null, env: ['ATLAS_TOKEN'], default: 'none: the server is open and listens on this machine only', example: { value: 'admin-token-123456', read: c => c.tokens.map(token => token.role), expected: ['admin'] } },
  { summary: 'The configuration file', key: '(the file itself)', flag: '--config <file>', env: ['ATLAS_CONFIG'], default: '`./atlas.server.json` when it exists', example: { value: 'custom.json', read: c => path.basename(c.configFile ?? ''), expected: 'custom.json' } },
  { summary: 'Largest uploaded object in MiB', key: 'limits.maxObjectMiB', flag: null, env: ['ATLAS_MAX_OBJECT_MIB'], default: '`256`', example: { value: '64', read: c => c.limits.maxObjectMiB, expected: 64 } },
  { summary: 'Largest JSON upload in MiB', key: 'limits.maxJsonMiB', flag: null, env: ['ATLAS_MAX_JSON_MIB'], default: '`32`', example: { value: '8', read: c => c.limits.maxJsonMiB, expected: 8 } },
  { summary: 'Maximum simultaneous live viewers', key: 'limits.maxStreams', flag: null, env: ['ATLAS_MAX_STREAMS'], default: '`500`', example: { value: '100', read: c => c.limits.maxStreams, expected: 100 } },
  { summary: 'Live connection heartbeat in seconds', key: 'heartbeatSeconds', flag: null, env: ['ATLAS_HEARTBEAT_SECONDS'], default: '`15`', example: { value: '20', read: c => c.heartbeatSeconds, expected: 20 } },
  { summary: 'Live producer heartbeat timeout in seconds', key: 'runTimeoutSeconds', flag: null, env: ['ATLAS_RUN_TIMEOUT_SECONDS'], default: '`30`', example: { value: '60', read: c => c.runTimeoutSeconds, expected: 60 } },
  { summary: 'Live run progress stall timeout in seconds (0 disables)', key: 'runStallSeconds', flag: null, env: ['ATLAS_RUN_STALL_SECONDS'], default: '`900`', example: { value: '0', read: c => c.runStallSeconds, expected: 0 } },
  { summary: 'No request log', key: 'log', flag: '--no-log', env: ['ATLAS_LOG'], default: 'one JSON line per request', example: { value: 'false', read: c => c.log, expected: false } }
];

/** The text `atlas serve --help` prints. Also the source of the `atlas serve` section of `docs/reference/cli.md`. */
export const SERVER_USAGE = `atlas serve: the Atlas server

  atlas serve [--config atlas.server.json] [--port 8080] [--host 127.0.0.1] [--site <dir>]
              [--outline-branch <b>] [--branch <name>]... [--ignore-modified] [--refresh <seconds>]
              [--anonymous-read] [--insecure] [--no-log]

  One process serves the client and the API. Test results are uploaded to it from anywhere (laptops, CI) and it
  shows everyone the combined report, live.

  Storage is required. ALL reports and ALL user state (the garbage collection policy, saved settings) are kept in
  S3-compatible object storage and nowhere else; there is no local-disk, in-memory or database fallback. Without
  these environment variables the server prints every one of them with what is wrong, and exits with status 2:
    ATLAS_S3_ENDPOINT  ATLAS_S3_BUCKET  ATLAS_S3_REGION  ATLAS_S3_ACCESS_KEY_ID  ATLAS_S3_SECRET_ACCESS_KEY
  Optional: ATLAS_S3_PREFIX, ATLAS_S3_PATH_STYLE, ATLAS_S3_SESSION_TOKEN. See .env.example.

  Tokens (ATLAS_TOKEN admin, ATLAS_PUBLISH_TOKEN, ATLAS_READ_TOKEN, or "auth.tokens" in the config) are required
  to listen beyond this machine unless --insecure. Every option has an environment variable (docs/deploying.md).
`;

function parseFlags(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: false, strict: true }).values;
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error));
  }
}

const list = (text: string | undefined) => (text ?? '').split(/[\n,]+/).map(item => item.trim()).filter(Boolean);
const truthy = (value: string | undefined) => value === '1' || value === 'true';

/**
 * Read the file named by `--config`/`ATLAS_CONFIG`, or `atlas.server.json` in the folder if there is one, lay the
 * environment and then the flags over it, and check the result. `saved` is the settings kept in S3 (the user state),
 * the lowest layer. Every problem is a {@link ConfigError} that says what to change; missing or invalid storage
 * variables are an `S3ConfigError` that names all of them, and are checked first.
 */
export function loadServerConfig(argv: readonly string[], env: Env, cwd: string, read: (file: string) => string = file => readFileSync(file, 'utf8'), saved: Record<string, unknown> = {}): ResolvedServerConfig {
  const flags = parseFlags(argv);
  // Storage first: nothing else matters while there is nowhere to keep the reports. Throws S3ConfigError naming every variable.
  const s3 = resolveS3Config(env);
  const named = flags.config ?? env.ATLAS_CONFIG;
  const file = named ? path.resolve(cwd, named) : existsSync(path.join(cwd, DEFAULT_FILE)) ? path.join(cwd, DEFAULT_FILE) : null;
  let raw: Record<string, unknown> = {};
  if (file) {
    try {
      raw = JSON.parse(read(file)) as Record<string, unknown>;
    } catch (error) {
      throw new ConfigError(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const removed of ['data', 'backends', 'write']) {
    if (removed in raw) throw new ConfigError(`${file}: "${removed}" is no longer supported. Reports and user state are kept only in S3-compatible storage, set with the required ATLAS_S3_* environment variables (see .env.example). Remove "${removed}" from the file.`);
  }
  const base = file ? path.dirname(file) : cwd;
  // The settings saved in S3 are the lowest layer: the file, the environment and the flags all override them.
  const auth = { ...(raw.auth as Record<string, unknown> | undefined) };
  const include = { ...(saved.include as Record<string, unknown> | undefined), ...(raw.include as Record<string, unknown> | undefined) };
  const merged: Record<string, unknown> = { ...saved, ...raw, auth, include };
  const set = (key: string, value: unknown) => { if (value !== undefined) merged[key] = value; };
  // ATLAS_HOST and ATLAS_PORT first: HOST is often the machine's own name, and PORT belongs to whatever else is running here.
  set('host', flags.host ?? env.ATLAS_HOST ?? env.HOST);
  const port = env.ATLAS_PORT ?? env.PORT;
  set('port', flags.port !== undefined ? Number(flags.port) : port !== undefined ? Number(port) : undefined);
  set('site', flags.site ?? env.ATLAS_SITE);
  set('outlineBranch', flags['outline-branch'] ?? env.ATLAS_OUTLINE_BRANCH);
  set('refreshSeconds', flags.refresh !== undefined ? Number(flags.refresh) : env.ATLAS_REFRESH_SECONDS !== undefined ? Number(env.ATLAS_REFRESH_SECONDS) : undefined);
  if (env.ATLAS_LOG !== undefined) merged.log = truthy(env.ATLAS_LOG);
  if (flags['no-log']) merged.log = false;
  set('runTimeoutSeconds', env.ATLAS_RUN_TIMEOUT_SECONDS === undefined ? undefined : Number(env.ATLAS_RUN_TIMEOUT_SECONDS));
  set('runStallSeconds', env.ATLAS_RUN_STALL_SECONDS === undefined ? undefined : Number(env.ATLAS_RUN_STALL_SECONDS));
  set('heartbeatSeconds', env.ATLAS_HEARTBEAT_SECONDS === undefined ? undefined : Number(env.ATLAS_HEARTBEAT_SECONDS));
  const limits = { ...(saved.limits as Record<string, unknown> | undefined), ...(raw.limits as Record<string, unknown> | undefined) };
  for (const [key, variable] of [['maxObjectMiB', 'ATLAS_MAX_OBJECT_MIB'], ['maxJsonMiB', 'ATLAS_MAX_JSON_MIB'], ['maxStreams', 'ATLAS_MAX_STREAMS']] as const) {
    if (env[variable] !== undefined) limits[key] = Number(env[variable]);
  }
  merged.limits = limits;
  if (flags.insecure || truthy(env.ATLAS_INSECURE)) auth.insecure = true;
  if (flags['anonymous-read'] || truthy(env.ATLAS_ANONYMOUS_READ)) auth.anonymousRead = true;
  const branches = [...(flags.branch ?? []), ...list(env.ATLAS_ONLY_BRANCH)];
  if (branches.length) include.branches = branches;
  if (flags['ignore-modified'] || truthy(env.ATLAS_IGNORE_MODIFIED)) include.ignoreModified = true;

  const parsed = ServerConfigSchema.safeParse(merged);
  if (!parsed.success) throw new ConfigError(`${file ? `${file}: ` : 'Configuration: '}${parsed.error.issues.map(issue => `${issue.path.join('.') || '(config)'}: ${issue.message}`).join('; ')}`);
  const config = parsed.data;

  // Tokens: the file's, then the environment's.
  const tokens: ResolvedToken[] = [];
  for (const item of config.auth.tokens) {
    const token = item.token ?? env[item.tokenEnv!];
    if (!token) throw new ConfigError(`Token "${item.name}" reads ${item.tokenEnv} and it is not set`);
    tokens.push({ name: item.name, role: item.role, token });
  }
  for (const [variable, role, name] of [['ATLAS_TOKEN', 'admin', 'admin'], ['ATLAS_PUBLISH_TOKEN', 'publish', 'publish'], ['ATLAS_READ_TOKEN', 'read', 'read']] as const) {
    if (env[variable]) tokens.push({ name, role, token: env[variable]!.trim() });
  }
  for (const item of tokens) if (item.token.length < MIN_TOKEN) throw new ConfigError(`Token "${item.name}" is shorter than ${MIN_TOKEN} characters: use a long random one (openssl rand -hex 24)`);
  if (new Set(tokens.map(item => item.token)).size !== tokens.length) throw new ConfigError('Two tokens are the same: each token must say who it is');

  const { auth: _auth, ...rest } = config;
  const resolved: ResolvedServerConfig = { ...rest, s3, tokens, anonymousRead: config.auth.anonymousRead, insecure: config.auth.insecure, configFile: file, ...(config.site ? { site: path.resolve(base, config.site) } : {}) };
  assertSafeToListen(resolved);
  return resolved;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** A server that anyone on the network can upload to must say who may. */
export function assertSafeToListen(config: Pick<ResolvedServerConfig, 'host' | 'tokens' | 'insecure'>): void {
  if (config.tokens.length || config.insecure || LOOPBACK.has(config.host)) return;
  throw new ConfigError(`Listening on ${config.host} with no tokens would let anyone on the network upload results. Set ATLAS_TOKEN (and ATLAS_PUBLISH_TOKEN / ATLAS_READ_TOKEN), or listen on 127.0.0.1, or pass --insecure if something else in front of it does the signing in.`);
}
