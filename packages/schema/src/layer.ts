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

export const CheckSchema = z.looseObject({
  id: z.string().min(1).describe("The check's stable identity within its producer. The same check must keep the same id in every layer, or layers cannot replace one another"),
  title: z.string(),
  status: CheckStatusSchema,
  detail: z.string().default('').describe('Why it failed, or what was measured'),
  specPath: z.string().optional().describe('The spec this check belongs to, relative to the repository, such as specs/join.feature'),
  measurements: z.array(MeasurementSchema).default([]),
  durationMs: z.number().nonnegative().optional().describe('How long the check took, when the producer measured it')
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
  checks: z.array(CheckSchema)
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
  bundle: BundleIndexSchema.default({})
});
export type LayerDocument = z.output<typeof LayerDocumentSchema>;

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
  const parsed = LayerDocumentSchema.safeParse(version === undefined ? { ...raw, schemaVersion: LAYER_SCHEMA_VERSION } : raw);
  if (parsed.success) return { ok: true, layer: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, reason: `Not a valid layer: ${issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'unknown problem'}` };
}

/**
 * The checks of a layer given to the publisher, before the publisher fills in the rest. This is
 * the whole integration surface of a producer that has no timelines to record.
 */
export const PublishChecksSchema = z.looseObject({
  producer: z.string().min(1),
  checks: z.array(CheckSchema),
  kind: z.string().min(1).default('checks'),
  title: z.string().optional(),
  recordedAtMs: z.number().nonnegative(),
  sha: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  runUrl: z.string().nullable().default(null),
  environment: z.string().nullable().optional(),
  parameters: z.record(z.string(), z.string()).default({}),
  freshness: z.enum(FRESHNESS).optional(),
  specs: z.array(SpecEntrySchema).default([])
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
