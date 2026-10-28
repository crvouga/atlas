# HTTP API reference

> Generated from the operation table in `packages/server/src/openapi.ts` by `bun run docs`. Do not edit. The same description, for tools, is `openapi.json` (OpenAPI 3.1) and `GET /api/openapi.json` on every server.

### List projects on this Atlas node

`GET /api/projects` · role: read

Projects are created on their first authenticated upload. All report, spec, recording and live-run data is isolated by project. Unqualified API calls address the legacy default project. Tokens retain their node-wide role; project partitioning is not a tenant authorization boundary.

Responses: `200` Available project identities.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The project catalog is unavailable.

### Live test progress and recent invocations

`GET /api/live` · role: read

Returns up to 50 recent producer leases, including running, completed and interrupted runs. Counters and recent check/step updates are bounded; authentication credentials are never returned. Consume run events for immediate bounded snapshots; re-fetch after reconnect or atlas:change with scope runs on older servers.

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` Recent live run summaries.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### Live test progress and recent invocations

`GET /api/projects/{project}/live` · role: read

Returns up to 50 recent producer leases, including running, completed and interrupted runs. Counters and recent check/step updates are bounded; authentication credentials are never returned. Consume run events for immediate bounded snapshots; re-fetch after reconnect or atlas:change with scope runs on older servers.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` Recent live run summaries.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### Start a live producer lease

`POST /api/live/{id}` · role: publish

Register a UUID run id and fixed producer identity before tests begin. Retrying the same identity and token is idempotent. The server timestamps receipt. Send heartbeats every 5 seconds and progress as tests execute. The default heartbeat timeout is 30 seconds; a 15-minute progress stall is configurable separately.

- `id` (path, required): Producer-generated UUID, also given in the body.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `201` The registered lease.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `409` The id already belongs to another invocation.; `413` Request too large.; `422` Invalid identity.; `429` Live run capacity reached.

### Start a live producer lease

`POST /api/projects/{project}/live/{id}` · role: publish

Register a UUID run id and fixed producer identity before tests begin. Retrying the same identity and token is idempotent. The server timestamps receipt. Send heartbeats every 5 seconds and progress as tests execute. The default heartbeat timeout is 30 seconds; a 15-minute progress stall is configurable separately.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `id` (path, required): Producer-generated UUID, also given in the body.

Responses: `201` The registered lease.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `409` The id already belongs to another invocation.; `413` Request too large.; `422` Invalid identity.; `429` Live run capacity reached.

### Publish progress or finish an invocation

`PATCH /api/live/{id}` · role: publish

Apply ordered check deltas, starting at sequence 1. Retry a sequence with identical content only. Completed results become immutable report layers immediately; running checks remain operational progress and do not replace historical winners. Finish as completed or interrupted. Stale updates cannot revive an expired lease; pending checks never become passes.

- `id` (path, required): The UUID of a run started with this publisher token.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` Updated progress.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `404` Unknown run.; `409` Run ended or sequence is stale.; `413` Request too large.; `422` Invalid progress.; `429` Run check capacity reached.

### Publish progress or finish an invocation

`PATCH /api/projects/{project}/live/{id}` · role: publish

Apply ordered check deltas, starting at sequence 1. Retry a sequence with identical content only. Completed results become immutable report layers immediately; running checks remain operational progress and do not replace historical winners. Finish as completed or interrupted. Stale updates cannot revive an expired lease; pending checks never become passes.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `id` (path, required): The UUID of a run started with this publisher token.

Responses: `200` Updated progress.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `404` Unknown run.; `409` Run ended or sequence is stale.; `413` Request too large.; `422` Invalid progress.; `429` Run check capacity reached.

### Renew a producer heartbeat

`POST /api/live/{id}/heartbeat` · role: publish

Renew a running lease using server receipt time, independently of test progress. No result layers are created. Heartbeats cannot revive terminal runs or bypass the configured progress-stall timeout. The producer token must be the one that started this invocation.

- `id` (path, required): The UUID of this producer invocation.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` Heartbeat received.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `404` Unknown run.; `409` Run ended or its lease expired.; `422` Invalid run id.

### Renew a producer heartbeat

`POST /api/projects/{project}/live/{id}/heartbeat` · role: publish

Renew a running lease using server receipt time, independently of test progress. No result layers are created. Heartbeats cannot revive terminal runs or bypass the configured progress-stall timeout. The producer token must be the one that started this invocation.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `id` (path, required): The UUID of this producer invocation.

Responses: `200` Heartbeat received.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `404` Unknown run.; `409` Run ended or its lease expired.; `422` Invalid run id.

### Server settings page

`GET /admin` · role: read

A standalone settings editor. Supply an admin Bearer token in the page to read or save configuration. The token is held only in memory.

Responses: `200` Settings editor.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### Read server settings

`GET /api/settings` · role: admin

Returns editable persisted storage/report settings, active settings, a revision, and configuration precedence. Authentication settings are excluded. Requires an admin Bearer token. Embedded applications may manage settings outside this API.

Responses: `200` Settings and revision.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `503` Configuration is managed by the embedding application.

### Save settings for the next restart

`PUT /api/settings` · role: admin

Replaces editable storage/report settings, preserving authentication and other file fields. Atomically persists a validated configuration; no report data is moved. Environment variables and flags override these values after restart. Requires an admin Bearer token, same-origin requests in browsers, and a current revision.

- `If-Match` (header, required): The quoted revision returned by GET /api/settings.

Responses: `200` Saved settings and new revision. Restart required.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `409` Settings changed; reload before saving.; `413` Settings exceed the body limit.; `422` Invalid configuration.; `428` A quoted settings revision is required.; `503` Configuration is managed by the embedding application.

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

A `text/event-stream` that stays open. Report events announce changes, and run events carry bounded live progress snapshots; authoritative state can always be fetched, so a client that missed events (a dropped connection) loses nothing: read again on reconnect.

| event | data |
| --- | --- |
| `hello` | `{ version, ready, time, heartbeatMs? }`, sent first |
| `report` | `{ version, totalLayers, added: [{ id, producer, environment, branch, sha, recordedAtMs, counts }], addedTotal }`: layers arrived |
| `atlas:change` | `{ scope: "specs" \| "runs", files, runIds }`: new specs or runs |
| `run` | A LiveRun snapshot after start, progress, heartbeat, completion, or interruption; contains no producer credentials |
| `projects` | `{}` when the node discovers another project; refresh `/api/projects` |
| `ping` | `{}` every `heartbeatSeconds`, so a quiet server is told apart from a dead connection |

Past `limits.maxStreams` viewers the answer is `503` with `Retry-After`: poll `/api/reports/evidence/effective` instead. A browser needs no code beyond `new EventSource("/api/events")`; other clients send the token as `Authorization: Bearer`.

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The stream.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` Too many viewers are connected; poll instead.

### Server-sent events: results arrived, specs or runs changed

`GET /api/projects/{project}/events` · role: read

A `text/event-stream` that stays open. Report events announce changes, and run events carry bounded live progress snapshots; authoritative state can always be fetched, so a client that missed events (a dropped connection) loses nothing: read again on reconnect.

| event | data |
| --- | --- |
| `hello` | `{ version, ready, time, heartbeatMs? }`, sent first |
| `report` | `{ version, totalLayers, added: [{ id, producer, environment, branch, sha, recordedAtMs, counts }], addedTotal }`: layers arrived |
| `atlas:change` | `{ scope: "specs" \| "runs", files, runIds }`: new specs or runs |
| `run` | A LiveRun snapshot after start, progress, heartbeat, completion, or interruption; contains no producer credentials |
| `projects` | `{}` when the node discovers another project; refresh `/api/projects` |
| `ping` | `{}` every `heartbeatSeconds`, so a quiet server is told apart from a dead connection |

Past `limits.maxStreams` viewers the answer is `503` with `Retry-After`: poll `/api/reports/evidence/effective` instead. A browser needs no code beyond `new EventSource("/api/events")`; other clients send the token as `Authorization: Bearer`.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The stream.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` Too many viewers are connected; poll instead.

### The whole report, or only what changed since a version

`GET /api/reports/evidence/effective` · role: read

The report as it stands: only the layers that win at least one check, each with only the rows that win. Whatever the history behind it, this is one request.

`version` changes exactly when the report does, so it works as an ETag: send `If-None-Match` and get `304`. Better, send `?since=<version>` of the report you hold and get **only what changed** (`delta: true`): replace the layers of the same id, drop `removed`, keep the rest. If the server does not remember that version it answers with the whole report (no `delta` key), so a client always handles both.

To combine layers yourself, a check's *slot* is `(producer, kind, specPath, check id, environment, parameters)`; the newest completed result wins it. See `docs/report-contract.md`.

- `since` (query): The `version` of the report you hold.
- `if-none-match` (header): The ETag (the quoted version) of the report you hold.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The whole report, or a delta when `since` was given and remembered.; `304` You already hold this version.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### The whole report, or only what changed since a version

`GET /api/projects/{project}/reports/evidence/effective` · role: read

The report as it stands: only the layers that win at least one check, each with only the rows that win. Whatever the history behind it, this is one request.

`version` changes exactly when the report does, so it works as an ETag: send `If-None-Match` and get `304`. Better, send `?since=<version>` of the report you hold and get **only what changed** (`delta: true`): replace the layers of the same id, drop `removed`, keep the rest. If the server does not remember that version it answers with the whole report (no `delta` key), so a client always handles both.

To combine layers yourself, a check's *slot* is `(producer, kind, specPath, check id, environment, parameters)`; the newest completed result wins it. See `docs/report-contract.md`.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
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
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The verdict, whether or not it passes.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### The gate: does the report pass

`GET /api/projects/{project}/status` · role: read

The `atlas report status --format json` document, worked out by the server from the layers it holds and remembered for each version of the report. It passes (`ok: true`) only if some check completed, none failed, none is still running, every layer and backend could be read, and every required environment has results. **Unknown is never a pass.**

The header `X-Atlas-Ok: true|false` carries the verdict, so a shell can test it without parsing. Narrow it by choice, per request: `branch` (repeatable) and `ignoreModified` read only matching layers.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `branch` (query): Only layers recorded on this branch. Repeatable.
- `ignoreModified` (query): `1`: leave out layers from modified checkouts and unknown origins.
- `requireEnvironments` (query): Comma-separated environments that must have results.
- `requireAllSpecs` (query): `1`: fail while any spec of the outline has no results.

Responses: `200` The verdict, whether or not it passes.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Upload one layer of checks as JSON

`POST /api/checks` · role: publish

The simplest way in: anything that can make an HTTP request can report. The body is the checks file (`packages/schema/schemas/publish-checks.schema.json`); `recordedAtMs` defaults to now. Binary evidence goes in as `base64`. The server writes the layer and it is in every viewer's report before this answers.

Send the token as `Authorization: Bearer <token>` (a `publish` or `admin` token). A browser's sign-in box is refused for uploads on purpose. A check id appearing twice in one body is `422`.

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `201` The layer was written.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `413` The body is over `limits.maxJsonMiB`.; `422` The body is not valid: the detail says which field.

### Upload one layer of checks as JSON

`POST /api/projects/{project}/checks` · role: publish

The simplest way in: anything that can make an HTTP request can report. The body is the checks file (`packages/schema/schemas/publish-checks.schema.json`); `recordedAtMs` defaults to now. Binary evidence goes in as `base64`. The server writes the layer and it is in every viewer's report before this answers.

Send the token as `Authorization: Bearer <token>` (a `publish` or `admin` token). A browser's sign-in box is refused for uploads on purpose. A check id appearing twice in one body is `422`.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `201` The layer was written.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `413` The body is over `limits.maxJsonMiB`.; `422` The body is not valid: the detail says which field.

### List keys under layers/

`GET /api/store` · role: read

One page of the keys of `layers/…` (never anything else), in code-unit order. Page with `after` = the `next` of the previous page. This is the `listPage` of the `ObjectStore` interface; `atlas report merge` and `httpStore` use it.

- `prefix` (query): Only keys starting with this. Default `layers/`.
- `after` (query): Only keys after this one (exclusive).
- `limit` (query): Page size, 1 to 1000. Default 1000.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` A page.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `422` The prefix is not one Atlas holds.

### List keys under layers/

`GET /api/projects/{project}/store` · role: read

One page of the keys of `layers/…` (never anything else), in code-unit order. Page with `after` = the `next` of the previous page. This is the `listPage` of the `ObjectStore` interface; `atlas report merge` and `httpStore` use it.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `prefix` (query): Only keys starting with this. Default `layers/`.
- `after` (query): Only keys after this one (exclusive).
- `limit` (query): Page size, 1 to 1000. Default 1000.

Responses: `200` A page.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `422` The prefix is not one Atlas holds.

### Read an object

`GET /api/store/{key}` · role: read

The bytes of one object, with the content type it was stored with. Everything under `layers/` is immutable, so the answer is cacheable for good. The bytes came from a test run and are untrusted: they are served with `nosniff` and a sandboxing Content-Security-Policy, whatever type their uploader gave them.

- `key` (path, required): An object key under `layers/`, such as `layers/manifests/<id>.json`. It contains slashes, which are not percent-encoded; every other character is.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The object.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such object.; `422` Not a key Atlas holds.

### Read an object

`GET /api/projects/{project}/store/{key}` · role: read

The bytes of one object, with the content type it was stored with. Everything under `layers/` is immutable, so the answer is cacheable for good. The bytes came from a test run and are untrusted: they are served with `nosniff` and a sandboxing Content-Security-Policy, whatever type their uploader gave them.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `key` (path, required): An object key under `layers/`, such as `layers/manifests/<id>.json`. It contains slashes, which are not percent-encoded; every other character is.

Responses: `200` The object.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such object.; `422` Not a key Atlas holds.

### Does an object exist

`HEAD /api/store/{key}` · role: read

`200` when the object exists, `404` when not. No body.

- `key` (path, required): An object key under `layers/`, such as `layers/manifests/<id>.json`. It contains slashes, which are not percent-encoded; every other character is.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` It exists.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such object.

### Does an object exist

`HEAD /api/projects/{project}/store/{key}` · role: read

`200` when the object exists, `404` when not. No body.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
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
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` Already there with the same bytes.; `201` Stored.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `409` A dependency has not been uploaded yet, or other bytes are already stored under this key.; `413` Over `limits.maxObjectMiB`.; `422` Not a key Atlas writes, or the content is not what its name says.

### Upload an object

`PUT /api/projects/{project}/store/{key}` · role: publish

The write half of the `ObjectStore` interface. The server checks what it can from the bytes in hand and says no to what would corrupt the report for everyone:

- a **layer manifest** (`layers/manifests/<id>.json`) must be a valid layer whose content hashes to `<id>`, and its blobs must already be there (`409` otherwise);
- a **blob** (`layers/blobs/<sha256>.gz`) must be gzip of content whose SHA-256 is its name; a **spec file** likewise;
- a **catalog entry** (`…/index/…`) must name something already uploaded (`409` otherwise): it is what makes a layer visible, so it is written last;
- a **run manifest** must have passed its privacy scan;
- keys are immutable: the same bytes again are `200` (a retry), other bytes under the same key are `409`.

Upload in dependency order: blobs, then the manifest, then the catalog entry. `atlas report publish`, `atlas report stream` and `httpStore` do. Needs a `Bearer` token of role `publish` or `admin`; a browser's sign-in box is refused.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `key` (path, required): An object key under `layers/`, such as `layers/manifests/<id>.json`. It contains slashes, which are not percent-encoded; every other character is.
- `content-type` (header): Stored with the object and returned when it is read.

Responses: `200` Already there with the same bytes.; `201` Stored.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `409` A dependency has not been uploaded yet, or other bytes are already stored under this key.; `413` Over `limits.maxObjectMiB`.; `422` Not a key Atlas writes, or the content is not what its name says.

### Remove a scratch object

`DELETE /api/store/{key}` · role: publish

Only the scratch objects `atlas report doctor` writes (`layers/doctor-…`) can be removed. Layers, specs and runs are never removed through the API.

- `key` (path, required): An object key under `layers/`, such as `layers/manifests/<id>.json`. It contains slashes, which are not percent-encoded; every other character is.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `204` Removed (or it was not there).; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` Not a scratch object, or the token may not.

### Remove a scratch object

`DELETE /api/projects/{project}/store/{key}` · role: publish

Only the scratch objects `atlas report doctor` writes (`layers/doctor-…`) can be removed. Layers, specs and runs are never removed through the API.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `key` (path, required): An object key under `layers/`, such as `layers/manifests/<id>.json`. It contains slashes, which are not percent-encoded; every other character is.

Responses: `204` Removed (or it was not there).; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` Not a scratch object, or the token may not.

### Every test, with insights, facets and history statistics

`GET /api/reports/tests` · role: read

The report as a list of tests, for exploring it or for an agent to read in one request. A test is a check identity (its spec path and id) across producers and environments; `outcomes` holds its current result on each environment, and `stats` how it went over its recorded history (pass rate, flips, flaky, durations avg/p50/p95, runs, branches).

`summary` and `facets` cover every test (counts by status, by environment, by producer and by domain, the slowest, flakiest and failing tests); `tests` is the page the query matched. Without a published spec set, specs come from the `specs[]` the layers recorded.

Send `format=markdown` (or `Accept: text/markdown`) for the same as a Markdown report. The current status of a test is always the report's winner; history never changes it.

- `q` (query): Words that must all appear in the title, id, spec, domain, tags, labels, environments or producers. Case does not matter.
- `status` (query): Current status, or `flaky`. Repeatable or comma-separated.
- `environment` (query): Only tests with a result on this environment. Repeatable or comma-separated.
- `producer` (query): Only tests from this producer. Repeatable or comma-separated.
- `domain` (query): Only tests whose spec is in this domain (`(no spec)` for none). Repeatable or comma-separated.
- `spec` (query): Only tests of this spec path. Repeatable or comma-separated.
- `tag` (query): Only tests with this tag. Repeatable or comma-separated.
- `artifactTag` (query): Only tests with an attachment tagged this (`demo` and `#demo` are the same tag), not counting tags inherited from a check or run: the exact artifact query. `inherited=1` widens it to the tags inherited from the check and run. Repeatable or comma-separated.
- `inherited` (query): With `artifactTag`: `1` also matches the tags an attachment inherits from its check and run, so a recording without a tag of its own under a run tagged `demo` is found. Without it the query is exact.
- `run` (query): Only tests recorded in this run (a `key` from `/api/reports/runs`).
- `sort` (query): The order: `spec` (default: domain, spec, title), `title`, `recent`, `slowest`, `failures`, `flaky` or `runs`.
- `offset` (query): Skip this many matching tests.
- `limit` (query): At most this many tests (default 500, at most 20000).
- `format` (query): `markdown` for a Markdown report instead of JSON.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The catalog.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Every test, with insights, facets and history statistics

`GET /api/projects/{project}/reports/tests` · role: read

The report as a list of tests, for exploring it or for an agent to read in one request. A test is a check identity (its spec path and id) across producers and environments; `outcomes` holds its current result on each environment, and `stats` how it went over its recorded history (pass rate, flips, flaky, durations avg/p50/p95, runs, branches).

`summary` and `facets` cover every test (counts by status, by environment, by producer and by domain, the slowest, flakiest and failing tests); `tests` is the page the query matched. Without a published spec set, specs come from the `specs[]` the layers recorded.

Send `format=markdown` (or `Accept: text/markdown`) for the same as a Markdown report. The current status of a test is always the report's winner; history never changes it.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `q` (query): Words that must all appear in the title, id, spec, domain, tags, labels, environments or producers. Case does not matter.
- `status` (query): Current status, or `flaky`. Repeatable or comma-separated.
- `environment` (query): Only tests with a result on this environment. Repeatable or comma-separated.
- `producer` (query): Only tests from this producer. Repeatable or comma-separated.
- `domain` (query): Only tests whose spec is in this domain (`(no spec)` for none). Repeatable or comma-separated.
- `spec` (query): Only tests of this spec path. Repeatable or comma-separated.
- `tag` (query): Only tests with this tag. Repeatable or comma-separated.
- `artifactTag` (query): Only tests with an attachment tagged this (`demo` and `#demo` are the same tag), not counting tags inherited from a check or run: the exact artifact query. `inherited=1` widens it to the tags inherited from the check and run. Repeatable or comma-separated.
- `inherited` (query): With `artifactTag`: `1` also matches the tags an attachment inherits from its check and run, so a recording without a tag of its own under a run tagged `demo` is found. Without it the query is exact.
- `run` (query): Only tests recorded in this run (a `key` from `/api/reports/runs`).
- `sort` (query): The order: `spec` (default: domain, spec, title), `title`, `recent`, `slowest`, `failures`, `flaky` or `runs`.
- `offset` (query): Skip this many matching tests.
- `limit` (query): At most this many tests (default 500, at most 20000).
- `format` (query): `markdown` for a Markdown report instead of JSON.

Responses: `200` The catalog.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Why specs, domains and counts disagree

`GET /api/reports/tests/health` · role: read

Diagnoses the report's metadata, so a domain filter or a coverage percentage can be trusted or fixed at its source. It reads; it never changes a status, a slot or a winner.

`counts` keeps the denominators apart: spec files, defined specs, specs with an executed test (and those without: the defined coverage gaps), tests, outlines, examples and per-environment observations. `reconciliation` walks from the Specs count to the Tests count. `findings` name ambiguous and unmatched spec paths, identical or same-titled specs, a domain shared by nearly every spec, tests with no spec, checks that fall back to their title as identity and root mappings that matched nothing.

Two paths are one logical spec only when a `root` mapping relates them (`from>to`: paths under `from` are the same specs as paths under `to`; an empty `from` matches every path). Without one, similar paths are reported as ambiguous and never merged. A check's label `outline` names the outline its example belongs to. Send `format=markdown` for Markdown.

- `root` (query): A root mapping `from>to`, URL-encoded. Repeatable or comma-separated.
- `format` (query): `markdown` for a Markdown report instead of JSON.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The diagnostics.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Why specs, domains and counts disagree

`GET /api/projects/{project}/reports/tests/health` · role: read

Diagnoses the report's metadata, so a domain filter or a coverage percentage can be trusted or fixed at its source. It reads; it never changes a status, a slot or a winner.

`counts` keeps the denominators apart: spec files, defined specs, specs with an executed test (and those without: the defined coverage gaps), tests, outlines, examples and per-environment observations. `reconciliation` walks from the Specs count to the Tests count. `findings` name ambiguous and unmatched spec paths, identical or same-titled specs, a domain shared by nearly every spec, tests with no spec, checks that fall back to their title as identity and root mappings that matched nothing.

Two paths are one logical spec only when a `root` mapping relates them (`from>to`: paths under `from` are the same specs as paths under `to`; an empty `from` matches every path). Without one, similar paths are reported as ambiguous and never merged. A check's label `outline` names the outline its example belongs to. Send `format=markdown` for Markdown.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `root` (query): A root mapping `from>to`, URL-encoded. Repeatable or comma-separated.
- `format` (query): `markdown` for a Markdown report instead of JSON.

Responses: `200` The diagnostics.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### One test and every result recorded for it

`GET /api/reports/tests/history` · role: read

The test (as `/api/reports/tests` lists it) and up to 100 recorded results, newest first: status, duration, environment, producer, branch, commit, CI run, layer and the first 500 characters of the detail. Open a result's evidence (attachments, steps, retries) with `/api/reports/evidence/detail/{backend}/{id}?check=<id>`. Send `format=markdown` for Markdown.

- `key` (query, required): The test's `key` from `/api/reports/tests`: `JSON.stringify([specPath, id])`, URL-encoded.
- `format` (query): `markdown` for Markdown instead of JSON.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The test and its history.; `304` Unchanged since the `If-None-Match` ETag.; `400` No `key`.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No test in the report has that key.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### One test and every result recorded for it

`GET /api/projects/{project}/reports/tests/history` · role: read

The test (as `/api/reports/tests` lists it) and up to 100 recorded results, newest first: status, duration, environment, producer, branch, commit, CI run, layer and the first 500 characters of the detail. Open a result's evidence (attachments, steps, retries) with `/api/reports/evidence/detail/{backend}/{id}?check=<id>`. Send `format=markdown` for Markdown.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `key` (query, required): The test's `key` from `/api/reports/tests`: `JSON.stringify([specPath, id])`, URL-encoded.
- `format` (query): `markdown` for Markdown instead of JSON.

Responses: `200` The test and its history.; `304` Unchanged since the `If-None-Match` ETag.; `400` No `key`.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No test in the report has that key.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Reviewer tags of attachments: every recorded edit

`GET /api/reports/artifact-tags` · role: read

The audit trail of tags that reviewers added to and removed from attachments after upload, oldest first. Each entry says which attachment (`target`), which normalized tags were added and removed, the name of the token that made the edit (`by`, never the token) and when (`atMs`). The layers themselves are never rewritten, so a producer's own `tags` on an attachment stay as uploaded; fold the entries (oldest first, the last edit of a tag wins) to get the reviewer tags that stand now. Tags are normalized: `#Demo` and `demo` are `demo`.

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The edits.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### Reviewer tags of attachments: every recorded edit

`GET /api/projects/{project}/reports/artifact-tags` · role: read

The audit trail of tags that reviewers added to and removed from attachments after upload, oldest first. Each entry says which attachment (`target`), which normalized tags were added and removed, the name of the token that made the edit (`by`, never the token) and when (`atMs`). The layers themselves are never rewritten, so a producer's own `tags` on an attachment stay as uploaded; fold the entries (oldest first, the last edit of a tag wins) to get the reviewer tags that stand now. Tags are normalized: `#Demo` and `demo` are `demo`.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The edits.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### Tag or untag one attachment after upload

`POST /api/reports/artifact-tags` · role: publish

Records one edit of the reviewer tags of one attachment, by the name of the publish (or admin) token that sends it. It adds an immutable entry to the audit trail and changes nothing else: not the layer, not the movie, not any result. The tags it removes are reviewer tags only; a producer's tags are part of the layer and stay. A reader-only token, a browser sign-in box and an anonymous reader are refused. Name the attachment as `artifactRef` does (`id:<id>`, else `key:<bundleKey>`, else `name:<name>`).

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `201` The recorded entry.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `413` Request too large.; `422` Not a tag edit: a bad target, an empty or over-long tag, or nothing to change.

### Tag or untag one attachment after upload

`POST /api/projects/{project}/reports/artifact-tags` · role: publish

Records one edit of the reviewer tags of one attachment, by the name of the publish (or admin) token that sends it. It adds an immutable entry to the audit trail and changes nothing else: not the layer, not the movie, not any result. The tags it removes are reviewer tags only; a producer's tags are part of the layer and stay. A reader-only token, a browser sign-in box and an anonymous reader are refused. Name the attachment as `artifactRef` does (`id:<id>`, else `key:<bundleKey>`, else `name:<name>`).

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `201` The recorded entry.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `413` Request too large.; `422` Not a tag edit: a bad target, an empty or over-long tag, or nothing to change.

### The runs that recorded the report

`GET /api/reports/runs` · role: read

Every run, newest first: layers grouped by their CI run URL (else branch and commit), with their environments, producers, how many tests they recorded, their results by status, the time they spanned, up to twenty failures and their video counts (references, distinct playable recordings, unavailable). Send `format=markdown` for Markdown.

- `limit` (query): At most this many runs (default 100).
- `video` (query): `true` to list only runs that have a playable video recording. Applied to every run before `limit`; `total` counts the matches. A server that does not know it answers with every run.
- `format` (query): `markdown` for Markdown instead of JSON.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The runs.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### The runs that recorded the report

`GET /api/projects/{project}/reports/runs` · role: read

Every run, newest first: layers grouped by their CI run URL (else branch and commit), with their environments, producers, how many tests they recorded, their results by status, the time they spanned, up to twenty failures and their video counts (references, distinct playable recordings, unavailable). Send `format=markdown` for Markdown.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `limit` (query): At most this many runs (default 100).
- `video` (query): `true` to list only runs that have a playable video recording. Applied to every run before `limit`; `total` counts the matches. A server that does not know it answers with every run.
- `format` (query): `markdown` for Markdown instead of JSON.

Responses: `200` The runs.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Every test one run recorded

`GET /api/reports/runs/detail` · role: read

One run and its last result for every test, environment and producer it recorded, failures first, and `layers`: each layer of the run with its backend, how many checks it recorded (zero means evidence only, never a pass) and how many files it carries as a whole. Open a layer's files with `/api/reports/evidence/detail/{backend}/{id}`. Send `format=markdown` for Markdown.

- `key` (query, required): The run's `key` from `/api/reports/runs`, URL-encoded.
- `format` (query): `markdown` for Markdown instead of JSON.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The run and its results.; `304` Unchanged since the `If-None-Match` ETag.; `400` No `key`.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No run has that key.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Every test one run recorded

`GET /api/projects/{project}/reports/runs/detail` · role: read

One run and its last result for every test, environment and producer it recorded, failures first, and `layers`: each layer of the run with its backend, how many checks it recorded (zero means evidence only, never a pass) and how many files it carries as a whole. Open a layer's files with `/api/reports/evidence/detail/{backend}/{id}`. Send `format=markdown` for Markdown.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `key` (query, required): The run's `key` from `/api/reports/runs`, URL-encoded.
- `format` (query): `markdown` for Markdown instead of JSON.

Responses: `200` The run and its results.; `304` Unchanged since the `If-None-Match` ETag.; `400` No `key`.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No run has that key.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### The specs a report is laid over

`GET /api/reports/outline` · role: read

The specs of the newest committed spec set (of `main`, else the newest), so the report needs no checkout. Without a spec set, the specs the layers recorded (`specs[]`), newest per path. A spec here with no result shows as having none.

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The outline.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### The specs a report is laid over

`GET /api/projects/{project}/reports/outline` · role: read

The specs of the newest committed spec set (of `main`, else the newest), so the report needs no checkout. Without a spec set, the specs the layers recorded (`specs[]`), newest per path. A spec here with no result shows as having none.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The outline.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### The text of one spec

`GET /api/reports/outline/spec` · role: read

The text of a spec file of the outline, by its path.

- `path` (query, required): The spec's path, `specs/<path>`.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The spec text.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such spec in the outline.

### The text of one spec

`GET /api/projects/{project}/reports/outline/spec` · role: read

The text of a spec file of the outline, by its path.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `path` (query, required): The spec's path, `specs/<path>`.

Responses: `200` The spec text.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such spec in the outline.

### Page through every layer header

`GET /api/reports/evidence` · role: read

The history: layer headers newest first, merged from every backend. Prefer `/api/reports/evidence/effective`, which is one request and holds only what wins. Use this to audit what was recorded.

- `cursor` (query): The `cursor` of the previous page.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` A page of headers.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Page through every layer header

`GET /api/projects/{project}/reports/evidence` · role: read

The history: layer headers newest first, merged from every backend. Prefer `/api/reports/evidence/effective`, which is one request and holds only what wins. Use this to audit what was recorded.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `cursor` (query): The `cursor` of the previous page.

Responses: `200` A page of headers.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### The checks of one layer

`GET /api/reports/evidence/rows/{backend}/{id}` · role: read

Every check of one layer (not only those that win), with the spec fingerprints it recorded.

- `backend` (path, required): A backend id from `/api/server`.
- `id` (path, required): A layer id: 64 lowercase hex digits.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The rows.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such layer in that backend.

### The checks of one layer

`GET /api/projects/{project}/reports/evidence/rows/{backend}/{id}` · role: read

Every check of one layer (not only those that win), with the spec fingerprints it recorded.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `backend` (path, required): A backend id from `/api/server`.
- `id` (path, required): A layer id: 64 lowercase hex digits.

Responses: `200` The rows.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such layer in that backend.

### Everything one result carries

`GET /api/reports/evidence/detail/{backend}/{id}` · role: read

The timeline, annotations, retries, attachments and extensions of one check, and what its run carries as a whole. Without `check`, only the run's, and `parts`: what each part of the layer that carries files or links of its own holds. Attachment bytes are fetched from `/api/reports/layers/{id}/blobs/{bundleKey}`.

- `backend` (path, required): A backend id from `/api/server`.
- `id` (path, required): A layer id: 64 lowercase hex digits.
- `check` (query): The check id.
- `kind` (query): The kind of the part, when the same id is in several.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The detail.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such layer or check.

### Everything one result carries

`GET /api/projects/{project}/reports/evidence/detail/{backend}/{id}` · role: read

The timeline, annotations, retries, attachments and extensions of one check, and what its run carries as a whole. Without `check`, only the run's, and `parts`: what each part of the layer that carries files or links of its own holds. Attachment bytes are fetched from `/api/reports/layers/{id}/blobs/{bundleKey}`.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
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
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The bytes, with the type the producer gave (or `application/octet-stream`).; `206` The requested range.; `304` Not modified.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such layer or file.

### A file a layer carries

`GET /api/projects/{project}/reports/layers/{id}/blobs/{bundleKey}` · role: read

A screenshot, video, trace, log or any attachment of a layer, by the `bundleKey` its attachment names (`attachments/<sha256>`). Served as untrusted bytes: never sniffed, never run, sandboxed; immutable, cacheable for good; videos can be sought with `Range`.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `id` (path, required): A layer id: 64 lowercase hex digits.
- `bundleKey` (path, required): The attachment's `bundleKey`, which contains a slash.
- `range` (header): A byte range, `bytes=0-1023`.

Responses: `200` The bytes, with the type the producer gave (or `application/octet-stream`).; `206` The requested range.; `304` Not modified.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such layer or file.

### A recorded test of a statechart run

`GET /api/reports/layers/{id}/{path}` · role: read

The `report.json`, captured files and frame stylesheet of a recorded statechart test of a layer (`tests/<testId>/report.json`, `tests/<testId>/files/…`, `frame.css`). Untrusted bytes, served like attachments.

- `id` (path, required): A layer id: 64 lowercase hex digits.
- `path` (path, required): The path under the layer.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The file.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such file.

### A recorded test of a statechart run

`GET /api/projects/{project}/reports/layers/{id}/{path}` · role: read

The `report.json`, captured files and frame stylesheet of a recorded statechart test of a layer (`tests/<testId>/report.json`, `tests/<testId>/files/…`, `frame.css`). Untrusted bytes, served like attachments.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `id` (path, required): A layer id: 64 lowercase hex digits.
- `path` (path, required): The path under the layer.

Responses: `200` The file.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such file.

### Frame stylesheet of a live spec run (development only)

`GET /api/reports/live/{source}/frame.css` · role: read

For spec runs writing on the same machine as a development host (`atlas-visualizer dev`). A server has none: it answers `404`.

- `source` (path, required): The live source id.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The stylesheet.; `404` Not a live source.

### Frame stylesheet of a live spec run (development only)

`GET /api/projects/{project}/reports/live/{source}/frame.css` · role: read

For spec runs writing on the same machine as a development host (`atlas-visualizer dev`). A server has none: it answers `404`.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `source` (path, required): The live source id.

Responses: `200` The stylesheet.; `404` Not a live source.

### A file of a test in a live spec run (development only)

`GET /api/reports/live/{source}/tests/{testId}/{path}` · role: read

For spec runs writing on the same machine as a development host. A server has none: it answers `404`.

- `source` (path, required): The live source id.
- `testId` (path, required): The test id.
- `path` (path, required): The path under the test.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The file.; `404` Not a live source.

### A file of a test in a live spec run (development only)

`GET /api/projects/{project}/reports/live/{source}/tests/{testId}/{path}` · role: read

For spec runs writing on the same machine as a development host. A server has none: it answers `404`.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `source` (path, required): The live source id.
- `testId` (path, required): The test id.
- `path` (path, required): The path under the test.

Responses: `200` The file.; `404` Not a live source.

### The sources the viewer reads

`GET /api/data/sources.json` · role: read

The viewer's address book of data sources, in the shape a static host serves. A server has one source, itself.

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The sources file.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### The sources the viewer reads

`GET /api/projects/{project}/data/sources.json` · role: read

The viewer's address book of data sources, in the shape a static host serves. A server has one source, itself.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The sources file.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### The spec files

`GET /api/data/specs/index.json` · role: read

The files of the newest committed spec set, relative to `specs/`.

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The index.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### The spec files

`GET /api/projects/{project}/data/specs/index.json` · role: read

The files of the newest committed spec set, relative to `specs/`.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The index.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### One spec file

`GET /api/data/specs/{file}` · role: read

The text of a spec file, with the digest of its content as `ETag`.

- `file` (path, required): The file's path relative to `specs/`.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The text.; `304` Not modified.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such spec.

### One spec file

`GET /api/projects/{project}/data/specs/{file}` · role: read

The text of a spec file, with the digest of its content as `ETag`.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `file` (path, required): The file's path relative to `specs/`.

Responses: `200` The text.; `304` Not modified.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such spec.

### The statechart runs

`GET /api/data/runs/index.json` · role: read

The newest uploaded statechart runs (`atlas report publish --manifest … --upload-run`), newest first.

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The index.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### The statechart runs

`GET /api/projects/{project}/data/runs/index.json` · role: read

The newest uploaded statechart runs (`atlas report publish --manifest … --upload-run`), newest first.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The index.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### A file of an uploaded run

`GET /api/data/runs/{id}/{path}` · role: read

A file of an uploaded run: its manifest, timelines, screenshots, clips. Untrusted bytes, served sandboxed; immutable.

- `id` (path, required): The run id.
- `path` (path, required): The path inside the run.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The file.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such run or file.

### A file of an uploaded run

`GET /api/projects/{project}/data/runs/{id}/{path}` · role: read

A file of an uploaded run: its manifest, timelines, screenshots, clips. Untrusted bytes, served sandboxed; immutable.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `id` (path, required): The run id.
- `path` (path, required): The path inside the run.

Responses: `200` The file.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such run or file.
