# Reference: core

Executable statecharts: loading, composing, linting, planning and running specs against real apps, and the `atlas` command. Import path `@crvouga/atlas`.

> Generated from the doc comments of `packages/core/src` by `bun run docs`. Do not edit: change the comment next to the code.

### The `atlas` command

Source: `packages/core/src/cli.ts`. Import: `@crvouga/atlas/cli`

Dispatches `atlas <command>`: the statechart commands (`lint`, `plan`, `run`, `merge`, `export`) and, loaded on demand so
they cost nothing otherwise, `serve`, `dev`, `init` and `report`. Statechart configuration is `atlas.config.ts` (see
`defineConfig`). A command that is wrong prints a message and exits 2; a plan, lint or run that finds problems exits 1.

See docs/statecharts.md
See docs/reference/cli.md

#### `USAGE`

```ts
export const USAGE = …
```

The text `atlas --help` prints: every command, and the flags of the statechart commands.

#### `main`

```ts
export async function main(argv = process.argv.slice(2))
```

Runs `atlas` with `argv` (default: the process arguments) and returns the exit code. Throws for a command that is wrong, which the `atlas` binary reports as a message and exit code 2.

### Config and programmatic API

Source: `packages/core/src/config.ts`

The user-facing entry point: `defineConfig` types a project's `atlas.config.ts`, and `prepare`,
`runConfig` and `mergeConfigRuns` are the programmatic equivalents of `atlas lint`/`plan`, `atlas
run` and `atlas merge`. They wire the pieces together (load specs, lint, scope, plan, run) and add
no behaviour of their own beyond validating the config against the spec. Relative paths in a config
resolve against the `baseDirectory` argument (the config file's directory when called by the CLI).

See docs/statecharts.md

#### `AtlasConfig`

```ts
export type AtlasConfig<C = unknown> = {
  /** The directory holding the charts (`*.scxml`, `*.machine.{json,yaml}`) and `journeys.yaml`. */
  specs: string;
  /** The chart to run; the root chart when omitted. */
  chart?: string;
  /** Where generated paths start (an XState state value); the initial state when omitted. */
  start?: StateValue;
  /** A phrase describing `start` in reports; `The start of the chart` when omitted. */
  startLabel?: string;
  /** Only these events enter the chart from outside it. */
  entryEvents?: string[];
  /** Run only this state and what is inside it, with the transitions into and out of it. */
  state?: string;
  /** Path attempts that run at once (capped by the driver's `concurrency`); one per CPU when omitted. */
  workers?: number;
  /** Runs once before any path: prepare what every seed relies on (reference data, config). */
  beforeRun?: () => Promise<void> | void;
  /** The driver, or a function that creates it (called once per run, after `beforeRun`). */
  driver: Driver<C> | (() => Driver<C> | Promise<Driver<C>>);
  /** How to make each event happen and recognise each state. */
  implementation: Implementation<C>;
  /** Where runs are written; `atlas-runs` beside the config when omitted. */
  output?: string;
  /** Creates the business event sources for a run (called once per run; the run closes them). */
  eventSources?: () => EventSource[] | Promise<EventSource[]>;
  /** How each business event name from `meta.events` is recognised; by default a CloudEvent whose `type` equals the name. */
  eventMatchers?: Record<string, EventMatcher>;
  /** Extra privacy rules on top of the defaults. */
  privacy?: PrivacyRules;
  /** URLs the run will reach; checked against `privacy.allowHosts` (loopback by default). */
  targets?: string[];
  /** Recorded in the manifest as the run's environment (`run.environment`), beside the driver name. */
  environment?: Record<string, unknown>;
  /** How long to wait for a state to be recognised after an event, in milliseconds; 45 000 when omitted. */
  stepTimeoutMs?: number;
  /** Meta fields every state must carry (default: description). */
  requiredMeta?: string[];
};
```

Everything a project says about running its specs. `C` is the type of the driver's context
(a Playwright `Page`, a model, ...), which events and states receive.

#### `defineConfig`

```ts
export function defineConfig<C>(config: AtlasConfig<C>)
```

Declares an Atlas config with types, returning it unchanged. Put it as the default export of
`atlas.config.ts`; the CLI loads the file with `tsx` and defaults to `atlas.config.ts` in the
current directory.

See /statecharts.md

**Example**

```ts
export default defineConfig({
  specs: './specs',
  driver: () => functionDriver(() => new TodoModel()),
  implementation: {
    events: { 'Adds a todo': { kind: 'user', how: 'Calls add().', run: async (model) => model.add('x') } },
    states: { 'No todos': { recognize: async (model) => ({ matched: model.count === 0, signals: [] }) } }
  }
});
```

#### `PrepareOptions`

```ts
export type PrepareOptions = {
  /** Scope the run to this state instead of the config's. */
  state?: string;
};
```

Overrides of a config that the command line can give.

#### `prepare`

```ts
export function prepare<C>(config: AtlasConfig<C>, baseDirectory = process.cwd(), options: PrepareOptions = {})
```

Loads, lints and plans a config without running anything (what `atlas lint` and `atlas plan` do).

- `baseDirectory`: what a relative `config.specs` resolves against.

**Returns** the loaded `bundle`; `lint` (findings, composition and graph, including `implemented`
findings for what the implementation lacks); the run's `scope`; the `plan` (paths, journeys, seeds,
`unreachable`); and the resolved `specs` directory.

**Throws** Error when the specs cannot be loaded or composed, when a seed's `shows` is not active where
it starts, or when a seed's `for` names an event no state handles. Lint findings are returned,
not thrown.

#### `RunCommandOptions`

```ts
export type RunCommandOptions = PrepareOptions & {
  /** `fast` when omitted. */
  mode?: RunMode;
  /** Only these paths, by id. */
  paths?: string[];
  /** Only paths that start from these seeds ("start" for paths that `setup` starts). */
  seeds?: string[];
  /** Whether a failed path runs again to tell flaky from broken; true unless `false`. */
  retry?: boolean;
  /** Where the run is written; the config's `output`, else `atlas-runs`. */
  output?: string;
  /** Path attempts at once; the config's `workers`, else one per CPU, always capped by the driver. */
  workers?: number;
  /** Run one shard of the plan; `atlas merge` composes the shards. */
  shard?: Shard;
  /** Keep the passed paths of this run (or the newest run, with "latest") and run the rest. */
  reuse?: string;
  /** Receives progress lines; stdout when omitted. */
  log?: (line: string) => void;
};
```

The options of `atlas run` that `runConfig` accepts; each overrides the config's own setting.

#### `runConfig`

```ts
export async function runConfig<C>(config: AtlasConfig<C>, options: RunCommandOptions = {}, baseDirectory = process.cwd())
```

Runs a config end to end and writes the run (manifest, reports, media) under its output
directory, like `atlas run`.

Refuses to start (throws) when the spec has any structural lint finding (everything but missing
implementations, which just block paths) or when a `targets` URL is not on the privacy allow-list.
Then it calls `beforeRun`, creates the driver and runs the planned paths (filtered by
`options.paths`/`seeds`/`shard`, reusing earlier passes when `options.reuse` is set).

**Returns** what `runPaths` returns: the run directory, the manifest and `ok` (false if any path
failed or the privacy scan found something).

**Throws** Error also when `reuse` names a run with no outcomes or there is no earlier run for `latest`.

See /statecharts.md

#### `mergeConfigRuns`

```ts
export function mergeConfigRuns<C>(config: AtlasConfig<C>, runDirs: string[], options: PrepareOptions & { output?: string } = {}, baseDirectory = process.cwd())
```

Composes runs of a config (its shards, or a rerun and the run before it) into one new run
under the output directory, like `atlas merge`. The plan is recomputed from the config, so the runs
must come from the same specs, implementation and seeds.

- `runDirs`: the run directories to compose; later ones win when two ran the same path.

**Returns** what `mergeRuns` returns: the new run directory, its manifest and `ok`.

**Throws** Error when a run directory has no `outcomes.json`.

### Business event sources

Source: `packages/core/src/events/cloudevents.ts`

Where a run learns which business events actually happened: an HTTP endpoint that accepts
CloudEvents (`cloudEventsHttpSource`), or the lines a log file gains (`logFileSource`), plus the pure
functions that compare what a state expects (`meta.events`) with what was collected. Every source
implements `EventSource`: `mark()` records a position before a step and `collect(mark)` returns only
what arrived after it. An event with no way to be observed is reported as "no signal", never as
missing, so absence of evidence is not read as failure.

See docs/statecharts.md

#### `CloudEvent`

```ts
export type CloudEvent = {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  time?: string;
  subject?: string;
  datacontenttype?: string;
  data?: unknown;
  [extension: string]: unknown;
};
```

A CloudEvents 1.0 event in the JSON format (https://cloudevents.io).

#### `cloudEventsFromHttp`

```ts
export function cloudEventsFromHttp(headers: Record<string, string | string[] | undefined>, body: string): CloudEvent[]
```

Parses an HTTP delivery in any CloudEvents content mode: structured (`application/cloudevents+json`),
batch (`application/cloudevents-batch+json`) or binary (`ce-*` headers, with the body as `data`).
A request with none of those (no `ce-type` header and a different content type) yields no events.
In binary mode a missing `ce-id` becomes a random UUID and a missing `ce-source` becomes `unknown`;
other `ce-*` headers become extension attributes; the body is parsed as JSON when the content type
says JSON and it parses, else kept as text.

- `headers`: lower-cased header names, as Node's `IncomingMessage.headers`.

**Throws** SyntaxError when a structured or batch body is not valid JSON.

#### `cloudEventsHttpSource`

```ts
export async function cloudEventsHttpSource(options: { port?: number; host?: string } = {}): Promise<EventSource & { url: string }>
```

Starts an HTTP endpoint the system under test sends CloudEvents to (any content mode). Point the
product's event bus, webhook relay or OpenTelemetry collector's CloudEvents exporter at its `url`.

It answers every valid POST with 202 and an unparseable delivery with 400, and keeps events in
memory. It does no authentication and listens on `127.0.0.1` unless `host` says otherwise, so
only the local machine can reach it by default. `mark()` is the number of events received so far.
Call `close()` to stop the server; `runPaths` does that for the sources it is given.

- `options.port`: the port to listen on; an unused port when omitted (read the real one from `url`).

- `options.host`: the interface to listen on; `127.0.0.1` when omitted.

**Example**

```ts
eventSources: async () => [await cloudEventsHttpSource({ port: 4318 })]
```

#### `logFileSource`

```ts
export function logFileSource(file: string, options: { settleMs?: number } = {}): EventSource
```

An event source for products whose only event stream is a log file: `collect` returns the text
appended to the file since `mark` (match it with an `{ pattern }` matcher), and no CloudEvents.

`mark()` is the file's size in bytes (0 when it does not exist). `collect` first waits `settleMs`
for the product to write, then reads from the mark to the end of the file; a missing or
unreadable file gives empty text, and a file that was truncated or rotated since the mark is not
detected. The source's name starts with `log:`, which is how the runner tells it from a CloudEvents source.

- `file`: the log file path.

- `options.settleMs`: how long `collect` waits before reading, in milliseconds; 1000 when omitted.

#### `BusinessEventResult`

```ts
export type BusinessEventResult = {
  /** The names listed in the state's `meta.events`. */
  expected: string[];
  /** Expected names that a matcher (or a CloudEvent of that type) confirmed. */
  observed: string[];
  /** Expected names that could be observed but were not. */
  missing: string[];
  /** Expected names with no way to be observed (no matcher and no CloudEvents source). Not a failure. */
  noSignal: string[];
  /** The CloudEvents collected for this step. */
  events: CloudEvent[];
};
```

The outcome of comparing a state's expected business events with what the sources collected.

#### `correlated`

```ts
export function correlated(collected: { events: CloudEvent[]; text: string }, ids: string[])
```

Keeps what belongs to one attempt when attempts run side by side: events (whose JSON mentions an
id) and log lines that contain one of its correlation ids. Empty ids are ignored; with no ids,
everything is kept.

#### `compareBusinessEvents`

```ts
export function compareBusinessEvents(
  expected: string[],
  collected: { events: CloudEvent[]; text: string },
  matchers: Record<string, EventMatcher>,
  hasCloudEvents: boolean
): BusinessEventResult
```

Compares the business events a state expects with what the sources saw, sorting each expected
name into `observed`, `missing` or `noSignal`. A business event is observed when its matcher
matches (a function gets the events and log text; `{ type }` compares CloudEvent types;
`{ pattern }` tests the log text); with no matcher, when a CloudEvent's `type` equals the name.
With neither a matcher nor any CloudEvents source (`hasCloudEvents` false) it is "no signal",
never "missing". Pure.

- `matchers`: matchers by business event name.

- `hasCloudEvents`: whether any non-log source was configured.

### Chart graph simulator

Source: `packages/core/src/graph.ts`

A pure, deterministic simulator over a composed machine (see `composeCharts`): given a
configuration and an event it computes the next configuration and names the transitions that
fired. The planner, linter and runner all use it to reason about a chart without running
the product. It never executes guards or actions (the linter rejects charts that have them), and
it identifies states by name alone, so names must be unique across the composed product.

See docs/statecharts.md

#### `StateValue`

```ts
export type StateValue = string | { [key: string]: StateValue };
```

An XState state value: a leaf state's name, or an object mapping each active child to its own value (parallel regions have several keys).

#### `Step`

```ts
export type Step = {
  event: string;
  /** Ids of the transitions that fired (see `transitionId`). */
  transitions: string[];
  /** True when the event was inserted automatically because a child chart's final state became active. */
  handOff: boolean;
};
```

One event taken during a replay.

#### `Config`

```ts
export type Config = {
  value: StateValue;
  /** Names of every active state, ancestors included (see `activeKeys`). */
  active: string[];
};
```

A configuration of the chart: where it is right now.

#### `configKey`

```ts
export function configKey(value: StateValue): string
```

A configuration's identity: its state value with keys sorted, so equal configurations compare equal.

#### `activeKeys`

```ts
export function activeKeys(value: StateValue): string[]
```

Names of every state in a state value, each parent before its children.

#### `ChartGraph`

```ts
export class ChartGraph
```

A pure simulator over a composed machine: XState computes the next configuration, and this
names which transitions fired, so coverage and the report can talk about transitions.

- `readonly machine;` — The XState machine built from the composed config, used for transition semantics.
- `readonly handOffStates: Map<string, string>;` — Hand-off state name to the event it passes to the parent chart.
- `node(name: string)` — The config of the state called `name`, or `undefined` when there is none.
- `target(source: string, event: string)` — The state a transition leads to, by name.
- `isLeaf(name: string)` — Whether the state has no child states.
- `parent(name: string)` — The name of the enclosing state, or `null` for a top-level state (or an unknown name).
- `stateNames()` — Every state name in the composed chart, parents before children.
- `regionsOf(state: string): string[]` — The parallel regions a state sits in, outermost first: each the child of a parallel ancestor.
- `actsIn(event: string, regions: string[])` — Whether an event can matter to what happens in `regions`: some state that handles it sits in those regions or outside them (never only in a sibling region). Regions of a statechart without guards are independent, so exploring one region with the others held still loses nothing and keeps the search from multiplying across regions.
- `regionSets()` — Every distinct set of regions a state sits in, the empty set (outside every parallel) first.
- `initial(): Config` — The configuration the chart starts in.
- `valueOf(state: string): StateValue` — The state value that names `state`: its ancestors down to it, defaults filled in by `resolve`.
- `resolve(value: StateValue): Config` — Fills a partial state value in with each parent's initial child, returning a complete configuration.
- `enabledEvents(config: Config)` — Names of the events some active state handles (a state's own or an ancestor's), without duplicates. Whether the event moves anything is for `step` to say.
- `firedBy(config: Config, event: string)` — The transitions `event` fires from `config`: in each region, the deepest active state that handles it.
- `step(config: Config, event: string): { config: Config; fired: string[] } | null` — Takes `event` from `config`: the next configuration and the transition ids that fired, or `null` when no active state handles the event.
- `pendingHandOffs(config: Config)` — Hand-off states active in `config` (a child's former final states), with the event each passes on.
- `replay(start: Config, events: readonly string[])` — Replay member- and system-sent events, inserting hand-off events whenever a hand-off state becomes active, as the composed spec says the parent receives them automatically.
- `explore(start: Config | Config[], allowed: (event: string) => boolean, maxConfigs = 20_000)` — Breadth-first from one or several starts at once: every configuration reachable using only `allowed` events, each with the shortest event path from its nearest start (`origin` is that start's index; ties go to the earlier start). `firstFired` holds, for every transition, the shortest way to take it: the configuration it fires from and how that configuration was reached. Exploration order is fixed by the chart, so the result is deterministic.

### Atlas core

Source: `packages/core/src/index.ts`. Import: `@crvouga/atlas`

The public entry point of `@crvouga/atlas`: define a config (`defineConfig`), then load, lint, plan
and run executable statecharts against a real product through a driver, and write a manifest of the
results. This file only re-exports, grouped by stage: spec (types, load, SCXML, composition), graph,
lint, plan, run (drivers, implementations, execution), business events, privacy, report formats and
config. It does no work at import time. Browser-safe parts are also available from `./spec`.

See docs/statecharts.md

### Spec linter

Source: `packages/core/src/lint.ts`

Decides whether a spec bundle is executable before anything runs: pure structure, reachable states,
no silent dead ends, journeys that replay, and (optionally) an implementation for everything in scope.
It reports problems as findings rather than throwing, except when the charts cannot be composed at
all. The `rule` of a finding is a stable short name (`pure`, `naming`, `meta`, `reachable`,
`dead-end`, `journey`, `implemented`). `runConfig` refuses to run when any finding other than
`implemented` exists.

See docs/statecharts.md

#### `LintFinding`

```ts
export type LintFinding = {
  /** Which check found it: `pure`, `naming`, `meta`, `reachable`, `dead-end`, `journey` or `implemented`. */
  rule: string;
  /** A sentence for a person, naming the state, event or journey concerned. */
  message: string;
};
```

One problem found by `lintBundle`.

#### `LintOptions`

```ts
export type LintOptions = {
  /** Meta fields every state must carry; `description` by default. */
  requiredMeta?: readonly string[];
  /** Only these states and events need implementations (a chart being brought up). */
  scope?: { states: ReadonlySet<string>; events: ReadonlySet<string> };
  /** The event and state names the implementation provides. When given, anything in scope without one is an `implemented` finding. */
  implementations?: { events: ReadonlySet<string>; states: ReadonlySet<string> };
};
```

Options for `lintBundle`.

#### `lintBundle`

```ts
export function lintBundle(bundle: SpecBundle, options: LintOptions = {})
```

Checks a spec bundle is executable: pure (no guards, actions, context or delays), every state
reachable, no dead ends without `meta.deadEnd`, every journey replays to its `endsIn` states, and
(when implementations are given) every event and state in scope has one.

Findings are returned, never thrown. Each leaf state counts as having an exit when it or any
ancestor handles an event; final states are exempt from the dead-end rule. `requiredMeta` applies
to states, not to the chart's root. Only leaf states need recognisers.

**Returns** `findings`; the `composition` and `graph` it built (reuse them rather than composing
again); each journey with its `replay`; and the names in `unimplemented`.

**Throws** Error when the charts cannot be composed (a missing or cyclic child chart, a child final
with nowhere to go); the message lists the findings gathered so far.

**Example**

```ts
const { findings } = lintBundle(loadSpecDirectory('./specs'));
if (findings.length) throw new Error(findings.map((f) => f.message).join('\n'));
```

### Run planner

Source: `packages/core/src/plan.ts`

Decides, from the charts alone, which paths a run executes: the curated journeys (cut at seeded
configurations), plus the shortest generated path to every transition the journeys leave uncovered.
It also computes the scope of a run (all of the product, one chart, or one state). Pure and
deterministic: the same bundle, scope, seeds and blocked events give the same paths, ids and keys on
any machine, which is what lets shards and reruns be composed. It never runs the product.

See docs/statecharts.md

#### `ChartScope`

```ts
export type ChartScope = {
  /** The id of the chart being run. */
  chart: string;
  /** Set when the run covers one state of the chart and what is inside it. */
  state?: string;
  /** The configuration each generated path starts from. */
  start: StateValue;
  /** A phrase describing the start for reports. */
  startLabel: string;
  /** Names of the states in scope. */
  states: Set<string>;
  /** Ids of the transitions in scope (see `transitionId`): the ones the run must cover. */
  transitions: Set<string>;
  /** Names of the events of those transitions. */
  events: Set<string>;
  /** Transitions that enter the chart from outside it. */
  entries: Set<string>;
};
```

The part of the composed product one run covers, as computed by `chartScope`.

#### `PlannedStep`

```ts
export type PlannedStep = {
  event: string;
  /** Ids of the transitions the event fires (see `transitionId`). */
  transitions: string[];
  handOff: boolean;
  /** Names of the active states before the step. */
  from: string[];
  /** Names of the active states after the step. */
  to: string[];
};
```

One event of a planned path, with the transitions it fires and the active states before and after. A hand-off step is inserted automatically and is not driven by the implementation's events.

#### `PlannedPath`

```ts
export type PlannedPath = {
  /** `journey-<n>` or `generated-<n>`, numbered in plan order. Stable for a given plan; use `key` to match across plans. */
  id: string;
  /** The same start and events give the same key on any machine and in any run. */
  key: string;
  /** The journey's name, or `Covers: <state> → <event>` for a generated path. */
  name: string;
  kind: 'journey' | 'generated';
  description: string;
  steps: PlannedStep[];
  /** Active states the path starts in, for the implementation's setup. */
  start: string[];
  /** The seed that puts the system in the start configuration; `setup` does it when absent. */
  seed?: string;
  /** The journeys this stretch belongs to: a stretch several journeys share is run once. */
  journeys?: string[];
  /** Why the path cannot fully run: `Start: <reason>` when its start cannot be set up, then the blocked events on it. Empty when it can run in full. */
  blockedBy: string[];
  /** A blocked path whose runnable part other paths already cover: reported, not run. */
  skipRun?: boolean;
};
```

One sequence of events to run against the product from a start point.

#### `ScopeOptions`

```ts
export type ScopeOptions = {
  /** The chart to run; the root chart (the whole product) when omitted. */
  chart?: string;
  /** Where generated paths start; the root's initial configuration when omitted. */
  start?: StateValue;
  /** A phrase describing the start for reports; `The start of the chart` when omitted. */
  startLabel?: string;
  /** Only these events enter the chart from outside it; every entering transition when omitted. */
  entryEvents?: string[];
  /**
   * Cover only this state and what is inside it, with the transitions into and out of it: one
   * area of a chart that holds the whole product.
   */
  state?: string;
};
```

What to narrow a run to; all fields are optional and combine in `chartScope`.

#### `chartScope`

```ts
export function chartScope(bundle: SpecBundle, composition: Composition, graph: ChartGraph, options: ScopeOptions = {}): ChartScope
```

The part of the composed product a run covers: every state of `chart`, the transitions that
enter it from outside, and the hand-offs back to its parent. With `options.state`, the scope is
that state, everything inside it, and the transitions into and out of it.

**Throws** Error when `options.state` names a state that does not exist.

#### `SeedPoint`

```ts
export type SeedPoint = {
  name: string;
  /** The configuration the seed produces, as a state name or a full state value. */
  at: StateValue;
  /** The reason the seed cannot be used yet. A blocked seed starts no path. */
  blocked?: string;
  /** Events this seed is a variant for: it starts only paths that take one of them, and they start only from it. */
  for?: string[];
  /** The state the seed leaves on screen; in a parallel state it picks the region the first event must act in. */
  shows?: string;
};
```

A named seed: a configuration the implementation can put the system in directly.

#### `PlannedJourney`

```ts
export type PlannedJourney = {
  name: string;
  description: string;
  /** Ids of the paths the journey is cut into, in order. */
  paths: string[];
};
```

A journey as the paths it is cut into, one per seeded stretch, in order.

#### `PlanOptions`

```ts
export type PlanOptions = {
  /** Events that cannot run yet; paths stop before them. */
  isBlocked?: (event: string) => boolean;
  /** Whether the implementation can set a path up in this starting configuration. */
  canStart?: (active: string[]) => true | string;
  /**
   * Configurations the implementation can seed directly. Paths start from the nearest one, and
   * journeys are cut wherever they pass through one, so every stretch runs on its own.
   */
  seeds?: SeedPoint[];
  /** Whether `setup` can start a path at the scope's start; true when omitted. */
  hasSetup?: boolean;
};
```

Inputs to `planChart` that come from the implementation rather than the charts.

#### `runnableSteps`

```ts
export function runnableSteps(steps: PlannedStep[], isBlocked: (event: string) => boolean)
```

The steps a path can actually run: everything before its first blocked event.

#### `pathKey`

```ts
export function pathKey(seed: string | undefined, start: Config, events: string[])
```

A 16-hex-character key for a path: a SHA-256 of its seed name, start configuration and event names.
Identical on every machine and run; it is how reruns, merges and layers match a path across runs.

#### `planChart`

```ts
export function planChart(bundle: SpecBundle, graph: ChartGraph, scope: ChartScope, options: PlanOptions = {})
```

Paths for one chart. Every path starts at a start point: the scope's start (through `setup`)
or a seed. Each curated journey is replayed from the chart's initial state and cut into
stretches wherever it passes through a seeded configuration; identical stretches of different
journeys become one path. Then the shortest extra path from the nearest start point is added
for every transition still uncovered, and extra paths that are a prefix of another path are
dropped. Everything is ordered by the chart and the journeys, so the plan is deterministic.

Paths stop before blocked events. A path whose start cannot be set up gets a `Start:` entry in
`blockedBy`, and a blocked path whose runnable steps add no coverage gets `skipRun`. The generated
paths are searched first avoiding blocked events, then (for what remains) allowing them.

**Returns** `paths` (journey paths first, then generated, with ids assigned), `unreachable` (ids of
in-scope transitions no startable path takes), `journeys` (the paths each journey is cut into),
and `seeds` (each seed's name and active states, with `blocked` when it cannot be seeded yet).

See /statecharts.md

### Privacy scanning

Source: `packages/core/src/privacy.ts`

Keeps real personal data out of the media and manifests a run produces and shares: patterns for
data that must never appear, an allow-list for synthetic emails, and an allow-list of hosts a run may
target. Findings describe what matched without repeating it. These are pure functions of their input;
the runner applies them to the text a driver reports after each step and to the finished manifest.

See docs/statecharts.md

#### `DEFAULT_PRIVACY`

```ts
export const DEFAULT_PRIVACY: Required<PrivacyRules>
```

Defaults that fit any product: no real-looking emails, SSNs or card numbers in media or manifests.

#### `mergePrivacy`

```ts
export function mergePrivacy(rules: PrivacyRules = {}): Required<PrivacyRules>
```

Combines a project's `PrivacyRules` with `DEFAULT_PRIVACY`: its `deny` and `allowEmails` are added
to the defaults, while its `allowHosts`, when given, replaces the default hosts (so list loopback
again if you still need it).

#### `privacyFindings`

```ts
export function privacyFindings(text: string, where: string, rules: Required<PrivacyRules>)
```

Scans `text` for real-looking personal data and returns one description per finding, each
prefixed by `where` and never containing the matched text (an email is shortened to its first
letter and domain). Flags emails not matching `rules.allowEmails` and anything matching a
`rules.deny` pattern. Returns an empty array when the text is clean.

- `rules`: the merged rules (`mergePrivacy`).

#### `assertAllowedTarget`

```ts
export function assertAllowedTarget(urls: string[], rules: Required<PrivacyRules>)
```

Throws unless every URL's hostname is in `rules.allowHosts` (loopback by default), so a run
cannot touch a real environment by accident.

**Throws** Error naming the first refused host, or a `TypeError` for a URL that does not parse.

### Run report formats

Source: `packages/core/src/report/formats.ts`

Pure converters from a run's manifest (or a chart) to the formats other tools read: JUnit XML, CTRF
JSON, WebVTT captions and a Mermaid state diagram. They take plain data, do no I/O and are
deterministic. The manifest is read through a minimal structural type, so only the fields named
there are required of it.

See docs/statecharts.md

#### `toJUnit`

```ts
export function toJUnit(manifest: ManifestLike)
```

Renders the manifest as JUnit XML (the format every CI system reads): one test case per path,
with `classname` the path kind (`journey` or `generated`). A failed path is a `failure` carrying
the last attempt's error, a `not-reached` path is `skipped` (with the blocking reason when there is
one), and a flaky path passes with a note in `system-out`. The suite time is the run duration in seconds.

#### `toCtrf`

```ts
export function toCtrf(manifest: ManifestLike)
```

Renders the manifest as CTRF (Common Test Report Format, https://ctrf.io) JSON: one test per
path, its steps as `steps`. `flaky` paths are `passed` with `flaky: true`, `not-reached` is
`skipped`, and the failed path's trace (if any) is attached. Per-test `duration` is always 0:
only the run's start and stop times are recorded.

#### `toWebVtt`

```ts
export function toWebVtt(timeline: TimelineEntry[], durationMs: number)
```

Renders WebVTT captions for a clip, one cue per timeline entry. A cue lasts until the next entry
(or the clip's end), at least 500 ms and at most 4 s.

- `timeline`: the step's entries, with `atMs` relative to the start of the clip.

- `durationMs`: the clip's length in milliseconds.

#### `toMermaid`

```ts
export function toMermaid(machine: MachineConfig)
```

Renders a machine as a Mermaid `stateDiagram-v2` with nested and parallel states. States get
short ids (`s0`, `s1`, ... in order of first use) and keep their names as labels; `:` and `;` in event
names are replaced by spaces because Mermaid reads them as syntax. Written as `chart.mmd` in every run.

### Markdown chart map

Source: `packages/core/src/report/markdown.ts`

Renders a chart (usually the composed product) as a Markdown document for the people who own the
product, not for developers: plain Markdown with internal links, so it renders on any code host
and diffs with the chart. Pure and deterministic.

#### `toMarkdown`

```ts
export function toMarkdown(machine: MachineConfig, journeys: Journey[] = [])
```

A readable map of a chart for the people who own the product: one section per area (parallel
regions apart), each state with what it means, what the user sees, and every event that can
happen there and where it leads, then the named journeys. Plain Markdown, so it renders on any
code host and diffs with the chart.

Top-level states become sections, and each region of a top-level parallel state gets its own. A
`snapshot` is shown only when it contains whitespace (so an identifier-like snapshot is left out),
and a state with `confidence: 'assumed'` is marked as unconfirmed. Links use GitHub's heading anchors.

- `machine`: the chart, composed if child charts should be inlined.

- `journeys`: the named journeys to list at the end; none by default.

See /statecharts.md

### Multi-client composition

Source: `packages/core/src/run/clients.ts`

Lets one run drive several clients at once (a phone, a desktop browser, an API) by combining their
drivers into one driver whose context is a record keyed by client name, and their implementations
into one implementation. Each event and state records which client it acts on, which decides whose
screen is photographed and recorded. Owns no driver behaviour of its own; it only routes to the
drivers it is given.

See docs/statecharts.md

#### `CombineDriversOptions`

```ts
export type CombineDriversOptions = {
  /**
   * `focused` (default) screenshots the client a state is recognised on; `all` also screenshots
   * every other client at the same moment, kept in the image's `also`.
   */
  screens?: 'focused' | 'all';
};
```

Options for `combineDrivers`.

#### `combineDrivers`

```ts
export function combineDrivers<M extends Record<string, unknown>>(
  drivers: { [K in keyof M]: Driver<M[K]> },
  options: CombineDriversOptions = {}
): Driver<M>
```

Run several drivers as the clients of one run: a member on an iOS simulator (WebDriver/Appium
or Detox), an operator on a desktop browser (Playwright, Bun WebView), a partner system over
HTTP. Each client gets its own context, keyed by name; events and states say which client they
act on (`onClient`, `combineImplementations`), so screenshots and clips come from that client's
screen. Timeline entries are tagged with the client that made them.

The combined driver's `concurrency` is the smallest of the drivers' (1 for any that give none),
its `pacing` is the first driver's that has one, and its name lists `<client>:<driver name>`.
If any client fails to open, the ones that did open are closed and the open throws naming that client.
Closing returns the first client's trace as `trace` and every client's in `traces`. Without
a `focus`, `screenshot` and `record` use the first driver that supports them and `text` joins every
client's text.

**Throws** Error when `drivers` is empty.

See /statecharts.md

**Example**

```ts
const driver = combineDrivers<{ member: Page; api: HttpClient }>({
  member: playwrightDriver(),
  api: httpDriver('http://127.0.0.1:4000')
});
```

#### `onClient`

```ts
export function onClient<K extends string, C>(
  client: K,
  impl: StateImplementation<C> | EventImplementation<C>
): StateImplementation<Record<K, C>> | EventImplementation<Record<K, C>>
```

Lifts a state or an event implementation to a client of a multi-client context (see the overloads above); a value with `recognize` is a state.

#### `ImplementationPart`

```ts
export type ImplementationPart<C> = Partial<Implementation<C>>;
```

Part of an implementation (any subset of its fields): what one client does and shows, or what spans clients.

#### `combineImplementations`

```ts
export function combineImplementations<M extends Record<string, unknown>>(
  parts: { [K in keyof M]?: ImplementationPart<M[K]> },
  shared: ImplementationPart<M> = {}
): Implementation<M>
```

Merge per-client implementations into one. Each client's part is written against that client's
own context (a Playwright page, a WebDriver session, an HTTP client), so the helpers of every
driver work unchanged; `shared` holds what needs several clients at once (read an id on one
screen, act on it on another). `shared.setup` runs first (seed data), then each client's setup
in the order the clients are listed. An event or state implemented twice is an error.

A seed with the same name in several parts runs `shared`'s first, then each client's; the combined
seed's `at` is the first one's and its `how` joins all of them. Correlation ids are pooled,
and `canStart` returns the first reason any part gives.

- `parts`: the implementation of each client, against that client's own context.

- `shared`: events, states, seeds and setup that need several clients at once, against the combined context.

**Throws** Error when an event or state is implemented by more than one part (including `shared`).

See /statecharts.md

**Example**

```ts
const implementation = combineImplementations<{ member: SignalContext; api: HttpClient }>(
  { member: { events: {}, states: {} }, api: { events: {}, states: {} } },
  { setup: async ({ api }) => void (await api.post('/test/reset')) }
);
```

#### `mergeImplementations`

```ts
export function mergeImplementations<C>(...parts: ImplementationPart<C>[]): Implementation<C>
```

Merge parts of one implementation written against the same context, such as one file per area
of a large chart (sign-up, checkout, results). Events, states and seeds must each be
implemented once; setups run in order, `canStart` returns the first reason any part gives, and
correlation ids are pooled without duplicates.

**Throws** Error when an event, state or seed appears in more than one part.

### Path runner and manifest

Source: `packages/core/src/run/execute.ts`

Runs planned paths against the product through a driver and turns what happened into a run: a
directory holding `manifest.json`, `junit.xml`, `ctrf.json`, `chart.mmd`, `outcomes.json` and `media/`.
The invariants: the manifest is a pure fold of the plan and the per-path outcomes in plan order (so
worker scheduling, sharding and reruns never change the report); it is rewritten atomically after
every path so a crash keeps what ran; a failed path is retried once, and passing the second time is
`flaky`. This module is the only one that touches the driver and the file system for a run. Its
outputs follow the manifest schema in `packages/schema` (`schemaVersion: 1`).

See docs/statecharts.md

#### `PlannedSeed`

```ts
export type PlannedSeed = { name: string; active: string[]; blocked?: string };
```

A seed as the plan sees it: where it starts, and whether it can run yet.

#### `Shard`

```ts
export type Shard = { index: number; count: number };
```

One shard of a run split across machines: `index` is 1-based.

#### `RunContext`

```ts
export type RunContext<C> = {
  /** The loaded charts. Their files are re-read (to hash them into `specVersion`) when the manifest is built. */
  bundle: SpecBundle;
  composition: Composition;
  graph: ChartGraph;
  scope: ChartScope;
  implementation: Implementation<C>;
  /** The journeys of the plan, as the paths they are cut into; journeys are reported from them. */
  journeys?: PlannedJourney[];
  /** The plan's seeds, reported in the manifest with the paths that start from and verify each. */
  seeds?: PlannedSeed[];
  /** How a business event name is recognised, by name; see `EventMatcher`. */
  eventMatchers?: Record<string, EventMatcher>;
  privacy?: PrivacyRules;
  /** Recorded in the manifest as the run's environment. */
  environment?: Record<string, unknown>;
};
```

What a run reports about: the spec, the scope, and the implementation's metadata.

#### `RunOptions`

```ts
export type RunOptions<C> = RunContext<C> & {
  /** The whole plan, in plan order. Paths marked `skipRun` are reported but not run. The manifest covers all of them. */
  paths: PlannedPath[];
  driver: Driver<C>;
  mode: RunMode;
  /** Runs land in `<outputRoot>/<run-id>/`. */
  outputRoot: string;
  /** Whether a failed path runs a second time to tell flaky from broken; true unless `false`. */
  retry?: boolean;
  /** How long to wait for a state to be recognised after an event, in milliseconds; 45 000 when omitted. */
  stepTimeoutMs?: number;
  /** Where business events come from. Sources named with a `log:` prefix are treated as log files, not CloudEvents sources. */
  eventSources?: EventSource[];
  /** Path attempts that run at once, capped by the driver's `concurrency`; 1 when omitted. */
  workers?: number;
  /** Reported in the manifest when the paths are one shard of a larger run. */
  shard?: Shard;
  /** Passed outcomes of an earlier run to keep instead of running those paths again. */
  reuse?: { runDir: string; outcomes: Record<string, PathOutcome> };
  /** Receives progress lines; writes to stdout when omitted. */
  log?: (line: string) => void;
};
```

Everything `runPaths` needs: the `RunContext`, the paths to run and how to run them.

#### `PathOutcome`

```ts
export type PathOutcome = {
  id: string;
  /** The path's `key`; outcomes are matched across runs by it, not by `id`. */
  key: string;
  /** `failed` when the last attempt failed, `flaky` when the first failed and the retry passed, `not-reached` when the path stopped at a blocked event, else `passed`. */
  status: Status;
  attempts: Attempt[];
  steps: StepResult[];
  stoppedAt: string | null;
  observed: Observed[];
  /** Where and why the last attempt failed; `null` when it did not. */
  failure: { state: string; recognizer: RecognizerResult | null; looksLike: string[]; shot: Image | null } | null;
  /** Privacy findings from the text the driver reported; they fail the run. */
  leaks: string[];
  /** Wall-clock milliseconds for all attempts of the path. */
  durationMs: number;
  /** How long the last attempt took to seed (or set up) and recognise its start. */
  setupMs?: number;
  /** The run the outcome was taken from, when it was reused rather than run again. */
  reusedFrom?: string;
};
```

Everything one path's run produced, with media paths relative to the run directory. A run's
manifest is a pure function of its plan and these outcomes, folded in plan order, so outcomes
from parallel workers, shards and earlier runs compose into the same report.

#### `estimateMs`

```ts
export const estimateMs = …
```

A rough cost in milliseconds of a path that has never run (5 s to set up, 2.5 s a step); used to order and shard paths.

#### `shardPaths`

```ts
export function shardPaths(paths: PlannedPath[], shard: Shard)
```

The paths one shard runs: longest first onto the least loaded shard, by the plan alone, so
every machine computes the same split. Paths reported without running go to the first shard.

#### `readOutcomes`

```ts
export function readOutcomes(runDir: string): { runId: string; outcomes: Record<string, PathOutcome> } | null
```

Reads the `outcomes.json` of a run directory: the run id and each finished path's outcome by key.
Returns `null` when the file is missing or unreadable, never throws.

#### `durationHistory`

```ts
export function durationHistory(outputRoot: string)
```

Milliseconds each path took, by path key, taken from the newest of the last 10 runs under
`outputRoot` that ran it (outcomes reused from elsewhere are ignored). Empty when the directory
does not exist. `runPaths` uses it to start the slowest paths first.

#### `latestRun`

```ts
export function latestRun(outputRoot: string)
```

The directory of the newest run under `outputRoot` that wrote `outcomes.json` (run ids sort by time), or `null`.

#### `buildManifest`

```ts
export function buildManifest<C>(
  context: RunContext<C>,
  paths: PlannedPath[],
  outcomes: Map<string, PathOutcome>,
  run: { id: string; startedAt: Date; finished: boolean; mode: RunMode; driver: { name: string; clients?: Record<string, string> }; activePaths?: string[]; extra?: Record<string, unknown> }
)
```

Folds path outcomes into the run's manifest object, in plan order: the same plan and outcomes
always give the same manifest, however many workers ran them, in whatever order they finished.

A state or transition is `passed` when a path reached it, `flaky` when only a flaky path did,
`failed` when any failure touched it (a failed check fails its state), else `not-reached`. Reaching a
state also marks its ancestors reached. The whole manifest is scanned for privacy findings, and any
finding sets `privacy.passed` to false. Reads the chart files (for `specVersion`) and runs `git`
in the current directory (for `commit` and `branch`, `null` when that fails). Apart from the
wall-clock fields (`finishedAt`, `updatedAt`, `durationMs`) and those that depend on the working
directory (`commit`, `branch`, `specDirectory`), two folds of the same outcomes are identical.

- `outcomes`: finished or in-progress outcomes by path key; a path with none is `queued` or `running`.

- `run.activePaths`: ids of the paths in flight; they are reported `running` and not counted complete.

- `run.extra`: extra fields merged into `run` of the manifest (workers, shard, reused, mergedFrom).

#### `Manifest`

```ts
export type Manifest = ReturnType<typeof buildManifest>;
```

The manifest object `buildManifest` returns; it is what `manifest.json` contains.

#### `writeRun`

```ts
export function writeRun<C>(
  runDir: string,
  context: RunContext<C>,
  paths: PlannedPath[],
  outcomes: Map<string, PathOutcome>,
  run: Parameters<typeof buildManifest>[3]
)
```

Writes a run's `junit.xml`, `ctrf.json`, `chart.mmd`, `outcomes.json` and `manifest.json` into
`runDir` (each through a temporary file and a rename, so a reader never sees half a file) and returns
the manifest. `outcomes.json` holds only finished paths, not those in `run.activePaths`.

#### `mergeRuns`

```ts
export function mergeRuns<C>(
  context: RunContext<C>,
  paths: PlannedPath[],
  runDirs: string[],
  options: { outputRoot: string; mode?: RunMode; driver?: { name: string; clients?: Record<string, string> } }
)
```

Composes the outcomes of several runs of the same plan (the shards of one run, or a rerun and
the run before it) into one new run directory under `options.outputRoot`, folded in plan order. Media are
copied in, so the merged run stands on its own. Later entries of `runDirs` win when two ran the same
path; outcomes whose key is not in `paths` are ignored. The merged run's mode and driver name are
taken from the run manifests unless `options` gives them.

**Returns** the new `runDir`, its `manifest`, and `ok` (privacy passed and no path failed).

**Throws** Error when a run directory has no `outcomes.json`.

#### `runPaths`

```ts
export async function runPaths<C>(options: RunOptions<C>)
```

Runs planned paths against a system through a driver and writes the run to
`<outputRoot>/<timestamp>-<mode>/`. Paths start from their seed (or the implementation's
`setup`) and run on a pool of workers, longest first (by earlier timings, else `estimateMs`),
each attempt in its own driver context; every state is recognised from the outside after every step;
a failed path is retried once to tell flaky from broken. The manifest is rewritten as each path
finishes, from all outcomes so far in plan order, so a crash keeps what ran and the order paths
finished in never changes the report.

Workers are capped by `driver.concurrency` (1 if the driver gives none) and by the number of paths.
Without `implementation.correlate`, a run on several workers reports business events as "no
signal" rather than guess which attempt they belong to. While it runs it installs
`uncaughtException` and `unhandledRejection` handlers that log and swallow stray errors from
drivers, and removes them when it ends. Passed paths of `options.reuse` are kept instead of re-run.

**Returns** the run directory, the final manifest, and `ok` (privacy passed and no path failed).

See /statecharts.md

### Frame-based clip recorder

Source: `packages/core/src/run/frames.ts`

Builds a video clip for drivers that can only take screenshots: frames are captured repeatedly while
a step runs and encoded afterwards with FFmpeg at their real timing. It owns no driver logic; the
caller supplies the capture function. A missing or failing `ffmpeg` produces no clip, never an error.

#### `FrameRecorderOptions`

```ts
export type FrameRecorderOptions = {
  /** The image format `capture` returns (default png). */
  extension?: 'png' | 'jpg';
  /** Upper bound on frames per second (default 25). */
  maxFps?: number;
};
```

Options for `recordFrames`.

#### `recordFrames`

```ts
export async function recordFrames(capture: () => Promise<Uint8Array>, workDirectory: string, options: FrameRecorderOptions = {})
```

Starts recording a clip from any driver that can take a screenshot: capture frames back to back
while the step runs, then encode them with FFmpeg as H.264 MP4 at their real timing. Drivers
without a native screen recorder (Bun WebView, WebDriver) use it; it needs `ffmpeg` on the PATH.

Capturing starts immediately and continues until `stop` is called. A `capture` that throws or
returns no bytes just skips that frame. The returned `stop(output)` ends capture, writes the MP4 to
`output` and resolves to the clip (`durationMs` is wall-clock time since the call), or to `null`
when no frame was captured or FFmpeg is missing or fails. It writes no poster. Frames and the
FFmpeg frame list are left in `workDirectory`.

- `capture`: returns one screenshot as encoded image bytes in `options.extension`'s format.

- `workDirectory`: where the frames are written; created if missing.

### HTTP driver

Source: `packages/core/src/run/http.ts`

A driver (and a bare client) for acting on or observing a system over HTTP, with no browser or
device: a fetch with a base URL, a cookie jar and timeline logging. It is the fastest driver and
runs any number of attempts side by side, each with its own cookie jar. Uses the global `fetch`.

#### `HttpResponse`

```ts
export type HttpResponse = {
  status: number;
  /** True for a 2xx status. A non-2xx status does not throw. */
  ok: boolean;
  headers: Headers;
  /** The body as text. */
  text: string;
  /** The body parsed as JSON when the content type is JSON and it parses; `null` otherwise (also for a literal JSON `null`). */
  json: unknown;
};
```

The response of an `HttpClient` call; the body is read in full.

#### `HttpRequestOptions`

```ts
export type HttpRequestOptions = {
  /** A string is sent as is; anything else is sent as JSON with a `content-type: application/json` header. */
  body?: unknown;
  /** Added to the client's headers for this call and overriding them (and the cookie header) on conflict. */
  headers?: Record<string, string>;
  /** What the timeline says this call was for; `METHOD /path` when omitted. */
  label?: string;
};
```

Per-call options of an `HttpClient`.

#### `HttpClient`

```ts
export type HttpClient = {
  /** The URL that request paths are resolved against with `new URL(path, baseUrl)`: a path starting with `/` replaces any path in the base URL. */
  baseUrl: string;
  /** Sent with every request; set an `authorization` header here after signing in. */
  headers: Record<string, string>;
  /** Cookie name to value, stored from `Set-Cookie` responses and sent back on every request. Only the name and value are kept (no expiry, path or domain handling). */
  cookies: Map<string, string>;
  /** Sends a request. Rejects on a network error or timeout; resolves for any HTTP status. Each call adds a `system` entry (method, path, status, never bodies) to the timeline. */
  request(method: string, path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  get(path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  post(path: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse>;
  put(path: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse>;
  patch(path: string, body?: unknown, options?: HttpRequestOptions): Promise<HttpResponse>;
  delete(path: string, options?: HttpRequestOptions): Promise<HttpResponse>;
};
```

What every event and recogniser receives from an HTTP client: a fetch with a base URL and a cookie jar.

#### `HttpDriverOptions`

```ts
export type HttpDriverOptions = {
  /** The driver's name and the `source` recorded on timeline entries; `http` when omitted. */
  name?: string;
  /** Headers sent with every request. */
  headers?: Record<string, string>;
  /** Per request, in milliseconds (default 30 000). */
  timeoutMs?: number;
};
```

Options for `httpDriver` and `httpClient`.

#### `httpClient`

```ts
export function httpClient(baseUrl: string, timeline: Timeline, options: HttpDriverOptions = {}): HttpClient
```

Creates an `HttpClient` that logs each call to `timeline`. Use it directly when you need a client
outside a driver; `httpDriver` creates one per path attempt.

- `baseUrl`: the URL request paths are resolved against.

#### `httpDriver`

```ts
export function httpDriver(baseUrl: string | (() => string | Promise<string>), options: HttpDriverOptions = {}): Driver<HttpClient>
```

The fastest driver: a client of an HTTP API, with no browser or device. Use it for actors that
only talk to the system (a partner webhook, an operator API, a back office job) or to drive a
whole chart at the API level. Each path attempt gets a fresh cookie jar; every call is logged to
the step's timeline (method, path, status; never bodies). Has no screenshots or clips, and no limit on
concurrent attempts.

- `baseUrl`: the API's base URL, or a function returning it (called for each attempt).

**Example**

```ts
const driver = httpDriver('http://127.0.0.1:4000', { headers: { 'x-test': '1' } });
// events then receive an HttpClient: run: (api) => api.post('/orders', { sku: 'A1' })
```

### Run types and function driver

Source: `packages/core/src/run/types.ts`

The contracts between a run and the things it drives: `Driver` (owns the system under test for one
path attempt), `Implementation` (how each event is made to happen and each state recognised), `Seed`,
event sources and privacy rules, plus the status vocabulary and `Timeline`. These shapes are what
integrators write against, so they change only by adding optional fields. Also holds
`functionDriver`, the simplest complete driver.

See docs/statecharts.md

#### `RunMode`

```ts
export type RunMode = 'fast' | 'showcase';
```

`fast` runs without pacing and takes screenshots only; `showcase` paces steps like a person and records a clip of every transition.

#### `Status`

```ts
export type Status = 'passed' | 'failed' | 'flaky' | 'not-reached';
```

The result of a path, state, transition or journey: `flaky` passed only on the retry; `not-reached` was never run, was blocked, or has no covering path.

#### `EventKind`

```ts
export type EventKind = 'user' | 'system' | 'time' | 'hand-off';
```

Who or what makes an event happen: a `user` action, a `system` call, the passing of `time`, or a `hand-off` from a child chart (inserted by the planner, usually a no-op).

#### `Image`

```ts
export type Image = {
  /** Path to the PNG. A driver returns an absolute path; in a manifest it is relative to the run directory. */
  png: string;
  /** Path to a WebP thumbnail, when one was made. */
  webp?: string;
  client?: string;
  also?: Image[];
};
```

`client` names which client's screen it is in a multi-client run; `also` holds the other clients' screens at the same moment.

#### `Clip`

```ts
export type Clip = {
  /** Path to the MP4 (relative to the run directory in a manifest). */
  video: string;
  /** Path to a poster image, when one was made. */
  poster?: string;
  durationMs: number;
  /** The client whose screen was recorded, in a multi-client run. */
  client?: string;
};
```

A recorded video of one transition.

#### `TimelineEntry`

```ts
export type TimelineEntry = {
  /** Milliseconds since the step began (see `Timeline.restart`). */
  atMs: number;
  /** What kind of thing happened. */
  kind: 'tap' | 'type' | 'system' | 'screen' | 'toast' | 'note' | 'time' | 'notification';
  /** The caption. */
  label: string;
  /** For a tap, where it landed (page pixels for the Playwright driver). */
  x?: number;
  y?: number;
  /** For typing, what was typed; shown in the caption. */
  text?: string;
  /** For a system call, what it was (never bodies). */
  system?: { source?: string; endpoint?: string; eventType?: string; payload?: unknown; responseStatus?: number };
  /** The client that did it, in a multi-client run. */
  client?: string;
};
```

One thing that happened during a step, which becomes a caption on the step's clip.

#### `Timeline`

```ts
export class Timeline
```

What a step records while it runs: taps, typing, system calls, the screen change. `for(client)`
returns a view onto the same timeline that tags every entry with that client. The runner restarts
it at the start of every step, so entries are relative to the step they belong to.

- `readonly client: string | undefined;` — The client this view tags entries with; `undefined` on the root timeline.
- `get entries() { return this.state.entries; }` — Every entry added since the last `restart`, in order, shared by all views of the timeline.
- `restart()` — Clears the entries and makes now the origin for `atMs`.
- `add(entry: Omit<TimelineEntry, 'atMs'>)` — Appends an entry stamped with the time since the origin, and with this view's client when it has one.
- `for(client: string)` — A view of the same timeline that tags what it adds with `client`.

#### `RecognizerResult`

```ts
export type RecognizerResult = {
  /** Whether the state is showing. */
  matched: boolean;
  /** What was looked at, shown to explain a failure. `expected` is `visible` or `hidden`. */
  signals: { signal: string; expected: 'visible' | 'hidden' | string; visible: boolean }[];
};
```

What a state recogniser found.

#### `CheckResult`

```ts
export type CheckResult = {
  /** The check statement, quoted from the spec. */
  check: string;
  passed: boolean;
  expected?: string;
  actual?: string;
};
```

The result of one of a state's `meta.checks`; a failed check fails the state.

#### `StepTools`

```ts
export type StepTools = {
  timeline: Timeline;
  mode: RunMode;
  /** Pause for the pacing of the current mode (no-op in fast mode for the default pauses). */
  hold(ms: number): Promise<void>;
  /** Scratch space shared by the events of one path attempt. */
  data: Record<string, unknown>;
};
```

Per-attempt tools handed to every implementation.

#### `Focus`

```ts
export type Focus = { client?: string };
```

Which client a media hook should look at, in a multi-client run: the client a state is
recognised on, or the client an event is done on. Single-client drivers ignore it.

#### `Driver`

```ts
export type Driver<C> = {
  /** Shown in reports as the driver the run used. */
  name: string;
  /**
   * Creates a fresh context for one attempt of one path. `attempt` is 1, or 2 for the retry;
   * `directory` is a scratch directory for this attempt; the driver should log what it does to `timeline`.
   */
  open(input: { path: PlannedPath; attempt: number; mode: RunMode; directory: string; timeline: Timeline }): Promise<C>;
  /**
   * Releases the context. `traceFile` is where a trace may be written when `failed`; return the path
   * actually written as `trace` (or one per client as `traces`) to attach it to the report.
   */
  close(ctx: C, input: { failed: boolean; traceFile: string }): Promise<{ trace?: string; traces?: Record<string, string> } | void>;
  /** A settled, deterministic screenshot of the current screen. */
  screenshot?(ctx: C, file: string, focus?: Focus): Promise<Image | null>;
  /** Start recording one transition; `stop` encodes it and returns the clip. */
  record?(ctx: C, workDirectory: string, focus?: Focus): Promise<{ stop(output: string): Promise<Clip | null> }>;
  /** Visible text of the screen, for the privacy scan (every client's screen when unfocused). */
  text?(ctx: C, focus?: Focus): Promise<string>;
  /** Pause between actions; drivers can show it (a touch overlay idling) or ignore it. */
  hold?(ctx: C, ms: number, focus?: Focus): Promise<void>;
  /** The clients of a multi-client driver, by name, with the driver each runs on. */
  clients?: Record<string, string>;
  /** Pacing for showcase mode, in milliseconds. */
  pacing?: { before: number; after: number };
  /**
   * How many path attempts can have a context open at once (browser contexts are independent; a
   * single device is not). Runs use at most this many workers; 1 when omitted.
   */
  concurrency?: number;
  /** Releases what is shared by all contexts (a browser, a server); called once after the last path. */
  dispose?(): Promise<void>;
};
```

A driver owns the thing under test for one path attempt: a browser context (Playwright), a
device (Detox, WebDriver/Appium), a model or an API client. Only `open` and `close` are
required; media hooks are used when present. `combineDrivers` runs several at once.

#### `EventImplementation`

```ts
export type EventImplementation<C> = {
  /** Who makes the event happen; recorded with the event in the manifest. */
  kind: EventKind;
  /** The client that does it, in a multi-client run: its screen is recorded for the clip. */
  client?: string;
  /** A plain-language note on how the runner makes it happen (shown to developers). */
  how: string;
  /** Test data the event needs before the path starts (a condition modelled as an event). */
  prepare?(ctx: C, tools: StepTools): Promise<void>;
  /** Makes the event happen. The runner then waits for the target state to be recognised, so `run` does not need to wait for it; it should throw only when the event cannot be done. */
  run(ctx: C, tools: StepTools): Promise<void>;
  /** Set when the event cannot be triggered reliably yet: the path stops before it. */
  blocked?: string;
};
```

How one event is made to happen. Keyed by the event's exact name in the spec.

#### `StateImplementation`

```ts
export type StateImplementation<C> = {
  /** Looks at the system from the outside and says whether the state is showing. Called repeatedly (with growing pauses, until `stepTimeoutMs`) while the runner waits for the state, so it must be cheap and side-effect free. */
  recognize(ctx: C): Promise<RecognizerResult>;
  /** The client whose screen shows it, in a multi-client run: that screen is the screenshot. */
  client?: string;
  /** Shown too briefly to wait for: not seeing it is not a failure. */
  transient?: boolean;
  /** States the UI cannot tell apart; never reported as "looks like" each other. */
  sameAs?: string;
  /** Where to look when the state changes off-screen (open a tab, reload). */
  lookIn?(ctx: C): Promise<void>;
  /** Within-state actions after the screenshot (dismiss a success message). */
  settle?(ctx: C): Promise<void>;
  /** Results for the state's `meta.checks`, evaluated once the state is recognised. */
  checks?(ctx: C): Promise<CheckResult[]>;
};
```

How one state is recognised from the outside, and what is checked there.

#### `Seed`

```ts
export type Seed<C> = {
  /** A state name (with the default configuration inside and beside it) or a full state value. */
  at: string | StateValue;
  /** A plain-language note on how the seed gets there (shown to developers). */
  how: string;
  run(ctx: C, input: { path: PlannedPath; tools: StepTools }): Promise<void>;
  /**
   * The state the seed leaves on screen, recognised before the first step. In a parallel state
   * it says which region the seed opens. The state `at` names (or its active leaf), or the last
   * active leaf, when omitted.
   */
  shows?: string;
  /**
   * Events this seed exists for: a variant of a configuration (the same states, different data,
   * such as a member at an address no lab serves). It starts only paths that take one of these
   * events, and paths that take one start from a seed that lists it.
   */
  for?: string[];
  /** Set when the configuration cannot be seeded yet: paths start from another seed. */
  blocked?: string;
};
```

Puts the system directly in one configuration of the chart (create the data, sign in, open the
screen), so paths can start there instead of walking every step before it. A seed must leave
the system exactly as the steps that lead there would: then results of the stretch before it
and the stretch after it compose, and Atlas checks that by recognising the state both ways.

#### `Implementation`

```ts
export type Implementation<C> = {
  /** By event name; an event with no entry is reported as blocked. */
  events: Record<string, EventImplementation<C>>;
  /** By state name; only leaf states need one. */
  states: Record<string, StateImplementation<C>>;
  /**
   * Named seeds: configurations paths can start from. Journeys are cut at every seeded
   * configuration they pass through, so each stretch runs on its own and in parallel.
   */
  seeds?: Record<string, Seed<C>>;
  /** Put the system in the scope's start configuration, for paths that start without a seed. */
  setup?(ctx: C, input: { path: PlannedPath; tools: StepTools }): Promise<void>;
  /** Whether `setup` can start a path in this configuration; a string is the reason it cannot. */
  canStart?(active: string[]): true | string;
  /**
   * Ids that tell this attempt's business events from those of attempts running beside it (a
   * user id, a trace id). Shared event sources keep only events and log lines that contain one.
   */
  correlate?(ctx: C): string[] | Promise<string[]>;
};
```

How a driver makes each event of the spec happen and recognises each state: everything the charts
do not say. Events and states are keyed by their exact names in the spec; only leaf states need a
recogniser.

#### `EventSource`

```ts
export type EventSource = {
  /** Identifies the source; a name starting with `log:` marks a log file, anything else counts as a CloudEvents source. */
  name: string;
  /** Where "now" is in the source; `collect` returns what arrived after this mark. */
  mark(): unknown;
  /** Returns what arrived since `mark` (everything when omitted): CloudEvents and/or raw log text. */
  collect(mark?: unknown): Promise<{ events: CloudEvent[]; text?: string }>;
  /** Releases the source; called when the run ends. */
  close?(): Promise<void>;
};
```

Where business events come from: a CloudEvents endpoint, a log, a message queue.

#### `EventMatcher`

```ts
export type EventMatcher = { type: string } | { pattern: RegExp } | ((events: CloudEvent[], text: string) => boolean);
```

How a business event named in `meta.events` is recognised in what a source collected.

#### `PrivacyRules`

```ts
export type PrivacyRules = {
  /** Patterns that must never appear on screen or in a manifest. */
  deny?: { name: string; pattern: RegExp }[];
  /** Emails that may appear (synthetic domains, support addresses). */
  allowEmails?: RegExp[];
  /** Hosts the run may target; loopback only by default. */
  allowHosts?: string[];
};
```

Rules for what may appear on screen and in a manifest. They extend the defaults (see `DEFAULT_PRIVACY`) except `allowHosts`, which replaces them.

#### `functionDriver`

```ts
export function functionDriver<C>(
  create: (input: { path: PlannedPath; timeline: Timeline }) => C | Promise<C>,
  options: { name?: string; dispose?: (ctx: C) => void | Promise<void>; concurrency?: number } = {}
): Driver<C>
```

A driver for anything you can reach from code: a domain model, an API client, a CLI. `create`
returns a fresh context per path attempt; recognisers and events work on it directly. It takes
no screenshots or clips, and any number of attempts can run side by side unless `concurrency` says otherwise.

- `create`: builds the context for one attempt; it may be async.

- `options.name`: the driver's name in reports; `function` when omitted.

- `options.dispose`: called with the context when the attempt ends.

- `options.concurrency`: how many contexts may be open at once; unlimited when omitted.

See /statecharts.md

**Example**

```ts
const driver = functionDriver(() => new TodoModel());
```

### UI signals

Source: `packages/core/src/signals.ts`. Import: `@crvouga/atlas/signals`

A driver-neutral vocabulary for saying what is on screen (`testId`, `role`, `label`, `text`, `css`),
and `screen(...)`, which builds a state recogniser from signals. Every UI driver (Playwright, Bun
WebView, WebDriver, Detox) resolves the same signals against its own UI tree, so an implementation
written with them runs on any of them. Also holds the wire form and the in-page probe used by drivers
that evaluate JavaScript in a page. This module is browser-safe and has no driver dependencies.

See docs/statecharts.md

#### `Signal`

```ts
export type Signal =
  | { testId: string }
  | { role: string; name?: string | RegExp; exact?: boolean }
  | { text: string | RegExp; exact?: boolean }
  | { label: string | RegExp }
  | { css: string };
```

A UI signal: something visible (or not) that proves where the app is. Test IDs first, then
accessible roles and names, then labels and text, as the Testing Library guidance orders them.
The same values work with every driver that recognises screens by signals (Playwright, Bun
WebView, WebDriver); each resolves them against its own UI tree.

#### `testId`

```ts
export const testId = …
```

A signal for the element with this test ID (`data-testid` on the web, the accessibility identifier on native).

#### `text`

```ts
export const text = …
```

A signal for visible text: a string matches as a case-insensitive substring unless `exact`, a RegExp is tested as is.

#### `role`

```ts
export const role = …
```

A signal for an element with an accessibility role (`button`, `heading`, ...), optionally filtered by its accessible name (same matching as `text`).

#### `label`

```ts
export const label = …
```

A signal for a form control by its label text.

#### `css`

```ts
export const css = …
```

A signal for a CSS selector. Web only: the WebDriver and Detox drivers throw for it in native sessions, so prefer the other signals.

#### `describeSignal`

```ts
export function describeSignal(signal: Signal)
```

Describes a signal in words for recogniser output and failure messages, e.g. `button "Add"`.

#### `SignatureSpec`

```ts
export type SignatureSpec<S = Signal> = {
  /** Every one must be visible. */
  all?: S[];
  /** At least one must be visible (ignored when empty). */
  any?: S[];
  /** None may be visible. */
  none?: S[];
};
```

What a screen looks like, as signals.

#### `ScreenSpec`

```ts
export type ScreenSpec<C, S = Signal> = SignatureSpec<S> & {
  /** Each `check` is a statement from the state's `meta.checks`; it passes when its `signal` is visible. */
  checks?: { check: string; signal: S }[];
  /** See `StateImplementation.transient`. */
  transient?: boolean;
  /** See `StateImplementation.sameAs`. */
  sameAs?: string;
  /** See `StateImplementation.lookIn`. */
  lookIn?: (ctx: C) => Promise<void>;
  /** See `StateImplementation.settle`. */
  settle?: (ctx: C) => Promise<void>;
};
```

A `SignatureSpec` plus the optional parts of a `StateImplementation`, which are passed through.

#### `signatureScreen`

```ts
export function signatureScreen<C, S = Signal>(isVisible: (ctx: C, signal: S) => Promise<boolean>, describe: (signal: S) => string)
```

Builds a `screen()` function for a driver from one question: is this signal visible right now?
A state is recognised when every `all` is visible, one `any` is visible and no `none` is; the result
lists every signal looked at with whether it was visible, for failure reports. An `isVisible` that
rejects counts as not visible. Drivers with their own locators (WebDriver's) pass their signal type
and how to describe it.

- `isVisible`: answers whether one signal is visible in the context.

- `describe`: names a signal in words.

#### `SignalContext`

```ts
export type SignalContext = {
  /** Open a URL (a path resolves against the driver's base URL; a deep link in a native app). */
  goto(url: string): Promise<void>;
  /** Whether the signal is visible now. */
  isVisible(signal: Signal): Promise<boolean>;
  /** Actions a person does. Drivers log each to the step's timeline, which becomes the clip's captions. */
  user: {
    /** Taps or clicks the target; `label` is the caption shown for it. */
    tap(target: Signal, label: string): Promise<void>;
    /** Types `text` into the target; `label` is the caption shown for it. */
    type(target: Signal, text: string, label: string): Promise<void>;
  };
};
```

The driver-neutral surface of a screen: Playwright, Bun WebView and WebDriver (web and native)
contexts all provide it, so an implementation written against it runs on any of them, and the
clients of one run can use different drivers.

#### `screen`

```ts
export const screen = …
```

Builds a state implementation that is recognised from signals on any driver that provides a
`SignalContext`.

**Example**

```ts
states: { 'No todos': screen({ all: [text('Nothing to do yet')], none: [role('listitem')] }) }
```

#### `WireSignal`

```ts
export type WireSignal =
  | { kind: 'css'; selector: string }
  | { kind: 'testId'; id: string }
  | { kind: 'role'; role: string; name: WireMatch | null }
  | { kind: 'label'; match: WireMatch }
  | { kind: 'text'; match: WireMatch };
```

A `Signal` as plain JSON, the form sent to the in-page `DOM_PROBE`.

#### `toWire`

```ts
export function toWire(signal: Signal): WireSignal
```

Converts a signal to its JSON form for a probe that runs inside the page.

#### `DomProbeResult`

```ts
export type DomProbeResult = { visible: boolean; count: number; x?: number; y?: number };
```

Where a probe found a signal: whether it is visible, and the centre of the first visible match in CSS pixels.

#### `DOM_PROBE`

```ts
export const DOM_PROBE = …
```

A function expression, as source, that finds a wire signal in a DOM: `(signal, scroll,
withElement) => DomProbeResult`, plus the element itself when `withElement` is set (WebDriver
returns it as an element reference). It is plain JavaScript so any driver can run it in a page (Bun WebView's
`evaluate`, WebDriver's Execute Script). Roles follow the HTML-AAM implicit role mapping for the
common elements; names follow aria-label, the associated label, then text content.

### Static chart composition

Source: `packages/core/src/spec/compose.ts`

Flattens a bundle of charts into one machine by inlining each child chart into the state that
invokes it, so a plain graph traversal sees the whole product. Pure and deterministic; the input
bundle is not modified. State names are global across the composed product (nothing is renamed or
namespaced), which is why they must be unique across charts.

See docs/statecharts.md

#### `HandOff`

```ts
export type HandOff = { finalState: string; event: string; parentState: string; childChart: string };
```

A child chart's final state and the event it passes to the parent, which the planner and replay insert automatically.

#### `Composition`

```ts
export type Composition = {
  /** The single flattened machine (a deep copy; the bundle is untouched). */
  machine: MachineConfig;
  /** Which chart each state came from. */
  chartOf: Map<string, string>;
  /** A child's former final states and the event each hands to its parent. */
  handOffs: HandOff[];
  /** The state each child chart is inlined into. */
  hosts: Map<string, string>;
};
```

The result of composing a bundle.

#### `composeCharts`

```ts
export function composeCharts(bundle: SpecBundle): Composition
```

Inlines every child chart where its parent invokes it, so XState's graph traversal (which cannot
enter an invoked actor) walks straight through. Supports:

- XState `invoke: { src, id, onDone }` and SCXML `<invoke>` + `done.invoke.<id>`;
- a final state's `meta.doneEvent`, naming the event the parent receives from that final;
- the legacy `meta.childMachine` + `meta.childFinalEvents` on the parent state.

A child's final states stay as states (they keep their screenshots and checks) but stop being
final: each takes the parent's transition for its hand-off event.

Every state without an `id` gets its own name as `id`. A child's `initial` replaces the host
state's `initial`, and the host's transitions that consumed a hand-off event are removed from it.

**Throws** Error when the root chart is not loaded, an invoked chart is not loaded, charts invoke
each other in a cycle, or a child's final state has no matching transition (or `onDone`) in the parent.

**Example**

```ts
const { machine, handOffs } = composeCharts(loadSpecDirectory('./specs'));
```

### Spec entry point (browser-safe)

Source: `packages/core/src/spec/index.ts`. Import: `@crvouga/atlas/spec`

Re-exports the parts of the spec layer that need no Node built-ins: the spec types, chart and
journey parsing, SCXML conversion and static composition. `loadSpecDirectory` (which reads the
file system) is deliberately not here; import it from the package root.

See docs/statecharts.md

### Spec directory loader

Source: `packages/core/src/spec/load.ts`

Reads a specs directory from disk into a `SpecBundle`: every chart file and journeys file directly
inside it (no recursion), and works out the root chart. Node only. Parsing itself lives in `./parse`;
loading throws on the first malformed file rather than skipping it.

See docs/statecharts.md

#### `childChartIds`

```ts
export function childChartIds(machine: MachineConfig)
```

The ids of the charts a machine composes, by `invoke` or the legacy `meta.childMachine`.

#### `bundleOf`

```ts
export function bundleOf(directory: string, charts: Chart[], journeys: Journey[]): SpecBundle
```

Assembles a bundle from already-parsed charts and journeys, choosing the root chart: the first
chart (in the order given) that no other chart invokes, or the first chart when every chart is
invoked by another (a cycle, which `composeCharts` later rejects).

**Throws** Error when `charts` is empty.

#### `loadSpecDirectory`

```ts
export function loadSpecDirectory(directory: string): SpecBundle
```

Loads every chart and journeys file directly inside `directory` into a bundle.

Chart files are `*.scxml`, `*.machine.json` and `*.machine.yaml`/`.yml`; journeys files are
`journeys.yaml`/`.yml`/`.json`. When two files declare the same chart id the first wins, in the
order SCXML, then YAML, then JSON, then by file name, so the result does not depend on directory
order.

**Throws** Error when the directory is missing, a file does not parse, or no chart is found.

See /statecharts.md

**Example**

```ts
const bundle = loadSpecDirectory('./specs');
bundle.root; // the id of the chart no other chart invokes
```

### Chart and journeys parsers

Source: `packages/core/src/spec/parse.ts`

Turns the text of one spec file into a `Chart` or a list of `Journey`. Pure functions of their
input (no file access), so they run in a browser too. They check only the shape that later stages
rely on; whether the chart is executable is the linter's job.

See docs/statecharts.md

#### `parseChart`

```ts
export function parseChart(file: string, text: string): Chart
```

Parses one chart from its text. The file name picks the format: `.scxml` is SCXML (the machine id
falls back to the file's base name), `.json` is an XState config, anything else is read as YAML.

- `file`: the file name, relative to the specs directory; stored as `Chart.file`.

- `text`: the file contents.

**Throws** Error when an XState config is not an object with a string `id` and a `states` object, or
when the text is not valid JSON/YAML/SCXML.

#### `parseJourneys`

```ts
export function parseJourneys(file: string, text: string): Journey[]
```

Parses a journeys file of the form `{ journeys: { <name>: { description, events, endsIn } } }`
(JSON when the name ends in `.json`, otherwise YAML). Journeys come back in declaration order.
`description` defaults to `''` and `endsIn` to `[]`; events are coerced to strings.

**Throws** Error when there is no `journeys` map, or a journey has no `events` list.

### SCXML reader and writer

Source: `packages/core/src/spec/scxml.ts`

Converts W3C SCXML to and from the XState-shaped `MachineConfig` the rest of Atlas uses, for the
pure subset Atlas executes. Business names travel in an `atlas:name` attribute next to a token id,
and metadata in the `atlas` namespace, so reading what `machineToScxml` wrote gives the same chart
back. Browser-safe (no Node built-ins). Reading is synchronous and keeps its id-to-name table in
module state for the duration of one `scxmlToMachine` call, so do not call it re-entrantly.

See docs/statecharts.md

#### `ATLAS_NS`

```ts
export const ATLAS_NS = …
```

The XML namespace of Atlas's SCXML extensions (`atlas:name`, `<atlas:meta>`, `atlas:done-event`).

The SCXML conventions Atlas reads and writes:

- `<state>`, `<parallel>`, `<final>`, `initial`, `<transition event target>`.
- `<invoke type="scxml" src="other.scxml" id>` composes another chart; a transition on
  `done.invoke.<id>` (or `done.invoke`) becomes the invoke's `onDone`.
- Business metadata lives in a foreign namespace, as SCXML allows:
  `<atlas:meta><atlas:description>…</atlas:description><atlas:event>…</atlas:event></atlas:meta>`.
  A final state's `atlas:done-event` attribute names the event its parent receives. Meta values
  that are not strings are written as JSON in an element marked `type="json"`.

#### `scxmlToken`

```ts
export function scxmlToken(name: string)
```

Turns a business name into a valid SCXML id/event token: ASCII lowercase letters, digits and `-`,
starting with a letter or `_` (`s-` is prefixed otherwise). Lossy, so the original name is kept in `atlas:name`.

**Example**

```ts
scxmlToken('Adds a todo') // 'adds-a-todo'
```

#### `scxmlToMachine`

```ts
export function scxmlToMachine(xml: string, fallbackId = 'machine'): MachineConfig
```

Reads an SCXML document into an XState machine config, restoring business names from `atlas:name`.

The machine id is the `name` attribute of `<scxml>`, else `fallbackId`. `initial` is the attribute
when given, else the first child state. A state's `initial` defaults to its first child state
(none for `<parallel>`). Transitions without both an event and a target are skipped.

- `xml`: the document text.

- `fallbackId`: the machine id when the document has no `name`.

**Throws** Error when there is no `<scxml>` root element.

#### `machineToScxml`

```ts
export function machineToScxml(machine: MachineConfig): string
```

Writes a machine config as an SCXML document with Atlas's `atlas:` extensions, so that
`scxmlToMachine(machineToScxml(m))` gives the same chart. Ids are `scxmlToken` forms of the names;
the names are kept in `atlas:name`. Only the pure subset is written: `on`, `invoke`, `meta`, nesting.

### Statechart spec types

Source: `packages/core/src/spec/types.ts`

The data model every other module works on: a chart, a bundle of charts plus journeys, and the
helpers that walk and name states and transitions. Atlas reads statecharts in two open formats:

- W3C SCXML (`*.scxml`), the standard for statecharts.
- XState v5 machine config (`*.machine.json`, `*.machine.yaml`), the JSON form Stately Studio
  imports and exports.

Both load into the XState config shape below. Atlas executes only the pure subset that can be
walked without running code: states, nesting, parallel regions, final states, event
transitions, statically resolvable child charts (`invoke` with a `src` naming another chart),
and `meta`. Guards, actions, context, delays and `always` are rejected by the linter.
This module has no I/O and no Node built-ins.

See docs/statecharts.md

#### `TransitionConfig`

```ts
export type TransitionConfig = { target: string };
```

The object form of a transition. `target` is a state name, optionally prefixed with `#` (a reference by name across the composed product).

#### `InvokeConfig`

```ts
export type InvokeConfig = {
  /** The id of another chart in the bundle; composed statically. */
  src: string;
  /** Names the invocation; the parent hears `done.invoke.<id>` (`<src>` when omitted) when the child ends. */
  id?: string;
  /** Where the parent goes when the child reaches a final state (`done.invoke.<id>`). */
  onDone?: string | TransitionConfig;
};
```

An `invoke` that runs another chart inside a state. It is never executed: `composeCharts` inlines the child chart statically.

#### `StateMeta`

```ts
export type StateMeta = {
  /** What is true in this state. Required on every state by default (`requiredMeta` in the config changes that). */
  description?: string;
  /** What a person sees in this state, in words. */
  snapshot?: string;
  /** Business events that happen on entering the state, compared with what event sources observed. */
  events?: string[];
  /** Whether the behaviour is `confirmed` against the product or only `assumed`. */
  confidence?: 'confirmed' | 'assumed';
  /** Where the behaviour is documented. */
  source?: string[];
  /** Things to verify on screen, quoted from the spec; the implementation's `checks()` returns their results. */
  checks?: string[];
  /** Gherkin-style contracts attached to the state. Core does not read them; they are carried through for viewers. */
  contracts?: { id: string; name: string; source: string; description?: string; steps: { keyword: string; text: string; table?: string[][]; docString?: string }[] }[];
  /** Why a state with no way out is meant to be one. Without it, a state with no outgoing transition is a lint error. */
  deadEnd?: string;
  /** Legacy composition: the chart that runs inside this state. Prefer `invoke`. */
  childMachine?: string;
  /** Legacy composition: child final state → the event the parent receives. Prefer `invoke`. */
  childFinalEvents?: Record<string, string>;
  /** On a final state: the event the parent receives when this final is reached. */
  doneEvent?: string;
  [key: string]: unknown;
};
```

The `meta` of a state: the business-language facts about it that Atlas lints, shows and checks.
Open object: unknown keys are kept and ignored.

See /statecharts.md

#### `StateConfig`

```ts
export type StateConfig = {
  /** Set by `composeCharts` to the state's name when absent; used by `#<name>` targets. */
  id?: string;
  /** The child state entered first. */
  initial?: string;
  /** `parallel`: all child regions are active together. `final`: the state ends its chart (or hands off to the parent). */
  type?: 'parallel' | 'final';
  meta?: StateMeta;
  states?: Record<string, StateConfig>;
  /** Event name (exact business wording) to its transition: a target string or `{ target }`. */
  on?: Record<string, TransitionConfig | string>;
  /** Child chart(s) that run inside this state. */
  invoke?: InvokeConfig | InvokeConfig[];
  [key: string]: unknown;
};
```

One state of an XState-shaped chart, recursively. Keys not listed here (guards, actions, `after`,
...) are accepted by the type so the linter can report them; the planner never executes them.

#### `MachineConfig`

```ts
export type MachineConfig = StateConfig & { id: string };
```

A whole chart: a state config with a required `id`, which is the name other charts `invoke` it by.

#### `Journey`

```ts
export type Journey = {
  /** The key in `journeys.yaml`. */
  name: string;
  /** Empty string when the file gives none. */
  description: string;
  /** Event names in order, using the exact spec wording. Hand-off events are never listed; the planner inserts them. */
  events: string[];
  /** State names that must all be active after the last event. Empty when the file gives none. */
  endsIn: string[];
};
```

A curated, named sequence of events, replayed by the linter and run as its own path(s).

#### `Chart`

```ts
export type Chart = {
  /** Path relative to the spec directory. */
  file: string;
  /** The notation the file was parsed from. */
  format: 'scxml' | 'xstate';
  machine: MachineConfig;
};
```

One loaded chart file.

#### `SpecBundle`

```ts
export type SpecBundle = {
  /** The directory the files were read from. */
  directory: string;
  /** Charts in load order, one per chart id. */
  charts: Chart[];
  /** Journeys from every journeys file, in file then declaration order. */
  journeys: Journey[];
  /** The chart the others are composed into: the one no other chart invokes. */
  root: string;
};
```

Everything loaded from a specs directory.

#### `TRANSITION_SEPARATOR`

```ts
export const TRANSITION_SEPARATOR = …
```

The separator inside a transition id (`<source> :: <event>`). The ids are not escaped, so a state name containing it makes `splitTransitionId` ambiguous.

#### `transitionId`

```ts
export function transitionId(source: string, event: string)
```

The id of a transition: the source state's name and the event, joined by `TRANSITION_SEPARATOR`.

#### `splitTransitionId`

```ts
export function splitTransitionId(id: string)
```

Splits a transition id at its first separator into `{ source, event }`; the inverse of `transitionId`.

#### `targetOf`

```ts
export function targetOf(t: TransitionConfig | string | undefined)
```

The state name a transition leads to, with any leading `#` removed; `undefined` when there is no transition.

#### `StateEntry`

```ts
export type StateEntry = { name: string; node: StateConfig; trail: string[] };
```

A state found by `walkStates`: its name, its config, and the names of its ancestors from the outermost down.

#### `walkStates`

```ts
export function walkStates(config: StateConfig, trail: string[] = []): StateEntry[]
```

Lists every state under `config` depth-first, parents before their children, in declaration order. The root `config` itself is not listed.

#### `invokesOf`

```ts
export function invokesOf(node: StateConfig): InvokeConfig[]
```

The `invoke` entries of a state as an array (empty when it has none).
