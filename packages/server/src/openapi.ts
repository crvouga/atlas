/**
 * @module OpenAPI document of the Atlas server
 *
 * The server's HTTP API described as an OpenAPI 3.1 document (JSON Schema 2020-12 inside), generated from the
 * operation table below and the Zod schemas of `packages/schema/src/api.ts`. It is served at `GET /api/openapi.json`,
 * shipped as `@crvouga/atlas/openapi.json`, and committed as `packages/server/openapi.json` (`bun run docs` rewrites
 * it; a test fails when it differs). Any OpenAPI tool can generate a client, a mock or a test suite from it.
 *
 * The table is held to the code by a test: every route the server registers must have an operation here and every
 * operation here must be a route the server registers. Adding a route without describing it fails the build.
 *
 * Stability: this API only grows within `API_VERSION`: optional parameters, optional response fields, new
 * operations and new events. See AGENTS.md ("The server is a living application").
 */
import { z } from 'zod/v4';
import { ProjectsSchema } from '../../schema/src/project';

import { EffectiveDeltaSchema, EffectiveEvidenceSchema, EvidencePageSchema, HealthSchema, LayerRowsSchema, CheckDetailSchema, OutlineSchema, ProblemSchema, ReadySchema, ServerInfoSchema, StoreListingSchema, StoreWriteResultSchema, ChecksResultSchema, HelloEventSchema, ReportEventSchema, PingEventSchema, TestCatalogSchema, CatalogHealthSchema, TestHistorySchema, TestReliabilitySchema, RunListSchema, RunDetailSchema, ArtifactListSchema, UiCatalogSchema, ArtifactTagEditSchema, ArtifactTagEntrySchema, ArtifactTagsSchema, ReviewCollectionRequestSchema, ReviewCollectionSchema, ReviewCollectionListSchema, ReviewCollectionDetailSchema, ReviewNoteInputSchema, ReviewNoteSchema, ReviewManifestSchema } from '../../schema/src/api';
import { LiveRunSchema, LiveRunStartSchema, LiveRunUpdateSchema, ServerEditableSettingsSchema, ServerSettingsSnapshotSchema, GcPolicySchema, GcSnapshotSchema, GcRunResultSchema, AtlasChangeSchema, PublishChecksSchema, ReportSourcesSchema, ReportStatusSchema, RunsIndexSchema, SpecIndexSchema } from '../../schema/src/index';

/** The version of the API described, `major.minor.patch`: the minor grows when an operation or field is added, the major never within `/api`. */
export const API_VERSION = '1.6.0';

/** Who may call an operation: `none` (anyone), or the least role that may (`read` < `critic` < `publish` < `admin`). */
export type Role = 'none' | 'read' | 'critic' | 'publish' | 'admin';

type JsonSchema = Record<string, unknown>;
type Param = { readonly name: string; readonly in: 'path' | 'query' | 'header'; readonly description: string; readonly required?: boolean; readonly schema?: JsonSchema; readonly example?: unknown };
type Body = { readonly description: string; readonly contentType: string; readonly schema: JsonSchema; readonly required?: boolean };
type Response = { readonly description: string; readonly contentType?: string; readonly schema?: JsonSchema; readonly headers?: Record<string, { description: string; schema: JsonSchema }> };

/** One operation of the API, and the route the server registers for it. */
export type Operation = {
  /** The route as Hono registers it, `METHOD /path` (`:name` for a parameter, `*` for the rest of the path). */
  readonly route: string;
  /** The same route as OpenAPI writes it, `/path/{name}`. */
  readonly path: string;
  readonly operationId: string;
  readonly tag: string;
  readonly summary: string;
  /** What it does and how to use it, written for a client that has read nothing else (Markdown). */
  readonly description: string;
  readonly role: Role;
  readonly parameters?: readonly Param[];
  readonly body?: Body;
  readonly responses: Readonly<Record<string, Response>>;
};

/** The JSON Schema of a Zod schema, as OpenAPI 3.1 embeds it. `output` for what the server sends, `input` for what it accepts. */
function schemaOf(schema: z.ZodType, io: 'input' | 'output' = 'output'): JsonSchema {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any', io }) as JsonSchema;
  return json;
}

/**
 * The named schemas of the document (`components.schemas`), each written once and referred to by `$ref`. `output` is
 * the shape the server sends, `input` the shape it accepts.
 */
const COMPONENTS = {
  LiveRun: [LiveRunSchema, 'output'], LiveRunStart: [LiveRunStartSchema, 'input'], LiveRunUpdate: [LiveRunUpdateSchema, 'input'],
  ServerEditableSettings: [ServerEditableSettingsSchema, 'input'], ServerSettingsSnapshot: [ServerSettingsSnapshotSchema, 'output'],
  GcPolicy: [GcPolicySchema, 'input'], GcSnapshot: [GcSnapshotSchema, 'output'], GcRunResult: [GcRunResultSchema, 'output'],
  Problem: [ProblemSchema, 'output'], Health: [HealthSchema, 'output'], Ready: [ReadySchema, 'output'], ServerInfo: [ServerInfoSchema, 'output'],
  EffectiveEvidence: [EffectiveEvidenceSchema, 'output'], EffectiveDelta: [EffectiveDeltaSchema, 'output'], ReportStatus: [ReportStatusSchema, 'output'],
  PublishChecks: [PublishChecksSchema.partial({ recordedAtMs: true }), 'input'], ChecksResult: [ChecksResultSchema, 'output'],
  StoreListing: [StoreListingSchema, 'output'], StoreWriteResult: [StoreWriteResultSchema, 'output'],
  Outline: [OutlineSchema, 'output'], EvidencePage: [EvidencePageSchema, 'output'], LayerRows: [LayerRowsSchema, 'output'], CheckDetail: [CheckDetailSchema, 'output'],
  ArtifactTagEdit: [ArtifactTagEditSchema, 'input'], ArtifactTagEntry: [ArtifactTagEntrySchema, 'output'], ArtifactTags: [ArtifactTagsSchema, 'output'],
  ReviewCollectionRequest: [ReviewCollectionRequestSchema, 'input'], ReviewCollection: [ReviewCollectionSchema, 'output'], ReviewCollectionList: [ReviewCollectionListSchema, 'output'], ReviewCollectionDetail: [ReviewCollectionDetailSchema, 'output'], ReviewNoteInput: [ReviewNoteInputSchema, 'input'], ReviewNote: [ReviewNoteSchema, 'output'], ReviewManifest: [ReviewManifestSchema, 'output'],
  TestCatalog: [TestCatalogSchema, 'output'], CatalogHealth: [CatalogHealthSchema, 'output'], TestHistory: [TestHistorySchema, 'output'], TestReliability: [TestReliabilitySchema, 'output'], RunList: [RunListSchema, 'output'], ArtifactList: [ArtifactListSchema, 'output'], UiCatalog: [UiCatalogSchema, 'output'], RunDetail: [RunDetailSchema, 'output'],
  SpecIndex: [SpecIndexSchema, 'output'], ReportSources: [ReportSourcesSchema, 'output'], RunsIndex: [RunsIndexSchema, 'output'],
  RunEvent: [LiveRunSchema, 'output'], HelloEvent: [HelloEventSchema, 'output'], ReportEvent: [ReportEventSchema, 'output'], AtlasChangeEvent: [AtlasChangeSchema, 'output'], PingEvent: [PingEventSchema, 'output']
} as const satisfies Record<string, readonly [z.ZodType, 'input' | 'output']>;
type ComponentName = keyof typeof COMPONENTS;
const ref = (name: ComponentName): JsonSchema => ({ $ref: `#/components/schemas/${name}` });

const str = { type: 'string' } as const;
const problem = (description: string): Response => ({ description, contentType: 'application/problem+json', schema: ref('Problem') });
const json = (description: string, name: ComponentName): Response => ({ description, contentType: 'application/json', schema: ref(name) });
const NOT_READY = problem('The server is still reading its backends. Retry after the number of seconds in `Retry-After`.');
const UNAUTHORIZED = problem('No token, or an unknown one. Send `Authorization: Bearer <token>`.');
const FORBIDDEN = problem('The token is known but its role may not do this.');
const KEY: Param = { name: 'key', in: 'path', required: true, description: 'An object key under `layers/`, such as `layers/manifests/<id>.json`. It contains slashes, which are not percent-encoded; every other character is.', schema: str, example: 'layers/index/9007199254740985-0f3a….json' };
const BACKEND: Param = { name: 'backend', in: 'path', required: true, description: 'A backend id from `/api/server`.', schema: str };
const LAYER_ID: Param = { name: 'id', in: 'path', required: true, description: 'A layer id: 64 lowercase hex digits.', schema: { type: 'string', pattern: '^[0-9a-f]{64}$' } };

/**
 * Every operation of the API. The order is the order of the document. The descriptions are the documentation an
 * agent reads, so they say what to send, what comes back, and what to do when it does not work.
 */
const BASE_OPERATIONS: readonly Operation[] = [
  {
    route: 'GET /api/projects', path: '/api/projects', operationId: 'getProjects', tag: 'Projects', role: 'read',
    summary: 'List projects on this Atlas node', description: 'Projects are created on their first authenticated upload. All report, spec, recording and live-run data is isolated by project. Unqualified API calls address the legacy default project. Tokens retain their node-wide role; project partitioning is not a tenant authorization boundary.',
    responses: { '200': { description: 'Available project identities.', contentType: 'application/json', schema: schemaOf(ProjectsSchema) }, '401': UNAUTHORIZED, '503': problem('The project catalog is unavailable.') }
  },
  {
    route: 'GET /api/live', path: '/api/live', operationId: 'listLiveRuns', tag: 'Live', role: 'read',
    summary: 'Live test progress and recent invocations', description: 'Returns up to 50 recent producer leases, including running, completed and interrupted runs. Counters and recent check/step updates are bounded; authentication credentials are never returned. Consume run events for immediate bounded snapshots; re-fetch after reconnect or atlas:change with scope runs on older servers.',
    responses: { '200': { description: 'Recent live run summaries.', contentType: 'application/json', schema: { type: 'object', properties: { runs: { type: 'array', items: ref('LiveRun') } }, required: ['runs'] } }, '401': UNAUTHORIZED }
  },
  {
    route: 'POST /api/live/:id', path: '/api/live/{id}', operationId: 'startLiveRun', tag: 'Live', role: 'publish',
    summary: 'Start a live producer lease', description: 'Register a UUID run id and fixed producer identity before tests begin. Retrying the same identity and token is idempotent. The server timestamps receipt. Send heartbeats every 5 seconds and progress as tests execute. The default heartbeat timeout is 30 seconds; a 15-minute progress stall is configurable separately.',
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Producer-generated UUID, also given in the body.', schema: str }],
    body: { description: 'Fixed invocation identity and optional planned test count.', contentType: 'application/json', required: true, schema: ref('LiveRunStart') },
    responses: { '201': json('The registered lease.', 'LiveRun'), '401': UNAUTHORIZED, '403': FORBIDDEN, '409': problem('The id already belongs to another invocation.'), '413': problem('Request too large.'), '422': problem('Invalid identity.'), '429': problem('Live run capacity reached.') }
  },
  {
    route: 'PATCH /api/live/:id', path: '/api/live/{id}', operationId: 'updateLiveRun', tag: 'Live', role: 'publish',
    summary: 'Publish progress or finish an invocation', description: 'Apply ordered check deltas, starting at sequence 1. Retry a sequence with identical content only. Completed results become immutable report layers immediately; running checks remain operational progress and do not replace historical winners. Finish as completed or interrupted. Stale updates cannot revive an expired lease; pending checks never become passes.',
    parameters: [{ name: 'id', in: 'path', required: true, description: 'The UUID of a run started with this publisher token.', schema: str }],
    body: { description: 'At most 1000 unique check updates; optional terminal state and reason.', contentType: 'application/json', required: true, schema: ref('LiveRunUpdate') },
    responses: { '200': json('Updated progress.', 'LiveRun'), '401': UNAUTHORIZED, '403': FORBIDDEN, '404': problem('Unknown run.'), '409': problem('Run ended or sequence is stale.'), '413': problem('Request too large.'), '422': problem('Invalid progress.'), '429': problem('Run check capacity reached.') }
  },
  {
    route: 'POST /api/live/:id/heartbeat', path: '/api/live/{id}/heartbeat', operationId: 'heartbeatLiveRun', tag: 'Live', role: 'publish',
    summary: 'Renew a producer heartbeat', description: 'Renew a running lease using server receipt time, independently of test progress. No result layers are created. Heartbeats cannot revive terminal runs or bypass the configured progress-stall timeout. The producer token must be the one that started this invocation.',
    parameters: [{ name: 'id', in: 'path', required: true, description: 'The UUID of this producer invocation.', schema: str }],
    responses: { '200': { description: 'Heartbeat received.', contentType: 'application/json', schema: { type: 'object', properties: { ok: { const: true } } } }, '401': UNAUTHORIZED, '403': FORBIDDEN, '404': problem('Unknown run.'), '409': problem('Run ended or its lease expired.'), '422': problem('Invalid run id.') }
  },
  {
    route: 'GET /admin', path: '/admin', operationId: 'getSettingsPage', tag: 'Operations', role: 'read',
    summary: 'Server settings page', description: 'A standalone settings editor. Supply an admin Bearer token in the page to read or save configuration. The token is held only in memory.',
    responses: { '200': { description: 'Settings editor.', contentType: 'text/html', schema: str }, '401': UNAUTHORIZED }
  },
  {
    route: 'GET /api/settings', path: '/api/settings', operationId: 'getSettings', tag: 'Operations', role: 'admin',
    summary: 'Read server settings', description: 'Returns the editable report and live-run settings saved in the user state in S3, active settings, a revision, and configuration precedence. Storage and authentication settings are excluded. Requires an admin Bearer token. Embedded applications may manage settings outside this API.',
    responses: { '200': json('Settings and revision.', 'ServerSettingsSnapshot'), '401': UNAUTHORIZED, '403': FORBIDDEN, '503': problem('Configuration is managed by the embedding application.') }
  },
  {
    route: 'PUT /api/settings', path: '/api/settings', operationId: 'saveSettings', tag: 'Operations', role: 'admin',
    summary: 'Save settings for the next restart', description: 'Replaces the editable report and live-run settings in the user state in S3 (`server/state.json`), preserving the garbage collection policy and other fields. Persists a validated configuration; no report data is moved. Environment variables and flags override these values after restart. Requires an admin Bearer token, same-origin requests in browsers, and a current revision.',
    parameters: [{ name: 'If-Match', in: 'header', required: true, description: 'The quoted revision returned by GET /api/settings.', schema: str }],
    body: { description: 'Editable fields from ServerConfig, excluding storage, authentication, host, port and site. Maximum 64 KiB.', contentType: 'application/json', required: true, schema: ref('ServerEditableSettings') },
    responses: { '200': json('Saved settings and new revision. Restart required.', 'ServerSettingsSnapshot'), '401': UNAUTHORIZED, '403': FORBIDDEN, '409': problem('Settings changed; reload before saving.'), '413': problem('Settings exceed the body limit.'), '422': problem('Invalid configuration.'), '428': problem('A quoted settings revision is required.'), '503': problem('Configuration is managed by the embedding application.') }
  },
  {
    route: 'GET /api/settings/gc', path: '/api/settings/gc', operationId: 'getGarbageCollectionPolicy', tag: 'Operations', role: 'admin',
    summary: 'Read the garbage collection policy', description: 'Returns the policy kept in the user state in S3 (`server/state.json`), or `policy: null, saved: false` when none has been saved yet, in which case garbage collection is off and nothing is deleted. Also returns the revision to send back when saving and the last pass over each project. Requires an admin Bearer token. If the stored user state is unreadable the answer is 503 and the stored object is left untouched.',
    responses: { '200': json('The policy, its revision and the last passes.', 'GcSnapshot'), '401': UNAUTHORIZED, '403': FORBIDDEN, '503': problem('The user state in S3 cannot be read, or settings are managed by the embedding application.') }
  },
  {
    route: 'PUT /api/settings/gc', path: '/api/settings/gc', operationId: 'saveGarbageCollectionPolicy', tag: 'Operations', role: 'admin',
    summary: 'Save the garbage collection policy', description: 'Replaces the policy in the user state in S3 and leaves the rest of that document alone. The server reads the policy from S3 each time it collects, so the new policy applies at the next pass, without a restart. Requires an admin Bearer token, same-origin requests in browsers, and the current revision.',
    parameters: [{ name: 'If-Match', in: 'header', required: true, description: 'The quoted revision returned by GET /api/settings/gc.', schema: str }],
    body: { description: 'The policy. Maximum 16 KiB.', contentType: 'application/json', required: true, schema: ref('GcPolicy') },
    responses: { '200': json('The saved policy and the new revision.', 'GcSnapshot'), '401': UNAUTHORIZED, '403': FORBIDDEN, '409': problem('The state changed; reload before saving.'), '413': problem('The body exceeds the limit.'), '422': problem('Invalid policy.'), '428': problem('A quoted revision is required.'), '503': problem('The user state in S3 cannot be read, or settings are managed by the embedding application.') }
  },
  {
    route: 'POST /api/settings/gc/run', path: '/api/settings/gc/run', operationId: 'runGarbageCollection', tag: 'Operations', role: 'admin',
    summary: 'Collect garbage now, or preview it', description: 'Applies the policy saved in S3 to every project now, instead of waiting for the schedule. Only report layers that were read and no longer decide any result, older than the policy allows and beyond its `keepLatest`, are deleted, with the captured files only they used. With `dryRun=1` nothing is deleted and each run reports what it would delete (a disabled policy is previewed as if enabled). Answers 409 when no policy has been saved, and, without `dryRun`, when the saved policy is disabled. Requires an admin Bearer token and a same-origin request in browsers.',
    parameters: [{ name: 'dryRun', in: 'query', required: false, description: '`1` or `true` to only count what would be deleted.', schema: str }],
    responses: { '200': json('One run per project.', 'GcRunResult'), '401': UNAUTHORIZED, '403': FORBIDDEN, '409': problem('No policy has been saved, or it is disabled.') }
  },
  {
    route: 'GET /healthz', path: '/healthz', operationId: 'getHealth', tag: 'Operations', role: 'none',
    summary: 'Is the process up',
    description: 'Answers `200` as long as the process runs, whatever its backends are doing. Use it as a liveness probe. It needs no token and is not logged.',
    responses: { '200': json('The process is up.', 'Health') }
  },
  {
    route: 'GET /readyz', path: '/readyz', operationId: 'getReady', tag: 'Operations', role: 'none',
    summary: 'Has the server read its backends',
    description: 'Answers `200` once the first pass over the backends is done and at least one backend answers, `503` before that. Route traffic on it. The body counts what the report holds. No token needed.',
    responses: { '200': json('Ready.', 'Ready'), '503': json('Not ready yet; the body is the same shape with `ready: false`.', 'Ready') }
  },
  {
    route: 'GET /api/openapi.json', path: '/api/openapi.json', operationId: 'getOpenApi', tag: 'Operations', role: 'none',
    summary: 'This document',
    description: 'The OpenAPI 3.1 description of this API. No token needed, so a client that has only the server\'s address can learn how to use it.',
    responses: { '200': { description: 'The OpenAPI document.', contentType: 'application/json', schema: { type: 'object' } } }
  },
  {
    route: 'GET /llms.txt', path: '/llms.txt', operationId: 'getLlmsTxt', tag: 'Operations', role: 'none',
    summary: 'How to use this server, for an agent',
    description: 'A plain-text guide ([llms.txt](https://llmstxt.org)) written for an AI agent that was handed only this server\'s address: what it is, how to authenticate, the five commands that integrate a project, and where the machine-readable description is. No token needed.',
    responses: { '200': { description: 'The guide, Markdown.', contentType: 'text/plain', schema: str } }
  },
  {
    route: 'GET /api/server', path: '/api/server', operationId: 'getServer', tag: 'Operations', role: 'read',
    summary: 'What this server is and who is asking',
    description: 'The role of the token of this request, which backend takes uploads, whether each backend is reachable, counts, and `capabilities`: check a capability by name before using the feature it names. `atlas report doctor` and the viewer use it.',
    responses: { '200': json('The server.', 'ServerInfo'), '401': UNAUTHORIZED }
  },
  {
    route: 'GET /api/events', path: '/api/events', operationId: 'streamEvents', tag: 'Live', role: 'read',
    summary: 'Server-sent events: results arrived, specs or runs changed',
    description: [
      'A `text/event-stream` that stays open. Report events announce changes, and run events carry bounded live progress snapshots; authoritative state can always be fetched, so a client that missed events (a dropped connection) loses nothing: read again on reconnect.',
      '',
      '| event | data |',
      '| --- | --- |',
      '| `hello` | `{ version, ready, time, heartbeatMs? }`, sent first |',
      '| `report` | `{ version, totalLayers, added: [{ id, producer, environment, branch, sha, recordedAtMs, counts }], addedTotal }`: layers arrived |',
      '| `atlas:change` | `{ scope: "specs" \\| "runs", files, runIds }`: new specs or runs |',
      '| `run` | A LiveRun snapshot after start, progress, heartbeat, completion, or interruption; contains no producer credentials |',
      '| `projects` | `{}` when the node discovers another project; refresh `/api/projects` |',
      '| `ping` | `{}` every `heartbeatSeconds`, so a quiet server is told apart from a dead connection |',
      '',
      'Past `limits.maxStreams` viewers the answer is `503` with `Retry-After`: poll `/api/reports/evidence/effective` instead. A browser needs no code beyond `new EventSource("/api/events")`; other clients send the token as `Authorization: Bearer`.'
    ].join('\n'),
    responses: {
      '200': { description: 'The stream.', contentType: 'text/event-stream', schema: str },
      '401': UNAUTHORIZED,
      '503': problem('Too many viewers are connected; poll instead.')
    }
  },
  {
    route: 'GET /api/reports/evidence/effective', path: '/api/reports/evidence/effective', operationId: 'getReport', tag: 'Report', role: 'read',
    summary: 'The whole report, or only what changed since a version',
    description: [
      'The report as it stands: only the layers that win at least one check, each with only the rows that win. Whatever the history behind it, this is one request.',
      '',
      '`version` changes exactly when the report does, so it works as an ETag: send `If-None-Match` and get `304`. Better, send `?since=<version>` of the report you hold and get **only what changed** (`delta: true`): replace the layers of the same id, drop `removed`, keep the rest. If the server does not remember that version it answers with the whole report (no `delta` key), so a client always handles both.',
      '',
      'To combine layers yourself, a check\'s *slot* is `(producer, kind, specPath, check id, environment, parameters)`; the newest completed result wins it. See `docs/report-contract.md`.'
    ].join('\n'),
    parameters: [{ name: 'since', in: 'query', description: 'The `version` of the report you hold.', schema: str }, { name: 'if-none-match', in: 'header', description: 'The ETag (the quoted version) of the report you hold.', schema: str }],
    responses: {
      '200': { description: 'The whole report, or a delta when `since` was given and remembered.', contentType: 'application/json', schema: { oneOf: [ref('EffectiveEvidence'), ref('EffectiveDelta')] }, headers: { ETag: { description: 'The quoted `version`.', schema: str } } },
      '304': { description: 'You already hold this version.' },
      '401': UNAUTHORIZED,
      '503': NOT_READY
    }
  },
  {
    route: 'GET /api/status', path: '/api/status', operationId: 'getStatus', tag: 'Report', role: 'read',
    summary: 'The gate: does the report pass',
    description: [
      'The `atlas report status --format json` document, worked out by the server from the layers it holds and remembered for each version of the report. It passes (`ok: true`) only if some check completed, none failed, none is still running, every layer and backend could be read, and every required environment has results. **Unknown is never a pass.**',
      '',
      'The header `X-Atlas-Ok: true|false` carries the verdict, so a shell can test it without parsing. Narrow it by choice, per request: `branch` (repeatable) and `ignoreModified` read only matching layers.'
    ].join('\n'),
    parameters: [
      { name: 'branch', in: 'query', description: 'Only layers recorded on this branch. Repeatable.', schema: str },
      { name: 'ignoreModified', in: 'query', description: '`1`: leave out layers from modified checkouts and unknown origins.', schema: { type: 'string', enum: ['1'] } },
      { name: 'requireEnvironments', in: 'query', description: 'Comma-separated environments that must have results.', schema: str, example: 'desktop-web,ios' },
      { name: 'requireAllSpecs', in: 'query', description: '`1`: fail while any spec of the outline has no results.', schema: { type: 'string', enum: ['1'] } }
    ],
    responses: { '200': { ...json('The verdict, whether or not it passes.', 'ReportStatus'), headers: { 'X-Atlas-Ok': { description: '`true` or `false`.', schema: { type: 'string', enum: ['true', 'false'] } } } }, '401': UNAUTHORIZED, '503': NOT_READY }
  },
  {
    route: 'POST /api/checks', path: '/api/checks', operationId: 'postChecks', tag: 'Upload', role: 'publish',
    summary: 'Upload one layer of checks as JSON',
    description: [
      'The simplest way in: anything that can make an HTTP request can report. The body is the checks file (`packages/schema/schemas/publish-checks.schema.json`); `recordedAtMs` defaults to now. Binary evidence goes in as `base64`. The server writes the layer and it is in every viewer\'s report before this answers.',
      '',
      'Send the token as `Authorization: Bearer <token>` (a `publish` or `admin` token). A browser\'s sign-in box is refused for uploads on purpose. A check id appearing twice in one body is `422`.'
    ].join('\n'),
    body: { description: 'The checks of one producer.', contentType: 'application/json', schema: ref('PublishChecks'), required: true },
    responses: { '201': json('The layer was written.', 'ChecksResult'), '401': UNAUTHORIZED, '403': FORBIDDEN, '413': problem('The body is over `limits.maxJsonMiB`.'), '422': problem('The body is not valid: the detail says which field.') }
  },
  {
    route: 'GET /api/store', path: '/api/store', operationId: 'listStore', tag: 'Store protocol', role: 'read',
    summary: 'List keys under layers/',
    description: 'One page of the keys of `layers/…` (never anything else), in code-unit order. Page with `after` = the `next` of the previous page. This is the `listPage` of the `ObjectStore` interface; `atlas report merge` and `httpStore` use it.',
    parameters: [
      { name: 'prefix', in: 'query', description: 'Only keys starting with this. Default `layers/`.', schema: str },
      { name: 'after', in: 'query', description: 'Only keys after this one (exclusive).', schema: str },
      { name: 'limit', in: 'query', description: 'Page size, 1 to 1000. Default 1000.', schema: { type: 'integer', minimum: 1, maximum: 1000 } }
    ],
    responses: { '200': json('A page.', 'StoreListing'), '401': UNAUTHORIZED, '422': problem('The prefix is not one Atlas holds.') }
  },
  {
    route: 'GET /api/store/*', path: '/api/store/{key}', operationId: 'getObject', tag: 'Store protocol', role: 'read',
    summary: 'Read an object',
    description: 'The bytes of one object, with the content type it was stored with. Everything under `layers/` is immutable, so the answer is cacheable for good. The bytes came from a test run and are untrusted: they are served with `nosniff` and a sandboxing Content-Security-Policy, whatever type their uploader gave them.',
    parameters: [KEY],
    responses: { '200': { description: 'The object.', contentType: 'application/octet-stream', schema: { type: 'string', format: 'binary' } }, '401': UNAUTHORIZED, '404': problem('No such object.'), '422': problem('Not a key Atlas holds.') }
  },
  {
    route: 'HEAD /api/store/*', path: '/api/store/{key}', operationId: 'headObject', tag: 'Store protocol', role: 'read',
    summary: 'Does an object exist',
    description: '`200` when the object exists, `404` when not. No body.',
    parameters: [KEY],
    responses: { '200': { description: 'It exists.' }, '401': UNAUTHORIZED, '404': problem('No such object.') }
  },
  {
    route: 'PUT /api/store/*', path: '/api/store/{key}', operationId: 'putObject', tag: 'Store protocol', role: 'critic',
    summary: 'Upload an object',
    description: [
      'The write half of the `ObjectStore` interface. The server checks what it can from the bytes in hand and says no to what would corrupt the report for everyone:',
      '',
      '- a **layer manifest** (`layers/manifests/<id>.json`) must be a valid layer whose content hashes to `<id>`, and its blobs must already be there (`409` otherwise);',
      '- a **blob** (`layers/blobs/<sha256>.gz`) must be gzip of content whose SHA-256 is its name; a **spec file** likewise;',
      '- a **catalog entry** (`…/index/…`) must name something already uploaded (`409` otherwise): it is what makes a layer visible, so it is written last;',
      '- a **run manifest** must have passed its privacy scan;',
      '- keys are immutable: the same bytes again are `200` (a retry), other bytes under the same key are `409`.',
      '',
      'Upload in dependency order: blobs, then the manifest, then the catalog entry. `atlas report publish`, `atlas report stream` and `httpStore` do. Needs a `Bearer` token of role `publish` or `admin`; a browser\'s sign-in box is refused.',
      '',
      'A token of role `critic` may upload only what a critic publishes: blobs, and layers (and their catalog entries) whose `producer` is `critic.<name>` and whose parts are all of kind `critique`. Anything else is `403` with the rule it broke, and nothing is stored.'
    ].join('\n'),
    parameters: [KEY, { name: 'content-type', in: 'header', description: 'Stored with the object and returned when it is read.', schema: str }],
    body: { description: 'The object\'s bytes.', contentType: 'application/octet-stream', schema: { type: 'string', format: 'binary' }, required: true },
    responses: {
      '200': json('Already there with the same bytes.', 'StoreWriteResult'), '201': json('Stored.', 'StoreWriteResult'),
      '401': UNAUTHORIZED, '403': FORBIDDEN, '409': problem('A dependency has not been uploaded yet, or other bytes are already stored under this key.'),
      '413': problem('Over `limits.maxObjectMiB`.'), '422': problem('Not a key Atlas writes, or the content is not what its name says.')
    }
  },
  {
    route: 'DELETE /api/store/*', path: '/api/store/{key}', operationId: 'deleteObject', tag: 'Store protocol', role: 'publish',
    summary: 'Remove a scratch object',
    description: 'Only the scratch objects `atlas report doctor` writes (`layers/doctor-…`) can be removed. Layers, specs and runs are never removed through the API.',
    parameters: [KEY],
    responses: { '204': { description: 'Removed (or it was not there).' }, '401': UNAUTHORIZED, '403': problem('Not a scratch object, or the token may not.') }
  },
  {
    route: 'GET /api/reports/tests', path: '/api/reports/tests', operationId: 'getTests', tag: 'Report', role: 'read',
    summary: 'Every test, with insights, facets and history statistics',
    description: [
      'The report as a list of tests, for exploring it or for an agent to read in one request. A test is a check identity (its spec path and id) across producers and environments; `outcomes` holds its current result on each environment, and `stats` how it went over its recorded history (pass rate, flips, flaky, durations avg/p50/p95, runs, branches).',
      '',
      '`summary` and `facets` cover every test (counts by status, by environment, by producer and by domain, the slowest, flakiest and failing tests); `tests` is the page the query matched. Without a published spec set, specs come from the `specs[]` the layers recorded.',
      '',
      'Send `format=markdown` (or `Accept: text/markdown`) for the same as a Markdown report. The current status of a test is always the report\'s winner; history never changes it.'
    ].join('\n'),
    parameters: [
      { name: 'q', in: 'query', description: 'Words that must all appear in the title, id, spec, domain, tags, labels, environments or producers. Case does not matter.', schema: str, example: 'checkout card' },
      { name: 'status', in: 'query', description: 'Current status, or `flaky`. Repeatable or comma-separated.', schema: str, example: 'failed,flaky' },
      { name: 'environment', in: 'query', description: 'Only tests with a result on this environment. Repeatable or comma-separated.', schema: str, example: 'desktop-web' },
      { name: 'producer', in: 'query', description: 'Only tests from this producer. Repeatable or comma-separated.', schema: str },
      { name: 'domain', in: 'query', description: 'Only tests whose spec is in this domain (`(no spec)` for none). Repeatable or comma-separated.', schema: str },
      { name: 'spec', in: 'query', description: 'Only tests of this spec path. Repeatable or comma-separated.', schema: str, example: 'specs/checkout/pay.feature' },
      { name: 'tag', in: 'query', description: 'Only tests with this tag. Repeatable or comma-separated.', schema: str },
      { name: 'artifactTag', in: 'query', description: 'Only tests with an attachment tagged this (`demo` and `#demo` are the same tag), not counting tags inherited from a check or run: the exact artifact query. `inherited=1` widens it to the tags inherited from the check and run. Repeatable or comma-separated.', schema: str, example: 'demo' },
      { name: 'inherited', in: 'query', description: 'With `artifactTag`: `1` also matches the tags an attachment inherits from its check and run, so a recording without a tag of its own under a run tagged `demo` is found. Without it the query is exact.', schema: { type: 'string', enum: ['1', 'true'] } },
      { name: 'scope', in: 'query', description: 'Only tests with one playable recording that states every one of these producer-declared qualifications: `surface:<value>`, `device:<value>` (`device:physical` and `device:simulator` stay apart), `data:synthetic` or `data:real`, `dependencies:<value>`, `audio:recorded` or `audio:silent`, `pacing:<value>`. All must hold for the same recording. A recording that did not declare a value never matches it, and `unknown` matches only a recording that declared no scope. Repeatable or comma-separated.', schema: str, example: 'device:physical,audio:recorded' },
      { name: 'run', in: 'query', description: 'Only tests recorded in this run (a `key` from `/api/reports/runs`).', schema: str },
      { name: 'sort', in: 'query', description: 'The order: `spec` (default: domain, spec, title), `title`, `recent`, `slowest`, `failures`, `flaky` or `runs`.', schema: { type: 'string', enum: ['spec', 'title', 'recent', 'slowest', 'failures', 'flaky', 'runs'] } },
      { name: 'offset', in: 'query', description: 'Skip this many matching tests.', schema: { type: 'integer', minimum: 0 } },
      { name: 'limit', in: 'query', description: 'At most this many tests (default 500, at most 20000).', schema: { type: 'integer', minimum: 0, maximum: 20000 } },
      { name: 'format', in: 'query', description: '`markdown` for a Markdown report instead of JSON.', schema: { type: 'string', enum: ['json', 'markdown'] } }
    ],
    responses: { '200': { ...json('The catalog.', 'TestCatalog'), headers: { ETag: { description: 'Changes with the report, its history and the query.', schema: str } } }, '304': { description: 'Unchanged since the `If-None-Match` ETag.' }, '401': UNAUTHORIZED, '503': NOT_READY }
  },
  {
    route: 'GET /api/reports/tests/health', path: '/api/reports/tests/health', operationId: 'getCatalogHealth', tag: 'Report', role: 'read',
    summary: 'Why specs, domains and counts disagree',
    description: [
      'Diagnoses the report\'s metadata, so a domain filter or a coverage percentage can be trusted or fixed at its source. It reads; it never changes a status, a slot or a winner.',
      '',
      '`counts` keeps the denominators apart: spec files, defined specs, specs with an executed test (and those without: the defined coverage gaps), tests, outlines, examples and per-environment observations. `reconciliation` walks from the Specs count to the Tests count. `findings` name ambiguous and unmatched spec paths, identical or same-titled specs, a domain shared by nearly every spec, tests with no spec, checks that fall back to their title as identity and root mappings that matched nothing.',
      '',
      'Two paths are one logical spec only when a `root` mapping relates them (`from>to`: paths under `from` are the same specs as paths under `to`; an empty `from` matches every path). Without one, similar paths are reported as ambiguous and never merged. A check\'s label `outline` names the outline its example belongs to. Send `format=markdown` for Markdown.'
    ].join('\n'),
    parameters: [
      { name: 'root', in: 'query', description: 'A root mapping `from>to`, URL-encoded. Repeatable or comma-separated.', schema: str, example: '>specs/' },
      { name: 'format', in: 'query', description: '`markdown` for a Markdown report instead of JSON.', schema: { type: 'string', enum: ['json', 'markdown'] } }
    ],
    responses: { '200': { ...json('The diagnostics.', 'CatalogHealth'), headers: { ETag: { description: 'Changes with the report, its history and the mappings.', schema: str } } }, '304': { description: 'Unchanged since the `If-None-Match` ETag.' }, '401': UNAUTHORIZED, '503': NOT_READY }
  },
  {
    route: 'GET /api/reports/tests/history', path: '/api/reports/tests/history', operationId: 'getTestHistory', tag: 'Report', role: 'read',
    summary: 'One test and every result recorded for it',
    description: 'The test (as `/api/reports/tests` lists it) and up to 100 recorded results, newest first: status, duration, environment, producer, branch, commit, CI run, layer and the first 500 characters of the detail. Open a result\'s evidence (attachments, steps, retries) with `/api/reports/evidence/detail/{backend}/{id}?check=<id>`. Send `format=markdown` for Markdown.',
    parameters: [
      { name: 'key', in: 'query', required: true, description: 'The test\'s `key` from `/api/reports/tests`: `JSON.stringify([specPath, id])`, URL-encoded.', schema: str, example: '["specs/checkout/pay.feature","Pay with a card"]' },
      { name: 'format', in: 'query', description: '`markdown` for Markdown instead of JSON.', schema: { type: 'string', enum: ['json', 'markdown'] } }
    ],
    responses: { '200': json('The test and its history.', 'TestHistory'), '304': { description: 'Unchanged since the `If-None-Match` ETag.' }, '400': problem('No `key`.'), '401': UNAUTHORIZED, '404': problem('No test in the report has that key.'), '503': NOT_READY }
  },
  {
    route: 'GET /api/reports/tests/reliability', path: '/api/reports/tests/reliability', operationId: 'getTestReliability', tag: 'Report', role: 'read',
    summary: 'How reliable one test is in a scope, and how that was counted',
    description: [
      'A success rate for one test that says what it counted. The snapshots one run recorded for one producer, environment and parameter set (running, finished, enriched) are one independent execution; its last word counts once with the tries it recorded. `eventual` is the share of executions that passed in the end, `firstAttempt` the share whose first try passed (over executions that recorded their tries; the rest are `unrecordedAttempts`, never assumed to have passed first time).',
      '',
      'Choose the scope with `environment`, `producer`, `parameter` (`key=value`), `branch`, `sha`, `specRevision`, `since` and `until`; executions elsewhere never count. By default only the newest recorded spec revision counts and earlier ones appear under `historical`; send `revision=any` to pool them. Only `passed` and `failed` executions are trials: `not-run` and unfinished ones are listed under `excluded` and never counted as a pass. `sample` is `none`, `insufficient` (fewer than `minimumExecutions`) or `sufficient`, a count only: `notes` say when environments, producers or branches are pooled, failed cases were published again, or history is bounded to the newest 100 results. `executions` is the denominator, open to inspection. The interval states its assumptions. This is not a production failure probability. Send `format=markdown` for Markdown.'
    ].join('\n'),
    parameters: [
      { name: 'key', in: 'query', required: true, description: 'The test\'s `key` from `/api/reports/tests`.', schema: str, example: '["specs/checkout/pay.feature","Pay with a card"]' },
      { name: 'environment', in: 'query', description: 'Environments or devices to count. Comma-separated.', schema: str, example: 'phone' },
      { name: 'producer', in: 'query', description: 'Producers to count. Comma-separated.', schema: str },
      { name: 'parameter', in: 'query', description: 'Parameter choices `key=value`; all must match. Comma-separated.', schema: str, example: 'device=small' },
      { name: 'branch', in: 'query', description: 'Branches to count. Comma-separated.', schema: str },
      { name: 'sha', in: 'query', description: 'Commits: a full id or a prefix of at least seven characters. Comma-separated.', schema: str },
      { name: 'specRevision', in: 'query', description: 'Only executions recorded against these spec fingerprints (overrides `revision`). Comma-separated.', schema: str },
      { name: 'revision', in: 'query', description: '`any` pools every spec revision; otherwise only the newest recorded one counts.', schema: { type: 'string', enum: ['current', 'any'] } },
      { name: 'since', in: 'query', description: 'Only executions at or after this time: epoch milliseconds or a date.', schema: str, example: '2026-01-01' },
      { name: 'until', in: 'query', description: 'Only executions at or before this time: epoch milliseconds or a date.', schema: str },
      { name: 'format', in: 'query', description: '`markdown` for Markdown instead of JSON.', schema: { type: 'string', enum: ['json', 'markdown'] } }
    ],
    responses: { '200': json('The reliability of the test in the scope.', 'TestReliability'), '304': { description: 'Unchanged since the `If-None-Match` ETag.' }, '400': problem('No `key`.'), '401': UNAUTHORIZED, '404': problem('No test in the report has that key.'), '503': NOT_READY }
  },
  {
    route: 'GET /api/reports/artifact-tags', path: '/api/reports/artifact-tags', operationId: 'getArtifactTags', tag: 'Report', role: 'read',
    summary: 'Reviewer tags of attachments: every recorded edit',
    description: 'The audit trail of tags that reviewers added to and removed from attachments after upload, oldest first. Each entry says which attachment (`target`), which normalized tags were added and removed, the name of the token that made the edit (`by`, never the token) and when (`atMs`). The layers themselves are never rewritten, so a producer\'s own `tags` on an attachment stay as uploaded; fold the entries (oldest first, the last edit of a tag wins) to get the reviewer tags that stand now. Tags are normalized: `#Demo` and `demo` are `demo`.',
    responses: { '200': json('The edits.', 'ArtifactTags'), '401': UNAUTHORIZED }
  },
  {
    route: 'POST /api/reports/artifact-tags', path: '/api/reports/artifact-tags', operationId: 'editArtifactTags', tag: 'Report', role: 'publish',
    summary: 'Tag or untag one attachment after upload',
    description: 'Records one edit of the reviewer tags of one attachment, by the name of the publish (or admin) token that sends it. It adds an immutable entry to the audit trail and changes nothing else: not the layer, not the movie, not any result. The tags it removes are reviewer tags only; a producer\'s tags are part of the layer and stay. A reader-only token, a browser sign-in box and an anonymous reader are refused. Name the attachment as `artifactRef` does (`id:<id>`, else `key:<bundleKey>`, else `name:<name>`).',
    body: { description: 'The attachment and the tags to add and remove. At most 20 of each, 64 KiB.', contentType: 'application/json', required: true, schema: ref('ArtifactTagEdit') },
    responses: { '201': json('The recorded entry.', 'ArtifactTagEntry'), '401': UNAUTHORIZED, '403': FORBIDDEN, '413': problem('Request too large.'), '422': problem('Not a tag edit: a bad target, an empty or over-long tag, or nothing to change.') }
  },
  {
    route: 'GET /api/reports/review-collections', path: '/api/reports/review-collections', operationId: 'listReviewCollections', tag: 'Report', role: 'read',
    summary: 'Review collections: curated sets of recordings, newest first',
    description: 'The newest revision of every review collection, in brief: id, revision and how many exist, title, purpose, audience, tags, how many entries and gaps it has, who published it and when. A collection is curation kept beside the report; it is not a layer, a check or a run, and it has no status. Open one with `/api/reports/review-collections/detail?id=`. Its share URL is the viewer\'s `?tab=collections&collection=<id>` and needs the same read access as the rest of the report.',
    responses: { '200': json('The collections.', 'ReviewCollectionList'), '401': UNAUTHORIZED }
  },
  {
    route: 'POST /api/reports/review-collections', path: '/api/reports/review-collections', operationId: 'publishReviewCollection', tag: 'Report', role: 'publish',
    summary: 'Publish an immutable review collection (or a new revision of one)',
    description: [
      'Freezes an ordered set of references to recorded results as one named collection, recorded under the name of the publish (or admin) token that sends it. Take each entry\'s `layer` and `check` (and `kind`) from `GET /api/reports/artifacts`, and optionally one of its recordings (`videos[].recording`). The server resolves every entry to the result the report holds and records what the report says about it (status, time, run, commit, environment, tries, videos): the request does not claim them. An entry it cannot resolve refuses the whole request (`422`, naming the entry). The order is yours and is never re-sorted; failed, rejected and incomplete results stay in it beside a later passing replay.',
      '',
      'Entries from different runs are never one execution: each keeps its own layer, run and status. A collection has no status of its own, adds no check and cannot change any result or winner. A revision is immutable. To change a collection, publish a new revision with `basedOn: { id, revision }` naming the newest revision (`409` otherwise); the earlier ones stay readable. Notes and reviewed marks are separate (`/reviews`). A reader-only token, a browser sign-in box and an anonymous reader are refused; nothing is shared publicly by default.'
    ].join('\n'),
    body: { description: 'The title, optional purpose, audience and tags, the ordered entries, optional gaps, and `basedOn` for a new revision. At most 500 entries and 100 gaps.', contentType: 'application/json', required: true, schema: ref('ReviewCollectionRequest') },
    responses: { '201': json('The recorded revision.', 'ReviewCollection'), '401': UNAUTHORIZED, '403': FORBIDDEN, '404': problem('`basedOn` names no collection.'), '409': problem('`basedOn.revision` is not the newest.'), '413': problem('Request too large.'), '422': problem('Not a collection, or an entry the report does not hold.'), '503': NOT_READY }
  },
  {
    route: 'GET /api/reports/review-collections/detail', path: '/api/reports/review-collections/detail', operationId: 'getReviewCollection', tag: 'Report', role: 'read',
    summary: 'One review collection revision with how its sources stand now',
    description: 'The revision (the newest without `revision`), every revision number, the review notes and reviewed marks of that revision, and for each entry `availability`: `available` (its layer is held and the report lists the result), `unverified` (the layer is held but the report no longer lists the result or recording) or `unavailable` (the layer is gone, for example deleted by garbage collection), with the reason. An entry whose source is not available stays in its place with its frozen snapshot; it is never removed or replaced. Entries keep the status each layer recorded, with their own times, in the order the curator chose. A reviewed mark is curation: it changes no outcome and is not an approval.',
    parameters: [
      { name: 'id', in: 'query', required: true, description: 'A collection id from the list.', schema: str, example: 'rc-0123456789abcdef' },
      { name: 'revision', in: 'query', description: 'A revision number. Default: the newest.', schema: { type: 'integer', minimum: 1 } }
    ],
    responses: { '200': json('The revision.', 'ReviewCollectionDetail'), '400': problem('No `id`, or a bad `revision`.'), '401': UNAUTHORIZED, '404': problem('No such collection or revision.') }
  },
  {
    route: 'POST /api/reports/review-collections/reviews', path: '/api/reports/review-collections/reviews', operationId: 'addReviewNote', tag: 'Report', role: 'publish',
    summary: 'Add a note, a time-coded gap note or a reviewed mark to a collection entry',
    description: 'Records one immutable entry, by the name of the publish (or admin) token and the server\'s time: a `note` or a `gap` (text required; with `entry` and optionally `timecodeMs`, a moment in that entry\'s recording), or a `reviewed` / `unreviewed` mark for one entry. It changes no check outcome, no layer, no collection revision and no report winner; a mark is not an acceptance sign-off. The notes of a revision are in its `detail`.',
    body: { description: 'The collection and revision, optionally the entry, the kind and its text.', contentType: 'application/json', required: true, schema: ref('ReviewNoteInput') },
    responses: { '201': json('The recorded note.', 'ReviewNote'), '401': UNAUTHORIZED, '403': FORBIDDEN, '404': problem('No such collection or revision.'), '413': problem('Request too large.'), '422': problem('Not a note: missing text, an unknown entry, or a mark without an entry.') }
  },
  {
    route: 'GET /api/reports/review-collections/export', path: '/api/reports/review-collections/export', operationId: 'exportReviewCollection', tag: 'Report', role: 'read',
    summary: 'Portable index (manifest) of one review collection revision',
    description: 'A manifest an archive can be built from: the collection, each entry with its exact source (layer, check, kind, recording), the status and run it was recorded with, how it stands now, whether it is marked reviewed, and the files it references with their name as recorded, a safe name and path (`files/<position>-<safeName>`), and the recorded `sha256` when the report holds one (`null` is unknown, not verified). A source that cannot be read now is listed under `missing` and its files are marked `missing`; nothing is left out silently. The manifest contains no bytes; recordings are fetched from the attachment routes, which keep their own access control. Sent as an attachment.',
    parameters: [
      { name: 'id', in: 'query', required: true, description: 'A collection id.', schema: str },
      { name: 'revision', in: 'query', description: 'A revision number. Default: the newest.', schema: { type: 'integer', minimum: 1 } }
    ],
    responses: { '200': json('The manifest.', 'ReviewManifest'), '400': problem('No `id`, or a bad `revision`.'), '401': UNAUTHORIZED, '404': problem('No such collection or revision.') }
  },
  {
    route: 'GET /api/reports/runs', path: '/api/reports/runs', operationId: 'getReportRuns', tag: 'Report', role: 'read',
    summary: 'The runs that recorded the report',
    description: 'Every run, newest first: layers grouped by their CI run URL (else branch and commit), with their environments, producers, how many tests they recorded, their results by status, the time they spanned, up to twenty failures, their video counts (references, distinct playable recordings, unavailable) and the artifact tags, media types and labels their results carry. Filters narrow the list before `limit`: AND across the parameters, OR within one; `filters` in the answer names those that were applied and `facets` offers each dimension\'s values with counts. A server that does not know a filter ignores it and does not name it in `filters`. Send `format=markdown` for Markdown.',
    parameters: [
      { name: 'limit', in: 'query', description: 'At most this many runs (default 100).', schema: { type: 'integer', minimum: 0 } },
      { name: 'video', in: 'query', description: '`true` to list only runs that have a playable video recording. Applied to every run before `limit`; `total` counts the matches. A server that does not know it answers with every run.', schema: { type: 'boolean' } },
      { name: 'artifactTag', in: 'query', description: 'Artifact tags (`demo` and `#demo` are the same), repeatable or comma-separated. A comma or backslash inside a value is written `\\,` or `\\\\`. OR within the parameter, AND with the other filters.', schema: str },
      { name: 'inherited', in: 'query', description: '`1` with `artifactTag` to also match the tags attachments inherit from their check and run. Default: the exact artifact query.', schema: { type: 'boolean' } },
      { name: 'type', in: 'query', description: 'Media types as roles (`video`, `image`, `audio`, `snapshot`, `text`, `file`, or a producer\'s own). `video` means a playable recording. With `artifactTag`, one artifact must be both where the report says which videos carry which tags.', schema: str },
      { name: 'label', in: 'query', description: '`key=value`, or `key` for any value.', schema: str },
      { name: 'environment', in: 'query', description: 'Environments or devices (`ios`, `desktop-web`).', schema: str },
      { name: 'producer', in: 'query', description: 'Producers.', schema: str },
      { name: 'branch', in: 'query', description: 'Branches.', schema: str },
      { name: 'sha', in: 'query', description: 'Revisions: a full commit id or a prefix of at least seven characters.', schema: str },
      { name: 'outcome', in: 'query', description: 'Statuses: `passed`, `failed`, `running`, `not-run`. A run\'s outcome is `failed` when any result failed, else `running`, else `passed`, else `not-run`.', schema: str },
      { name: 'recordings', in: 'query', description: 'Recording completeness of the run, apart from its outcome: `complete`, `incomplete`, `none-expected` or `unknown` (a run whose layers declared no recording expectations is `unknown`, never `complete`). Repeatable or comma-separated. Answered from the layers\' receipts; no recording is read. A server that does not know it ignores it and does not name it in `filters`.', schema: str },
      { name: 'q', in: 'query', description: 'Words that must all appear in the title, id, spec, branch, producer, environment, tags or labels.', schema: str },
      { name: 'since', in: 'query', description: 'Only records at or after this time: epoch milliseconds or an ISO date (a date alone is UTC). A result\'s recording time; a run\'s end.', schema: str },
      { name: 'until', in: 'query', description: 'Only records at or before this time (same forms as `since`).', schema: str },
      { name: 'format', in: 'query', description: '`markdown` for Markdown instead of JSON.', schema: { type: 'string', enum: ['json', 'markdown'] } }
    ],
    responses: { '200': json('The runs.', 'RunList'), '304': { description: 'Unchanged since the `If-None-Match` ETag.' }, '401': UNAUTHORIZED, '503': NOT_READY }
  },
  {
    route: 'GET /api/reports/artifacts', path: '/api/reports/artifacts', operationId: 'getReportArtifacts', tag: 'Report', role: 'read',
    summary: 'Recorded results that carry evidence, across the whole history',
    description: 'Every recorded result that has attachments (recordings, screenshots, traces), newest first, found in the history and not only among the current winners: a recording tagged `demo` is found with its original run, revision and status even when a later attempt is untagged. Narrow it by artifact tag, media type, label, feature (`domain`, `spec`), environment or device, producer, branch, revision, outcome and time: AND across the parameters, OR within one; with both `artifactTag` and `type`, one artifact must be both. `filters` names the filters that were applied and `facets` offers each dimension\'s values with counts: the count beside a value is what the list would hold if that value alone were chosen in its dimension, every other filter applied. Tags written by reviewers after upload are not searched; only those in the layer are. Send `format=markdown` for Markdown.',
    parameters: [
      { name: 'limit', in: 'query', description: 'At most this many results (default 100).', schema: { type: 'integer', minimum: 0 } },
      { name: 'offset', in: 'query', description: 'Skip this many matches (default 0).', schema: { type: 'integer', minimum: 0 } },
      { name: 'video', in: 'query', description: '`true` for results with a playable video recording (the same as `type=video`).', schema: { type: 'boolean' } },
      { name: 'domain', in: 'query', description: 'The feature domain of the result\'s spec.', schema: str },
      { name: 'spec', in: 'query', description: 'Spec paths.', schema: str },
      { name: 'artifactTag', in: 'query', description: 'Artifact tags (`demo` and `#demo` are the same), repeatable or comma-separated. A comma or backslash inside a value is written `\\,` or `\\\\`. OR within the parameter, AND with the other filters.', schema: str },
      { name: 'inherited', in: 'query', description: '`1` with `artifactTag` to also match the tags attachments inherit from their check and run. Default: the exact artifact query.', schema: { type: 'boolean' } },
      { name: 'type', in: 'query', description: 'Media types as roles (`video`, `image`, `audio`, `snapshot`, `text`, `file`, or a producer\'s own). `video` means a playable recording. With `artifactTag`, one artifact must be both where the report says which videos carry which tags.', schema: str },
      { name: 'label', in: 'query', description: '`key=value`, or `key` for any value.', schema: str },
      { name: 'environment', in: 'query', description: 'Environments or devices (`ios`, `desktop-web`).', schema: str },
      { name: 'producer', in: 'query', description: 'Producers.', schema: str },
      { name: 'branch', in: 'query', description: 'Branches.', schema: str },
      { name: 'sha', in: 'query', description: 'Revisions: a full commit id or a prefix of at least seven characters.', schema: str },
      { name: 'outcome', in: 'query', description: 'Statuses: `passed`, `failed`, `running`, `not-run`. A run\'s outcome is `failed` when any result failed, else `running`, else `passed`, else `not-run`.', schema: str },
      { name: 'q', in: 'query', description: 'Words that must all appear in the title, id, spec, branch, producer, environment, tags or labels.', schema: str },
      { name: 'since', in: 'query', description: 'Only records at or after this time: epoch milliseconds or an ISO date (a date alone is UTC). A result\'s recording time; a run\'s end.', schema: str },
      { name: 'until', in: 'query', description: 'Only records at or before this time (same forms as `since`).', schema: str },
      { name: 'format', in: 'query', description: '`markdown` for Markdown instead of JSON.', schema: { type: 'string', enum: ['json', 'markdown'] } }
    ],
    responses: { '200': json('The matching results and the facets.', 'ArtifactList'), '304': { description: 'Unchanged since the `If-None-Match` ETag.' }, '401': UNAUTHORIZED, '503': NOT_READY }
  },
  {
    route: 'GET /api/reports/ui-catalog', path: '/api/reports/ui-catalog', operationId: 'getUiCatalog', tag: 'Report', role: 'read',
    summary: 'The UI catalog: captured UI states per profile, and what is still expected',
    description: 'A browsable inventory of the product\'s user interface, computed from the winning results of the `ui-state` and `ui-plan` parts of every layer (see the UI catalog guide). Each state is a check id; each cell is one profile of it (the layer\'s environment and parameters) with its coverage: `captured` only when the winning capture passed, `failed`, `capturing`, `skipped`, or `missing` when a plan expects it and nothing has been captured. A picture is read from the cell\'s `capture.image.path` under the reports API root, or `uri`. What is expected is itself a layer, so a shard that never published leaves its states `missing`, never captured. The document equals what the viewer computes from the same report. Narrow it by `q` (words), `coverage`, `profile` (a profile `key`), `area`, `route`, `cohort`, `flag`, `surface` and `producer`: AND across parameters, OR within one; a state keeps only the cells that match `profile` and `coverage`. Page the states with `limit` and `offset`. Viewers need not poll: they hold the report over `/api/events` and read changes with `/api/reports/evidence/effective?since=`.',
    parameters: [
      { name: 'limit', in: 'query', description: 'At most this many states (default 200).', schema: { type: 'integer', minimum: 0 } },
      { name: 'offset', in: 'query', description: 'Skip this many states (default 0).', schema: { type: 'integer', minimum: 0 } },
      { name: 'q', in: 'query', description: 'Words that must all appear in a state\'s id, title, route, fixture, cohort, area, flags, surfaces or producers.', schema: str },
      { name: 'coverage', in: 'query', description: 'Coverage values: `captured`, `failed`, `capturing`, `skipped`, `missing`. Comma-separated.', schema: str },
      { name: 'profile', in: 'query', description: 'Profile keys, as listed in `profiles[].key`.', schema: str },
      { name: 'area', in: 'query', description: 'Areas.', schema: str },
      { name: 'route', in: 'query', description: 'Routes.', schema: str },
      { name: 'cohort', in: 'query', description: 'Cohorts.', schema: str },
      { name: 'flag', in: 'query', description: 'Feature flags a state was captured with.', schema: str },
      { name: 'surface', in: 'query', description: 'Surfaces a state covers.', schema: str },
      { name: 'producer', in: 'query', description: 'Producers that captured or planned a state.', schema: str },
      { name: 'format', in: 'query', description: '`markdown` for Markdown instead of JSON.', schema: { type: 'string', enum: ['json', 'markdown'] } }
    ],
    responses: { '200': json('The catalog.', 'UiCatalog'), '304': { description: 'Unchanged since the `If-None-Match` ETag.' }, '401': UNAUTHORIZED, '503': NOT_READY }
  },
  {
    route: 'GET /api/reports/runs/detail', path: '/api/reports/runs/detail', operationId: 'getReportRun', tag: 'Report', role: 'read',
    summary: 'Every test one run recorded',
    description: 'One run and its last result for every test, environment and producer it recorded, failures first, and `layers`: each layer of the run with its backend, how many checks it recorded (zero means evidence only, never a pass) and how many files it carries as a whole. Open a layer\'s files with `/api/reports/evidence/detail/{backend}/{id}`. Send `format=markdown` for Markdown.',
    parameters: [
      { name: 'key', in: 'query', required: true, description: 'The run\'s `key` from `/api/reports/runs`, URL-encoded.', schema: str },
      { name: 'format', in: 'query', description: '`markdown` for Markdown instead of JSON.', schema: { type: 'string', enum: ['json', 'markdown'] } }
    ],
    responses: { '200': json('The run and its results.', 'RunDetail'), '304': { description: 'Unchanged since the `If-None-Match` ETag.' }, '400': problem('No `key`.'), '401': UNAUTHORIZED, '404': problem('No run has that key.'), '503': NOT_READY }
  },
  {
    route: 'GET /api/reports/outline', path: '/api/reports/outline', operationId: 'getOutline', tag: 'Report', role: 'read',
    summary: 'The specs a report is laid over',
    description: 'The specs of the newest committed spec set (of `main`, else the newest), so the report needs no checkout. Without a spec set, the specs the layers recorded (`specs[]`), newest per path. A spec here with no result shows as having none.',
    responses: { '200': json('The outline.', 'Outline'), '401': UNAUTHORIZED }
  },
  {
    route: 'GET /api/reports/outline/spec', path: '/api/reports/outline/spec', operationId: 'getOutlineSpec', tag: 'Report', role: 'read',
    summary: 'The text of one spec',
    description: 'The text of a spec file of the outline, by its path.',
    parameters: [{ name: 'path', in: 'query', required: true, description: 'The spec\'s path, `specs/<path>`.', schema: str }],
    responses: { '200': { description: 'The spec text.', contentType: 'text/plain', schema: str }, '401': UNAUTHORIZED, '404': problem('No such spec in the outline.') }
  },
  {
    route: 'GET /api/reports/evidence', path: '/api/reports/evidence', operationId: 'listLayers', tag: 'Report', role: 'read',
    summary: 'Page through every layer header',
    description: 'The history: layer headers newest first, merged from every backend. Prefer `/api/reports/evidence/effective`, which is one request and holds only what wins. Use this to audit what was recorded.',
    parameters: [{ name: 'cursor', in: 'query', description: 'The `cursor` of the previous page.', schema: str }],
    responses: { '200': json('A page of headers.', 'EvidencePage'), '401': UNAUTHORIZED, '503': NOT_READY }
  },
  {
    route: 'GET /api/reports/evidence/rows/:backend/:id', path: '/api/reports/evidence/rows/{backend}/{id}', operationId: 'getLayerRows', tag: 'Report', role: 'read',
    summary: 'The checks of one layer',
    description: 'Every check of one layer (not only those that win), with the spec fingerprints it recorded.',
    parameters: [BACKEND, LAYER_ID],
    responses: { '200': json('The rows.', 'LayerRows'), '401': UNAUTHORIZED, '404': problem('No such layer in that backend.') }
  },
  {
    route: 'GET /api/reports/evidence/detail/:backend/:id', path: '/api/reports/evidence/detail/{backend}/{id}', operationId: 'getCheckDetail', tag: 'Report', role: 'read',
    summary: 'Everything one result carries',
    description: 'The timeline, annotations, retries, attachments and extensions of one check, and what its run carries as a whole. Without `check`, only the run\'s, and `parts`: what each part of the layer that carries files or links of its own holds. Attachment bytes are fetched from `/api/reports/layers/{id}/blobs/{bundleKey}`.',
    parameters: [BACKEND, LAYER_ID, { name: 'check', in: 'query', description: 'The check id.', schema: str }, { name: 'kind', in: 'query', description: 'The kind of the part, when the same id is in several.', schema: str }],
    responses: { '200': json('The detail.', 'CheckDetail'), '401': UNAUTHORIZED, '404': problem('No such layer or check.') }
  },
  {
    route: 'GET /api/reports/layers/:id/blobs/*', path: '/api/reports/layers/{id}/blobs/{bundleKey}', operationId: 'getAttachment', tag: 'Report', role: 'read',
    summary: 'A file a layer carries',
    description: 'A screenshot, video, trace, log or any attachment of a layer, by the `bundleKey` its attachment names (`attachments/<sha256>`). Served as untrusted bytes: never sniffed, never run, sandboxed; immutable, cacheable for good; videos can be sought with `Range`.',
    parameters: [LAYER_ID, { name: 'bundleKey', in: 'path', required: true, description: 'The attachment\'s `bundleKey`, which contains a slash.', schema: str }, { name: 'range', in: 'header', description: 'A byte range, `bytes=0-1023`.', schema: str }],
    responses: { '200': { description: 'The bytes, with the type the producer gave (or `application/octet-stream`).', contentType: 'application/octet-stream', schema: { type: 'string', format: 'binary' } }, '206': { description: 'The requested range.' }, '304': { description: 'Not modified.' }, '401': UNAUTHORIZED, '404': problem('No such layer or file.') }
  },
  {
    route: 'GET /api/reports/layers/:id/*', path: '/api/reports/layers/{id}/{path}', operationId: 'getRecordedFile', tag: 'Report', role: 'read',
    summary: 'A recorded test of a statechart run',
    description: 'The `report.json`, captured files and frame stylesheet of a recorded statechart test of a layer (`tests/<testId>/report.json`, `tests/<testId>/files/…`, `frame.css`). Untrusted bytes, served like attachments.',
    parameters: [LAYER_ID, { name: 'path', in: 'path', required: true, description: 'The path under the layer.', schema: str }],
    responses: { '200': { description: 'The file.', contentType: 'application/octet-stream', schema: { type: 'string', format: 'binary' } }, '401': UNAUTHORIZED, '404': problem('No such file.') }
  },
  {
    route: 'GET /api/reports/live/:source/frame.css', path: '/api/reports/live/{source}/frame.css', operationId: 'getLiveFrameCss', tag: 'Report', role: 'read',
    summary: 'Frame stylesheet of a live spec run (development only)',
    description: 'For spec runs writing on the same machine as a development host (`atlas-visualizer dev`). A server has none: it answers `404`.',
    parameters: [{ name: 'source', in: 'path', required: true, description: 'The live source id.', schema: str }],
    responses: { '200': { description: 'The stylesheet.', contentType: 'text/css', schema: str }, '404': problem('Not a live source.') }
  },
  {
    route: 'GET /api/reports/live/:source/tests/:testId/*', path: '/api/reports/live/{source}/tests/{testId}/{path}', operationId: 'getLiveTestFile', tag: 'Report', role: 'read',
    summary: 'A file of a test in a live spec run (development only)',
    description: 'For spec runs writing on the same machine as a development host. A server has none: it answers `404`.',
    parameters: [{ name: 'source', in: 'path', required: true, description: 'The live source id.', schema: str }, { name: 'testId', in: 'path', required: true, description: 'The test id.', schema: str }, { name: 'path', in: 'path', required: true, description: 'The path under the test.', schema: str }],
    responses: { '200': { description: 'The file.', contentType: 'application/octet-stream', schema: { type: 'string', format: 'binary' } }, '404': problem('Not a live source.') }
  },
  {
    route: 'GET /api/data/sources.json', path: '/api/data/sources.json', operationId: 'getSources', tag: 'Viewer data', role: 'read',
    summary: 'The sources the viewer reads',
    description: 'The viewer\'s address book of data sources, in the shape a static host serves. A server has one source, itself.',
    responses: { '200': json('The sources file.', 'ReportSources'), '401': UNAUTHORIZED }
  },
  {
    route: 'GET /api/data/specs/index.json', path: '/api/data/specs/index.json', operationId: 'getSpecIndex', tag: 'Viewer data', role: 'read',
    summary: 'The spec files',
    description: 'The files of the newest committed spec set, relative to `specs/`.',
    responses: { '200': json('The index.', 'SpecIndex'), '401': UNAUTHORIZED }
  },
  {
    route: 'GET /api/data/specs/*', path: '/api/data/specs/{file}', operationId: 'getSpecFile', tag: 'Viewer data', role: 'read',
    summary: 'One spec file',
    description: 'The text of a spec file, with the digest of its content as `ETag`.',
    parameters: [{ name: 'file', in: 'path', required: true, description: 'The file\'s path relative to `specs/`.', schema: str }],
    responses: { '200': { description: 'The text.', contentType: 'text/plain', schema: str }, '304': { description: 'Not modified.' }, '401': UNAUTHORIZED, '404': problem('No such spec.') }
  },
  {
    route: 'GET /api/data/runs/index.json', path: '/api/data/runs/index.json', operationId: 'getRunsIndex', tag: 'Viewer data', role: 'read',
    summary: 'The statechart runs',
    description: 'The newest uploaded statechart runs (`atlas report publish --manifest … --upload-run`), newest first.',
    responses: { '200': json('The index.', 'RunsIndex'), '401': UNAUTHORIZED }
  },
  {
    route: 'GET /api/data/runs/:id/*', path: '/api/data/runs/{id}/{path}', operationId: 'getRunFile', tag: 'Viewer data', role: 'read',
    summary: 'A file of an uploaded run',
    description: 'A file of an uploaded run: its manifest, timelines, screenshots, clips. Untrusted bytes, served sandboxed; immutable.',
    parameters: [{ name: 'id', in: 'path', required: true, description: 'The run id.', schema: str }, { name: 'path', in: 'path', required: true, description: 'The path inside the run.', schema: str }],
    responses: { '200': { description: 'The file.', contentType: 'application/octet-stream', schema: { type: 'string', format: 'binary' } }, '401': UNAUTHORIZED, '404': problem('No such run or file.') }
  }
];

const NODE_OPERATIONS = new Set(['/api/projects', '/api/settings', '/api/settings/gc', '/api/settings/gc/run', '/api/server', '/api/openapi.json']);
const PROJECT_PARAMETER: Param = { name: 'project', in: 'query', description: 'Project slug. Alternatively send X-Atlas-Project or use the project-prefixed route. Omit for the default project. Conflicting selectors are refused.', schema: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$', maxLength: 64 }, example: 'todo-app' };
/** Every node operation and the same stable report protocol inside each project namespace. */
export const OPERATIONS: readonly Operation[] = BASE_OPERATIONS.flatMap(operation => {
  if (!operation.path.startsWith('/api/') || NODE_OPERATIONS.has(operation.path)) return [operation];
  return [{ ...operation, parameters: [...(operation.parameters ?? []), PROJECT_PARAMETER] }, {
    ...operation, route: operation.route.replace('/api/', '/api/projects/:project/'), path: operation.path.replace('/api/', '/api/projects/{project}/'),
    operationId: `${operation.operationId}ForProject`, parameters: [{ ...PROJECT_PARAMETER, in: 'path', required: true }, ...(operation.parameters ?? [])],
    description: `${operation.description}\n\nScoped to one project. The same project may be selected on the unprefixed API using ?project= or X-Atlas-Project. Unknown projects return 404 on reads and are created by an authenticated upload.`
  }];
});

/**
 * Routes the server registers that are not operations of this API, each with the reason. The coverage test skips
 * these and only these.
 */
export const NOT_OPERATIONS: ReadonlyMap<string, string> = new Map([
  ['ALL /*', 'Middleware: authentication and request logging for every route.'],
  ['POST /api/*', 'Every other path under /api answers 405 to a write, never the page.'],
  ['PUT /api/*', 'Every other path under /api answers 405 to a write, never the page.'],
  ['PATCH /api/*', 'Every other path under /api answers 405 to a write, never the page.'],
  ['DELETE /api/*', 'Every other path under /api answers 405 to a write, never the page.'],
  ['GET /*', 'The viewer (a single-page app); an unknown /api path is a 404 problem document, never the page.']
]);

const SECURITY: Record<Role, readonly Record<string, string[]>[]> = {
  none: [],
  read: [{ bearer: [] }, { basic: [] }],
  critic: [{ bearer: [] }],
  publish: [{ bearer: [] }],
  admin: [{ bearer: [] }]
};

/** The OpenAPI 3.1 document of the API. `serverUrl` (such as `https://atlas.example.com`) is written into `servers` when given. */
export function openApiDocument(options: { readonly serverUrl?: string } = {}): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const method = op.route.split(' ')[0]!.toLowerCase();
    (paths[op.path] ??= {})[method] = {
      operationId: op.operationId,
      tags: [op.tag],
      summary: op.summary,
      description: `${op.description}${op.role === 'none' ? '' : `\n\nRole needed: \`${op.role}\`.`}`,
      'x-atlas-role': op.role,
      security: SECURITY[op.role],
      ...(op.parameters?.length ? { parameters: op.parameters.map(({ schema, ...rest }) => ({ required: rest.in === 'path' ? true : false, ...rest, schema: schema ?? str })) } : {}),
      ...(op.body ? { requestBody: { required: op.body.required ?? false, description: op.body.description, content: { [op.body.contentType]: { schema: op.body.schema } } } } : {}),
      responses: Object.fromEntries(Object.entries(op.responses).map(([status, response]) => [status, {
        description: response.description,
        ...(response.headers ? { headers: Object.fromEntries(Object.entries(response.headers).map(([name, header]) => [name, header])) } : {}),
        ...(response.contentType ? { content: { [response.contentType]: { schema: response.schema ?? {} } } } : {})
      }]))
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Atlas server API',
      version: API_VERSION,
      summary: 'Take in test results from every environment, keep them, and show everyone the combined report, live.',
      description: [
        'One Atlas node serves multiple projects. Clients select a project using ?project=<slug>, X-Atlas-Project, or /api/projects/<slug>/… . Each project has independent specs, layers, recordings, status, and event streams. Within each project, the newest completed result of every check wins its slot. Unqualified requests address the legacy default project.',
        '',
        '**Authentication.** With tokens configured, send `Authorization: Bearer <token>`. Roles: `read` < `critic` < `publish` < `admin`. A `critic` token may read, and publish critiques (layers of automated reviewers) and nothing else. Uploading needs a Bearer token; a browser\'s HTTP Basic sign-in (any user name, the token as the password) is accepted for reading only. A server with no tokens is open and listens on this machine only unless told otherwise.',
        '',
        '**Errors** are [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem documents (`application/problem+json`) with a `detail` that says what to do. `401` send a token, `403` that token may not, `409` upload what this depends on first or you are changing something immutable, `413` too large, `422` not valid, `503` still starting (retry after `Retry-After`).',
        '',
        '**Compatibility.** Within `/api` the API only grows: optional parameters, optional response fields, new events. Ignore what you do not know.',
        '',
        'Guides: `/llms.txt`. Source: https://github.com/crvouga/atlas.'
      ].join('\n'),
      license: { name: 'MIT', identifier: 'MIT' }
    },
    servers: [{ url: options.serverUrl ?? '/' }],
    tags: [
      { name: 'Operations', description: 'Health, readiness, identity, and this description.' },
      { name: 'Report', description: 'The combined report, and the gate.' },
      { name: 'Live', description: 'Server-sent events.' },
      { name: 'Upload', description: 'The simplest way in: one JSON request.' },
      { name: 'Store protocol', description: 'The `ObjectStore` interface over HTTP: what `atlas report publish`, `stream`, `merge` and `httpStore` use.' },
      { name: 'Viewer data', description: 'Specs and runs, laid out the way the viewer reads a static host.' }
    ],
    paths,
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'A token of the server: `Authorization: Bearer <token>`. Needed to upload.' },
        basic: { type: 'http', scheme: 'basic', description: 'Any user name, the token as the password. For reading only: the browser\'s sign-in box.' }
      },
      schemas: Object.fromEntries(Object.entries(COMPONENTS).map(([name, [schema, io]]) => [name, schemaOf(schema, io)]))
    }
  };
}
