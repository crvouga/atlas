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

import { CheckSchema, EvidenceScopeSchema, LayerRunSchema, MeasurementSchema } from './layer';

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
  role: z.enum(['read', 'critic', 'publish', 'admin']).describe('What the token of this request may do. A server with no tokens treats everyone as admin'),
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
  tags: z.array(z.string()).optional().describe('The normalized tags of this attachment itself. Absent when it has none (and in documents of older servers)'),
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
  attemptStatuses: z.array(EvidenceStatusSchema).optional().describe('The status of each recorded try, in the order they were made. Absent when no try was recorded, and in reports written before this was recorded: a first try is then unknown, never assumed to have passed'),
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
  measurements: z.array(MeasurementSchema),
  testId: z.string().nullable(),
  variant: z.record(z.string(), z.string()),
  durationMs: z.number().nullable(),
  evidence: EvidenceSummarySchema.optional(),
  state: z.looseObject({
    route: z.string().optional(), fixture: z.string().optional(), cohort: z.string().optional(), area: z.string().optional(),
    flags: z.array(z.string()).optional(), covers: z.array(z.string()).optional(),
    inventory: z.boolean().optional().describe('A `ui-plan` entry that names a surface of the product\'s inventory, not a state'),
    screenshot: z.looseObject({
      name: z.string(), bundleKey: z.string().optional(), uri: z.string().optional(), contentType: z.string().optional(),
      width: z.number().optional(), height: z.number().optional(), bytes: z.number().optional(), sha256: z.string().optional(),
      omitted: z.string().optional().describe('Why the producer left the bytes out')
    }).optional().describe('The check\'s picture: its `screenshot` attachment, else its first image')
  }).optional().describe('Only for a check of a `ui-state` or `ui-plan` part: its picture and the facts its producer declared under the `atlas.ui-state` extension. See the UI catalog guide. Never decides a result'),
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
  parts: z.array(z.looseObject({ kind: z.string(), id: z.string(), title: z.string() })).optional().describe('Without `check` only: the parts of the layer that carry files or links of their own, each with what it carries. Absent when none'),
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

/** A source a review collection points at: one recorded result of one archived layer, and optionally one of its recordings. Exact and immutable: a layer never changes. */
export const ReviewSourceSchema = z.looseObject({
  layer: z.string().regex(/^[0-9a-f]{64}$/).describe('The id of the archived layer that recorded the result'),
  check: z.string().min(1).max(1024).describe('The check\'s id in that layer'),
  kind: z.string().min(1).max(256).optional().describe('The kind of the part holding the check, when the same id exists in several parts'),
  recording: z.string().min(1).max(2048).optional().describe('One recording of the result (`VideoRef.recording`: `sha256:…`, a bundle key or an address). Absent: the result as a whole')
});

/** One entry of a request to publish a collection: a source and the curator\'s caption for it. */
export const ReviewEntryInputSchema = z.looseObject({
  ...ReviewSourceSchema.shape,
  caption: z.string().max(500).optional().describe('What the curator wants the reviewer to look at in this entry')
});

/** A gap the curator names: something the review should show and no recording does. It sits after the first `after` entries (0 or absent: before the first). */
export const ReviewGapInputSchema = z.looseObject({
  note: z.string().min(1).max(2000).describe('What is missing or unclear'),
  after: z.number().int().min(0).optional().describe('Place the gap after this many entries (0 or absent: before the first)')
});

/**
 * The body of `POST /api/reports/review-collections`: a new collection, or, with `basedOn`, an explicit new revision of
 * one. At least one entry or gap. The server records which sources the entries are now; it never alters the request.
 */
export const ReviewCollectionRequestSchema = z.looseObject({
  title: z.string().min(1).max(200),
  purpose: z.string().max(2000).optional().describe('Why this review exists'),
  audience: z.string().max(500).optional().describe('Who should review it'),
  tags: z.array(z.string()).max(20).optional().describe('Tags of the collection, such as `demo` (normalized like artifact tags)'),
  entries: z.array(ReviewEntryInputSchema).max(500).optional().describe('Ordered. The order is the order of the review; it is never re-sorted by time or status'),
  gaps: z.array(ReviewGapInputSchema).max(100).optional(),
  frozenFrom: z.string().max(4000).optional().describe('The live filtered view the entries were frozen from, as its address query (informational; the entries are what count)'),
  basedOn: z.looseObject({ id: z.string(), revision: z.number().int().min(1) }).optional().describe('Publish a new revision of this collection. `revision` must be its newest, else 409')
});

/** What the server recorded about the source of an entry at the moment it was frozen. */
export const ReviewSnapshotSchema = z.looseObject({
  title: z.string(),
  specPath: z.string().nullable(),
  status: EvidenceStatusSchema.describe('The result\'s recorded status, as that layer recorded it'),
  recordedAtMs: z.number(),
  environment: z.string().nullable(),
  producer: z.string(),
  branch: z.string().nullable(),
  sha: z.string().nullable(),
  run: z.string().describe('The key of the run it belongs to'),
  runUrl: z.string().nullable(),
  backend: z.string().nullable().describe('The backend the layer was read from'),
  testKey: z.string().describe('The test\'s key, as `GET /api/reports/tests` lists it'),
  attemptStatuses: z.array(EvidenceStatusSchema).optional().describe('The status of each recorded try, in order, when the check was retried. Never collapsed to the last'),
  videos: z.array(VideoRefSchema).optional().describe('Its references to videos when it was frozen')
});

/** One entry of a frozen collection. */
export const ReviewEntrySchema = z.looseObject({
  id: z.string().describe('Stable within the collection; notes and reviewed marks refer to it'),
  source: ReviewSourceSchema,
  caption: z.string().optional(),
  snapshot: ReviewSnapshotSchema
});

/** A gap item of a collection. */
export const ReviewGapSchema = z.looseObject({
  id: z.string(),
  note: z.string(),
  after: z.number().int().nonnegative().describe('It sits after this many entries')
});

/**
 * One revision of a review collection, as stored: immutable. It is curation, not a test run: it has no status of its own,
 * carries no check, and its entries are references to results that other runs recorded. Entries from different
 * runs are never one execution.
 */
export const ReviewCollectionSchema = z.looseObject({
  schemaVersion: z.literal(1),
  id: z.string().describe('The collection\'s stable id, in its share URL'),
  revision: z.number().int().min(1).describe('1 for the first; every change is a new revision'),
  title: z.string(),
  purpose: z.string().optional(),
  audience: z.string().optional(),
  tags: z.array(z.string()),
  entries: z.array(ReviewEntrySchema),
  gaps: z.array(ReviewGapSchema),
  frozenFrom: z.string().optional(),
  basedOn: z.looseObject({ id: z.string(), revision: z.number().int().min(1) }).optional(),
  createdBy: z.string().describe('The name of the token that published it (never the token)'),
  createdAtMs: z.number().describe('When the server recorded it, epoch milliseconds')
});

/** One collection in the list: its newest revision in brief. */
export const ReviewCollectionSummarySchema = z.looseObject({
  id: z.string(), revision: z.number().int().min(1), revisions: z.number().int().min(1).describe('How many revisions exist'),
  title: z.string(), purpose: z.string().optional(), audience: z.string().optional(), tags: z.array(z.string()),
  entries: z.number().int().nonnegative(), gaps: z.number().int().nonnegative(), createdBy: z.string(), createdAtMs: z.number()
});

/** `GET /api/reports/review-collections`: the newest revision of every collection, newest first. */
export const ReviewCollectionListSchema = z.looseObject({
  schemaVersion: z.literal(1),
  collections: z.array(ReviewCollectionSummarySchema)
});

/** The body of `POST /api/reports/review-collections/reviews`: a note, a time-coded gap note, or a reviewed marker on one entry. Curation only: it changes no outcome. */
export const ReviewNoteInputSchema = z.looseObject({
  collection: z.string().describe('The collection id'),
  revision: z.number().int().min(1),
  entry: z.string().optional().describe('The entry\'s id; required for `reviewed`, `unreviewed` and a timecode'),
  kind: z.enum(['note', 'gap', 'reviewed', 'unreviewed']),
  text: z.string().max(4000).optional().describe('Required for `note` and `gap`'),
  timecodeMs: z.number().int().min(0).optional().describe('A moment in the entry\'s recording, in milliseconds')
});

/** One recorded review note. Entries are never changed or removed: they are the audit trail. */
export const ReviewNoteSchema = z.looseObject({
  id: z.string().describe('Unique and time-ordered'),
  collection: z.string(), revision: z.number().int().min(1),
  entry: z.string().optional(),
  kind: z.enum(['note', 'gap', 'reviewed', 'unreviewed']),
  text: z.string().optional(),
  timecodeMs: z.number().optional(),
  by: z.string().describe('The name of the token that made it (never the token)'),
  atMs: z.number()
});

/** How an entry\'s source stands now: `available` (the layer and the result are in the report), `unverified` (the layer is held but the result is outside the report\'s history window) or `unavailable` (the layer is gone). */
export const ReviewAvailabilitySchema = z.looseObject({
  entry: z.string(),
  state: z.enum(['available', 'unverified', 'unavailable']),
  reason: z.string().optional().describe('Why it is not `available`, in words')
});

/** `GET /api/reports/review-collections/detail`: one revision, how each source stands now, and the review notes. */
export const ReviewCollectionDetailSchema = z.looseObject({
  schemaVersion: z.literal(1),
  collection: ReviewCollectionSchema,
  revisions: z.array(z.number().int().min(1)).describe('Every revision that exists, oldest first'),
  availability: z.array(ReviewAvailabilitySchema),
  reviews: z.array(ReviewNoteSchema).describe('Notes and marks of this revision, oldest first'),
  reviewed: z.record(z.string(), z.looseObject({ by: z.string(), atMs: z.number() })).describe('Entries whose latest mark is `reviewed`, with who and when')
});

/** One file in an export manifest. */
export const ReviewManifestFileSchema = z.looseObject({
  name: z.string().describe('The attachment\'s name as recorded'),
  safeName: z.string().describe('A name safe to write to a file system: letters, digits, dot, dash and underscore'),
  path: z.string().describe('Where a packer should put it: `files/<entry position>-<safeName>`'),
  recording: z.string().optional(),
  sha256: z.string().nullable().describe('The digest of the bytes when the report recorded one, else null: unknown, not verified'),
  missing: z.boolean().describe('True when the source cannot be read now')
});

/** `GET /api/reports/review-collections/export`: a portable index of one revision. It lists sources and files; it contains no bytes. */
export const ReviewManifestSchema = z.looseObject({
  schemaVersion: z.literal(1),
  generatedAtMs: z.number(),
  collection: z.looseObject({ id: z.string(), revision: z.number().int().min(1), title: z.string(), purpose: z.string().optional(), audience: z.string().optional(), tags: z.array(z.string()), createdBy: z.string(), createdAtMs: z.number() }),
  entries: z.array(z.looseObject({
    id: z.string(), position: z.number().int().min(1), caption: z.string().optional(), source: ReviewSourceSchema, snapshot: ReviewSnapshotSchema,
    state: z.enum(['available', 'unverified', 'unavailable']), reason: z.string().optional(), reviewed: z.boolean(),
    files: z.array(ReviewManifestFileSchema)
  })),
  gaps: z.array(ReviewGapSchema),
  missing: z.array(z.looseObject({ entry: z.string(), reason: z.string() })).describe('Entries whose sources cannot be read now, and every file that is missing'),
  notes: z.string()
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
  specRevision: z.string().optional().describe('The fingerprint of its spec text that the layer recorded, when it recorded one. Two results with different revisions were recorded against different promises. Absent: not recorded, never assumed to match'),
  evidence: EvidenceSummarySchema.optional(),
  latency: z.array(MeasurementSchema).optional().describe('Its product-latency measurements (`kind: product-latency`), when it recorded any. Separate from `durationMs`, which is how long the test took')
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

const ReliabilityRateSchema = z.looseObject({
  executions: z.number().int().nonnegative().describe('Independent executions that passed or failed'),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  rate: z.number().nullable().describe('passed / executions, or null with none')
});

/**
 * `GET /api/reports/tests/reliability`: how reliable one test is inside a scope, and exactly how that figure was counted.
 * The snapshots one run recorded for one producer, environment and parameter set are one independent execution; only
 * `passed` and `failed` executions are trials; `notes` say when the sample is too small, pooled, selectively rerun or
 * bounded. It reads results and never changes a status. It is not a production failure probability.
 */
export const TestReliabilitySchema = z.looseObject({
  schemaVersion: z.literal(1),
  key: z.string().describe('The test\'s key'),
  scope: z.looseObject({
    environment: z.array(z.string()).optional(), producer: z.array(z.string()).optional(), parameter: z.array(z.string()).optional(),
    branch: z.array(z.string()).optional(), sha: z.array(z.string()).optional(), specRevision: z.array(z.string()).optional(),
    revision: z.enum(['current', 'any']).optional(), since: z.number().optional(), until: z.number().optional()
  }).describe('What was asked: the selection the figures are about'),
  minimumExecutions: z.number().int().positive().describe('Completed executions below which the sample is `insufficient`'),
  sample: z.enum(['none', 'insufficient', 'sufficient']).describe('A count only: it says nothing about whether the executions are representative; read `notes`'),
  eventual: ReliabilityRateSchema.describe('Executions that passed in the end, over those that passed or failed'),
  interval: z.looseObject({ method: z.literal('wilson'), level: z.number(), lower: z.number(), upper: z.number(), assumptions: z.string() }).nullable().describe('An interval estimate with the assumptions it needs; null without an execution'),
  firstAttempt: ReliabilityRateSchema.describe('Over the executions that recorded their tries: those whose first try passed'),
  unrecordedAttempts: z.number().int().nonnegative().describe('Counted executions that recorded no tries: their first try is unknown, never assumed to have passed'),
  attempts: z.looseObject({ total: z.number().int().nonnegative(), retried: z.number().int().nonnegative(), recovered: z.number().int().nonnegative() }),
  currentRevision: z.string().nullable().describe('The spec revision `revision=current` counted, or null'),
  historical: z.looseObject({
    executions: z.number().int().nonnegative(), passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
    revisions: z.array(z.looseObject({ specRevision: z.string(), executions: z.number().int().nonnegative() }))
  }).describe('Earlier spec revisions: context only, counted nowhere above'),
  excluded: z.record(z.string(), z.number().int().nonnegative()).describe('Executions in the scope that are not trials, by reason: `not-run`, `unfinished`, `unknown-status`, `historical-revision`, `revision-not-recorded`'),
  outsideScope: z.number().int().nonnegative().describe('Executions the scope did not select'),
  snapshots: z.number().int().nonnegative().describe('Raw recorded snapshots behind the counted executions'),
  cohorts: z.array(ReliabilityRateSchema.extend({ environment: z.string().nullable(), producer: z.string(), parameters: z.record(z.string(), z.string()) })),
  available: z.looseObject({
    environments: z.array(FacetValueSchema), producers: z.array(FacetValueSchema), branches: z.array(FacetValueSchema), specRevisions: z.array(FacetValueSchema)
  }).describe('What a scope could choose among, with independent executions'),
  notes: z.array(z.looseObject({ code: z.string().describe('An open set: treat a code you do not know as informational'), severity: z.enum(['warning', 'info']), message: z.string() })),
  executions: z.array(z.looseObject({
    run: z.string(), at: z.number(), status: z.string(), counted: z.boolean(), excluded: z.string().optional(),
    environment: z.string().nullable(), producer: z.string(), kind: z.string(), parameters: z.record(z.string(), z.string()),
    branch: z.string().nullable(), sha: z.string().nullable(), runUrl: z.string().nullable(), layer: z.string(), backend: z.string(),
    durationMs: z.number().nullable(), specRevision: z.string().optional(), snapshots: z.number().int().positive(),
    attempts: z.array(z.string()).optional().describe('The status of each recorded try, in order'), firstAttempt: z.string().optional(),
    republished: z.boolean().describe('A failed snapshot of this execution was followed by a later one')
  })).describe('Every independent execution of the selection, newest first: the denominator, open to inspection')
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
  videos: VideoCountsSchema.optional().describe('Its videos, from its layers and the last result of each test. Absent when it has none or the report carries no video information'),
  attachments: z.number().int().positive().optional().describe('Files attached to the run itself, in its layers, not to a check. Absent when there are none'),
  artifactTags: z.array(z.string()).optional().describe('The normalized tags of the attachments of its results, sorted and distinct. Absent when none is tagged, and in reports of older servers'),
  tags: z.array(z.string()).optional().describe('The tags of its checks and layers, which its attachments inherit (what `inherited=1` also matches). Absent when none'),
  types: z.array(z.string()).optional().describe('The media types (roles) of its attachments, sorted and distinct; `video` only for a playable recording. Absent when it has no attachment'),
  labels: z.array(z.string()).optional().describe('The `key=value` labels of its results and layers, sorted and distinct. Absent when it has none')
});

/** A value of a filter dimension and how many records have it. */
export const QueryFacetValueSchema = z.looseObject({ value: z.string(), count: z.number().int().nonnegative() });

/** The facets of a runs or artifacts query: per dimension, its values with disjunctive counts (the list's count if that value were the only one chosen, every other dimension's filter applied). */
export const QueryFacetsSchema = z.looseObject({
  artifactTags: z.array(QueryFacetValueSchema), types: z.array(QueryFacetValueSchema), labels: z.array(QueryFacetValueSchema).describe('Values are `key=value`'),
  environments: z.array(QueryFacetValueSchema), producers: z.array(QueryFacetValueSchema), branches: z.array(QueryFacetValueSchema), outcomes: z.array(QueryFacetValueSchema),
  domains: z.array(QueryFacetValueSchema).optional().describe('Only for artifacts: runs have no domain')
});

/** `GET /api/reports/runs`: runs, newest first. */
export const RunListSchema = z.looseObject({
  schemaVersion: z.literal(1),
  version: z.string(),
  total: z.number().int().nonnegative().describe('Runs that matched, before `limit`'),
  runs: z.array(ReportRunSchema),
  withVideo: z.number().int().nonnegative().optional().describe('How many of all runs (before `video` and `limit`) have a playable video recording'),
  filters: z.array(z.string()).optional().describe('The filter parameters this server applied (`artifactTag`, `type`, `outcome`…). A viewer that asked for one that is missing here knows the server ignored it. Absent on servers that predate filtering'),
  facets: QueryFacetsSchema.optional().describe('The values each filter dimension offers, counted over every run. Absent on servers that predate filtering')
});

/** One recorded result that carries evidence: where and when it was recorded and what it carries. */
export const ArtifactResultSchema = z.looseObject({
  key: z.string().describe('The test\'s key, as in `/api/reports/tests`'), id: z.string(), title: z.string(), specPath: z.string().nullable(), domain: z.string().nullable(),
  at: z.number().describe('When it was recorded, epoch milliseconds'), status: EvidenceStatusSchema,
  environment: z.string().nullable(), producer: z.string(), kind: z.string(), parameters: z.record(z.string(), z.string()),
  branch: z.string().nullable(), sha: z.string().nullable(), run: z.string().describe('The run\'s key, as in `/api/reports/runs`'), runUrl: z.string().nullable(),
  layer: z.string().describe('The id of the layer that recorded it. Pass it as the `layer` of the explorer to see exactly this result'), backend: z.string(),
  attachments: z.number().int().nonnegative(),
  artifactTags: z.array(z.string()).describe('Normalized tags of its attachments'),
  tags: z.array(z.string()).describe('Tags of its check and run, which its attachments inherit'),
  types: z.array(z.string()).describe('Media types (roles) of its attachments; `video` only for a playable recording'),
  labels: z.record(z.string(), z.string()),
  videos: z.array(VideoRefSchema).optional(),
  attemptStatuses: z.array(EvidenceStatusSchema).optional().describe('The status of each recorded try in order, when the check was retried. Absent when no try was recorded: a first try is then unknown, never assumed to have passed')
});

/** `GET /api/reports/artifacts`: recorded results that carry evidence, newest first, with the facets of the query. */
export const ArtifactListSchema = z.looseObject({
  schemaVersion: z.literal(1),
  version: z.string(),
  total: z.number().int().nonnegative().describe('Results that matched, before `offset` and `limit`'),
  offset: z.number().int().nonnegative(), limit: z.number().int().nonnegative(),
  results: z.array(ArtifactResultSchema),
  filters: z.array(z.string()).describe('The filters of the query that were applied'),
  facets: QueryFacetsSchema
});

/** `GET /api/reports/runs/detail`: one run and its last result for every test, environment and producer it recorded. */
export const RunDetailSchema = z.looseObject({
  schemaVersion: z.literal(1),
  version: z.string(),
  run: ReportRunSchema,
  results: z.array(z.looseObject({
    key: z.string(), id: z.string(), title: z.string(), specPath: z.string().nullable(), environment: z.string().nullable(), producer: z.string(),
    status: EvidenceStatusSchema, durationMs: z.number().nullable(), at: z.number(), layer: z.string(), detail: z.string(),
    videos: z.array(VideoRefSchema).optional().describe('Every video its evidence references, with who holds it'),
    kind: z.string().optional().describe('The kind of the part that held it. With the producer, environment and parameters it is the condition the result was recorded under. Absent from an older server'),
    parameters: z.record(z.string(), z.string()).optional().describe('The other choices that made it its own result (a device size, a locale…). Absent when there are none, and from an older server'),
    specRevision: z.string().optional().describe('The fingerprint of its spec file the layer recorded. Absent means not recorded, never "the same"'),
    recordedTitle: z.string().optional().describe('The title this run\'s layer gave the check. `title` is the check\'s newest title in the whole history; this is the wording as recorded. Absent from an older server')
  })),
  layers: z.array(z.looseObject({
    id: z.string().describe('The layer id; read its files with `/api/reports/evidence/detail/{backend}/{id}`'),
    backend: z.string(), producer: z.string(), environment: z.string().nullable(), recordedAtMs: z.number(),
    checks: z.number().int().nonnegative().describe('How many checks the layer recorded. Zero means evidence only, not a pass'),
    attachments: z.number().int().nonnegative().describe('Files the layer carries as a whole, not those of its checks'),
    videos: VideoCountsSchema.optional()
  })).optional().describe('Every layer of the run, oldest first. Absent from an older server')
});

/** A state's profile: the client and the choices it was captured under. */
export const UiProfileSchema = z.looseObject({
  key: z.string().describe('Identifies the profile across layers: the environment and the sorted parameters'),
  environment: z.string().nullable(), parameters: z.record(z.string(), z.string()),
  label: z.string().describe('For a person: the client and each parameter\'s value')
});

/** The picture of a capture. */
export const UiImageSchema = z.looseObject({
  name: z.string(), contentType: z.string().optional(), width: z.number().optional(), height: z.number().optional(), bytes: z.number().optional(), sha256: z.string().optional(),
  bundleKey: z.string().optional(), uri: z.string().optional().describe('An http(s) address, when the picture lives elsewhere'),
  path: z.string().optional().describe('Where the stored bytes are, relative to the reports API root (`/api/reports` on a server): `/layers/<layer>/blobs/attachments/<sha256>`'),
  omitted: z.string().optional().describe('Why the producer left the bytes out. A picture that is left out is not a picture that was never taken')
});

/** One state in one profile. */
export const UiCellSchema = z.looseObject({
  profile: UiProfileSchema,
  coverage: z.enum(['captured', 'failed', 'capturing', 'skipped', 'missing']).describe('`captured` only when the winning capture passed. Every other value means there is no picture to trust'),
  expected: z.enum(['declared', 'undeclared', 'unknown']).describe('`declared`: a plan expects it. `undeclared`: plans exist and none names it. `unknown`: no plan was published, so nothing is known to be unexpected'),
  capture: z.looseObject({
    status: EvidenceStatusSchema, detail: z.string(), durationMs: z.number().nullable(), image: UiImageSchema.nullable(),
    labels: z.record(z.string(), z.string()).describe('What describes the capture without splitting it: a `shard`, a `browser`'),
    origin: z.looseObject({
      layer: z.string(), backend: z.string(), producer: z.string(), recordedAtMs: z.number(), sha: z.string().nullable(), branch: z.string().nullable(), runUrl: z.string().nullable(),
      freshness: z.enum(['unknown', 'modified']).optional()
    }),
    alternatives: z.number().int().nonnegative().describe('Other captures of this cell from other producers; the winner is the one the report contract picks')
  }).nullable(),
  planned: z.looseObject({ layer: z.string(), backend: z.string() }).nullable().describe('The plan layer that expects this cell')
});

const UiFacetSchema = z.array(z.looseObject({ value: z.string(), count: z.number().int().nonnegative(), label: z.string().optional() }));

/**
 * `GET /api/reports/ui-catalog`: the UI catalog, computed from the winning results of the `ui-state` and `ui-plan` parts
 * of every layer. States are in id order and cells in profile order, so the same layers always give the same document.
 */
export const UiCatalogSchema = z.looseObject({
  schemaVersion: z.literal(1),
  version: z.string().optional().describe('The report version this was computed from; equal exactly when the report is'),
  summary: z.looseObject({
    states: z.number().int().nonnegative(), profiles: z.number().int().nonnegative(), cells: z.number().int().nonnegative(),
    coverage: z.looseObject({ captured: z.number(), failed: z.number(), capturing: z.number(), skipped: z.number(), missing: z.number() }),
    undeclared: z.number().int().nonnegative().describe('Cells captured or failed that no plan expects. Zero when no plan was published'),
    planned: z.boolean().describe('Whether any plan was published. Without one `missing` is always zero: what should exist is unknown'),
    surfaces: z.number().int().nonnegative(), uncoveredSurfaces: z.number().int().nonnegative()
  }),
  profiles: z.array(UiProfileSchema),
  states: z.array(z.looseObject({
    id: z.string(), title: z.string(),
    route: z.string().nullable(), fixture: z.string().nullable(), cohort: z.string().nullable(), area: z.string().nullable(),
    flags: z.array(z.string()), covers: z.array(z.string()).describe('The surfaces it covers'), producers: z.array(z.string()),
    cells: z.array(UiCellSchema)
  })),
  surfaces: z.array(z.looseObject({
    id: z.string(), inventoried: z.boolean().describe('A `ui-plan` inventory entry names it: the product is known to have it'),
    states: z.number().int().nonnegative(), captured: z.number().int().nonnegative(),
    status: z.enum(['covered', 'uncaptured', 'uncovered'])
  })),
  facets: z.looseObject({ profiles: UiFacetSchema, coverage: UiFacetSchema, areas: UiFacetSchema, routes: UiFacetSchema, cohorts: UiFacetSchema, flags: UiFacetSchema, surfaces: UiFacetSchema, producers: UiFacetSchema }),
  sources: z.looseObject({ layers: z.number().int().nonnegative(), backends: z.array(BackendInfoSchema), notices: z.array(z.string()) }).describe('What was read. A backend that is unavailable, or a layer that could not be read, is named here; what depended on it is not shown as captured'),
  total: z.number().int().nonnegative().optional().describe('States that matched, before `offset` and `limit`'),
  offset: z.number().int().nonnegative().optional(), limit: z.number().int().nonnegative().optional()
});
