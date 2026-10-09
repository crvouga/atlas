import { availableParallelism } from 'node:os';
import path from 'node:path';

import type { StateValue } from './graph';
import type { Shard } from './run/execute';
import type { Driver, EventMatcher, EventSource, Implementation, PrivacyRules, RunMode } from './run/types';
import { lintBundle } from './lint';
import { chartScope, planChart } from './plan';
import { assertAllowedTarget, mergePrivacy } from './privacy';
import { latestRun, mergeRuns, readOutcomes, runPaths, shardPaths } from './run/execute';
import { loadSpecDirectory } from './spec/load';

export type AtlasConfig<C = unknown> = {
  /** The directory holding the charts (`*.scxml`, `*.machine.{json,yaml}`) and `journeys.yaml`. */
  specs: string;
  /** The chart to run; the root chart when omitted. */
  chart?: string;
  /** Where generated paths start (an XState state value); the initial state when omitted. */
  start?: StateValue;
  startLabel?: string;
  /** Only these events enter the chart from outside it. */
  entryEvents?: string[];
  /** Run only this state and what is inside it, with the transitions into and out of it. */
  state?: string;
  /** Path attempts that run at once (capped by the driver's `concurrency`); one per CPU when omitted. */
  workers?: number;
  /** Runs once before any path: prepare what every seed relies on (reference data, config). */
  beforeRun?: () => Promise<void> | void;
  driver: Driver<C> | (() => Driver<C> | Promise<Driver<C>>);
  implementation: Implementation<C>;
  /** Where runs are written; `atlas-runs` beside the config when omitted. */
  output?: string;
  eventSources?: () => EventSource[] | Promise<EventSource[]>;
  eventMatchers?: Record<string, EventMatcher>;
  privacy?: PrivacyRules;
  /** URLs the run will reach; checked against `privacy.allowHosts` (loopback by default). */
  targets?: string[];
  environment?: Record<string, unknown>;
  stepTimeoutMs?: number;
  /** Meta fields every state must carry (default: description). */
  requiredMeta?: string[];
};

export function defineConfig<C>(config: AtlasConfig<C>) {
  return config;
}

/** Narrow what a config runs from the command line. */
export type PrepareOptions = {
  /** Scope the run to this state instead of the config's. */
  state?: string;
};

/** Load, lint and plan a config without running anything. */
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

export type RunCommandOptions = PrepareOptions & {
  mode?: RunMode;
  /** Only these paths, by id. */
  paths?: string[];
  /** Only paths that start from these seeds ("start" for paths that `setup` starts). */
  seeds?: string[];
  retry?: boolean;
  output?: string;
  workers?: number;
  /** Run one shard of the plan; `atlas merge` composes the shards. */
  shard?: Shard;
  /** Keep the passed paths of this run (or the newest run, with "latest") and run the rest. */
  reuse?: string;
  log?: (line: string) => void;
};

/** Run a config end to end and write its manifest and reports. */
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
  return runPaths({
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
    ...(options.log ? { log: options.log } : {})
  });
}

/** Compose runs of a config (its shards, or a rerun and the run before it) into one run. */
export function mergeConfigRuns<C>(config: AtlasConfig<C>, runDirs: string[], options: PrepareOptions & { output?: string } = {}, baseDirectory = process.cwd()) {
  const prepared = prepare(config, baseDirectory, options);
  return mergeRuns(
    contextOf(config, prepared),
    prepared.plan.paths,
    runDirs.map((d) => path.resolve(d)),
    { outputRoot: path.resolve(baseDirectory, options.output ?? config.output ?? 'atlas-runs') }
  );
}
