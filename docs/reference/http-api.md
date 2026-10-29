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

Returns the editable report and live-run settings saved in the user state in S3, active settings, a revision, and configuration precedence. Storage and authentication settings are excluded. Requires an admin Bearer token. Embedded applications may manage settings outside this API.

Responses: `200` Settings and revision.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `503` Configuration is managed by the embedding application.

### Save settings for the next restart

`PUT /api/settings` · role: admin

Replaces the editable report and live-run settings in the user state in S3 (`server/state.json`), preserving the garbage collection policy and other fields. Persists a validated configuration; no report data is moved. Environment variables and flags override these values after restart. Requires an admin Bearer token, same-origin requests in browsers, and a current revision.

- `If-Match` (header, required): The quoted revision returned by GET /api/settings.

Responses: `200` Saved settings and new revision. Restart required.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `409` Settings changed; reload before saving.; `413` Settings exceed the body limit.; `422` Invalid configuration.; `428` A quoted settings revision is required.; `503` Configuration is managed by the embedding application.

### Read the garbage collection policy

`GET /api/settings/gc` · role: admin

Returns the policy kept in the user state in S3 (`server/state.json`), or `policy: null, saved: false` when none has been saved yet, in which case garbage collection is off and nothing is deleted. Also returns the revision to send back when saving and the last pass over each project. Requires an admin Bearer token. If the stored user state is unreadable the answer is 503 and the stored object is left untouched.

Responses: `200` The policy, its revision and the last passes.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `503` The user state in S3 cannot be read, or settings are managed by the embedding application.

### Save the garbage collection policy

`PUT /api/settings/gc` · role: admin

Replaces the policy in the user state in S3 and leaves the rest of that document alone. The server reads the policy from S3 each time it collects, so the new policy applies at the next pass, without a restart. Requires an admin Bearer token, same-origin requests in browsers, and the current revision.

- `If-Match` (header, required): The quoted revision returned by GET /api/settings/gc.

Responses: `200` The saved policy and the new revision.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `409` The state changed; reload before saving.; `413` The body exceeds the limit.; `422` Invalid policy.; `428` A quoted revision is required.; `503` The user state in S3 cannot be read, or settings are managed by the embedding application.

### Collect garbage now, or preview it

`POST /api/settings/gc/run` · role: admin

Applies the policy saved in S3 to every project now, instead of waiting for the schedule. Only report layers that were read and no longer decide any result, older than the policy allows and beyond its `keepLatest`, are deleted, with the captured files only they used. With `dryRun=1` nothing is deleted and each run reports what it would delete (a disabled policy is previewed as if enabled). Answers 409 when no policy has been saved, and, without `dryRun`, when the saved policy is disabled. Requires an admin Bearer token and a same-origin request in browsers.

- `dryRun` (query): `1` or `true` to only count what would be deleted.

Responses: `200` One run per project.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `409` No policy has been saved, or it is disabled.

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

`PUT /api/store/{key}` · role: critic

The write half of the `ObjectStore` interface. The server checks what it can from the bytes in hand and says no to what would corrupt the report for everyone:

- a **layer manifest** (`layers/manifests/<id>.json`) must be a valid layer whose content hashes to `<id>`, and its blobs must already be there (`409` otherwise);
- a **blob** (`layers/blobs/<sha256>.gz`) must be gzip of content whose SHA-256 is its name; a **spec file** likewise;
- a **catalog entry** (`…/index/…`) must name something already uploaded (`409` otherwise): it is what makes a layer visible, so it is written last;
- a **run manifest** must have passed its privacy scan;
- keys are immutable: the same bytes again are `200` (a retry), other bytes under the same key are `409`.

Upload in dependency order: blobs, then the manifest, then the catalog entry. `atlas report publish`, `atlas report stream` and `httpStore` do. Needs a `Bearer` token of role `publish` or `admin`; a browser's sign-in box is refused.

A token of role `critic` may upload only what a critic publishes: blobs, and layers (and their catalog entries) whose `producer` is `critic.<name>` and whose parts are all of kind `critique`. Anything else is `403` with the rule it broke, and nothing is stored.

- `key` (path, required): An object key under `layers/`, such as `layers/manifests/<id>.json`. It contains slashes, which are not percent-encoded; every other character is.
- `content-type` (header): Stored with the object and returned when it is read.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` Already there with the same bytes.; `201` Stored.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `409` A dependency has not been uploaded yet, or other bytes are already stored under this key.; `413` Over `limits.maxObjectMiB`.; `422` Not a key Atlas writes, or the content is not what its name says.

### Upload an object

`PUT /api/projects/{project}/store/{key}` · role: critic

The write half of the `ObjectStore` interface. The server checks what it can from the bytes in hand and says no to what would corrupt the report for everyone:

- a **layer manifest** (`layers/manifests/<id>.json`) must be a valid layer whose content hashes to `<id>`, and its blobs must already be there (`409` otherwise);
- a **blob** (`layers/blobs/<sha256>.gz`) must be gzip of content whose SHA-256 is its name; a **spec file** likewise;
- a **catalog entry** (`…/index/…`) must name something already uploaded (`409` otherwise): it is what makes a layer visible, so it is written last;
- a **run manifest** must have passed its privacy scan;
- keys are immutable: the same bytes again are `200` (a retry), other bytes under the same key are `409`.

Upload in dependency order: blobs, then the manifest, then the catalog entry. `atlas report publish`, `atlas report stream` and `httpStore` do. Needs a `Bearer` token of role `publish` or `admin`; a browser's sign-in box is refused.

A token of role `critic` may upload only what a critic publishes: blobs, and layers (and their catalog entries) whose `producer` is `critic.<name>` and whose parts are all of kind `critique`. Anything else is `403` with the rule it broke, and nothing is stored.

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
- `scope` (query): Only tests with one playable recording that states every one of these producer-declared qualifications: `surface:<value>`, `device:<value>` (`device:physical` and `device:simulator` stay apart), `data:synthetic` or `data:real`, `dependencies:<value>`, `audio:recorded` or `audio:silent`, `pacing:<value>`. All must hold for the same recording. A recording that did not declare a value never matches it, and `unknown` matches only a recording that declared no scope. Repeatable or comma-separated.
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
- `scope` (query): Only tests with one playable recording that states every one of these producer-declared qualifications: `surface:<value>`, `device:<value>` (`device:physical` and `device:simulator` stay apart), `data:synthetic` or `data:real`, `dependencies:<value>`, `audio:recorded` or `audio:silent`, `pacing:<value>`. All must hold for the same recording. A recording that did not declare a value never matches it, and `unknown` matches only a recording that declared no scope. Repeatable or comma-separated.
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

Two paths are one logical spec only when a `root` mapping relates them (`from>to`: paths under `from` are the same specs as paths under `to`; an empty `from` matches every path). Without one, similar paths are reported as ambiguous and never merged. A check's label `outline` names the outline its example belongs to; the labels `behavior-id` and `example-id` declare stable ids, which are counted and checked for ids shared by several checks. Send `format=markdown` for Markdown.

- `root` (query): A root mapping `from>to`, URL-encoded. Repeatable or comma-separated. It is added to the mappings the server is configured with (`catalog.roots`, `ATLAS_CATALOG_ROOTS`); `roots[].source` says which is which.
- `format` (query): `markdown` for a Markdown report instead of JSON.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The diagnostics.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Why specs, domains and counts disagree

`GET /api/projects/{project}/reports/tests/health` · role: read

Diagnoses the report's metadata, so a domain filter or a coverage percentage can be trusted or fixed at its source. It reads; it never changes a status, a slot or a winner.

`counts` keeps the denominators apart: spec files, defined specs, specs with an executed test (and those without: the defined coverage gaps), tests, outlines, examples and per-environment observations. `reconciliation` walks from the Specs count to the Tests count. `findings` name ambiguous and unmatched spec paths, identical or same-titled specs, a domain shared by nearly every spec, tests with no spec, checks that fall back to their title as identity and root mappings that matched nothing.

Two paths are one logical spec only when a `root` mapping relates them (`from>to`: paths under `from` are the same specs as paths under `to`; an empty `from` matches every path). Without one, similar paths are reported as ambiguous and never merged. A check's label `outline` names the outline its example belongs to; the labels `behavior-id` and `example-id` declare stable ids, which are counted and checked for ids shared by several checks. Send `format=markdown` for Markdown.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `root` (query): A root mapping `from>to`, URL-encoded. Repeatable or comma-separated. It is added to the mappings the server is configured with (`catalog.roots`, `ATLAS_CATALOG_ROOTS`); `roots[].source` says which is which.
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

### How reliable one test is in a scope, and how that was counted

`GET /api/reports/tests/reliability` · role: read

A success rate for one test that says what it counted. The snapshots one run recorded for one producer, environment and parameter set (running, finished, enriched) are one independent execution; its last word counts once with the tries it recorded. `eventual` is the share of executions that passed in the end, `firstAttempt` the share whose first try passed (over executions that recorded their tries; the rest are `unrecordedAttempts`, never assumed to have passed first time).

Choose the scope with `environment`, `producer`, `parameter` (`key=value`), `branch`, `sha`, `specRevision`, `since` and `until`; executions elsewhere never count. By default only the newest recorded spec revision counts and earlier ones appear under `historical`; send `revision=any` to pool them. Only `passed` and `failed` executions are trials: `not-run` and unfinished ones are listed under `excluded` and never counted as a pass. `sample` is `none`, `insufficient` (fewer than `minimumExecutions`) or `sufficient`, a count only: `notes` say when environments, producers or branches are pooled, failed cases were published again, or history is bounded to the newest 100 results. `executions` is the denominator, open to inspection. The interval states its assumptions. This is not a production failure probability. Send `format=markdown` for Markdown.

- `key` (query, required): The test's `key` from `/api/reports/tests`.
- `environment` (query): Environments or devices to count. Comma-separated.
- `producer` (query): Producers to count. Comma-separated.
- `parameter` (query): Parameter choices `key=value`; all must match. Comma-separated.
- `branch` (query): Branches to count. Comma-separated.
- `sha` (query): Commits: a full id or a prefix of at least seven characters. Comma-separated.
- `specRevision` (query): Only executions recorded against these spec fingerprints (overrides `revision`). Comma-separated.
- `revision` (query): `any` pools every spec revision; otherwise only the newest recorded one counts.
- `since` (query): Only executions at or after this time: epoch milliseconds or a date.
- `until` (query): Only executions at or before this time: epoch milliseconds or a date.
- `format` (query): `markdown` for Markdown instead of JSON.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The reliability of the test in the scope.; `304` Unchanged since the `If-None-Match` ETag.; `400` No `key`.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No test in the report has that key.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### How reliable one test is in a scope, and how that was counted

`GET /api/projects/{project}/reports/tests/reliability` · role: read

A success rate for one test that says what it counted. The snapshots one run recorded for one producer, environment and parameter set (running, finished, enriched) are one independent execution; its last word counts once with the tries it recorded. `eventual` is the share of executions that passed in the end, `firstAttempt` the share whose first try passed (over executions that recorded their tries; the rest are `unrecordedAttempts`, never assumed to have passed first time).

Choose the scope with `environment`, `producer`, `parameter` (`key=value`), `branch`, `sha`, `specRevision`, `since` and `until`; executions elsewhere never count. By default only the newest recorded spec revision counts and earlier ones appear under `historical`; send `revision=any` to pool them. Only `passed` and `failed` executions are trials: `not-run` and unfinished ones are listed under `excluded` and never counted as a pass. `sample` is `none`, `insufficient` (fewer than `minimumExecutions`) or `sufficient`, a count only: `notes` say when environments, producers or branches are pooled, failed cases were published again, or history is bounded to the newest 100 results. `executions` is the denominator, open to inspection. The interval states its assumptions. This is not a production failure probability. Send `format=markdown` for Markdown.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `key` (query, required): The test's `key` from `/api/reports/tests`.
- `environment` (query): Environments or devices to count. Comma-separated.
- `producer` (query): Producers to count. Comma-separated.
- `parameter` (query): Parameter choices `key=value`; all must match. Comma-separated.
- `branch` (query): Branches to count. Comma-separated.
- `sha` (query): Commits: a full id or a prefix of at least seven characters. Comma-separated.
- `specRevision` (query): Only executions recorded against these spec fingerprints (overrides `revision`). Comma-separated.
- `revision` (query): `any` pools every spec revision; otherwise only the newest recorded one counts.
- `since` (query): Only executions at or after this time: epoch milliseconds or a date.
- `until` (query): Only executions at or before this time: epoch milliseconds or a date.
- `format` (query): `markdown` for Markdown instead of JSON.

Responses: `200` The reliability of the test in the scope.; `304` Unchanged since the `If-None-Match` ETag.; `400` No `key`.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No test in the report has that key.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

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

### Which stored recordings the server last read back, and which were gone or damaged

`GET /api/reports/recordings/verification` · role: read

The newest read-back the server did of stored videos, per layer: how many it checked, how many passed and the `gaps` (a blob that is gone, bytes of another size or hash than were published, or a file that does not begin like its container), each naming the check that holds the video. `run` is the key of the run the layer belongs to (a `RunSummary.key`), so a viewer can mark that run's recordings as stored-then-unavailable beside its test results.

This route never reads a blob: it returns what a publish token's `POST` found earlier. A layer that was never read back is absent, which means "not verified", not "fine"; the result is kept in the server's memory only, so a restart empties it. Only layers a store still holds are listed (one removed by garbage collection drops out). No status, slot or winner depends on it. It checks stored bytes, not browser playback. Narrow with `?run=` (a run key) and `?layer=` (an id prefix of at least 7 hex digits, repeatable).

- `run` (query): Only layers of this run (a key from `GET /api/reports/runs`).
- `layer` (query): Only layers whose id starts with this prefix. Repeatable or comma-separated.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The held read-backs.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### Which stored recordings the server last read back, and which were gone or damaged

`GET /api/projects/{project}/reports/recordings/verification` · role: read

The newest read-back the server did of stored videos, per layer: how many it checked, how many passed and the `gaps` (a blob that is gone, bytes of another size or hash than were published, or a file that does not begin like its container), each naming the check that holds the video. `run` is the key of the run the layer belongs to (a `RunSummary.key`), so a viewer can mark that run's recordings as stored-then-unavailable beside its test results.

This route never reads a blob: it returns what a publish token's `POST` found earlier. A layer that was never read back is absent, which means "not verified", not "fine"; the result is kept in the server's memory only, so a restart empties it. Only layers a store still holds are listed (one removed by garbage collection drops out). No status, slot or winner depends on it. It checks stored bytes, not browser playback. Narrow with `?run=` (a run key) and `?layer=` (an id prefix of at least 7 hex digits, repeatable).

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `run` (query): Only layers of this run (a key from `GET /api/reports/runs`).
- `layer` (query): Only layers whose id starts with this prefix. Repeatable or comma-separated.

Responses: `200` The held read-backs.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### Read stored recordings back and check them (publish token)

`POST /api/reports/recordings/verification` · role: publish

Reads the videos of the newest layers (`limit`, default 20, at most 200; or the layers `layers` names) back from storage and checks that each is still stored, still has the size and SHA-256 published, and still begins like its media type's container. This reads blobs, so it needs a publish (or admin) token in a Bearer header; a reader-only token, a browser sign-in box and an anonymous reader are refused. One read-back runs at a time (`409` otherwise). It writes nothing to storage and changes no status. The answer is the same document `GET` returns, with `verified`: how many layers this pass read back.

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The read-backs now held.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `409` A read-back is already running.; `413` Request too large.; `422` Not a verification request.; `502` A store could not be read.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Read stored recordings back and check them (publish token)

`POST /api/projects/{project}/reports/recordings/verification` · role: publish

Reads the videos of the newest layers (`limit`, default 20, at most 200; or the layers `layers` names) back from storage and checks that each is still stored, still has the size and SHA-256 published, and still begins like its media type's container. This reads blobs, so it needs a publish (or admin) token in a Bearer header; a reader-only token, a browser sign-in box and an anonymous reader are refused. One read-back runs at a time (`409` otherwise). It writes nothing to storage and changes no status. The answer is the same document `GET` returns, with `verified`: how many layers this pass read back.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The read-backs now held.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `409` A read-back is already running.; `413` Request too large.; `422` Not a verification request.; `502` A store could not be read.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Review collections: curated sets of recordings, newest first

`GET /api/reports/review-collections` · role: read

The newest revision of every review collection, in brief: id, revision and how many exist, title, purpose, audience, tags, how many entries and gaps it has, who published it and when. A collection is curation kept beside the report; it is not a layer, a check or a run, and it has no status. Open one with `/api/reports/review-collections/detail?id=`. Its share URL is the viewer's `?tab=collections&collection=<id>` and needs the same read access as the rest of the report.

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The collections.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### Review collections: curated sets of recordings, newest first

`GET /api/projects/{project}/reports/review-collections` · role: read

The newest revision of every review collection, in brief: id, revision and how many exist, title, purpose, audience, tags, how many entries and gaps it has, who published it and when. A collection is curation kept beside the report; it is not a layer, a check or a run, and it has no status. Open one with `/api/reports/review-collections/detail?id=`. Its share URL is the viewer's `?tab=collections&collection=<id>` and needs the same read access as the rest of the report.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The collections.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.

### Publish an immutable review collection (or a new revision of one)

`POST /api/reports/review-collections` · role: publish

Freezes an ordered set of references to recorded results as one named collection, recorded under the name of the publish (or admin) token that sends it. Take each entry's `layer` and `check` (and `kind`) from `GET /api/reports/artifacts`, and optionally one of its recordings (`videos[].recording`). The server resolves every entry to the result the report holds and records what the report says about it (status, time, run, commit, environment, tries, videos): the request does not claim them. An entry it cannot resolve refuses the whole request (`422`, naming the entry). The order is yours and is never re-sorted; failed, rejected and incomplete results stay in it beside a later passing replay.

Entries from different runs are never one execution: each keeps its own layer, run and status. A collection has no status of its own, adds no check and cannot change any result or winner. A revision is immutable. To change a collection, publish a new revision with `basedOn: { id, revision }` naming the newest revision (`409` otherwise); the earlier ones stay readable. Notes and reviewed marks are separate (`/reviews`). A reader-only token, a browser sign-in box and an anonymous reader are refused; nothing is shared publicly by default.

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `201` The recorded revision.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `404` `basedOn` names no collection.; `409` `basedOn.revision` is not the newest.; `413` Request too large.; `422` Not a collection, or an entry the report does not hold.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Publish an immutable review collection (or a new revision of one)

`POST /api/projects/{project}/reports/review-collections` · role: publish

Freezes an ordered set of references to recorded results as one named collection, recorded under the name of the publish (or admin) token that sends it. Take each entry's `layer` and `check` (and `kind`) from `GET /api/reports/artifacts`, and optionally one of its recordings (`videos[].recording`). The server resolves every entry to the result the report holds and records what the report says about it (status, time, run, commit, environment, tries, videos): the request does not claim them. An entry it cannot resolve refuses the whole request (`422`, naming the entry). The order is yours and is never re-sorted; failed, rejected and incomplete results stay in it beside a later passing replay.

Entries from different runs are never one execution: each keeps its own layer, run and status. A collection has no status of its own, adds no check and cannot change any result or winner. A revision is immutable. To change a collection, publish a new revision with `basedOn: { id, revision }` naming the newest revision (`409` otherwise); the earlier ones stay readable. Notes and reviewed marks are separate (`/reviews`). A reader-only token, a browser sign-in box and an anonymous reader are refused; nothing is shared publicly by default.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `201` The recorded revision.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `404` `basedOn` names no collection.; `409` `basedOn.revision` is not the newest.; `413` Request too large.; `422` Not a collection, or an entry the report does not hold.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### One review collection revision with how its sources stand now

`GET /api/reports/review-collections/detail` · role: read

The revision (the newest without `revision`), every revision number, the review notes and reviewed marks of that revision, and for each entry `availability`: `available` (its layer is held and the report lists the result), `unverified` (the layer is held but the report no longer lists the result or recording) or `unavailable` (the layer is gone, for example deleted by garbage collection), with the reason. An entry whose source is not available stays in its place with its frozen snapshot; it is never removed or replaced. Entries keep the status each layer recorded, with their own times, in the order the curator chose. A reviewed mark is curation: it changes no outcome and is not an approval.

- `id` (query, required): A collection id from the list.
- `revision` (query): A revision number. Default: the newest.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The revision.; `400` No `id`, or a bad `revision`.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such collection or revision.

### One review collection revision with how its sources stand now

`GET /api/projects/{project}/reports/review-collections/detail` · role: read

The revision (the newest without `revision`), every revision number, the review notes and reviewed marks of that revision, and for each entry `availability`: `available` (its layer is held and the report lists the result), `unverified` (the layer is held but the report no longer lists the result or recording) or `unavailable` (the layer is gone, for example deleted by garbage collection), with the reason. An entry whose source is not available stays in its place with its frozen snapshot; it is never removed or replaced. Entries keep the status each layer recorded, with their own times, in the order the curator chose. A reviewed mark is curation: it changes no outcome and is not an approval.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `id` (query, required): A collection id from the list.
- `revision` (query): A revision number. Default: the newest.

Responses: `200` The revision.; `400` No `id`, or a bad `revision`.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such collection or revision.

### Add a note, a time-coded gap note or a reviewed mark to a collection entry

`POST /api/reports/review-collections/reviews` · role: publish

Records one immutable entry, by the name of the publish (or admin) token and the server's time: a `note` or a `gap` (text required; with `entry` and optionally `timecodeMs`, a moment in that entry's recording), or a `reviewed` / `unreviewed` mark for one entry. It changes no check outcome, no layer, no collection revision and no report winner; a mark is not an acceptance sign-off. The notes of a revision are in its `detail`.

- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `201` The recorded note.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `404` No such collection or revision.; `413` Request too large.; `422` Not a note: missing text, an unknown entry, or a mark without an entry.

### Add a note, a time-coded gap note or a reviewed mark to a collection entry

`POST /api/projects/{project}/reports/review-collections/reviews` · role: publish

Records one immutable entry, by the name of the publish (or admin) token and the server's time: a `note` or a `gap` (text required; with `entry` and optionally `timecodeMs`, a moment in that entry's recording), or a `reviewed` / `unreviewed` mark for one entry. It changes no check outcome, no layer, no collection revision and no report winner; a mark is not an acceptance sign-off. The notes of a revision are in its `detail`.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `201` The recorded note.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `403` The token is known but its role may not do this.; `404` No such collection or revision.; `413` Request too large.; `422` Not a note: missing text, an unknown entry, or a mark without an entry.

### Portable index (manifest) of one review collection revision

`GET /api/reports/review-collections/export` · role: read

A manifest an archive can be built from: the collection, each entry with its exact source (layer, check, kind, recording), the status and run it was recorded with, how it stands now, whether it is marked reviewed, and the files it references with their name as recorded, a safe name and path (`files/<position>-<safeName>`), and the recorded `sha256` when the report holds one (`null` is unknown, not verified). A source that cannot be read now is listed under `missing` and its files are marked `missing`; nothing is left out silently. The manifest contains no bytes; recordings are fetched from the attachment routes, which keep their own access control. Sent as an attachment.

- `id` (query, required): A collection id.
- `revision` (query): A revision number. Default: the newest.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The manifest.; `400` No `id`, or a bad `revision`.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such collection or revision.

### Portable index (manifest) of one review collection revision

`GET /api/projects/{project}/reports/review-collections/export` · role: read

A manifest an archive can be built from: the collection, each entry with its exact source (layer, check, kind, recording), the status and run it was recorded with, how it stands now, whether it is marked reviewed, and the files it references with their name as recorded, a safe name and path (`files/<position>-<safeName>`), and the recorded `sha256` when the report holds one (`null` is unknown, not verified). A source that cannot be read now is listed under `missing` and its files are marked `missing`; nothing is left out silently. The manifest contains no bytes; recordings are fetched from the attachment routes, which keep their own access control. Sent as an attachment.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `id` (query, required): A collection id.
- `revision` (query): A revision number. Default: the newest.

Responses: `200` The manifest.; `400` No `id`, or a bad `revision`.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `404` No such collection or revision.

### The runs that recorded the report

`GET /api/reports/runs` · role: read

Every run, newest first: layers grouped by their CI run URL (else branch and commit), with their environments, producers, how many tests they recorded, their results by status, the time they spanned, up to twenty failures, their video counts (references, distinct playable recordings, unavailable) and the artifact tags, media types and labels their results carry. Filters narrow the list before `limit`: AND across the parameters, OR within one; `filters` in the answer names those that were applied and `facets` offers each dimension's values with counts. A server that does not know a filter ignores it and does not name it in `filters`. Send `format=markdown` for Markdown.

- `limit` (query): At most this many runs (default 100).
- `video` (query): `true` to list only runs that have a playable video recording. Applied to every run before `limit`; `total` counts the matches. A server that does not know it answers with every run.
- `artifactTag` (query): Artifact tags (`demo` and `#demo` are the same), repeatable or comma-separated. A comma or backslash inside a value is written `\,` or `\\`. OR within the parameter, AND with the other filters.
- `inherited` (query): `1` with `artifactTag` to also match the tags attachments inherit from their check and run. Default: the exact artifact query.
- `type` (query): Media types as roles (`video`, `image`, `audio`, `snapshot`, `text`, `file`, or a producer's own). `video` means a playable recording. With `artifactTag`, one artifact must be both where the report says which videos carry which tags.
- `label` (query): `key=value`, or `key` for any value.
- `environment` (query): Environments or devices (`ios`, `desktop-web`).
- `producer` (query): Producers.
- `branch` (query): Branches.
- `sha` (query): Revisions: a full commit id or a prefix of at least seven characters.
- `outcome` (query): Statuses: `passed`, `failed`, `running`, `not-run`. A run's outcome is `failed` when any result failed, else `running`, else `passed`, else `not-run`.
- `recordings` (query): Recording completeness of the run, apart from its outcome: `complete`, `incomplete`, `none-expected` or `unknown` (a run whose layers declared no recording expectations is `unknown`, never `complete`). Repeatable or comma-separated. Answered from the layers' receipts; no recording is read. A server that does not know it ignores it and does not name it in `filters`.
- `q` (query): Words that must all appear in the title, id, spec, branch, producer, environment, tags or labels.
- `since` (query): Only records at or after this time: epoch milliseconds or an ISO date (a date alone is UTC). A result's recording time; a run's end.
- `until` (query): Only records at or before this time (same forms as `since`).
- `format` (query): `markdown` for Markdown instead of JSON.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The runs.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### The runs that recorded the report

`GET /api/projects/{project}/reports/runs` · role: read

Every run, newest first: layers grouped by their CI run URL (else branch and commit), with their environments, producers, how many tests they recorded, their results by status, the time they spanned, up to twenty failures, their video counts (references, distinct playable recordings, unavailable) and the artifact tags, media types and labels their results carry. Filters narrow the list before `limit`: AND across the parameters, OR within one; `filters` in the answer names those that were applied and `facets` offers each dimension's values with counts. A server that does not know a filter ignores it and does not name it in `filters`. Send `format=markdown` for Markdown.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `limit` (query): At most this many runs (default 100).
- `video` (query): `true` to list only runs that have a playable video recording. Applied to every run before `limit`; `total` counts the matches. A server that does not know it answers with every run.
- `artifactTag` (query): Artifact tags (`demo` and `#demo` are the same), repeatable or comma-separated. A comma or backslash inside a value is written `\,` or `\\`. OR within the parameter, AND with the other filters.
- `inherited` (query): `1` with `artifactTag` to also match the tags attachments inherit from their check and run. Default: the exact artifact query.
- `type` (query): Media types as roles (`video`, `image`, `audio`, `snapshot`, `text`, `file`, or a producer's own). `video` means a playable recording. With `artifactTag`, one artifact must be both where the report says which videos carry which tags.
- `label` (query): `key=value`, or `key` for any value.
- `environment` (query): Environments or devices (`ios`, `desktop-web`).
- `producer` (query): Producers.
- `branch` (query): Branches.
- `sha` (query): Revisions: a full commit id or a prefix of at least seven characters.
- `outcome` (query): Statuses: `passed`, `failed`, `running`, `not-run`. A run's outcome is `failed` when any result failed, else `running`, else `passed`, else `not-run`.
- `recordings` (query): Recording completeness of the run, apart from its outcome: `complete`, `incomplete`, `none-expected` or `unknown` (a run whose layers declared no recording expectations is `unknown`, never `complete`). Repeatable or comma-separated. Answered from the layers' receipts; no recording is read. A server that does not know it ignores it and does not name it in `filters`.
- `q` (query): Words that must all appear in the title, id, spec, branch, producer, environment, tags or labels.
- `since` (query): Only records at or after this time: epoch milliseconds or an ISO date (a date alone is UTC). A result's recording time; a run's end.
- `until` (query): Only records at or before this time (same forms as `since`).
- `format` (query): `markdown` for Markdown instead of JSON.

Responses: `200` The runs.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Recorded results that carry evidence, across the whole history

`GET /api/reports/artifacts` · role: read

Every recorded result that has attachments (recordings, screenshots, traces), newest first, found in the history and not only among the current winners: a recording tagged `demo` is found with its original run, revision and status even when a later attempt is untagged. Narrow it by artifact tag, media type, label, feature (`domain`, `spec`), environment or device, producer, branch, revision, outcome and time: AND across the parameters, OR within one; with both `artifactTag` and `type`, one artifact must be both. `filters` names the filters that were applied and `facets` offers each dimension's values with counts: the count beside a value is what the list would hold if that value alone were chosen in its dimension, every other filter applied. Tags written by reviewers after upload are not searched; only those in the layer are. Send `format=markdown` for Markdown.

- `limit` (query): At most this many results (default 100).
- `offset` (query): Skip this many matches (default 0).
- `video` (query): `true` for results with a playable video recording (the same as `type=video`).
- `domain` (query): The feature domain of the result's spec.
- `spec` (query): Spec paths.
- `artifactTag` (query): Artifact tags (`demo` and `#demo` are the same), repeatable or comma-separated. A comma or backslash inside a value is written `\,` or `\\`. OR within the parameter, AND with the other filters.
- `inherited` (query): `1` with `artifactTag` to also match the tags attachments inherit from their check and run. Default: the exact artifact query.
- `type` (query): Media types as roles (`video`, `image`, `audio`, `snapshot`, `text`, `file`, or a producer's own). `video` means a playable recording. With `artifactTag`, one artifact must be both where the report says which videos carry which tags.
- `label` (query): `key=value`, or `key` for any value.
- `environment` (query): Environments or devices (`ios`, `desktop-web`).
- `producer` (query): Producers.
- `branch` (query): Branches.
- `sha` (query): Revisions: a full commit id or a prefix of at least seven characters.
- `outcome` (query): Statuses: `passed`, `failed`, `running`, `not-run`. A run's outcome is `failed` when any result failed, else `running`, else `passed`, else `not-run`.
- `q` (query): Words that must all appear in the title, id, spec, branch, producer, environment, tags or labels.
- `since` (query): Only records at or after this time: epoch milliseconds or an ISO date (a date alone is UTC). A result's recording time; a run's end.
- `until` (query): Only records at or before this time (same forms as `since`).
- `format` (query): `markdown` for Markdown instead of JSON.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The matching results and the facets.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### Recorded results that carry evidence, across the whole history

`GET /api/projects/{project}/reports/artifacts` · role: read

Every recorded result that has attachments (recordings, screenshots, traces), newest first, found in the history and not only among the current winners: a recording tagged `demo` is found with its original run, revision and status even when a later attempt is untagged. Narrow it by artifact tag, media type, label, feature (`domain`, `spec`), environment or device, producer, branch, revision, outcome and time: AND across the parameters, OR within one; with both `artifactTag` and `type`, one artifact must be both. `filters` names the filters that were applied and `facets` offers each dimension's values with counts: the count beside a value is what the list would hold if that value alone were chosen in its dimension, every other filter applied. Tags written by reviewers after upload are not searched; only those in the layer are. Send `format=markdown` for Markdown.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `limit` (query): At most this many results (default 100).
- `offset` (query): Skip this many matches (default 0).
- `video` (query): `true` for results with a playable video recording (the same as `type=video`).
- `domain` (query): The feature domain of the result's spec.
- `spec` (query): Spec paths.
- `artifactTag` (query): Artifact tags (`demo` and `#demo` are the same), repeatable or comma-separated. A comma or backslash inside a value is written `\,` or `\\`. OR within the parameter, AND with the other filters.
- `inherited` (query): `1` with `artifactTag` to also match the tags attachments inherit from their check and run. Default: the exact artifact query.
- `type` (query): Media types as roles (`video`, `image`, `audio`, `snapshot`, `text`, `file`, or a producer's own). `video` means a playable recording. With `artifactTag`, one artifact must be both where the report says which videos carry which tags.
- `label` (query): `key=value`, or `key` for any value.
- `environment` (query): Environments or devices (`ios`, `desktop-web`).
- `producer` (query): Producers.
- `branch` (query): Branches.
- `sha` (query): Revisions: a full commit id or a prefix of at least seven characters.
- `outcome` (query): Statuses: `passed`, `failed`, `running`, `not-run`. A run's outcome is `failed` when any result failed, else `running`, else `passed`, else `not-run`.
- `q` (query): Words that must all appear in the title, id, spec, branch, producer, environment, tags or labels.
- `since` (query): Only records at or after this time: epoch milliseconds or an ISO date (a date alone is UTC). A result's recording time; a run's end.
- `until` (query): Only records at or before this time (same forms as `since`).
- `format` (query): `markdown` for Markdown instead of JSON.

Responses: `200` The matching results and the facets.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### The UI catalog: captured UI states per profile, and what is still expected

`GET /api/reports/ui-catalog` · role: read

A browsable inventory of the product's user interface, computed from the winning results of the `ui-state` and `ui-plan` parts of every layer (see the UI catalog guide). Each state is a check id; each cell is one profile of it (the layer's environment and parameters) with its coverage: `captured` only when the winning capture passed, `failed`, `capturing`, `skipped`, or `missing` when a plan expects it and nothing has been captured. A picture is read from the cell's `capture.image.path` under the reports API root, or `uri`. What is expected is itself a layer, so a shard that never published leaves its states `missing`, never captured. The document equals what the viewer computes from the same report. Narrow it by `q` (words), `coverage`, `profile` (a profile `key`), `area`, `route`, `cohort`, `flag`, `surface`, `producer` and `attribute` (`name=value`, a fact a producer declared): AND across parameters, OR within one value list; a state keeps only the cells that match `profile` and `coverage`. Page the states with `limit` and `offset`. The document only grows within `schemaVersion` 1: a client ignores fields and `coverage`, `expected` and surface `status` values it does not know (and never reads an unknown coverage as `captured`), and a parameter or coverage a server does not know is ignored, which answers the whole catalog. Viewers need not poll: they hold the report over `/api/events` and read changes with `/api/reports/evidence/effective?since=`.

- `limit` (query): At most this many states (default 200).
- `offset` (query): Skip this many states (default 0).
- `q` (query): Words that must all appear in a state's id, title, route, fixture, cohort, area, flags, surfaces, producers or attribute values.
- `coverage` (query): Coverage values: `captured`, `failed`, `capturing`, `skipped`, `missing`. Comma-separated. A value the server does not know is ignored.
- `profile` (query): Profile keys, as listed in `profiles[].key`.
- `area` (query): Areas.
- `route` (query): Routes.
- `cohort` (query): Cohorts.
- `flag` (query): Feature flags a state was captured with.
- `surface` (query): Surfaces a state covers.
- `producer` (query): Producers that captured or planned a state.
- `attribute` (query): Attributes a producer declared, as `name=value` (a comma or backslash inside a value is written `\,` or `\\`). Several values of one name are alternatives; different names combine with AND.
- `format` (query): `markdown` for Markdown instead of JSON.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` The catalog.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### The UI catalog: captured UI states per profile, and what is still expected

`GET /api/projects/{project}/reports/ui-catalog` · role: read

A browsable inventory of the product's user interface, computed from the winning results of the `ui-state` and `ui-plan` parts of every layer (see the UI catalog guide). Each state is a check id; each cell is one profile of it (the layer's environment and parameters) with its coverage: `captured` only when the winning capture passed, `failed`, `capturing`, `skipped`, or `missing` when a plan expects it and nothing has been captured. A picture is read from the cell's `capture.image.path` under the reports API root, or `uri`. What is expected is itself a layer, so a shard that never published leaves its states `missing`, never captured. The document equals what the viewer computes from the same report. Narrow it by `q` (words), `coverage`, `profile` (a profile `key`), `area`, `route`, `cohort`, `flag`, `surface`, `producer` and `attribute` (`name=value`, a fact a producer declared): AND across parameters, OR within one value list; a state keeps only the cells that match `profile` and `coverage`. Page the states with `limit` and `offset`. The document only grows within `schemaVersion` 1: a client ignores fields and `coverage`, `expected` and surface `status` values it does not know (and never reads an unknown coverage as `captured`), and a parameter or coverage a server does not know is ignored, which answers the whole catalog. Viewers need not poll: they hold the report over `/api/events` and read changes with `/api/reports/evidence/effective?since=`.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `limit` (query): At most this many states (default 200).
- `offset` (query): Skip this many states (default 0).
- `q` (query): Words that must all appear in a state's id, title, route, fixture, cohort, area, flags, surfaces, producers or attribute values.
- `coverage` (query): Coverage values: `captured`, `failed`, `capturing`, `skipped`, `missing`. Comma-separated. A value the server does not know is ignored.
- `profile` (query): Profile keys, as listed in `profiles[].key`.
- `area` (query): Areas.
- `route` (query): Routes.
- `cohort` (query): Cohorts.
- `flag` (query): Feature flags a state was captured with.
- `surface` (query): Surfaces a state covers.
- `producer` (query): Producers that captured or planned a state.
- `attribute` (query): Attributes a producer declared, as `name=value` (a comma or backslash inside a value is written `\,` or `\\`). Several values of one name are alternatives; different names combine with AND.
- `format` (query): `markdown` for Markdown instead of JSON.

Responses: `200` The catalog.; `304` Unchanged since the `If-None-Match` ETag.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### The UI catalog as a list a critic iterates: captured states with their picture hash and critiques

`GET /api/reports/ui-catalog/entries` · role: read

The captured states of the UI catalog, one entry per state per profile that has a picture stored in its layer, in key order, for a process that reviews them (a critic: see the critics guide). Page with `limit` and the opaque `cursor` of the previous page (`nextCursor`): the cursor names the last key, so each entry is seen exactly once and in the same order. An entry carries `image.sha256` (the hash a critique is anchored to) and `image.path` (fetch the bytes from `/api/reports` + path, through the same safe attachment path as every file), its `state` kind, and `critiques`: those already made, newest first, each marked `current` or `earlier-image`. Keep the `version` of the first page; later ask `since=<that version>` to read only the entries whose layer was added or changed since. A `since` the server does not remember is answered with the whole catalog and `since.honored: false`. `unjudgedBy=<critic>@<version>` keeps entries with no current critique with a verdict from that critic (a failed critique is not a judgement). To be told that something changed, hold `/api/events`: a `report` event carries the new version; then read `since`. A critic-role token may read this.

- `limit` (query): At most this many entries per page (default 100, at most 1000).
- `cursor` (query): The `nextCursor` of the previous page. Anything else is `400`.
- `since` (query): A report version (`version` of an earlier answer): only entries whose layer was added or changed since. An unknown version is answered with everything.
- `unjudgedBy` (query): `name` or `name@version` of a critic: only entries it has no current verdict for.
- `q` (query): Words that must all appear in an entry's key, title, route or area.
- `area` (query): Areas. Comma-separated.
- `profile` (query): Profile keys, as listed in `profile.key`. Comma-separated.
- `state` (query): State kinds: `screen`, `overlay`, `loading`, `error`, `empty`, `unknown`… Comma-separated.
- `route` (query): Routes. Comma-separated.
- `project` (query): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.

Responses: `200` One page of entries.; `304` Unchanged since the `If-None-Match` ETag.; `400` The cursor is not one this server made.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

### The UI catalog as a list a critic iterates: captured states with their picture hash and critiques

`GET /api/projects/{project}/reports/ui-catalog/entries` · role: read

The captured states of the UI catalog, one entry per state per profile that has a picture stored in its layer, in key order, for a process that reviews them (a critic: see the critics guide). Page with `limit` and the opaque `cursor` of the previous page (`nextCursor`): the cursor names the last key, so each entry is seen exactly once and in the same order. An entry carries `image.sha256` (the hash a critique is anchored to) and `image.path` (fetch the bytes from `/api/reports` + path, through the same safe attachment path as every file), its `state` kind, and `critiques`: those already made, newest first, each marked `current` or `earlier-image`. Keep the `version` of the first page; later ask `since=<that version>` to read only the entries whose layer was added or changed since. A `since` the server does not remember is answered with the whole catalog and `since.honored: false`. `unjudgedBy=<critic>@<version>` keeps entries with no current critique with a verdict from that critic (a failed critique is not a judgement). To be told that something changed, hold `/api/events`: a `report` event carries the new version; then read `since`. A critic-role token may read this.

Scoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.

- `project` (path, required): Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.
- `limit` (query): At most this many entries per page (default 100, at most 1000).
- `cursor` (query): The `nextCursor` of the previous page. Anything else is `400`.
- `since` (query): A report version (`version` of an earlier answer): only entries whose layer was added or changed since. An unknown version is answered with everything.
- `unjudgedBy` (query): `name` or `name@version` of a critic: only entries it has no current verdict for.
- `q` (query): Words that must all appear in an entry's key, title, route or area.
- `area` (query): Areas. Comma-separated.
- `profile` (query): Profile keys, as listed in `profile.key`. Comma-separated.
- `state` (query): State kinds: `screen`, `overlay`, `loading`, `error`, `empty`, `unknown`… Comma-separated.
- `route` (query): Routes. Comma-separated.

Responses: `200` One page of entries.; `304` Unchanged since the `If-None-Match` ETag.; `400` The cursor is not one this server made.; `401` No token, or an unknown one. Send `Authorization: Bearer <token>`.; `503` The server is still reading its backends. Retry after the number of seconds in `Retry-After`.

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
