/**
 * @module User state schema
 *
 * The one JSON document that holds everything a person using Atlas has chosen, as opposed to what an operator deployed:
 * the garbage collection policy and the saved server settings. The server keeps it in S3-compatible object storage
 * (`server/state.json` under the configured prefix) and nowhere else: not in a file, a database or the browser. A
 * document that does not exist yet means nothing has been chosen; a document that cannot be read is an error, never
 * an empty state. Unknown keys are kept, so an older server does not drop what a newer one wrote.
 *
 * @see docs/server.md#user-state-and-garbage-collection
 */
import { z } from 'zod/v4';

import { ServerEditableSettingsSchema } from './server-config';

/**
 * The garbage collection policy: which report layers the server may delete from S3, and when. Only layers that the
 * report has loaded and that no longer decide any result (every check they carry has since been superseded by a newer
 * layer) are ever candidates, and the newest `keepLatest` layers are always kept. With `enabled: false` nothing is deleted.
 */
export const GcPolicySchema = z.strictObject({
  enabled: z.boolean().describe('Delete eligible layers on a schedule. `false` keeps the policy but deletes nothing'),
  maxAgeDays: z.number().int().min(1).max(3650).describe('A superseded layer is eligible once it was recorded more than this many days ago'),
  keepLatest: z.number().int().min(0).max(1_000_000).default(20).describe('Always keep this many of the newest layers, however old, so recent history stays'),
  intervalHours: z.number().min(1).max(720).default(24).describe('How often the server applies the policy')
});
/** A garbage collection policy as stored, defaults applied. */
export type GcPolicy = z.output<typeof GcPolicySchema>;
/** A garbage collection policy as written, before defaults are applied. */
export type GcPolicyInput = z.input<typeof GcPolicySchema>;

/** What one pass of garbage collection found and did, for one project. */
export const GcRunSchema = z.looseObject({
  project: z.string(),
  dryRun: z.boolean(),
  at: z.string().describe('When the pass finished, ISO 8601'),
  candidates: z.number().int().min(0).describe('Layers the policy would delete'),
  deletedLayers: z.number().int().min(0),
  deletedBlobs: z.number().int().min(0),
  keptLayers: z.number().int().min(0),
  error: z.string().optional().describe('Why the pass stopped early, when it did')
});
/** One pass of garbage collection, see {@link GcRunSchema}. */
export type GcRun = z.output<typeof GcRunSchema>;

/** The user state document stored in S3. Both parts are optional: absent means "never chosen". */
export const UserStateSchema = z.looseObject({
  schemaVersion: z.literal(1),
  gc: GcPolicySchema.optional().describe('The garbage collection policy. Absent until someone saves one: then nothing is deleted'),
  settings: ServerEditableSettingsSchema.optional().describe('Report and live-run settings saved from the settings page, applied at the next start')
});
/** The user state document, see {@link UserStateSchema}. */
export type UserState = z.output<typeof UserStateSchema>;

/**
 * `GET /api/settings/gc` and `PUT /api/settings/gc`: the policy as saved in S3 (`null` when none has been saved), the
 * revision to send back in `If-Match`, and the result of the last pass this server ran.
 */
export const GcSnapshotSchema = z.looseObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  policy: GcPolicySchema.nullable(),
  saved: z.boolean().describe('Whether a policy exists in S3. `false` means garbage collection is off: nothing is deleted'),
  lastRuns: z.array(GcRunSchema).describe('The most recent pass over each project, newest first; empty before the first pass'),
  stateKey: z.string().describe('Where the user state lives in the bucket, relative to the configured prefix')
});
/** The garbage collection settings response, see {@link GcSnapshotSchema}. */
export type GcSnapshot = z.output<typeof GcSnapshotSchema>;

/** `POST /api/settings/gc/run`: the passes that ran, one per project. */
export const GcRunResultSchema = z.looseObject({ runs: z.array(GcRunSchema), policy: GcPolicySchema.nullable() });
