# The Atlas server

One node for multiple projects that **takes in results from every environment, keeps them, and shows everyone the
combined report, live**. It is a Bun API that serves a Vite-built single-page client: one host, one port, in
development and in production.

```
  laptop ──────┐                                        ┌── browsers  (the client: reads /api, listens on /api/events)
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
- **The report is live.** Every client holds one server-sent-events connection; when results arrive the server
  says so and each client reads only what changed ([streaming](#streaming)).
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

<!-- generated:runtime-requirements -->
Supported runtimes (from `package.json`): **node `>=22.18.0`** or **bun `>=1.2.0`**. Node consumers do not need Bun unless they use the Bun WebView driver.
<!-- /generated:runtime-requirements -->

The first start builds the client once into `~/.cache/atlas/site`
(or serves `./atlas-site`, or `--site <dir>`); the build is the same for every project, because the server writes
its own address book into the page (`window.__ATLAS_CONFIG__`).

**Working on Atlas or on the client:** `atlas dev` runs the server on a port of its own and the client's Vite dev
server in front of it. Vite proxies `/api` (server-sent events included) to the server, so the browser, the
uploaders and the client all use **one host**, exactly as in production, and a change to the client shows at once.

```sh
bunx atlas dev --data .atlas-data            # http://127.0.0.1:5180
ATLAS_STORE=http://127.0.0.1:5180 bunx atlas report publish --producer unit --junit out.xml
```

For Railway, deploy `ghcr.io/crvouga/atlas:latest` directly: the image contains the server and
viewer, and every green `main` push updates it. See [running Atlas for a project](deploying.md#run-it) for
Railway's volume, tokens, healthcheck and image auto updates, or for Docker, Kubernetes and CI.
For anonymous reading, uploads and administration, use `ghcr.io/crvouga/atlas-insecure:latest` with no tokens
configured; see [deploying without authentication](deploying.md#deploy-without-authentication).

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
| Setting | File key | Flag | Environment | Default |
| --- | --- | --- | --- | --- |
| Address to listen on | `host` | `--host <address>` | `ATLAS_HOST`, `HOST` | `127.0.0.1` |
| Port (`0` picks a free one) | `port` | `--port <n>` | `ATLAS_PORT`, `PORT` | `8080` |
| The server's own folder: the default backend and write target | `data` | `--data <dir>` | `ATLAS_DATA` | `./atlas-data` |
| More backends, read together with the data folder | `backends` | `--store <[id=]url>` (repeatable) | `ATLAS_STORE` | none |
| The backend uploads go to | `write` | `--write <id>` | `ATLAS_WRITE` | `data` |
| The built client | `site` | `--site <dir>` | `ATLAS_SITE` | `./atlas-site`, else built once |
| Whose specs the report is laid over | `outlineBranch` | `--outline-branch <branch>` | `ATLAS_OUTLINE_BRANCH` | `main`, then `master`, then the newest |
| Only layers recorded on these branches take part | `include.branches` | `--branch <name>` (repeatable) | `ATLAS_ONLY_BRANCH` | all |
| Leave out layers from modified checkouts and unknown origins | `include.ignoreModified` | `--ignore-modified` | `ATLAS_IGNORE_MODIFIED` | no |
| How often (seconds) the backends are looked at for layers written by something else | `refreshSeconds` | `--refresh <seconds>` | `ATLAS_REFRESH_SECONDS` | `10` |
| Let anyone look, not upload | `auth.anonymousRead` | `--anonymous-read` | `ATLAS_ANONYMOUS_READ` | no |
| Listen publicly with no tokens (something in front signs people in) | `auth.insecure` | `--insecure` | `ATLAS_INSECURE` | no |
| The admin token (also `ATLAS_PUBLISH_TOKEN` and `ATLAS_READ_TOKEN` for the other roles, or `auth.tokens` in the file) | `auth.tokens` |  | `ATLAS_TOKEN` | none: the server is open and listens on this machine only |
| The configuration file | `(the file itself)` | `--config <file>` | `ATLAS_CONFIG` | `./atlas.server.json` when it exists |
| Largest uploaded object in MiB | `limits.maxObjectMiB` |  | `ATLAS_MAX_OBJECT_MIB` | `256` |
| Largest JSON upload in MiB | `limits.maxJsonMiB` |  | `ATLAS_MAX_JSON_MIB` | `32` |
| Maximum simultaneous live viewers | `limits.maxStreams` |  | `ATLAS_MAX_STREAMS` | `500` |
| Live connection heartbeat in seconds | `heartbeatSeconds` |  | `ATLAS_HEARTBEAT_SECONDS` | `15` |
| Live producer heartbeat timeout in seconds | `runTimeoutSeconds` |  | `ATLAS_RUN_TIMEOUT_SECONDS` | `30` |
| Live run progress stall timeout in seconds (0 disables) | `runStallSeconds` |  | `ATLAS_RUN_STALL_SECONDS` | `900` |
| No request log | `log` | `--no-log` | `ATLAS_LOG` | one JSON line per request |
<!-- /generated:server-settings -->

`ATLAS_HOST` and `ATLAS_PORT` win over `HOST` and `PORT`, which other tools on a machine often set for their own
purposes.

## Backends

A backend is anything that implements `ObjectStore`: a folder, an S3-compatible bucket (`s3://`, `r2://`,
`gs://`), or **another Atlas server** (`https://…`, with `ATLAS_TOKEN` for it). The server reads every backend
and shows one report; one that is down is named in the client and skipped, and the server recovers by itself.

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
| `read` | look: the client, the report, `/api/status` |
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

## Tagging artifacts

A reviewer can mark a recording `#demo` after it was uploaded without uploading it again. The layer is immutable, so the
tag is kept beside it: each edit is one small object under `curation/artifact-tags/` in the write backend (or the live
store of a relay), named by time, never changed or removed. It records the attachment (layer, check, and the attachment's
`id`, else its bytes' key, else its name), the normalized tags added and removed, the name of the token that made the
edit, and the server's time. Nothing about the layer, its results or the report's winners changes.

- `GET /api/reports/artifact-tags` (read) returns every edit, oldest first. Fold them to get the tags that stand now: the
  last edit of a tag wins.
- `POST /api/reports/artifact-tags` (publish, `Authorization: Bearer`) records an edit. A read token, an anonymous reader
  and the browser's sign-in box are refused (`403`/`401`) like any upload, so a read-only visitor can see the tags and
  not change them. The viewer asks for a token when a reviewer adds a tag and keeps it only in that tab.
- Producer tags (`tags` on the attachment) and reviewer tags are kept apart everywhere: the viewer says who added a
  reviewer tag and when, and a reviewer can remove only reviewer tags. `capabilities.artifactTags` on `/api/server` says
  a server has this.

See [Tagging artifacts and demos](rich-evidence.md#tagging-artifacts-and-demos) for the tag rules. Reviewer tags are
shown in the viewer's evidence; the tests API (`artifactTag`) searches the producers' tags.

## Streaming

`GET /api/events` is a server-sent-events stream:

| Event | Data | Meaning |
| --- | --- | --- |
| `hello` | `{ version, ready, time, heartbeatMs? }` | Sent first. The report's current version. |
| `report` | `{ version, totalLayers, added: [{ id, producer, environment, branch, sha, recordedAtMs, counts }], addedTotal }` | Layers arrived. Enough to say who sent what, without asking. |
| `atlas:change` | `{ scope: "specs" \| "runs", files, runIds }` | New specs or runs. |
| `run` | A bounded `LiveRun` snapshot | Start, progress logs, heartbeat, completion, and interruption; no producer credentials. |
| `projects` | `{}` | Another project was discovered; refresh the project picker. |
| `ping` | `{}` | Every 15 s, so proxies keep the connection and the client can tell a quiet server from a dead connection. |

Run events update progress directly in the client cache. Report and specification events trigger coalesced reads of the affected data. Events arriving during a read cause a trailing refresh rather than cancelling that read. A client that missed some (a dropped
connection, a laptop that slept) loses nothing: it reads again when it reconnects, and the client also reads on a
slow timer behind the stream. Past `limits.maxStreams` viewers the server answers `503` with `Retry-After` and the
client polls instead; a client that stops reading is let go rather than held in memory.

### Reading only what changed

`GET /api/reports/evidence/effective` is the whole report: only the layers that win a check, each with only the
rows that win, with an ETag. A client that holds a version asks `?since=<version>` and is sent **only the layers
that changed since, and the ids that no longer win anything** (`"delta": true`). Applying that gives exactly the
report the server would have sent whole (`applyEffectiveDelta`, tested against every earlier version of random
runs); a version the server does not remember, or an older server, answers with the whole report, which a client
takes as it always did. A result streamed into a 100 000-check report costs a client a few kilobytes.

## Reading the report as an agent

The effective report says what each check's result is now. To explore a project, or to answer "what is tested,
where, how long does it take, what is flaky", read the tests instead. Every endpoint here answers JSON, or Markdown
with `format=markdown` (or `Accept: text/markdown`), and takes the project prefix like every other
(`/api/projects/<slug>/reports/tests`).

| Ask | Endpoint |
| --- | --- |
| Every test, a summary (by status, environment, producer, domain), insights (failing, flaky, slowest) and facets | `GET /api/reports/tests` |
| Only some: `q` (all words), `status` (or `flaky`), `environment`, `producer`, `domain`, `spec`, `tag`, `run`; `sort`, `offset`, `limit` | `GET /api/reports/tests?status=failed&environment=ios` |
| One test: every recorded result (status, duration, environment, branch, commit, CI run), newest first | `GET /api/reports/tests/history?key=<key>` |
| Why Specs, domains and counts disagree: ambiguous spec paths, shared domains, gaps, a reconciliation of the totals | `GET /api/reports/tests/health` |
| The runs that recorded the report (by CI run URL, else branch and commit); `?video=true` keeps those with a playable video | `GET /api/reports/runs` |
| Every test one run recorded | `GET /api/reports/runs/detail?key=<run key>` |

```sh
curl "$ATLAS_SERVER_URL/api/projects/$ATLAS_PROJECT/reports/tests?format=markdown&limit=50"
```

- A **test** is a check identity, its spec path and id, across producers and environments. `outcomes` holds its
  current result on each environment (the report's winners, so a test's status here is always the gate's);
  `stats` describes its recorded history: pass rate, flips, whether it is flaky and why (it passed and failed on the
  same commit, passed only after a retry, or its producer said so), durations (avg, p50, p95, min, max, last), runs
  and branches.
- The **health** document explains the numbers instead of adding one. It keeps spec files, defined specs, specs with an
  executed test, tests, outlines, examples and per-environment observations apart, and walks from the Specs total to
  the Tests total. Two spec paths are one logical spec only when a mapping says so
  (`?root=<from>><to>`, for example `?root=%3Especs/` to put `checkout/cart.feature` under `specs/`); similar paths
  are reported as ambiguous and never merged, and a similar title is never an identity. Give a check the label
  `outline` to say which scenario outline an example belongs to. A domain shared by nearly every spec is flagged, but
  explicit domain metadata always stays authoritative. The document only reads: it changes no status.
- The server keeps the newest 100 results of every test (progress reported as `running` is not history) and every run's last result per test, in memory, as layers
  arrive; it is rebuilt from the layers on restart. History never changes a result.
- Without a published spec set, tests are grouped under the specs their layers recorded (`specs[]`: path, domain,
  title), and the gate and the outline do the same, so a project needs no spec set to be browsable. A path no layer
  described is titled from its file name and grouped by its folder under `specs/`.
- Statistics are only as rich as what producers send: durations need `durationMs`, devices need an environment and
  labels (`browser`, `device`, `os`), videos and screenshots need attachments. See
  [Send rich evidence](rich-evidence.md).

## API reference

<!-- generated:server-operations -->
| Method and path | Role | |
| --- | --- | --- |
| `GET /api/projects` | read | List projects on this Atlas node. |
| `GET /api/live` | read | Live test progress and recent invocations. |
| `GET /api/projects/{project}/live` | read | Live test progress and recent invocations. |
| `POST /api/live/{id}` | publish | Start a live producer lease. |
| `POST /api/projects/{project}/live/{id}` | publish | Start a live producer lease. |
| `PATCH /api/live/{id}` | publish | Publish progress or finish an invocation. |
| `PATCH /api/projects/{project}/live/{id}` | publish | Publish progress or finish an invocation. |
| `POST /api/live/{id}/heartbeat` | publish | Renew a producer heartbeat. |
| `POST /api/projects/{project}/live/{id}/heartbeat` | publish | Renew a producer heartbeat. |
| `GET /admin` | read | Server settings page. |
| `GET /api/settings` | admin | Read server settings. |
| `PUT /api/settings` | admin | Save settings for the next restart. |
| `GET /healthz` | none | Is the process up. |
| `GET /readyz` | none | Has the server read its backends. |
| `GET /api/openapi.json` | none | This document. |
| `GET /llms.txt` | none | How to use this server, for an agent. |
| `GET /api/server` | read | What this server is and who is asking. |
| `GET /api/events` | read | Server-sent events: results arrived, specs or runs changed. |
| `GET /api/projects/{project}/events` | read | Server-sent events: results arrived, specs or runs changed. |
| `GET /api/reports/evidence/effective` | read | The whole report, or only what changed since a version. |
| `GET /api/projects/{project}/reports/evidence/effective` | read | The whole report, or only what changed since a version. |
| `GET /api/status` | read | The gate: does the report pass. |
| `GET /api/projects/{project}/status` | read | The gate: does the report pass. |
| `POST /api/checks` | publish | Upload one layer of checks as JSON. |
| `POST /api/projects/{project}/checks` | publish | Upload one layer of checks as JSON. |
| `GET /api/store` | read | List keys under layers/. |
| `GET /api/projects/{project}/store` | read | List keys under layers/. |
| `GET /api/store/{key}` | read | Read an object. |
| `GET /api/projects/{project}/store/{key}` | read | Read an object. |
| `HEAD /api/store/{key}` | read | Does an object exist. |
| `HEAD /api/projects/{project}/store/{key}` | read | Does an object exist. |
| `PUT /api/store/{key}` | publish | Upload an object. |
| `PUT /api/projects/{project}/store/{key}` | publish | Upload an object. |
| `DELETE /api/store/{key}` | publish | Remove a scratch object. |
| `DELETE /api/projects/{project}/store/{key}` | publish | Remove a scratch object. |
| `GET /api/reports/tests` | read | Every test, with insights, facets and history statistics. |
| `GET /api/projects/{project}/reports/tests` | read | Every test, with insights, facets and history statistics. |
| `GET /api/reports/tests/health` | read | Why specs, domains and counts disagree. |
| `GET /api/projects/{project}/reports/tests/health` | read | Why specs, domains and counts disagree. |
| `GET /api/reports/tests/history` | read | One test and every result recorded for it. |
| `GET /api/projects/{project}/reports/tests/history` | read | One test and every result recorded for it. |
| `GET /api/reports/artifact-tags` | read | Reviewer tags of attachments: every recorded edit. |
| `GET /api/projects/{project}/reports/artifact-tags` | read | Reviewer tags of attachments: every recorded edit. |
| `POST /api/reports/artifact-tags` | publish | Tag or untag one attachment after upload. |
| `POST /api/projects/{project}/reports/artifact-tags` | publish | Tag or untag one attachment after upload. |
| `GET /api/reports/runs` | read | The runs that recorded the report. |
| `GET /api/projects/{project}/reports/runs` | read | The runs that recorded the report. |
| `GET /api/reports/runs/detail` | read | Every test one run recorded. |
| `GET /api/projects/{project}/reports/runs/detail` | read | Every test one run recorded. |
| `GET /api/reports/outline` | read | The specs a report is laid over. |
| `GET /api/projects/{project}/reports/outline` | read | The specs a report is laid over. |
| `GET /api/reports/outline/spec` | read | The text of one spec. |
| `GET /api/projects/{project}/reports/outline/spec` | read | The text of one spec. |
| `GET /api/reports/evidence` | read | Page through every layer header. |
| `GET /api/projects/{project}/reports/evidence` | read | Page through every layer header. |
| `GET /api/reports/evidence/rows/{backend}/{id}` | read | The checks of one layer. |
| `GET /api/projects/{project}/reports/evidence/rows/{backend}/{id}` | read | The checks of one layer. |
| `GET /api/reports/evidence/detail/{backend}/{id}` | read | Everything one result carries. |
| `GET /api/projects/{project}/reports/evidence/detail/{backend}/{id}` | read | Everything one result carries. |
| `GET /api/reports/layers/{id}/blobs/{bundleKey}` | read | A file a layer carries. |
| `GET /api/projects/{project}/reports/layers/{id}/blobs/{bundleKey}` | read | A file a layer carries. |
| `GET /api/reports/layers/{id}/{path}` | read | A recorded test of a statechart run. |
| `GET /api/projects/{project}/reports/layers/{id}/{path}` | read | A recorded test of a statechart run. |
| `GET /api/reports/live/{source}/frame.css` | read | Frame stylesheet of a live spec run (development only). |
| `GET /api/projects/{project}/reports/live/{source}/frame.css` | read | Frame stylesheet of a live spec run (development only). |
| `GET /api/reports/live/{source}/tests/{testId}/{path}` | read | A file of a test in a live spec run (development only). |
| `GET /api/projects/{project}/reports/live/{source}/tests/{testId}/{path}` | read | A file of a test in a live spec run (development only). |
| `GET /api/data/sources.json` | read | The sources the viewer reads. |
| `GET /api/projects/{project}/data/sources.json` | read | The sources the viewer reads. |
| `GET /api/data/specs/index.json` | read | The spec files. |
| `GET /api/projects/{project}/data/specs/index.json` | read | The spec files. |
| `GET /api/data/specs/{file}` | read | One spec file. |
| `GET /api/projects/{project}/data/specs/{file}` | read | One spec file. |
| `GET /api/data/runs/index.json` | read | The statechart runs. |
| `GET /api/projects/{project}/data/runs/index.json` | read | The statechart runs. |
| `GET /api/data/runs/{id}/{path}` | read | A file of an uploaded run. |
| `GET /api/projects/{project}/data/runs/{id}/{path}` | read | A file of an uploaded run. |

Every operation, parameter, body, response and error is in [the HTTP API reference](reference/http-api.md) and, for tools, in `openapi.json`.
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
| Upload one layer → every client told | 4 ms | 5 ms |
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
- **Compressed once.** The client's files are brotli-compressed once (gzip for clients that cannot read it), a
  report version is gzipped once however many viewers fetch it, and events are encoded once for every client.
- **A small client.** The graph, the Gherkin parser, the recording player and the finder load when used: the
  first page is about 250 KB over the wire.

## Operating it

- **One node for multiple projects.** Local environments and CI select their project slug and talk to the same node, which tells
  every client at once. Two servers on one backend both work and show the same report, but a client hears about
  an upload only from the server that took it and about the other's at the next refresh, so give a team one.
- **State is the write backend.** Back up `./atlas-data` (or the bucket). Restoring it, or starting a new server
  on it, shows the same report.
- **Stopping.** `SIGTERM` stops accepting, lets requests in flight finish, ends the event streams and exits 0.
- **Logs.** One JSON line per request (method, path, status, ms) to stdout, none for the probes. The first lines
  say what it reads and which backend takes uploads, and warn when there are no tokens.
- **A backend goes down.** The server keeps serving what it has, names the backend in the client and in
  `/readyz`, and recovers by itself. The gate fails closed: unknown is not a pass.
- **Upgrades.** The layer format is a stable, versioned contract; upgrade the server before the clients that
  publish when a release says the format moved.

## Configure from the client

Open **Settings** (`/admin`) and enter an admin token. The token stays in page memory. Read and publish tokens cannot edit settings; the browser sign-in box only grants reading. The API uses `Authorization: Bearer` and refuses cross-origin browser writes.

Use the Storage, Live updates, and Report rules forms to edit saved settings. Advanced includes request limits, logging, a JSON editor, and a read-only view of the active configuration. Save changes and restart Atlas to apply them. Atlas validates the configuration and atomically replaces `atlas.server.json`, preserving authentication and deployment settings. Changes apply at the next restart; environment variables and flags retain precedence. Concurrent edits require reloading the current revision. Data is never moved or removed by changing settings. Keep an old backend as a read source when moving future uploads to a new one. Embedded servers can provide their own settings persistence or manage configuration outside this API.

Native test reporters for CodeceptJS, Mocha, Jest and Node upload directly to this server; see [runner setup](runners.md). Every publisher uses the same server address and only a publish token. Storage credentials belong in the server environment.

## Live test runs and heartbeats

The default native reporters and statechart runner stream tests and steps through `/api/live`, before the invocation finishes. Running tests appear inside their report with an animated status mark and the latest step. Open a test to read its progress log; its previous recorded result stays available separately. The **Running** filter narrows both the spec list and the test rows, and counts update as tests finish or time out. Statechart tests appear inside the chart and screen details. Selecting an archived run leaves live progress out of that historical view. Finished checks immediately enter normal immutable report layers. Operational progress is separate from historical winners, so a previous passed result never implies that the current invocation passed.

Start with `POST /api/live/<uuid>`, send ordered check deltas with `PATCH /api/live/<uuid>`, and renew the producer lease with `POST /api/live/<uuid>/heartbeat` every 5 seconds. Finish with a terminal update. Only the publisher token that registered the invocation can update it. Replayed sequences must have identical content; late writes cannot revive an expired invocation. `createLiveReporter` handles batching, retries, heartbeat timers and the final flush.

The server uses its own receipt clock. By default it interrupts a run after 30 seconds without a heartbeat (`ATLAS_RUN_TIMEOUT_SECONDS`). Heartbeats do not reset progress: after 15 minutes with no changed tests/steps, a separate stall timeout interrupts it (`ATLAS_RUN_STALL_SECONDS`, 0 disables). Both settings are editable in the admin UI. Healthy long tests continue renewing heartbeats; increase or disable the progress timeout for tests that legitimately make no observable progress for longer.

Interrupted runs retain completed results and show why the remaining work stopped. Missing outcomes never become passes. The server persists bounded summaries under `server/live/` in its write backend (an HTTP relay keeps operational leases in its own data folder; the remote server only accepts immutable report objects) and restores outstanding leases as interrupted after a server restart. S3 server credentials need GetObject/PutObject for that prefix; generate the updated `atlas report policy --role both` policy. Producers still receive no backend credentials. Live `run` events carry bounded snapshots directly into test rows, including step logs and interruption reasons. The legacy `atlas:change` announcement remains available for older clients; its optional `liveRunId` identifies lease updates. Reconnecting viewers re-fetch progress, reports, and specifications. With SSE connected, live progress uses a 60-second safety refresh; without SSE it polls every two seconds. Returning to the tab or coming back online also revalidates reports and progress.

In this repository, use `bun atlas` and `bun example:run` in two terminals. Every example Gherkin scenario executes, including sharing and renaming; `@unrecorded` no longer excludes tests.

## Multiple projects on one node

Start the node with `atlas server` (or `bun atlas` in this repository). The server builds or finds the Atlas client and serves it with the API from one process. It never imports a consumer or an example. In this repository the node uses port 5180 and `./atlas-data`; `bun example:run` publishes the Todo app to project `todo-app`.

Set `ATLAS_PROJECT=todo-app` alongside `ATLAS_SERVER_URL` for native reporters and statechart runs. Report CLI commands accept `--project todo-app` (or `ATLAS_PROJECT`) with an HTTP store. Programmatic HTTP stores, live reporters and native reporter options accept `project: 'todo-app'`. Keep the same slug for the invocation's live progress, final results, spec sets and recordings. Slugs use 1–64 lowercase letters, digits or hyphens, starting and ending with a letter or digit.

Every project API is available as `/api/projects/<slug>/…`, for example `/api/projects/todo-app/checks`, `/api/projects/todo-app/events` and `/api/projects/todo-app/reports/evidence/effective`. The unprefixed API accepts optional `?project=todo-app` or `X-Atlas-Project: todo-app`. Conflicting selectors are refused. `GET /api/projects` discovers projects. A successful authenticated upload creates a project; reads of an unknown project return 404.

Projects isolate check identities, specs, run IDs, recordings, lease summaries, event streams and report caches. Identical layer bytes are preserved as uploaded. The node stores each project's objects under `projects/<slug>/` and discovery markers under `server/projects/`. Unqualified requests continue reading the legacy default namespace, advertised as **Default** when it has reports. Existing data is never implicitly moved. For S3, use the combined server policy (`atlas report policy --role both`) with access to both project namespaces and the catalog. An HTTP relay selects the same project on its upstream node and keeps discovery and leases locally.

The project picker sits at the top right; the header also provides spec dropdown breadcrumbs. Project selection lives in the page URL, so links and refreshes preserve it. Switching projects reloads the client, clearing report queries, media and event connections. Custom report-source preferences are keyed by the project's data URL. Project namespaces share the node's authentication roles: they are organizational partitions, not separate tenant authorization policies. Settings and server identity remain node-wide.

Project indexes are opened lazily; at most 64 are active in memory. An index with no active requests or event subscribers is closed after five idle minutes. Event subscribers share the node-wide stream limit. Project discovery lists only small catalog markers, never every report layer.
