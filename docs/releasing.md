# Releasing

How `@crvouga/atlas` gets from `main` to npm. Atlas is one package with one version. Releases are
automatic; the one manual step is a single command, run once.

## What happens on every push to `main`

The [CI workflow](../.github/workflows/ci.yml) checks the commit (`type-check`, `test`, `build`, and
the consumer smoke, which installs the packed tarball into a clean project), and then its Release
job publishes. A commit that fails its checks publishes nothing, however it reached `main`.

- **Whether to release:** when a releasable Conventional Commit since the last
  `@crvouga/atlas@<version>` git tag touched what ships: `packages/`, `package.json`, `README.md`,
  or the build configuration. Changes to `docs/`, CI, the release scripts or the example release
  nothing.
- **Which version:** `feat!` / `BREAKING CHANGE` → major, `feat` → minor, `fix` / `perf` /
  `revert` / `refactor` / `build` / `docs` → patch. `test` / `ci` / `chore` / `style` never release
  on their own. The first release is `0.1.0`.
- **How:** write the published manifest → `bun pm pack` → `npm publish --provenance` through npm Trusted Publishing (OIDC) → push
  the `@crvouga/atlas@<version>` tag → GitHub Release with the notes → a comment on each issue the
  release closes.

The version lives in tags. `package.json` keeps `0.0.0-development`, nothing is committed back to
`main`, and nobody edits a version, creates a tag or runs `npm publish` by hand.

Every step is idempotent, and the workflow also runs every six hours and on manual dispatch
(`gh workflow run ci.yml`), so a release interrupted by an npm or GitHub outage finishes on its own.

## What a commit message decides

The commit type and the paths the commit touches are the whole release decision:

| Commit | Touching | Releases |
| --- | --- | --- |
| `fix(playwright): wait for the overlay` | `packages/playwright` | patch |
| `feat(core): plan by seed` | `packages/core` | minor |
| `feat(core)!: rename Driver.tap` | `packages/core` | major |
| `test(visualizer): cover the index` | `packages/visualizer` | nothing |
| `docs: explain seeds` | `docs/` only | nothing (nothing that ships changed) |

Put `Fixes #<issue>` in the commit body so the release tells that issue which version carries the
fix. Commit messages are checked by a `commit-msg` hook locally and by the Commitlint job on pull
requests. While Atlas is at `0.x`, a breaking change still takes it to `1.0.0`; mark a commit
breaking only when projects have to change their code.

## The one manual step: `bun run release:seed`

OIDC can publish a new version of a package, but it cannot create a package that is not on npm yet.
So a maintainer runs one command, once, with their own npm login:

```sh
bun run release:seed
```

It runs `npm login` if you are not logged in, builds `origin/main` in a kept worktree beside the
repository, publishes `@crvouga/atlas` for the first time, attaches `ci.yml` as its Trusted
Publisher, pushes the tag and creates the GitHub Release. When it needs you (the login, or a 2FA
approval in the browser), it rings the terminal bell and posts a desktop notification until you
answer.

It is safe to re-run: a publish, publisher, tag or release that already exists is skipped, and it
ends by naming exactly what it could not finish. CI never receives a long-lived npm token.

Until the seed has run, the Release job fails with the instruction to run it.

## One package, many entry points

Everything under `packages/` is a source folder of the one package, not a package of its own. The
root `package.json` maps each import path to it:

- `exports` points at the TypeScript sources, which is what this repository and the example use.
- `publishConfig.exports` points at `dist`. The release copies it over `exports` in the manifest it
  packs, because `bun pm pack` packs the manifest as written.

`bun run build` compiles every `packages/*/src` (except the visualizer, an app that ships as source)
into `dist/<folder>/src`, one JavaScript module per source module, with the `.js` extensions Node
needs on relative imports ([scripts/build-package.ts](../scripts/build-package.ts)).

Tree shaking depends on three things, and the consumer smoke checks the result with a real bundler:

- The output is unbundled ES modules, so a bundler can drop a module nobody imports.
- `sideEffects` in `package.json` declares everything side-effect free except the visualizer app
  and stylesheets. A library module that does work at import time breaks that promise: do not add
  one, and never write `import './something'` for its effect in library code.
- Each part has its own entry point, and none of them imports another part's: importing one driver
  does not pull in the others, the reports or the visualizer.

To add an entry point, add its source folder under `packages/`, then its path to both `exports`
and `publishConfig.exports`. To ship a file that is not compiled, add it to `files`.
`bun run build && bun run release:smoke` proves the result installs, imports and shakes from a tarball.

Runtime dependencies of every part are `dependencies` of the one package. A tool only some projects
drive (`playwright`, `detox`) is an optional peer dependency instead, so nobody installs a browser
toolchain they do not use.

## Commands

```sh
bun run release:plan                # what the next push to main would release
bun run release:publish --dry-run   # plan + pack the tarball, no side effects
bun run release:smoke               # install the packed tarball into a clean project (after bun run build)
bun run release:seed --dry-run      # what the seed would publish, from origin/main
bun run release:seed                # first publish, and attach the Trusted Publisher
bun run health                      # whether the Trusted Publisher still needs fixing, with its link
```

## When a release fails

| The Release job says | Do |
| --- | --- |
| `initial npm package(s) need an interactive local seed` | `bun run release:seed` |
| `rejected by npm Trusted Publishing` | `bun run release:seed` (it re-attaches the publisher); `bun run health` shows what is still wrong |
| `GitHub release(s) still missing` | nothing: the next run creates them. To do it now, `gh workflow run ci.yml` |
| `names entry points the tarball does not contain` | `exports`, `bin` or `files` in `package.json` is wrong; `bun run build && bun run release:smoke` reproduces it |
| `check` failed, so Release did not run | fix `main`; the next green commit releases everything that is pending |

### Trusted Publisher settings

The seed sets these. The manual equivalent, at
<https://www.npmjs.com/package/@crvouga/atlas/access>:

- Organization or user: `crvouga`
- Repository: `atlas`
- Workflow filename: `ci.yml`
- Environment: (empty)
- Allowed actions: npm publish

The publisher is pinned to the workflow's filename, so `.github/workflows/ci.yml` must keep its
name. Docs: <https://docs.npmjs.com/trusted-publishers>

## Credentials

| Credential | Where | Needed for |
| --- | --- | --- |
| npm Trusted Publisher (OIDC) | the package on npm | CI publish (attached by the seed) |
| `GITHUB_TOKEN` | built into GitHub Actions | tags, GitHub Releases, issue comments |
| Your npm login | your machine (`npm login`) | `bun run release:seed` and `bun run health` only |

Publishing is the one job Bun does not do here: npm Trusted Publishing and provenance need the npm
CLI, so the Release job and the seed call `npm publish` on the tarball that `bun pm pack` made.

There is no npm token in the repository's secrets, and none should be added.
