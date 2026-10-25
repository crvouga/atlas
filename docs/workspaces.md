# Atlas in agent IDEs

This guide is for developing **this repository** in Superset, super.engineering or Orca. A consumer
project should install Atlas from npm and follow [integrating](integrating.md) instead.

## Start from any terminal

Install the Bun version named by `packageManager` in [package.json](../package.json), then run these
commands from the repository root. Setup requires no tokens, copied `.env`, Docker or external services.

```sh
bun run workspace:setup
bun run workspace:run
```

Open the `Atlas server ready:` URL printed in the Run terminal. It serves the real API and hot-reloading
viewer together; `/admin` opens settings. A fresh node starts empty. Publish real results to the printed
`ATLAS_STORE` address using the existing [report commands](reference/reports.md).

For UI work with populated specs, statecharts, failures and recordings, run the separate examples target:

```sh
bun run workspace:preview
```

This viewer uses `examples/todo/specs` and the existing example-evidence adapter. It does not seed or
alter the real server's data. It has no server administration interface. Existing example run files are
shown when present; setup does not run browsers, model checkers or generate recordings. To create fresh
example recordings, use the existing `example:run` command and [statechart guide](statecharts.md).

## Shared commands

| Command | Behavior |
| --- | --- |
| `bun run workspace:setup` | Check the pinned Bun and install with `--frozen-lockfile`; safe to repeat. |
| `bun run workspace:run` | Run the real node and viewer; repeat the frozen install before starting. |
| `bun run workspace:preview` | Run the populated examples viewer; repeat the same setup first. |
| `bun run workspace:status` | Print live URLs, mode and readiness as JSON; omit private control credentials. |
| `bun run workspace:stop` | Stop both targets owned by this checkout; retain all reports. |
| `bun run workspace:stop server` | Stop only the API/viewer target. `preview` selects only examples. |
| `bun run workspace:check` | Run documentation, types, tests, package/client builds and consumer smoke. |

`run` and `preview` stay in the foreground so the IDE owns their lifetime and displays their output.
Ctrl+C or an IDE Stop closes the owned server and its child process. Teardown uses a random private
control capability stored in `.atlas-workspace/`; it never kills a PID from a file or uses `pkill`.
If the owned development child does not finish after five seconds, only that child is terminated.
Stopping an unrelated IDE, agent, checkout or application is outside these scripts' scope.

## Workspace isolation and ports

The API/viewer tries port 5180, and examples try 5181. If that default is busy, the OS supplies a free
port. Read `workspace:status` instead of assuming a URL. An explicit `--port`, `ATLAS_PORT`, or `PORT`
(in that priority order) is strict: conflicts fail and never connect publishers to a different node.
`--port 0` requests a free port explicitly.

```sh
bun run workspace:run --port 5280
bun run workspace:status
```

Everything binds to `127.0.0.1`. For remote workspaces, use the IDE's port forwarding. Reports and server
settings stay in this checkout's `.atlas-data/`; live runtime leases stay in `.atlas-workspace/`.
Keep both directories private to each worktree. Do not share `node_modules`, `.atlas-data/`,
`.atlas-workspace/` or caches across checkouts with different dependencies. Frozen installs use Bun's
download cache without linking one worktree's dependency tree to another.

Two simultaneous starts cannot claim the same target's runtime lease. A hard kill may leave metadata:
run `workspace:stop` before restarting. It removes a stale lease only when its owner PID is gone; if the
PID is still alive but the control endpoint cannot authenticate, investigate that owner rather than
assuming it is safe to stop. No reports or settings are deleted by teardown.

## Superset

[`.superset/config.json`](https://github.com/crvouga/atlas/blob/main/.superset/config.json) wires workspace creation to setup, the Run button
to the real node/viewer, and teardown to stop. Superset discovers listening ports; the conventional
ports are labelled in [ports.json](https://github.com/crvouga/atlas/blob/main/.superset/ports.json). Automatically chosen ports still appear
in its port panel. Use the examples command in a second terminal when needed. Personal lifecycle
overrides belong in ignored `.superset/config.local.json`.

Superset's Run command resolves from the main repository's configuration. Commit the configuration
and scripts together before expecting another workspace's Run button to discover them. See the
[official lifecycle guide](https://docs.superset.sh/setup-teardown-scripts) and
[port management](https://docs.superset.sh/ports).

## super.engineering

[`.super.engineering/config.json`](https://github.com/crvouga/atlas/blob/main/.super.engineering/config.json) defines **Atlas** (default),
**Viewer examples** and **Checks** in the Run controls. Each server target's Stop command affects only
that target; deletion stops both. Shared commands expose **Atlas URLs**, **Check Atlas** and a
**Review Atlas UI** prompt. The prompt uses the current agent's configured provider and does not
launch a team or change model settings.

Use the documented CLI to inspect or invoke the same definitions:

```sh
sc project scripts check --json
sc project scripts run Atlas --json
sc project scripts status --json
sc project scripts stop Atlas --json
```

Edit shared script configuration with `sc project scripts set ... --scope repo`, and shared commands
with `sc commands ... --scope shared`. Preserve other entries and unknown configuration keys. See
[project config and scripts](https://super.engineering/docs/project-config-and-scripts/).

## Orca

[`orca.yaml`](https://github.com/crvouga/atlas/blob/main/orca.yaml) uses the supported `scripts.setup` and `scripts.archive` hooks. Agents
wait for setup. The first default tab is reserved for the agent; the second starts Atlas. Tab commands
may start alongside setup, so Run repeats the frozen install before importing application dependencies.
Orca's normal shared-script trust and setup-policy settings still apply. No `scripts.run` key is
invented: Orca starts the app through the terminal template.

Keep **Shared + Local** or **Shared only** enabled for repository hooks, and approve the shared config
in Orca when it offers its trust prompt. These are user-owned controls. For existing workspaces,
run the shared Bun commands in a terminal; default tabs are created for new workspaces. See the
[official `orca.yaml` reference](https://www.onorca.dev/docs/model/orca-yaml).

## Agent workflow

Read `AGENTS.md`, then use `workspace:status` to discover this checkout's live app. Run the server for
API, settings, upload and streaming changes; use examples for populated UI review. Read [UI conventions](ui.md)
before changing screens. Keep report/schema/permission contracts intact, and report what the browser and
checks actually verified. Do not launch other agents, change IDE permissions or install global IDE tooling
as a side effect of setup. `workspace:check` is an on-demand verification target, never a creation hook.

The lifecycle regression suite (`bun test scripts/workspace.test.ts`) checks fresh directories with spaces,
repeatable setup, strict ports, separate stores, authenticated ownership and independent shutdown.
Real IDE boot verification additionally needs that IDE installed and available; a passing configuration
test alone does not prove the IDE started a new workspace.
