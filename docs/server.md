# The Atlas server

One process per project that **takes in results from every environment, keeps them, and shows everyone the
combined report, live**. It is a Bun API that serves a Vite-built single-page viewer: one host, one port, in
development and in production.

```
  laptop ──────┐                                        ┌── browsers  (the viewer: reads /api, listens on /api/events)
  CI job ──────┼── PUT /api/store/…  POST /api/checks ─▶│
  device lab ──┘   atlas report publish | stream        │   atlas report status  (the gate: asks /api/status)
                                                        │
                       backends: ./atlas-data (default), S3, other folders, another Atlas server
```

- **Clients upload directly to it.** `atlas report publish`, `atlas report stream`, `createReporter` and a plain
  `curl` all end up as layers on the server. Nothing else needs deploying: no bucket access for CI, no artifact
  merging, no static site to rebuild.
- **Its default backend is its own filesystem** (`./atlas-data`). That folder is the whole state: back it up,
  mount it on a volume, or put the state in a bucket instead ([backends](#backends)). Several backends are one
  report, as ever.
- **The report is live.** Every viewer holds one server-sent-events connection; when results arrive the server
  says so and each viewer reads only what changed ([streaming](#streaming)).
- **Layered, never partitioned**, as everywhere in Atlas: the server only stores immutable, content-addressed
  layers and works out the report from them. Replace it, restore it, or run a second one on a copy of the data:
  the same layers give the same report ([the contract](report-contract.md)).

- [Run it](#run-it) · [Configuration](#configuration) · [Backends](#backends) · [Tokens and roles](#tokens-and-roles)
- [Sending results](#sending-results) · [Streaming](#streaming) · [API reference](#api-reference)
- [What the server refuses](#what-the-server-refuses) · [Performance](#performance) · [Operating it](#operating-it)

## Run it

```sh
bun add -d @crvouga/atlas
export ATLAS_TOKEN=$(openssl rand -hex 24)   # admin token; see "Tokens and roles"
bunx atlas serve                             # http://127.0.0.1:8080, data in ./atlas-data
```

It runs on Bun and on Node 22.18 or later. The first start builds the viewer once into `~/.cache/atlas/site`
(or serves `./atlas-site`, or `--site <dir>`); the build is the same for every project, because the server writes
its own address book into the page (`window.__ATLAS_CONFIG__`).

**Working on Atlas or on the viewer:** `atlas dev` runs the server on a port of its own and the viewer's Vite dev
server in front of it. Vite proxies `/api` (server-sent events included) to the server, so the browser, the
uploaders and the viewer all use **one host**, exactly as in production, and a change to the viewer shows at once.

```sh
bunx atlas dev --data .atlas-data            # http://127.0.0.1:5180
ATLAS_STORE=http://127.0.0.1:5180 bunx atlas report publish --producer unit --junit out.xml
```

For containers, Kubernetes and CI see [running Atlas for a project](deploying.md).

## Configuration

Everything has a default, so no configuration is a working server for this machine. Settings come from
`atlas.server.json` (or `--config <file>` / `ATLAS_CONFIG`), then environment variables, then flags; a later one
wins. A mistake (an unknown key, a short token, two write targets, listening beyond this machine without tokens)
is said in words and the server does not start. The file has a published
[JSON Schema](https://github.com/crvouga/atlas/blob/main/packages/schema/schemas/server-config.schema.json)
(`@crvouga/atlas/schemas/server-config.schema.json`).

```json
{
  "$schema": "./node_modules/@crvouga/atlas/packages/schema/schemas/server-config.schema.json",
  "host": "0.0.0.0",
  "port": 8080,
  "data": "./atlas-data",
  "backends": [{ "id": "archive", "url": "s3://my-bucket/atlas/my-project?region=us-east-1", "label": "Archive" }],
  "write": "data",
  "auth": {
    "tokens": [
      { "name": "ci", "role": "publish", "tokenEnv": "ATLAS_CI_TOKEN" },
      { "name": "dashboard", "role": "read", "tokenEnv": "ATLAS_DASHBOARD_TOKEN" }
    ]
  },
  "include": { "branches": ["main"], "ignoreModified": true },
  "refreshSeconds": 10,
  "limits": { "maxObjectMiB": 256, "maxJsonMiB": 32, "maxStreams": 500 }
}
```

<!-- generated:server-settings -->
<!-- /generated:server-settings -->

`ATLAS_HOST` and `ATLAS_PORT` win over `HOST` and `PORT`, which other tools on a machine often set for their own
purposes.

## Backends

A backend is anything that implements `ObjectStore`: a folder, an S3-compatible bucket (`s3://`, `r2://`,
`gs://`), or **another Atlas server** (`https://…`, with `ATLAS_TOKEN` for it). The server reads every backend
and shows one report; one that is down is named in the viewer and skipped, and the server recovers by itself.

- **Uploads go to one backend**: the `data` folder, or the one named by `write` / `ATLAS_WRITE`. Name a bucket
  to make it the system of record, so the server holds nothing a replacement would lose:

  ```sh
  ATLAS_STORE=project=s3://my-bucket/atlas/my-project ATLAS_WRITE=project atlas serve
  ```

- **Layers written to a backend by something else** (CI with bucket access, `atlas report merge`) are found at
  the next refresh. Layers uploaded through the server are in the report at once.
- **A server can be a backend of another**: a local server reading the project's shared one shows both.

## Tokens and roles

| Role | May |
| --- | --- |
| `read` | look: the viewer, the report, `/api/status` |
| `publish` | also upload layers, specs and runs, and remove the scratch objects `atlas report doctor` writes |
| `admin` | all server operations |

Tokens are at least 12 characters (`openssl rand -hex 24`) and different from one another. Give them as
`ATLAS_TOKEN` (admin), `ATLAS_PUBLISH_TOKEN`, `ATLAS_READ_TOKEN`, or under `auth.tokens` in the file, preferably
with `tokenEnv` so the file holds no secret.

- **Sending a token:** `Authorization: Bearer <token>`. A browser's sign-in box also works for *looking* (any
  user name, the token as the password). **Uploading needs the Bearer header, never the sign-in box**: a browser
  sends those credentials by itself to any page that asks, which would let another site upload with them.
- **No tokens** means open, and then the server refuses to listen beyond this machine unless told
  `--insecure` (for when a proxy in front does the signing in).
- `/healthz` and `/readyz` never need a token, so a load balancer can use them.
- Only this server's own clients need tokens; Atlas does not do accounts. Put it behind what your company already
  uses (Cloudflare Access, an ALB with OIDC, `oauth2-proxy`, Tailscale) and TLS ends there too.

## Sending results

Every route ends as the same immutable layers, so use what fits:

| From | How |
| --- | --- |
| a CI job or laptop, after the run | `ATLAS_STORE=https://atlas.example.com ATLAS_TOKEN=… atlas report publish --producer unit --junit out.xml --specs ./specs` |
| a suite that can print JSON lines | `my-suite --json \| atlas report stream --producer e2e --environment ios` |
| code | `createReporter(identity, { store: httpStore({ url, token }) })`, below |
| anything that can make a request | `POST /api/checks` with a JSON body |
| a folder of layers you already have | `atlas report merge --store ./layers --into https://atlas.example.com` |

`ATLAS_STORE` may name the server instead of a folder or bucket: **every `atlas report` command works against it**
(`publish`, `stream`, `merge --into`, `doctor`, `status`). Keys never go in the URL; put the token in
`ATLAS_TOKEN` (or the first line of the file named by `ATLAS_TOKEN_FILE`). **A token belongs to one server.** With
one server in `ATLAS_STORE`, `ATLAS_TOKEN` is its token; with several, name each (`lab=https://lab.example.com`) and give
it `ATLAS_TOKEN_LAB`, because `ATLAS_TOKEN` is then sent to none of them. A token is never sent over plain `http://`
beyond this machine (`ATLAS_TRUST_NETWORK=1` says the network is yours).

### Streaming a run as it happens

`atlas report stream` reads one check per line (the fields of a check: `id`, `title`, `status`, and any
[evidence](extending.md)) and sends what has finished every second as a layer. A check sent first as `running` and
then as `passed` is two layers; the later, completed one wins, so the report follows the suite while it runs and
agrees with it when it ends. A layer that cannot be sent is kept and sent again, byte for byte the same, so a
retry never makes a second layer. It exits 1 if anything could not be sent.

```ts
import { createReporter } from '@crvouga/atlas/reports/reporter';
import { httpStore } from '@crvouga/atlas/reports/http-store';

const reporter = createReporter(
  { producer: 'web-e2e', environment: 'desktop-web', branch: process.env.GITHUB_REF_NAME ?? null },
  { store: httpStore({ url: 'https://atlas.example.com', token: process.env.ATLAS_TOKEN }), flushMs: 1000 }
);
reporter.check({ id: 'checkout > pays', title: 'pays', status: 'running', specPath: 'specs/checkout.feature' });
// …
reporter.check({ id: 'checkout > pays', title: 'pays', status: 'passed', specPath: 'specs/checkout.feature', attachments: [{ name: 'end.png', data: png }] });
const { layers, checks, lost } = await reporter.close();   // never throws into the suite; `lost` counts what never arrived
```

### `POST /api/checks`

```sh
curl -X POST https://atlas.example.com/api/checks -H "authorization: Bearer $ATLAS_TOKEN" -d '{
  "producer": "smoke", "environment": "prod",
  "checks": [{ "id": "login", "title": "can log in", "status": "passed" }]
}'
# 201 {"ok":true,"id":"…","checks":1}
```

The body is [the checks file](integrating.md) (`recordedAtMs` defaults to now). Binary evidence goes in as
`base64`. Anything wrong is a `422` that says what.

### The store protocol

`httpStore` is an `ObjectStore` over `/api/store`, so `publishChecks`, spec sets, run uploads and `copyStore` work
against a server unchanged. A client uploads **in dependency order**: blobs, then the manifest, then the catalog
entry that makes it visible. The server checks each step and says no to a catalog entry whose manifest is not
there (`409`), so nothing half-uploaded is ever shown.

## Streaming

`GET /api/events` is a server-sent-events stream:

| Event | Data | Meaning |
| --- | --- | --- |
| `hello` | `{ version, ready, time }` | Sent first. The report's current version. |
| `report` | `{ version, totalLayers, added: [{ id, producer, environment, branch, sha, recordedAtMs, counts }], addedTotal }` | Layers arrived. Enough to say who sent what, without asking. |
| `atlas:change` | `{ scope: "specs" \| "runs", files, runIds }` | New specs or runs. |
| `ping` | `{}` | Every 15 s, so proxies keep the connection and the viewer can tell a quiet server from a dead connection. |

Events say *that* something changed; the state is always fetched. A viewer that missed some (a dropped
connection, a laptop that slept) loses nothing: it reads again when it reconnects, and the viewer also reads on a
slow timer behind the stream. Past `limits.maxStreams` viewers the server answers `503` with `Retry-After` and the
viewer polls instead; a viewer that stops reading is let go rather than held in memory.

### Reading only what changed

`GET /api/reports/evidence/effective` is the whole report: only the layers that win a check, each with only the
rows that win, with an ETag. A viewer that holds a version asks `?since=<version>` and is sent **only the layers
that changed since, and the ids that no longer win anything** (`"delta": true`). Applying that gives exactly the
report the server would have sent whole (`applyEffectiveDelta`, tested against every earlier version of random
runs); a version the server does not remember, or an older server, answers with the whole report, which a viewer
takes as it always did. A result streamed into a 100 000-check report costs a viewer a few kilobytes.

## API reference

<!-- generated:server-operations -->
<!-- /generated:server-operations -->

Errors are always [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem documents (`application/problem+json`: `type`,
`title`, `status`, and a `detail` that says what to do; `error` repeats `detail` for older clients) with a status that says
what to do: `401` send a token, `403` that token may not, `409` upload what this depends on first or you are changing
something immutable, `413` too large, `422` not valid, `503` still starting (see `Retry-After`).

**For agents:** a server describes itself. `GET /api/openapi.json` is the OpenAPI 3.1 description of everything above (also
shipped as `@crvouga/atlas/openapi.json`) and `GET /llms.txt` is a guide for an agent that was handed only the server's address;
neither needs a token. See [Atlas for AI agents](agents.md).

## What the server refuses

What is checked is what would otherwise corrupt the report for everyone, and it is checked from the bytes in hand:

- **Everything is named by its content.** A manifest whose content does not hash to its id (it was edited, or written
  by something that does not follow the format) is refused, as is one that is not a valid layer; so is a blob
  (the digest of what is in it) or a spec file that is not what its name says.
- **Dependencies come first.** A manifest needs its blobs; a catalog entry needs its manifest; a spec set needs its
  files; a run's catalog entry needs its manifest.
- **Layers are immutable.** The same bytes again are fine (a retry); other bytes under the same key are a `409`.
- **A run that did not pass its privacy scan is never shared.**
- **Only keys Atlas writes**, under `layers/`, without traversal, backslashes or control characters.
- **Size.** Bodies over `limits.maxObjectMiB` are refused as they arrive, not after they were held.
- **Attachment bytes are untrusted.** They are served only through one function that forces a safe type and a
  sandbox, whatever the producer claimed.

## Performance

`bun packages/server/bench/bench.ts [layers] [checks]` seeds a long history and measures the server on it. On a
laptop with 2 000 layers of 100 checks (200 000 results, 10 000 slots) and with 1 000 layers of 1 000 checks
(100 000 slots, a 22 MB report):

| | 10 000 slots | 100 000 slots |
| --- | --- | --- |
| Start: read and fold every layer | 0.4 s | 1.7 s |
| A refresh with nothing new | 4 ms | 4 ms |
| Upload one layer → every viewer told | 4 ms | 5 ms |
| `GET effective`, cached / `304` | 1 ms / 0.2 ms | 13 ms / 0.5 ms |
| `GET status`, cached for the version | 12 ms first | 70 ms first |

What makes it so, none of it at the cost of the contract:

- **A layer is read once.** The report is folded incrementally; only layers that still hold a winner are kept, so
  memory follows the number of checks and not the age of the project.
- **A change costs one layer.** Each layer remembers the JSON of what it sends, the version is a hash of per-layer
  digests, and a delta lists only layers that changed, so the work to take in a result does not grow with the
  report.
- **An upload is read once.** A layer's manifest is parsed and verified when it arrives and handed to the report,
  not read again; blob existence is asked 16 at a time.
- **The newest end of the catalog is all a refresh looks at**, with a full look now and then.
- **Compressed once.** The viewer's files are brotli-compressed once (gzip for clients that cannot read it), a
  report version is gzipped once however many viewers fetch it, and events are encoded once for every viewer.
- **A small viewer.** The graph, the Gherkin parser, the recording player and the finder load when used: the
  first page is about 250 KB over the wire.

## Operating it

- **One server per project.** It is a singleton by design: local environments and CI all talk to it, and it tells
  every viewer at once. Two servers on one backend both work and show the same report, but a viewer hears about
  an upload only from the server that took it and about the other's at the next refresh, so give a team one.
- **State is the write backend.** Back up `./atlas-data` (or the bucket). Restoring it, or starting a new server
  on it, shows the same report.
- **Stopping.** `SIGTERM` stops accepting, lets requests in flight finish, ends the event streams and exits 0.
- **Logs.** One JSON line per request (method, path, status, ms) to stdout, none for the probes. The first lines
  say what it reads and which backend takes uploads, and warn when there are no tokens.
- **A backend goes down.** The server keeps serving what it has, names the backend in the viewer and in
  `/readyz`, and recovers by itself. The gate fails closed: unknown is not a pass.
- **Upgrades.** The layer format is a stable, versioned contract; upgrade the server before the clients that
  publish when a release says the format moved.
