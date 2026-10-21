# Reference: playwright-reporter

A Playwright Test reporter that streams every test to Atlas with its duration, device labels, steps, retries, videos, screenshots and traces. Import path `@crvouga/atlas/playwright-reporter`.

> Generated from the doc comments of `packages/playwright-reporter/src` by `bun run docs`. Do not edit: change the comment next to the code.

### Playwright results as Atlas evidence

Source: `packages/playwright-reporter/src/evidence.ts`

The pure half of the Playwright Test reporter: how one Playwright test and its results become one Atlas check, with
its status, failure detail, duration, tags, annotations, links, timeline steps, retry attempts and attachments, and
how a project becomes an environment and labels. Nothing here talks to a store; the only input/output is reading the
files Playwright attached (videos, traces, screenshots) and looking for a repository root or a `.feature` file.

See docs/rich-evidence.md

#### `CheckInput`

```ts
export type CheckInput = PublishChecksInput['checks'][number];
```

One check as handed to the streaming reporter: the input type of a check in `PublishChecksSchema`.

#### `AttachmentMode`

```ts
export type AttachmentMode = 'all' | 'failures' | 'none';
```

Which results upload their attachments: every one, only failed checks and failed attempts, or none.

#### `AttachmentPolicy`

```ts
export type AttachmentPolicy = {
  /** `all`, `failures` (failed checks and failed attempts only) or `none`. */
  readonly mode: AttachmentMode;
  /** A larger file is not uploaded; the check gets an `attachment-skipped` annotation instead. */
  readonly maxBytes: number;
};
```

What to upload of the files Playwright attached: the `mode`, and the largest single file in bytes (`maxBytes`).

#### `CheckContext`

```ts
export type CheckContext = {
  /** The check's stable id: `<specPath>#<describe titles > test title>`. */
  readonly id: string;
  readonly title: string;
  /** The spec the check belongs to, relative to the repository. */
  readonly specPath: string;
  /** Facts about where it ran: browser, device, viewport, os, playwright version. */
  readonly labels: Readonly<Record<string, string>>;
  /** Relative paths (source locations) are written relative to this directory. */
  readonly root: string;
  readonly attachments: AttachmentPolicy;
  /** The most timeline steps recorded per result; the rest are counted in an annotation. */
  readonly maxSteps: number;
};
```

Where a check comes from and how it is recorded, as worked out by the reporter before its evidence is collected.

#### `stripAnsi`

```ts
export function stripAnsi(text: string): string
```

Removes terminal colour and cursor codes, which Playwright puts in error messages and step titles.

**Example**

```ts
stripAnsi('\u001b[31mExpected\u001b[39m'); // 'Expected'
```

#### `errorDetail`

```ts
export function errorDetail(error: TestError | undefined, maxChars = 8000): string
```

The failure detail of an error: its message and stack without terminal codes, the message once, cut to `maxChars`.
An absent error is the empty string.

- `error`: A Playwright `TestError` (a result's or a step's).

- `maxChars`: The longest detail kept. Default 8000.

#### `resultStatus`

```ts
export function resultStatus(test: Pick<TestCase, 'expectedStatus'>, result: Pick<TestResult, 'status'>): 'passed' | 'failed' | 'not-run'
```

The Atlas status of one Playwright result: skipped is `not-run`; the status the test expected (`passed`, or `failed`
for a `test.fail()`) is `passed`; anything else (failed, timed out, interrupted, an expected failure that passed) is
`failed`.

#### `willRetry`

```ts
export function willRetry(test: Pick<TestCase, 'expectedStatus' | 'retries'>, result: Pick<TestResult, 'status' | 'retry'>): boolean
```

Whether Playwright will run this test again after this result: it did not get what it expected and has retries left.

#### `stepKind`

```ts
export function stepKind(step: Pick<TestStep, 'category' | 'title'>): string
```

The timeline kind of a Playwright step, by its category: `test.step` is `step` (or the Gherkin keyword, `given`,
`when`, `then`, `and`, `but`, for a playwright-bdd step), `expect` is `assertion`, `pw:api` is `action`, `hook`,
`fixture`; any other category is kept as it is.

#### `flattenSteps`

```ts
export function flattenSteps(steps: readonly TestStep[], startedAtMs: number, max: number): { steps: StepInput[]; dropped: number }
```

Playwright's step tree as Atlas's flat timeline: each step gets an id (`s1`, `s2`, …), its parent's id, its kind,
when it started after the result did (`offsetMs`), how long it took, and `failed` with the error as detail when it
failed. At most `max` steps are kept, in order; `dropped` counts the rest.

- `steps`: `result.steps`.

- `startedAtMs`: When the result started (`result.startTime`), in epoch milliseconds.

- `max`: The most steps kept.

#### `findRepoRoot`

```ts
export function findRepoRoot(start: string, exists: (file: string) => boolean = existsSync): string | null
```

The closest directory at or above `start` that holds `.git` (a folder, or a file in a worktree), or null. Reads the
file system only; it never runs git.

#### `repoPath`

```ts
export function repoPath(file: string, root: string): string
```

`file` relative to `root`, with forward slashes on every OS.

#### `bddFeaturePath`

```ts
export function bddFeaturePath(file: string, exists: (file: string) => boolean = existsSync): string | undefined
```

The `.feature` file a playwright-bdd generated test came from, or undefined for any other test file. playwright-bdd
writes `<outputDir>/<path>.feature.spec.js` (its outputDir is `.features-gen` by default, mirroring the feature
folders); this returns the first `<path>.feature` that exists beside `.features-gen` (dropping leading folders, such
as a per-project output folder, until one does), else the mapped path even if no such file is found.

- `file`: The absolute path of the test file (`test.location.file`).

**Example**

```ts
bddFeaturePath('/repo/e2e/.features-gen/features/login.feature.spec.js'); // '/repo/e2e/features/login.feature'
```

#### `projectEnvironment`

```ts
export function projectEnvironment(project: Pick<FullProject, 'use'> | undefined): string
```

The environment a project tests by default: `mobile-web` when it emulates a mobile device (`use.isMobile`), else `desktop-web`.

#### `projectLabels`

```ts
export function projectLabels(project: Pick<FullProject, 'name' | 'use'> | undefined, version?: string): Record<string, string>
```

What every check of a project carries as labels: `browser` (`use.browserName`, else the device's
`defaultBrowserType`), `channel`, `device` (the project name), `viewport` (`<width>x<height>`), `os`
(`process.platform`) and `playwright` (its version). Labels describe a result; they never split its slot.

- `project`: The Playwright project, or undefined when it is not known.

- `version`: Playwright's version (`config.version`).

#### `resultAttachments`

```ts
export async function resultAttachments(result: Pick<TestResult, 'attachments' | 'stdout' | 'stderr'>, failed: boolean, policy: AttachmentPolicy): Promise<{ attachments: AttachmentInput[]; annotations: AnnotationInput[] }>
```

The files and output of one result as attachments with their bytes: every `result.attachments` entry (role `video`,
`screenshot` or `trace` by its Playwright name, else the name itself; bytes from `body`, or read from `path`), and
standard output and error as `log` text. A file over the size limit, or that cannot be read, is left out with an
`attachment-skipped` annotation saying why. Never throws.

- `result`: The Playwright result.

- `failed`: Whether the result failed, for the `failures` mode.

- `policy`: What to upload.

#### `checkOf`

```ts
export async function checkOf(test: TestCase, results: readonly TestResult[], context: CheckContext): Promise<CheckInput>
```

The final check of a Playwright test from all its results (one per try): status of the last result (`flaky`, as a
tag and a label, when it passed after a failed try), failure detail without terminal codes, duration, tags (the
test's tags without `@`, and its annotation types), annotations, links (annotations whose description is a URL),
timeline steps, one attempt per try when it was retried, attachments, and the test's location under the
`playwright` extension. Reads attached files; never throws for a file it cannot read.

- `test`: The Playwright test.

- `results`: Its results, oldest first (`test.results`).

- `context`: Its identity and what to record.

### Playwright Test reporter

Source: `packages/playwright-reporter/src/index.ts`. Import: `@crvouga/atlas/playwright-reporter`

`@crvouga/atlas/playwright-reporter` is a Playwright Test reporter that streams every test to an Atlas server (or any
store) as it runs, with the evidence Playwright already has: durations, failure details, steps as a timeline, retries
as attempts (and `flaky`), tags, annotations, and the videos, screenshots and traces it attached. Each Playwright
project is its own stream of layers, so a desktop and a mobile project are two environments of the same checks, and
every check is labelled with its browser, device, viewport, operating system and Playwright version.

It never throws into the test run: a destination that is not configured, a store that is down or a file that cannot
be read is said once, and the run goes on. Playwright is only imported for its types, so importing this module loads
nothing of Playwright.

See docs/rich-evidence.md

#### `PerProject`

```ts
export type PerProject<T> = T | ((project: FullProject) => T);
```

A value given once for every project, or worked out from each project.

#### `AtlasPlaywrightReporterOptions`

```ts
export type AtlasPlaywrightReporterOptions = {
  /** Project namespace on a shared Atlas server. Default `ATLAS_PROJECT`. */
  readonly project?: string;
  /** The Atlas server (`https://atlas.example.com`), or any store location (`./atlas-reports`, `s3://bucket/prefix`). Default `ATLAS_SERVER_URL`, else `ATLAS_STORE`. */
  readonly url?: string;
  /** A publish token. Default `ATLAS_PUBLISH_TOKEN`, else `ATLAS_TOKEN` (or the file `ATLAS_TOKEN_FILE` names). */
  readonly token?: string;
  /** Publish to this store instead of a URL: a directory store, an in-memory store in tests, anything that implements `ObjectStore`. */
  readonly store?: ObjectStore;
  /** A stable name for this suite. With the check id, environment and parameters it picks the slot a result fills. Default `playwright`. */
  readonly producer?: string;
  /** The part kind of every layer. Default `checks`. */
  readonly kind?: string;
  /** The environment of a project's checks. Default `mobile-web` for a project with `use.isMobile`, else `desktop-web`. */
  readonly environment?: PerProject<string>;
  /** Choices that make a result its own slot (a locale, a tenant). Empty by default: labels never split slots, parameters do. */
  readonly parameters?: PerProject<Readonly<Record<string, string>>>;
  /** More labels for every check of a project, beside browser, device, viewport, os and playwright. */
  readonly labels?: PerProject<Readonly<Record<string, string>>>;
  /** The commit tested. Default `ATLAS_SHA`, then the CI's own variables (`GITHUB_SHA`…), then git. */
  readonly sha?: string;
  /** The branch tested. Default `ATLAS_BRANCH`, then `GITHUB_HEAD_REF`, `GITHUB_REF_NAME`…, then git. */
  readonly branch?: string;
  /** Where to read the CI run. Default the GitHub Actions run (or the CI's own run URL variable). */
  readonly runUrl?: string;
  /** The spec a test belongs to, relative to the repository. Default: the `.feature` of a playwright-bdd test, else the test file. */
  readonly specPath?: (test: TestCase) => string | undefined;
  /** Paths are relative to this directory. Default the git root above Playwright's `rootDir`, else `rootDir`. */
  readonly rootDir?: string;
  /** Which results upload their attachments (videos, screenshots, traces, output): `all`, `failures` or `none`. Default `all`. */
  readonly attachments?: AttachmentMode;
  /** A larger file is not uploaded; the check says so in an annotation. Default 50 MiB. */
  readonly maxAttachmentBytes?: number;
  /** The most timeline steps recorded per result. Default 500. */
  readonly maxSteps?: number;
  /** Record the project's spec files (path, domain, kind, title) in every layer, so a server can group checks by spec without a published spec set. Default true. */
  readonly specs?: boolean;
  /** Send what has finished this often, in ms. Default 5000 (every layer repeats the spec list). */
  readonly flushMs?: number;
  /** Send at once when this many checks are waiting. Default 50 (their attachments are held in memory until sent). */
  …
```

Options of the Playwright Test reporter, given as the second element of its entry in `reporter` in
`playwright.config.ts`. Every one is optional: with `ATLAS_SERVER_URL`, `ATLAS_TOKEN` and `ATLAS_PROJECT` set, none
is needed.

#### `AtlasPlaywrightReporter`

```ts
export default class AtlasPlaywrightReporter implements PlaywrightReporter
```

The Playwright Test reporter of Atlas. Add it beside your console reporter; it streams each test as `running` when
it starts and with its full evidence when its last try ends, one stream of layers per Playwright project, and
prints one summary line when the run ends. It never fails or slows the run on account of Atlas.

**Example**

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['list'], ['@crvouga/atlas/playwright-reporter', { project: 'checkout', producer: 'e2e-web' }]],
  use: { video: 'retain-on-failure', trace: 'retain-on-failure', screenshot: 'only-on-failure' }
});
```

- `printsToStdio(): boolean` — This reporter prints only a summary line, so Playwright keeps its own console output.
- `onBegin(config: FullConfig, _suite: Suite): void` — Resolves where layers go, where the run came from, and the directory paths are relative to. Never throws.
- `onTestBegin(test: TestCase, _result: TestResult): void` — Reports the test as `running`, so the report shows it while it runs.
- `onTestEnd(test: TestCase, result: TestResult): void` — On a test's last try, collects its evidence (reading its attached files) and reports it. A try Playwright will repeat leaves the test `running`.
- `async onEnd(): Promise<void>` — Waits for every result, marks tests the run did not finish as `not-run`, sends the rest, and prints one summary line.
