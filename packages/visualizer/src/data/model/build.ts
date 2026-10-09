import type { DataIssue, EventKind, Image, RunSummary } from '@crvouga/atlas-schema';

import { createIssueSink } from '../parse/issues';
import type { ParsedRun } from '../parse/manifest';
import type { SpecDocument } from '../parse/spec';
import { resolveEventKind } from './event-kind';
import { createJourneyReplayer, type ReplayResult } from './journeys';
import { emptyCounts, worstOf } from './status';
import { createSimulationFactory } from './simulation';
import type {
  AtlasView,
  ChartView,
  ContextView,
  ImageMedia,
  ItemStatus,
  JourneyView,
  PathRef,
  QuestionView,
  RunView,
  StateKind,
  StateView,
  StatusCounts,
  TransitionView,
  VideoMedia
} from './types';

export type MediaResolver = (runId: string, path: string) => string;

const REPORT_LABELS = [
  ['junit', 'JUnit'],
  ['ctrf', 'CTRF'],
  ['mermaid', 'Mermaid']
] as const;

export type BuildInput = {
  spec: SpecDocument;
  specIssues: DataIssue[];
  runs: RunSummary[];
  run: ParsedRun | null;
  runIssues: DataIssue[];
  runProgress?: 'running' | 'complete';
  resolveMedia: MediaResolver;
};

const replayCache = new WeakMap<SpecDocument, { replays: Map<string, ReplayResult>; issues: DataIssue[] }>();

function replayAll(doc: SpecDocument) {
  let cached = replayCache.get(doc);
  if (!cached) {
    const sink = createIssueSink();
    const replay = createJourneyReplayer(doc, sink);
    cached = { replays: new Map(doc.journeys.map((j) => [j.id, replay(j)])), issues: sink.issues };
    replayCache.set(doc, cached);
  }
  return cached;
}

function count(statuses: Iterable<ItemStatus>): StatusCounts {
  const counts = emptyCounts();
  for (const s of statuses) {
    counts[s]++;
    counts.total++;
  }
  return counts;
}

function stateKind(doc: SpecDocument, name: string): StateKind {
  const state = doc.states.get(name)!;
  if (state.childChartId) return 'chart-link';
  if (state.type === 'final') return 'final';
  if (state.type === 'parallel') return 'parallel';
  if (state.type === 'compound') {
    const parent = state.parent ? doc.states.get(state.parent) : null;
    return parent?.type === 'parallel' ? 'region' : 'group';
  }
  return 'screen';
}

/** The structure of a chart only: what layout depends on. */
function structureKey(doc: SpecDocument, chartId: string) {
  const chart = doc.charts.find((c) => c.id === chartId)!;
  const parts: string[] = [chart.id];
  for (const name of chart.states) {
    const s = doc.states.get(name)!;
    parts.push(`${name}|${s.parent ?? ''}|${s.type}|${s.childChartId ?? ''}`);
    for (const tid of s.transitions) parts.push(`${tid}>${doc.transitions.get(tid)?.target ?? ''}`);
  }
  if (chart.parent) {
    const placeholder = doc.states.get(chart.parent.state);
    for (const t of doc.transitions.values()) if (t.target === chart.parent.state) parts.push(`in:${t.id}`);
    for (const tid of placeholder?.transitions ?? []) parts.push(`out:${tid}>${doc.transitions.get(tid)?.target ?? ''}`);
  }
  if (chart.layout) parts.push(JSON.stringify(chart.layout));
  return parts.join('\n');
}

/**
 * The view model every component reads: the spec says what exists, the selected run annotates it,
 * and every state, event and journey resolves to one status.
 */
export function buildAtlasView(input: BuildInput): AtlasView {
  const { spec: doc, run } = input;
  const { replays, issues: replayIssues } = replayAll(doc);
  const runFile = run?.file ?? '';
  const sink = createIssueSink();
  const anyRuns = input.runs.length > 0 || run !== null;
  const unrun: ItemStatus = anyRuns ? 'not-yet-run' : 'spec-only';

  const processing = input.runProgress === 'running';
  const image = (img: Image | null | undefined, marked: string | undefined): ImageMedia => {
    if (!run || !img) return { state: marked === 'processing' || processing ? 'processing' : 'missing', thumb: null, full: null };
    if (marked === 'processing') return { state: 'processing', thumb: null, full: null };
    return { state: 'available', thumb: input.resolveMedia(run.id, img.webp), full: input.resolveMedia(run.id, img.png) };
  };
  const pathRef = (id: string): PathRef => ({ id, name: run?.paths.find((p) => p.id === id)?.name ?? id });

  const questions = new Map<string, QuestionView>();
  for (const q of doc.questions) {
    const id = `${q.file}#${q.number}`;
    const transitions = q.transitions
      .flatMap((t) => [...doc.transitions.values()].filter((x) => x.event === t.event && !x.carriedBy && (t.source === '' || x.source === t.source || doc.states.get(x.source)?.parent === t.source)).map((x) => x.id))
      .filter((x): x is string => Boolean(x));
    questions.set(id, { id, number: q.number, section: q.section, title: q.title, body: q.body, specToday: q.specToday, file: q.file, states: q.states, transitions });
  }

  const contextOfChart = new Map(doc.charts.map((c) => [c.id, c.contextId]));
  const states = new Map<string, StateView>();
  for (const s of doc.states.values()) {
    const record = run?.states.get(s.name);
    states.set(s.name, {
      key: s.name,
      name: s.name,
      chartId: s.chartId,
      contextId: contextOfChart.get(s.chartId) ?? '',
      file: s.file,
      parent: s.parent,
      children: s.children,
      depth: s.depth,
      type: s.type,
      kind: stateKind(doc, s.name),
      initial: s.initial,
      description: s.meta.description ?? '',
      snapshot: s.meta.snapshot ?? null,
      confidence: s.meta.confidence ?? null,
      sources: s.meta.source ?? [],
      owner: s.meta.owner ?? null,
      tier: s.meta.tier ?? null,
      quint: s.meta.quint ?? null,
      gherkin: s.meta.gherkin ?? [],
      contracts: s.meta.contracts ?? [],
      design: s.meta.design ?? null,
      hints: s.meta.hints ?? [],
      specChecks: s.meta.checks ?? [],
      specBusinessEvents: s.meta.events ?? [],
      deadEnd: s.meta.deadEnd ?? null,
      childChartId: s.childChartId,
      incoming: [],
      outgoing: [...s.transitions],
      questionIds: [...questions.values()].filter((q) => q.states.includes(s.name)).map((q) => q.id),
      knownIssues: doc.knownIssues.filter((n) => n.states.includes(s.name)).map((n) => ({ title: n.title, body: n.body, file: n.file })),
      status: record?.status ?? unrun,
      result: record
        ? {
            runId: run!.id,
            status: record.status,
            screenshot: image(record.screenshot, record.screenshotState),
            screenshotsByPath: Object.entries(record.screenshotsByPath ?? {}).map(([id, img]) => ({ path: pathRef(id), image: image(img, undefined) })),
            checks: record.checks ?? [],
            businessEvents: record.businessEvents ?? null,
            reachedBy: (record.reachedBy ?? []).map(pathRef),
            notes: record.notes ?? [],
            looksLike: record.looksLike ?? [],
            seeds: record.seeds ?? [],
            recognizer: record.recognizer ?? null
          }
        : null,
      change: 'same'
    });
  }

  const chartMeta = new Map(doc.charts.map((c) => [c.id, c.meta]));
  const transitions = new Map<string, TransitionView>();
  for (const t of doc.transitions.values()) {
    const record = run?.transitions.get(t.id) ?? (t.carriedBy ? run?.transitions.get(t.carriedBy) : undefined);
    const meta = chartMeta.get(t.chartId);
    const runKind: EventKind | undefined = record?.kind ?? (t.carriedBy ? run?.transitions.get(t.carriedBy)?.kind : undefined);
    const { kind, source } = resolveEventKind({
      event: t.event,
      handOff: t.handOff || Boolean(t.carriedBy),
      specKind: meta?.eventKinds?.[t.event],
      specTimeSpan: meta?.timeEvents?.[t.event],
      runKind
    });
    const clip: VideoMedia =
      run && record?.clip && record.clip.state !== 'processing'
        ? {
            state: 'available',
            src: input.resolveMedia(run.id, record.clip.video),
            poster: record.clip.poster ? input.resolveMedia(run.id, record.clip.poster) : null,
            durationMs: record.clip.durationMs ?? null,
            captions: record.clip.captions ? input.resolveMedia(run.id, record.clip.captions) : null
          }
        : { state: record?.clip?.state === 'processing' || (processing && record?.status === 'passed') ? 'processing' : 'missing', src: null, poster: null, durationMs: null, captions: null };
    transitions.set(t.id, {
      id: t.id,
      chartId: t.chartId,
      source: t.source,
      target: t.target,
      event: t.event,
      kind,
      kindSource: source,
      timeSpan: meta?.timeEvents?.[t.event] ?? null,
      handOff: t.handOff,
      carriedBy: t.carriedBy,
      questionIds: [...questions.values()].filter((q) => q.transitions.includes(t.id)).map((q) => q.id),
      knownIssues: doc.knownIssues
        .filter((n) => n.transitions.some((r) => r.source === t.source && r.event === t.event))
        .map((n) => ({ title: n.title, body: n.body, file: n.file })),
      status: record?.status ?? unrun,
      result: record
        ? {
            runId: run!.id,
            status: record.status,
            how: record.how ?? null,
            reason: record.reason ?? null,
            clip,
            timeline: record.timeline,
            reachedBy: (record.reachedBy ?? []).map(pathRef)
          }
        : null,
      change: 'same'
    });
    if (t.target) states.get(t.target)?.incoming.push(t.id);
  }

  for (const s of states.values()) {
    if (s.children.length === 0) continue;
    const descendants: ItemStatus[] = s.result ? [s.result.status] : [];
    const walk = (name: string) => {
      for (const c of states.get(name)?.children ?? []) {
        const child = states.get(c)!;
        if (child.children.length) walk(c);
        else descendants.push(child.status);
      }
    };
    walk(s.name);
    s.status = worstOf(descendants, unrun);
  }
  for (const s of states.values()) {
    if (s.kind !== 'chart-link') continue;
    const child = doc.charts.find((c) => c.id === s.childChartId);
    const leaves = (child?.states ?? []).map((n) => states.get(n)!).filter((x) => !x.children.length).map((x) => x.status);
    s.status = worstOf(s.result ? [s.result.status, ...leaves] : leaves, unrun);
  }

  const journeys: JourneyView[] = doc.journeys.map((j) => {
    const replay = replays.get(j.id)!;
    const composed = run?.journeys.find((r) => r.name === j.name);
    const stretchOrder = (id: string) => composed?.paths.indexOf(id) ?? 0;
    const runPaths = (run?.paths ?? [])
      .filter((p) => p.kind === 'journey' && (composed ? composed.paths.includes(p.id) : p.journeys ? p.journeys.includes(j.name) : p.name === j.name))
      .sort((a, b) => stretchOrder(a.id) - stretchOrder(b.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        seed: p.seed ?? null,
        status: p.status,
        stoppedAt: p.stoppedAt ?? null,
        error: p.attempts?.find((a) => a.error)?.error ?? null,
        steps: p.steps.map((st) => ({ transition: st.transition ?? null, event: st.event, status: st.status ?? null, reason: st.reason ?? null }))
      }));
    const chartIds = [...new Set(replay.steps.flatMap((st) => st.transitionIds.map((tid) => doc.transitions.get(tid)?.chartId)).filter((x): x is string => Boolean(x)))];
    return {
      id: j.id,
      name: j.name,
      description: j.description,
      file: j.file,
      chartIds,
      owner: j.owner,
      tour: j.tour,
      events: j.events,
      endsIn: j.endsIn,
      steps: replay.steps,
      replay: { ok: replay.ok, failedAt: replay.failedAt, missingEnds: replay.missingEnds },
      status: runPaths.length ? worstOf(runPaths.map((p) => p.status), unrun) : unrun,
      runPaths
    };
  });

  const isScreen = (s: StateView) => s.kind === 'screen' || s.kind === 'final';
  const counted = (t: TransitionView) => !t.carriedBy;
  const charts = new Map<string, ChartView>();
  for (const c of doc.charts) {
    const chartStates = c.states.map((n) => states.get(n)!);
    const chartTransitions = [...transitions.values()].filter((t) => t.chartId === c.id);
    charts.set(c.id, {
      id: c.id,
      name: c.name,
      file: c.file,
      dir: c.dir,
      contextId: c.contextId,
      description: c.meta.description ?? '',
      contracts: c.meta.contracts ?? [],
      parent: c.parent,
      childChartIds: doc.charts.filter((x) => x.parent?.chartId === c.id).map((x) => x.id),
      initial: c.initial,
      rootStates: c.rootStates,
      states: c.states,
      transitions: chartTransitions.map((t) => t.id),
      journeyIds: journeys.filter((j) => j.chartIds.includes(c.id)).map((j) => j.id),
      layout: c.layout,
      screens: count(chartStates.filter(isScreen).map((s) => s.status)),
      events: count(chartTransitions.filter(counted).map((t) => t.status)),
      structureKey: structureKey(doc, c.id)
    });
  }

  const contexts: ContextView[] = doc.contexts.map((ctx) => {
    const chartIds = doc.charts.filter((c) => c.contextId === ctx.id).map((c) => c.id);
    const ctxStates = [...states.values()].filter((s) => s.contextId === ctx.id && isScreen(s));
    const ctxTransitions = [...transitions.values()].filter((t) => chartIds.includes(t.chartId) && counted(t));
    return {
      id: ctx.id,
      name: ctx.name,
      description: ctx.description || doc.charts.find((c) => c.contextId === ctx.id && !c.parent)?.meta.description || '',
      owner: ctx.owner,
      chartIds,
      topChartIds: chartIds.filter((id) => !charts.get(id)?.parent),
      screens: count(ctxStates.map((s) => s.status)),
      events: count(ctxTransitions.map((t) => t.status)),
      journeys: count(journeys.filter((j) => j.chartIds.some((id) => chartIds.includes(id))).map((j) => j.status))
    };
  });

  const removed: AtlasView['removed'] = { states: [], transitions: [] };
  if (run) {
    for (const [name, record] of run.states) {
      if (states.has(name)) continue;
      removed.states.push({ name, chartId: record.chart ?? null, status: record.status, screenshot: image(record.screenshot, record.screenshotState), description: record.description ?? '' });
    }
    for (const [id, record] of run.transitions) {
      if (transitions.has(id)) continue;
      removed.transitions.push({ id, source: record.source, event: record.event, target: record.target ?? null, status: record.status });
    }
    if (removed.states.length || removed.transitions.length) {
      sink.add('info', runFile, [], `This run checked ${removed.states.length} screen(s) and ${removed.transitions.length} event(s) that are no longer in the spec. They are listed as removed from the spec.`);
    }
  }

  const summary = run ? input.runs.find((r) => r.id === run.id) : undefined;
  const runView: RunView | null = run
    ? {
        id: run.id,
        info: run.info,
        progress: input.runProgress ?? summary?.progress ?? 'complete',
        privacyPassed: run.privacy?.passed ?? null,
        outOfDate: removed.states.length + removed.transitions.length > 0,
        reports: REPORT_LABELS.flatMap(([key, label]) => {
          const file = run.reports?.[key];
          return file ? [{ label, url: input.resolveMedia(run.id, file) }] : [];
        })
      }
    : null;

  return {
    simulation: createSimulationFactory(doc),
    title: doc.title,
    description: doc.description,
    ref: doc.ref,
    mode: run ? 'run' : 'spec-only',
    contexts,
    charts,
    states,
    transitions,
    journeys,
    questions,
    excluded: doc.excluded,
    handOffs: doc.handOffs.flatMap((h) => {
      const contextOf = (ref: string) => (doc.contexts.some((c) => c.id === ref) ? ref : states.get(ref)?.contextId ?? null);
      const from = contextOf(h.from);
      const to = contextOf(h.to);
      if (!from || !to) {
        sink.add('warning', 'atlas.yaml', ['handOffs', h.event], `connects "${h.from}" to "${h.to}", but ${from ? `"${h.to}"` : `"${h.from}"`} is neither a context nor a state in the spec.`);
        return [];
      }
      return [{ ...h, fromContext: from, toContext: to, fromState: states.has(h.from) ? h.from : null, toState: states.has(h.to) ? h.to : null }];
    }),
    run: runView,
    runs: input.runs,
    removed,
    totals: {
      screens: count([...states.values()].filter(isScreen).map((s) => s.status)),
      events: count([...transitions.values()].filter(counted).map((t) => t.status)),
      journeys: count(journeys.map((j) => j.status))
    },
    issues: [...input.specIssues, ...replayIssues, ...input.runIssues, ...sink.issues]
  };
}
