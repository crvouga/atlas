# Atlas in agent IDEs

This guide develops **this repository** in Superset, super.engineering or Orca. Consumer projects
install the npm package and follow [integrating](integrating.md).

## Six commands

All manual package commands have one short name:

| Command | Purpose |
| --- | --- |
| `bun run dev` | The only development command: start services, populate examples, keep the viewer running. |
| `bun run check` | Run all checks: documentation contracts, types, tests, package build, viewer build and consumer smoke. |
| `bun run test` | Run the full Bun suite and the isolated viewer DOM suite. |
| `bun run build` | Build the publishable package. |
| `bun run docs` | Regenerate documentation and JSON Schemas; `--check` verifies all documentation contracts. |
| `bun run smoke` | Install the packed package in a clean consumer and verify Bun, Node, imports, types, tree shaking and CLI flows. |

`bun run check --only docs|types|test|build|client|smoke` selects one verification group. The default stops at
the first failed group. CI still runs the individual gates explicitly, with release depending on the same checked commit.
`prepare` is Bun's automatic Husky install hook, not another manual command.

## Development

Install the Bun version named by `packageManager` in [package.json](../package.json), then run:

```sh
bun run dev
```

The same command is the default Run target in every supported agent IDE. It checks dependencies, starts the real
Atlas API and hot-reloading viewer, starts persistent local S3 when needed, prepares Chromium and a checkout-local
FFmpeg, and runs the complete example workflow. Multi-client journeys, statecharts, Gherkin and Quint documents,
recordings and uploads retain their existing sequence; an earlier suite's failure never skips the remaining suites.
The todo app's UI catalog is also populated: seven real states (welcome, naming, empty, active, offline,
pending sync and completed), each captured in desktop and mobile profiles. Plans declare the expected set and
surface coverage; screenshots and their provenance are uploaded with the other reports. **UI catalog** then appears
in the viewer's spec-type menu. A failed capture remains a named failure and fails population.
The example drivers start and stop their own application servers on isolated ports.

Open the printed `Atlas server ready:` URL; `/admin` opens settings. The workflow publishes to the discovered URL
under `todo-app` unless `ATLAS_PROJECT` is set. It never assumes the default Atlas port. Browser and recording
binaries are downloaded only when absent. Explicit browser/WebDriver configurations keep their existing requirements.

When dev owns the server, `bun run dev --status` reports population as `running`, `complete` or `failed`.
After population the server stays available for browsing, including when a suite fails, so failed evidence can be
inspected. A failed workflow exits nonzero when stopped. With an already-running workspace server, dev reuses it,
populates it and exits without stopping its owner.

The existing development workflows are modes of that same command:

| Mode | Behavior |
| --- | --- |
| `bun run dev --server` | Start the server without running examples. |
| `bun run dev --preview` | Start the separate viewer with bundled example evidence; do not alter the real server's data. |
| `bun run dev --setup` | Perform a frozen install, repairing dependencies if needed. |
| `bun run dev --status` | Print this checkout's live URLs and population state, excluding private control credentials. |
| `bun run dev --stop` | Stop owned services, retaining their data. Add `server` or `preview` to stop one target. |
| `bun run dev --help` | Show modes and usage without starting services. |

The preview reads `examples/todo/specs` and the existing example-evidence adapter. Existing recordings appear when
present; preview and setup do not run browsers, model checkers or generate recordings. Setup never launches agents,
changes their permissions or installs another Bun version.

The lower-level workflows remain available through their source files instead of package aliases:
`bun scripts/examples.ts all` runs both example suites against an existing server; `run` and `clients` select one.
`bun examples/todo/publish.ts` uploads already-recorded results without rerunning suites. Spec linting, planning and
fast-mode execution use the existing Atlas CLI, as described in [statecharts](statecharts.md).
Release and health maintenance use `scripts/release/*.ts` and `scripts/health/cli.ts`; see [releasing](https://github.com/crvouga/atlas/blob/main/docs/releasing.md).
Viewer fixture generation and data publishing remain `packages/visualizer/scripts/make-fixtures.ts` and
`packages/visualizer/scripts/publish-data.ts`.

## Ownership, storage and ports

Dev stays in the foreground when it starts a server, so the IDE owns its lifetime. Ctrl+C or Stop closes the owned
server and active example processes. Teardown uses a random private control capability under `.atlas-workspace/`;
it never kills a PID read from a file or stops another checkout's services. Reports and saved state survive teardown.

Atlas tries port 5180 and preview tries 5181, then selects a free port if the default is busy. An explicit `--port`,
`ATLAS_PORT` or `PORT` (in that order) is strict: conflicts fail instead of publishing to another app. `--port 0`
requests a free port. Discover the actual URLs with status:

```sh
bun run dev --port 5280
bun run dev --status
```

Everything binds to `127.0.0.1`; use IDE port forwarding remotely. Atlas still reads and writes reports and user
state through S3 only. With no `ATLAS_S3_*` configuration, dev starts
[Mockingbird S3](https://github.com/crvouga/mockingbird/tree/main/packages/service/s3) on an ephemeral loopback port,
creates its bucket, and persists the emulator's objects and metadata in `.atlas-workspace/s3/storage.sqlite`
using Bun's file-backed SQLite (WAL, synchronous commits). Its development credentials are `fixture` / `fixture`,
and it validates signed S3 requests. No Docker daemon or external storage service is needed.

Status identifies the local endpoint, bucket and data file. Keep `.atlas-workspace/` private to each checkout and
do not delete it unless you intend to remove local data. Stop and restart preserve reports, attachments and settings.
Preview starts no S3 service.

For external S3, copy `.env.example` to `.env` (Bun loads it) or export the `ATLAS_S3_*` variables. Any nonempty
setting selects that configuration. Missing, invalid or unreachable external storage fails visibly; dev never
silently switches a configured bucket to local storage. Use a separate bucket or `ATLAS_S3_PREFIX` per checkout.
The standalone `atlas serve` and `atlas dev` CLI commands still require S3 configuration and have no fallback.

Setup records a dependency fingerprint in `node_modules/`. Dev reuses it when Bun, `package.json` and `bun.lock`
match. Changed manifests or removed dependencies trigger installation; `--setup` always performs a frozen install
to repair an incomplete tree. Do not share dependencies, `.atlas-workspace/` or caches across checkouts.

Simultaneous starts cannot claim the same target lease. After a hard kill, use `bun run dev --stop` to clear a stale
lease; it removes one only when the owner PID is gone. An unauthenticated live owner must be investigated, never killed.

## IDE configuration

[`.superset/config.json`](https://github.com/crvouga/atlas/blob/main/.superset/config.json) uses `dev --setup`, `dev`
and `dev --stop` for setup, Run and teardown. Personal overrides stay in ignored `.superset/config.local.json`.
Superset resolves Run from the main repository's config: commit scripts and configuration together before expecting
another workspace to discover them. See its [lifecycle guide](https://docs.superset.sh/setup-teardown-scripts).

[`.super.engineering/config.json`](https://github.com/crvouga/atlas/blob/main/.super.engineering/config.json) presents
one **Dev** target and the CI targets **Check**, **Test**, **Build**, **Docs** and **Smoke**. Dev is the default;
Docs runs `docs --check`. Setup and teardown use the same dev modes as the other IDEs. Existing preview, status and
review workflows remain available through dev flags and [UI conventions](ui.md), without duplicate shortcuts.

Inspect and invoke definitions with the documented CLI:

```sh
sc project scripts check --json
sc project scripts run Dev --json
sc project scripts status --json
sc project scripts stop Dev --json
```

Edit scripts with `sc project scripts set ... --scope repo` and shared commands with `sc commands ... --scope shared`;
preserve unknown fields. See [project configuration](https://super.engineering/docs/project-config-and-scripts/).

[`orca.yaml`](https://github.com/crvouga/atlas/blob/main/orca.yaml) keeps `scripts.setup`, `scripts.archive` and
`setupAgentStartupPolicy: wait-for-setup`. Its first tab is reserved for the agent; the second runs `bun run dev`.
No unsupported `scripts.run` key is added. Keep Shared + Local or Shared only enabled for repository hooks and approve
Orca's shared-config trust prompt when offered. These are user-owned settings. Existing workspaces can run the same
Bun command in a terminal; default tabs apply to new workspaces. See the [Orca reference](https://www.onorca.dev/docs/model/orca-yaml).

## Verification

Read `AGENTS.md`, discover the live URL with `bun run dev --status`, and use [UI conventions](ui.md) for screen changes.
The lifecycle suite (`bun test scripts/workspace.test.ts`) checks setup, strict ports, isolated stores, ownership,
shutdown, population, cancellation and the command/configuration inventory. It does not prove a real IDE created a
workspace; that additionally requires the corresponding IDE to be installed and available.
