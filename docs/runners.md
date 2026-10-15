# Native test runner reporters

Projects upload results to a shared Atlas node under their own project slug. CodeceptJS, Mocha, Jest and Node's test runner have native reporters; other runners can publish their JUnit or CTRF output with `atlas report publish`. All reporters are entry points of the single `@crvouga/atlas` package.

## Configure the project once

Set these in the test process, locally or in CI:

```sh
export ATLAS_SERVER_URL=https://atlas.example.com
export ATLAS_PROJECT=checkout-service
export ATLAS_PUBLISH_TOKEN=your-publish-token
export ATLAS_ENVIRONMENT=linux-chromium
export ATLAS_BRANCH=main
export ATLAS_SHA=your-commit-sha
```

The server owns its storage configuration and credentials. Consumers only need the server URL and a publish token. Upload failures fail the test invocation; reporters wait for publication before finishing. Each invocation streams a live run, then publishes final evidence, with stable check IDs relative to the project directory, durations, failures and skipped outcomes. Unknown outcomes, TODOs and skipped tests are `not-run`, never passed. Parallel processes upload independent layers; use distinct producer/environment values for independent suites.

A test file is part of a check's identity, not automatically a specification: link checks to product specifications through the existing report mapping workflow when importing JUnit/CTRF, or publish explicit `specPath` checks through the API.

## CodeceptJS

Use its [Mocha reporter interface](https://codecept.io/reports/):

```sh
bunx codeceptjs run --reporter @crvouga/atlas/codecept
```

Streams scenario starts and outcomes, then records durations and scenario steps when supplied by CodeceptJS. Use the standard single-process runner; parallel workers should each publish their own layer. Runner-native screenshot/video attachments can also be imported from CTRF/JUnit; this reporter does not read arbitrary files from runner objects.

## Mocha

```sh
bunx mocha --reporter @crvouga/atlas/mocha
```

Or configure `reporter` and `reporterOptions` in Mocha. Options include `url`, `token`, `producer`, `environment`, `branch`, `sha`, `rootDir` and `timeoutMs` (30 seconds by default); explicit options override the environment. Final failures and hook failures are failed checks. Passing retries include a flaky label. Mocha parallel mode is not supported by this reporter's event model; run each shard separately.

## Jest

Keep Jest's console reporter alongside Atlas:

```js
export default {
  reporters: ['default', ['@crvouga/atlas/jest', { producer: 'unit' }]],
};
```

The reporter streams test-case starts and results from workers and uploads full aggregated evidence after workers finish. File-level exceptions become failed checks even when no test ran. Watch mode resets publication errors on each invocation. It accepts the same options as Mocha.

## Node's test runner

```sh
node --test --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=@crvouga/atlas/node-test --test-reporter-destination=stdout
```

Uses the native async event stream, with environment configuration. Reports leaf tests; successful suite containers are excluded, while suite hook failures remain failed checks. Test names include enclosing suites so identical names in different suites keep distinct IDs. Skips and TODOs remain not-run, including TODO failures.

## Other runners and frameworks

Playwright, Vitest, Bun, WebDriver/Appium and Detox already have Atlas statechart adapters. Pytest, JUnit/TestNG, NUnit, xUnit, Go, Rust, Cypress, WebdriverIO, Cucumber and Robot Framework can publish JUnit XML or CTRF JSON through the existing importer. See [integration commands](integrating.md) and the [report contract](report-contract.md). These report importers complement native reporters; they do not require a storage backend in the consumer project.

## Operate the singleton

Run `atlas server` once for the projects the node hosts; point local and CI publishers at that URL and set each project's `ATLAS_PROJECT`. Configure backends using environment variables or open **Settings** in the client (`/admin`). Authentication and listening addresses remain deployment configuration. Settings changes are validated and saved atomically for the next server restart. Environment variables and flags override saved values. A backend change does not migrate historical data: retain the old backend as a read source when switching the upload destination.

Native reporters send a heartbeat every 5 seconds. The server interrupts invocations after 30 seconds of silence, or after the configurable progress-stall timeout. It preserves finished results and never marks missing tests as passed. See [live test runs](server.md#live-test-runs-and-heartbeats).
