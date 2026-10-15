/**
 * @module `atlas serve`
 *
 * Starts the Atlas server from its configuration: opens every backend (creating the data folder), proves the upload
 * backend can be written to before listening, finds or builds the client, listens at once (so a liveness probe finds the
 * process while a large backend is still being read), and stops cleanly on SIGTERM or SIGINT. `serverOptionsOf` is shared
 * with `atlas dev`, so the two run the same server.
 *
 * @see docs/server.md#run-it
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { openStore } from '../../reports/src/store-url';
import type { BackendInput } from '../../reports/src/compose';
import { createAtlasServer, type AtlasServerOptions } from './app';
import { ConfigError, loadServerConfig, SERVER_USAGE, type ResolvedServerConfig } from './config';
import { listen } from './host';
import { fileServerSettings } from './settings';
import { findSite } from './site';

type Env = Readonly<Record<string, string | undefined>>;
/** What `serveMain` and `devMain` are given besides arguments: where output goes, and, for tests and embedding, the environment, working directory and an `AbortSignal` that stops the server (otherwise SIGTERM and SIGINT do). */
export type ServeIo = { readonly out: (text: string) => void; readonly env?: Env; readonly cwd?: string; readonly signal?: AbortSignal };

/** Open every backend of a configuration. The data folder is made if it is not there. */
export function openConfiguredBackends(config: ResolvedServerConfig, env: Env, cwd: string): (BackendInput & { readonly writable: boolean })[] {
  return config.backends.map((spec, i) => {
    if (i === 0) mkdirSync(spec.url, { recursive: true });
    const opened = openStore(spec.url, { base: cwd, env });
    return { id: spec.id, label: spec.label, store: opened.store, writable: spec.id === config.writeId };
  });
}

/** Can the server put things in the place uploads go? Said at the start, not at the first upload. */
async function probeWritable(backend: BackendInput): Promise<string | null> {
  const key = `layers/doctor-${Math.random().toString(36).slice(2, 10)}/probe`;
  try {
    await backend.store.put(key, new TextEncoder().encode('atlas'), 'text/plain');
    if (!(await backend.store.head(key))) return 'an object was written but could not be found again';
    await backend.store.delete(key).catch(() => {});
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
    backends, write: config.writeId,
    ...(/^https?:\/\//.test(config.backends.find(backend => backend.id === config.writeId)!.url) ? { liveStore: backends[0]!.store } : {}), tokens: config.tokens, anonymousRead: config.anonymousRead,
    ...(config.outlineBranch ? { outlineBranch: config.outlineBranch } : {}), ...(include ? { include } : {}),
    runTimeoutMs: config.runTimeoutSeconds * 1000, runStallMs: config.runStallSeconds * 1000, refreshMs: config.refreshSeconds * 1000, limits: config.limits, heartbeatMs: config.heartbeatSeconds * 1000,
    ...(config.log && log ? { log } : {})
  };
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
    if (error instanceof ConfigError) { io.out(`atlas serve: ${error.message}\n`); return 2; }
    throw error;
  }

  const backends = openConfiguredBackends(config, env, cwd);
  const writeBackend = backends.find(backend => backend.writable)!;
  io.out(`${config.configFile ? `Configuration ${path.relative(cwd, config.configFile) || config.configFile}. ` : ''}Backends: ${backends.map(backend => `${backend.id}${backend.writable ? ' (uploads)' : ''}`).join(', ')}\n`);
  const problem = await probeWritable(writeBackend);
  if (problem) { io.out(`atlas serve: uploads would go to "${writeBackend.id}" and it cannot be written to: ${problem}\n`); return 2; }

  const site = await findSite(config.site, cwd, io.out);
  if (!site) io.out('No Atlas client to serve: build one with `atlas client build --no-data --out atlas-site`. The API is served meanwhile.\n');

  const server = createAtlasServer({ settings: fileServerSettings(config, argv, env, cwd), ...serverOptionsOf(config, backends, line => io.out(`${JSON.stringify(line)}\n`)), ...(site ? { site } : {}) });
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
