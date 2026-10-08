# Agent guidance

## Development phase: dogfooding through submodules

Atlas is not published to npm yet. During this phase, other projects consume this repository as a
Git submodule and contribute fixes discovered during real integrations back to this repository.
Treat those projects as active development environments for Atlas, not as vendored copies.

Read [docs/dogfooding.md](docs/dogfooding.md) before integrating Atlas into another project or
changing Atlas from inside a consumer project's submodule.

Assume other agents working in other consumer projects may push Atlas changes at any time:

- Fetch `origin` before starting and again immediately before publishing a change.
- Develop on a short-lived, uniquely named branch based on the latest `origin/main`; submodules
  commonly start on a detached HEAD, so do not commit there.
- Rebase onto the latest `origin/main`, resolve conflicts deliberately, and rerun relevant checks.
- Never force-push a shared branch and never overwrite or discard changes merely because they came
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
