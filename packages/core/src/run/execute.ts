import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { BusinessEventResult, CloudEvent } from '../events/cloudevents';
import type { ChartGraph } from '../graph';
import type { ChartScope, PlannedPath, PlannedStep } from '../plan';
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
import { compareBusinessEvents } from '../events/cloudevents';
import { mergePrivacy, privacyFindings } from '../privacy';
import { toCtrf, toJUnit, toMermaid, toWebVtt } from '../report/formats';
import { splitTransitionId, transitionId, walkStates } from '../spec/types';
import { Timeline } from './types';

export type RunOptions<C> = {
  bundle: SpecBundle;
  composition: Composition;
  graph: ChartGraph;
  scope: ChartScope;
  paths: PlannedPath[];
  driver: Driver<C>;
  implementation: Implementation<C>;
  mode: RunMode;
  /** Runs land in `<outputRoot>/<run-id>/`. */
  outputRoot: string;
  retry?: boolean;
  stepTimeoutMs?: number;
  eventSources?: EventSource[];
  eventMatchers?: Record<string, EventMatcher>;
  privacy?: PrivacyRules;
  /** Recorded in the manifest as the run's environment. */
  environment?: Record<string, unknown>;
  log?: (line: string) => void;
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

type StepResult = { transition: string; event: string; status: Status; reason: string | null };

type PathResult = {
  id: string;
  name: string;
  kind: PlannedPath['kind'];
  description: string;
  status: Status;
  attempts: { status: 'passed' | 'failed'; error: string | null; stoppedAt: string | null; trace: string | null; traces?: Record<string, string> }[];
  steps: StepResult[];
  stoppedAt: string | null;
};

type Observed = {
  step: PlannedStep;
  target: string;
  clip: Clip | null;
  timeline: TimelineEntry[];
  events: BusinessEventResult;
  recognizer: RecognizerResult;
  shot: Image | null;
  transient: boolean;
  checks: CheckResult[];
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

/**
 * Run planned paths against a system through a driver. Each attempt gets a fresh driver context;
 * every state is recognised from the outside after every step; a failed path is retried once to
 * tell flaky from broken. The manifest is written after every path, so a crash keeps what ran.
 */
export async function runPaths<C>(options: RunOptions<C>) {
  const { driver, implementation: impl, graph, scope } = options;
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${options.mode}`;
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
  const results: PathResult[] = [];

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
    let last = await recognizeNow(ctx, state);
    while (!last.matched && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      if (s?.lookIn && Date.now() > nextLook) {
        await s.lookIn(ctx);
        nextLook = Date.now() + 10_000;
      }
      last = await recognizeNow(ctx, state);
    }
    return last;
  };

  const looksLike = async (ctx: C, except: string) => {
    const matches: string[] = [];
    for (const name of Object.keys(impl.states)) {
      if (name === except || impl.states[name]?.sameAs === except || impl.states[except]?.sameAs === name) continue;
      if ((await recognizeNow(ctx, name).catch(() => ({ matched: false, signals: [] }))).matched) matches.push(name);
    }
    return matches;
  };

  const collectEvents = async () => {
    const all = await Promise.all(sources.map((s) => s.collect()));
    return { events: all.flatMap((a) => a.events) as CloudEvent[], text: all.map((a) => a.text ?? '').join('\n') };
  };

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
    let error: string | null = null;
    let stoppedAt: string | null = null;
    let failed = false;
    const shotFile = (name: string) => path.join(mediaDir, 'paths', tag, `${name}.png`);
    const clipFile = (index: number) => path.join(mediaDir, 'clips', tag, `${pad(index + 1)}.mp4`);
    const shoot = async (name: string, at: Focus) => (driver.screenshot ? driver.screenshot(ctx, shotFile(name), at).catch(() => null) : null);
    try {
      for (const event of new Set(planned.steps.map((s) => s.event))) await impl.events[event]?.prepare?.(ctx, tools);
      await impl.setup(ctx, { path: planned, tools });
      const startState = planned.start.filter((n) => graph.isLeaf(n) && impl.states[n]).at(-1) ?? planned.steps[0]?.from.at(-1) ?? '';
      const startCheck = await waitFor(ctx, startState);
      if (!startCheck.matched) {
        stoppedAt = startState;
        const like = await looksLike(ctx, startState);
        throw Object.assign(new Error(`The path could not start: expected "${startState}", the app looks like ${like.join(', ') || 'none of the known states'}`), {
          recognizer: startCheck,
          looksLike: like,
          state: startState,
          stepIndex: 0
        });
      }
      observed.push({
        step: { event: '(start)', transitions: [], handOff: false, from: [], to: [startState] },
        target: startState,
        clip: null,
        timeline: [],
        events: { expected: [], observed: [], missing: [], noSignal: [], events: [] },
        recognizer: startCheck,
        shot: await shoot('00-start', on(impl.states[startState]?.client)),
        transient: false,
        checks: (await impl.states[startState]?.checks?.(ctx)) ?? []
      });

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
        await Promise.all(sources.map((s) => s.mark()));
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
          await s.lookIn(ctx);
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
        const clip = recording ? await recording.stop(clipFile(index)) : null;
        const collected = await collectEvents();
        const events = compareBusinessEvents(metaOf.get(target)?.events ?? [], collected, options.eventMatchers ?? {}, hasCloudEvents);
        if (driver.text) leaks.push(...privacyFindings(await driver.text(ctx).catch(() => ''), `${planned.id} / ${target}`, privacy));
        const shot = transient ? null : await shoot(pad(index + 1), on(s?.client));
        observed.push({ step, target, clip, timeline: [...timeline.entries], events, recognizer, shot, transient, checks });
        await s?.settle?.(ctx);
        steps.push({ transition, event: step.event, status: 'passed', reason: null });
      }
    } catch (e) {
      failed = true;
      const err = e as StepFailure;
      error = err.message;
      stoppedAt = err.state ?? stoppedAt;
      const index = err.stepIndex ?? 0;
      const failedShot = await shoot(`failed-${pad(index + 1)}`, on(err.state ? impl.states[err.state]?.client : undefined));
      if (err.state && states[err.state]) {
        states[err.state]!.recognizer = err.recognizer ?? null;
        states[err.state]!.looksLike = err.looksLike ?? [];
        if (failedShot) states[err.state]!.screenshotsByPath[`${planned.id} (failed)`] = rel(failedShot);
      }
      const failedStep = planned.steps[index];
      for (const rest of planned.steps.slice(steps.length)) {
        steps.push({
          transition: rest.transitions[0] ?? rest.event,
          event: rest.event,
          status: rest === failedStep ? 'failed' : 'not-reached',
          reason: rest === failedStep ? err.message : `Not reached: the path stopped at "${err.state ?? 'start'}".`
        });
      }
    }
    const traceFile = path.join(mediaDir, 'traces', `${tag}.zip`);
    const closed = await driver.close(ctx, { failed, traceFile }).catch(() => undefined);
    const trace = closed && closed.trace ? relative(runDir, closed.trace) : null;
    const traces = closed && closed.traces ? Object.fromEntries(Object.entries(closed.traces).map(([client, file]) => [client, relative(runDir, file)])) : undefined;
    return { error, stoppedAt, steps, observed, trace, traces };
  }

  function rel(image: Image): Image {
    return {
      png: relative(runDir, image.png),
      ...(image.webp ? { webp: relative(runDir, image.webp) } : {}),
      ...(image.client ? { client: image.client } : {}),
      ...(image.also?.length ? { also: image.also.map(rel) } : {})
    };
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
        traces: undefined
      };
    }
  }

  const count = (records: { status: Status }[]) => ({
    total: records.length,
    passed: records.filter((r) => r.status === 'passed').length,
    failed: records.filter((r) => r.status === 'failed').length,
    flaky: records.filter((r) => r.status === 'flaky').length,
    notReached: records.filter((r) => r.status === 'not-reached').length
  });

  const kindOf = (event: string) => impl.events[event]?.kind ?? (options.composition.handOffs.some((h) => h.event === event) ? 'hand-off' : 'user');

  const buildManifest = (finished: boolean) => {
    const allStates = walkStates(options.composition.machine);
    return {
      $schema: 'https://github.com/crvouga/atlas/schemas/manifest.schema.json',
      schemaVersion: 1,
      run: {
        id: runId,
        startedAt: startedAt.toISOString(),
        finishedAt: finished ? new Date().toISOString() : null,
        durationMs: Date.now() - startedAt.getTime(),
        commit: git('rev-parse HEAD'),
        branch: git('rev-parse --abbrev-ref HEAD'),
        environment: { driver: driver.name, ...(driver.clients ? { clients: driver.clients } : {}), ...options.environment },
        mode: options.mode,
        specVersion: specVersion(options.bundle),
        specDirectory: relative(process.cwd(), options.bundle.directory),
        approvals: [] as unknown[],
        scope: { chart: scope.chart, start: scope.startLabel, ...(scope.state ? { state: scope.state } : {}) }
      },
      charts: options.bundle.charts.map((c) => {
        const host = options.composition.hosts.get(c.machine.id) ?? null;
        return {
          id: c.machine.id,
          file: c.file,
          description: typeof c.machine.meta?.description === 'string' ? c.machine.meta.description : '',
          parentState: host,
          handOffs: Object.fromEntries(options.composition.handOffs.filter((h) => h.childChart === c.machine.id).map((h) => [h.finalState, h.event]))
        };
      }),
      map: {
        nodes: allStates.map(({ name, node, trail }) => ({
          id: name,
          parent: trail.at(-1) ?? null,
          chart: options.composition.chartOf.get(name) ?? options.bundle.root,
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
          return [
            name,
            {
              name,
              chart: options.composition.chartOf.get(name) ?? null,
              description: meta?.description ?? '',
              snapshot: meta?.snapshot ?? '',
              ...(impl.states[name]?.client ? { client: impl.states[name]!.client } : {}),
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
      paths: results,
      coverage: {
        [scope.chart]: { states: count(Object.values(states)), transitions: count(Object.values(transitions)) },
        overall: { states: count(Object.values(states)), transitions: count(Object.values(transitions)) }
      },
      privacy: { findings: [...leaks], passed: leaks.length === 0 },
      reports: { junit: 'junit.xml', ctrf: 'ctrf.json', mermaid: 'chart.mmd' }
    };
  };

  const writeManifest = (finished: boolean) => {
    const draft = buildManifest(finished);
    const found = privacyFindings(JSON.stringify(draft), 'manifest.json', privacy);
    const manifest = found.length ? { ...draft, privacy: { findings: [...draft.privacy.findings, ...found], passed: false } } : draft;
    writeFileSync(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(path.join(runDir, 'junit.xml'), toJUnit(manifest));
    writeFileSync(path.join(runDir, 'ctrf.json'), `${JSON.stringify(toCtrf(manifest), null, 2)}\n`);
    writeFileSync(path.join(runDir, 'chart.mmd'), toMermaid(options.composition.machine));
    return manifest;
  };

  for (const planned of options.paths) {
    if (planned.skipRun) {
      const firstBlocked = planned.steps.findIndex((s) => !impl.events[s.event] || impl.events[s.event]!.blocked);
      const steps: StepResult[] = planned.steps.map((s, i) => ({
        transition: s.transitions[0] ?? s.event,
        event: s.event,
        status: 'not-reached',
        reason:
          i < firstBlocked
            ? 'Run on another path.'
            : i === firstBlocked
              ? `Blocked: ${impl.events[s.event]?.blocked ?? `No implementation for "${s.event}".`}`
              : `Not reached: the path is blocked at "${planned.steps[firstBlocked]?.event}".`
      }));
      for (const s of steps.slice(Math.max(0, firstBlocked))) {
        const tr = transitions[s.transition];
        if (tr && tr.status === 'not-reached') tr.reason = s.reason;
      }
      results.push({ id: planned.id, name: planned.name, kind: planned.kind, description: planned.description, status: 'not-reached', attempts: [], steps, stoppedAt: null });
      continue;
    }
    log(`▶ ${planned.id} ${planned.name}`);
    const attempts: PathResult['attempts'] = [];
    let outcome = await safeAttempt(planned, 1);
    attempts.push({ status: outcome.error ? 'failed' : 'passed', error: outcome.error, stoppedAt: outcome.stoppedAt, trace: outcome.trace, ...(outcome.traces ? { traces: outcome.traces } : {}) });
    let flaky = false;
    if (outcome.error && options.retry !== false) {
      const second = await safeAttempt(planned, 2);
      attempts.push({ status: second.error ? 'failed' : 'passed', error: second.error, stoppedAt: second.stoppedAt, trace: second.trace, ...(second.traces ? { traces: second.traces } : {}) });
      flaky = !second.error;
      outcome = second;
    }
    const blocked = outcome.steps.some((s) => s.reason?.startsWith('Blocked:'));
    const status: Status = outcome.error ? 'failed' : flaky ? 'flaky' : blocked ? 'not-reached' : 'passed';

    for (const item of outcome.observed) {
      const record = states[item.target];
      if (record) {
        if (!record.reachedBy.includes(planned.id)) record.reachedBy.push(planned.id);
        if (record.status !== 'failed') record.status = flaky ? 'flaky' : 'passed';
        if (item.shot) {
          const shot = rel(item.shot);
          record.screenshotsByPath[planned.id] = shot;
          if (!record.screenshot) record.screenshot = shot;
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
          const captions = item.clip.video.replace(/\.mp4$/, '.vtt');
          writeFileSync(captions, toWebVtt(item.timeline, item.clip.durationMs));
          tr.clip = {
            video: relative(runDir, item.clip.video),
            ...(item.clip.poster ? { poster: relative(runDir, item.clip.poster) } : {}),
            durationMs: item.clip.durationMs,
            captions: relative(runDir, captions),
            ...(item.clip.client ? { client: item.clip.client } : {})
          };
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
    if (outcome.error && outcome.stoppedAt && states[outcome.stoppedAt]) states[outcome.stoppedAt]!.status = 'failed';
    results.push({ id: planned.id, name: planned.name, kind: planned.kind, description: planned.description, status, attempts, steps: outcome.steps, stoppedAt: outcome.stoppedAt });
    log(`  ${status}${outcome.error ? ` — ${outcome.error}` : ''}`);
    writeManifest(false);
  }
  await driver.dispose?.();
  await Promise.all(sources.map((s) => s.close?.()));
  const manifest = writeManifest(true);
  return { runDir, manifest, ok: manifest.privacy.passed && results.every((r) => r.status !== 'failed') };
}
