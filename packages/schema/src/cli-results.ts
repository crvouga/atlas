/**
 * @module Command results (`--format json`)
 *
 * What `atlas report publish`, `stream`, `merge`, `doctor` and `verify-recordings`, and `atlas ui-catalog plan`, `publish`, `status`, `diff` and `export`, print on standard output with `--format json` (alias
 * `--json`), and what any `atlas` command prints on standard error for a command that was wrong: one JSON document,
 * so an agent or a script never has to parse prose. (`status` and `policy` already print documents:
 * `ReportStatusSchema`, and an IAM policy.) Each is also published as a JSON Schema.
 *
 * Exit codes are the same with and without `--format json`: `0` it worked, `1` it ran and the answer is no (a
 * report that does not pass, a store that needs attention, checks that could not be sent), `2` the command itself
 * was wrong (a missing flag, a path that does not exist). Within a version these only gain optional fields.
 *
 * @see docs/agents.md
 */
import { z } from 'zod/v4';
import { RecordingReceiptSchema, ReportStatusSchema } from './layer';

/** What was written for one layer by `atlas report publish`. */
export const PublishedLayerSchema = z.looseObject({
  id: z.string().describe('The layer id: 64 hex digits, the SHA-256 of its content. Publishing the same input again gives the same id'),
  producer: z.string(),
  environment: z.string().nullable(),
  checks: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  notRun: z.number().int().nonnegative().describe('Skipped, pending or otherwise not run'),
  linkedToSpec: z.number().int().nonnegative().describe('Checks that were matched to a spec file. The rest still count, but belong to no spec'),
  freshness: z.enum(['modified', 'unknown']).optional().describe('Set when the checkout had uncommitted changes (`modified`) or no git origin (`unknown`)'),
  attachmentFiles: z.number().int().nonnegative(),
  attachmentBytes: z.number().int().nonnegative(),
  recordings: RecordingReceiptSchema.optional().describe('Present when a check declared a `recordingExpectation`: what became of each expected video, with sizes and checksums of the stored bytes. It describes publication only; the checks keep their results')
});

/** What `atlas report publish --format json` prints. */
export const PublishResultSchema = z.looseObject({
  ok: z.boolean().describe('True when the layer was written. False only with `--require-recordings` when an expected recording is not uploaded (the layer was still written; the exit code is then 1)'),
  store: z.string().describe('Where it was written: a folder, `s3://…` or a server URL'),
  layer: PublishedLayerSchema,
  specSet: z.looseObject({ id: z.string(), files: z.number().int().nonnegative(), branch: z.string().nullable() }).optional().describe('Present when `--specs` was given'),
  run: z.looseObject({ id: z.string(), files: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), alreadyPublished: z.boolean() }).optional().describe('Present with `--upload-run`'),
  recordings: z.looseObject({
    strict: z.boolean().describe('Whether `--require-recordings` was given'),
    complete: z.boolean().describe('True when every expected recording is uploaded or referenced'),
    expected: z.number().int().nonnegative(),
    uploaded: z.number().int().nonnegative(),
    gaps: z.array(z.looseObject({ check: z.string(), state: z.string(), reason: z.string().optional() })).describe('Each expected recording that is skipped or unresolved. Retry after fixing it: publishing again reuses the stored files')
  }).optional().describe('Present when a check declared a `recordingExpectation`'),
  warnings: z.array(z.string()).describe('What was skipped and why, such as an attachment file that could not be read. Never fatal')
});

/** What `atlas report stream --format json` prints when its input ends. */
export const StreamResultSchema = z.looseObject({
  ok: z.boolean().describe('False when any check could not be sent (the exit code is then 1)'),
  producer: z.string(),
  environment: z.string().nullable(),
  layers: z.number().int().nonnegative().describe('Layers that arrived'),
  checks: z.number().int().nonnegative().describe('Checks that arrived'),
  lost: z.number().int().nonnegative().describe('Checks that never arrived'),
  warnings: z.array(z.string()).describe('Input lines that were skipped, and sends that failed')
});

/** What `atlas report merge --format json` prints. */
export const MergeResultSchema = z.looseObject({
  ok: z.literal(true),
  into: z.string(),
  copied: z.number().int().nonnegative().describe('Objects that were missing in the destination and were copied'),
  skipped: z.number().int().nonnegative().describe('Objects the destination already had'),
  ignored: z.number().int().nonnegative().describe('Objects outside `layers/`, which are never merged')
});

/** One thing `atlas report doctor` checked about a store. */
export const DoctorCheckSchema = z.looseObject({
  name: z.string().describe('`store`, `list`, `contents`, `write`, …'),
  ok: z.boolean(),
  detail: z.string(),
  fix: z.string().optional().describe('What to change, when `ok` is false')
});

/** What `atlas report doctor --format json` prints. */
export const DoctorResultSchema = z.looseObject({
  ok: z.boolean().describe('True when every check of every store passed (otherwise the exit code is 1)'),
  stores: z.array(z.looseObject({ id: z.string(), checks: z.array(DoctorCheckSchema) }))
});

/** A published video that could not be read back from the store as published (see `atlas report verify-recordings`). */
export const RecordingGapSchema = z.looseObject({
  layer: z.string().describe('The layer that holds the video'),
  check: z.string().nullable().describe('The check that holds it, or null for a video attached to the layer or a part'),
  name: z.string().describe('The attachment\'s name'),
  bundleKey: z.string().describe('Its key in the layer\'s bundle (`attachments/<sha256>`)'),
  problem: z.string().describe('`not-in-bundle` (the layer names a file its bundle does not list), `blob-missing` (a blob holding it is gone: a 404 when played), `unreadable` (the store could not be read: not proof it is gone), `size-mismatch`, `checksum-mismatch` or `undecodable` (empty, or not the container its media type names). An open vocabulary: treat an unknown problem as a gap'),
  reason: z.string().describe('A short explanation without tokens, paths or payload')
});

/**
 * What `atlas report verify-recordings --format json` prints: whether the videos the layers published can still be read
 * back from the store as they were published. It describes stored bytes, never playback in a browser, and it never changes
 * a check\'s result.
 */
export const VerifyRecordingsResultSchema = z.looseObject({
  ok: z.boolean().describe('True when no layer has a gap and every layer could be read (otherwise the exit code is 1). Test results are unaffected either way'),
  layers: z.number().int().nonnegative().describe('Layers examined'),
  checked: z.number().int().nonnegative().describe('Videos read back from the store (those that name a bundle key)'),
  verified: z.number().int().nonnegative().describe('Of those, the ones that passed every check'),
  referenced: z.number().int().nonnegative().describe('Videos given only by address, which Atlas holds no bytes for and does not check'),
  gaps: z.array(RecordingGapSchema).describe('Every video that is missing, unreadable, corrupt or not the container it claims. Re-publish the layer\'s recordings to repair them'),
  notices: z.array(z.string()).describe('Layers that could not be read at all: their recordings are unknown, never verified')
});

/** What any `atlas` command prints on standard error, with `--format json`, when the command itself was wrong (exit code 2). */
export const CommandErrorSchema = z.looseObject({
  ok: z.literal(false),
  error: z.looseObject({
    message: z.string().describe('What is wrong, and usually what to do about it'),
    code: z.literal('usage').describe('`usage`: the command or its inputs were wrong. Nothing was written')
  })
});

/** A test suite `atlas init` found, and the commands that run it and send its results. */
export const InitSuiteSchema = z.looseObject({
  id: z.string().describe('A stable name for the suite, lowercase: `vitest`, `playwright`, `pytest`, … Used as the default `--producer`'),
  runner: z.string().describe('What runs it: `vitest`, `jest`, `playwright`, `bun-test`, `mocha`, `cypress`, `cucumber`, `pytest`, `go-test`, `atlas-statecharts`'),
  evidence: z.string().describe('Where the detection came from, such as `package.json devDependencies: vitest`'),
  run: z.string().describe('A command that runs the suite and writes its results to `output`. Its exit code is the suite\'s; publish regardless'),
  output: z.string().describe('The file the results are written to'),
  format: z.enum(['junit', 'ctrf', 'manifest']).describe('How `publish` should read `output`: `--junit`, `--ctrf` or `--manifest`'),
  environment: z.string().nullable().describe('The client the suite checks (`desktop-web`, `ios`, …) when that is known; null when it should be chosen'),
  publish: z.string().describe('The command that sends `output` to the server'),
  stream: z.string().nullable().describe('The command that streams checks as they finish, when the runner can print them as JSON lines; else null'),
  prerequisites: z.array(z.string()).describe('What must be installed or configured first, as commands (`bun add -d jest-junit`)')
});

/** A file `atlas init` creates or updates. */
export const InitFileSchema = z.looseObject({
  path: z.string().describe('Relative to the project directory'),
  action: z.enum(['create', 'update', 'unchanged']).describe('`unchanged`: already what it would write, so applying changes nothing'),
  purpose: z.string(),
  content: z.string().describe('The whole file as it would be written')
});

/**
 * What `atlas init --format json` prints: everything found about the project, and everything it would change.
 * Without `--write` nothing is changed. With `--write`, the files are written and `written` says which.
 */
export const InitPlanSchema = z.looseObject({
  ok: z.boolean().describe('False when `verification` was asked for and failed (the exit code is then 1)'),
  directory: z.string(),
  project: z.looseObject({
    name: z.string().nullable(),
    packageManager: z.enum(['bun', 'pnpm', 'yarn', 'npm']).nullable(),
    languages: z.array(z.string())
  }),
  git: z.looseObject({ branch: z.string().nullable(), defaultBranch: z.string().describe('`main` unless the repository says otherwise') }),
  ci: z.enum(['github-actions', 'gitlab-ci', 'circleci', 'none']),
  server: z.looseObject({ url: z.string().nullable(), tokenEnv: z.literal('ATLAS_TOKEN') }),
  specs: z.looseObject({
    directory: z.string().nullable().describe('The folder to pass as `--specs`, relative to the project; null when no spec files were found'),
    kinds: z.record(z.string(), z.number().int().nonnegative()).describe('Spec files by kind: `gherkin`, `quint`, `dmn`, `alloy`, `openslo`, `scxml`, …')
  }),
  suites: z.array(InitSuiteSchema),
  files: z.array(InitFileSchema),
  written: z.array(z.string()).describe('The files `--write` wrote; empty without it'),
  verification: z.looseObject({
    reachable: z.boolean(), role: z.string().nullable(), canPublish: z.boolean(), error: z.string().nullable()
  }).nullable().describe('Present with `--verify` (and a server): whether the server answers, and what the token in `ATLAS_TOKEN` may do'),
  nextSteps: z.array(z.string()).describe('What to do next, in order, as plain instructions an agent can follow'),
  warnings: z.array(z.string())
});

/** The coverage of one state in one profile, as the UI catalog words it. */
const UiCoverageSchema = z.enum(['captured', 'failed', 'capturing', 'skipped', 'missing']);

/** What `atlas ui-catalog plan --format json` and `atlas ui-catalog publish --format json` print: the one layer that was written. */
export const UiCatalogPublishResultSchema = z.looseObject({
  ok: z.literal(true).describe('True: the layer was written. A state whose picture could not be read is published as `failed` and named in `warnings`; it does not fail the command'),
  store: z.string().describe('Where it was written: a folder, `s3://…` or a server URL'),
  layer: z.looseObject({
    id: z.string().describe('The layer id: 64 hex digits, the SHA-256 of its content. Publishing the same input again gives the same id'),
    kind: z.enum(['ui-state', 'ui-plan']).describe('`ui-state`: captures (`publish`). `ui-plan`: the expected set (`plan`)'),
    producer: z.string(),
    environment: z.string().nullable(),
    parameters: z.record(z.string(), z.string()).describe('The rest of the profile, such as `{ "viewport": "390x844" }`'),
    states: z.number().int().nonnegative().describe('States in the layer'),
    captured: z.number().int().nonnegative().describe('For `publish`: states that were captured (`passed`). Zero for a plan'),
    failed: z.number().int().nonnegative().describe('For `publish`: states recorded as failed, including those whose picture could not be read'),
    pictures: z.number().int().nonnegative().describe('Pictures stored in the layer'),
    pictureBytes: z.number().int().nonnegative(),
    shard: z.string().nullable().describe('The `--shard` label, which describes the layer and never splits its slot')
  }),
  warnings: z.array(z.string()).describe('What was skipped and why, such as a picture file that could not be read. Never fatal')
});

/** One thing that keeps a UI catalog from being complete and good. */
export const UiCatalogProblemSchema = z.looseObject({
  kind: z.enum(['failed', 'missing', 'capturing', 'unavailable', 'unreadable', 'empty']).describe('`failed`: a capture was attempted and failed. `missing`: a plan expects it and nothing was captured. `capturing`: still being taken, so not known. `unavailable`: a backend could not be read. `unreadable`: a layer could not be read. `empty`: the catalog holds no state at all'),
  state: z.string().optional().describe('The state id, for `failed`, `missing` and `capturing`'),
  profile: z.string().optional().describe('The profile label, for `failed`, `missing` and `capturing`'),
  detail: z.string().optional().describe('Why, when the producer said')
});

/** What `atlas ui-catalog status --format json` prints. */
export const UiCatalogStatusSchema = z.looseObject({
  ok: z.boolean().describe('True only when the catalog holds a state and has no problem: nothing failed, nothing expected is missing, nothing is still being captured, and every backend and layer was read (otherwise the exit code is 1). Skipped cells are counted, not problems'),
  summary: z.looseObject({
    states: z.number().int().nonnegative(),
    profiles: z.number().int().nonnegative(),
    cells: z.number().int().nonnegative().describe('States counted once per profile'),
    coverage: z.record(UiCoverageSchema, z.number().int().nonnegative()).describe('Cells by coverage'),
    undeclared: z.number().int().nonnegative().describe('Captured cells no plan expects; zero when no plan exists'),
    planned: z.boolean().describe('Whether any plan was published. Without one, `missing` is always zero because what should exist is unknown'),
    surfaces: z.number().int().nonnegative(),
    uncoveredSurfaces: z.number().int().nonnegative()
  }),
  profiles: z.array(z.looseObject({ key: z.string(), label: z.string() })),
  problems: z.array(UiCatalogProblemSchema),
  sources: z.looseObject({ layers: z.number().int().nonnegative(), backends: z.array(z.looseObject({ id: z.string(), label: z.string(), available: z.boolean() })), notices: z.array(z.string()) })
});

/** One side of `atlas ui-catalog diff`. */
const UiCatalogCommitSchema = z.looseObject({ sha: z.string(), states: z.number().int().nonnegative(), layers: z.number().int().nonnegative() });

/** What `atlas ui-catalog diff --format json` prints. */
export const UiCatalogDiffResultSchema = z.looseObject({
  ok: z.boolean().describe('False when a layer or backend could not be read (the comparison may be wrong), or, with `--fail-on-change`, when anything differs. Otherwise true: a difference is not a failure by itself'),
  from: UiCatalogCommitSchema,
  to: UiCatalogCommitSchema,
  summary: z.looseObject({
    coverage: z.number().int().nonnegative().describe('Pairs that stand differently (captured against failed, for example)'),
    picture: z.number().int().nonnegative().describe('Both captured, and the stored bytes differ. Not a measure of how many pixels'),
    unverified: z.number().int().nonnegative().describe('Both captured, but a side has no content hash, so whether the picture changed is unknown'),
    added: z.number().int().nonnegative().describe('Only `to` has it'),
    removed: z.number().int().nonnegative().describe('Only `from` has it. Not a regression: the other side may not have run it'),
    unchanged: z.number().int().nonnegative(),
    total: z.number().int().nonnegative()
  }),
  changes: z.array(z.looseObject({
    state: z.string(), title: z.string(), profile: z.string(),
    change: z.enum(['coverage', 'picture', 'unverified', 'added', 'removed']),
    from: UiCoverageSchema.nullable(), to: UiCoverageSchema.nullable()
  })).describe('Every pair that is not unchanged'),
  notices: z.array(z.string()).describe('What could not be read. Any makes `ok` false: an unreadable layer is unknown, never unchanged')
});

/** What `atlas ui-catalog export --format json` prints. */
export const UiCatalogExportResultSchema = z.looseObject({
  ok: z.literal(true),
  out: z.string().describe('The HTML file that was written'),
  bytes: z.number().int().nonnegative().describe('Its size'),
  states: z.number().int().nonnegative(),
  cells: z.number().int().nonnegative(),
  pictures: z.looseObject({
    embedded: z.number().int().nonnegative(),
    embeddedBytes: z.number().int().nonnegative(),
    left: z.number().int().nonnegative().describe('Pictures not embedded (over the size limit, not stored, not an image, or `--images none`); each is listed on the page with the reason')
  }),
  manifest: z.string().nullable().describe('The JSON manifest written beside it with `--manifest`, or null'),
  warnings: z.array(z.string()).describe('Backends and layers that could not be read, and pictures left out. The page says so too')
});

/**
 * JSON command contracts, shared by schema publication, agent documentation and executable command checks.
 * A new result needs an entry here and a runtime scenario in the documentation contract tests.
 */
export const CLI_RESULTS = {
  init: { command: 'atlas init', schemaName: 'init-plan', schema: InitPlanSchema },
  publish: { command: 'atlas report publish', schemaName: 'publish-result', schema: PublishResultSchema },
  stream: { command: 'atlas report stream', schemaName: 'stream-result', schema: StreamResultSchema },
  merge: { command: 'atlas report merge', schemaName: 'merge-result', schema: MergeResultSchema },
  doctor: { command: 'atlas report doctor', schemaName: 'doctor-result', schema: DoctorResultSchema },
  status: { command: 'atlas report status', schemaName: 'report-status', schema: ReportStatusSchema },
  verifyRecordings: { command: 'atlas report verify-recordings', schemaName: 'verify-recordings-result', schema: VerifyRecordingsResultSchema },
  uiCatalogPlan: { command: 'atlas ui-catalog plan', schemaName: 'ui-catalog-publish-result', schema: UiCatalogPublishResultSchema },
  uiCatalogPublish: { command: 'atlas ui-catalog publish', schemaName: 'ui-catalog-publish-result', schema: UiCatalogPublishResultSchema },
  uiCatalogStatus: { command: 'atlas ui-catalog status', schemaName: 'ui-catalog-status', schema: UiCatalogStatusSchema },
  uiCatalogDiff: { command: 'atlas ui-catalog diff', schemaName: 'ui-catalog-diff-result', schema: UiCatalogDiffResultSchema },
  uiCatalogExport: { command: 'atlas ui-catalog export', schemaName: 'ui-catalog-export-result', schema: UiCatalogExportResultSchema },
  error: { command: 'a command that was wrong (standard error)', schemaName: 'command-error', schema: CommandErrorSchema }
} as const;
