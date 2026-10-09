import { z } from 'zod/v4';

import { ConfidenceSchema, EventKindSchema } from './common';

export const SPEC_SCHEMA_VERSION = 1;

export const DesignLinkSchema = z.object({
  image: z.string().min(1).describe('URL or spec-relative path of a design frame'),
  url: z.string().optional().describe('Where the design lives, for example a Figma frame link'),
  label: z.string().optional()
});
export type DesignLink = z.infer<typeof DesignLinkSchema>;

export const ContractStepSchema = z.object({
  keyword: z.string().min(1),
  text: z.string(),
  table: z.array(z.array(z.string())).optional(),
  docString: z.string().optional()
});
export const BusinessContractSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(ContractStepSchema)
});
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

export const StateMetaSchema = z.object(StateMetaShape).partial();
export type StateMeta = z.infer<typeof StateMetaSchema>;

export const TransitionTargetSchema = z.union([
  z.string().min(1),
  z.object({ target: z.string().min(1) })
]);

export const STATE_TYPES = ['atomic', 'compound', 'parallel', 'final'] as const;
export type StateType = (typeof STATE_TYPES)[number];

export type StateNodeConfig = {
  id?: string;
  initial?: string;
  type?: 'parallel' | 'final';
  meta?: StateMeta;
  states?: Record<string, StateNodeConfig>;
  on?: Record<string, z.infer<typeof TransitionTargetSchema>>;
};

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

export const MachineSchema = z.object({
  id: z.string().min(1),
  initial: z.string().optional(),
  type: z.enum(['parallel']).optional(),
  meta: StateMetaSchema.optional(),
  states: z.record(z.string(), z.unknown())
});

export const JourneySchema = z.object({
  description: z.string().optional(),
  events: z.array(z.string()),
  endsIn: z.array(z.string()).optional(),
  owner: z.string().optional(),
  tour: z.boolean().optional().describe('Include in the guided tour')
});
export type JourneyConfig = z.infer<typeof JourneySchema>;

export const JourneysFileSchema = z.object({
  journeys: z.record(z.string(), z.unknown())
});

export const AtlasContextSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  owner: z.string().optional(),
  directories: z.array(z.string()).optional().describe('Spec-relative directories holding its charts')
});

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
export type SpecIndex = z.infer<typeof SpecIndexSchema>;

export const STATECHART_FILE_PATTERNS = [
  /(^|\/)atlas\.ya?ml$/,
  /(^|\/)([\w.-]+\.)?machine\.(ya?ml|json)$/,
  /(^|\/)[\w.-]+\.scxml$/,
  /(^|\/)journeys\.ya?ml$/,
  /(^|\/)known-issues\.md$/,
  /(^|\/)open-questions\.md$/,
  /(^|\/)[\w.-]+\.layout\.json$/
];

export function isStatechartFile(path: string) {
  return STATECHART_FILE_PATTERNS.some((pattern) => pattern.test(path));
}
