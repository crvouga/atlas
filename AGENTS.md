# Agent guidance

## Development phase: dogfooding through submodules

Atlas is not published to npm yet. During this phase, other projects consume this repository as a
Git submodule and contribute fixes discovered during real integrations back to this repository.
Treat those projects as active development environments for Atlas, not as vendored copies.

Read [docs/dogfooding.md](docs/dogfooding.md) before integrating Atlas into another project or
changing Atlas from inside a consumer project's submodule.

Assume other agents working in other consumer projects may push Atlas changes at any time:

- Work only on `main`. If a submodule starts on a detached HEAD, switch to `main` before editing or
  committing. Do not create any branch.
- Keep local `main` continuously synchronized with upstream by running
  `git pull --rebase origin main` before editing, after every focused checkpoint commit during
  longer work, immediately before validation and pushing, and whenever upstream movement is
  detected. Never continue working from a known-stale checkout.
- Always expect conflicts from other projects. Resolve them deliberately on `main`, preserve the
  intent of concurrent changes, rerun relevant checks, and keep integrating until the push
  succeeds.
- Never force-push, destructively reset, or overwrite or discard changes merely because they came
  from another project.
- Commit and push the Atlas change in this repository before updating a consumer repository's
  submodule pointer. A consumer must never point at a commit that exists only locally.
- Keep consumer-specific specs, configuration, fixtures, and generated runs in the consumer
  repository. Change Atlas itself only for reusable library, driver, schema, documentation, or
  tooling improvements.

The submodule workflow is temporary. Do not replace it with an npm dependency until Atlas packages
are actually published and the repository documents the migration.

## Repository checks

Atlas requires Node 22.18 or later and pnpm 10. From this repository's root, use:

```sh
pnpm install --frozen-lockfile
pnpm type-check
pnpm test
pnpm build
```

Run the checks relevant to the changed packages while iterating, then run the full set before
publishing a cross-package change.
