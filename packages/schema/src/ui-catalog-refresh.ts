/**
 * @module UI catalog refresh receipts
 *
 * A **refresh** is one run of collecting a UI catalog to a stated standard: a fixed definition version, an optional source
 * (commit and branch), the profiles it covers (`where`), a freshness cutoff (`staleBeforeMs`) and a collection id that its
 * shards claim under (so retry limits are counted per refresh). A shard's `collectCatalog` result (`stoppedBy: empty`) is only
 * that shard's view; the **refresh status** a server answers is the whole: whether every unit in scope has evidence that
 * satisfies the refresh's policy, which units are still outstanding and why, and, separately, how the workers fared.
 *
 * The receipt lives in the server's store beside the queue (`server/ui-catalog/refreshes/<id>.json`). Beginning the same
 * refresh again (a rerun CI attempt) joins it rather than starting another, and every attempt that joins is recorded under
 * its own name. None of these documents is part of the layer format: evidence is still ordinary `ui-state` layers. Within
 * this version only optional fields are added.
 *
 * @see docs/ui-catalog.md#refreshes-finalizing-a-collection
 */
import { z } from 'zod/v4';

/** The `schemaVersion` of a refresh receipt and a refresh status. */
export const UI_CATALOG_REFRESH_VERSION = 1;

const Name = z.string().min(1).max(200);
const Count = z.number().int().nonnegative();
const Where = z.record(Name, z.array(Name).min(1));

/** A refresh id: letters, digits, `.`, `_` and `-`, starting with a letter or digit (a CI run id fits). */
export const UiRefreshIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, 'a refresh id is 1–128 letters, digits, ".", "_" or "-", starting with a letter or digit');

/** What a refresh is pinned to, as `PUT /api/ui-catalog/refreshes/{id}` takes it. Fields left out of a repeated begin keep their stored values. */
export const UiRefreshRequestSchema = z.strictObject({
  definition: z.string().regex(/^[a-f0-9]{64}$/).describe('The version of a published definition'),
  collection: Name.optional().describe('What its shards claim under, so retry limits are counted per refresh. Default: the refresh id'),
  source: z.strictObject({
    sha: z.string().min(1).max(200).nullable().optional(), branch: z.string().min(1).max(500).nullable().optional(),
    require: z.boolean().optional().describe('Only evidence recorded at this commit satisfies the refresh. Default false: the source is provenance')
  }).optional(),
  where: Where.optional().describe('The profiles in scope: only units whose every item has one of these values in each named dimension'),
  staleBeforeMs: z.number().int().nonnegative().optional().describe('Only evidence recorded at or after this time satisfies the refresh. Default: when it began'),
  participants: z.array(Name).max(1000).optional().describe('Optional names of the jobs expected to join, to diagnose one that never started. Never required for elastic workers')
});

/** One attempt that joined a refresh: a participant (a CI job, a laptop) and its attempt number, and the shard id it claims as. */
export const UiRefreshAttemptSchema = z.looseObject({
  participant: z.string(), attempt: z.string(), shard: z.string().describe('`<participant>#<attempt>`: what its claims and layers are labelled with'),
  joinedAtMs: z.number(), lastSeenAtMs: z.number()
});

/** The outcome of a refresh: `complete` (every unit in scope satisfied), `incomplete` (work remains), `failed` (work remains that the queue will not hand out again), `unknown` (it could not be read). */
export const UiRefreshOutcomeSchema = z.enum(['complete', 'incomplete', 'failed', 'unknown']);

/** A refresh receipt as it is stored. */
export const UiRefreshReceiptSchema = z.looseObject({
  schemaVersion: z.literal(UI_CATALOG_REFRESH_VERSION),
  id: z.string(), definition: z.string(), collection: z.string(),
  source: z.looseObject({ sha: z.string().nullable(), branch: z.string().nullable(), require: z.boolean() }),
  where: Where.nullable(), staleBeforeMs: z.number(), participants: z.array(z.string()), createdAtMs: z.number(),
  attempts: z.array(UiRefreshAttemptSchema).describe('Every attempt that joined, in order (at most 1000)'),
  finalizations: z.array(z.looseObject({ atMs: z.number(), outcome: UiRefreshOutcomeSchema, attempt: z.string().nullable() })).describe('Each finalization, newest last (at most 100)')
});

/** Why a unit in scope is not satisfied yet. */
export const UiRefreshReasonSchema = z.enum(['held', 'pending', 'failed', 'stale', 'source', 'exhausted', 'unknown']);

/** `GET /api/ui-catalog/refreshes/{id}` and `POST …/finalize`: whether a refresh is complete, what is outstanding, and how its workers fared. */
export const UiRefreshStatusSchema = z.looseObject({
  schemaVersion: z.literal(UI_CATALOG_REFRESH_VERSION),
  ok: z.boolean().describe('True only when `outcome` is `complete`'),
  outcome: UiRefreshOutcomeSchema,
  refresh: UiRefreshReceiptSchema.nullable().describe('Null when the receipt itself could not be read'),
  capture: z.looseObject({
    units: Count.describe('Units in scope'), satisfied: Count,
    held: Count.describe('Held by a live claim: a shard is still working on them'),
    pending: Count.describe('Never captured (or only skipped) and claimable'),
    failed: Count.describe('Their latest capture failed; below the retry limit, so claimable again'),
    stale: Count.describe('Captured only before the cutoff; claimable as stale'),
    source: Count.describe('Captured after the cutoff at another commit while the source is required'),
    exhausted: Count.describe('Failed `maxAttempts` times within the refresh\'s collection: the queue will not hand them out again'),
    unknown: Count.describe('No readable result while a backend or layer could not be read')
  }),
  outstanding: z.array(z.looseObject({
    unit: z.string(), reason: UiRefreshReasonSchema, items: Count,
    claimId: z.string().optional(), shard: z.string().optional(), expiresAtMs: z.number().optional(), attempts: Count.optional()
  })).describe('The units not satisfied, most actionable first (at most 200)'),
  health: z.looseObject({
    status: z.enum(['healthy', 'degraded', 'unknown']).describe('Worker and infrastructure health, separate from capture completeness'),
    expected: z.array(z.string()), missing: z.array(z.string()).describe('Expected participants with no attempt joined'),
    attempts: z.array(UiRefreshAttemptSchema.extend({ status: z.enum(['active', 'idle', 'lost', 'unseen']) })),
    lost: z.array(z.string()).describe('Shards of this refresh whose last claim expired'),
    notices: z.array(z.string())
  }),
  reasons: z.array(z.string()).describe('The outcome, in sentences'),
  time: z.number()
});

/** What a shard sends to join a refresh. */
export const UiRefreshJoinSchema = z.strictObject({ participant: Name, attempt: z.string().min(1).max(100).default('1') });

/** A refresh request. */
export type UiRefreshRequest = z.input<typeof UiRefreshRequestSchema>;
/** A stored refresh receipt. */
export type UiRefreshReceipt = z.output<typeof UiRefreshReceiptSchema>;
/** A refresh status. */
export type UiRefreshStatus = z.output<typeof UiRefreshStatusSchema>;
/** A refresh outcome. */
export type UiRefreshOutcome = z.output<typeof UiRefreshOutcomeSchema>;
