# Reference: runners

Native reporters that upload to the project server. Import paths `@crvouga/atlas/codecept`, `@crvouga/atlas/mocha`, `@crvouga/atlas/jest`, `@crvouga/atlas/node-test`.

> Generated from the doc comments of `packages/runners/src` by `bun run docs`. Do not edit: change the comment next to the code.

### codecept.ts

Source: `packages/runners/src/codecept.ts`. Import: `@crvouga/atlas/codecept`

@module CodeceptJS reporter
CodeceptJS's Mocha reporter interface carries scenario outcomes and steps to the singleton Atlas server.

#### `AtlasCodeceptReporter`

```ts
export default class AtlasCodeceptReporter extends AtlasMochaReporter
```

Use `codeceptjs run --reporter

**Example**

```ts
// codecept.conf.js
export const config = { tests: './tests/*_test.js', reporter: '@crvouga/atlas/codecept' };
```

### jest.ts

Source: `packages/runners/src/jest.ts`. Import: `@crvouga/atlas/jest`

@module Jest reporter
Uploads the aggregated results after Jest has finished, with suite crashes represented as failed checks.

#### `AtlasJestReporter`

```ts
export default class AtlasJestReporter
```

Jest's native reporter; retain `default` in the reporter list for console output. Upload errors fail Jest.

**Example**

```ts
export default { reporters: ['default', ['@crvouga/atlas/jest', { url: 'https://atlas.example.com' }]] };
```

- `onRunStart(result?: { numTotalTests?: number }): void` — Reset publishing errors for each watch-mode invocation.
- `onTestCaseStart(test: { path: string }, info: { fullName: string; title: string }): void` — Publish the test as running before its body executes in a worker.
- `onTestCaseResult(test: { path: string }, result: Result['testResults'][number]): void` — Stream each test outcome immediately, without waiting for other files to finish.
- `async onRunComplete(_contexts: unknown, result: { testResults: Result[] }): Promise<void>` — Await uploading every final result, including test-file failures before any test ran.
- `getLastError(): Error | undefined` — Jest uses this to turn a publishing error into a failed invocation.

### mocha.ts

Source: `packages/runners/src/mocha.ts`. Import: `@crvouga/atlas/mocha`

@module Mocha and CodeceptJS reporter
Receives Mocha's final test outcomes, including CodeceptJS scenarios, and waits for the server upload in `done`.
No runner package is imported, so consumers use their own installed version.

#### `AtlasMochaReporter`

```ts
export default class AtlasMochaReporter
```

Mocha reporter; use `--reporter

**Example**

```ts
// mocha configuration
export default { reporter: '@crvouga/atlas/mocha', reporterOptions: { url: 'https://atlas.example.com' } };
```

- `done(failures: number, callback: (failures: number) => void): void` — Mocha waits for this callback before exiting. Publishing errors fail the invocation.

### node-test.ts

Source: `packages/runners/src/node-test.ts`. Import: `@crvouga/atlas/node-test`

@module Node test runner reporter
Consumes Node's test event stream and publishes final leaf outcomes to the project Atlas server.

#### `atlasNodeReporter`

```ts
export default async function* atlasNodeReporter(source: AsyncIterable<Event>): AsyncGenerator<string>
```

Async generator reporter. Use alongside Node's spec reporter to keep normal output.
Upload errors reject the stream; skips and TODOs never count as passed. Successful suite containers are excluded; hook failures are retained.

**Example**

```ts
// node --test --test-reporter=spec --test-reporter=@crvouga/atlas/node-test
```

### publish.ts

Source: `packages/runners/src/publish.ts`

@module Publishing native runner results
Native reporters send checks to the project's Atlas server. Only the server knows its storage backend.

#### `ReporterOptions`

```ts
export type ReporterOptions = {
  /** Project namespace; defaults to ATLAS_PROJECT. */
  readonly project?: string;
  readonly url?: string;
  readonly token?: string;
  readonly producer?: string;
  readonly environment?: string;
  readonly branch?: string;
  readonly sha?: string;
  readonly timeoutMs?: number;
  readonly rootDir?: string;
  /** Explicit final evidence time; normally generated when publication finishes. */
  readonly recordedAtMs?: number;
};
```

Reporter options; explicit values override ATLAS_SERVER_URL, ATLAS_PUBLISH_TOKEN, ATLAS_ENVIRONMENT, ATLAS_BRANCH and ATLAS_SHA.

#### `testFile`

```ts
export function testFile(file: string | undefined, root = process.cwd()): string
```

A portable check identity: paths relative to the project, using forward slashes on every OS.

#### `uploadChecks`

```ts
export async function uploadChecks(runner: string, checks: readonly EvidenceCheck[], options: ReporterOptions = {}): Promise<void>
```

Upload one completed runner invocation. Unknown outcomes stay not-run, repeated identities are numbered.
Throws on missing configuration, timeouts or refused uploads so CI cannot silently lose its evidence.
No storage credentials or backend URL are needed by the runner.

**Example**

```ts
await uploadChecks('mocha', checks, { url: 'https://atlas.example.com', token: process.env.ATLAS_PUBLISH_TOKEN });
```

#### `runnerLive`

```ts
export function runnerLive(runner: string, options: ReporterOptions = {}, plannedChecks?: number): import('../../reports/src/live-reporter').LiveReporter
```

Start the native runner's live feed with the same endpoint and identity as its final report.

#### `finishRunner`

```ts
export async function finishRunner(live: import('../../reports/src/live-reporter').LiveReporter, runner: string, checks: readonly EvidenceCheck[], options: ReporterOptions = {}): Promise<void>
```

Flush live progress, then publish the full final evidence even if the lease was interrupted. Reject either failure.
