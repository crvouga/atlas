/**
 * @module Statechart spec schemas
 *
 * Zod schemas for the files in a specs directory: the `meta` a chart's states carry, XState-style machine configs,
 * `journeys.yaml`, the optional product map `atlas.yaml`, `<chart>.layout.json` and `specs/index.json`, plus the
 * filename patterns that identify statechart files. They describe what a person writes, so readers validate each
 * piece on its own and report problems rather than rejecting the whole spec (the visualizer's `parse/spec.ts` does).
 * The pure subset of statecharts that Atlas executes is documented in `docs/statecharts.md`.
 *
 * @see docs/statecharts.md
 */
import { z } from 'zod/v4';

import { ConfidenceSchema, EventKindSchema } from './common.js';

/**
 * Version of the spec file formats, currently 1. `LayoutFileSchema` and `SpecIndexSchema` accept only `schemaVersion:
 * 1`.
 */
export const SPEC_SCHEMA_VERSION = 1;

/**
 * A state's link to its design: an image (URL or spec-relative path), and optionally where the design lives, such as
 * a Figma frame.
 */
export const DesignLinkSchema = z.object({
  image: z.string().min(1).describe('URL or spec-relative path of a design frame'),
  url: z.string().optional().describe('Where the design lives, for example a Figma frame link'),
  label: z.string().optional()
});
/** A parsed `DesignLinkSchema` value. */
export type DesignLink = z.infer<typeof DesignLinkSchema>;

/** One Given/When/Then line of a business contract: the keyword, its text, and an optional data table or doc string. */
export const ContractStepSchema = z.object({
  keyword: z.string().min(1),
  text: z.string(),
  table: z.array(z.array(z.string())).optional(),
  docString: z.string().optional()
});
/**
 * A business rule copied from its authoritative `source` as exact Given/When/Then steps, carried in a state's
 * `meta.contracts`.
 */
export const BusinessContractSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(ContractStepSchema)
});
/** A parsed `BusinessContractSchema` value. */
export type BusinessContract = z.infer<typeof BusinessContractSchema>;

/**
 * Every field a state's `meta` may carry. Each one is optional on its own: the visualizer keeps
 * the fields that parse and reports the ones that don't.
 */
export const StateMetaShape = {
  description: z.string(),
  snapshot: z.string(),
  events: z.array(z.string()).describe('Business events that happen on entering the state'),
  confidence: ConfidenceSchema,
  source: z.array(z.string()),
  checks: z.array(z.string()),
  childMachine: z.string(),
  childFinalEvents: z.record(z.string(), z.string()),
  deadEnd: z.string(),
  owner: z.string(),
  tier: z.string(),
  quint: z.string().describe('Quint model reference'),
  gherkin: z.array(z.string()).describe('Feature files or scenarios that cover the state'),
  contracts: z.array(BusinessContractSchema).describe('Business rules and their exact Given/When/Then examples, copied from the authoritative source'),
  design: DesignLinkSchema,
  hints: z.array(z.string()).describe('What the screen shows, for the placeholder sketch'),
  eventKinds: z
    .record(z.string(), EventKindSchema)
    .describe('Chart-level: who or what sends each event; overrides the runner and the guess'),
  timeEvents: z
    .record(z.string(), z.string())
    .describe('Chart-level: time events and the span each one jumps, for example "5 minutes"')
} as const;

/** `StateMetaShape` with every field optional: the `meta` of a state or of a whole chart. */
export const StateMetaSchema = z.object(StateMetaShape).partial();
/** A parsed `StateMetaSchema` value. */
export type StateMeta = z.infer<typeof StateMetaSchema>;

/** The target of an event transition: a state name (or `#id`) written as a string, or an object with `target`. */
export const TransitionTargetSchema = z.union([
  z.string().min(1),
  z.object({ target: z.string().min(1) })
]);

/** Kinds of state in the composed map: `atomic`, `compound`, `parallel`, `final`. */
export const STATE_TYPES = ['atomic', 'compound', 'parallel', 'final'] as const;
/** One of `STATE_TYPES`. */
export type StateType = (typeof STATE_TYPES)[number];

/**
 * TypeScript shape of one state of a machine config, matching `StateNodeSchema`: optional `id`, `initial`, `type`
 * (`parallel` or `final`), `meta`, nested `states` and `on` transitions.
 */
export type StateNodeConfig = {
  id?: string | undefined;
  initial?: string | undefined;
  type?: 'parallel' | 'final' | undefined;
  meta?: StateMeta | undefined;
  states?: Record<string, StateNodeConfig> | undefined;
  on?: Record<string, z.infer<typeof TransitionTargetSchema>> | undefined;
};

/**
 * One state of an XState machine config, recursively, restricted to what Atlas reads: nesting, `parallel` and `final`
 * types, event transitions and `meta`. Guards, actions and the rest of XState are rejected by `atlas lint`, not by
 * this schema. Emitted as `state-node.schema.json`.
 */
export const StateNodeSchema: z.ZodType<StateNodeConfig> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    initial: z.string().optional(),
    type: z.enum(['parallel', 'final']).optional(),
    meta: StateMetaSchema.optional(),
    states: z.record(z.string(), StateNodeSchema).optional(),
    on: z.record(z.string(), TransitionTargetSchema).optional()
  })
);

/**
 * A whole chart: its `id`, optional `initial`, `type` and `meta`, and its `states`. The states are `unknown` here;
 * validate each with `StateNodeSchema`.
 */
export const MachineSchema = z.object({
  id: z.string().min(1),
  initial: z.string().optional(),
  type: z.enum(['parallel']).optional(),
  meta: StateMetaSchema.optional(),
  states: z.record(z.string(), z.unknown())
});

/**
 * One curated journey in `journeys.yaml`: the business events replayed in order from the initial state, the states it
 * must end in, and an optional owner and tour flag. `atlas lint` replays every journey, and `atlas run` runs each as
 * its own path.
 */
export const JourneySchema = z.object({
  description: z.string().optional(),
  events: z.array(z.string()),
  endsIn: z.array(z.string()).optional(),
  owner: z.string().optional(),
  tour: z.boolean().optional().describe('Include in the guided tour')
});
/** A parsed `JourneySchema` value. */
export type JourneyConfig = z.infer<typeof JourneySchema>;

/**
 * `journeys.yaml`: a `journeys` map from journey name to journey. The entries are `unknown` here; validate each with
 * `JourneySchema`.
 */
export const JourneysFileSchema = z.object({
  journeys: z.record(z.string(), z.unknown())
});

/**
 * A product area declared in `atlas.yaml`: its id, display name, description, owner and the spec-relative directories
 * whose charts belong to it.
 */
export const AtlasContextSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  owner: z.string().optional(),
  directories: z.array(z.string()).optional().describe('Spec-relative directories holding its charts')
});

/**
 * A hand-off declared in `atlas.yaml` between two product areas: the ids of the area it `from` and `to`, and the
 * event that passes control.
 */
export const AtlasHandOffSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  event: z.string().min(1),
  description: z.string().optional()
});

/**
 * `atlas.yaml` at the specs root: the product map. Optional; without it every directory holding a
 * chart becomes a context named after its first path segment.
 */
export const AtlasFileSchema = z.object({
  schemaVersion: z.number().int().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  contexts: z.array(z.unknown()).optional(),
  handOffs: z.array(z.unknown()).optional(),
  excluded: z.array(z.string()).optional()
});

/** `<chart>.layout.json` beside a chart: a hand-tuned layout the visualizer respects. */
export const LayoutFileSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
  sizes: z.record(z.string(), z.object({ width: z.number(), height: z.number() })).optional()
});
/** A parsed `LayoutFileSchema` value. */
export type LayoutFile = z.infer<typeof LayoutFileSchema>;

/**
 * `specs/index.json`: the statechart files under the specs root, so a static host can serve the
 * spec without directory listings. `ref` names the branch or commit the files came from.
 */
export const SpecIndexSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  ref: z.string().nullable().optional(),
  files: z.array(z.string())
});
/** A parsed `SpecIndexSchema` value. */
export type SpecIndex = z.infer<typeof SpecIndexSchema>;

/**
 * Patterns for the paths of statechart spec files: `atlas.yaml`, `machine.yaml|json` and `*.machine.yaml|json`,
 * `*.scxml`, `journeys.yaml`, `known-issues.md`, `open-questions.md` and `*.layout.json`, in any directory.
 */
export const STATECHART_FILE_PATTERNS = [
  /(^|\/)atlas\.ya?ml$/,
  /(^|\/)([\w.-]+\.)?machine\.(ya?ml|json)$/,
  /(^|\/)[\w.-]+\.scxml$/,
  /(^|\/)journeys\.ya?ml$/,
  /(^|\/)known-issues\.md$/,
  /(^|\/)open-questions\.md$/,
  /(^|\/)[\w.-]+\.layout\.json$/
];

/** Whether a spec-relative path (using `/`) matches `STATECHART_FILE_PATTERNS`. */
export function isStatechartFile(path: string) {
  return STATECHART_FILE_PATTERNS.some((pattern) => pattern.test(path));
}
