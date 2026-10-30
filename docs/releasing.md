# Releasing

How Atlas gets from `main` to npm and to its server container image. Atlas is one npm package with one
version. npm releases are automatic after the initial seed; the server image is published on every green
push to `main`, regardless of whether a new npm version is needed.

## What happens on every push to `main`

The [CI workflow](../.github/workflows/ci.yml) checks the commit (`type-check`, `test`, `build`, and
the consumer smoke, which installs the packed tarball into a clean project), and then its Release
job publishes. A commit that fails its checks publishes nothing, however it reached `main`.

### Server image

Every run ends with a **CI summary** job, including failed runs and runs with skipped jobs. Its **Atlas CI**
summary lists job results, check coverage, log/artifact links and npm release plans with their outcome. The
Docker section provides copyable Railway image URIs: `latest` when updated, this run's full commit tag and
the registry digest confirmed after pushing. It distinguishes PR builds, unsuccessful publication and an
older run that left `latest` to a newer main commit. Railway settings are included beside the image URI.
All workflows pin Ubuntu 24.04 and use Node 24 versions of GitHub's JavaScript actions to avoid implicit
runner migrations and deprecated action runtimes.

The **Server image** job also builds the root
[`Dockerfile`](https://github.com/crvouga/atlas/blob/main/Dockerfile) from that exact checkout, including the
viewer, and runs `bun scripts/container-smoke.ts <image>` against it. The smoke proves readiness, viewer
assets and admin styling, upload authentication, Railway's `PORT`, the Docker healthcheck, reports and saved
settings surviving container replacement, root-owned Railway volumes, and clean shutdown on SIGTERM. Pull requests build and test the
image without publishing it. The **Insecure server image** job builds the same Dockerfile's `insecure`
target and runs `bun scripts/container-smoke.ts <image> --insecure`, proving anonymous viewing, uploads
and admin settings, with the same persistence, healthcheck and shutdown checks.

After checks and the container smoke pass, the job publishes the tested Linux AMD64 image to the personal
GitHub Container Registry as `ghcr.io/crvouga/atlas:<full-commit-sha>` and `:latest`. This uses the same
personal registry as the workspace repository, with no reusable hosting workflow or deployment dispatch.
The insecure job publishes `ghcr.io/crvouga/atlas-insecure:<full-commit-sha>` and `:latest` independently,
after its own smoke passes. Both jobs report their confirmed publication references in the CI summary.
Publication uses the built-in `GITHUB_TOKEN` with `packages: write`; no Docker Hub login, PAT or new repository
secret is needed. Image publication is independent of the npm release job and also runs for docs/CI-only
commits. Jobs serialize publication; an outdated run publishes its SHA tag but leaves `latest` to the current
`main` commit, so a late run cannot roll it back. Manual dispatch and scheduled CI runs can retry a failed push.

**Once, after the first image publish:** open the
[GHCR package settings](https://github.com/users/crvouga/packages/container/atlas/settings) and
set its visibility to **Public**, so Railway and other projects can pull it without registry credentials.
Do the same for the separate [atlas-insecure package settings](https://github.com/users/crvouga/packages/container/atlas-insecure/settings)
after its first publish.
GHCR creates new packages as private even for a public source repository
([GitHub's registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#pushing-container-images)).
The image's source label links it to this repository. Verify public access without logging in:

```sh
docker run --rm --pull always --entrypoint bun ghcr.io/crvouga/atlas:latest --version
docker run --rm --pull always --entrypoint bun ghcr.io/crvouga/atlas-insecure:latest --version
```

Run that command on a machine with no GHCR login. A Bun version and exit 0 prove an anonymous pull and
startup. If this one-time visibility step is unavailable, Railway needs GHCR read credentials until it is done.
The [deployment guide](deploying.md#run-it) covers selecting the image, the volume and Railway auto updates.

For a local container check:

```sh
docker build -t atlas-server:local .
bun scripts/container-smoke.ts atlas-server:local
docker build --target insecure -t atlas-insecure:local .
bun scripts/container-smoke.ts atlas-insecure:local --insecure
```

The Dockerfile's pinned `BUN_VERSION` must match `packageManager` when upgrading Bun.

### npm package

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

## The one manual step: `bun scripts/release/seed.ts`

OIDC can publish a new version of a package, but it cannot create a package that is not on npm yet.
So a maintainer runs one command, once, with their own npm login:

```sh
bun scripts/release/seed.ts
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

`bun run build` compiles every `packages/*/src` (except the Atlas client, an app that ships as source)
into `dist/<folder>/src`, one JavaScript module per source module, with the `.js` extensions Node
needs on relative imports ([scripts/build-package.ts](../scripts/build-package.ts)).

Tree shaking depends on three things, and the consumer smoke checks the result with a real bundler:

- The output is unbundled ES modules, so a bundler can drop a module nobody imports.
- `sideEffects` in `package.json` declares everything side-effect free except the Atlas client app
  and stylesheets. A library module that does work at import time breaks that promise: do not add
  one, and never write `import './something'` for its effect in library code.
- Each part has its own entry point, and none of them imports another part's: importing one driver
  does not pull in the others, the reports or the Atlas client.

To add an entry point, add its source folder under `packages/`, then its path to both `exports`
and `publishConfig.exports`. To ship a file that is not compiled, add it to `files`.
`bun run build && bun run smoke` proves the result installs, imports and shakes from a tarball.

Runtime dependencies of every part are `dependencies` of the one package. A tool only some projects
drive (`playwright`, `detox`) is an optional peer dependency instead, so nobody installs a browser
toolchain they do not use.

## Commands

```sh
bun scripts/release/plan.ts                # what the next push to main would release
bun scripts/release/publish.ts --dry-run   # plan + pack the tarball, no side effects
bun run smoke               # install the packed tarball into a clean project (after bun run build)
bun scripts/release/seed.ts --dry-run      # what the seed would publish, from origin/main
bun scripts/release/seed.ts                # first publish, and attach the Trusted Publisher
bun scripts/health/cli.ts                      # whether the Trusted Publisher still needs fixing, with its link
```

## When a release fails

| The Release job says | Do |
| --- | --- |
| `initial npm package(s) need an interactive local seed` | `bun scripts/release/seed.ts` |
| `rejected by npm Trusted Publishing` | `bun scripts/release/seed.ts` (it re-attaches the publisher); `bun scripts/health/cli.ts` shows what is still wrong |
| `GitHub release(s) still missing` | nothing: the next run creates them. To do it now, `gh workflow run ci.yml` |
| `names entry points the tarball does not contain` | `exports`, `bin` or `files` in `package.json` is wrong; `bun run build && bun run smoke` reproduces it |
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
| `GITHUB_TOKEN` with `packages: write` | built into GitHub Actions, Server image job | personal GHCR image publish |
| Your npm login | your machine (`npm login`) | `bun scripts/release/seed.ts` and `bun scripts/health/cli.ts` only |

Publishing is the one job Bun does not do here: npm Trusted Publishing and provenance need the npm
CLI, so the Release job and the seed call `npm publish` on the tarball that `bun pm pack` made.

There is no npm token in the repository's secrets, and none should be added.
