import { z } from 'zod/v4';

import { CountSchema, EventKindSchema, ImageSchema, RunStatusSchema } from './common';

/** Manifest schema versions this package describes. Readers accept these and try newer ones. */
export const MANIFEST_SCHEMA_VERSIONS = [1] as const;
export const LATEST_MANIFEST_SCHEMA_VERSION = 1;

export const MEDIA_STATES = ['ready', 'processing', 'failed'] as const;

/**
 * Proposed: the runner marks media it has promised but not finished writing, so a viewer can
 * show "still processing" instead of a broken image. Absent means ready.
 */
export const MediaStateSchema = z.enum(MEDIA_STATES);

export const TIMELINE_KINDS = ['tap', 'type', 'system', 'screen', 'toast', 'note', 'time', 'notification'] as const;

export const SystemCallSchema = z.object({
  source: z.string().optional(),
  endpoint: z.string().optional(),
  eventType: z.string().optional(),
  payload: z.unknown().optional(),
  responseStatus: z.number().int().optional(),
  response: z.unknown().optional().describe('Proposed: the response body')
});

/** Proposed `kind: time`: a clock jump, with the dates before and after. */
export const TimeJumpSchema = z.object({
  from: z.string(),
  to: z.string(),
  fired: z.array(z.object({ at: z.string(), label: z.string() })).optional()
});

/** Proposed `kind: notification`: a push, email or text the member received. */
export const NotificationSchema = z.object({
  channel: z.enum(['push', 'email', 'sms', 'in-app']).optional(),
  title: z.string().optional(),
  body: z.string().optional()
});

export const TimelineEntrySchema = z.object({
  atMs: z.number().nonnegative().describe('Milliseconds from the start of the clip'),
  kind: z.enum(TIMELINE_KINDS),
  label: z.string(),
  x: z.number().optional().describe('Tap position in CSS pixels'),
  y: z.number().optional(),
  text: z.string().optional().describe('What was typed'),
  system: SystemCallSchema.optional(),
  time: TimeJumpSchema.optional(),
  notification: NotificationSchema.optional(),
  client: z.string().optional().describe('The client that did it, in a multi-client run')
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

/** A CloudEvents 1.0 event (JSON format), as an event source observed it. */
export const CloudEventSchema = z
  .object({
    specversion: z.literal('1.0'),
    id: z.string().min(1),
    source: z.string().min(1),
    type: z.string().min(1),
    time: z.string().optional(),
    subject: z.string().optional(),
    datacontenttype: z.string().optional(),
    data: z.unknown().optional()
  })
  .passthrough();
export type CloudEvent = z.infer<typeof CloudEventSchema>;

export const BusinessEventsSchema = z.object({
  expected: z.array(z.string()),
  observed: z.array(z.string()),
  missing: z.array(z.string()),
  noSignal: z.array(z.string()).describe('No observable signal is mapped yet'),
  events: z.array(CloudEventSchema).optional().describe('The CloudEvents observed during the step')
});
export type BusinessEvents = z.infer<typeof BusinessEventsSchema>;

export const CheckResultSchema = z.object({
  check: z.string(),
  passed: z.boolean(),
  expected: z.string().optional(),
  actual: z.string().optional()
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const RecognizerSchema = z.object({
  matched: z.boolean(),
  signals: z.array(z.object({ signal: z.string(), expected: z.string(), visible: z.boolean() }))
});

export const RunInfoSchema = z.object({
  id: z.string().min(1),
  startedAt: z.string(),
  durationMs: z.number().nonnegative(),
  commit: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  environment: z.record(z.string(), z.unknown()).optional(),
  mode: z.enum(['fast', 'showcase']),
  specVersion: z.string(),
  specDirectory: z.string().optional(),
  approvals: z.array(z.unknown()).optional(),
  scope: z
    .object({ chart: z.string().optional(), start: z.string().optional(), state: z.string().optional().describe('The state the run was scoped to') })
    .optional(),
  finishedAt: z.string().nullable().optional().describe('Proposed: null while the run is still going'),
  workers: z.number().int().positive().optional().describe('Path attempts that ran at once'),
  shard: z.object({ index: z.number().int().positive(), count: z.number().int().positive() }).optional().describe('The part of the plan this run covered'),
  reused: z.object({ from: z.string(), paths: z.number().int().nonnegative() }).optional().describe('Passed paths kept from an earlier run instead of running again'),
  mergedFrom: z.array(z.string()).optional().describe('The runs this run was composed from')
});
export type RunInfo = z.infer<typeof RunInfoSchema>;

export const ManifestChartSchema = z.object({
  id: z.string().min(1),
  file: z.string(),
  description: z.string().optional(),
  parentState: z.string().nullable().optional(),
  handOffs: z.record(z.string(), z.string()).optional()
});

export const MapNodeSchema = z.object({
  id: z.string().min(1),
  parent: z.string().nullable(),
  chart: z.string(),
  type: z.enum(['atomic', 'compound', 'parallel', 'final']),
  initial: z.string().nullable().optional(),
  inScope: z.boolean().optional()
});

export const MapEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string(),
  target: z.string(),
  event: z.string(),
  kind: EventKindSchema,
  inScope: z.boolean().optional()
});

export const StateRecordSchema = z.object({
  name: z.string(),
  chart: z.string().nullable().optional(),
  description: z.string().optional(),
  snapshot: z.string().optional(),
  confidence: z.enum(['confirmed', 'assumed']).optional(),
  source: z.array(z.string()).optional(),
  expectedEvents: z.array(z.string()).optional(),
  client: z.string().optional().describe('The client whose screen shows it, in a multi-client run'),
  seeds: z.array(z.string()).optional().describe('Seeds that start paths with this state active'),
  status: RunStatusSchema,
  screenshot: ImageSchema.nullable().optional(),
  screenshotState: MediaStateSchema.optional(),
  thumbnail: z.string().optional().describe('Proposed: a separate small image for the map'),
  screenshotsByPath: z.record(z.string(), ImageSchema).optional(),
  recognizer: RecognizerSchema.nullable().optional(),
  looksLike: z.array(z.string()).optional(),
  businessEvents: BusinessEventsSchema.nullable().optional(),
  checks: z.array(CheckResultSchema).optional(),
  reachedBy: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional()
});
export type StateRecord = z.infer<typeof StateRecordSchema>;

export const ClipSchema = z.object({
  video: z.string().min(1),
  poster: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  captions: z.string().optional().describe('Proposed: a WebVTT file'),
  client: z.string().optional().describe('The client whose screen was recorded'),
  state: MediaStateSchema.optional()
});
export type Clip = z.infer<typeof ClipSchema>;

export const TransitionRecordSchema = z.object({
  id: z.string().optional(),
  source: z.string(),
  target: z.string().nullable().optional(),
  event: z.string(),
  kind: EventKindSchema.optional(),
  how: z.string().nullable().optional(),
  client: z.string().optional().describe('The client that does it, in a multi-client run'),
  status: RunStatusSchema,
  clip: ClipSchema.nullable().optional(),
  timeline: z.array(z.unknown()).optional(),
  reason: z.string().nullable().optional(),
  reachedBy: z.array(z.string()).optional()
});
export type TransitionRecord = z.infer<typeof TransitionRecordSchema>;

export const PathStepSchema = z.object({
  transition: z.string().optional(),
  event: z.string(),
  status: RunStatusSchema.optional(),
  reason: z.string().nullable().optional()
});

export const PathRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: z.enum(['journey', 'generated']),
  description: z.string().optional(),
  status: RunStatusSchema,
  attempts: z
    .array(
      z.object({
        status: z.string(),
        error: z.string().nullable().optional(),
        stoppedAt: z.string().nullable().optional(),
        trace: z.string().nullable().optional(),
        traces: z.record(z.string(), z.string()).optional().describe('One trace per client, in a multi-client run')
      })
    )
    .optional(),
  steps: z.array(z.unknown()),
  stoppedAt: z.string().nullable().optional(),
  key: z.string().optional().describe('The same start and events give the same key in every run'),
  start: z.array(z.string()).optional().describe('The active states the path starts in'),
  seed: z.string().optional().describe('The seed that put the system in the start states; setup did when absent'),
  journeys: z.array(z.string()).optional().describe('The journeys this stretch belongs to'),
  durationMs: z.number().nonnegative().optional(),
  reusedFrom: z.string().optional().describe('The run this result was kept from')
});
export type PathRecord = z.infer<typeof PathRecordSchema>;

/** A journey's result, composed from the paths it is cut into (one per seeded stretch). */
export const JourneyRecordSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.union([RunStatusSchema, z.literal('not-run')]),
  paths: z.array(z.string()),
  stoppedAt: z.string().nullable().optional().describe('The first path that did not pass')
});
export type JourneyRecord = z.infer<typeof JourneyRecordSchema>;

/** A configuration the implementation can put the system in directly, and what checks it. */
export const SeedRecordSchema = z.object({
  name: z.string().min(1),
  at: z.array(z.string()).describe('The leaf states active after seeding'),
  how: z.string().nullable().optional(),
  blocked: z.string().optional(),
  paths: z.array(z.string()).describe('Paths that start from it'),
  verifiedBy: z.array(z.string()).describe('Passed paths that reached the same states through the steps, so results either side of it compose')
});
export type SeedRecord = z.infer<typeof SeedRecordSchema>;

/** Other formats the run wrote, relative to the manifest: JUnit XML, CTRF JSON, Mermaid. */
export const ReportsSchema = z.object({
  junit: z.string().optional(),
  ctrf: z.string().optional(),
  mermaid: z.string().optional()
});

export const PrivacySchema = z.object({
  passed: z.boolean(),
  findings: z.array(z.string())
});

/**
 * The top level of `runs/<run-id>/manifest.json`. Sections are `unknown` here so a reader can
 * validate each record on its own and keep the valid ones; the record schemas above are the
 * contract for each entry.
 */
export const ManifestEnvelopeSchema = z.object({
  schemaVersion: z.number().int().positive(),
  run: z.unknown(),
  charts: z.array(z.unknown()).optional(),
  map: z.object({ nodes: z.array(z.unknown()), edges: z.array(z.unknown()) }).partial().optional(),
  states: z.record(z.string(), z.unknown()).optional(),
  transitions: z.record(z.string(), z.unknown()).optional(),
  paths: z.array(z.unknown()).optional(),
  journeys: z.array(z.unknown()).optional(),
  seeds: z.array(z.unknown()).optional(),
  coverage: z.record(z.string(), z.object({ states: CountSchema, transitions: CountSchema }).partial()).optional(),
  privacy: z.unknown().optional(),
  reports: ReportsSchema.optional()
});
