import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { BusinessEventResult, CloudEvent } from '../events/cloudevents';
import type { ChartGraph } from '../graph';
import type { ChartScope, PlannedJourney, PlannedPath, PlannedStep } from '../plan';
import type { Composition } from '../spec/compose';
import type { SpecBundle, StateMeta } from '../spec/types';
import type {
  CheckResult,
  Clip,
  Driver,
  EventMatcher,
  Focus,
  EventSource,
  Image,
  Implementation,
  PrivacyRules,
  RecognizerResult,
  RunMode,
  Status,
  StepTools,
  TimelineEntry
} from './types';
import { compareBusinessEvents, correlated } from '../events/cloudevents';
import { mergePrivacy, privacyFindings } from '../privacy';
import { toCtrf, toJUnit, toMermaid, toWebVtt } from '../report/formats';
import { splitTransitionId, transitionId, walkStates } from '../spec/types';
import { Timeline } from './types';

/** A seed as the plan sees it: where it starts, and whether it can run yet. */
export type PlannedSeed = { name: string; active: string[]; blocked?: string };

/** One shard of a run split across machines: `index` is 1-based. */
export type Shard = { index: number; count: number };

/** What a run reports about: the spec, the scope, and the implementation's metadata. */
export type RunContext<C> = {
  bundle: SpecBundle;
  composition: Composition;
  graph: ChartGraph;
  scope: ChartScope;
  implementation: Implementation<C>;
  /** The journeys of the plan, as the paths they are cut into; journeys are reported from them. */
  journeys?: PlannedJourney[];
  seeds?: PlannedSeed[];
  eventMatchers?: Record<string, EventMatcher>;
  privacy?: PrivacyRules;
  /** Recorded in the manifest as the run's environment. */
  environment?: Record<string, unknown>;
};

export type RunOptions<C> = RunContext<C> & {
  paths: PlannedPath[];
  driver: Driver<C>;
  mode: RunMode;
  /** Runs land in `<outputRoot>/<run-id>/`. */
  outputRoot: string;
  retry?: boolean;
  stepTimeoutMs?: number;
  eventSources?: EventSource[];
  /** Path attempts that run at once, capped by the driver's `concurrency`; 1 when omitted. */
  workers?: number;
  /** Reported in the manifest when the paths are one shard of a larger run. */
  shard?: Shard;
  /** Passed outcomes of an earlier run to keep instead of running those paths again. */
  reuse?: { runDir: string; outcomes: Record<string, PathOutcome> };
  log?: (line: string) => void;
};

type StepResult = { transition: string; event: string; status: Status; reason: string | null };

type Attempt = { status: 'passed' | 'failed'; error: string | null; stoppedAt: string | null; trace: string | null; traces?: Record<string, string> };

type Observed = {
  step: PlannedStep;
  target: string;
  clip: (Clip & { captions?: string }) | null;
  timeline: TimelineEntry[];
  events: BusinessEventResult;
  recognizer: RecognizerResult;
  shot: Image | null;
  transient: boolean;
  checks: CheckResult[];
};

/**
 * Everything one path's run produced, with media paths relative to the run directory. A run's
 * manifest is a pure function of its plan and these outcomes, folded in plan order, so outcomes
 * from parallel workers, shards and earlier runs compose into the same report.
 */
export type PathOutcome = {
  id: string;
  key: string;
  status: Status;
  attempts: Attempt[];
  steps: StepResult[];
  stoppedAt: string | null;
  observed: Observed[];
  failure: { state: string; recognizer: RecognizerResult | null; looksLike: string[]; shot: Image | null } | null;
  leaks: string[];
  durationMs: number;
  /** How long the last attempt took to seed (or set up) and recognise its start. */
  setupMs?: number;
  /** The run the outcome was taken from, when it was reused rather than run again. */
  reusedFrom?: string;
};

type StateRecord = {
  status: Status;
  screenshot: Image | null;
  screenshotsByPath: Record<string, Image>;
  recognizer: RecognizerResult | null;
  looksLike: string[];
  businessEvents: BusinessEventResult | null;
  checks: CheckResult[];
  reachedBy: string[];
  notes: string[];
};

type TransitionRecord = {
  status: Status;
  clip: (Clip & { captions?: string }) | null;
  timeline: TimelineEntry[];
  reason: string | null;
  reachedBy: string[];
};

type StepFailure = Error & { recognizer?: RecognizerResult; looksLike?: string[]; state?: string; stepIndex?: number };

function git(command: string) {
  try {
    return execSync(`git ${command}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function specVersion(bundle: SpecBundle) {
  const hash = createHash('sha256');
  for (const chart of bundle.charts) hash.update(readFileSync(path.join(bundle.directory, chart.file)));
  hash.update(JSON.stringify(bundle.journeys));
  return hash.digest('hex').slice(0, 12);
}

const relative = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/');
const pad = (n: number) => String(n).padStart(2, '0');
const sameStates = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** A rough cost of a path before it has ever run: setting it up, then each step. */
export const estimateMs = (p: PlannedPath) => 5_000 + 2_500 * p.steps.length;

/**
 * The paths one shard runs: longest first onto the least loaded shard, by the plan alone, so
 * every machine computes the same split. Paths reported without running go to the first shard.
 */
export function shardPaths(paths: PlannedPath[], shard: Shard) {
  if (shard.count < 1 || shard.index < 1 || shard.index > shard.count) throw new Error(`There is no shard ${shard.index}/${shard.count}`);
  const load = Array.from({ length: shard.count }, () => 0);
  const owner = new Map<string, number>();
  const running = paths.filter((p) => !p.skipRun).sort((a, b) => estimateMs(b) - estimateMs(a) || paths.indexOf(a) - paths.indexOf(b));
  for (const p of running) {
    const lightest = load.indexOf(Math.min(...load));
    owner.set(p.key, lightest + 1);
    load[lightest]! += estimateMs(p);
  }
  return paths.filter((p) => (p.skipRun ? shard.index === 1 : owner.get(p.key) === shard.index));
}

/** Media files an outcome refers to, relative to its run directory. */
function mediaOf(outcome: PathOutcome) {
  const files: string[] = [];
  const image = (i: Image | null | undefined) => {
    if (!i) return;
    files.push(i.png, ...(i.webp ? [i.webp] : []));
    for (const a of i.also ?? []) image(a);
  };
  for (const o of outcome.observed) {
    image(o.shot);
    if (o.clip) files.push(o.clip.video, ...(o.clip.poster ? [o.clip.poster] : []), ...(o.clip.captions ? [o.clip.captions] : []));
  }
  image(outcome.failure?.shot);
  for (const a of outcome.attempts) files.push(...(a.trace ? [a.trace] : []), ...Object.values(a.traces ?? {}));
  return files;
}

function copyMedia(outcome: PathOutcome, from: string, to: string) {
  for (const file of mediaOf(outcome)) {
    const source = path.join(from, file);
    if (!existsSync(source)) continue;
    mkdirSync(path.dirname(path.join(to, file)), { recursive: true });
    cpSync(source, path.join(to, file));
  }
}

/** The plan keys and outcomes a run wrote, for merging shards and reusing passed paths. */
export function readOutcomes(runDir: string): { runId: string; outcomes: Record<string, PathOutcome> } | null {
  const file = path.join(runDir, 'outcomes.json');
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { runId: string; outcomes: Record<string, PathOutcome> };
    return { runId: parsed.runId, outcomes: parsed.outcomes ?? {} };
  } catch {
    return null;
  }
}

/** How long each path took in the newest run under `outputRoot` that recorded it, by path key. */
export function durationHistory(outputRoot: string) {
  const history: Record<string, number> = {};
  if (!existsSync(outputRoot)) return history;
  const runs = readdirSync(outputRoot)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .reverse()
    .slice(0, 10);
  for (const run of runs) {
    for (const [key, outcome] of Object.entries(readOutcomes(path.join(outputRoot, run))?.outcomes ?? {})) {
      if (!(key in history) && !outcome.reusedFrom) history[key] = outcome.durationMs;
    }
  }
  return history;
}

/** The newest run under `outputRoot` that wrote outcomes. */
export function latestRun(outputRoot: string) {
  if (!existsSync(outputRoot)) return null;
  const runs = readdirSync(outputRoot)
    .filter((name) => !name.startsWith('.') && existsSync(path.join(outputRoot, name, 'outcomes.json')))
    .sort();
  return runs.length ? path.join(outputRoot, runs.at(-1)!) : null;
}

/**
 * Fold path outcomes into the run's report, in plan order: the same plan and outcomes always give
 * the same manifest, however many workers ran them, in whatever order they finished.
 */
export function buildManifest<C>(
  context: RunContext<C>,
  paths: PlannedPath[],
  outcomes: Map<string, PathOutcome>,
  run: { id: string; startedAt: Date; finished: boolean; mode: RunMode; driver: { name: string; clients?: Record<string, string> }; activePaths?: string[]; extra?: Record<string, unknown> }
) {
  const { implementation: impl, graph, scope } = context;
  const metaOf = new Map<string, StateMeta>();
  for (const chart of context.bundle.charts) for (const { name, node } of walkStates(chart.machine)) if (node.meta) metaOf.set(name, node.meta);
  for (const { name, node } of walkStates(context.composition.machine)) if (node.meta && !metaOf.has(name)) metaOf.set(name, node.meta);

  const states: Record<string, StateRecord> = Object.fromEntries(
    [...scope.states].map((name) => [
      name,
      { status: 'not-reached', screenshot: null, screenshotsByPath: {}, recognizer: null, looksLike: [], businessEvents: null, checks: [], reachedBy: [], notes: [] }
    ])
  );
  const transitions: Record<string, TransitionRecord> = Object.fromEntries(
    [...scope.transitions].map((id) => [id, { status: 'not-reached', clip: null, timeline: [], reason: 'No path reached it.', reachedBy: [] }])
  );
  const leaks: string[] = [];
  const results: Record<string, unknown>[] = [];
  const resultStatus = new Map<string, Status>();
  const reachedConfigs = new Map<string, string[][]>();

  for (const planned of paths) {
    const pathFields = {
      id: planned.id,
      key: planned.key,
      name: planned.name,
      kind: planned.kind,
      description: planned.description,
      start: planned.start,
      ...(planned.seed ? { seed: planned.seed } : {}),
      ...(planned.journeys ? { journeys: planned.journeys } : {})
    };
    if (planned.skipRun) {
      const firstBlocked = planned.steps.findIndex((s) => !impl.events[s.event] || impl.events[s.event]!.blocked);
      const steps: StepResult[] = planned.steps.map((s, i) => ({
        transition: s.transitions[0] ?? s.event,
        event: s.event,
        status: 'not-reached',
        reason:
          firstBlocked < 0
            ? `Not run: ${planned.blockedBy.join('; ')}`
            : i < firstBlocked
              ? 'Run on another path.'
              : i === firstBlocked
                ? `Blocked: ${impl.events[s.event]?.blocked ?? `No implementation for "${s.event}".`}`
                : `Not reached: the path is blocked at "${planned.steps[firstBlocked]?.event}".`
      }));
      for (const s of steps.slice(Math.max(0, firstBlocked))) {
        const tr = transitions[s.transition];
        if (tr && tr.status === 'not-reached') tr.reason = s.reason;
      }
      results.push({ ...pathFields, progress: 'complete', status: 'not-reached', attempts: [], steps, stoppedAt: null });
      resultStatus.set(planned.id, 'not-reached');
      continue;
    }
    const outcome = outcomes.get(planned.key);
    if (!outcome) {
      results.push({ ...pathFields, progress: run.finished ? 'complete' : run.activePaths?.includes(planned.id) ? 'running' : 'queued', status: 'not-reached', attempts: [], steps: [], stoppedAt: null });
      continue;
    }
    const flaky = outcome.status === 'flaky';
    leaks.push(...outcome.leaks);
    if (outcome.failure && states[outcome.failure.state]) {
      const record = states[outcome.failure.state]!;
      record.recognizer = outcome.failure.recognizer;
      record.looksLike = outcome.failure.looksLike;
      if (outcome.failure.shot) record.screenshotsByPath[`${planned.id} (failed)`] = outcome.failure.shot;
    }
    for (const item of outcome.observed) {
      if (item.step.to.length) reachedConfigs.set(planned.id, [...(reachedConfigs.get(planned.id) ?? []), item.step.to]);
      const record = states[item.target];
      if (record) {
        if (!record.reachedBy.includes(planned.id)) record.reachedBy.push(planned.id);
        if (record.status !== 'failed') record.status = flaky ? 'flaky' : 'passed';
        if (item.shot) {
          record.screenshotsByPath[planned.id] = item.shot;
          if (!record.screenshot) record.screenshot = item.shot;
        }
        if (item.transient) record.notes.push('Shown too briefly to capture; not seeing it is not a failure.');
        record.recognizer = item.recognizer;
        for (const check of item.checks) if (!record.checks.some((c) => c.check === check.check && c.passed === check.passed)) record.checks.push(check);
        if (item.checks.some((c) => !c.passed)) record.status = 'failed';
        if (item.events.expected.length) record.businessEvents = item.events;
      }
      for (let parent = graph.parent(item.target); parent; parent = graph.parent(parent)) {
        const ancestor = states[parent];
        if (!ancestor) continue;
        if (!ancestor.reachedBy.includes(planned.id)) ancestor.reachedBy.push(planned.id);
        if (ancestor.status === 'not-reached') ancestor.status = flaky ? 'flaky' : 'passed';
      }
      for (const t of item.step.transitions) {
        const tr = transitions[t];
        if (!tr) continue;
        if (!tr.reachedBy.includes(planned.id)) tr.reachedBy.push(planned.id);
        if (tr.status !== 'failed') tr.status = flaky ? 'flaky' : 'passed';
        tr.reason = null;
        if (item.clip && (!tr.clip || planned.kind === 'journey')) {
          tr.clip = item.clip;
          tr.timeline = item.timeline;
        } else if (!tr.timeline.length) {
          tr.timeline = item.timeline;
        }
      }
    }
    for (const s of outcome.steps) {
      const tr = transitions[s.transition];
      if (!tr) continue;
      if (s.status === 'failed') {
        tr.status = 'failed';
        tr.reason = s.reason;
        if (!tr.reachedBy.includes(planned.id)) tr.reachedBy.push(planned.id);
        const { source, event } = splitTransitionId(s.transition);
        const target = graph.target(source, event);
        if (target && states[target]) states[target]!.status = 'failed';
      } else if (s.status === 'not-reached' && tr.status === 'not-reached') {
        tr.reason = s.reason;
      }
    }
    if (outcome.status === 'failed' && outcome.stoppedAt && states[outcome.stoppedAt]) states[outcome.stoppedAt]!.status = 'failed';
    results.push({
      ...pathFields,
      progress: run.activePaths?.includes(planned.id) ? 'running' : 'complete',
      status: outcome.status,
      attempts: outcome.attempts,
      steps: outcome.steps,
      stoppedAt: outcome.stoppedAt,
      durationMs: outcome.durationMs,
      ...(outcome.setupMs !== undefined ? { setupMs: outcome.setupMs } : {}),
      ...(outcome.reusedFrom ? { reusedFrom: outcome.reusedFrom } : {})
    });
    resultStatus.set(planned.id, outcome.status);
  }

  const journeys = (context.journeys ?? []).map((j) => {
    const statuses = j.paths.map((id) => resultStatus.get(id));
    const status: Status | 'not-run' = statuses.some((s) => s === 'failed')
      ? 'failed'
      : statuses.some((s) => s === undefined)
        ? statuses.every((s) => s === undefined)
          ? 'not-run'
          : 'not-reached'
        : statuses.every((s) => s === 'passed')
          ? 'passed'
          : statuses.every((s) => s === 'passed' || s === 'flaky')
            ? 'flaky'
            : 'not-reached';
    return { name: j.name, description: j.description, status, paths: j.paths, stoppedAt: j.paths.find((id) => resultStatus.get(id) !== 'passed' && resultStatus.get(id) !== 'flaky') ?? null };
  });

  const seeds = (context.seeds ?? []).map((s) => {
    const started = paths.filter((p) => p.seed === s.name).map((p) => p.id);
    const verifiedBy = [...reachedConfigs.entries()]
      .filter(([id, configs]) => ['passed', 'flaky'].includes(resultStatus.get(id) ?? '') && configs.some((c) => sameStates(c, s.active)))
      .map(([id]) => id);
    const seed = impl.seeds?.[s.name];
    return {
      name: s.name,
      at: s.active.filter((n) => graph.isLeaf(n)),
      how: seed?.how ?? null,
      ...(seed?.shows ? { shows: seed.shows } : {}),
      ...(seed?.for ? { for: seed.for } : {}),
      ...(s.blocked ? { blocked: s.blocked } : {}),
      paths: started,
      verifiedBy
    };
  });

  const count = (records: { status: Status }[]) => ({
    total: records.length,
    passed: records.filter((r) => r.status === 'passed').length,
    failed: records.filter((r) => r.status === 'failed').length,
    flaky: records.filter((r) => r.status === 'flaky').length,
    notReached: records.filter((r) => r.status === 'not-reached').length
  });
  const kindOf = (event: string) => impl.events[event]?.kind ?? (context.composition.handOffs.some((h) => h.event === event) ? 'hand-off' : 'user');
  const allStates = walkStates(context.composition.machine);
  const privacy = mergePrivacy(context.privacy);
  const uniqueLeaks = [...new Set(leaks)];

  const draft = {
    $schema: 'https://github.com/crvouga/atlas/schemas/manifest.schema.json',
    schemaVersion: 1,
    run: {
      id: run.id,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finished ? new Date().toISOString() : null,
      progress: {
        totalPaths: paths.length,
        completedPaths: paths.filter((p) => p.skipRun || (outcomes.has(p.key) && !run.activePaths?.includes(p.id))).length,
        activePaths: run.activePaths ?? [],
        updatedAt: new Date().toISOString()
      },
      durationMs: Date.now() - run.startedAt.getTime(),
      commit: git('rev-parse HEAD'),
      branch: git('rev-parse --abbrev-ref HEAD'),
      environment: { driver: run.driver.name, ...(run.driver.clients ? { clients: run.driver.clients } : {}), ...context.environment },
      mode: run.mode,
      specVersion: specVersion(context.bundle),
      specDirectory: relative(process.cwd(), context.bundle.directory),
      approvals: [] as unknown[],
      scope: { chart: scope.chart, start: scope.startLabel, ...(scope.state ? { state: scope.state } : {}) },
      ...run.extra
    },
    charts: context.bundle.charts.map((c) => {
      const host = context.composition.hosts.get(c.machine.id) ?? null;
      return {
        id: c.machine.id,
        file: c.file,
        description: typeof c.machine.meta?.description === 'string' ? c.machine.meta.description : '',
        parentState: host,
        handOffs: Object.fromEntries(context.composition.handOffs.filter((h) => h.childChart === c.machine.id).map((h) => [h.finalState, h.event]))
      };
    }),
    map: {
      nodes: allStates.map(({ name, node, trail }) => ({
        id: name,
        parent: trail.at(-1) ?? null,
        chart: context.composition.chartOf.get(name) ?? context.bundle.root,
        type: node.type ?? (node.states ? 'compound' : 'atomic'),
        initial: node.initial ?? null,
        inScope: scope.states.has(name)
      })),
      edges: allStates.flatMap(({ name, node }) =>
        Object.keys(node.on ?? {}).map((event) => ({
          id: transitionId(name, event),
          source: name,
          target: graph.target(name, event) ?? '',
          event,
          kind: kindOf(event),
          inScope: scope.transitions.has(transitionId(name, event))
        }))
      )
    },
    states: Object.fromEntries(
      Object.entries(states).map(([name, record]) => {
        const meta = metaOf.get(name);
        const seededBy = seeds.filter((s) => s.at.includes(name)).map((s) => s.name);
        return [
          name,
          {
            name,
            chart: context.composition.chartOf.get(name) ?? null,
            description: meta?.description ?? '',
            snapshot: meta?.snapshot ?? '',
            ...(impl.states[name]?.client ? { client: impl.states[name]!.client } : {}),
            ...(seededBy.length ? { seeds: seededBy } : {}),
            confidence: meta?.confidence ?? 'assumed',
            source: meta?.source ?? [],
            expectedEvents: meta?.events ?? [],
            ...record
          }
        ];
      })
    ),
    transitions: Object.fromEntries(
      Object.entries(transitions).map(([id, record]) => {
        const { source, event } = splitTransitionId(id);
        const client = impl.events[event]?.client;
        return [id, { id, source, target: graph.target(source, event) ?? null, event, kind: kindOf(event), how: impl.events[event]?.how ?? null, ...(client ? { client } : {}), ...record }];
      })
    ),
    paths: results as {
      id: string;
      key: string;
      name: string;
      kind: PlannedPath['kind'];
      status: Status;
      attempts: Attempt[];
      steps: StepResult[];
      stoppedAt: string | null;
      seed?: string;
      durationMs?: number;
      setupMs?: number;
      reusedFrom?: string;
    }[],
    journeys,
    seeds,
    coverage: {
      [scope.chart]: { states: count(Object.values(states)), transitions: count(Object.values(transitions)) },
      overall: { states: count(Object.values(states)), transitions: count(Object.values(transitions)) }
    },
    privacy: { findings: uniqueLeaks, passed: uniqueLeaks.length === 0 },
    reports: { junit: 'junit.xml', ctrf: 'ctrf.json', mermaid: 'chart.mmd' }
  };
  const found = privacyFindings(JSON.stringify(draft), 'manifest.json', privacy);
  return found.length ? { ...draft, privacy: { findings: [...draft.privacy.findings, ...found], passed: false } } : draft;
}

export type Manifest = ReturnType<typeof buildManifest>;

function writeAtomic(file: string, text: string) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
  writeFileSync(temporary, text);
  renameSync(temporary, file);
}

/** Write a run's manifest, reports and outcomes; returns the manifest. */
export function writeRun<C>(
  runDir: string,
  context: RunContext<C>,
  paths: PlannedPath[],
  outcomes: Map<string, PathOutcome>,
  run: Parameters<typeof buildManifest>[3]
) {
  const manifest = buildManifest(context, paths, outcomes, run);
  writeAtomic(path.join(runDir, 'junit.xml'), toJUnit(manifest));
  writeAtomic(path.join(runDir, 'ctrf.json'), `${JSON.stringify(toCtrf(manifest), null, 2)}\n`);
  writeAtomic(path.join(runDir, 'chart.mmd'), toMermaid(context.composition.machine));
  const ordered = Object.fromEntries(paths.flatMap((p) => (outcomes.has(p.key) && !run.activePaths?.includes(p.id) ? [[p.key, outcomes.get(p.key)!]] : [])));
  writeAtomic(path.join(runDir, 'outcomes.json'), `${JSON.stringify({ runId: run.id, plan: paths.map((p) => p.key), outcomes: ordered })}\n`);
  writeAtomic(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const newRunId = (mode: RunMode) => `${new Date().toISOString().replace(/[:.]/g, '-')}-${mode}`;

/**
 * Compose the outcomes of several runs of the same plan (the shards of one run, or a rerun of the
 * paths that failed) into one run, folded in plan order. Media are copied in, so the merged run
 * stands on its own. Later runs win when two ran the same path.
 */
export function mergeRuns<C>(
  context: RunContext<C>,
  paths: PlannedPath[],
  runDirs: string[],
  options: { outputRoot: string; mode?: RunMode; driver?: { name: string; clients?: Record<string, string> } }
) {
  const outcomes = new Map<string, PathOutcome>();
  const keys = new Set(paths.map((p) => p.key));
  const sources: string[] = [];
  let mode: RunMode = options.mode ?? 'fast';
  let driver = options.driver ?? { name: 'merged' };
  for (const dir of runDirs) {
    const read = readOutcomes(dir);
    if (!read) throw new Error(`${dir} has no outcomes.json to merge`);
    sources.push(read.runId);
    try {
      const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { run?: { mode?: RunMode; environment?: { driver?: string } } };
      if (manifest.run?.mode) mode = options.mode ?? manifest.run.mode;
      if (manifest.run?.environment?.driver && !options.driver) driver = { name: manifest.run.environment.driver };
    } catch {
      /* the outcomes are enough */
    }
    for (const [key, outcome] of Object.entries(read.outcomes)) if (keys.has(key)) outcomes.set(key, { ...outcome, reusedFrom: outcome.reusedFrom ?? read.runId });
  }
  const id = `${newRunId(mode).replace(/-(fast|showcase)$/, '')}-merged-${mode}`;
  const runDir = path.join(options.outputRoot, id);
  mkdirSync(runDir, { recursive: true });
  for (const dir of runDirs) {
    const read = readOutcomes(dir)!;
    for (const [key, outcome] of Object.entries(read.outcomes)) if (outcomes.get(key)?.reusedFrom === (outcome.reusedFrom ?? read.runId)) copyMedia(outcome, dir, runDir);
  }
  const manifest = writeRun(runDir, context, paths, outcomes, { id, startedAt: new Date(), finished: true, mode, driver, extra: { mergedFrom: sources } });
  return { runDir, manifest, ok: manifest.privacy.passed && manifest.paths.every((r) => r.status !== 'failed') };
}

/**
 * Run planned paths against a system through a driver. Paths start from their seed (or the
 * implementation's `setup`) and run on a pool of workers, longest first, each attempt in its own
 * driver context; every state is recognised from the outside after every step; a failed path is
 * retried once to tell flaky from broken. The manifest is rewritten as each path finishes, from
 * all outcomes so far in plan order, so a crash keeps what ran and the order paths finished in
 * never changes the report.
 */
export async function runPaths<C>(options: RunOptions<C>) {
  const { driver, implementation: impl, graph, scope } = options;
  const runId = newRunId(options.mode);
  const runDir = path.join(options.outputRoot, runId);
  const mediaDir = path.join(runDir, 'media');
  mkdirSync(mediaDir, { recursive: true });
  const startedAt = new Date();
  const showcase = options.mode === 'showcase';
  const timeoutMs = options.stepTimeoutMs ?? 45_000;
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const privacy = mergePrivacy(options.privacy);
  const sources = options.eventSources ?? [];
  const hasCloudEvents = sources.some((s) => !s.name.startsWith('log:'));
  const metaOf = new Map<string, StateMeta>();
  for (const chart of options.bundle.charts) for (const { name, node } of walkStates(chart.machine)) if (node.meta) metaOf.set(name, node.meta);
  for (const { name, node } of walkStates(options.composition.machine)) if (node.meta && !metaOf.has(name)) metaOf.set(name, node.meta);

  const toRun = options.paths.filter((p) => !p.skipRun);
  const workers = Math.max(1, Math.min(options.workers ?? 1, driver.concurrency ?? 1, toRun.length || 1));
  const sideBySide = workers > 1;
  const outcomes = new Map<string, PathOutcome>();
  const activeOutcomes = new Map<string, PathOutcome>();
  const activePaths = new Set<string>();

  const reused = new Set<string>();
  for (const p of toRun) {
    const previous = options.reuse?.outcomes[p.key];
    if (!previous || previous.status !== 'passed') continue;
    copyMedia(previous, options.reuse!.runDir, runDir);
    outcomes.set(p.key, { ...previous, id: p.id, reusedFrom: previous.reusedFrom ?? path.basename(options.reuse!.runDir) });
    reused.add(p.key);
  }

  /** The state a path must show before its first step: what its seed says it shows, or the last active leaf. */
  const startStateOf = (planned: PlannedPath) => {
    const seed = planned.seed ? impl.seeds?.[planned.seed] : undefined;
    const recognizable = planned.start.filter((n) => graph.isLeaf(n) && impl.states[n]);
    if (seed?.shows) return seed.shows;
    if (typeof seed?.at === 'string') {
      const at = seed.at;
      if (graph.isLeaf(at)) return at;
      const within = recognizable.filter((n) => {
        for (let p = graph.parent(n); p; p = graph.parent(p)) if (p === at) return true;
        return false;
      });
      if (within.length) return within.at(-1)!;
    }
    return recognizable.at(-1) ?? planned.steps[0]?.from.at(-1) ?? '';
  };

  const leafTarget = (step: PlannedStep) => {
    const first = step.transitions[0];
    const target = first ? graph.target(splitTransitionId(first).source, step.event) : undefined;
    if (target && graph.isLeaf(target)) return target;
    return step.to.filter((n) => graph.isLeaf(n) && scope.states.has(n) && impl.states[n]).at(-1) ?? target ?? step.to.at(-1)!;
  };

  const recognizeNow = async (ctx: C, state: string): Promise<RecognizerResult> =>
    impl.states[state] ? impl.states[state]!.recognize(ctx) : { matched: false, signals: [] };

  const waitFor = async (ctx: C, state: string) => {
    const s = impl.states[state];
    const deadline = Date.now() + timeoutMs;
    let nextLook = Date.now() + 10_000;
    let pause = 25;
    let last = await recognizeNow(ctx, state);
    while (!last.matched && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pause));
      pause = Math.min(pause * 2, 250);
      if (s?.lookIn && Date.now() > nextLook) {
        await s.lookIn(ctx).catch(() => undefined);
        nextLook = Date.now() + 10_000;
      }
      last = await recognizeNow(ctx, state);
    }
    return last;
  };

  const looksLike = async (ctx: C, except: string) => {
    const names = Object.keys(impl.states).filter((name) => name !== except && impl.states[name]?.sameAs !== except && impl.states[except]?.sameAs !== name);
    const seen = await Promise.all(names.map((name) => recognizeNow(ctx, name).then((r) => r.matched, () => false)));
    return names.filter((_, i) => seen[i]);
  };

  const collectEvents = async (ctx: C, marks: unknown[], expected: string[]) => {
    if (!expected.length) return compareBusinessEvents([], { events: [], text: '' }, {}, hasCloudEvents);
    if (sideBySide && !impl.correlate) return { expected, observed: [], missing: [], noSignal: expected, events: [] };
    const all = await Promise.all(sources.map((s, i) => s.collect(marks[i])));
    const collected = { events: all.flatMap((a) => a.events) as CloudEvent[], text: all.map((a) => a.text ?? '').join('\n') };
    const mine = impl.correlate ? correlated(collected, await impl.correlate(ctx)) : collected;
    return compareBusinessEvents(expected, mine, options.eventMatchers ?? {}, hasCloudEvents);
  };

  const rel = (image: Image): Image => ({
    png: relative(runDir, image.png),
    ...(image.webp ? { webp: relative(runDir, image.webp) } : {}),
    ...(image.client ? { client: image.client } : {}),
    ...(image.also?.length ? { also: image.also.map(rel) } : {})
  });

  async function attempt(planned: PlannedPath, attemptNumber: number) {
    const tag = `${planned.id}${attemptNumber > 1 ? '-retry' : ''}`;
    const timeline = new Timeline();
    const ctx = await driver.open({ path: planned, attempt: attemptNumber, mode: options.mode, directory: path.join(runDir, '.work', tag), timeline });
    const pacing = showcase ? (driver.pacing ?? { before: 500, after: 1_000 }) : { before: 0, after: 0 };
    let focus: Focus = {};
    const tools: StepTools = {
      timeline,
      mode: options.mode,
      data: {},
      hold: async (ms) => {
        if (ms <= 0) return;
        if (driver.hold) await driver.hold(ctx, ms, focus);
        else await new Promise((r) => setTimeout(r, ms));
      }
    };
    const on = (client: string | undefined): Focus => (client ? { client } : {});
    const steps: StepResult[] = [];
    const observed: Observed[] = [];
    const leaks: string[] = [];
    let failure: PathOutcome['failure'] = null;
    let error: string | null = null;
    let stoppedAt: string | null = null;
    let failed = false;
    const attemptStarted = Date.now();
    let setupMs: number | undefined;
    const publishAttempt = () => {
      activeOutcomes.set(planned.key, {
        id: planned.id,
        key: planned.key,
        status: error ? 'failed' : 'not-reached',
        attempts: [],
        steps,
        stoppedAt,
        observed,
        failure,
        leaks,
        durationMs: Date.now() - attemptStarted,
        setupMs
      });
      publish();
    };
    const shotFile = (name: string) => path.join(mediaDir, 'paths', tag, `${name}.png`);
    const clipFile = (index: number) => path.join(mediaDir, 'clips', tag, `${pad(index + 1)}.mp4`);
    const shoot = async (name: string, at: Focus) => {
      const image = driver.screenshot ? await driver.screenshot(ctx, shotFile(name), at).catch(() => null) : null;
      return image ? rel(image) : null;
    };
    try {
      for (const event of new Set(planned.steps.map((s) => s.event))) await impl.events[event]?.prepare?.(ctx, tools);
      if (planned.seed) {
        const seed = impl.seeds?.[planned.seed];
        if (!seed) throw new Error(`There is no seed "${planned.seed}"`);
        await seed.run(ctx, { path: planned, tools });
      } else if (impl.setup) {
        await impl.setup(ctx, { path: planned, tools });
      } else {
        throw new Error('The path starts without a seed and the implementation has no setup');
      }
      const startState = startStateOf(planned);
      const startTransient = impl.states[startState]?.transient === true;
      const startCheck = startTransient ? await recognizeNow(ctx, startState) : await waitFor(ctx, startState);
      if (!startCheck.matched && !startTransient) {
        stoppedAt = startState;
        const like = await looksLike(ctx, startState);
        const by = planned.seed ? `the seed "${planned.seed}" did not show` : 'expected';
        throw Object.assign(new Error(`The path could not start: ${by} "${startState}", the app looks like ${like.join(', ') || 'none of the known states'}`), {
          recognizer: startCheck,
          looksLike: like,
          state: startState,
          stepIndex: 0
        });
      }
      setupMs = Date.now() - attemptStarted;
      observed.push({
        step: { event: '(start)', transitions: [], handOff: false, from: [], to: [] },
        target: startState,
        clip: null,
        timeline: [],
        events: { expected: [], observed: [], missing: [], noSignal: [], events: [] },
        recognizer: startCheck,
        shot: await shoot('00-start', on(impl.states[startState]?.client)),
        transient: false,
        checks: (await impl.states[startState]?.checks?.(ctx)) ?? []
      });
      if (driver.text) leaks.push(...privacyFindings(await driver.text(ctx).catch(() => ''), `${planned.id} / ${startState}`, privacy));
      publishAttempt();

      for (const [index, step] of planned.steps.entries()) {
        const ev = impl.events[step.event];
        const target = leafTarget(step);
        const transition = step.transitions[0] ?? transitionId('?', step.event);
        if (!ev || ev.blocked) {
          const reason = ev?.blocked ?? `No implementation for "${step.event}".`;
          stoppedAt = step.from.filter((n) => scope.states.has(n)).at(-1) ?? null;
          for (const rest of planned.steps.slice(index)) {
            steps.push({
              transition: rest.transitions[0] ?? rest.event,
              event: rest.event,
              status: 'not-reached',
              reason: rest === step ? `Blocked: ${reason}` : `Not reached: the path stopped before it (blocked "${step.event}").`
            });
          }
          break;
        }
        focus = on(ev.client ?? impl.states[target]?.client);
        const recording = showcase && !step.handOff && driver.record ? await driver.record(ctx, path.join(runDir, '.frames', tag, String(index)), focus) : null;
        timeline.restart();
        await tools.hold(pacing.before);
        const marks = await Promise.all(sources.map((s) => s.mark()));
        try {
          await ev.run(ctx, tools);
        } catch (e) {
          await recording?.stop(clipFile(index)).catch(() => null);
          const like = await looksLike(ctx, '');
          const first = (e instanceof Error ? e.message : String(e)).split('\n')[0];
          throw Object.assign(new Error(`"${step.event}" could not be done (${first}); the app looks like ${like.length ? like.map((x) => `"${x}"`).join(', ') : 'none of the known states'}`), {
            state: step.from.filter((n) => impl.states[n]).at(-1) ?? target,
            looksLike: like,
            stepIndex: index
          });
        }
        const s = impl.states[target];
        if (s?.lookIn && !(await recognizeNow(ctx, target)).matched) {
          // Looking is a courtesy: if the place to look cannot be opened, recognition decides.
          await s.lookIn(ctx).catch(() => undefined);
          timeline.add({ kind: 'note', label: 'Looks where this shows up' });
        }
        const recognizer = s?.transient ? await recognizeNow(ctx, target) : await waitFor(ctx, target);
        const transient = !recognizer.matched && s?.transient === true;
        if (!recognizer.matched && !transient) {
          const like = await looksLike(ctx, target);
          await recording?.stop(clipFile(index)).catch(() => null);
          throw Object.assign(new Error(`Expected "${target}", the app looks like ${like.length ? like.map((x) => `"${x}"`).join(', ') : 'none of the known states'}`), {
            recognizer,
            looksLike: like,
            state: target,
            stepIndex: index
          });
        }
        timeline.add({ kind: 'screen', label: `Now: ${target}` });
        const checks = transient ? [] : ((await s?.checks?.(ctx)) ?? []);
        await tools.hold(pacing.after);
        const recorded = recording ? await recording.stop(clipFile(index)) : null;
        let clip: Observed['clip'] = null;
        if (recorded) {
          const captions = recorded.video.replace(/\.mp4$/, '.vtt');
          writeFileSync(captions, toWebVtt([...timeline.entries], recorded.durationMs));
          clip = {
            video: relative(runDir, recorded.video),
            ...(recorded.poster ? { poster: relative(runDir, recorded.poster) } : {}),
            durationMs: recorded.durationMs,
            captions: relative(runDir, captions),
            ...(recorded.client ? { client: recorded.client } : {})
          };
        }
        const events = await collectEvents(ctx, marks, metaOf.get(target)?.events ?? []);
        if (driver.text) leaks.push(...privacyFindings(await driver.text(ctx).catch(() => ''), `${planned.id} / ${target}`, privacy));
        const shot = transient ? null : await shoot(pad(index + 1), on(s?.client));
        observed.push({ step, target, clip, timeline: [...timeline.entries], events, recognizer, shot, transient, checks });
        steps.push({ transition, event: step.event, status: 'passed', reason: null });
        publishAttempt();
        await s?.settle?.(ctx);
      }
    } catch (e) {
      failed = true;
      const err = e as StepFailure;
      error = err.message;
      stoppedAt = err.state ?? stoppedAt;
      const index = err.stepIndex ?? 0;
      const failedShot = await shoot(`failed-${pad(index + 1)}`, on(err.state ? impl.states[err.state]?.client : undefined));
      if (err.state) failure = { state: err.state, recognizer: err.recognizer ?? null, looksLike: err.looksLike ?? [], shot: failedShot };
      const failedStep = planned.steps[index];
      for (const rest of planned.steps.slice(steps.length)) {
        steps.push({
          transition: rest.transitions[0] ?? rest.event,
          event: rest.event,
          status: rest === failedStep ? 'failed' : 'not-reached',
          reason: rest === failedStep ? err.message : `Not reached: the path stopped at "${err.state ?? 'start'}".`
        });
      }
      publishAttempt();
    }
    const traceFile = path.join(mediaDir, 'traces', `${tag}.zip`);
    const closed = await driver.close(ctx, { failed, traceFile }).catch(() => undefined);
    const trace = closed && closed.trace ? relative(runDir, closed.trace) : null;
    const traces = closed && closed.traces ? Object.fromEntries(Object.entries(closed.traces).map(([client, file]) => [client, relative(runDir, file)])) : undefined;
    return { error, stoppedAt, steps, observed, trace, traces, failure, leaks, setupMs };
  }

  async function safeAttempt(planned: PlannedPath, attemptNumber: number) {
    try {
      return await attempt(planned, attemptNumber);
    } catch (e) {
      const message = `The path could not be set up: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`;
      return {
        error: message,
        stoppedAt: null,
        steps: planned.steps.map((s, i) => ({
          transition: s.transitions[0] ?? s.event,
          event: s.event,
          status: (i === 0 ? 'failed' : 'not-reached') as Status,
          reason: i === 0 ? message : 'Not reached: the path could not be set up.'
        })),
        observed: [] as Observed[],
        trace: null,
        traces: undefined,
        failure: null,
        leaks: [] as string[],
        setupMs: undefined as number | undefined
      };
    }
  }

  async function runPath(planned: PlannedPath): Promise<PathOutcome> {
    const started = Date.now();
    log(`▶ ${planned.id} ${planned.name}${planned.seed ? ` (from "${planned.seed}")` : ''}`);
    const attempts: Attempt[] = [];
    const record = (o: Awaited<ReturnType<typeof safeAttempt>>) =>
      attempts.push({ status: o.error ? 'failed' : 'passed', error: o.error, stoppedAt: o.stoppedAt, trace: o.trace, ...(o.traces ? { traces: o.traces } : {}) });
    let outcome = await safeAttempt(planned, 1);
    record(outcome);
    let flaky = false;
    if (outcome.error && options.retry !== false) {
      const second = await safeAttempt(planned, 2);
      record(second);
      flaky = !second.error;
      outcome = second;
    }
    const blocked = outcome.steps.some((s) => s.reason?.startsWith('Blocked:'));
    const status: Status = outcome.error ? 'failed' : flaky ? 'flaky' : blocked ? 'not-reached' : 'passed';
    log(`  ${planned.id} ${status}${outcome.error ? ` — ${outcome.error}` : ''}`);
    return {
      id: planned.id,
      key: planned.key,
      status,
      attempts,
      steps: outcome.steps,
      stoppedAt: outcome.stoppedAt,
      observed: outcome.observed,
      failure: outcome.failure,
      leaks: outcome.leaks,
      durationMs: Date.now() - started,
      ...(outcome.setupMs !== undefined ? { setupMs: outcome.setupMs } : {})
    };
  }

  const runInfo = (finished: boolean) => ({
    id: runId,
    startedAt,
    finished,
    mode: options.mode,
    driver: { name: driver.name, ...(driver.clients ? { clients: driver.clients } : {}) },
    activePaths: options.paths.filter((p) => activePaths.has(p.id)).map((p) => p.id),
    extra: {
      workers,
      ...(options.shard ? { shard: options.shard } : {}),
      ...(reused.size ? { reused: { from: path.basename(options.reuse!.runDir), paths: reused.size } } : {})
    }
  });

  function publish() {
    writeRun(runDir, options, options.paths, new Map([...outcomes, ...activeOutcomes]), runInfo(false));
  }

  const history = durationHistory(options.outputRoot);
  const cost = (p: PlannedPath) => history[p.key] ?? estimateMs(p);
  const queue = toRun.filter((p) => !reused.has(p.key)).sort((a, b) => cost(b) - cost(a) || options.paths.indexOf(a) - options.paths.indexOf(b));
  if (reused.size) log(`Reusing ${reused.size} passed path(s) from ${path.basename(options.reuse!.runDir)}`);
  log(`Running ${queue.length} path(s) on ${workers} worker(s)`);
  writeRun(runDir, options, options.paths, outcomes, runInfo(false));
  // A driver can throw outside any awaited call (a message for a context that just closed); it
  // belongs to one attempt, so it is logged and the run goes on instead of the process dying.
  const stray = (error: unknown) => log(`  (ignored an error thrown outside any step: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]})`);
  process.on('uncaughtException', stray);
  process.on('unhandledRejection', stray);
  try {
    await Promise.all(
      Array.from({ length: workers }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          activePaths.add(next.id);
          publish();
          outcomes.set(next.key, await runPath(next));
          activeOutcomes.delete(next.key);
          activePaths.delete(next.id);
          publish();
        }
      })
    );
  } finally {
    process.off('uncaughtException', stray);
    process.off('unhandledRejection', stray);
  }
  await driver.dispose?.();
  await Promise.all(sources.map((s) => s.close?.()));
  const manifest = writeRun(runDir, options, options.paths, outcomes, runInfo(true));
  return { runDir, manifest, ok: manifest.privacy.passed && manifest.paths.every((r) => r.status !== 'failed') };
}
