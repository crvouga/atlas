import {
  AtlasContextSchema,
  AtlasFileSchema,
  AtlasHandOffSchema,
  JourneySchema,
  LayoutFileSchema,
  StateMetaShape,
  type LayoutFile,
  type StateMeta,
  type StateType,
  transitionId
} from '@crvouga/atlas-schema';
import { parseChart } from '@crvouga/atlas/spec';
import { z } from 'zod/v4';

import { createIssueSink, isRecord, parseFields, parseOne, type IssueSink } from './issues';
import { parseKnownIssues, parseOpenQuestions, type ParsedNote, type ParsedQuestion } from './markdown';
import { readStructured } from './structured';

export type SpecFile = { path: string; text: string | null; error?: string };

export type SpecSource = { ref: string | null; files: SpecFile[] };

export type ParsedTransition = {
  id: string;
  chartId: string;
  source: string;
  event: string;
  rawTarget: string;
  target: string | null;
  /** A child chart's final state passing its event up to the parent. */
  handOff: boolean;
  /** For a collapsed child chart's own transition: the hand-off transition that carries it. */
  carriedBy: string | null;
};

export type ParsedState = {
  name: string;
  chartId: string;
  file: string;
  parent: string | null;
  depth: number;
  type: StateType;
  initial: string | null;
  meta: StateMeta;
  children: string[];
  transitions: string[];
  /** The chart this state runs: `invoke: { src }` (SCXML `<invoke>`), or the legacy `meta.childMachine`. */
  childChartId: string | null;
  /** The invoke that names the child chart, when it is declared the standard way. */
  invoke: ParsedInvoke | null;
  /** On a child chart's final state: the event its parent receives (`meta.doneEvent`, SCXML `atlas:done-event`). */
  doneEvent: string | null;
};

export type ParsedInvoke = { src: string; id: string | null; onDone: string | null };

export type ParsedChart = {
  id: string;
  name: string;
  file: string;
  format: 'scxml' | 'xstate';
  dir: string;
  contextId: string;
  meta: StateMeta;
  initial: string | null;
  rootStates: string[];
  states: string[];
  parent: { chartId: string; state: string } | null;
  layout: LayoutFile | null;
  type?: 'parallel';
  explorationError?: string;
};

export type ParsedJourney = {
  id: string;
  name: string;
  dir: string;
  file: string;
  description: string;
  events: string[];
  endsIn: string[];
  owner: string | null;
  tour: boolean;
};

export type ParsedContext = {
  id: string;
  name: string;
  description: string;
  owner: string | null;
  directories: string[];
  declared: boolean;
};

export type ParsedHandOff = { from: string; to: string; event: string; description: string };

export type SpecDocument = {
  ref: string | null;
  title: string;
  description: string;
  contexts: ParsedContext[];
  handOffs: ParsedHandOff[];
  charts: ParsedChart[];
  states: Map<string, ParsedState>;
  transitions: Map<string, ParsedTransition>;
  journeys: ParsedJourney[];
  questions: ParsedQuestion[];
  knownIssues: ParsedNote[];
  excluded: string[];
  /** Directories holding charts, each with the charts it composes (top chart first). */
  groups: { dir: string; chartIds: string[]; journeyIds: string[] }[];
};

const StateFieldsShape = {
  id: z.string().min(1),
  initial: z.string().min(1),
  type: z.enum(['parallel', 'final'])
};

const MachineFieldsShape = { ...StateFieldsShape, id: z.string().min(1) };

function dirOf(path: string) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function baseOf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleCase(id: string) {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

function layoutPathFor(chartFile: string) {
  return chartFile.replace(/\.(ya?ml|json|scxml)$/i, '.layout.json');
}

function isScxmlFile(path: string) {
  return /\.scxml$/i.test(path);
}

/** A chart in either open format: W3C SCXML, or XState machine config in YAML or JSON. */
export function isMachineFile(path: string) {
  return isScxmlFile(path) || /(^|\/)([\w.-]+\.)?machine\.(ya?ml|json)$/.test(path);
}

/** `meta` fields that hold lists or maps; SCXML carries them as text in the `atlas:` namespace. */
const STRUCTURED_META = new Set(['events', 'source', 'checks', 'hints', 'gherkin', 'contracts', 'design', 'eventKinds', 'timeEvents', 'childFinalEvents']);
const LIST_META = new Set(['events', 'source', 'checks', 'hints', 'gherkin', 'contracts']);

/** SCXML metadata arrives as text: JSON for lists and maps, or one plain item of a list. */
function normalizeScxmlMeta(meta: unknown) {
  if (!isRecord(meta)) return meta;
  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => {
      if (typeof value !== 'string' || !STRUCTURED_META.has(key)) return [key, value];
      const text = value.trim();
      if (/^[[{]/.test(text)) {
        try {
          return [key, JSON.parse(text) as unknown];
        } catch {
          return [key, value];
        }
      }
      return [key, LIST_META.has(key) ? [value] : value];
    })
  );
}

function normalizeScxmlStates(node: Record<string, unknown>) {
  if (node.meta !== undefined) node.meta = normalizeScxmlMeta(node.meta);
  if (isRecord(node.states)) for (const child of Object.values(node.states)) if (isRecord(child)) normalizeScxmlStates(child);
  return node;
}

/** A chart file to plain data: SCXML through the Atlas reader, YAML and JSON as they are. */
function readChart(file: string, text: string, sink: IssueSink): unknown {
  if (!isScxmlFile(file)) return readStructured(file, text, sink);
  try {
    return normalizeScxmlStates(structuredClone(parseChart(file, text).machine) as Record<string, unknown>);
  } catch (error) {
    sink.add('error', file, [], `This SCXML file could not be read, so it was skipped: ${error instanceof Error ? error.message : 'unknown problem'}.`);
    return undefined;
  }
}

function targetText(raw: unknown) {
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (isRecord(raw) && typeof raw.target === 'string' && raw.target.trim()) return raw.target;
  return null;
}

/** `invoke: { src, id, onDone }` or a list of them; the map follows the first. */
function readInvoke(raw: unknown, sink: IssueSink, file: string, path: (string | number)[]): ParsedInvoke | null {
  if (raw === undefined) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length > 1) sink.add('warning', file, path, 'runs several charts at once; the map shows the first one.');
  const first: unknown = list[0];
  if (!isRecord(first) || typeof first.src !== 'string' || !first.src.trim()) {
    sink.add('warning', file, Array.isArray(raw) ? [...path, 0] : path, 'should name the chart it runs in "src", so it is left off the map.');
    return null;
  }
  return { src: first.src, id: typeof first.id === 'string' && first.id ? first.id : null, onDone: targetText(first.onDone) };
}

/** `machine.json` beside a `machine.yaml` is the same chart exported for Stately Studio. */
function shadowedJson(path: string, all: ReadonlySet<string>) {
  return path.endsWith('.json') && (all.has(path.replace(/\.json$/, '.yaml')) || all.has(path.replace(/\.json$/, '.yml')));
}

type RawTarget = { target: string } | null;

function readTarget(raw: unknown, sink: IssueSink, file: string, path: (string | number)[]): RawTarget {
  if (typeof raw === 'string' && raw.trim()) return { target: raw };
  if (Array.isArray(raw)) {
    sink.add('warning', file, path, 'has several possible destinations; the map shows the first one.');
    return readTarget(raw[0], sink, file, [...path, 0]);
  }
  if (isRecord(raw) && typeof raw.target === 'string' && raw.target.trim()) return { target: raw.target };
  sink.add('warning', file, path, 'has no destination screen, so it is left off the map.');
  return null;
}

/** The map remains tolerant, but exploration must never silently erase executable conditions. */
function explorationIssue(raw: Record<string, unknown>): string | undefined {
  const allowed = new Set(['id', 'initial', 'type', 'meta', 'states', 'on', 'invoke', 'description']);
  const target = (value: unknown) => value === null || value === undefined || typeof value === 'string' || (isRecord(value) && typeof value.target === 'string' && Object.keys(value).every((key) => key === 'target'));
  const visit = (node: Record<string, unknown>): string | undefined => {
    const key = Object.keys(node).find((key) => !allowed.has(key));
    if (key) return `“${key}” needs executable code and is outside Atlas’s pure exploration model.`;
    if (node.type !== undefined && node.type !== 'parallel' && node.type !== 'final') return 'This state type is outside Atlas’s pure exploration model.';
    if (node.on !== undefined && (!isRecord(node.on) || Object.values(node.on).some((value) => !target(value)))) return 'Conditional, multiple or invalid transition destinations cannot be explored safely.';
    if (node.invoke !== undefined) {
      const invokes = Array.isArray(node.invoke) ? node.invoke : [node.invoke];
      if (invokes.length !== 1 || invokes.some((invoke) => !isRecord(invoke) || typeof invoke.src !== 'string' || Object.keys(invoke).some((key) => !['src', 'id', 'onDone'].includes(key)) || (invoke.onDone !== undefined && !target(invoke.onDone)))) return 'Only one statically named child chart per state can be explored safely.';
    }
    if (isRecord(node.states)) for (const child of Object.values(node.states)) {
      if (!isRecord(child)) return 'A state with invalid details cannot be explored safely.';
      const issue = visit(child);
      if (issue) return issue;
    }
    return undefined;
  };
  return visit(raw);
}

/**
 * The statechart files under the specs root, parsed one piece at a time: a broken state, journey
 * or file is reported and skipped, and everything else still renders.
 */
export function parseSpec(source: SpecSource, sink: IssueSink = createIssueSink()): SpecDocument {
  const paths = new Set(source.files.map((f) => f.path));
  const texts = new Map<string, string>();
  for (const file of source.files) {
    if (file.text === null) {
      sink.add('error', file.path, [], `This file could not be loaded${file.error ? ` (${file.error})` : ''}. Its part of the map is missing until it loads.`);
    } else {
      texts.set(file.path, file.text);
    }
  }

  const atlasPath = [...texts.keys()].find((p) => /^atlas\.ya?ml$/.test(p));
  const atlasRaw = atlasPath ? readStructured(atlasPath, texts.get(atlasPath)!, sink) : undefined;
  const atlas = atlasPath && atlasRaw !== undefined ? parseOne(AtlasFileSchema, atlasRaw, sink, atlasPath, []) : null;
  const declaredContexts: ParsedContext[] = (atlas?.contexts ?? []).flatMap((raw, i) => {
    const ctx = parseOne(AtlasContextSchema, raw, sink, atlasPath!, ['contexts', i]);
    return ctx
      ? [{ id: ctx.id, name: ctx.name ?? titleCase(ctx.id), description: ctx.description ?? '', owner: ctx.owner ?? null, directories: ctx.directories ?? [ctx.id], declared: true }]
      : [];
  });
  const handOffs: ParsedHandOff[] = (atlas?.handOffs ?? []).flatMap((raw, i) => {
    const h = parseOne(AtlasHandOffSchema, raw, sink, atlasPath!, ['handOffs', i]);
    return h ? [{ from: h.from, to: h.to, event: h.event, description: h.description ?? '' }] : [];
  });

  const contexts = [...declaredContexts];
  const contextFor = (dir: string) => {
    const declared = declaredContexts
      .filter((c) => c.directories.some((d) => dir === d || dir.startsWith(`${d}/`)))
      .sort((a, b) => Math.max(...b.directories.map((d) => d.length)) - Math.max(...a.directories.map((d) => d.length)))[0];
    if (declared) return declared.id;
    const id = dir.split('/')[0] || 'product';
    if (!contexts.some((c) => c.id === id)) {
      contexts.push({ id, name: titleCase(id), description: '', owner: null, directories: [id], declared: false });
    }
    return id;
  };

  const charts: ParsedChart[] = [];
  const states = new Map<string, ParsedState>();
  const transitions = new Map<string, ParsedTransition>();
  const idToName = new Map<string, Map<string, string>>();

  const machineFiles = [...texts.keys()].filter((p) => isMachineFile(p) && !shadowedJson(p, paths)).sort((a, b) => {
    const depth = (p: string) => (baseOf(p).startsWith('machine.') ? 0 : 1);
    return dirOf(a).localeCompare(dirOf(b)) || depth(a) - depth(b) || a.localeCompare(b);
  });

  for (const file of machineFiles) {
    const raw = readChart(file, texts.get(file)!, sink);
    if (raw === undefined) continue;
    if (!isRecord(raw)) {
      sink.add('error', file, [], 'This file should describe a chart with an id and states, so it was skipped.');
      continue;
    }
    const fields = parseFields(MachineFieldsShape, raw, sink, file, []);
    let id = fields.id ?? '';
    if (!id) {
      id = titleCase(baseOf(file).replace(/\.(machine\.)?(ya?ml|json)$/, '').replace(/\.scxml$/i, '').replace(/^machine$/, dirOf(file).split('/').pop() ?? 'chart'));
      sink.add('warning', file, ['id'], `The chart has no name; it is shown as "${id}".`);
    }
    if (charts.some((c) => c.id === id)) {
      const renamed = `${id} (${dirOf(file)})`;
      sink.add('warning', file, ['id'], `Another chart is already called "${id}"; this one is shown as "${renamed}".`);
      id = renamed;
    }
    const dir = dirOf(file);
    const layoutPath = layoutPathFor(file);
    let layout: LayoutFile | null = null;
    if (texts.has(layoutPath)) {
      const layoutRaw = readStructured(layoutPath, texts.get(layoutPath)!, sink);
      layout = layoutRaw === undefined ? null : parseOne(LayoutFileSchema, layoutRaw, sink, layoutPath, [], 'warning');
    }
    const chart: ParsedChart = {
      id,
      name: id,
      file,
      format: isScxmlFile(file) ? 'scxml' : 'xstate',
      dir,
      contextId: contextFor(dir),
      meta: parseFields(StateMetaShape, raw.meta, sink, file, ['meta']),
      initial: fields.initial ?? null,
      rootStates: [],
      states: [],
      parent: null,
      layout
    };
    if (fields.type === 'parallel') chart.type = 'parallel';
    chart.explorationError = explorationIssue(raw);
    if (chart.explorationError) sink.add('warning', file, [], `Free exploration is disabled: ${chart.explorationError}`);
    charts.push(chart);
    const ids = new Map<string, string>();
    idToName.set(id, ids);

    const walk = (statesRaw: unknown, parent: string | null, depth: number, yamlPath: (string | number)[]): string[] => {
      if (statesRaw === undefined) return [];
      if (!isRecord(statesRaw)) {
        sink.add('warning', file, yamlPath, 'should list the states inside it by name.');
        return [];
      }
      const names: string[] = [];
      for (const [rawName, node] of Object.entries(statesRaw)) {
        const path = [...yamlPath, rawName];
        if (!isRecord(node)) {
          sink.add('warning', file, path, 'This state has no details, so it is left off the map.');
          continue;
        }
        let name = rawName;
        if (states.has(name)) {
          name = `${rawName} (${id})`;
          sink.add('warning', file, path, `Another state is already called "${rawName}"; this one is shown as "${name}".`);
        }
        const f = parseFields(StateFieldsShape, node, sink, file, path);
        const meta = parseFields(StateMetaShape, node.meta, sink, file, [...path, 'meta']);
        if (node.meta === undefined) sink.add('info', file, path, 'This state has no description yet.');
        const invoke = readInvoke(node.invoke, sink, file, [...path, 'invoke']);
        const rawDone = isRecord(node.meta) ? node.meta.doneEvent : undefined;
        const state: ParsedState = {
          name,
          chartId: id,
          file,
          parent,
          depth,
          type: 'atomic',
          initial: f.initial ?? null,
          meta,
          children: [],
          transitions: [],
          childChartId: invoke?.src ?? meta.childMachine ?? null,
          invoke,
          doneEvent: typeof rawDone === 'string' && rawDone.trim() ? rawDone : null
        };
        states.set(name, state);
        chart.states.push(name);
        ids.set(f.id ?? rawName, name);
        if (f.id && f.id !== rawName) ids.set(rawName, name);
        names.push(name);
        state.children = walk(node.states, name, depth + 1, [...path, 'states']);
        state.type = f.type === 'final' ? 'final' : f.type === 'parallel' ? 'parallel' : state.children.length ? 'compound' : 'atomic';
        if (state.type === 'compound' && !state.initial) {
          state.initial = state.children[0] ?? null;
          sink.add('info', file, path, `No starting state is named; "${state.initial}" is assumed.`);
        }
        if (node.on !== undefined && !isRecord(node.on)) {
          sink.add('warning', file, [...path, 'on'], 'should list events by name.');
        }
        for (const [event, rawTarget] of Object.entries(isRecord(node.on) ? node.on : {})) {
          const target = readTarget(rawTarget, sink, file, [...path, 'on', event]);
          if (!target) continue;
          const tid = transitionId(name, event);
          transitions.set(tid, { id: tid, chartId: id, source: name, event, rawTarget: target.target, target: null, handOff: false, carriedBy: null });
          state.transitions.push(tid);
        }
      }
      return names;
    };
    chart.rootStates = walk(raw.states, null, 0, ['states']);
    if (chart.rootStates.length === 0) sink.add('warning', file, ['states'], 'This chart has no states yet.');
    if (!chart.initial) chart.initial = chart.rootStates[0] ?? null;
  }

  const chartById = new Map(charts.map((c) => [c.id, c]));
  const findByName = (chartId: string, target: string) => {
    const clean = target.replace(/^#/, '').split('.').pop()!;
    return idToName.get(chartId)?.get(clean) ?? (states.has(clean) ? clean : null) ?? [...idToName.values()].map((m) => m.get(clean)).find(Boolean) ?? null;
  };
  for (const t of transitions.values()) {
    t.target = findByName(t.chartId, t.rawTarget);
    if (!t.target) {
      sink.add('warning', chartById.get(t.chartId)!.file, ['states', t.source, 'on', t.event], `goes to "${t.rawTarget.replace(/^#/, '')}", which isn't in the spec, so it is left off the map.`);
    }
  }

  /**
   * Child charts, composed as the runner composes them: each final state at the top of the child
   * hands an event to the parent state that runs it. The event is, in order, the legacy
   * `meta.childFinalEvents` entry, the final's own `doneEvent`, or `done.invoke.<id>`; the parent
   * handles it with a transition of that name or, failing that, the invoke's `onDone`.
   */
  for (const state of states.values()) {
    if (!state.childChartId) continue;
    const child = chartById.get(state.childChartId);
    const parentChart = chartById.get(state.chartId)!;
    const declaredAt = state.invoke ? ['states', state.name, 'invoke'] : ['states', state.name, 'meta', 'childMachine'];
    if (!child) {
      sink.add('warning', state.file, declaredAt, `names the chart "${state.childChartId}", which isn't in the spec.`);
      state.childChartId = null;
      continue;
    }
    if (child.id === parentChart.id) {
      state.childChartId = null;
      continue;
    }
    child.parent = { chartId: parentChart.id, state: state.name };
    const legacy = state.meta.childFinalEvents ?? {};
    for (const finalName of Object.keys(legacy)) {
      const final = states.get(finalName);
      if (!final || final.chartId !== child.id) {
        sink.add('warning', state.file, ['states', state.name, 'meta', 'childFinalEvents', finalName], `names "${finalName}" as an end of "${child.id}", but that chart has no such state.`);
      }
    }
    const defaultEvent = `done.invoke.${state.invoke?.id ?? child.id}`;
    for (const finalName of child.rootStates) {
      const final = states.get(finalName);
      if (!final || final.type !== 'final') continue;
      const event = legacy[finalName] ?? final.doneEvent ?? defaultEvent;
      let parentTransition = transitions.get(transitionId(state.name, event));
      if (!parentTransition && state.invoke?.onDone) {
        const id = transitionId(state.name, event);
        parentTransition = { id, chartId: parentChart.id, source: state.name, event, rawTarget: state.invoke.onDone, target: findByName(parentChart.id, state.invoke.onDone), handOff: false, carriedBy: null };
        if (!parentTransition.target) {
          sink.add('warning', state.file, [...declaredAt, 'onDone'], `goes to "${state.invoke.onDone.replace(/^#/, '')}", which isn't in the spec, so it is left off the map.`);
        }
        transitions.set(id, parentTransition);
        state.transitions.push(id);
      }
      if (!parentTransition) {
        const where = finalName in legacy ? ['states', state.name, 'meta', 'childFinalEvents', finalName] : declaredAt;
        sink.add('warning', state.file, where, `"${finalName}" ends "${child.id}" and passes "${event}" up, but "${state.name}" doesn't respond to it.`);
        continue;
      }
      const tid = transitionId(finalName, event);
      transitions.set(tid, { id: tid, chartId: child.id, source: finalName, event, rawTarget: parentTransition.rawTarget, target: parentTransition.target, handOff: true, carriedBy: null });
      final.transitions.push(tid);
      parentTransition.carriedBy ??= tid;
    }
  }

  const groups: SpecDocument['groups'] = [];
  for (const chart of charts) {
    let group = groups.find((g) => g.dir === chart.dir);
    if (!group) {
      group = { dir: chart.dir, chartIds: [], journeyIds: [] };
      groups.push(group);
    }
    group.chartIds.push(chart.id);
  }
  for (const group of groups) {
    group.chartIds.sort((a, b) => Number(Boolean(chartById.get(a)!.parent)) - Number(Boolean(chartById.get(b)!.parent)));
  }

  const journeys: ParsedJourney[] = [];
  const journeyIds = new Set<string>();
  for (const file of [...texts.keys()].filter((p) => /(^|\/)journeys\.ya?ml$/.test(p)).sort()) {
    const raw = readStructured(file, texts.get(file)!, sink);
    if (raw === undefined) continue;
    if (!isRecord(raw) || !isRecord(raw.journeys)) {
      sink.add('warning', file, ['journeys'], 'should list journeys by name.');
      continue;
    }
    const dir = dirOf(file);
    for (const [name, entry] of Object.entries(raw.journeys)) {
      const j = parseOne(JourneySchema, entry, sink, file, ['journeys', name]);
      if (!j) continue;
      let id = slug(name) || `journey-${journeys.length + 1}`;
      while (journeyIds.has(id)) id = `${id}-2`;
      journeyIds.add(id);
      journeys.push({ id, name, dir, file, description: j.description ?? '', events: j.events, endsIn: j.endsIn ?? [], owner: j.owner ?? null, tour: j.tour ?? false });
      const group = groups.find((g) => g.dir === dir);
      if (group) group.journeyIds.push(id);
      else sink.add('info', file, ['journeys', name], 'There is no chart in this folder for the journey to follow.');
    }
  }

  const questions: ParsedQuestion[] = [];
  const excluded = [...(atlas?.excluded ?? [])];
  const stateNames = new Set(states.keys());
  for (const file of [...texts.keys()].filter((p) => /(^|\/)open-questions\.md$/.test(p)).sort()) {
    const parsed = parseOpenQuestions(file, texts.get(file)!, stateNames);
    questions.push(...parsed.questions);
    for (const item of parsed.excluded) if (!excluded.includes(item)) excluded.push(item);
  }
  for (const q of questions) q.states = q.states.filter((s) => stateNames.has(s));
  const knownIssues = [...texts.keys()]
    .filter((p) => /(^|\/)known-issues\.md$/.test(p))
    .sort()
    .flatMap((file) => parseKnownIssues(file, texts.get(file)!, stateNames));

  return {
    ref: source.ref,
    title: atlas?.title ?? 'Atlas',
    description: atlas?.description ?? '',
    contexts: contexts.filter((c) => c.declared || charts.some((ch) => ch.contextId === c.id)),
    handOffs,
    charts,
    states,
    transitions,
    journeys,
    questions,
    knownIssues,
    excluded,
    groups
  };
}
