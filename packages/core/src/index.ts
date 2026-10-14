/**
 * @module Atlas core
 *
 * The public entry point of `@crvouga/atlas`: define a config (`defineConfig`), then load, lint, plan
 * and run executable statecharts against a real product through a driver, and write a manifest of the
 * results. This file only re-exports, grouped by stage: spec (types, load, SCXML, composition), graph,
 * lint, plan, run (drivers, implementations, execution), business events, privacy, report formats and
 * config. It does no work at import time. Browser-safe parts are also available from `./spec`.
 *
 * @see docs/statecharts.md
 */
export * from './spec/types';
export { parseChart, parseJourneys, loadSpecDirectory, bundleOf, childChartIds } from './spec/load';
export { scxmlToMachine, machineToScxml, scxmlToken, ATLAS_NS } from './spec/scxml';
export { composeCharts, type Composition, type HandOff } from './spec/compose';
export { ChartGraph, activeKeys, configKey, type Config, type StateValue } from './graph';
export { lintBundle, type LintFinding, type LintOptions } from './lint';
export {
  chartScope,
  pathKey,
  planChart,
  runnableSteps,
  type ChartScope,
  type PlannedJourney,
  type PlannedPath,
  type PlannedStep,
  type PlanOptions,
  type ScopeOptions,
  type SeedPoint
} from './plan';
export * from './run/types';
export {
  buildManifest,
  durationHistory,
  estimateMs,
  latestRun,
  mergeRuns,
  readOutcomes,
  runPaths,
  shardPaths,
  writeRun,
  type Manifest,
  type PathOutcome,
  type PlannedSeed,
  type RunContext,
  type RunOptions,
  type Shard
} from './run/execute';
export { combineDrivers, combineImplementations, mergeImplementations, onClient, type CombineDriversOptions, type ImplementationPart } from './run/clients';
export { recordFrames, type FrameRecorderOptions } from './run/frames';
export { httpDriver, httpClient, type HttpClient, type HttpDriverOptions, type HttpRequestOptions, type HttpResponse } from './run/http';
export { cloudEventsHttpSource, cloudEventsFromHttp, logFileSource, compareBusinessEvents, correlated, type CloudEvent, type BusinessEventResult } from './events/cloudevents';
export { DEFAULT_PRIVACY, mergePrivacy, privacyFindings, assertAllowedTarget } from './privacy';
export { toJUnit, toCtrf, toWebVtt, toMermaid } from './report/formats';
export { toMarkdown } from './report/markdown';
export { defineConfig, mergeConfigRuns, prepare, runConfig, type AtlasConfig, type PrepareOptions, type RunCommandOptions } from './config';
