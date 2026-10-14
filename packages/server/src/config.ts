/**
 * @module Server configuration
 *
 * Loads how the server runs: `atlas.server.json`, then environment variables, then flags, each overriding the last, checked
 * against `ServerConfigSchema` and resolved (paths made absolute, backends named, tokens read). Every mistake is a
 * `ConfigError` that says what to change, and a server that would listen beyond this machine with no tokens refuses to
 * start. `SERVER_SETTINGS` documents every setting once; the table in docs/server.md is generated from it and a test proves
 * each row.
 *
 * @see docs/server.md#configuration
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { ServerConfigSchema, type ServerConfig, type ServerRole } from '../../schema/src/server-config';

type Env = Readonly<Record<string, string | undefined>>;

/** A token as the server holds it: the `name` it is shown under in logs, its `role`, and the secret `token`. */
export type ResolvedToken = { readonly name: string; readonly role: ServerRole; readonly token: string };
/** A backend as configured: its `id`, the `label` people see, and the `url` (a folder, `s3://…`, or another server) to open. */
export type BackendSpec = { readonly id: string; readonly label: string; readonly url: string };

/** The configuration the server runs with: the file, then the environment, then the flags, checked and resolved. */
export type ResolvedServerConfig = Omit<ServerConfig, 'backends' | 'auth' | 'write'> & {
  /** The folder that is the default backend, absolute. */
  readonly data: string;
  /** Every backend, the data folder first. All are read; uploads go to `writeId`. */
  readonly backends: readonly BackendSpec[];
  readonly writeId: string;
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
  config: { type: 'string' }, data: { type: 'string' }, store: { type: 'string', multiple: true }, write: { type: 'string' },
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
  { summary: 'Address to listen on', key: 'host', flag: '--host <address>', env: ['ATLAS_HOST', 'HOST'], default: '`127.0.0.1`', example: { value: '0.0.0.0', read: c => c.host, expected: '0.0.0.0' } },
  { summary: 'Port (`0` picks a free one)', key: 'port', flag: '--port <n>', env: ['ATLAS_PORT', 'PORT'], default: '`8080`', example: { value: '9191', read: c => c.port, expected: 9191 } },
  { summary: 'The server\'s own folder: the default backend and write target', key: 'data', flag: '--data <dir>', env: ['ATLAS_DATA'], default: '`./atlas-data`', example: { value: 'results', read: c => path.basename(c.data), expected: 'results' } },
  { summary: 'More backends, read together with the data folder', key: 'backends', flag: '--store <[id=]url>` (repeatable)', env: ['ATLAS_STORE'], default: 'none', example: { value: 'lab=https://lab.example.com', read: c => c.backends.map(backend => backend.id), expected: ['data', 'lab'] } },
  { summary: 'The backend uploads go to', key: 'write', flag: '--write <id>', env: ['ATLAS_WRITE'], default: '`data`', example: { value: 'data', read: c => c.writeId, expected: 'data' } },
  { summary: 'The built viewer', key: 'site', flag: '--site <dir>', env: ['ATLAS_SITE'], default: '`./atlas-site`, else built once', example: { value: 'viewer', read: c => path.basename(c.site ?? ''), expected: 'viewer' } },
  { summary: 'Whose specs the report is laid over', key: 'outlineBranch', flag: '--outline-branch <branch>', env: ['ATLAS_OUTLINE_BRANCH'], default: '`main`, then `master`, then the newest', example: { value: 'trunk', read: c => c.outlineBranch, expected: 'trunk' } },
  { summary: 'Only layers recorded on these branches take part', key: 'include.branches', flag: '--branch <name>` (repeatable)', env: ['ATLAS_ONLY_BRANCH'], default: 'all', example: { value: 'main', read: c => c.include.branches, expected: ['main'] } },
  { summary: 'Leave out layers from modified checkouts and unknown origins', key: 'include.ignoreModified', flag: '--ignore-modified', env: ['ATLAS_IGNORE_MODIFIED'], default: 'no', example: { value: '1', read: c => c.include.ignoreModified, expected: true } },
  { summary: 'How often (seconds) the backends are looked at for layers written by something else', key: 'refreshSeconds', flag: '--refresh <seconds>', env: ['ATLAS_REFRESH_SECONDS'], default: '`10`', example: { value: '30', read: c => c.refreshSeconds, expected: 30 } },
  { summary: 'Let anyone look, not upload', key: 'auth.anonymousRead', flag: '--anonymous-read', env: ['ATLAS_ANONYMOUS_READ'], default: 'no', example: { value: '1', read: c => c.anonymousRead, expected: true } },
  { summary: 'Listen publicly with no tokens (something in front signs people in)', key: 'auth.insecure', flag: '--insecure', env: ['ATLAS_INSECURE'], default: 'no', example: { value: '1', read: c => c.insecure, expected: true } },
  { summary: 'The admin token (also `ATLAS_PUBLISH_TOKEN` and `ATLAS_READ_TOKEN` for the other roles, or `auth.tokens` in the file)', key: 'auth.tokens', flag: null, env: ['ATLAS_TOKEN'], default: 'none: the server is open and listens on this machine only', example: { value: 'admin-token-123456', read: c => c.tokens.map(token => token.role), expected: ['admin'] } },
  { summary: 'The configuration file', key: '(the file itself)', flag: '--config <file>', env: ['ATLAS_CONFIG'], default: '`./atlas.server.json` when it exists', example: { value: 'custom.json', read: c => path.basename(c.configFile ?? ''), expected: 'custom.json' } },
  { summary: 'No request log', key: 'log', flag: '--no-log', env: [], default: 'one JSON line per request', example: { value: '', read: c => c.log, expected: false } }
];

/** The text `atlas serve --help` prints. Also the source of the `atlas serve` section of `docs/reference/cli.md`. */
export const SERVER_USAGE = `atlas serve: the Atlas server

  atlas serve [--config atlas.server.json] [--data <dir>] [--port 8080] [--host 127.0.0.1]
              [--store <url|id=url>]... [--write <id>] [--site <dir>]
              [--outline-branch <b>] [--branch <name>]... [--ignore-modified] [--refresh <seconds>]
              [--anonymous-read] [--insecure] [--no-log]

  One process serves the viewer and the API. Test results are uploaded to it from anywhere (laptops, CI) and it
  shows everyone the combined report, live. It keeps its data in --data (default ./atlas-data) and can read more
  backends (--store): S3, other servers, folders. Uploads go to the data folder unless --write names another.

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

/** `id=url`, or a bare url with an id made from it. */
function backendOf(spec: string, taken: Set<string>): { id: string; url: string } {
  const named = /^([a-z0-9-]+)=(.+)$/.exec(spec);
  if (named) return { id: named[1]!, url: named[2]! };
  const base = spec.replace(/^[a-z0-9+.-]+:\/\//i, '').replace(/[?#].*$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'store';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return { id, url: spec };
}

/**
 * Read the file named by `--config`/`ATLAS_CONFIG`, or `atlas.server.json` in the folder if there is one, lay the
 * environment and then the flags over it, and check the result. Every problem is a {@link ConfigError} that says
 * what to change.
 */
export function loadServerConfig(argv: readonly string[], env: Env, cwd: string, read: (file: string) => string = file => readFileSync(file, 'utf8')): ResolvedServerConfig {
  const flags = parseFlags(argv);
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
  const base = file ? path.dirname(file) : cwd;
  const auth = { ...(raw.auth as Record<string, unknown> | undefined) };
  const include = { ...(raw.include as Record<string, unknown> | undefined) };
  const merged: Record<string, unknown> = { ...raw, auth, include };
  const set = (key: string, value: unknown) => { if (value !== undefined) merged[key] = value; };
  // ATLAS_HOST and ATLAS_PORT first: HOST is often the machine's own name, and PORT belongs to whatever else is running here.
  set('host', flags.host ?? env.ATLAS_HOST ?? env.HOST);
  const port = env.ATLAS_PORT ?? env.PORT;
  set('port', flags.port !== undefined ? Number(flags.port) : port !== undefined ? Number(port) : undefined);
  set('data', flags.data ?? env.ATLAS_DATA);
  set('write', flags.write ?? env.ATLAS_WRITE);
  set('site', flags.site ?? env.ATLAS_SITE);
  set('outlineBranch', flags['outline-branch'] ?? env.ATLAS_OUTLINE_BRANCH);
  set('refreshSeconds', flags.refresh !== undefined ? Number(flags.refresh) : env.ATLAS_REFRESH_SECONDS !== undefined ? Number(env.ATLAS_REFRESH_SECONDS) : undefined);
  if (flags['no-log']) merged.log = false;
  if (flags.insecure || truthy(env.ATLAS_INSECURE)) auth.insecure = true;
  if (flags['anonymous-read'] || truthy(env.ATLAS_ANONYMOUS_READ)) auth.anonymousRead = true;
  const branches = [...(flags.branch ?? []), ...list(env.ATLAS_ONLY_BRANCH)];
  if (branches.length) include.branches = branches;
  if (flags['ignore-modified'] || truthy(env.ATLAS_IGNORE_MODIFIED)) include.ignoreModified = true;

  const parsed = ServerConfigSchema.safeParse(merged);
  if (!parsed.success) throw new ConfigError(`${file ? `${file}: ` : 'Configuration: '}${parsed.error.issues.map(issue => `${issue.path.join('.') || '(config)'}: ${issue.message}`).join('; ')}`);
  const config = parsed.data;

  // Backends: the data folder, then those in the file, then --store and ATLAS_STORE.
  const taken = new Set<string>(['data']);
  const backends: BackendSpec[] = [{ id: 'data', label: 'Server data', url: path.resolve(base, config.data) }];
  const extra = config.backends.map(item => ({ id: item.id, label: item.label ?? item.id, url: item.url, write: item.write === true }));
  for (const item of extra) {
    if (taken.has(item.id)) throw new ConfigError(`Two backends are called "${item.id}" ("data" is the data folder)`);
    taken.add(item.id);
    backends.push({ id: item.id, label: item.label, url: item.url });
  }
  for (const spec of [...(flags.store ?? []), ...(flags.store ? [] : list(env.ATLAS_STORE))]) {
    const item = backendOf(spec, taken);
    if (taken.has(item.id)) throw new ConfigError(`Two backends are called "${item.id}"`);
    taken.add(item.id);
    backends.push({ id: item.id, label: item.id, url: item.url });
  }
  const marked = extra.filter(item => item.write).map(item => item.id);
  if (marked.length > 1) throw new ConfigError(`Only one backend can take uploads; ${marked.join(', ')} are all marked write`);
  const writeId = config.write ?? marked[0] ?? 'data';
  if (!backends.some(item => item.id === writeId)) throw new ConfigError(`write names "${writeId}", which is not a backend (${backends.map(item => item.id).join(', ')})`);

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

  const { backends: _backends, auth: _auth, write: _write, ...rest } = config;
  const resolved: ResolvedServerConfig = { ...rest, data: backends[0]!.url, backends, writeId, tokens, anonymousRead: config.auth.anonymousRead, insecure: config.auth.insecure, configFile: file, ...(config.site ? { site: path.resolve(base, config.site) } : {}) };
  assertSafeToListen(resolved);
  return resolved;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** A server that anyone on the network can upload to must say who may. */
export function assertSafeToListen(config: Pick<ResolvedServerConfig, 'host' | 'tokens' | 'insecure'>): void {
  if (config.tokens.length || config.insecure || LOOPBACK.has(config.host)) return;
  throw new ConfigError(`Listening on ${config.host} with no tokens would let anyone on the network upload results. Set ATLAS_TOKEN (and ATLAS_PUBLISH_TOKEN / ATLAS_READ_TOKEN), or listen on 127.0.0.1, or pass --insecure if something else in front of it does the signing in.`);
}
