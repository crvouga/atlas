# `@crvouga/atlas/server`

The Atlas server: one process per project that takes in results from every environment, keeps them, and shows
everyone the combined report, live. A Bun API that serves the Vite-built viewer from the same host (and, under
`atlas dev`, the viewer's dev server proxies `/api` to it, so development is one host too).

Use it from the command line: `atlas serve`, `atlas dev` ([the guide](../../docs/server.md)). Use it from code when
you want the server inside something else:

```ts
import { createAtlasServer } from '@crvouga/atlas/server';
import { listen } from '@crvouga/atlas/server';
import { directoryStore } from '@crvouga/atlas/reports/directory-store';

const server = createAtlasServer({
  backends: [{ id: 'data', store: directoryStore('./atlas-data') }],
  write: 'data',                                  // where uploads go
  tokens: [{ name: 'ci', role: 'publish', token: process.env.ATLAS_PUBLISH_TOKEN! }],
  site: './atlas-site'                            // the built viewer; without it only the API is served
});
const running = await listen(server.fetch, { port: 8080, host: '127.0.0.1', maxBodyBytes: 256 * 1024 * 1024 });
await server.ready;                               // the first pass over the backends is done
```

`server.fetch` is a plain `(Request) => Promise<Response>`, so it also mounts in Hono, Express (through an adapter),
Cloudflare-style runtimes and tests. `server.index` is the live report (`ReportIndex`), `server.events` the stream
to viewers, `server.close()` stops both.

| Module | What |
| --- | --- |
| `app` | `createAtlasServer(options)`: the routes, the live report, compression and the page. |
| `host` | `listen(handler, { port, host, maxBodyBytes })`: `Bun.serve`, or `node:http` where there is no Bun. |
| `store-api`, `validate` | The upload protocol and what it refuses (content-addressed layers, dependency order, immutability). |
| `events` | `EventHub`: server-sent events to every viewer, with a heartbeat and a backlog limit. |
| `auth` | Roles (`read`, `publish`, `admin`), Bearer tokens, constant-time comparison. |
| `config` | `loadServerConfig`: the file, then the environment, then the flags; every mistake said in words. |
| `main`, `dev` | `atlas serve` and `atlas dev`. |

`bun packages/server/bench/bench.ts [layers] [checks]` measures the server on a long history.
