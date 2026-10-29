/**
 * @module `atlas dev`
 *
 * Runs the same server as `atlas serve` on a port of its own, with the client's Vite dev server in front of it. Vite proxies
 * `/api` (server-sent events included) to the server and writes the same address book into the page, so the browser, the
 * uploaders and the client all use one host, exactly as in production, and a change to the client shows at once.
 */

import path from 'node:path';

import { connectStorage, serverOptionsOf, type ServeIo } from './main';
import { createAtlasServer } from './app';
import { ConfigError, loadServerConfig, SERVER_USAGE } from './config';
import { describeS3, S3ConfigError } from './storage';
import { userStateStore } from './user-state';
import { listen } from './host';
import { storedSettings } from './settings';
import { visualizerRoot } from './site';

/** The text `atlas dev --help` prints. Also the source of the `atlas dev` section of `docs/reference/cli.md`. */
export const DEV_USAGE = `atlas dev: the Atlas server and the client, for working on either

  atlas dev [--port 5180] [--host 127.0.0.1] [--config atlas.server.json]

  Starts the server (API only, on a port of its own) and the client's dev server, which proxies /api to it, so the
  browser talks to one host and a change to the client shows at once. In production \`atlas serve\` does both from
  one process. Storage is the same as for \`atlas serve\`: the required ATLAS_S3_* environment variables name the S3
  bucket that holds all reports and user state; without them it exits with status 2 and lists every variable.
`;

/** `atlas dev`. */
export async function devMain(argv: readonly string[], io: ServeIo): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  if (argv.includes('--help') || argv.includes('-h')) { io.out(DEV_USAGE); return 0; }
  const root = visualizerRoot();
  if (!root) { io.out('atlas dev: the client is not installed alongside the server.\n'); return 2; }
  // --port is the one the browser uses (the client's); the API takes another that nobody needs to know.
  const flagged = argv.findIndex(item => item === '--port');
  const publicPort = flagged >= 0 ? Number(argv[flagged + 1]) : Number(env.ATLAS_PORT ?? env.PORT ?? 5180);
  const forServer = argv.filter((_, i) => i !== flagged && i !== flagged + 1 || flagged < 0);
  let config;
  try {
    // The API itself listens on a port of its own on this machine; what the user said about --host is for the client, the one door.
    config = loadServerConfig([...forServer, '--port', '0'], { ...env, PORT: undefined, ATLAS_PORT: undefined }, cwd);
  } catch (error) {
    if (error instanceof S3ConfigError) { io.out(`${error.message}\n`); return 2; }
    if (error instanceof ConfigError) { io.out(`atlas dev: ${error.message}\n${SERVER_USAGE.split('\n')[0]}\n`); return 2; }
    throw error;
  }
  const connected = await connectStorage(config, env, io);
  if ('failure' in connected) { io.out(`${connected.failure}\n`); return 2; }
  const { backends } = connected;
  const { settings, gc } = storedSettings(config, forServer, env, cwd, userStateStore(backends[0]!.store));
  const api = createAtlasServer({ ...serverOptionsOf(config, backends, line => io.out(`${JSON.stringify(line)}\n`)), settings, gc });
  const running = await listen(api.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: Math.max(config.limits.maxObjectMiB, config.limits.maxJsonMiB) * 1024 * 1024 });
  await api.ready;

  // The client's config reads this to proxy /api, and to write the same page config a server would.
  process.env.ATLAS_API_URL = running.url.replace('localhost', '127.0.0.1');
  process.env.INIT_CWD = cwd;
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.join(root, 'vite.config.ts'),
    configLoader: 'runner',
    root,
    server: { port: publicPort, host: config.host, strictPort: true }
  });
  try { await vite.listen(); } catch (error) {
    api.close();
    await vite.close();
    await running.close(2_000);
    throw error;
  }
  vite.printUrls();
  io.out(`Reports are stored in ${describeS3(config.s3)}. Publish with: ATLAS_STORE=${vite.resolvedUrls?.local[0] ?? `http://localhost:${publicPort}`} atlas report publish …\n`);

  await new Promise<void>(resolve => {
    io.signal?.addEventListener('abort', () => resolve(), { once: true });
    if (!io.signal) { process.once('SIGTERM', () => resolve()); process.once('SIGINT', () => resolve()); }
  });
  api.close();
  await vite.close();
  await running.close(2_000);
  return 0;
}
