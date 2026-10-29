# Agent guidance

## Given this repository link from another project?

Read [the consumer integration playbook](docs/agents.md#given-only-this-repository-link) first. Work in the
consumer repository and install `@crvouga/atlas` from npm with its existing package manager. You do not need to
build Atlas, install Bun in a Node project, or run this repository's example to integrate it. The
[local quickstart](docs/quickstart.md) proves publishing and gating without a server or credentials.

## How Atlas is developed: one npm package and GitHub issues

Atlas is published to npm as a single package, `@crvouga/atlas`. Other projects install it and report
what they find as GitHub issues. They never change this repository: there is no submodule workflow, and no project
pushes Atlas changes from its own checkout. Every fix and feature is made here and reaches a project
as a new version.

- **Integrating Atlas into a project?** Follow [docs/integrating.md](docs/integrating.md): it ends
  every step with a command and the output that means it worked. The exact rules of the report
  format are in [docs/report-contract.md](docs/report-contract.md).
- **Working in a project that uses Atlas?** Read [docs/dogfooding.md](docs/dogfooding.md). Install
  `@crvouga/atlas` from npm. Do not edit Atlas from there: no submodule, no
  vendored copy, no patch to `node_modules`. When Atlas is wrong or is missing something, file an
  issue with [docs/reporting-issues.md](docs/reporting-issues.md).
- **Working in this repository?** Issues labelled `agent-reported` are the queue from those projects
  (templates in `.github/ISSUE_TEMPLATE/`, labels in `.github/labels.json`). Reproduce the report,
  add a failing regression test, fix it, and put `Fixes #<issue>` in the commit body: the release
  that carries the fix then comments on the issue with the version to upgrade to.

Keep consumer-specific specs, configuration, fixtures and generated runs in the consumer
repository. Change Atlas only for reusable library, driver, schema, documentation or tooling
improvements.

## Resolve all open GitHub issues in one PR

When asked to resolve the whole issue backlog in a single PR, use the repository skill at
[`.agents/skills/resolve-open-issues/SKILL.md`](.agents/skills/resolve-open-issues/SKILL.md).
It keeps the work in one branch and worktree, inventories every open issue, tracks per-issue
evidence and blockers, and handles PR attestations autonomously. It applies to a requested issue
sweep, not ordinary single-issue work or creating the skill itself. See
[the portable invocation](docs/agents.md#resolve-this-repositorys-open-issues) for agents that do not
discover repository skills automatically.

## One package, many entry points

The folders under `packages/` are source folders of the one package, not packages: there is one
`package.json`, at the root, and it maps each import path (`@crvouga/atlas/playwright`,
`@crvouga/atlas/reports/<module>`, …) to a folder. Do not add a `package.json` under `packages/`
or publish a second package.

- Library code imports other library code by relative path (`../../core/src/index`), never by the
  package's own name. The visualizer, an app that runs from source wherever the package is
  installed, is the exception: it imports `@crvouga/atlas/…` like any project that uses Atlas.
- Keep the package tree-shakeable: no work at import time and no `import './x'` for its side
  effect in library code. `sideEffects` in `package.json` promises this to bundlers, and
  `bun run release:smoke` checks it with one.
- A new import path goes in both `exports` (the source) and `publishConfig.exports` (the build).
  See [docs/releasing.md](docs/releasing.md#one-package-many-entry-points).

## Agent IDE workspaces

Read [workspace development](docs/workspaces.md) for Superset, super.engineering and Orca. Shared
commands are `bun run workspace:setup`, `workspace:run`, `workspace:preview`, `workspace:status`,
`workspace:stop` and `workspace:check`. Discover the actual URL from status; default ports may be busy.
Keep `.atlas-workspace/` and dependencies private to each checkout. Setup needs no
credentials and must stay idempotent; `workspace:run` needs the S3 variables of `.env.example`, because the server keeps
all reports and user state in S3 only. Preserve the three IDE configs when changing lifecycle commands;
run `bun test scripts/workspace.test.ts`. Use documented IDE CLIs for app-owned configuration. Setup
must not launch agents, change their permissions or silently install a different Bun version.

## UI changes: React and Mantine

Read [the UI conventions](docs/ui.md) before changing the viewer or settings. Use Mantine's installed
component inventory and official documentation for unfamiliar interactions. `packages/visualizer/src/ui/theme.tsx`
is the only theme/provider setup. Compose Mantine directly using its defaults and existing product compositions;
do not invent sizes, colors, primitives, token systems, styling dependencies or per-screen CSS. Use
`@tabler/icons-react` for UI glyphs and `SpecLogo` for sourced spec marks; never hand-draw icons or use
text glyphs as icon controls. Layouts use
AppShell/Container, Stack/Group and responsive Mantine props. Keep labels, focus, keyboard behavior, error/retry,
loading and empty states accessible. New CSS or inline styling needs a concrete limitation documented in the
conventions' exception list. Run the UI type check, DOM suite, architecture test and client build listed there,
regenerate docs, and inspect desktop/mobile behavior. `scripts/ui-architecture.test.ts` enforces these boundaries.

## The report contract is stable

The layer document, the way layers compose, the `ObjectStore` interface and the `atlas report status`
JSON are what other projects build on. Change them only as [the report
contract](docs/report-contract.md#versioning-and-stability) allows.

- Within a schema version, only add optional fields. Never change what a field means, a status, the
  slot a result fills, or the order in which results win. That is a new `schemaVersion`, a `!` commit
  and a migration note.
- `packages/reports/tests/fixtures/layer-v1.json` and `composition-laws.test.ts` guard the contract.
  Never edit the fixture to make a test pass; fix the code.
- After changing a Zod schema in `packages/schema/src`, run `bun run schemas` and commit the JSON
  Schemas: a test fails when they differ.
- A reader must treat what it cannot read as unknown, never as passed.
- Evidence (attachments, steps, annotations, attempts, tags, labels, links, `extensions`) is where the format
  grows, and it grows only as [docs/extending.md](docs/extending.md) allows: optional fields, open objects, open
  vocabularies, nothing that decides a result. To add a kind of evidence, add it to
  `layer-v1-extended.json` and keep `layer-extensibility.test.ts` passing. Never close a vocabulary, never make
  an evidence field required, never let evidence change a status, a slot or a winner.
- Attachment bytes are untrusted. Serve them only through `attachment-response.ts`.

## The server is a living application, and a protocol

`packages/server` (`atlas serve`, `atlas dev`, `@crvouga/atlas/server`) is a Bun API that serves the viewer from the
same host; clients upload to it and viewers stream from it ([docs/server.md](docs/server.md)). Older and newer
clients, viewers and servers meet over its HTTP API, so treat that API like the report contract.

- Within a version of the API (`/api/store`, `/api/events`, `/api/status`, `/api/reports/*`, `/api/checks`) only add:
  optional parameters, optional response fields, new events. Never change what an existing one means. A viewer or CLI
  that does not know a new field must still work, and a server that does not know a new parameter (like `?since=`)
  must be answered with the whole thing.
- The server may refuse an upload, never alter one. Everything it checks (`validate.ts`) is what would corrupt the
  report for everyone: keep it checking, and keep it cheap.
- Uploading needs a Bearer token; a browser's sign-in box may only look. Do not weaken that.
- The incremental report (`report-index.ts`) must always equal combining every layer from scratch, and
  `applyEffectiveDelta(held, delta)` must equal the full report. Both are tested over random runs: keep them passing.
- Performance is a feature here. Before and after a change to the index, the upload path or the viewer's data
  loading, run `ATLAS_BENCH_DIR=/tmp/atlas-bench bun packages/server/bench/bench.ts 2000 100` and do not make
  the numbers worse. Speed never buys a weaker guarantee: keep the code as simple as the numbers allow.

## The UI catalog is a contract with a budget

The UI catalog (`packages/reports/src/ui-catalog*.ts`, `ui-state.ts`, the viewer's `catalog/`, `GET /api/reports/ui-catalog`, `atlas ui-catalog`)
is read by viewers, critics and other projects, so it follows the same rule as the report contract: [only optional additions within version
1](docs/ui-catalog.md#stability-what-may-change-and-what-may-not).

- `packages/reports/tests/fixtures/ui-catalog-v1.json` is the frozen first document and `ui-catalog-contract.test.ts` holds the code to it.
  Never edit the fixture to make a test pass; fix the code. A new fact goes in as an optional field, or as an `attribute` with no code change at all.
- Vocabularies are open: a reader ignores unknown fields and treats an unknown `coverage`, `expected` or surface `status` as not captured.
  Never close one in a schema, and never let a picture, an attribute or a plan decide a result.
- Performance is a feature. `uiCatalog` is one linear pass and `ui-catalog-performance.test.ts` fails if cost grows faster than size. Before and
  after a change to it, run `bun packages/server/bench/ui-catalog-bench.ts 5000 10` and do not make the numbers worse.
- Playwright stays in `packages/playwright`. Nothing that reads, composes or shows the catalog imports a collection framework (`scripts/ui-architecture.test.ts`).

## Documentation lives in the code, and is generated from it

An agent integrating Atlas reads generated documentation, so it must not be able to disagree with the code. The rule is
colocation: say it once, next to what it describes, and generate everything else from there.

- Every library module (`packages/*/src`) starts with a `/** @module Title … */` comment and every exported declaration
  has a doc comment (summary, parameters, failure behaviour, `@example` on entry points). `bun scripts/docs/coverage.ts`
  lists gaps; a test fails on any. Write the comment when you write the code.
- Generated, never edited by hand: `docs/reference/*.md` (from those comments, the usage text and the operation table),
  `packages/server/openapi.json`, `llms.txt`, `llms-full.txt`, the JSON Schemas (`bun run schemas`), and the blocks between
  `<!-- generated:NAME -->` markers in the guides. After changing a comment, a route, a setting, a schema or a command's
  usage, run `bun run docs` (it also emits JSON Schemas) and commit the result. `bun run docs:check` is the explicit CI gate;
  it rejects stale or obsolete outputs, missing generation markers, broken links and mismatched executable instructions.
- A new HTTP route needs an operation in `packages/server/src/openapi.ts` (a test fails if a route is undescribed). A new
  server setting needs a row in `SERVER_SETTINGS` with an example that a test proves. A new command output document needs a
  Zod schema and an entry in `CLI_RESULTS` in `packages/schema/src/cli-results.ts`, plus a runtime scenario in
  `scripts/docs/cli-contract.test.ts`. The command/schema table in `docs/agents.md` is generated from that registry.
  Every command that prints a result supports `--format json`.
- Guides in `docs/` are written by hand and listed in `scripts/docs/generate.ts` (`GUIDES`) so they reach `llms.txt`; a test
  checks every relative link and anchor.

## The server stores everything in S3, and says so

`atlas serve` and `atlas dev` keep all reports and all user state (the garbage collection policy and saved settings, one
JSON document at `server/state.json`) in S3-compatible storage and nowhere else. Do not add a local-disk, memory, database
or browser-storage path for either, and do not give the required `ATLAS_S3_*` variables a default: a missing or invalid
one must stop the server with the banner of `packages/server/src/storage.ts` (every variable listed, exit 2). A new
variable goes in `S3_VARIABLES` and `.env.example`. Garbage collection is off until a policy is saved from the UI and
deletes only superseded layers (`packages/reports/src/garbage.ts`); keep both properties. Server tests run against the
in-memory S3 in `packages/server/tests/fake-s3.ts`.

## The S3 store is tested against a real server

`packages/reports/tests/s3-store.integration.test.ts` and `s3-flow.integration.test.ts` run only when
`ATLAS_TEST_S3_ENDPOINT` names an S3-protocol server (CI starts SeaweedFS in the `s3` job). To run them
locally: start one (`docker run -p 18333:8333 -v $PWD/examples/deploy/s3.json:/etc/s3.json
chrislusf/seaweedfs server -s3 -s3.config=/etc/s3.json -dir=/data`), create a bucket, and set
`ATLAS_TEST_S3_ENDPOINT=http://localhost:18333`, `ATLAS_TEST_S3_BUCKET`, `ATLAS_TEST_S3_KEY` and
`ATLAS_TEST_S3_SECRET` (the demo credentials in `examples/deploy/s3.json` are `atlaskey` / `atlassecret`).
Change `s3-store.ts` or `sigv4.ts` only with those passing: a unit test with a fake `fetch` cannot tell you
that S3 accepts your signature.

## Releases are automatic

Every push to `main` is checked and then published by `.github/workflows/ci.yml`; see
[docs/releasing.md](docs/releasing.md).

- Write [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#summary). The type
  of a commit that touches what ships (`packages/`, `package.json`, `README.md`) decides the
  release: `feat` → minor, `fix` / `perf` / `revert` / `refactor` / `build` / `docs` → patch,
  `type!` or `BREAKING CHANGE` → major, `test` / `ci` / `chore` / `style` → no release. Mark a commit breaking only when projects
  have to change their code.
- Never edit `version` (it stays `0.0.0-development`), create a release tag, or run `npm publish`.
  The version lives in `@crvouga/atlas@<version>` git tags that the release creates.
- Never add an npm token to the repository or its secrets. CI publishes through npm Trusted
  Publishing, which is pinned to the workflow filename `ci.yml`: do not rename that file.
- The first publish needs a maintainer to run `bun run release:seed` once. If the Release job says
  so, tell the human; do not try to work around it.

## Working on `main` safely

A commit on `main` is a release, so prefer a pull request: CI checks the change before it lands.
Nothing is published from a commit whose checks fail, however it got there.

- Never force-push, destructively reset, or overwrite or discard changes merely because someone else
  made them.
- Resolve each conflict hunk by hunk. Never take one side's whole file or directory
  (`git checkout --ours` / `--theirs`, `-X ours` / `-X theirs`): that once replaced a redesigned
  explorer with the interface it superseded while every check stayed green. Before pushing a merge,
  compare the result with each parent (`git diff --stat <parent> HEAD`) and account for every file
  that lost a parent's change.

## Everything runs on Bun

Bun is the package manager, the script runner, the runtime and the test runner of this repository,
at the version `packageManager` names in `package.json`.

- Install with `bun install` and commit `bun.lock`. Never add a `pnpm-lock.yaml`,
  `package-lock.json` or `yarn.lock`, and do not install with `npm`, `pnpm` or `yarn` here.
- Run scripts and files with `bun` (`bun run <script>`, `bun path/to/file.ts`, `bunx <tool>`), not
  `node`, `npx` or `tsx`.
- Write tests for `bun test` (`import { describe, expect, it } from 'bun:test'`). Do not add
  Vitest or Jest.
- The published package is a different matter: projects install it with any package manager and
  run it on Bun or Node. Keep library code free of Bun-only APIs unless it is the Bun driver, and
  keep `tsx`, which is how the `atlas` command loads a TypeScript config on Node. Node appears in
  this repository in exactly two places: the consumer smoke, which runs the packed package on
  Node as well as Bun, and the release, which publishes with the npm CLI because npm Trusted
  Publishing requires it.

## Repository checks

From this repository's root:

<!-- generated:repository-checks -->
```sh
bun install --frozen-lockfile
bun run docs:check
bun run type-check
bun run test
bun run build
bun run release:smoke
```
<!-- /generated:repository-checks -->

This check list is generated from CI's `check` job. After any code, configuration, documentation or agent-guidance
change, run `bun run docs` to regenerate docs and schemas, then `bun run docs:check`. It checks required generation
markers, stale and obsolete outputs, documentation coverage, links, schemas, CLI help and executable agent flows.
Keep factual tables in generated blocks and annotate runnable walkthroughs for the documentation smoke checks.
Prose still needs review: when behaviour changes, update its explanation and add a regression that exercises it.

`bun run test` is the whole suite: `bun test`, then the viewer's DOM tests
(`packages/visualizer/tests`), which need a browser-like global scope and so run on their own with a
preload. Run the checks relevant to what you changed while iterating (`bun test packages/core`,
`bunx tsc --noEmit -p packages/core`), then run the full set before pushing. `bun run release:smoke`
installs the packed tarball into a clean project, imports every entry point under Bun and under
plain Node, and bundles one to check tree shaking; it is the check that catches a package that works in this
repository and breaks when installed from npm. Run it after `bun run build` whenever `exports`,
`files`, `bin` or the dependencies change.
