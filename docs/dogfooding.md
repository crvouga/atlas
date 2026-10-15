# Dogfooding Atlas from another project

Atlas is developed by using it in real projects. Those projects install one released package from
npm, `@crvouga/atlas`, and report what they find as GitHub issues. They never change Atlas. Every
fix and feature is made in this repository and reaches a project as a new version.

This replaces the Git submodule workflow. Several projects pushing to one `main` through their
submodules lost work and mixed unrelated changes together. If your project still has
`vendor/atlas`, follow [Migrating from the submodule](#migrating-from-the-submodule).

This guide is written for people and coding agents working in a project that uses Atlas. To set
Atlas up in a project, follow [integrating Atlas](integrating.md): it takes a project from nothing to
a layered, gated report of its specs. This page is about the relationship with Atlas itself: install,
upgrade, and what to do when something is wrong.

## The rules

1. Install Atlas from npm. No submodule, no vendored copy, no `git` or `file:` dependency.
2. Never change Atlas from your project: do not edit `node_modules`, do not keep a patch
   (`bun patch`, `pnpm patch`, `patch-package`), do not clone this repository to push a fix.
3. When Atlas is wrong or is missing something, [file an issue](reporting-issues.md). A workaround
   in your own code is fine while you wait; say so in the issue.
4. Upgrade Atlas in a commit of its own.

## Install

<!-- generated:runtime-requirements -->
Supported runtimes (from `package.json`): **node `>=22.18.0`** or **bun `>=1.2.0`**. Node consumers do not need Bun unless they use the Bun WebView driver.
<!-- /generated:runtime-requirements -->

It is one package:

```sh
bun add -d @crvouga/atlas
```

The commands in this guide use Bun. Any package manager installs it the same way
(`pnpm add -D`, `npm install -D`); use the one your project already has.

Everything is in it, each part behind its own import path. A bundler keeps only what you import,
and nothing runs just because the package is installed.

| Import | What it is |
| --- | --- |
| `@crvouga/atlas` | Specs, lint, planning, the runner, `httpDriver`, `functionDriver`, reports, `defineConfig`. |
| `@crvouga/atlas/spec` | The browser-safe subset for loading and composing charts. |
| `@crvouga/atlas/signals` | Driver-neutral signals (`role`, `text`, `label`, `screen`). |
| `@crvouga/atlas/playwright` | The Playwright driver. Also install `playwright`. |
| `@crvouga/atlas/bun` | The Bun WebView driver. |
| `@crvouga/atlas/webdriver` | The WebDriver and Appium driver. |
| `@crvouga/atlas/detox` | The Detox driver. Also install `detox`. |
| `@crvouga/atlas/vitest` | Each planned path as a test in Vitest, `bun test` or any Jest-style runner. |
| `@crvouga/atlas/schema` | Zod schemas for layers, check files, report status, manifests, timelines and the runs index. |
| `@crvouga/atlas/schemas/<name>.schema.json` | The same contract as JSON Schema files. |
| `@crvouga/atlas/reports/<module>` | Publishing, storing, combining, gating and serving test evidence for specs of any kind. |

It also installs two commands: `atlas` (report, lint, plan, run, merge, export) and
`atlas client` (browse specs, runs and reports).

`playwright` and `detox` are optional peers: install the one your driver uses, as above. The
documentation ships in the package, matching the version you installed: the README of each part at
`node_modules/@crvouga/atlas/packages/<part>/README.md`, and these guides at
`node_modules/@crvouga/atlas/docs/` (`integrating.md`, `deploying.md`, `extending.md`, `report-contract.md`,
`report-backends.md`, `statecharts.md`, `dogfooding.md`, `reporting-issues.md`).

Your `atlas.config.ts`, specs, implementation, fixtures and generated `atlas-runs/` stay in your
project. Import only the paths in the table; files under the package's `dist` or `packages` are not
part of its interface.

## Upgrade

Every releasable change that lands on Atlas's `main` is published within minutes; nobody cuts
releases by hand ([releasing.md](https://github.com/crvouga/atlas/blob/main/docs/releasing.md)). There is one package and one version, so an upgrade
is one line:

```sh
bun update @crvouga/atlas --latest
```

Run your Atlas checks, then commit the manifests and lockfile on their own so an upgrade is easy to
find and to revert.

To see what changed:

```sh
npm view @crvouga/atlas version                       # the newest release
cat node_modules/@crvouga/atlas/CHANGELOG.md          # every release up to the version you have
```

Each release is also a [GitHub Release](https://github.com/crvouga/atlas/releases) with the same
notes. Versions follow semver; a breaking change is a major version, and its notes say what to
change.

## When something is wrong or missing

File an issue: [reporting-issues.md](reporting-issues.md) has the kinds, the title format, what to
leave out, and the `gh` command. One issue per bug or missing feature.

When the fix is merged, the release that carries it comments on the issue with the version to
upgrade to. Upgrade, remove your workaround, and you are done.

Do not wait silently and do not quietly work around Atlas in your project. The issue is how the
problem gets fixed for every project that uses it.

## Migrating from the submodule

Do this once per project. Check first that the package is on npm:
`npm view @crvouga/atlas version` prints a version.

1. **Save anything that only exists in the submodule.** Nothing may be pushed from it any more.

   ```sh
   git -C vendor/atlas status --short
   git -C vendor/atlas log --oneline origin/main..HEAD
   ```

   If either prints something, save it as a patch and attach it to an issue that describes what it
   is for, so it is redone in Atlas instead of being lost:

   ```sh
   git -C vendor/atlas fetch origin main
   git -C vendor/atlas diff origin/main > atlas-local-changes.patch
   ```

2. **Remove the submodule.**

   ```sh
   git submodule deinit -f vendor/atlas
   git rm -f vendor/atlas
   rm -rf .git/modules/vendor/atlas
   ```

   `git rm` also removes its entry from `.gitmodules`; delete the file if it is now empty.

3. **Remove the workspace link.** Delete the `vendor/atlas/packages/*` entry from your workspace
   list (`pnpm-workspace.yaml`, or `workspaces` in `package.json`).

4. **Depend on the one released package.** In every `package.json`, remove each
   `"@crvouga/atlas-…": "workspace:*"` entry, and in each of those package directories add the
   package with your project's package manager:

   ```sh
   bun add -d @crvouga/atlas@latest     # or: pnpm add -D @crvouga/atlas@latest
   ```

5. **Rename the imports.** The separate packages are now paths of `@crvouga/atlas`:

   | Before | After |
   | --- | --- |
   | `@crvouga/atlas-playwright` | `@crvouga/atlas/playwright` |
   | `@crvouga/atlas-bun` | `@crvouga/atlas/bun` |
   | `@crvouga/atlas-webdriver` | `@crvouga/atlas/webdriver` |
   | `@crvouga/atlas-detox` | `@crvouga/atlas/detox` |
   | `@crvouga/atlas-vitest` | `@crvouga/atlas/vitest` |
   | `@crvouga/atlas-schema` | `@crvouga/atlas/schema` |
   | `@crvouga/atlas-schema/schemas/<file>` | `@crvouga/atlas/schemas/<file>` |
   | `@crvouga/atlas-reports/<module>` | `@crvouga/atlas/reports/<module>` |
   | `@crvouga/atlas client` (the `atlas client` command) | installed with `@crvouga/atlas` |

   `@crvouga/atlas`, `@crvouga/atlas/spec` and `@crvouga/atlas/signals` are unchanged. One pass
   over a project's sources does the rest:

   ```sh
   git grep -lE "@crvouga/atlas-(playwright|bun|webdriver|detox|vitest|schema|reports)" -- '*.ts' '*.tsx' '*.mts' '*.mjs' \
     | xargs perl -pi -e 's{\@crvouga/atlas-schema/schemas/}{\@crvouga/atlas/schemas/}g; s{\@crvouga/atlas-(playwright|bun|webdriver|detox|vitest|schema|reports)\b}{\@crvouga/atlas/$1}g'
   ```

6. **Install and check.**

   ```sh
   bun install     # or: pnpm install
   ```

   Run your type-check and your Atlas lint, run and visualizer commands. Anything that worked
   through the submodule and does not work from npm is a bug: [file it](reporting-issues.md).

7. **Commit** the removed submodule, the workspace file, the manifests, the renamed imports and the
   lockfile together. Remove any instructions in your project's own agent guidance that describe
   editing Atlas through `vendor/atlas`, and point them at this guide.
