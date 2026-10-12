# Agent guidance

## How Atlas is developed: one npm package and GitHub issues

Atlas is published to npm as a single package, `@crvouga/atlas`. Other projects install it and report
what they find as GitHub issues. They never change this repository: there is no submodule workflow, and no project
pushes Atlas changes from its own checkout. Every fix and feature is made here and reaches a project
as a new version.

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

```sh
bun install --frozen-lockfile
bun run type-check
bun run test
bun run build
bun run release:smoke
```

`bun run test` is the whole suite: `bun test`, then the viewer's DOM tests
(`packages/visualizer/tests`), which need a browser-like global scope and so run on their own with a
preload. Run the checks relevant to what you changed while iterating (`bun test packages/core`,
`bunx tsc --noEmit -p packages/core`), then run the full set before pushing. `bun run release:smoke`
installs the packed tarball into a clean project, imports every entry point under Bun and under
plain Node, and bundles one to check tree shaking; it is the check that catches a package that works in this
repository and breaks when installed from npm. Run it after `bun run build` whenever `exports`,
`files`, `bin` or the dependencies change.
