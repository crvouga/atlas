# HTTP API reference

> Generated from the operation table in `packages/server/src/openapi.ts` by `bun run docs`. Do not edit. The same description, for tools, is `openapi.json` (OpenAPI 3.1) and `GET /api/openapi.json` on every server.

### Is the process up

`GET /healthz` · role: none

Answers `200` as long as the process runs, whatever its backends are doing. Use it as a liveness probe. It needs no token and is not logged.

Responses: `200` The process is up.

### Has the server read its backends

`GET /readyz` · role: none

Answers `200` once the first pass over the backends is done and at least one backend answers, `503` before that. Route traffic on it. The body counts what the report holds. No token needed.

Responses: `200` Ready.; `503` Not ready yet; the body is the same shape with `ready: false`.

### This document

`GET /api/openapi.json` · role: none

The OpenAPI 3.1 description of this API. No token needed, so a client that has only the server's address can learn how to use it.

Responses: `200` The OpenAPI document.

### How to use this server, for an agent

`GET /llms.txt` · role: none

A plain-text guide ([llms.txt](https://llmstxt.org)) written for an AI agent that was handed only this server's address: what it is, how to authenticate, the five commands that integrate a project, and where the machine-readable description is. No token needed.

Responses: `200` The guide, Markdown.

### What this server is and who is asking

`GET /api/server` · role: read

The role of the token of this request, which backend takes uploads, whether each backend is reachable, counts, and `capabilities`: check a capability by name before using the feature it names. `atlas report doctor` and the viewer use it.

Responses: `200` The server.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### Server-sent events: results arrived, specs or runs changed

`GET /api/events` · role: read

A `text/event-stream` that stays open. Events say *that* something changed; the state is always fetched, so a client that missed events (a dropped connection) loses nothing: read again on reconnect.

| event | data |
| --- | --- |
| `hello` | `{ version, ready, time }`, sent first |
| `report` | `{ version, totalLayers, added: [{ id, producer, environment, branch, sha, recordedAtMs, counts }], addedTotal }`: layers arrived |
| `atlas:change` | `{ scope: "specs" \| "runs", files, runIds }`: new specs or runs |
| `ping` | `{}` every `heartbeatSeconds`, so a quiet server is told apart from a dead connection |

Past `limits.maxStreams` viewers the answer is `503` with `Retry-After`: poll `/api/reports/evidence/effective` instead. A browser needs no code beyond `new EventSource("/api/events")`; other clients send the token as `Authorization: Bearer`.

Responses: `200` The stream.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` Too many viewers are connected; poll instead.

### The whole report, or only what changed since a version

`GET /api/reports/evidence/effective` · role: read

The report as it stands: only the layers that win at least one check, each with only the rows that win. Whatever the history behind it, this is one request.

`version` changes exactly when the report does, so it works as an ETag: send `If-None-Match` and get `304`. Better, send `?since=<version>` of the report you hold and get **only what changed** (`delta: true`): replace the layers of the same id, drop `removed`, keep the rest. If the server does not remember that version it answers with the whole report (no `delta` key), so a client always handles both.

To combine layers yourself, a check's *slot* is `(producer, kind, specPath, check id, environment, parameters)`; the newest completed result wins it. See `docs/report-contract.md`.

- `since` (query): The `version` of the report you hold.
- `if-none-match` (header): The ETag (the quoted version) of the report you hold.

Responses: `200` The whole report, or a delta when `since` was given and remembered.; `304` You already hold this version.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### The gate: does the report pass

`GET /api/status` · role: read

The `atlas report status --format json` document, worked out by the server from the layers it holds and remembered for each version of the report. It passes (`ok: true`) only if some check completed, none failed, none is still running, every layer and backend could be read, and every required environment has results. **Unknown is never a pass.**

The header `X-Atlas-Ok: true|false` carries the verdict, so a shell can test it without parsing. Narrow it by choice, per request: `branch` (repeatable) and `ignoreModified` read only matching layers.

- `branch` (query): Only layers recorded on this branch. Repeatable.
- `ignoreModified` (query): `1`: leave out layers from modified checkouts and unknown origins.
- `requireEnvironments` (query): Comma-separated environments that must have results.
- `requireAllSpecs` (query): `1`: fail while any spec of the outline has no results.

Responses: `200` The verdict, whether or not it passes.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Upload one layer of checks as JSON

`POST /api/checks` · role: publish

The simplest way in: anything that can make an HTTP request can report. The body is the checks file (`packages/schema/schemas/publish-checks.schema.json`); `recordedAtMs` defaults to now. Binary evidence goes in as `base64`. The server writes the layer and it is in every viewer's report before this answers.

Send the token as `Authorization: Bearer <token>` (a `publish` or `admin` token). A browser's sign-in box is refused for uploads on purpose. A check id appearing twice in one body is `422`.

Responses: `201` The layer was written.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `413` The body is over `limits.maxJsonMiB`.; `422` The body is not valid: the detail says which field.

### List keys under layers/

`GET /api/store` · role: read

One page of the keys of `layers/…` (never anything else), in code-unit order. Page with `after` = the `next` of the previous page. This is the `listPage` of the `ObjectStore` interface; `atlas report merge` and `httpStore` use it.

- `prefix` (query): Only keys starting with this. Default `layers/`.
- `after` (query): Only keys after this one (exclusive).
- `limit` (query): Page size, 1 to 1000. Default 1000.

Responses: `200` A page.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `422` The prefix is not one Atlas holds.

### Read an object

`GET /api/store/{key}` · role: read

The bytes of one object, with the content type it was stored with. Everything under `layers/` is immutable, so the answer is cacheable for good. The bytes came from a test run and are untrusted: they are served with `nosniff` and a sandboxing Content-Security-Policy, whatever type their uploader gave them.

- `key` (path, required): An object key under `layers/`, such as `layers/manifests/<id>.json`. It contains slashes, which are not percent-encoded; every other character is.

Responses: `200` The object.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such object.; `422` Not a key Atlas holds.

### Does an object exist

`HEAD /api/store/{key}` · role: read

`200` when the object exists, `404` when not. No body.

- `key` (path, required): An object key under `layers/`, such as `layers/manifests/<id>.json`. It contains slashes, which are not percent-encoded; every other character is.

Responses: `200` It exists.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such object.

### Upload an object

`PUT /api/store/{key}` · role: publish

The write half of the `ObjectStore` interface. The server checks what it can from the bytes in hand and says no to what would corrupt the report for everyone:

- a **layer manifest** (`layers/manifests/<id>.json`) must be a valid layer whose content hashes to `<id>`, and its blobs must already be there (`409` otherwise);
- a **blob** (`layers/blobs/<sha256>.gz`) must be gzip of content whose SHA-256 is its name; a **spec file** likewise;
- a **catalog entry** (`…/index/…`) must name something already uploaded (`409` otherwise): it is what makes a layer visible, so it is written last;
- a **run manifest** must have passed its privacy scan;
- keys are immutable: the same bytes again are `200` (a retry), other bytes under the same key are `409`.

Upload in dependency order: blobs, then the manifest, then the catalog entry. `atlas report publish`, `atlas report stream` and `httpStore` do. Needs a `Bearer` token of role `publish` or `admin`; a browser's sign-in box is refused.

- `key` (path, required): An object key under `layers/`, such as `layers/manifests/<id>.json`. It contains slashes, which are not percent-encoded; every other character is.
- `content-type` (header): Stored with the object and returned when it is read.

Responses: `200` Already there with the same bytes.; `201` Stored.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `409` A dependency has not been uploaded yet, or other bytes are already stored under this key.; `413` Over `limits.maxObjectMiB`.; `422` Not a key Atlas writes, or the content is not what its name says.

### Remove a scratch object

`DELETE /api/store/{key}` · role: publish

Only the scratch objects `atlas report doctor` writes (`layers/doctor-…`) can be removed. Layers, specs and runs are never removed through the API.

- `key` (path, required): An object key under `layers/`, such as `layers/manifests/<id>.json`. It contains slashes, which are not percent-encoded; every other character is.

Responses: `204` Removed (or it was not there).; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` Not a scratch object, or the token may not.

### The specs a report is laid over

`GET /api/reports/outline` · role: read

The specs of the newest committed spec set (of `main`, else the newest), so the report needs no checkout. A spec here with no result shows as having none.

Responses: `200` The outline.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### The text of one spec

`GET /api/reports/outline/spec` · role: read

The text of a spec file of the outline, by its path.

- `path` (query, required): The spec's path, `specs/<path>`.

Responses: `200` The spec text.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such spec in the outline.

### Page through every layer header

`GET /api/reports/evidence` · role: read

The history: layer headers newest first, merged from every backend. Prefer `/api/reports/evidence/effective`, which is one request and holds only what wins. Use this to audit what was recorded.

- `cursor` (query): The `cursor` of the previous page.

Responses: `200` A page of headers.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### The checks of one layer

`GET /api/reports/evidence/rows/{backend}/{id}` · role: read

Every check of one layer (not only those that win), with the spec fingerprints it recorded.

- `backend` (path, required): A backend id from `/api/server`.
- `id` (path, required): A layer id: 64 lowercase hex digits.

Responses: `200` The rows.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such layer in that backend.

### Everything one result carries

`GET /api/reports/evidence/detail/{backend}/{id}` · role: read

The timeline, annotations, retries, attachments and extensions of one check, and what its run carries as a whole. Without `check`, only the run's. Attachment bytes are fetched from `/api/reports/layers/{id}/blobs/{bundleKey}`.

- `backend` (path, required): A backend id from `/api/server`.
- `id` (path, required): A layer id: 64 lowercase hex digits.
- `check` (query): The check id.
- `kind` (query): The kind of the part, when the same id is in several.

Responses: `200` The detail.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such layer or check.

### A file a layer carries

`GET /api/reports/layers/{id}/blobs/{bundleKey}` · role: read

A screenshot, video, trace, log or any attachment of a layer, by the `bundleKey` its attachment names (`attachments/<sha256>`). Served as untrusted bytes: never sniffed, never run, sandboxed; immutable, cacheable for good; videos can be sought with `Range`.

- `id` (path, required): A layer id: 64 lowercase hex digits.
- `bundleKey` (path, required): The attachment's `bundleKey`, which contains a slash.
- `range` (header): A byte range, `bytes=0-1023`.

Responses: `200` The bytes, with the type the producer gave (or `application/octet-stream`).; `206` The requested range.; `304` Not modified.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such layer or file.

### A recorded test of a statechart run

`GET /api/reports/layers/{id}/{path}` · role: read

The `report.json`, captured files and frame stylesheet of a recorded statechart test of a layer (`tests/<testId>/report.json`, `tests/<testId>/files/…`, `frame.css`). Untrusted bytes, served like attachments.

- `id` (path, required): A layer id: 64 lowercase hex digits.
- `path` (path, required): The path under the layer.

Responses: `200` The file.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such file.

### Frame stylesheet of a live spec run (development only)

`GET /api/reports/live/{source}/frame.css` · role: read

For spec runs writing on the same machine as a development host (`atlas-visualizer dev`). A server has none: it answers `404`.

- `source` (path, required): The live source id.

Responses: `200` The stylesheet.; `404` Not a live source.

### A file of a test in a live spec run (development only)

`GET /api/reports/live/{source}/tests/{testId}/{path}` · role: read

For spec runs writing on the same machine as a development host. A server has none: it answers `404`.

- `source` (path, required): The live source id.
- `testId` (path, required): The test id.
- `path` (path, required): The path under the test.

Responses: `200` The file.; `404` Not a live source.

### The sources the viewer reads

`GET /api/data/sources.json` · role: read

The viewer's address book of data sources, in the shape a static host serves. A server has one source, itself.

Responses: `200` The sources file.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### The spec files

`GET /api/data/specs/index.json` · role: read

The files of the newest committed spec set, relative to `specs/`.

Responses: `200` The index.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### One spec file

`GET /api/data/specs/{file}` · role: read

The text of a spec file, with the digest of its content as `ETag`.

- `file` (path, required): The file's path relative to `specs/`.

Responses: `200` The text.; `304` Not modified.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such spec.

### The statechart runs

`GET /api/data/runs/index.json` · role: read

The newest uploaded statechart runs (`atlas report publish --manifest … --upload-run`), newest first.

Responses: `200` The index.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### A file of an uploaded run

`GET /api/data/runs/{id}/{path}` · role: read

A file of an uploaded run: its manifest, timelines, screenshots, clips. Untrusted bytes, served sandboxed; immutable.

- `id` (path, required): The run id.
- `path` (path, required): The path inside the run.

Responses: `200` The file.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such run or file.
