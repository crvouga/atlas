# `@crvouga/atlas/server`

The Atlas server: one process per project that takes in results from every environment, keeps them, and shows
everyone the combined report, live. A Bun API that serves the Vite-built viewer from the same host (and, under
`atlas dev`, the viewer's dev server proxies `/api` to it, so development is one host too).

Use it from the command line: `atlas serve`, `atlas dev` ([the guide](../../docs/server.md)). The command-line server keeps
**all reports and all user state (the garbage collection policy, saved settings) in S3-compatible storage and nowhere
else**, set by the required `ATLAS_S3_ENDPOINT`, `ATLAS_S3_BUCKET`, `ATLAS_S3_REGION`, `ATLAS_S3_ACCESS_KEY_ID` and
`ATLAS_S3_SECRET_ACCESS_KEY` variables (see [`.env.example`](https://github.com/crvouga/atlas/blob/main/.env.example)); it exits with status 2, listing every
variable and what is wrong, if they are missing or invalid. Use it from code when you want the server inside something else,
and bring your own `ObjectStore` (a bucket, or a memory store in tests):

```ts
import { createAtlasServer } from '@crvouga/atlas/server';
import { listen } from '@crvouga/atlas/server';
import { s3Store } from '@crvouga/atlas/reports/s3-store';

const server = createAtlasServer({
  backends: [{ id: 's3', store: s3Store({ bucket: 'my-atlas-reports', region: 'eu-west-1' }) }],
  write: 's3',                                    // where uploads go
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
| `config`, `storage` | `loadServerConfig`: the saved settings, the file, then the environment, then the flags; every mistake said in words. `resolveS3Config`: the required `ATLAS_S3_*` variables, all problems reported together. |
| `user-state`, `settings` | The user state JSON in S3 (`server/state.json`): the garbage collection policy and saved settings. |
| `main`, `dev` | `atlas serve` and `atlas dev`. |

The server describes itself: `GET /api/openapi.json` is an OpenAPI 3.1 document of every route (also `@crvouga/atlas/openapi.json`),
`GET /llms.txt` a guide for an agent given only the address, and every error is an RFC 9457 problem document. See
[Atlas for AI agents](../../docs/agents.md) and the [generated reference](../../docs/reference/server.md).

`bun packages/server/bench/bench.ts [layers] [checks]` measures the server on a long history.
