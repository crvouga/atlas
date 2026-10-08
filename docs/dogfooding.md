# Dogfooding Atlas from another project

Atlas is currently developed by integrating it into real projects. Until its packages are stable
and published to npm, the supported development setup is a Git submodule plus a pnpm workspace
link. This gives the consumer an explicit, reproducible Atlas commit while still making it easy to
send generally useful fixes back upstream.

This repository is shared development infrastructure. Agents in several consumer projects may be
working on it and pushing changes concurrently.

## Add Atlas to a consumer project

The examples below use `vendor/atlas`. A project may choose another stable path, but it should use
the same path everywhere in that project.

```sh
git submodule add https://github.com/crvouga/atlas.git vendor/atlas
git submodule update --init --recursive
```

Commit both `.gitmodules` and the `vendor/atlas` gitlink. Do not copy Atlas source files into the
consumer repository.

Atlas currently requires Node 22.18 or later and pnpm 10. Add its packages to the consumer's
`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*                 # the consumer's existing workspace entries
  - vendor/atlas/packages/*    # Atlas packages
```

Then declare only the packages the consuming app or package needs, using the workspace protocol:

```json
{
  "devDependencies": {
    "@crvouga/atlas": "workspace:*",
    "@crvouga/atlas-playwright": "workspace:*"
  }
}
```

Other available packages are `@crvouga/atlas-vitest`, `@crvouga/atlas-detox`, and
`@crvouga/atlas-schema`. Install the consumer workspace normally after changing its manifest:

```sh
pnpm install
```

Keep the product's `atlas.config.ts`, specs, implementation, fixtures, and generated `atlas-runs/`
in the consumer project. The submodule contains the reusable Atlas implementation only.

## Initialize an existing clone

After cloning a consumer project, or after switching to a commit that changes the Atlas pointer:

```sh
git submodule update --init --recursive
pnpm install
```

The consumer repository pins one exact Atlas commit. Do not silently track whatever happens to be
latest on `main`; update the pointer in a normal, reviewable consumer commit.

## Contribute an integration fix to Atlas

First decide where the change belongs:

- Product-specific behavior stays in the consumer repository.
- Reusable library, driver, schema, documentation, or tooling behavior belongs in Atlas.

From the consumer repository, prepare the submodule for an Atlas change. A freshly initialized
submodule is usually on a detached HEAD, so always create a branch before committing:

```sh
git -C vendor/atlas status --short --branch
git -C vendor/atlas fetch origin
git -C vendor/atlas switch -c dogfood/<consumer>-<change> origin/main
```

Use a unique, descriptive branch name because agents in other projects are doing the same work.
Make the change inside `vendor/atlas`, add or update Atlas tests, and validate it from the Atlas
root:

```sh
pnpm -C vendor/atlas install --frozen-lockfile
pnpm -C vendor/atlas type-check
pnpm -C vendor/atlas test
pnpm -C vendor/atlas build
```

Before pushing, account for concurrent work:

```sh
git -C vendor/atlas fetch origin
git -C vendor/atlas rebase origin/main
# Rerun the relevant checks after any rebase or conflict resolution.
git -C vendor/atlas push -u origin HEAD
```

Open and merge the Atlas change through the repository's normal review flow. Do not force-push over
someone else's branch or push directly to `main`. If upstream moved, fetch, rebase, revalidate, and
retry. Resolve conflicts according to intended behavior; never discard an unfamiliar change just
to make the rebase pass.

Only after the Atlas commit is pushed and merged should the consumer move its submodule pointer to
the merged commit:

```sh
git -C vendor/atlas fetch origin
git -C vendor/atlas switch --detach origin/main
git add vendor/atlas
git commit -m "chore: update Atlas submodule"
```

This ordering matters: another clone must be able to fetch the exact Atlas commit recorded by the
consumer. The consumer change should describe the Atlas behavior it now relies on and link the
corresponding Atlas change when possible.

## Update Atlas without changing it

To deliberately advance a consumer to the current upstream `main`:

```sh
git -C vendor/atlas status --short
git -C vendor/atlas fetch origin
git -C vendor/atlas switch --detach origin/main
pnpm install
```

Review and test the consumer, then commit its updated `vendor/atlas` pointer. Stop if the first
command shows local Atlas changes; preserve or publish that work before moving the submodule.

## Rules that keep concurrent dogfooding safe

1. Fetch before starting and immediately before publishing Atlas work.
2. Never commit Atlas work on a detached HEAD.
3. Use a new branch based on `origin/main` for each independent change.
4. Keep each Atlas change reusable and focused; do not add a consumer project's private behavior.
5. Push the Atlas commit before recording it in a consumer repository.
6. Never use a force push or destructive reset to erase concurrent work.
7. Re-run Atlas checks after rebasing, then test the consuming integration before updating its
   pointer.
8. Commit submodule pointer updates explicitly so every consumer upgrade is reproducible and
   reviewable.

## Later npm migration

The submodule and workspace link are intentionally temporary. Once the Atlas packages are
published, consumers will replace `workspace:*` entries with released versions, remove the Atlas
workspace glob and submodule, and commit the dependency lockfile. Until that release is documented,
continue using the pinned submodule workflow above.
