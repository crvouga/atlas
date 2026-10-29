/**
 * @module Command results (`--format json`)
 *
 * What `atlas report publish`, `stream`, `merge` and `doctor` print on standard output with `--format json` (alias
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
  error: { command: 'a command that was wrong (standard error)', schemaName: 'command-error', schema: CommandErrorSchema }
} as const;
