/**
 * @module The `atlas.critique` evidence schema
 *
 * What an automated reviewer (a critic) says about one captured UI. It is not a new layer format: a critique is a
 * check inside a part of kind `critique`, and the opinion rides in the check's `extensions["atlas.critique"]`, so by the
 * rules of docs/extending.md it can never decide a result. The check's `status` says only whether the critic ran
 * (`passed` a verdict was produced, `failed` the critic could not produce one, `running`, `not-run`).
 *
 * Everything except `schema`, `subject` and `critic` is optional, so a single score (a model-based critic) and rich
 * findings (an LLM critic) are one shape. Every object is open, and `kind`, `category`, `severity`, `label` and `reason`
 * are open strings: a value nobody has heard of is kept and shown generically, never rejected. A reader that cannot read
 * the whole extension drops it and keeps the check and its status (`readCritique` in `@crvouga/atlas/critics`).
 *
 * @see docs/critics.md
 * @see docs/extending.md
 */
import { z } from 'zod/v4';

/** The key under which a critique is stored in a check's `extensions`. */
export const CRITIQUE_EXTENSION = 'atlas.critique';
/** The version of the `atlas.critique` extension a reader of this release understands. A critique of another version is unknown, not wrong. */
export const CRITIQUE_SCHEMA_VERSION = 1;
/** The `kind` of the report part that holds critiques. Parts of this kind are opinions: never counted, never part of the gate. */
export const CRITIQUE_PART_KIND = 'critique';
/** The prefix of the `producer` of a layer of critiques: `critic.<critic name>`. */
export const CRITIC_PRODUCER_PREFIX = 'critic.';

/** The region of the image a finding is about, in the stated unit (`px` of the stored image, or `normalized` 0..1). */
export const CritiqueRegionSchema = z.looseObject({
  unit: z.string().min(1).describe('`px` (pixels of the stored image) or `normalized` (0..1 of its width and height). Open vocabulary'),
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative()
});

/** One thing a critic found: where, what kind, how bad, why, and what to do. Nothing is required. */
export const CritiqueFindingSchema = z.looseObject({
  id: z.string().min(1).optional().describe('Stable within the critique, so a reviewer can mark this finding valid or not'),
  category: z.string().min(1).optional().describe('Open vocabulary: `spacing`, `contrast`, `alignment`, `overflow`, `hierarchy`…'),
  severity: z.string().min(1).optional().describe('Open vocabulary, conventionally `info`, `minor`, `major`'),
  confidence: z.number().min(0).max(1).optional(),
  region: CritiqueRegionSchema.optional(),
  rationale: z.string().optional(),
  suggestion: z.string().optional()
});

/**
 * How a score reads in context. A raw score is not absolute: a loading overlay is compared with other loading overlays,
 * not with full screens, and a change against the same entry's previous image is more telling than the level.
 */
export const CritiqueRelativeSchema = z.looseObject({
  stateKind: z.string().min(1).describe('The kind of UI state the score is relative to: `screen`, `overlay`, `loading`, `error`, `empty`…'),
  percentile: z.number().min(0).max(100).optional().describe('Where the score falls among the project\'s scores of the same state kind, 0..100, higher is better'),
  sampleSize: z.number().int().nonnegative().optional().describe('How many scores of that state kind the percentile is over'),
  previousScore: z.number().optional().describe('The same entry\'s score for its previous image, from the same critic'),
  delta: z.number().optional().describe('`score` minus `previousScore`')
});

/** The judgement: a score and how to read it, a label, a confidence. A critic that cannot score may give only a label. */
export const CritiqueVerdictSchema = z.looseObject({
  score: z.number().optional().describe('A finite number. `scale` says what it means'),
  scale: z.string().optional().describe('For example `0..1, higher is better`'),
  label: z.string().optional().describe('Open vocabulary, conventionally `ok` or `needs-polish`'),
  confidence: z.number().min(0).max(1).optional(),
  relative: CritiqueRelativeSchema.optional()
});

/** Why a critic produced no verdict: a reason code in an open vocabulary (`error`, `timeout`, `rate-limited`, `invalid-output`) and a message that holds no credential. */
export const CritiqueFailureSchema = z.looseObject({
  reason: z.string().min(1),
  message: z.string().optional()
});

/**
 * The `atlas.critique` extension, version 1: the image judged (`subject`), who judged (`critic`, `model`,
 * `parameters`), the opinion (`verdict`, `findings`) or why there is none (`failure`), and what it cost (`usage`).
 * The prompt is recorded only as a hash (`parameters.rubric`). Emitted as `critique.schema.json`.
 */
export const CritiqueSchema = z.looseObject({
  schema: z.number().int().positive().describe('The version of this extension. 1'),
  subject: z.looseObject({
    entryKey: z.string().min(1).describe('The catalog entry that was judged'),
    imageSha256: z.string().min(1).describe('The hash of the exact image bytes that were judged. When the entry\'s image changes, this critique judged an earlier image'),
    state: z.string().min(1).optional().describe('The kind of UI state: `screen`, `overlay`, `loading`, `error`, `empty`…')
  }),
  critic: z.looseObject({
    name: z.string().min(1),
    version: z.string().min(1).describe('Of the critic\'s own logic. A newer version replaces an older one'),
    kind: z.string().min(1).optional().describe('Open vocabulary: `model`, `llm`, `ml`, `heuristic`…')
  }),
  model: z.looseObject({ id: z.string().min(1), provider: z.string().optional() }).optional(),
  parameters: z.record(z.string(), z.unknown()).optional().describe('Everything else that explains the result: temperature, seed, the SHA-256 of the rubric'),
  verdict: CritiqueVerdictSchema.optional(),
  findings: z.array(CritiqueFindingSchema).optional(),
  failure: CritiqueFailureSchema.optional(),
  usage: z.looseObject({
    inputTokens: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative().optional(),
    latencyMs: z.number().nonnegative().optional(),
    costUsd: z.number().nonnegative().optional()
  }).optional()
});

/** A critique as stored in a check's `extensions["atlas.critique"]`. */
export type Critique = z.output<typeof CritiqueSchema>;
/** One finding of a critique. */
export type CritiqueFinding = z.output<typeof CritiqueFindingSchema>;
