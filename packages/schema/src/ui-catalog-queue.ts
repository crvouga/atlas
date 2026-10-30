/**
 * @module UI catalog collection queue protocol
 *
 * The documents a server and its collecting shards exchange to share out the collection of a UI catalog: a **definition**
 * (the states, the profile matrix the project declares and how items group into work units, resolved and content-addressed),
 * a **claim** (a time-limited lease on a batch of work units, handed out in priority order) and the **queue summary** a viewer
 * shows. None of them is part of the layer format: results still travel as ordinary `ui-state` layers, and a definition
 * becomes ordinary `ui-plan` layers when it is published. Within this version only optional fields are added.
 *
 * @see docs/ui-catalog.md#collecting-with-a-queue
 */
import { z } from 'zod/v4';

/** The `schemaVersion` of a stored definition, a claim and a queue summary. */
export const UI_CATALOG_QUEUE_VERSION = 1;

const Name = z.string().min(1).max(200);
const Text = z.string().max(2048);

/** One value of a dimension, with what it contributes to the profile: an `environment` and extra `parameters`. */
export const UiDimensionValueSchema = z.strictObject({
  value: Name,
  environment: Name.optional().describe('The client this value sets (`mobile-web`…). At most one dimension may set it for any profile'),
  parameters: z.record(Name, Text).default({}).describe('Extra profile parameters this value contributes (`{ "viewport": "390x844" }`)')
});

/** A dimension of the profile matrix: a name the project chose, and its values. Atlas has no built-in names. */
export const UiDimensionSchema = z.strictObject({ name: Name, values: z.array(UiDimensionValueSchema).min(1).max(1000) });

/** A state the catalog should contain, with the facts declared about it (as in a `ui-plan` entry). */
export const UiDefinitionStateSchema = z.strictObject({
  id: z.string().min(1).max(16384), title: Text.optional(),
  route: Text.optional(), fixture: Text.optional(), cohort: Text.optional(), area: Text.optional(), kind: Text.optional(),
  flags: z.array(Text).max(64).optional(), covers: z.array(Text).max(64).optional()
});

/**
 * A catalog definition as it is stored and exchanged: every async part already resolved, so every shard sees the same matrix.
 * Its version is the SHA-256 of its canonical JSON, so the same definition is the same version wherever it is resolved.
 */
export const UiCatalogDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(UI_CATALOG_QUEUE_VERSION),
  name: Name.describe('The catalog. Its plan layers are published as the producer `ui-catalog:<name>`'),
  dimensions: z.array(UiDimensionSchema).max(16).describe('The profile matrix, in the order the project declared it. Every combination of values is a profile'),
  exclude: z.array(z.record(Name, Name)).max(1000).default([]).describe('Combinations no item is expected for, each a partial match on dimension values'),
  states: z.array(UiDefinitionStateSchema).max(200_000),
  inventory: z.array(z.strictObject({ id: z.string().min(1).max(16384), title: Text.optional() })).max(100_000).default([]).describe('Surfaces of the product, as `inventory: true` plan entries'),
  groups: z.array(z.string().min(1).max(4096)).optional().describe('The work unit of every item, state by state and profile by profile. Absent: every item is its own unit'),
  options: z.strictObject({
    maxAttempts: z.number().int().min(1).max(100).default(3).describe('A unit whose capture failed this many times in a row within one collection is no longer handed out in it'),
    staleAfterMs: z.number().int().positive().optional().describe('A captured item is handed out again once its result is older than this. Absent: only when a claim names `staleBeforeMs`')
  }).default({ maxAttempts: 3 })
});

/** The tiers of the queue, most urgent first. `fresh` is captured and not due; it is never handed out. */
export const UiQueueTierSchema = z.enum(['failed', 'empty', 'unknown', 'stale', 'fresh']);

/** What a shard asks for: a batch of work units of one definition, optionally narrowed to some dimension values. */
export const UiClaimRequestSchema = z.strictObject({
  shard: Name.describe('Who is asking, for people: a machine, a CI job. Shards need not know each other'),
  definition: z.string().regex(/^[a-f0-9]{64}$/).describe('The version of a published definition'),
  batchSize: z.number().int().min(1).max(500).default(25),
  where: z.record(Name, z.array(Name).min(1)).optional().describe('Only units whose every item has one of these values in each named dimension'),
  leaseSeconds: z.number().int().min(10).max(3600).default(120),
  collection: Name.optional().describe('What retry limits are counted in (a CI run id). Default: the definition version'),
  staleBeforeMs: z.number().int().nonnegative().optional().describe('Hand out captured items whose result was recorded before this time, oldest first'),
  idempotencyKey: z.string().min(1).max(200).optional().describe('Retrying with the same key returns the same claim, never a second batch')
});

/** One profile of the matrix: the dimension values, and the environment and parameters a result is recorded under. */
export const UiQueueProfileSchema = z.looseObject({
  key: z.string().describe('As a UI catalog profile key: the environment and the sorted parameters'),
  values: z.record(z.string(), z.string()), environment: z.string().nullable(), parameters: z.record(z.string(), z.string())
});

/** One item of a claimed unit: a state in a profile. */
export const UiQueueItemSchema = z.looseObject({ key: z.string(), state: UiDefinitionStateSchema, profile: UiQueueProfileSchema });

/** A claim: the work units a shard holds until `expiresAtMs`, renewed by heartbeat. */
export const UiClaimSchema = z.looseObject({
  schemaVersion: z.literal(UI_CATALOG_QUEUE_VERSION),
  claimId: z.string(), shard: z.string(), definition: z.string(), collection: z.string(),
  createdAtMs: z.number(), expiresAtMs: z.number(), leaseSeconds: z.number().int(),
  units: z.array(z.looseObject({ key: z.string(), tier: UiQueueTierSchema, items: z.array(UiQueueItemSchema) }))
});

const Count = z.number().int().nonnegative();

/** `GET /api/ui-catalog/queue`: what is left to collect, who is collecting it, and how fast. */
export const UiQueueSummarySchema = z.looseObject({
  schemaVersion: z.literal(UI_CATALOG_QUEUE_VERSION),
  definition: z.looseObject({ version: z.string(), name: z.string(), states: Count, profiles: Count, items: Count, units: Count }).nullable().describe('Null until a definition is published'),
  tiers: z.record(UiQueueTierSchema, Count).describe('Units by tier. A unit held by a claim is counted in `held`, not here'),
  held: Count, exhausted: z.array(z.looseObject({ unit: z.string(), attempts: Count, collection: z.string() })).describe('Units that hit the retry limit (at most 100)'),
  requeued: Count.describe('Units that failed, are below the retry limit and are back in the queue'),
  unknown: z.looseObject({ count: Count, units: z.array(z.string()).describe('At most 50'), notices: z.array(z.string()) }).describe('Units with no readable result while a backend or layer could not be read: not empty, unknown'),
  claims: z.array(z.looseObject({ claimId: z.string(), shard: z.string(), units: Count, done: Count, createdAtMs: z.number(), expiresAtMs: z.number(), ageMs: z.number() })),
  shards: z.array(z.looseObject({ shard: z.string(), status: z.enum(['active', 'idle', 'lost']), claims: Count, units: Count, done: Count, failed: Count, lastSeenAtMs: z.number() })),
  throughput: z.looseObject({ unitsPerMinute: z.number().nonnegative().describe('Units finished per minute over the last ten minutes'), etaMs: z.number().nonnegative().nullable().describe('Due units divided by throughput; null when nothing finished lately') }),
  time: z.number()
});

/** A stored, resolved definition. */
export type UiCatalogDefinitionDocument = z.output<typeof UiCatalogDefinitionSchema>;
/** A claim request as a shard sends it. */
export type UiClaimRequest = z.input<typeof UiClaimRequestSchema>;
/** A claim as the server answers it. */
export type UiClaim = z.output<typeof UiClaimSchema>;
/** A queue tier. */
export type UiQueueTier = z.output<typeof UiQueueTierSchema>;
/** The queue summary. */
export type UiQueueSummary = z.output<typeof UiQueueSummarySchema>;
