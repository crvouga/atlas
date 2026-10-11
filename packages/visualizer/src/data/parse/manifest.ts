import {
  LATEST_MANIFEST_SCHEMA_VERSION,
  JourneyRecordSchema,
  ManifestChartSchema,
  MapEdgeSchema,
  PathRecordSchema,
  PathStepSchema,
  PrivacySchema,
  ReportsSchema,
  RunInfoSchema,
  RunSummarySchema,
  RunsIndexSchema,
  SeedRecordSchema,
  StateRecordSchema,
  TimelineEntrySchema,
  TransitionRecordSchema,
  transitionId,
  type EventKind,
  type JourneyRecord,
  type PathRecord,
  type SeedRecord,
  type RunInfo,
  type RunSummary,
  type StateRecord,
  type TimelineEntry,
  type TransitionRecord
} from '@crvouga/atlas-schema';
import type { z } from 'zod/v4';

import { createIssueSink, isRecord, parseFields, parseOne, type IssueSink } from './issues';

export type ParsedTransitionRecord = Omit<TransitionRecord, 'timeline'> & { id: string; timeline: TimelineEntry[] };

export type ParsedPath = Omit<PathRecord, 'steps'> & { steps: z.infer<typeof PathStepSchema>[] };

export type ParsedRun = {
  id: string;
  file: string;
  schemaVersion: number;
  info: RunInfo;
  charts: z.infer<typeof ManifestChartSchema>[];
  states: Map<string, StateRecord>;
  transitions: Map<string, ParsedTransitionRecord>;
  paths: ParsedPath[];
  /** Journeys as the run composed them from their seeded stretches. */
  journeys: JourneyRecord[];
  seeds: SeedRecord[];
  mapKinds: Map<string, EventKind>;
  privacy: z.infer<typeof PrivacySchema> | null;
  /** Other formats the run wrote beside its manifest: JUnit XML, CTRF JSON, a Mermaid diagram. */
  reports: z.infer<typeof ReportsSchema> | null;
};

function startedAtFromId(id: string) {
  const m = id.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : new Date(0).toISOString();
}

function parseTimeline(raw: unknown, sink: IssueSink, file: string, path: (string | number)[]) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    sink.add('warning', file, path, 'should be a list of steps.');
    return [];
  }
  const entries: TimelineEntry[] = [];
  raw.forEach((entry, i) => {
    if (isRecord(entry) && typeof entry.kind === 'string' && !TimelineEntrySchema.shape.kind.options.includes(entry.kind as TimelineEntry['kind'])) {
      sink.add('info', file, [...path, i, 'kind'], `"${entry.kind}" is a step type this app doesn't know yet; it is shown as a note.`);
      entry = { ...entry, kind: 'note' };
    }
    const parsed = parseOne(TimelineEntrySchema, entry, sink, file, [...path, i]);
    if (parsed) entries.push(parsed);
  });
  return entries.sort((a, b) => a.atMs - b.atMs);
}

/**
 * One run's manifest, record by record. A broken state, transition or path is reported and
 * dropped; the rest of the run still shows. Unknown fields are ignored.
 */
export function parseManifest(runId: string, file: string, raw: unknown, sink: IssueSink = createIssueSink()): ParsedRun | null {
  if (!isRecord(raw)) {
    sink.add('error', file, [], 'This run file is empty or not in a shape this app understands, so the run is skipped.');
    return null;
  }
  let schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (!schemaVersion) {
    sink.add('warning', file, ['schemaVersion'], `The run doesn't say which format it uses; it is read as format ${LATEST_MANIFEST_SCHEMA_VERSION}.`);
    schemaVersion = LATEST_MANIFEST_SCHEMA_VERSION;
  } else if (schemaVersion > LATEST_MANIFEST_SCHEMA_VERSION) {
    sink.add('info', file, ['schemaVersion'], `This run uses a newer format (${schemaVersion}) than this app knows (${LATEST_MANIFEST_SCHEMA_VERSION}). The parts it recognizes are shown.`);
  }

  let info = RunInfoSchema.safeParse(raw.run).success ? RunInfoSchema.parse(raw.run) : null;
  if (!info) {
    if (raw.run === undefined || raw.run === null) {
      sink.add('warning', file, ['run'], "The run has no details section, so its name, date and type are taken from its folder name.");
    }
    const partial = parseFields(RunInfoSchema.shape, raw.run, sink, file, ['run']);
    info = {
      id: partial.id ?? runId,
      startedAt: partial.startedAt ?? startedAtFromId(runId),
      durationMs: partial.durationMs ?? 0,
      mode: partial.mode ?? (runId.endsWith('showcase') ? 'showcase' : 'fast'),
      specVersion: partial.specVersion ?? 'unknown',
      ...partial
    } as RunInfo;
  }

  const charts = (Array.isArray(raw.charts) ? raw.charts : []).flatMap((c, i) => {
    const parsed = parseOne(ManifestChartSchema, c, sink, file, ['charts', i]);
    return parsed ? [parsed] : [];
  });

  const states = new Map<string, StateRecord>();
  if (raw.states !== undefined && !isRecord(raw.states)) sink.add('warning', file, ['states'], 'should list screens by name.');
  for (const [name, record] of Object.entries(isRecord(raw.states) ? raw.states : {})) {
    const parsed = parseOne(StateRecordSchema, isRecord(record) ? { name, ...record } : record, sink, file, ['states', name]);
    if (parsed) states.set(name, parsed);
  }

  const transitions = new Map<string, ParsedTransitionRecord>();
  if (raw.transitions !== undefined && !isRecord(raw.transitions)) sink.add('warning', file, ['transitions'], 'should list events by name.');
  for (const [key, record] of Object.entries(isRecord(raw.transitions) ? raw.transitions : {})) {
    const { timeline: rawTimeline, ...rest } = isRecord(record) ? record : { value: record };
    const parsed = parseOne(TransitionRecordSchema, isRecord(record) ? rest : record, sink, file, ['transitions', key]);
    if (!parsed) continue;
    const id = parsed.id ?? (key.includes(' :: ') ? key : transitionId(parsed.source, parsed.event));
    transitions.set(id, { ...parsed, id, timeline: parseTimeline(rawTimeline, sink, file, ['transitions', key, 'timeline']) });
  }

  const paths: ParsedPath[] = (Array.isArray(raw.paths) ? raw.paths : []).flatMap((p, i) => {
    const parsed = parseOne(PathRecordSchema, p, sink, file, ['paths', i]);
    if (!parsed) return [];
    const steps = parsed.steps.flatMap((s, j) => {
      const step = parseOne(PathStepSchema, s, sink, file, ['paths', i, 'steps', j]);
      return step ? [step] : [];
    });
    return [{ ...parsed, steps }];
  });

  const mapKinds = new Map<string, EventKind>();
  const edges = isRecord(raw.map) && Array.isArray(raw.map.edges) ? raw.map.edges : [];
  for (const edge of edges) {
    const parsed = MapEdgeSchema.safeParse(edge);
    if (parsed.success) mapKinds.set(parsed.data.id, parsed.data.kind);
  }

  const privacy = raw.privacy === undefined ? null : parseOne(PrivacySchema, raw.privacy, sink, file, ['privacy']);
  const reports = raw.reports === undefined ? null : parseOne(ReportsSchema, raw.reports, sink, file, ['reports']);
  const journeys = (Array.isArray(raw.journeys) ? raw.journeys : []).flatMap((j, i) => {
    const parsed = parseOne(JourneyRecordSchema, j, sink, file, ['journeys', i]);
    return parsed ? [parsed] : [];
  });
  const seeds = (Array.isArray(raw.seeds) ? raw.seeds : []).flatMap((s, i) => {
    const parsed = parseOne(SeedRecordSchema, s, sink, file, ['seeds', i]);
    return parsed ? [parsed] : [];
  });
  return { id: runId, file, schemaVersion, info, charts, states, transitions, paths, journeys, seeds, mapKinds, privacy, reports };
}

export type ParsedRunsIndex = { runs: RunSummary[]; excluded: string[] };

export function parseRunsIndex(file: string, raw: unknown, sink: IssueSink = createIssueSink()): ParsedRunsIndex {
  const index = parseOne(RunsIndexSchema, raw, sink, file, [], 'error');
  if (!index) return { runs: [], excluded: [] };
  const runs = index.runs.flatMap((r, i) => {
    const parsed = parseOne(RunSummarySchema, r, sink, file, ['runs', i]);
    return parsed ? [parsed] : [];
  });
  runs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return { runs, excluded: index.excluded ?? [] };
}
