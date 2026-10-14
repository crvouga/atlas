import { z } from 'zod/v4';

/**
 * The layer: the one unit of evidence every producer writes and every reader combines.
 *
 * A layer is one focused recording: the checks one producer ran, on one environment, from one
 * version and branch. It is immutable and addressed by its content. Reports are never stored as a
 * whole; they are computed by layering. See docs/report-contract.md for the normative rules.
 *
 * Compatibility, which is the point of this file:
 * - Within a schema major version a change only adds optional fields. Readers ignore fields they
 *   do not know (every object here is loose), so an old reader reads a newer minor layer.
 * - The closed enumerations (`status`, `freshness`) change only with a new major version.
 * - `schemaVersion` is the major version. A reader that is older than a layer says so; it never
 *   guesses.
 *
 * Extensibility, which is what makes one format fit any test framework (docs/extending.md):
 * - Evidence is open. Beyond its outcome a check may carry attachments of any media type, timeline
 *   steps, annotations, retry attempts, tags, labels, links and namespaced `extensions`. Every one of
 *   them is optional, so a layer without them is as valid as it ever was.
 * - Vocabularies are open strings (`role`, `kind`, `type`, `level`, a step's `status`). The values
 *   documented here are conventions, not a list: a reader shows what it does not know in a generic way.
 * - `extensions` is where a producer or a tool puts structured data of its own, under a key it owns
 *   (`com.example.coverage`). Readers keep it and never fail on it.
 * - Evidence never decides a result. A reader that cannot read a piece of evidence drops that piece and
 *   keeps the check, its status and its place in the report.
 */
export const LAYER_SCHEMA_VERSION = 1;

/** Outcomes of a check. Anything not `passed` is not evidence of success. */
export const CHECK_STATUSES = ['passed', 'failed', 'running', 'not-run'] as const;
export const CheckStatusSchema = z.enum(CHECK_STATUSES);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const FRESHNESS = ['unknown', 'modified'] as const;

export const MeasurementSchema = z.looseObject({
  name: z.string().min(1),
  value: z.number().describe('A finite number'),
  unit: z.string(),
  limit: z.number().optional().describe('The allowance. A measurement over it is reported, and never fails the check by itself')
});

/**
 * Structured data of a producer's or tool's own, by namespace: `{ "com.example.coverage": { … } }`.
 * Use a name you own (a reverse domain, or your tool's name). Readers preserve it and never fail on it.
 */
export const ExtensionsSchema = z.record(z.string().min(1), z.unknown());

export const LinkSchema = z.looseObject({
  url: z.string().min(1),
  name: z.string().optional(),
  rel: z.string().optional().describe('Why it is linked, in an open vocabulary: issue, run, trace, docs, source…')
});

/** Where in a check something happened: at a step, and/or this long after the check started. */
export const MomentSchema = z.looseObject({
  step: z.string().optional().describe('The `id` of a step'),
  offsetMs: z.number().nonnegative().optional()
});

/**
 * A file or a value that goes with a result: a screenshot, a video, a trace, a log, a DOM or accessibility
 * snapshot, a HAR, a coverage report, a diff, anything. `contentType` says how to read it; `role` says what
 * it is for, in an open vocabulary (`screenshot`, `video`, `trace`, `log`, `snapshot`, `har`, `coverage`,
 * `diff`, `report`…). The bytes are in the layer (`bundleKey`), somewhere else (`uri`), or small enough to
 * sit inline (`text`).
 */
export const AttachmentSchema = z.looseObject({
  id: z.string().optional().describe('Lets another attachment, step or annotation refer to this one'),
  name: z.string().min(1),
  role: z.string().optional(),
  contentType: z.string().optional().describe('An IANA media type. Absent means application/octet-stream'),
  bundleKey: z.string().optional().describe('The key of its bytes in the layer'),
  uri: z.string().optional().describe('Where else to read it: an https URL, or a path a host understands'),
  text: z.string().optional().describe('A small UTF-8 value, inline'),
  bytes: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
  width: z.number().nonnegative().optional(),
  height: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional().describe('For video and audio'),
  description: z.string().optional(),
  at: MomentSchema.optional(),
  poster: z.string().optional().describe('The `id` of an attachment that stands for this one before it is opened'),
  captions: z.array(z.string()).optional().describe('The `id`s of attachments (WebVTT, SRT) that caption this one'),
  extensions: ExtensionsSchema.optional()
});
export type Attachment = z.output<typeof AttachmentSchema>;

/** A note about a result: a warning, a deprecation, a coverage figure, an accessibility finding, anything. */
export const AnnotationSchema = z.looseObject({
  type: z.string().min(1).describe('An open vocabulary: note, warning, deprecation, issue, accessibility, coverage…'),
  message: z.string(),
  level: z.string().optional().describe('Conventionally info, warning or error. Anything else is shown as a note'),
  at: MomentSchema.optional(),
  source: z.looseObject({ file: z.string().optional(), line: z.number().int().optional(), column: z.number().int().optional() }).optional(),
  links: z.array(LinkSchema).optional(),
  extensions: ExtensionsSchema.optional()
});
export type Annotation = z.output<typeof AnnotationSchema>;

/**
 * One entry on a check's timeline. Steps are a flat list: nest them with `parentId`, order them by
 * `offsetMs`. Whatever a framework calls its steps (actions, hooks, requests, spans), they fit.
 */
export const StepSchema = z.looseObject({
  id: z.string().optional(),
  parentId: z.string().optional(),
  name: z.string(),
  kind: z.string().optional().describe('An open vocabulary: action, assertion, hook, request, span, given, when, then…'),
  status: z.string().optional().describe('Conventionally passed, failed, skipped. Anything else is shown as it is'),
  offsetMs: z.number().nonnegative().optional().describe('When it started, after the check did'),
  durationMs: z.number().nonnegative().optional(),
  detail: z.string().optional(),
  attachments: z.array(AttachmentSchema).optional(),
  annotations: z.array(AnnotationSchema).optional(),
  extensions: ExtensionsSchema.optional()
});
export type Step = z.output<typeof StepSchema>;

/** One try of a check that was retried. The check's own status is the last one. */
export const AttemptSchema = z.looseObject({
  index: z.number().int().nonnegative(),
  status: CheckStatusSchema,
  durationMs: z.number().nonnegative().optional(),
  startedAtMs: z.number().nonnegative().optional(),
  detail: z.string().optional(),
  steps: z.array(StepSchema).optional(),
  attachments: z.array(AttachmentSchema).optional(),
  annotations: z.array(AnnotationSchema).optional(),
  extensions: ExtensionsSchema.optional()
});
export type Attempt = z.output<typeof AttemptSchema>;

/** What may be attached at any level: a layer, a part, a check. Every field is optional and open. */
const evidenceShape = {
  tags: z.array(z.string()).optional().describe('Free labels to filter and group by: smoke, slow, flaky…'),
  labels: z.record(z.string(), z.string()).optional().describe('Facts about the result, not part of its identity: owner, severity, browser, os, build. Unlike `parameters` they never split a result into another slot'),
  links: z.array(LinkSchema).optional(),
  attachments: z.array(AttachmentSchema).optional(),
  annotations: z.array(AnnotationSchema).optional(),
  extensions: ExtensionsSchema.optional()
};

export const CheckSchema = z.looseObject({
  id: z.string().min(1).describe("The check's stable identity within its producer. The same check must keep the same id in every layer, or layers cannot replace one another"),
  title: z.string(),
  status: CheckStatusSchema,
  detail: z.string().default('').describe('Why it failed, or what was measured'),
  specPath: z.string().optional().describe('The spec this check belongs to, relative to the repository, such as specs/join.feature'),
  measurements: z.array(MeasurementSchema).default([]),
  durationMs: z.number().nonnegative().optional().describe('How long the check took, when the producer measured it'),
  ...evidenceShape,
  steps: z.array(StepSchema).optional().describe("The check's timeline"),
  attempts: z.array(AttemptSchema).optional().describe('Every try, when the check was retried')
});
export type Check = z.output<typeof CheckSchema>;

export const SpecEntrySchema = z.looseObject({
  path: z.string().min(1),
  domain: z.string(),
  kind: z.string(),
  title: z.string(),
  fingerprint: z.string().optional().describe('Identity of the spec text the layer was recorded against, to warn when the spec changed since')
});

export const ReportPartSchema = z.looseObject({
  freshness: z.enum(FRESHNESS).optional(),
  parameters: z.record(z.string(), z.string()).optional(),
  sha: z.string().default('').describe('Repeats the layer sha; readers use the layer'),
  id: z.string().min(1),
  kind: z.string().min(1).describe('An open category: behavior, performance, accessibility… A new kind needs no change to a reader'),
  title: z.string(),
  recordedAtMs: z.number().nonnegative(),
  checks: z.array(CheckSchema),
  ...evidenceShape
});

const RecordedTestSchema = z.looseObject({
  testId: z.string().min(1),
  title: z.string(),
  status: z.enum(['passed', 'failed', 'skipped']),
  system: z.string().default(''),
  runtime: z.string().default(''),
  seed: z.string().default(''),
  durationMs: z.number().nonnegative().default(0)
});

/** A suite that recorded timelines and captured files, beside its checks. Absent for a layer of plain checks. */
export const LayerSourceSchema = z.looseObject({
  source: z.string().min(1),
  packageDir: z.string(),
  bucket: z.string(),
  status: z.enum(['passed', 'failed', 'skipped']),
  updatedAtMs: z.number().nonnegative(),
  environment: z.string().optional(),
  parameters: z.record(z.string(), z.string()).optional(),
  evidence: z.array(z.looseObject({ kind: z.string(), title: z.string(), checks: z.array(CheckSchema) })).optional(),
  tests: z.array(RecordedTestSchema)
});

export const RecordingAddressSchema = z.union([
  z.looseObject({ type: z.literal('layer') }),
  z.looseObject({ type: z.literal('commit'), sha: z.string().min(1), source: z.string().min(1) })
]);

export const BundleIndexSchema = z.record(
  z.string(),
  z.looseObject({
    contentType: z.string(),
    parts: z.array(z.looseObject({ blob: z.string(), offset: z.number().int().nonnegative(), size: z.number().int().nonnegative() }))
  })
);

export const LAYER_ID = /^[0-9a-f]{64}$/;

/**
 * `layers/manifests/<id>.json`. The id is the SHA-256 of the document without it, so two producers
 * that record the same thing write the same layer, and a retried publish changes nothing.
 */
export const LayerDocumentSchema = z.looseObject({
  schemaVersion: z.literal(LAYER_SCHEMA_VERSION).describe('The major version of this contract'),
  id: z.string().regex(LAYER_ID).describe('64 lowercase hex digits. Opaque to readers'),
  producer: z.string().min(1).describe('A stable name for the suite or tool. With the check id, environment and parameters it picks the slot a layer fills'),
  recordedAtMs: z.number().nonnegative().describe('When the checks ran, in epoch milliseconds. The newest completed result wins its slot'),
  sha: z.string().nullable().describe('The commit the checks ran against. Provenance only; it never partitions a report'),
  branch: z.string().nullable().describe('Provenance only'),
  runUrl: z.string().nullable().describe('Where to read the CI run that produced it'),
  environment: z.string().nullable().optional().describe('The client that was checked: desktop-web, mobile-web, ios, android, or any other lowercase name'),
  parameters: z.record(z.string(), z.string()).default({}).describe('Other choices that make a result its own slot, such as a device size'),
  freshness: z.enum(FRESHNESS).optional().describe('`modified`: recorded from a checkout with uncommitted changes. `unknown`: origin not captured'),
  specs: z.array(SpecEntrySchema).default([]),
  parts: z.array(ReportPartSchema),
  source: LayerSourceSchema.nullable().default(null),
  recording: RecordingAddressSchema.nullable().default(null),
  bundle: BundleIndexSchema.default({}),
  ...evidenceShape
});
export type LayerDocument = z.output<typeof LayerDocumentSchema>;

/**
 * Evidence is decoration, never the result. A reader that meets a piece of evidence it cannot read (a
 * malformed attachment, a field of the wrong type) drops that piece and keeps the check, its status and
 * its place in the report. The strict schemas above are what producers validate against; this is how
 * readers stay forgiving.
 */
function lenientList<T>(value: unknown, schema: z.ZodType<T>, prepare: (item: unknown) => unknown = (item) => item): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    const parsed = schema.safeParse(prepare(item));
    return parsed.success ? [parsed.data] : [];
  });
}

const object = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function lenientEvidence(holder: Record<string, unknown>, nested: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = { ...holder };
  const set = (key: string, value: unknown) => { if (value === undefined) delete out[key]; else out[key] = value; };
  if ('tags' in out) set('tags', lenientList(out.tags, z.string()));
  if ('links' in out) set('links', lenientList(out.links, LinkSchema));
  if ('attachments' in out) set('attachments', lenientList(out.attachments, AttachmentSchema));
  if ('annotations' in out) set('annotations', lenientList(out.annotations, AnnotationSchema));
  if ('labels' in out) set('labels', z.record(z.string(), z.string()).safeParse(out.labels).data);
  if ('extensions' in out) set('extensions', ExtensionsSchema.safeParse(out.extensions).data);
  if (nested.includes('steps') && 'steps' in out) set('steps', lenientList(out.steps, StepSchema, (item) => { const step = object(item); return step ? lenientEvidence(step) : item; }));
  if (nested.includes('attempts') && 'attempts' in out) set('attempts', lenientList(out.attempts, AttemptSchema, (item) => { const attempt = object(item); return attempt ? lenientEvidence(attempt, ['steps']) : item; }));
  return out;
}

function lenientLayer(raw: Record<string, unknown>): Record<string, unknown> {
  const layer = lenientEvidence(raw);
  if (Array.isArray(layer.parts)) {
    layer.parts = layer.parts.map((part) => {
      const found = object(part);
      if (!found) return part;
      const next = lenientEvidence(found);
      if (Array.isArray(next.checks)) next.checks = next.checks.map((check) => { const c = object(check); return c ? lenientEvidence(c, ['steps', 'attempts']) : check; });
      return next;
    });
  }
  return layer;
}

export type ParsedLayer = { readonly ok: true; readonly layer: LayerDocument } | { readonly ok: false; readonly reason: string };

/**
 * Read a layer manifest of any age. Layers written before `schemaVersion` existed are version 1.
 * A layer of a newer major version is refused by name rather than half understood.
 */
export function parseLayerDocument(raw: unknown): ParsedLayer {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'A layer is a JSON object' };
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (version !== undefined && version !== LAYER_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: typeof version === 'number' && version > LAYER_SCHEMA_VERSION
        ? `Written with layer schema version ${version}; this Atlas reads version ${LAYER_SCHEMA_VERSION}. Upgrade @crvouga/atlas to read it`
        : `Unsupported layer schemaVersion ${JSON.stringify(version)}`
    };
  }
  const parsed = LayerDocumentSchema.safeParse(lenientLayer({ ...(raw as Record<string, unknown>), ...(version === undefined ? { schemaVersion: LAYER_SCHEMA_VERSION } : {}) }));
  if (parsed.success) return { ok: true, layer: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, reason: `Not a valid layer: ${issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'unknown problem'}` };
}

/**
 * The checks of a layer given to the publisher, before the publisher fills in the rest. This is
 * the whole integration surface of a producer that has no timelines to record.
 */
/**
 * An attachment as a producer hands it over, before the publisher stores its bytes. Give the bytes as
 * `path` (a file, read by the CLI), `base64`, `data` (from code), or `text`; the publisher stores them in
 * the layer, fills in `bundleKey`, `bytes` and `sha256`, and removes these four.
 */
export const AttachmentInputSchema = AttachmentSchema.extend({
  path: z.string().optional().describe('A file to read, relative to the file this is in. Used by `atlas report publish`'),
  base64: z.string().optional(),
  data: z.custom<Uint8Array>((value) => value instanceof Uint8Array).optional().describe('From code: the bytes')
});
const StepInputSchema = StepSchema.extend({ attachments: z.array(AttachmentInputSchema).optional() });
const AttemptInputSchema = AttemptSchema.extend({ steps: z.array(StepInputSchema).optional(), attachments: z.array(AttachmentInputSchema).optional() });
const CheckInputSchema = CheckSchema.extend({
  attachments: z.array(AttachmentInputSchema).optional(),
  steps: z.array(StepInputSchema).optional(),
  attempts: z.array(AttemptInputSchema).optional()
});

export const PublishChecksSchema = z.looseObject({
  producer: z.string().min(1),
  checks: z.array(CheckInputSchema),
  kind: z.string().min(1).default('checks'),
  title: z.string().optional(),
  recordedAtMs: z.number().nonnegative(),
  sha: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  runUrl: z.string().nullable().default(null),
  environment: z.string().nullable().optional(),
  parameters: z.record(z.string(), z.string()).default({}),
  freshness: z.enum(FRESHNESS).optional(),
  specs: z.array(SpecEntrySchema).default([]),
  tags: evidenceShape.tags,
  labels: evidenceShape.labels,
  links: evidenceShape.links,
  attachments: z.array(AttachmentInputSchema).optional().describe('Attached to the whole layer: a CI log, a coverage report, a trace archive'),
  annotations: evidenceShape.annotations,
  extensions: evidenceShape.extensions
});
export type PublishChecksInput = z.input<typeof PublishChecksSchema>;

const CountsSchema = z.object({
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  'not-run': z.number().int().nonnegative(),
  total: z.number().int().nonnegative()
});

export const REPORT_STATUS_SCHEMA_VERSION = 1;

/**
 * What `atlas report status --format json` prints: the combined report in numbers, and whether it
 * passes. `ok` is the gate: nothing failed, nothing is still running, nothing could not be read,
 * and every required environment has results.
 */
export const ReportStatusSchema = z.looseObject({
  schemaVersion: z.literal(REPORT_STATUS_SCHEMA_VERSION),
  ok: z.boolean(),
  reasons: z.array(z.string()).describe('Why `ok` is false, in words. Empty when it is true'),
  checks: CountsSchema,
  byEnvironment: z.record(z.string(), CountsSchema),
  layers: z.number().int().nonnegative().describe('Distinct layers read, across all backends'),
  backends: z.array(z.object({ id: z.string(), label: z.string(), available: z.boolean() })),
  notices: z.array(z.string()).describe('What could not be read. Any notice fails the gate: unknown is not passed'),
  specsWithoutEvidence: z.array(z.string()).describe('Specs of the outline with no result at all. The outline is `--specs <dir>`, or else the specs the layers recorded'),
  specs: z.array(
    z.looseObject({
      path: z.string().nullable().describe('Null for checks that name no spec in the outline'),
      title: z.string(),
      kind: z.string(),
      checks: CountsSchema,
      byEnvironment: z.record(z.string(), CountsSchema)
    })
  ).describe('The outcome of each spec, so a dashboard needs nothing else'),
  failing: z.array(
    z.looseObject({
      spec: z.string().nullable(),
      check: z.string(),
      title: z.string(),
      status: z.enum(['failed', 'running']),
      environment: z.string().nullable(),
      producer: z.string(),
      branch: z.string().nullable(),
      sha: z.string().nullable(),
      layer: z.string(),
      backend: z.string(),
      runUrl: z.string().nullable(),
      detail: z.string()
    })
  ).describe('Each slot whose newest completed result failed, or that is still running')
});
export type ReportStatus = z.output<typeof ReportStatusSchema>;

/**
 * The specs of one version of a project, as published: what the report is laid over. Layers of
 * evidence say what ran; a spec set says what the specs were. Like layers, spec sets are immutable and
 * never replace each other: the node shows the newest one of the branch you choose.
 */
export const SpecSetSchema = z.looseObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(LAYER_ID).describe('SHA-256 of the branch, commit, freshness and the digest of every file: the same specs from the same commit are the same set'),
  branch: z.string().nullable(),
  sha: z.string().nullable(),
  recordedAtMs: z.number().nonnegative().describe('For a clean checkout, the commit time; for a modified one, when it was published'),
  freshness: z.enum(FRESHNESS).optional(),
  files: z.array(
    z.looseObject({
      path: z.string().min(1).describe('`specs/<path inside the specs directory>`, the name a check uses in `specPath`'),
      digest: z.string().regex(LAYER_ID).describe('SHA-256 of the file. Its text is at layers/specs/blobs/<digest>.txt'),
      fingerprint: z.string().describe('The advisory fingerprint layers record, to warn when a spec changed since they ran'),
      kind: z.string(),
      title: z.string(),
      domain: z.string(),
      bytes: z.number().int().nonnegative()
    })
  )
});
export type SpecSet = z.output<typeof SpecSetSchema>;
