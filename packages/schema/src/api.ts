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

import { CheckSchema } from './layer';

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

/** What a result carries beyond its outcome, as counts and short facts. Present only when there is something. */
export const EvidenceSummarySchema = z.looseObject({
  attachments: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  annotations: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  links: z.number().int().nonnegative(),
  tags: z.array(z.string()),
  labels: z.record(z.string(), z.string()),
  roles: z.array(z.string())
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
  recording: z.unknown().nullable().describe('Where recorded timelines are read from, or null'),
  live: z.boolean(),
  counts: z.record(EvidenceStatusSchema, z.number().int().nonnegative()),
  execution: z.string(),
  evidence: EvidenceSummarySchema.optional()
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
  evidence: EvidenceSummarySchema.optional()
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
  run: z.looseObject({}).describe('What the run as a whole carries: its logs, links, labels, annotations and extensions')
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

/** The data of the `hello` event: sent first on `/api/events`. */
export const HelloEventSchema = z.looseObject({ version: z.string(), ready: z.boolean(), time: z.number() });

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
