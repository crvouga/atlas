/**
 * @module Command results (`--format json`)
 *
 * What `atlas report publish`, `stream`, `merge`, `doctor` and `verify-recordings`, and `atlas critic list`, `setup`, `doctor` and `run`, print on standard output with `--format json` (alias
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

/** One critic as `atlas critic list` shows it. */
export const CriticListEntrySchema = z.looseObject({
  name: z.string().describe('The name in the configuration; also the producer suffix (`critic.<name>`)'),
  type: z.string().describe('`uiclip`, `llm`, `module`, or `not-configured` for a built-in critic that has no configuration yet'),
  kind: z.string().nullable().describe('`model`, `llm`, `heuristic`… as the critic says; null when it is not configured'),
  version: z.string().nullable(),
  status: z.enum(['ready', 'needs-setup', 'misconfigured', 'not-configured']).describe('`needs-setup`: run `atlas critic setup <name>`. `misconfigured`: the configuration or a credential reference cannot be used (see `detail`)'),
  sendsImagesTo: z.string().nullable().describe('Where images are sent: a host, or null when they never leave this machine. A run that sends images to a third party needs confirmation'),
  model: z.string().nullable(),
  detail: z.string().optional().describe('Why it is not ready, and what to do. Never holds a credential')
});

/** What `atlas critic list --format json` prints. */
export const CriticListResultSchema = z.looseObject({
  ok: z.literal(true),
  config: z.string().nullable().describe('The configuration file that was read, or null when there is none'),
  critics: z.array(CriticListEntrySchema)
});

/** What `atlas critic setup --format json` prints. */
export const CriticSetupResultSchema = z.looseObject({
  ok: z.boolean(),
  critic: z.string(),
  type: z.string(),
  details: z.array(z.string()).describe('What was provisioned or checked. A checkpoint is verified against its pinned SHA-256; inference never downloads anything'),
  error: z.string().optional().describe('Why setup failed, with no credential in it. The exit code is then 1')
});

/** One thing `atlas critic doctor` checked. */
export const CriticDoctorCheckSchema = z.looseObject({
  name: z.string().describe('`server`, `token`, `scope`, `catalog`, `spool`, or `<critic>:<aspect>` such as `uiclip:model-file`'),
  status: z.enum(['ok', 'warning', 'problem']).describe('`problem` makes the exit code 1; `warning` does not'),
  detail: z.string(),
  fix: z.string().optional().describe('What to change, when the status is not `ok`')
});

/** What `atlas critic doctor --format json` prints. */
export const CriticDoctorResultSchema = z.looseObject({
  ok: z.boolean().describe('False when any check is a `problem` (the exit code is then 1)'),
  server: z.string().nullable().describe('The server that was checked, with no secrets'),
  role: z.string().nullable().describe('What the token may do: `read`, `critic`, `publish` or `admin`; null when the server could not be asked'),
  open: z.boolean().nullable().describe('True when the server has no tokens, so every caller is an administrator; null when unknown'),
  checks: z.array(CriticDoctorCheckSchema)
});

/** What `atlas critic run` did for one critic. */
export const CriticRunCriticSchema = z.looseObject({
  critic: z.string(),
  version: z.string(),
  sendsImagesTo: z.string().nullable(),
  entries: z.number().int().nonnegative().describe('Entries in the chosen scope'),
  judged: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative().describe('Entries that already had a current critique of the same identity (critic, version, model, parameters, image hash): no call was made'),
  failed: z.number().int().nonnegative().describe('Entries recorded as failed with a reason code; the next run retries them'),
  waiting: z.number().int().nonnegative().describe('Entries left unjudged because the run stopped'),
  stoppedBy: z.enum(['budget', 'aborted']).optional(),
  failures: z.array(z.looseObject({ entry: z.string(), reason: z.string() })).describe('Each failed entry and its reason code'),
  spent: z.looseObject({ images: z.number(), tokens: z.number(), costUsd: z.number() }),
  published: z.looseObject({ layer: z.string().nullable().describe('The layer id of the critiques, or null when nothing was published (a dry run, or nothing to publish)'), critiques: z.number().int().nonnegative() }),
  gate: z.looseObject({
    mode: z.enum(['report', 'warn', 'gate']),
    exitCode: z.number().int(),
    below: z.number().int().nonnegative().describe('Scores below their state kind\'s threshold'),
    warnings: z.array(z.string()),
    refusal: z.array(z.string()).describe('Why `gate` was refused, when it was')
  }).optional()
});

/** What `atlas critic run --format json` prints. A dry run publishes and sends nothing. */
export const CriticRunResultSchema = z.looseObject({
  ok: z.boolean().describe('False when a critic failed on any entry or a gate was crossed (the exit code is then 1)'),
  dryRun: z.boolean(),
  server: z.string(),
  scope: z.record(z.string(), z.string()).describe('The choices that narrowed the catalog, as given'),
  critics: z.array(CriticRunCriticSchema),
  spool: z.looseObject({
    flushed: z.number().int().nonnegative().describe('Objects from an earlier run that were sent now'),
    spooled: z.number().int().nonnegative().describe('Objects of this run kept locally because the server could not be reached; the next invocation sends them'),
    pending: z.number().int().nonnegative().describe('Objects still waiting in the spool')
  }),
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
  verifyRecordings: { command: 'atlas report verify-recordings', schemaName: 'verify-recordings-result', schema: VerifyRecordingsResultSchema },
  criticList: { command: 'atlas critic list', schemaName: 'critic-list-result', schema: CriticListResultSchema },
  criticSetup: { command: 'atlas critic setup', schemaName: 'critic-setup-result', schema: CriticSetupResultSchema },
  criticDoctor: { command: 'atlas critic doctor', schemaName: 'critic-doctor-result', schema: CriticDoctorResultSchema },
  criticRun: { command: 'atlas critic run', schemaName: 'critic-run-result', schema: CriticRunResultSchema },
  error: { command: 'a command that was wrong (standard error)', schemaName: 'command-error', schema: CommandErrorSchema }
} as const;
