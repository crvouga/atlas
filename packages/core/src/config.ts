import path from 'node:path';

import type { StateValue } from './graph';
import type { Driver, EventMatcher, EventSource, Implementation, PrivacyRules, RunMode } from './run/types';
import { lintBundle } from './lint';
import { chartScope, planChart } from './plan';
import { assertAllowedTarget, mergePrivacy } from './privacy';
import { runPaths } from './run/execute';
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

/** Load, lint and plan a config without running anything. */
export function prepare<C>(config: AtlasConfig<C>, baseDirectory = process.cwd()) {
  const specs = path.resolve(baseDirectory, config.specs);
  const bundle = loadSpecDirectory(specs);
  const structure = lintBundle(bundle, { requiredMeta: config.requiredMeta });
  const scope = chartScope(bundle, structure.composition, structure.graph, {
    chart: config.chart,
    start: config.start,
    startLabel: config.startLabel,
    entryEvents: config.entryEvents,
    state: config.state
  });
  const impl = config.implementation;
  const implemented = new Set(Object.entries(impl.events).filter(([, e]) => !e.blocked).map(([k]) => k));
  const full = lintBundle(bundle, {
    requiredMeta: config.requiredMeta,
    scope: { states: scope.states, events: scope.events },
    implementations: { events: implemented, states: new Set(Object.keys(impl.states)) }
  });
  const isBlocked = (event: string) => !impl.events[event] || Boolean(impl.events[event]!.blocked);
  const plan = planChart(bundle, full.graph, scope, { isBlocked, canStart: impl.canStart });
  return { bundle, lint: full, scope, plan, specs };
}

export type RunCommandOptions = {
  mode?: RunMode;
  paths?: string[];
  retry?: boolean;
  output?: string;
  log?: (line: string) => void;
};

/** Run a config end to end and write its manifest and reports. */
export async function runConfig<C>(config: AtlasConfig<C>, options: RunCommandOptions = {}, baseDirectory = process.cwd()) {
  const prepared = prepare(config, baseDirectory);
  const structural = prepared.lint.findings.filter((f) => f.rule !== 'implemented');
  if (structural.length) {
    throw new Error(`The spec is not executable:\n${structural.map((f) => `  [${f.rule}] ${f.message}`).join('\n')}`);
  }
  assertAllowedTarget(config.targets ?? [], mergePrivacy(config.privacy));
  const driver = typeof config.driver === 'function' ? await config.driver() : config.driver;
  const paths = prepared.plan.paths.filter((p) => !options.paths || options.paths.includes(p.id));
  return runPaths({
    bundle: prepared.bundle,
    composition: prepared.lint.composition,
    graph: prepared.lint.graph,
    scope: prepared.scope,
    paths,
    driver,
    implementation: config.implementation,
    mode: options.mode ?? 'fast',
    outputRoot: path.resolve(baseDirectory, options.output ?? config.output ?? 'atlas-runs'),
    retry: options.retry,
    stepTimeoutMs: config.stepTimeoutMs,
    eventSources: config.eventSources ? await config.eventSources() : [],
    eventMatchers: config.eventMatchers,
    privacy: config.privacy,
    environment: config.environment,
    log: options.log
  });
}
