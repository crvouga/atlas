# @crvouga/atlas-vitest

Run an [Atlas](../../README.md) config as a Vitest (or any Jest-style) suite: one test that the
charts are executable, then one test per planned path.

```sh
pnpm add -D @crvouga/atlas @crvouga/atlas-vitest vitest
```

## Use

```ts
// door.test.ts
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@crvouga/atlas';
import { describeAtlas, functionDriver } from '@crvouga/atlas-vitest';
import { beforeAll, describe, expect, it } from 'vitest';

import { Door } from './door';

const config = defineConfig<Door>({
  specs: fileURLToPath(new URL('./specs', import.meta.url)),
  driver: functionDriver(() => new Door()),
  implementation: {
    setup: async () => undefined,
    events: {
      Opens: { kind: 'user', how: 'door.open()', run: async (door) => door.open() },
      Closes: { kind: 'user', how: 'door.close()', run: async (door) => door.close() }
    },
    states: {
      Closed: { recognize: async (door) => ({ matched: !door.isOpen, signals: [] }) },
      Open: { recognize: async (door) => ({ matched: door.isOpen, signals: [] }) }
    }
  }
});

describeAtlas(config, { describe, it, beforeAll, expect });
```

The whole plan runs once in `beforeAll` (so all paths share one manifest), and each test reports its
own path: a failed path fails its test with the runner's message; a path that could not be reached
because of a blocked event passes quietly and shows up in the manifest as `not-reached`.

`describeAtlas(config, suite, options)` accepts the `atlas run` options (`mode`, `paths`, `retry`,
`output`, `log`) plus `baseDirectory` (where relative config paths resolve) and `timeoutMs` for the
`beforeAll` (30 minutes by default).

`functionDriver(create)` is re-exported from `@crvouga/atlas`: it drives anything you can reach from
Node (a domain model, an API client, a CLI), with a fresh context from `create` for every path
attempt. Running the same spec through a browser driver and through `functionDriver` is a cheap way
to keep a model and its UI in agreement.

## License

MIT
