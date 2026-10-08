# Atlas

**Executable statecharts.** Write down how a product behaves as statecharts in open formats, then
let Atlas lint them, plan paths that cover every transition, run those paths against the real
product through any driver (a browser, a phone, a plain function), and write a manifest of what
happened, with screenshots, video clips, captions, business events and standard test reports.

```
specs/                     atlas lint      the charts are pure, reachable, free of silent dead ends,
  app.scxml          ──▶                   and every journey replays
  child.machine.yaml       atlas plan      curated journeys + shortest paths covering every transition
  journeys.yaml            atlas run       each path against the product, through a driver
                                  │
                                  ▼
                           atlas-runs/<run>/manifest.json, junit.xml, ctrf.json, chart.mmd, media/
```

The spec is the source of truth for the product's behaviour, not for the test code: a state says
what a person sees, an event says what happens in business language ("Adds a todo", "Sync fails"),
and the implementation says how a driver makes each event happen and recognises each state.

> [!IMPORTANT]
> **Dogfooding phase:** Atlas is not published to npm yet. Projects currently consume this
> repository as a pinned Git submodule and a pnpm workspace package, then contribute reusable fixes
> back from those integrations. Multiple projects and agents may update Atlas concurrently. If you
> are integrating Atlas—or are an agent working inside a consumer project's submodule—read the
> [dogfooding and contribution workflow](docs/dogfooding.md) before making changes.

## Packages

| Package | What it is |
| --- | --- |
| [`@crvouga/atlas`](packages/core) | Spec loading (SCXML and XState), composition, lint, planning, the runner, reports, CloudEvents, privacy, config and the `atlas` CLI. `@crvouga/atlas/spec` is a browser-safe subset. |
| [`@crvouga/atlas-playwright`](packages/playwright) | Playwright driver: signal-based screen recognisers, paced taps and typing with a touch overlay, device-resolution screenshots and H.264 clips. |
| [`@crvouga/atlas-vitest`](packages/vitest) | Run a config as a Vitest (or Jest-style) suite, one test per planned path, plus `functionDriver`. |
| [`@crvouga/atlas-detox`](packages/detox) | Detox driver for iOS and Android apps. |
| [`@crvouga/atlas-schema`](packages/schema) | The contract: Zod schemas and JSON Schemas for specs, journeys, manifests, timelines and the runs index. |
| [`@crvouga/atlas-visualizer`](packages/visualizer) | Browse charts and runs: every state with its screenshots, every transition with its clip. |

## Open standards

Atlas invents as little as it can. Everything it reads or writes is a format other tools already
understand.

| Standard | Used for |
| --- | --- |
| [W3C SCXML](https://www.w3.org/TR/scxml/) | Charts (`*.scxml`), with business metadata in an `atlas` XML namespace |
| [XState v5](https://stately.ai/docs/machines) machine config | Charts (`*.machine.json`, `*.machine.yaml`): the JSON shape Stately Studio imports and exports |
| [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) | The manifest, journeys, state nodes, timelines and runs index (`packages/schema/schemas`) |
| [JUnit XML](https://github.com/testmoapp/junitxml) | `junit.xml`: one test case per path, for any CI system |
| [CTRF](https://ctrf.io) | `ctrf.json`: Common Test Report Format |
| [WebVTT](https://www.w3.org/TR/webvtt1/) | Captions for every clip: each tap, keystroke, system call and screen change |
| [CloudEvents 1.0](https://cloudevents.io) | Business events the product emits (HTTP structured, binary and batch modes) |
| MP4 / H.264 | Clips of each transition, encoded with FFmpeg |
| PNG / WebP | Screenshots at device resolution, with WebP thumbnails |
| [Mermaid](https://mermaid.js.org/syntax/stateDiagram.html) `stateDiagram-v2` | `chart.mmd`, and `atlas export --format mermaid` |

## Quick start: the todo example

[`examples/todo`](examples/todo) is a dependency-free web app (static HTML and vanilla JavaScript
served by a small Node server) specified as two charts:

- `specs/todo-app.scxml`, the root chart in SCXML: a welcome screen, a "Setting up" state that
  invokes the child chart, and a `<parallel>` "Working on the list" state whose "Sync" and "List"
  regions change independently.
- `specs/getting-started.machine.yaml`, the child chart in XState YAML. Its two final states hand
  back to the parent through `meta.doneEvent`.
- `specs/journeys.yaml`, four curated journeys.

It has every kind of event: user events (taps and typing), a **system** event ("Sync fails", which
the test triggers through a real HTTP endpoint on the example server), a **time** event ("Retry
timer elapses", which jumps Playwright's clock 30 seconds) and **hand-off** events from the child
chart. The server reports business events as CloudEvents to an Atlas `cloudEventsHttpSource`, so
the states' `meta.events` are checked on every run.

Atlas needs Node 22.18 or later. Video clips and WebP thumbnails need FFmpeg on the `PATH`.

```sh
pnpm install
pnpm --filter atlas-example-todo exec playwright install chromium
cd examples/todo

pnpm atlas:lint   # pure, reachable, no undocumented dead ends, journeys replay, everything implemented
pnpm atlas:plan   # 4 journeys + 1 generated path cover all 14 transitions
pnpm atlas:fast   # run every path quickly
pnpm atlas:run    # showcase mode: paced, with a touch overlay, screenshots and a clip per transition
pnpm test         # the same spec against an in-memory model, through Vitest
```

A showcase run ends with:

```
States 14/14 passed, 0 failed, 0 not reached
Transitions 14/14 passed, 0 failed, 0 not reached
Manifest: examples/todo/atlas-runs/<run-id>/manifest.json
```

`pnpm test` runs [`model.test.ts`](examples/todo/model.test.ts): the same charts and journeys
against `TodoModel`, a plain class, through `functionDriver` and `describeAtlas`. Only the driver
and the implementation differ, which is the point: the spec belongs to the product, not to one
test tool.

## Writing specs

### Files

Atlas loads every chart and journeys file directly inside the specs directory:

- `*.scxml`, `*.machine.json`, `*.machine.yaml` (or `.yml`): one chart each;
- `journeys.yaml` (or `.yml`, `.json`): the curated journeys.

The **root** chart is the one no other chart invokes. A chart's id is the SCXML `name` attribute or
the XState `id`.

### The pure subset

Atlas walks charts without running any code, so it executes only the parts of a statechart that
are pure structure:

- states, nesting (`initial`), `parallel` regions and `final` states;
- event transitions, written as a target (`Opens: Open` or `{ target: '#Open' }`);
- `invoke` that names another chart (`src`, `id`, `onDone`), composed statically;
- `meta`.

Guards, actions, `entry`/`exit`, `context`, `after` (delays), `always`, `output` and `onError` are
lint errors. A condition becomes a state or an event instead: "Payment declined" is an event the
system sends, not a guard on "Pays"; "30 seconds pass" is a time event, not an `after`.

State names are global across the composed product (transitions target `#<name>`), so they must be
unique across charts, and they cannot contain dots. Names are business language and may contain
spaces.

### `meta`

| Field | Meaning |
| --- | --- |
| `description` | What is true in this state. Required on every state by default (`requiredMeta` changes that). |
| `snapshot` | What a person sees, in words. |
| `events` | Business events that happen on entering the state, checked against what event sources observed. |
| `checks` | Things to verify on screen, quoted from the spec; the implementation's `checks()` returns their results. |
| `confidence` | `confirmed` or `assumed`. |
| `source` | Where the behaviour is documented. |
| `deadEnd` | Why a state with no way out is meant to be one. Without it, a dead end is a lint error. |
| `doneEvent` | On a child chart's final state: the event its parent receives from that final. |
| `childMachine`, `childFinalEvents` | Legacy composition on the parent state. Prefer `invoke`. |

### SCXML conventions

SCXML ids are XML IDs and event attributes are token lists, so business names travel in an
`atlas:name` attribute next to a token id. Metadata lives in the `atlas` namespace, as SCXML allows:

```xml
<scxml xmlns="http://www.w3.org/2005/07/scxml" xmlns:atlas="https://github.com/crvouga/atlas/ns/1"
       version="1.0" datamodel="null" name="Todo app" initial="welcome">
  <state id="welcome" atlas:name="Welcome">
    <atlas:meta>
      <atlas:description>The first screen a person sees.</atlas:description>
      <atlas:event>App opened</atlas:event>
    </atlas:meta>
    <transition event="starts-setup" atlas:name="Starts setup" target="setting-up"/>
  </state>
  <state id="setting-up" atlas:name="Setting up">
    <atlas:meta><atlas:description>The child chart runs here.</atlas:description></atlas:meta>
    <invoke id="getting-started" src="getting-started.machine.yaml" atlas:name="Getting started"/>
    <transition event="done.invoke.getting-started" target="working"/>
  </state>
  ...
</scxml>
```

`<atlas:event>`, `<atlas:check>` and `<atlas:source>` repeat to form lists; `<atlas:dead-end>` is
`meta.deadEnd`; a final state's `atlas:done-event` attribute is `meta.doneEvent`. `atlas export
--format scxml` writes any chart (or the composed product) back out in this form, and reading it
again gives the same chart.

### Composition

A parent state runs a child chart with any of:

1. XState `invoke: { src: 'Child', id: 'child', onDone: '#Next' }`, or SCXML `<invoke id="child">`
   plus a `done.invoke.child` transition;
2. `meta.doneEvent` on the child's final states, each naming the event the parent receives, which
   the parent handles in its `on` (a final whose event the parent does not handle goes to
   `onDone`);
3. legacy `meta.childMachine: 'Child'` and `meta.childFinalEvents: { <final>: <event> }` on the
   parent state.

Atlas inlines each child into the state that invokes it. The child's final states stay as states
(so they keep their screenshots and checks) but take the parent's transition for their hand-off
event. When a path reaches one, the hand-off happens by itself: journeys never list hand-off
events, and the planner inserts them. Give each hand-off event an implementation of kind
`hand-off` (usually a no-op); events without an implementation count as blocked.

### Journeys

```yaml
journeys:
  Keeps working through a sync outage:
    description: Adds todos while the sync is down, and the retry catches up.
    events: [Starts setup, Skips naming the list, Adds a todo, Sync fails, Adds a todo, Retry timer elapses]
    endsIn: [Some todos open, Synced]
```

The linter replays each journey through the composed chart and checks it ends in every `endsIn`
state. Each journey runs as its own path; generated paths only cover what journeys leave out.

## Implementing a spec

An implementation tells a driver how to make each event happen and how to recognise each state.
Events are keyed by their exact name in the spec.

```ts
import { defineConfig } from '@crvouga/atlas';
import { playwrightDriver, role, screen, text } from '@crvouga/atlas-playwright';

export default defineConfig({
  specs: './specs',
  driver: () => playwrightDriver({ clock: true }),
  targets: ['http://127.0.0.1:4317'],
  implementation: {
    async setup({ page }) {
      await page.goto('http://127.0.0.1:4317');
    },
    events: {
      'Adds a todo': {
        kind: 'user',
        how: 'Types a todo and taps "Add".',
        async run({ page, user }) {
          await user.type(page.getByLabel('New todo'), 'Water the plants', 'New todo');
          await user.tap(page.getByRole('button', { name: 'Add' }), 'Add');
        }
      },
      'Retry timer elapses': {
        kind: 'time',
        how: 'Jumps the page clock 30 seconds.',
        run: ({ page }) => page.clock.fastForward(30_000)
      }
    },
    states: {
      'No todos': screen({ all: [text('Nothing to do yet')] }),
      Offline: screen({ all: [text('Offline')], none: [text('All changes synced')] })
    }
  }
});
```

**Events** (`EventImplementation<C>`): `kind` is `user`, `system`, `time` or `hand-off`; `how` is a
plain-language note shown in reports; `run(ctx, tools)` makes it happen; `prepare(ctx, tools)`
creates test data before the path starts; `blocked: '<reason>'` marks an event that cannot run yet,
so paths stop before it and report why.

**States** (`StateImplementation<C>`): `recognize(ctx)` returns whether the state is showing and the
signals it looked at. Optional: `checks(ctx)` (results for `meta.checks`; a failed check fails the
state), `lookIn(ctx)` (where to look when the change happens off screen, such as reloading or
opening another tab), `settle(ctx)` (within-state actions after the screenshot, such as
dismissing a toast), `transient` (shown too briefly to wait for) and `sameAs` (a state the UI cannot
tell apart from this one).

**Setup**: `setup(ctx, { path, tools })` puts the product in the path's start configuration;
`canStart(active)` returns `true` or the reason a start configuration cannot be set up yet.

Only leaf states need recognisers. `atlas lint --require-implementations` lists every event and
leaf state in scope that has no implementation.

## Writing a driver

A driver owns the thing under test for one path attempt: a browser context, a device, a model or
an API client. Only `open` and `close` are required.

```ts
type Driver<C> = {
  name: string;
  open(input: { path: PlannedPath; attempt: number; mode: RunMode; directory: string; timeline: Timeline }): Promise<C>;
  close(ctx: C, input: { failed: boolean; traceFile: string }): Promise<{ trace?: string } | void>;
  screenshot?(ctx: C, file: string): Promise<{ png: string; webp?: string } | null>;
  record?(ctx: C, workDirectory: string): Promise<{ stop(output: string): Promise<{ video: string; poster?: string; durationMs: number } | null> }>;
  text?(ctx: C): Promise<string>;
  hold?(ctx: C, ms: number): Promise<void>;
  pacing?: { before: number; after: number };
  dispose?(): Promise<void>;
};
```

- `open` returns a fresh context for each attempt; `close` may return the path of a trace file
  (Playwright writes one for failed attempts).
- `screenshot` and `record` produce media; `record` is used only in showcase mode, one clip per
  transition.
- `text` returns the visible text, for the privacy scan.
- `timeline.add({ kind, label, ... })` logs taps, typing, system calls and time jumps; they become
  each clip's captions.

For anything you can reach from Node (a domain model, an API client, a CLI), `functionDriver(create)`
is a complete driver:

```ts
import { functionDriver } from '@crvouga/atlas';

const driver = functionDriver(() => new TodoModel());
```

## CLI

```
atlas lint   [--config atlas.config.ts | --specs <dir>] [--require-implementations]
atlas plan   [--config atlas.config.ts]
atlas run    [--config atlas.config.ts] [--mode fast|showcase] [--paths id,id] [--no-retry] [--output <dir>]
atlas export --specs <dir> --format scxml|mermaid|json [--out <file>]
```

- `lint` with `--specs` checks charts and journeys alone; with a config it also lists missing
  implementations, and `--require-implementations` makes them errors.
- `plan` prints each path, what blocks it, and how many transitions stay uncovered.
- `run` exits non-zero when a path fails or the privacy scan finds something. `--paths` runs only
  the given path ids; `--no-retry` skips the retry of failed paths.
- `export` writes the composed product (every child inlined) as SCXML, Mermaid or XState JSON.

The config file is TypeScript (loaded with `tsx`) and defaults to `atlas.config.ts` in the current
directory. Relative paths in it resolve against the config file's directory.

## Config reference

`defineConfig<C>(config)` returns the config unchanged, typed for the driver's context `C`.

| Field | Meaning |
| --- | --- |
| `specs` | The specs directory. |
| `driver` | A `Driver<C>`, or a function returning one (called once per run). |
| `implementation` | `{ events, states, setup, canStart? }`. |
| `chart` | Run one chart of the product; the root chart when omitted. |
| `start`, `startLabel` | Where generated paths start (an XState state value) and how to describe it; the initial state when omitted. |
| `entryEvents` | When running one chart: the only events that enter it from outside. |
| `output` | Where runs are written; `atlas-runs` beside the config. |
| `eventSources` | `() => EventSource[]`: where business events come from. |
| `eventMatchers` | How each business event name is recognised: `{ type }`, `{ pattern }` or a function. |
| `privacy` | Extra `deny` patterns, `allowEmails` and `allowHosts`. |
| `targets` | URLs the run reaches, checked against `privacy.allowHosts` before anything runs. |
| `environment` | Recorded in the manifest. |
| `stepTimeoutMs` | How long to wait for a state to show up (default 45 000). |
| `requiredMeta` | `meta` fields every state needs (default `['description']`). |

The programmatic API mirrors the CLI: `prepare(config)` loads, lints and plans; `runConfig(config,
options)` runs; `loadSpecDirectory`, `lintBundle`, `chartScope`, `planChart` and `runPaths` are the
steps underneath.

## How a run works

1. **Plan.** Curated journeys first. When running one chart of a larger product, each journey is cut
   to its stretch inside the chart, starting at an entry transition. Then, for each transition still
   uncovered, the shortest path that reaches it (breadth-first, so loops stay bounded). Paths stop
   before blocked events; a blocked path whose runnable part other paths already cover is reported
   but not run.
2. **Run each path.** A fresh driver context; every event's `prepare`; `setup`; the start state
   must be recognised. Then for each step: run the event, wait for the target state, run its checks,
   collect business events, screenshot, `settle`.
3. **Retry.** A failed path runs once more. Passing the second time makes it `flaky`.
4. **Write.** The manifest and reports are rewritten after every path, so a crash keeps what ran.

Every path, state and transition ends as `passed`, `failed`, `flaky` or `not-reached`. Reaching a
state also reaches its ancestors. A failure records the recogniser's signals and which known states
the screen looked like instead.

### Run modes

| Mode | Pacing | Media |
| --- | --- | --- |
| `fast` | None | Screenshots of every state (when the driver takes them) |
| `showcase` | Holds before and after each step; taps glide and type at human speed | Screenshots, plus an H.264 clip of every transition with a poster and WebVTT captions |

## Manifest and reports

Each run writes `<output>/<timestamp>-<mode>/`:

| File | Contents |
| --- | --- |
| `manifest.json` | The run (commit, branch, environment, mode, spec version, scope), every chart, the composed map (nodes and edges), every state and transition with status, media, timeline and reasons, every path with its attempts, coverage and privacy results. Schema: `packages/schema/schemas/manifest.schema.json`. |
| `junit.xml` | One test case per path: failures, skips (with the blocking reason) and flaky passes. |
| `ctrf.json` | The same as CTRF. |
| `chart.mmd` | The composed chart as a Mermaid state diagram. |
| `media/paths/<path>/NN.png`, `.webp` | Screenshots of each state a path reached; `failed-NN.png` where it failed. |
| `media/clips/<path>/NN.mp4`, `.poster.webp`, `.vtt` | Showcase clips of each transition, with captions. |
| `media/traces/<path>.zip` | Driver traces of failed attempts (Playwright traces with the Playwright driver). |

## Business events

States list the business events that happen on entering them in `meta.events`. An `EventSource`
(`mark()` before each event, `collect()` after the state is recognised) says what actually happened:

- `cloudEventsHttpSource()` starts an HTTP endpoint that accepts CloudEvents in structured, binary
  or batch mode. Point the product's event bus, webhook relay or collector at its `url`.
- `logFileSource(file)` collects lines appended to a log, for products whose only event stream is a
  log; match them with `{ pattern }`.
- Any object with `name`, `mark` and `collect` works, such as an in-memory bus in a unit test.

With no matcher, a business event is observed when a CloudEvent's `type` equals its name. Events
with neither a matcher nor a CloudEvents source are reported as "no signal", never as missing.

## Privacy

Runs produce media and manifests that get shared, so Atlas refuses to leak real data:

- Before running, every `targets` URL must be on `allowHosts` (loopback only by default).
- After every step, the driver's visible text is scanned, and the manifest is scanned before it is
  written. By default it flags email addresses outside `example.com`/`.org`/`.net` and the `.test`,
  `.example`, `.invalid`, `.localhost` and `.local` domains, anything shaped like a US Social Security
  number, and card numbers other than the well-known test cards. Findings describe the match without
  repeating it.
- Any finding fails the run. Add `deny` patterns and `allowEmails` in `privacy`.

## Visualizer

[`@crvouga/atlas-visualizer`](packages/visualizer) renders the charts from the specs directory and
overlays runs from the runs directory: screenshots on states, clips on transitions, statuses and
history. See its README for how to point it at a project.

## License

[MIT](LICENSE)
