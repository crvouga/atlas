/**
 * @module UI catalog shard bundles
 *
 * A **bundle** is a folder a collecting shard writes as it goes: a directory store (`store/`) holding its capture layers (and
 * the definition's plan layers) in Atlas's ordinary layer format, and a manifest (`atlas-bundle.json`) naming who wrote it
 * (definition, source, refresh, shard and attempt), each capture with whether it reached the server, and the SHA-256 and size
 * of every object in the store. It survives a server that stopped answering, travels as a CI artifact, and is validated,
 * merged and imported later. It is not a second report format: the layers in it are the layers a server would have
 * received. Within this version only optional fields are added.
 *
 * @see docs/ui-catalog.md#capture-journals-and-shard-bundles
 */
import { z } from 'zod/v4';

/** The `schemaVersion` of a bundle manifest. */
export const UI_CATALOG_BUNDLE_VERSION = 1;
/** The name of the manifest file at a bundle's root. */
export const UI_CATALOG_BUNDLE_MANIFEST = 'atlas-bundle.json';

const Count = z.number().int().nonnegative();
const Hex64 = z.string().regex(/^[a-f0-9]{64}$/);

/** Whether a capture reached the server: `published`, `failed` (the publish was attempted and failed) or `pending` (never sent: the shard stopped, or lost its claim). */
export const UiBundlePublicationSchema = z.enum(['pending', 'published', 'failed']);

/** One attempt that wrote into a bundle (a merged bundle has several). */
export const UiBundleAttemptSchema = z.looseObject({ shard: z.string(), participant: z.string(), attempt: z.string(), startedAtMs: z.number() });

/** One capture layer in a bundle, with the attempt that made it and whether it reached the server. */
export const UiBundleCaptureSchema = z.looseObject({
  layer: Hex64, recordedAtMs: z.number(), shard: z.string(), participant: z.string(), attempt: z.string(),
  claimId: z.string().nullable(), units: z.array(z.string()), items: Count, failed: Count,
  publication: UiBundlePublicationSchema, error: z.string().optional()
});

/** `atlas-bundle.json`. */
export const UiBundleManifestSchema = z.looseObject({
  schemaVersion: z.literal(UI_CATALOG_BUNDLE_VERSION),
  kind: z.literal('atlas-ui-catalog-bundle'),
  definition: z.looseObject({ version: Hex64, name: z.string() }).nullable().describe('Null until the shard knew its definition'),
  refresh: z.string().nullable(), collection: z.string().nullable(),
  source: z.looseObject({ sha: z.string().nullable(), branch: z.string().nullable() }),
  attempts: z.array(UiBundleAttemptSchema),
  plans: z.array(z.looseObject({ layer: Hex64, recordedAtMs: z.number() })).describe('The definition\'s plan layers, so an offline export expects every item'),
  captures: z.array(UiBundleCaptureSchema),
  objects: z.array(z.looseObject({ path: z.string(), sha256: Hex64, bytes: Count })).describe('Every object in `store/`, by its key there'),
  updatedAtMs: z.number()
});

/** A problem found in a bundle. */
export const UiBundleProblemSchema = z.looseObject({
  code: z.enum(['manifest', 'unsafe-path', 'missing', 'digest', 'unlisted', 'layer', 'incompatible']),
  bundle: z.string(), path: z.string().optional(), message: z.string()
});

/** A bundle manifest. */
export type UiBundleManifest = z.output<typeof UiBundleManifestSchema>;
/** One capture of a bundle. */
export type UiBundleCapture = z.output<typeof UiBundleCaptureSchema>;
/** A bundle problem. */
export type UiBundleProblem = z.output<typeof UiBundleProblemSchema>;
/** A capture's publication status. */
export type UiBundlePublication = z.output<typeof UiBundlePublicationSchema>;
