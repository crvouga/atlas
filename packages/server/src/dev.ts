import path from 'node:path';

import { openConfiguredBackends, type ServeIo } from './main';
import { createAtlasServer } from './app';
import { ConfigError, loadServerConfig, SERVER_USAGE } from './config';
import { listen } from './host';
import { visualizerRoot } from './site';

export const DEV_USAGE = `atlas dev: the Atlas server and the viewer, for working on either

  atlas dev [--port 5180] [--host 127.0.0.1] [--data <dir>] [--store <url|id=url>]... [--config atlas.server.json]

  Starts the server (API only, on a port of its own) and the viewer's dev server, which proxies /api to it, so the
  browser talks to one host and a change to the viewer shows at once. In production \`atlas serve\` does both from
  one process.
`;

/** `atlas dev`. */
export async function devMain(argv: readonly string[], io: ServeIo): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  if (argv.includes('--help') || argv.includes('-h')) { io.out(DEV_USAGE); return 0; }
  const root = visualizerRoot();
  if (!root) { io.out('atlas dev: the viewer is not installed alongside the server.\n'); return 2; }
  // --port is the one the browser uses (the viewer's); the API takes another that nobody needs to know.
  const flagged = argv.findIndex(item => item === '--port');
  const publicPort = flagged >= 0 ? Number(argv[flagged + 1]) : Number(env.PORT ?? 5180);
  const forServer = argv.filter((_, i) => i !== flagged && i !== flagged + 1 || flagged < 0);
  let config;
  try {
    config = loadServerConfig([...forServer, '--port', '0', '--host', '127.0.0.1'], { ...env, PORT: undefined }, cwd);
  } catch (error) {
    if (error instanceof ConfigError) { io.out(`atlas dev: ${error.message}\n${SERVER_USAGE.split('\n')[0]}\n`); return 2; }
    throw error;
  }
  const backends = openConfiguredBackends(config, env, cwd);
  const api = createAtlasServer({ backends, write: config.writeId, tokens: config.tokens, anonymousRead: config.anonymousRead, refreshMs: config.refreshSeconds * 1000, limits: config.limits, ...(config.log ? { log: line => io.out(`${JSON.stringify(line)}\n`) } : {}) });
  const running = await listen(api.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: config.limits.maxObjectMiB * 1024 * 1024 });
  await api.ready;

  // The viewer's config reads this to proxy /api, and to write the same page config a server would.
  process.env.ATLAS_API_URL = running.url.replace('localhost', '127.0.0.1');
  process.env.INIT_CWD = cwd;
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.join(root, 'vite.config.ts'),
    configLoader: 'runner',
    root,
    server: { port: publicPort, host: config.host, strictPort: false }
  });
  await vite.listen();
  vite.printUrls();
  io.out(`Data in ${path.relative(cwd, config.data) || config.data}. Publish with: ATLAS_STORE=${vite.resolvedUrls?.local[0] ?? `http://localhost:${publicPort}`} atlas report publish …\n`);

  await new Promise<void>(resolve => {
    io.signal?.addEventListener('abort', () => resolve(), { once: true });
    if (!io.signal) { process.once('SIGTERM', () => resolve()); process.once('SIGINT', () => resolve()); }
  });
  api.close();
  await vite.close();
  await running.close(2_000);
  return 0;
}
