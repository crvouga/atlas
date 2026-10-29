/**
 * @module `atlas serve`
 *
 * Starts the Atlas server from its configuration. Storage comes first and is not optional: the required `ATLAS_S3_*`
 * variables are checked (every problem listed together), the bucket is proven reachable and writable, and the user
 * state (garbage collection policy and saved settings) is read from it, all before anything listens. Any failure prints
 * a banner naming every variable and exits 2; there is no fallback to a local folder, memory or a database. Then it
 * finds or builds the client, listens at once (so a liveness probe finds the process while a large bucket is still being
 * read), and stops cleanly on SIGTERM or SIGINT. `serverOptionsOf` is shared with `atlas dev`, so the two run the same server.
 *
 * @see docs/server.md#run-it
 */

import path from 'node:path';

import type { BackendInput } from '../../reports/src/compose';
import { s3Store } from '../../reports/src/s3-store';
import { createAtlasServer, type AtlasServerOptions } from './app';
import { ConfigError, loadServerConfig, SERVER_USAGE, type ResolvedServerConfig } from './config';
import { listen } from './host';
import { storedSettings } from './settings';
import { findSite } from './site';
import { describeS3, inspectS3Env, S3ConfigError, startupFailure } from './storage';
import { USER_STATE_KEY, UserStateError, userStateStore, type StoredUserState } from './user-state';

type Env = Readonly<Record<string, string | undefined>>;
/** What `serveMain` and `devMain` are given besides arguments: where output goes, and, for tests and embedding, the environment, working directory, the `fetch` S3 requests are sent with, and an `AbortSignal` that stops the server (otherwise SIGTERM and SIGINT do). */
export type ServeIo = { readonly out: (text: string) => void; readonly env?: Env; readonly cwd?: string; readonly signal?: AbortSignal; readonly fetch?: typeof fetch };

/** The id of the one backend: the S3 bucket. */
export const S3_BACKEND_ID = 's3';

/** Open the S3 bucket named by a configuration, with exactly the credentials it gives (no ambient AWS lookup). Nothing is contacted yet. */
export function openConfiguredBackends(config: ResolvedServerConfig, fetchImpl?: typeof fetch): (BackendInput & { readonly writable: boolean })[] {
  const { s3 } = config;
  const store = s3Store({
    bucket: s3.bucket, prefix: s3.prefix, region: s3.region, endpoint: s3.endpoint, forcePathStyle: s3.pathStyle,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey, ...(s3.sessionToken ? { sessionToken: s3.sessionToken } : {}) },
    env: {}, ...(fetchImpl ? { fetch: fetchImpl } : {})
  });
  return [{ id: S3_BACKEND_ID, label: describeS3(s3), store, writable: true }];
}

/** Can the server use the bucket? Said at the start, not at the first upload: list, write, read back and delete. */
async function probeStorage(backend: BackendInput): Promise<string | null> {
  const key = `layers/doctor-${Math.random().toString(36).slice(2, 10)}/probe`;
  try {
    await backend.store.listKeys('server/');
    await backend.store.put(key, new TextEncoder().encode('atlas'), 'text/plain');
    if (!(await backend.store.head(key))) return 'an object was written but could not be found again';
    await backend.store.delete(key);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** What `createAtlasServer` is given for a configuration: `atlas serve` and `atlas dev` run the same server. */
export function serverOptionsOf(config: ResolvedServerConfig, backends: ReturnType<typeof openConfiguredBackends>, log?: (line: Record<string, unknown>) => void): AtlasServerOptions {
  const branches = config.include.branches;
  const include = branches?.length || config.include.ignoreModified
    ? (layer: { readonly branch: string | null; readonly freshness?: 'unknown' | 'modified' }) => (!branches?.length || (layer.branch !== null && branches.includes(layer.branch))) && (!config.include.ignoreModified || layer.freshness === undefined)
    : undefined;
  return {
    backends, write: S3_BACKEND_ID,
    tokens: config.tokens, anonymousRead: config.anonymousRead,
    ...(config.outlineBranch ? { outlineBranch: config.outlineBranch } : {}), ...(include ? { include } : {}),
    runTimeoutMs: config.runTimeoutSeconds * 1000, runStallMs: config.runStallSeconds * 1000, refreshMs: config.refreshSeconds * 1000, limits: config.limits, heartbeatMs: config.heartbeatSeconds * 1000,
    ...(config.log && log ? { log } : {})
  };
}

/** What the garbage collection policy in S3 means, in one line for the log. */
const gcLine = (stored: StoredUserState) => stored.state.gc
  ? `Garbage collection policy loaded from S3 (${USER_STATE_KEY}): ${stored.state.gc.enabled ? `ON, delete superseded layers older than ${stored.state.gc.maxAgeDays} days, keep the newest ${stored.state.gc.keepLatest}, every ${stored.state.gc.intervalHours} h` : 'OFF (saved but disabled)'}.\n`
  : `No garbage collection policy has been saved in S3 (${USER_STATE_KEY}) yet: garbage collection is OFF and nothing is deleted. Define a policy in the Atlas UI at /admin.\n`;

/**
 * Check the storage and read the user state, in that order, with the failure banner for each way it can go wrong.
 * Returns the opened backends and the state, or the text to print before exiting 2.
 */
export async function connectStorage(config: ResolvedServerConfig, env: Env, io: Pick<ServeIo, 'fetch'>): Promise<{ readonly backends: ReturnType<typeof openConfiguredBackends>; readonly stored: StoredUserState } | { readonly failure: string }> {
  const backends = openConfiguredBackends(config, io.fetch);
  const problem = await probeStorage(backends[0]!);
  if (problem) return { failure: startupFailure(inspectS3Env(env), `the S3 storage ${describeS3(config.s3)} cannot be used with these settings`, problem) };
  try {
    return { backends, stored: await userStateStore(backends[0]!.store).read() };
  } catch (error) {
    if (error instanceof UserStateError) return { failure: startupFailure(inspectS3Env(env), 'the user state stored in S3 cannot be read', error.message) };
    throw error;
  }
}

/** `atlas serve`. Runs until it is told to stop; returns the exit code. */
export async function serveMain(argv: readonly string[], io: ServeIo): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  if (argv.includes('--help') || argv.includes('-h')) { io.out(SERVER_USAGE); return 0; }
  let config: ResolvedServerConfig;
  try {
    config = loadServerConfig(argv, env, cwd);
  } catch (error) {
    if (error instanceof S3ConfigError) { io.out(`${error.message}\n`); return 2; }
    if (error instanceof ConfigError) { io.out(`atlas serve: ${error.message}\n`); return 2; }
    throw error;
  }

  const connected = await connectStorage(config, env, io);
  if ('failure' in connected) { io.out(`${connected.failure}\n`); return 2; }
  const { backends, stored } = connected;
  if (stored.state.settings) {
    try {
      config = loadServerConfig(argv, env, cwd, undefined, stored.state.settings);
    } catch (error) {
      if (error instanceof ConfigError) { io.out(`atlas serve: the settings saved in S3 (${USER_STATE_KEY}) do not work with this deployment: ${error.message}\n`); return 2; }
      throw error;
    }
  }
  io.out(`${config.configFile ? `Configuration ${path.relative(cwd, config.configFile) || config.configFile}. ` : ''}Storage: ${describeS3(config.s3)}. All reports and user state live there.\n`);
  io.out(gcLine(stored));

  const site = await findSite(config.site, cwd, io.out);
  if (!site) io.out('No Atlas client to serve: build one with `atlas client build --no-data --out atlas-site`. The API is served meanwhile.\n');

  const { settings, gc } = storedSettings(config, argv, env, cwd, userStateStore(backends[0]!.store));
  const server = createAtlasServer({ settings, gc, ...serverOptionsOf(config, backends, line => io.out(`${JSON.stringify(line)}\n`)), ...(site ? { site } : {}) });
  // Listen at once: the first pass over a large backend can take a while, and a liveness probe must find the
  // process meanwhile. /readyz is 503 until there is a report to show.
  const running = await listen(server.fetch, { port: config.port, host: config.host, maxBodyBytes: Math.max(config.limits.maxObjectMiB, config.limits.maxJsonMiB) * 1024 * 1024 });
  io.out(`Listening on ${running.url}; reading the backends (/readyz is 503 until it is done)\n`);
  await server.ready;
  const snapshot = server.index.snapshot();
  for (const notice of snapshot.notices) io.out(`! ${notice}\n`);
  const stats = server.index.stats();
  const reachable = snapshot.backends.some(backend => backend.available);
  const access = config.tokens.length ? `, ${config.tokens.length} token${config.tokens.length === 1 ? '' : 's'}${config.anonymousRead ? ', anyone may look' : ''}` : ', NO tokens: anyone who can reach it may upload';
  io.out(reachable
    ? `Atlas ready on ${running.url}: ${stats.layers} layers, ${stats.slots} checks${access}\n`
    : `Atlas listening on ${running.url} but no backend can be read yet (see above); /readyz stays 503 and it keeps trying${access}\n`);

  await new Promise<void>(resolve => {
    const stop = () => resolve();
    io.signal?.addEventListener('abort', stop, { once: true });
    if (!io.signal) { process.once('SIGTERM', stop); process.once('SIGINT', stop); }
  });
  io.out('Stopping…\n');
  // End the live streams first: they never finish on their own and would hold the server open.
  server.close();
  await running.close();
  return 0;
}
