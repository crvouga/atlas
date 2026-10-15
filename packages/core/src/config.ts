/**
 * @module Config and programmatic API
 *
 * The user-facing entry point: `defineConfig` types a project's `atlas.config.ts`, and `prepare`,
 * `runConfig` and `mergeConfigRuns` are the programmatic equivalents of `atlas lint`/`plan`, `atlas
 * run` and `atlas merge`. They wire the pieces together (load specs, lint, scope, plan, run) and add
 * no behaviour of their own beyond validating the config against the spec. Relative paths in a config
 * resolve against the `baseDirectory` argument (the config file's directory when called by the CLI).
 *
 * @see docs/statecharts.md
 */
import { availableParallelism } from 'node:os';
import path from 'node:path';

import { createLiveReporter, type LiveReporter, type LiveReporterOptions } from '../../reports/src/live-reporter';
import { httpStore } from '../../reports/src/http-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { publishRunBundle } from '../../reports/src/run-bundle';
import { checksFromManifest } from '../../reports/src/ingest';
import type { StateValue } from './graph';
import type { Shard } from './run/execute';
import type { Driver, EventMatcher, EventSource, Implementation, PrivacyRules, RunMode } from './run/types';
import { lintBundle } from './lint';
import { chartScope, planChart } from './plan';
import { assertAllowedTarget, mergePrivacy } from './privacy';
import { latestRun, mergeRuns, readOutcomes, runPaths, shardPaths } from './run/execute';
import { loadSpecDirectory } from './spec/load';

/**
 * Everything a project says about running its specs. `C` is the type of the driver's context
 * (a Playwright `Page`, a model, ...), which events and states receive.
 */
export type AtlasConfig<C = unknown> = {
  /** The directory holding the charts (`*.scxml`, `*.machine.{json,yaml}`) and `journeys.yaml`. */
  specs: string;
  /** Live reporting endpoint. Defaults to ATLAS_SERVER_URL when set; false disables streaming. */
  reporting?: LiveReporterOptions | false;
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

/**
 * Declares an Atlas config with types, returning it unchanged. Put it as the default export of
 * `atlas.config.ts`; the CLI loads the file with `tsx` and defaults to `atlas.config.ts` in the
 * current directory.
 *
 * @see docs/statecharts.md
 *
 * @example
 * export default defineConfig({
 *   specs: './specs',
 *   driver: () => functionDriver(() => new TodoModel()),
 *   implementation: {
 *     events: { 'Adds a todo': { kind: 'user', how: 'Calls add().', run: async (model) => model.add('x') } },
 *     states: { 'No todos': { recognize: async (model) => ({ matched: model.count === 0, signals: [] }) } }
 *   }
 * });
 */
export function defineConfig<C>(config: AtlasConfig<C>) {
  return config;
}

/** Overrides of a config that the command line can give. */
export type PrepareOptions = {
  /** Scope the run to this state instead of the config's. */
  state?: string;
};

/**
 * Loads, lints and plans a config without running anything (what `atlas lint` and `atlas plan` do).
 *
 * @param baseDirectory what a relative `config.specs` resolves against.
 * @returns the loaded `bundle`; `lint` (findings, composition and graph, including `implemented`
 *   findings for what the implementation lacks); the run's `scope`; the `plan` (paths, journeys, seeds,
 *   `unreachable`); and the resolved `specs` directory.
 * @throws Error when the specs cannot be loaded or composed, when a seed's `shows` is not active where
 *   it starts, or when a seed's `for` names an event no state handles. Lint findings are returned,
 *   not thrown.
 */
export function prepare<C>(config: AtlasConfig<C>, baseDirectory = process.cwd(), options: PrepareOptions = {}) {
  const specs = path.resolve(baseDirectory, config.specs);
  const bundle = loadSpecDirectory(specs);
  const metadata = config.requiredMeta ? { requiredMeta: config.requiredMeta } : {};
  const structure = lintBundle(bundle, metadata);
  const state = options.state ?? config.state;
  const scope = chartScope(bundle, structure.composition, structure.graph, {
    ...(config.chart === undefined ? {} : { chart: config.chart }),
    ...(config.start === undefined ? {} : { start: config.start }),
    ...(config.startLabel === undefined ? {} : { startLabel: config.startLabel }),
    ...(config.entryEvents === undefined ? {} : { entryEvents: config.entryEvents }),
    ...(state === undefined ? {} : { state })
  });
  const impl = config.implementation;
  const implemented = new Set(Object.entries(impl.events).filter(([, e]) => !e.blocked).map(([k]) => k));
  const full = lintBundle(bundle, {
    ...metadata,
    scope: { states: scope.states, events: scope.events },
    implementations: { events: implemented, states: new Set(Object.keys(impl.states)) }
  });
  const isBlocked = (event: string) => !impl.events[event] || Boolean(impl.events[event]!.blocked);
  const seeds = Object.entries(impl.seeds ?? {}).map(([name, seed]) => ({
    name,
    at: typeof seed.at === 'string' ? full.graph.valueOf(seed.at) : seed.at,
    ...(seed.blocked ? { blocked: seed.blocked } : {}),
    ...(seed.for ? { for: seed.for } : {}),
    ...(seed.shows ? { shows: seed.shows } : {})
  }));
  for (const seed of seeds) {
    const shows = impl.seeds![seed.name]!.shows;
    if (shows && !full.graph.resolve(seed.at).active.includes(shows)) throw new Error(`The seed "${seed.name}" shows "${shows}", which is not active where it starts`);
    for (const event of seed.for ?? []) if (!full.graph.stateNames().some((n) => full.graph.node(n)?.on?.[event])) throw new Error(`The seed "${seed.name}" is for "${event}", which no state handles`);
  }
  const plan = planChart(bundle, full.graph, scope, { isBlocked, ...(impl.canStart ? { canStart: impl.canStart } : {}), seeds, hasSetup: Boolean(impl.setup) });
  return { bundle, lint: full, scope, plan, specs };
}

const contextOf = <C>(config: AtlasConfig<C>, prepared: ReturnType<typeof prepare<C>>) => ({
  bundle: prepared.bundle,
  composition: prepared.lint.composition,
  graph: prepared.lint.graph,
  scope: prepared.scope,
  implementation: config.implementation,
  journeys: prepared.plan.journeys,
  seeds: prepared.plan.seeds,
  ...(config.eventMatchers ? { eventMatchers: config.eventMatchers } : {}),
  ...(config.privacy ? { privacy: config.privacy } : {}),
  ...(config.environment ? { environment: config.environment } : {})
});

/** The options of `atlas run` that `runConfig` accepts; each overrides the config's own setting. */
export type RunCommandOptions = PrepareOptions & {
  /** `fast` when omitted. */
  mode?: RunMode;
  /** Override live reporting. Defaults to config.reporting or ATLAS_SERVER_URL. */
  reporting?: LiveReporterOptions | false;
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

/**
 * Runs a config end to end and writes the run (manifest, reports, media) under its output
 * directory, like `atlas run`.
 *
 * Refuses to start (throws) when the spec has any structural lint finding (everything but missing
 * implementations, which just block paths) or when a `targets` URL is not on the privacy allow-list.
 * Then it calls `beforeRun`, creates the driver and runs the planned paths (filtered by
 * `options.paths`/`seeds`/`shard`, reusing earlier passes when `options.reuse` is set).
 *
 * @returns what `runPaths` returns: the run directory, the manifest and `ok` (false if any path
 *   failed or the privacy scan found something).
 * @throws Error also when `reuse` names a run with no outcomes or there is no earlier run for `latest`.
 * @see docs/statecharts.md
 */
export async function runConfig<C>(config: AtlasConfig<C>, options: RunCommandOptions = {}, baseDirectory = process.cwd()) {
  const prepared = prepare(config, baseDirectory, options);
  const structural = prepared.lint.findings.filter((f) => f.rule !== 'implemented');
  if (structural.length) {
    throw new Error(`The spec is not executable:\n${structural.map((f) => `  [${f.rule}] ${f.message}`).join('\n')}`);
  }
  assertAllowedTarget(config.targets ?? [], mergePrivacy(config.privacy));
  await config.beforeRun?.();
  const driver = typeof config.driver === 'function' ? await config.driver() : config.driver;
  const outputRoot = path.resolve(baseDirectory, options.output ?? config.output ?? 'atlas-runs');
  let paths = prepared.plan.paths.filter(
    (p) => (!options.paths || options.paths.includes(p.id)) && (!options.seeds || options.seeds.includes(p.seed ?? 'start'))
  );
  if (options.shard) paths = shardPaths(paths, options.shard);
  const reuseDir = options.reuse === 'latest' ? latestRun(outputRoot) : options.reuse ? path.resolve(options.reuse) : null;
  const reused = reuseDir ? readOutcomes(reuseDir) : null;
  if (options.reuse && !reused) throw new Error(`There is no earlier run to reuse${reuseDir ? ` at ${reuseDir}` : ''}`);
  const requestedReporting = options.reporting ?? config.reporting ?? (process.env.ATLAS_SERVER_URL ? { url: process.env.ATLAS_SERVER_URL, token: process.env.ATLAS_PUBLISH_TOKEN ?? process.env.ATLAS_TOKEN } : undefined);
  const reporting = requestedReporting ? { ...requestedReporting, project: requestedReporting.project ?? process.env.ATLAS_PROJECT, token: requestedReporting.token ?? process.env.ATLAS_PUBLISH_TOKEN ?? process.env.ATLAS_TOKEN } : undefined;
  let live: LiveReporter | undefined;
  const onProgress = reporting ? (manifest: import('./run/execute').Manifest) => {
    if (!manifest.privacy.passed) return;
    live ??= createLiveReporter({ producer: process.env.ATLAS_PRODUCER ?? 'atlas-statecharts', title: `${prepared.scope.chart} · ${options.mode ?? 'fast'}`,
      plannedChecks: paths.length, environment: process.env.ATLAS_ENVIRONMENT ?? 'desktop-web', branch: manifest.run.branch ?? undefined, sha: manifest.run.commit ?? undefined }, reporting);
    const ingested = checksFromManifest(manifest);
    ingested.checks.forEach((check, index) => {
      if (manifest.paths[index]?.progress === 'queued' && !manifest.run.finishedAt) return;
      live!.check({ ...check, steps: check.steps?.slice(-20).map(step => ({ name: step.name, status: step.status })) });
    });
  } : undefined;
  try {
  const outcome = await runPaths({
    ...contextOf(config, prepared),
    paths,
    driver,
    mode: options.mode ?? 'fast',
    outputRoot,
    ...(options.retry === undefined ? {} : { retry: options.retry }),
    ...(config.stepTimeoutMs === undefined ? {} : { stepTimeoutMs: config.stepTimeoutMs }),
    eventSources: config.eventSources ? await config.eventSources() : [],
    workers: options.workers ?? config.workers ?? availableParallelism(),
    ...(options.shard ? { shard: options.shard } : {}),
    ...(reused && reuseDir ? { reuse: { runDir: reuseDir, outcomes: reused.outcomes } } : {}),
    ...(options.log ? { log: options.log } : {}), ...(onProgress ? { onProgress } : {})
  });
  await live?.finish(outcome.manifest.privacy.passed ? 'completed' : 'interrupted', outcome.manifest.privacy.passed ? undefined : 'Run failed its privacy scan; unsafe progress was withheld.');
  if (reporting && outcome.manifest.privacy.passed) {
    const store = httpStore({ url: reporting.url, project: reporting.project, token: reporting.token });
    await publishChecks(store, { producer: process.env.ATLAS_PRODUCER ?? 'atlas-statecharts', environment: process.env.ATLAS_ENVIRONMENT ?? 'desktop-web',
      branch: outcome.manifest.run.branch, sha: outcome.manifest.run.commit, recordedAtMs: Math.max(Date.now(), (live?.finishedAtMs ?? 0) + 1), checks: checksFromManifest(outcome.manifest).checks.map(check => ({ ...check, measurements: [...check.measurements] })) });
    await publishRunBundle(store, outcome.runDir);
  }
  return outcome;
  } catch (error) {
    await live?.finish('interrupted', 'The producer exited before completing the run.').catch(() => {});
    throw error;
  }
}

/**
 * Composes runs of a config (its shards, or a rerun and the run before it) into one new run
 * under the output directory, like `atlas merge`. The plan is recomputed from the config, so the runs
 * must come from the same specs, implementation and seeds.
 *
 * @param runDirs the run directories to compose; later ones win when two ran the same path.
 * @returns what `mergeRuns` returns: the new run directory, its manifest and `ok`.
 * @throws Error when a run directory has no `outcomes.json`.
 */
export function mergeConfigRuns<C>(config: AtlasConfig<C>, runDirs: string[], options: PrepareOptions & { output?: string } = {}, baseDirectory = process.cwd()) {
  const prepared = prepare(config, baseDirectory, options);
  return mergeRuns(
    contextOf(config, prepared),
    prepared.plan.paths,
    runDirs.map((d) => path.resolve(d)),
    { outputRoot: path.resolve(baseDirectory, options.output ?? config.output ?? 'atlas-runs') }
  );
}
