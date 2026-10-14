# Reference: vitest

Run a statechart plan as Vitest tests. Import path `@crvouga/atlas/vitest`.

> Generated from the doc comments of `packages/vitest/src` by `bun run docs`. Do not edit: change the comment next to the code.

### Test-runner adapter

Source: `packages/vitest/src/index.ts`. Import: `@crvouga/atlas/vitest`

Runs an Atlas config as a test suite in Vitest, `bun test` or any Jest-style runner. The runner's own
`describe`, `it`, `beforeAll` and `expect` are passed in, so this module imports no test framework
and never touches global test state. It owns the mapping from planned paths to tests; the run itself
is `runConfig` from the core.

#### `describeAtlas`

```ts
export function describeAtlas<C>(config: AtlasConfig<C>, suite: Suite, options: RunCommandOptions & { baseDirectory?: string; timeoutMs?: number } = {})
```

Registers a test suite for an Atlas config: one test that the charts are executable (no structural
lint finding), then one test per planned path, so any Vitest/Jest-style runner reports each journey
and generated path on its own. The whole plan runs once in `beforeAll` (paths share one manifest);
each test then reads its path's outcome. A failed path fails its test with the last attempt's error;
`passed` and `flaky` paths pass; a path that was `not-reached` (blocked by an event with no
implementation) or was not part of the run passes quietly.

`prepare` runs synchronously when `describeAtlas` is called, so specs that cannot be loaded throw at
collection time. The run writes its output like `atlas run` does.

- `config`: the Atlas config to run.

- `suite`: the runner's `describe`, `it`, `beforeAll` and `expect`.

- `options`: the `atlas run` options (`mode`, `paths`, `retry`, `output`, `log`, ...);
`baseDirectory` resolves relative config paths (the current directory when omitted) and `timeoutMs`
bounds the `beforeAll` (30 minutes by default). Progress lines are discarded unless `log` is given.

**Example**

```ts
import { beforeAll, describe, expect, it } from 'bun:test';
describeAtlas(config, { describe, it, beforeAll, expect });
```
