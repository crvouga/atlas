/**
 * @module Atlas server API documents
 *
 * The JSON bodies the Atlas server speaks, as Zod schemas: the problem document every error uses (RFC 9457), what
 * `/api/server` and `/readyz` say about the server, the report a viewer reads (`/api/reports/evidence/effective`) and
 * what changed since a version of it, the store protocol's listings and acknowledgements, and the events on the
 * stream. The server's OpenAPI document (`@crvouga/atlas/openapi.json`) is generated from these, and each is also
 * published as a JSON Schema, so a client in any language can validate what it receives.
 *
 * Every object is open (unknown keys are kept, not refused) because the API only grows: within a version a response
 * may gain optional fields, never lose or change one (see AGENTS.md, "The server is a living application"). A client
 * must ignore what it does not know.
 *
 * @see docs/server.md
 */
import { z } from 'zod/v4';

import { CheckSchema, EvidenceScopeSchema, LayerRunSchema } from './layer';

/** One of the statuses a check has in a report: `passed`, `failed`, `running` (not finished) or `not-run`. Closed. */
export const EvidenceStatusSchema = z.enum(['passed', 'failed', 'running', 'not-run']);

/**
 * The body of every error the server answers, a Problem Details document (RFC 9457, `application/problem+json`).
 * `error` repeats `detail` for clients written before the standard was adopted; read `detail`.
 */
export const ProblemSchema = z.looseObject({
  type: z.string().default('about:blank').describe('A URI naming the kind of problem. `about:blank` means the status code says it all'),
  title: z.string().describe('The status in words, such as "Unauthorized"'),
  status: z.number().int().describe('The HTTP status code'),
  detail: z.string().describe('What went wrong and what to do about it, in a sentence an agent or a person can act on'),
  error: z.string().describe('The same as `detail`. Kept for clients that read `error`')
});

/** What `GET /healthz` answers: the process is up. */
export const HealthSchema = z.looseObject({ ok: z.literal(true) });

/** What `GET /readyz` answers: whether the backends were read, and counts for logs. `ready` false comes with status 503. */
export const ReadySchema = z.looseObject({
  ready: z.boolean().describe('True once the first pass over the backends is done and at least one backend answers'),
  layers: z.number().int().nonnegative().describe('Distinct layers read'),
  slots: z.number().int().nonnegative().describe('Distinct checks (slots) the report holds a winner for'),
  holding: z.number().int().nonnegative().describe('Layers that still hold at least one winner'),
  failed: z.number().int().nonnegative().describe('Layers or backends that could not be read right now'),
  refreshedAt: z.number().describe('When a pass over the backends last finished, epoch milliseconds; 0 before the first'),
  backends: z.array(z.looseObject({ id: z.string(), available: z.boolean() }))
});

/** What `GET /api/server` answers: what the server is, who is asking, and what it can do. */
export const ServerInfoSchema = z.looseObject({
  name: z.literal('atlas'),
  version: z.string().nullable().describe('The @crvouga/atlas version the server runs, or null when it does not know'),
  role: z.enum(['read', 'publish', 'admin']).describe('What the token of this request may do. A server with no tokens treats everyone as admin'),
  open: z.boolean().describe('True when the server has no tokens at all'),
  write: z.string().describe('The id of the backend uploads go to'),
  ready: z.boolean(),
  viewers: z.number().int().nonnegative().describe('Viewers connected to /api/events right now'),
  time: z.number().describe('The server clock, epoch milliseconds'),
  backends: z.array(z.looseObject({ id: z.string(), label: z.string(), available: z.boolean(), write: z.boolean() })),
  layers: z.number().int().nonnegative(),
  slots: z.number().int().nonnegative(),
  capabilities: z.record(z.string(), z.boolean()).describe('Features this server has, by name: `events`, `ingest`, `store`, `checks`, `status`, `effective`. A client checks a name before using what it names')
});

/** A backend as the report shows it: where results came from, and whether it could be read. */
export const BackendInfoSchema = z.looseObject({
  id: z.string(),
  label: z.string(),
  live: z.boolean().describe('Always false on a server'),
  available: z.boolean().describe('False when the backend could not be read; its results are then unknown, never passed')
});

/** One reference to a video held by a layer, check, retry attempt or step, found by the attachment's effective media type. */
export const VideoRefSchema = z.looseObject({
  name: z.string().describe('The attachment name'),
  owner: z.string().describe('Who holds it: `layer`, `check`, `attempt` or `step`. An open vocabulary: treat an unknown owner as a check'),
  attempt: z.number().int().nonnegative().optional().describe('The retry attempt that holds it, or that holds the step that does'),
  step: z.string().optional().describe('The name of the step that holds it'),
  recording: z.string().optional().describe('What identifies the bytes; references with the same value are one recording. Absent when it cannot be played'),
  available: z.boolean().describe('False when the reference names no bytes (no bundle key, address or inline text)'),
  scope: EvidenceScopeSchema.optional().describe('What this recording shows as its producer declared it: its own `scope`, else its attempt\'s, check\'s, part\'s or layer\'s. Absent: the scope is unknown, never live, physical or audible')
});

/** Video references as counts: how many are referenced, how many distinct recordings can be played, how many cannot. */
export const VideoCountsSchema = z.looseObject({
  references: z.number().int().nonnegative().describe('Every reference to a video; identical bytes referenced twice count twice'),
  recordings: z.number().int().nonnegative().describe('Distinct playable recordings'),
  unavailable: z.number().int().nonnegative().describe('References that name no bytes')
});

/** What a result carries beyond its outcome, as counts and short facts. Present only when there is something. */
export const EvidenceSummarySchema = z.looseObject({
  attachments: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  annotations: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  links: z.number().int().nonnegative(),
  tags: z.array(z.string()),
  artifactTags: z.array(z.string()).optional().describe('Normalized tags of the attachments themselves, sorted and distinct. Absent when no attachment is tagged; never inherited from a check or run'),
  labels: z.record(z.string(), z.string()),
  roles: z.array(z.string()),
  videos: z.array(VideoRefSchema).optional().describe('Its references to videos and who holds each. Absent when it has none, and in reports written before this was recorded')
});

/** A layer as the report shows it: its origin and its checks by status. */
export const LayerHeaderSchema = z.looseObject({
  id: z.string().describe('The layer id: 64 lowercase hex digits, the SHA-256 of its content'),
  backend: z.string().describe('The backend it was read from; the one that sorts first when several hold it'),
  producer: z.string().describe('The suite or tool that made it. Part of the slot'),
  packageDir: z.string().nullable(),
  recordedAtMs: z.number().describe('When the checks ran, epoch milliseconds. The newest completed result wins its slot'),
  sha: z.string().nullable().describe('The commit it was recorded at. Provenance only'),
  branch: z.string().nullable().describe('The branch it was recorded on. Provenance only'),
  environment: z.string().nullable().describe('The client it checked, such as `ios`. Part of the slot'),
  runUrl: z.string().nullable(),
  parameters: z.record(z.string(), z.string()).describe('Other choices that make a result its own slot'),
  freshness: z.enum(['unknown', 'modified']).optional().describe('`modified`: recorded from a checkout with uncommitted changes. `unknown`: origin not captured. Absent: clean'),
  run: LayerRunSchema.optional().describe('The execution the producer named for it (one local or manual invocation). Grouping and display only; never part of the slot'),
  recording: z.unknown().nullable().describe('Where recorded timelines are read from, or null'),
  live: z.boolean(),
  counts: z.record(EvidenceStatusSchema, z.number().int().nonnegative()),
  execution: z.string(),
  evidence: EvidenceSummarySchema.optional(),
  recordings: z.looseObject({
    expected: z.number().int().nonnegative(), uploaded: z.number().int().nonnegative(), referenced: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(), unresolved: z.number().int().nonnegative(), notApplicable: z.number().int().nonnegative()
  }).optional().describe('How many of the recordings the layer expected were published. Absent: the layer declared no expectations, so its completeness is unknown, not complete')
});

/** One check of a layer as the report shows it. */
export const LayerRowSchema = z.looseObject({
  kind: z.string().describe('The kind of the part holding the check. Part of the slot'),
  id: z.string().describe('The check id. Part of the slot'),
  title: z.string(),
  status: EvidenceStatusSchema,
  specPath: z.string().nullable().describe('The spec the check belongs to, `specs/<path>`, or null'),
  detail: z.string().describe('Why it has this status; empty when there is nothing to add'),
  measurements: z.array(z.looseObject({ name: z.string(), value: z.number(), unit: z.string(), limit: z.number().optional() })),
  testId: z.string().nullable(),
  variant: z.record(z.string(), z.string()),
  durationMs: z.number().nullable(),
  evidence: EvidenceSummarySchema.optional(),
  recording: z.looseObject({ state: z.string(), reason: z.string().optional() }).optional().describe('What became of the check\'s expected recording: uploaded, referenced, skipped, unresolved or not-applicable. Independent of `status`')
});

/** A layer with its checks: the rows of one layer, read apart from its header. */
export const LayerRowsSchema = z.looseObject({
  id: z.string(),
  rows: z.array(LayerRowSchema),
  fingerprints: z.record(z.string(), z.string()).describe('Spec path to the fingerprint the layer recorded for it')
});

/** A layer that holds winners, with only the rows that win. */
export const LayerEvidenceSchema = LayerRowsSchema.extend({ layer: LayerHeaderSchema });

/**
 * The report as it stands: `GET /api/reports/evidence/effective`. Only the layers that win at least one check are
 * listed, each with only the rows that win, newest first. `version` is a hash of the report: equal exactly when the
 * report is, on every replica, so it works as an ETag and as the `since` of a delta.
 */
export const EffectiveEvidenceSchema = z.looseObject({
  version: z.string().describe('Changes exactly when the report does'),
  layers: z.array(LayerEvidenceSchema),
  backends: z.array(BackendInfoSchema),
  notices: z.array(z.string()).describe('What could not be read. A gate treats any notice as unknown, never as passed'),
  totalLayers: z.number().int().nonnegative().describe('Every layer read, whether or not it still wins anything'),
  active: z.array(z.unknown()).describe('Always empty on a server; kept for viewers written for live spec runs')
});

/**
 * What `GET /api/reports/evidence/effective?since=<version>` answers when the server remembers that version: only
 * what changed. Replace the layers of the same id, drop `removed`, take the rest whole; the result equals the full
 * report. When the server does not remember the version it answers with the whole report instead (no `delta` key).
 */
export const EffectiveDeltaSchema = EffectiveEvidenceSchema.extend({
  delta: z.literal(true),
  base: z.string().describe('The version this applies to'),
  layers: z.array(LayerEvidenceSchema).describe('Layers that are new or changed since `base`, whole'),
  removed: z.array(z.string()).describe('Ids of layers that no longer hold a winner')
});

/** A spec of the outline a report is laid over. */
export const OutlineSpecSchema = z.looseObject({
  path: z.string().describe('`specs/<path>`'),
  domain: z.string(),
  kind: z.string().describe('The kind of spec: `gherkin`, `quint`, `dmn`, …'),
  title: z.string(),
  fingerprint: z.string().optional().describe('Identity of the spec text, so a result recorded against other text is flagged as possibly outdated')
});

/** `GET /api/reports/outline`: the specs a report is laid over, from the newest committed spec set. */
export const OutlineSchema = z.looseObject({
  specs: z.array(OutlineSpecSchema),
  sha: z.string().nullable(),
  changedFiles: z.array(z.string())
});

/** `GET /api/reports/evidence`: one page of layer headers, newest first. Used by clients that read the whole history. */
export const EvidencePageSchema = z.looseObject({
  layers: z.array(LayerHeaderSchema),
  cursor: z.string().nullable().describe('Pass as `?cursor=` for the next page; null at the end'),
  notices: z.array(z.string()),
  backends: z.array(BackendInfoSchema),
  active: z.array(z.unknown())
});

/** `GET /api/reports/evidence/detail/{backend}/{id}`: everything one check carries, and what its run carries. */
export const CheckDetailSchema = z.looseObject({
  layer: z.string(),
  kind: z.string(),
  check: CheckSchema,
  run: z.looseObject({}).describe('What the run as a whole carries: its logs, links, labels, annotations, scope and extensions'),
  inheritedScope: EvidenceScopeSchema.optional().describe('The scope the check inherits: its part\'s declaration, else its layer\'s. Absent when neither declared one: unknown, not live or physical')
});

/** `GET /api/store?prefix=…`: one page of keys under `layers/`, in code-unit order. */
export const StoreListingSchema = z.looseObject({
  keys: z.array(z.string()),
  next: z.string().nullable().describe('Pass as `?after=` for the next page; null when there are no more')
});

/** `PUT /api/store/{key}` answered: the key was taken (`created`) or was already there with the same bytes. */
export const StoreWriteResultSchema = z.looseObject({
  ok: z.literal(true),
  key: z.string(),
  kind: z.string().describe('What the server recognised the key as: `layer`, `layer-catalog`, `blob`, `spec-body`, `spec-set`, `spec-catalog`, `run-manifest`, `run-catalog`, `run-file` or `scratch`'),
  created: z.boolean()
});

/** `POST /api/checks` answered: the layer that was written. */
export const ChecksResultSchema = z.looseObject({
  ok: z.literal(true),
  id: z.string().describe('The layer id'),
  checks: z.number().int().nonnegative()
});

/** Which attachment a reviewer's tags belong to: one attachment of one check of one archived layer. */
export const ArtifactTargetSchema = z.looseObject({
  layer: z.string().regex(/^[0-9a-f]{64}$/).describe('The id of the archived layer that holds the check'),
  check: z.string().min(1).describe('The check\'s id'),
  kind: z.string().min(1).optional().describe('The kind of the part holding the check, when the same id exists in several parts'),
  artifact: z.string().min(1).max(1024).describe('The attachment: `id:<id>` when it has an id, else `key:<bundleKey>`, else `name:<name>` (see `artifactRef`)')
});

/** The body of `POST /api/reports/artifact-tags`: tags to add to and to remove from one attachment. At least one tag overall. */
export const ArtifactTagEditSchema = z.looseObject({
  target: ArtifactTargetSchema,
  add: z.array(z.string()).max(20).optional().describe('Tags to add. `demo` and `#demo` are the same tag'),
  remove: z.array(z.string()).max(20).optional().describe('Reviewer tags to remove. Tags the producer wrote are part of the immutable layer and stay')
});

/** One recorded edit of an attachment's reviewer tags. Entries are never changed or removed: they are the audit trail. */
export const ArtifactTagEntrySchema = z.looseObject({
  id: z.string().describe('Unique and time-ordered'),
  target: ArtifactTargetSchema,
  add: z.array(z.string()).describe('Normalized tags added'),
  remove: z.array(z.string()).describe('Normalized tags removed'),
  by: z.string().describe('The name of the token that made the edit (never the token)'),
  atMs: z.number().describe('When the server recorded it, epoch milliseconds')
});

/** `GET /api/reports/artifact-tags`: every recorded edit, oldest first. Fold them with `foldArtifactTags`. */
export const ArtifactTagsSchema = z.looseObject({
  schemaVersion: z.literal(1),
  entries: z.array(ArtifactTagEntrySchema)
});

/** The data of the `hello` event: sent first on `/api/events`. */
export const HelloEventSchema = z.looseObject({ version: z.string(), ready: z.boolean(), time: z.number(), heartbeatMs: z.number().positive().optional() });

/** The data of the `report` event: layers arrived. Enough to say who sent what, without asking. */
export const ReportEventSchema = z.looseObject({
  version: z.string().describe('The report version after these layers'),
  totalLayers: z.number().int().nonnegative(),
  added: z.array(z.looseObject({
    id: z.string(), producer: z.string(), environment: z.string().nullable().optional(), branch: z.string().nullable().optional(),
    sha: z.string().nullable().optional(), recordedAtMs: z.number(), counts: z.record(EvidenceStatusSchema, z.number().int().nonnegative()).optional()
  })).describe('At most the 20 newest of the layers that arrived'),
  addedTotal: z.number().int().nonnegative().describe('How many layers arrived, including those not listed')
});

/** The data of the `ping` event: sent every `heartbeatSeconds`, so a quiet server is told apart from a dead connection. */
export const PingEventSchema = z.looseObject({});

const StatusCountsSchema = z.record(EvidenceStatusSchema, z.number().int().nonnegative());

/** One recorded result of a test in the test catalog: when, where, how it went and how long it took, and where it came from. */
export const TestResultEntrySchema = z.looseObject({
  at: z.number().describe('When it was recorded, epoch milliseconds'),
  status: EvidenceStatusSchema,
  durationMs: z.number().nullable().describe('How long it took, or null when the producer did not measure it'),
  environment: z.string().nullable().describe('The client it checked, such as `desktop-web` or `ios`'),
  producer: z.string(),
  kind: z.string(),
  parameters: z.record(z.string(), z.string()),
  branch: z.string().nullable(),
  sha: z.string().nullable(),
  runUrl: z.string().nullable(),
  run: z.string().describe('The key of the run it belongs to, as `GET /api/reports/runs` lists it'),
  layer: z.string().describe('The id of the layer that recorded it'),
  backend: z.string(),
  detail: z.string().describe('Why it has its status, at most 500 characters'),
  evidence: EvidenceSummarySchema.optional()
});

const DurationStatsSchema = z.looseObject({
  count: z.number().int().nonnegative(), totalMs: z.number(), avgMs: z.number(), p50Ms: z.number(), p95Ms: z.number(), minMs: z.number(), maxMs: z.number(), lastMs: z.number()
});

const CatalogSpecSchema = z.looseObject({ path: z.string(), title: z.string(), domain: z.string(), kind: z.string() });

/** One test of the catalog: what it is, its current result per environment, and how it has gone over its recorded history. */
export const TestSummarySchema = z.looseObject({
  key: z.string().describe('The test\'s identity, `JSON.stringify([specPath, id])`. Pass it to `/api/reports/tests/history?key=`'),
  id: z.string(),
  title: z.string(),
  specPath: z.string().nullable(),
  spec: CatalogSpecSchema.nullable().describe('The spec it belongs to: recorded by its layers, published in a spec set, or derived from the path'),
  status: EvidenceStatusSchema.describe('The worst current result across environments: failed, then running, then not-run, then passed'),
  environments: z.array(z.string()),
  producers: z.array(z.string()),
  outcomes: z.array(TestResultEntrySchema).describe('The current result per producer, environment and parameter set, newest first'),
  stats: z.looseObject({
    results: z.number().int().nonnegative(), passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
    passRate: z.number().nullable().describe('passed / (passed + failed), or null with no completed result'),
    flaky: z.boolean(), flakyReason: z.string(), flips: z.number().int().nonnegative(),
    durations: DurationStatsSchema.nullable(),
    firstSeenMs: z.number().nullable(), lastSeenMs: z.number().nullable(), lastPassedAtMs: z.number().nullable(), lastFailedAtMs: z.number().nullable(),
    runs: z.number().int().nonnegative(), branches: z.array(z.string())
  }),
  tags: z.array(z.string()),
  artifactTags: z.array(z.string()).optional().describe('Normalized tags of the attachments of its current results, such as `demo` (shown `#demo`). Not inherited from a check or run, unlike `tags`'),
  inheritedArtifactTags: z.array(z.string()).optional().describe('Normalized tags its attachments inherit from their check and run, apart from `artifactTags`: what `?artifactTag=…&inherited=1` also matches'),
  scopeProfiles: z.array(z.array(z.string())).optional().describe('The scope tokens each distinct playable recording of its current results declares (`device:physical`, `audio:silent`); `["unknown"]` for a recording that declared none. What `?scope=` matches, one recording at a time. Absent when it has no playable recording'),
  labels: z.record(z.string(), z.string()),
  evidence: z.looseObject({ attachments: z.number().int().nonnegative(), steps: z.number().int().nonnegative(), attempts: z.number().int().nonnegative(), roles: z.array(z.string()) }),
  lastRecordedAtMs: z.number(),
  live: z.boolean()
});

const TestRefSchema = z.looseObject({ key: z.string(), title: z.string(), specPath: z.string().nullable(), status: EvidenceStatusSchema, value: z.number() });
const CatalogGroupSchema = z.looseObject({ name: z.string(), tests: z.number().int().nonnegative(), counts: StatusCountsSchema, avgMs: z.number().nullable() });
const FacetValueSchema = z.looseObject({ value: z.string(), count: z.number().int().nonnegative() });

/**
 * `GET /api/reports/tests`: every test of the report with a summary, insights and facets. The summary and facets cover
 * every test; `tests` is the page of those the query matched.
 */
export const TestCatalogSchema = z.looseObject({
  schemaVersion: z.literal(1),
  version: z.string().describe('Changes whenever the report or its history does'),
  generatedAtMs: z.number(),
  summary: z.looseObject({
    tests: z.number().int().nonnegative(), counts: StatusCountsSchema, outcomes: z.number().int().nonnegative(), flaky: z.number().int().nonnegative(),
    durations: DurationStatsSchema.nullable(), measured: z.number().int().nonnegative(), withAttachments: z.number().int().nonnegative(),
    environments: z.array(CatalogGroupSchema), producers: z.array(CatalogGroupSchema), domains: z.array(CatalogGroupSchema),
    slowest: z.array(TestRefSchema), flakiest: z.array(TestRefSchema), failing: z.array(TestRefSchema),
    runs: z.number().int().nonnegative(), lastRecordedAtMs: z.number().nullable(), history: z.boolean()
  }),
  facets: z.looseObject({
    statuses: z.array(FacetValueSchema), environments: z.array(FacetValueSchema), producers: z.array(FacetValueSchema), domains: z.array(FacetValueSchema),
    specs: z.array(CatalogSpecSchema.extend({ tests: z.number().int().nonnegative(), counts: StatusCountsSchema })),
    tags: z.array(FacetValueSchema), artifactTags: z.array(FacetValueSchema).optional(), scopes: z.array(FacetValueSchema).optional().describe('Scope tokens of recordings (`device:simulator`, `unknown`) with the number of tests that have a recording stating each'), branches: z.array(FacetValueSchema), labels: z.record(z.string(), z.array(FacetValueSchema))
  }),
  total: z.number().int().nonnegative().describe('Tests the query matched, before offset and limit'),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  tests: z.array(TestSummarySchema)
});

const nonneg = z.number().int().nonnegative();
const HealthItemSchema = z.looseObject({
  path: z.string(),
  candidates: z.array(z.looseObject({ path: z.string(), reason: z.string() })).optional().describe('Other paths it could be the same promise as. Atlas has not merged them')
});

/**
 * `GET /api/reports/tests/health`: why the report's Specs, domains and counts may disagree. Counts keep the denominators
 * apart (spec files, defined specs, specs with an executed test, tests, outlines, examples, observations), `reconciliation`
 * walks from one to another, and `findings` name what to fix. It reads the report; it never changes what passed.
 */
export const CatalogHealthSchema = z.looseObject({
  schemaVersion: z.literal(1),
  version: z.string().describe('Changes whenever the report or its history does'),
  generatedAtMs: z.number(),
  ok: z.boolean().describe('True when there is no warning-severity finding'),
  counts: z.looseObject({
    specs: z.looseObject({
      files: nonneg.describe('Spec files the report is laid over, before any root mapping'),
      defined: nonneg.describe('Logical specs: files joined by a declared root mapping count once'),
      withTests: nonneg.describe('Logical specs, defined or not, that have at least one test'),
      executed: nonneg.describe('Defined logical specs with a test that passed or failed'),
      withoutExecution: nonneg.describe('Defined logical specs with no passed or failed test: the defined coverage gaps')
    }),
    tests: z.looseObject({ total: nonneg, withSpec: nonneg, withoutSpec: nonneg, passed: nonneg.describe('Tests whose current status is passed'), historicalOnly: nonneg.describe('Tests only the history holds a result for') }),
    scenarios: z.looseObject({
      outlines: nonneg.describe('Tests sharing the label `outline` count once; a test without it is its own outline'),
      examples: nonneg.describe('Tests (check identities), however many environments ran them'),
      observations: nonneg.describe('Current results per producer, environment and parameter set'),
      executedObservations: nonneg, passedObservations: nonneg
    })
  }),
  reconciliation: z.looseObject({
    specs: nonneg.describe('What the Specs view counts: spec files'),
    testSpecs: nonneg.describe('What the Tests view groups by: logical specs with at least one test'),
    steps: z.array(z.looseObject({ code: z.string(), label: z.string(), delta: z.number().int() })).describe('From `specs` to `testSpecs`: each step adds its `delta`'),
    testsWithoutSpec: nonneg,
    explanation: z.array(z.string())
  }),
  identity: z.looseObject({ checks: nonneg, fallbackIdentity: nonneg.describe('Checks whose id equals their title'), basis: z.string() }),
  domains: z.array(z.looseObject({ name: z.string(), specs: nonneg })).describe('Specs per domain, most first'),
  roots: z.array(z.looseObject({ from: z.string(), to: z.string(), matched: nonneg.describe('Distinct paths the mapping changed') })),
  aliases: z.array(z.looseObject({ path: z.string(), sources: z.array(z.string()) })).describe('Logical specs seen under more than one original path, joined by a root mapping'),
  findings: z.array(z.looseObject({
    code: z.string().describe('An open set: treat a code you do not know as informational'),
    severity: z.enum(['warning', 'info']),
    message: z.string(),
    count: nonneg,
    items: z.array(HealthItemSchema).describe('At most 25; `count` is the whole')
  }))
});

/** `GET /api/reports/tests/history`: one test and every result recorded for it (at most 100), newest first. */
export const TestHistorySchema = z.looseObject({
  schemaVersion: z.literal(1),
  version: z.string(),
  test: TestSummarySchema,
  history: z.array(TestResultEntrySchema)
});

/** A run: the layers that name the same execution (else share a run URL, else a branch and commit), with what they recorded. */
export const ReportRunSchema = z.looseObject({
  key: z.string().describe('`run:<id>` for an execution a producer named, else the run URL, else `branch@sha`. Pass it to `/api/reports/runs/detail?key=` or `/api/reports/tests?run=`'),
  runId: z.string().optional().describe('The execution id the producer named, when it did. Layers that share it are one run however many uploads they took'),
  title: z.string().optional().describe('The human title of the execution (the newest layer\'s). Presentation only: the key, commit and `freshness` are unaffected'),
  freshness: z.enum(['unknown', 'modified']).optional().describe('`modified` when any layer of the run was recorded from a checkout with uncommitted changes; `unknown` when an origin was not captured; absent when all are clean. Shown beside the commit, never replaced by the title'),
  runUrl: z.string().nullable(), branch: z.string().nullable(), sha: z.string().nullable(),
  startedAtMs: z.number(), endedAtMs: z.number(), spanMs: z.number(),
  producers: z.array(z.string()), environments: z.array(z.string()),
  layers: z.number().int().nonnegative(), tests: z.number().int().nonnegative(), counts: StatusCountsSchema,
  totalDurationMs: z.number().nullable(),
  failing: z.array(z.looseObject({ key: z.string(), title: z.string(), environment: z.string().nullable(), detail: z.string() })),
  videos: VideoCountsSchema.optional().describe('Its videos, from its layers and the last result of each test. Absent when it has none or the report carries no video information')
});

/** `GET /api/reports/runs`: runs, newest first. */
export const RunListSchema = z.looseObject({
  schemaVersion: z.literal(1),
  version: z.string(),
  total: z.number().int().nonnegative().describe('Runs that matched, before `limit`'),
  runs: z.array(ReportRunSchema),
  withVideo: z.number().int().nonnegative().optional().describe('How many of all runs (before `video` and `limit`) have a playable video recording')
});

/** `GET /api/reports/runs/detail`: one run and its last result for every test, environment and producer it recorded. */
export const RunDetailSchema = z.looseObject({
  schemaVersion: z.literal(1),
  version: z.string(),
  run: ReportRunSchema,
  results: z.array(z.looseObject({
    key: z.string(), id: z.string(), title: z.string(), specPath: z.string().nullable(), environment: z.string().nullable(), producer: z.string(),
    status: EvidenceStatusSchema, durationMs: z.number().nullable(), at: z.number(), layer: z.string(), detail: z.string(),
    videos: z.array(VideoRefSchema).optional().describe('Every video its evidence references, with who holds it')
  }))
});
