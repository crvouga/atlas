import type {
  BusinessEvents,
  BusinessContract,
  CheckResult,
  Confidence,
  DataIssue,
  DesignLink,
  EventKind,
  LayoutFile,
  RunInfo,
  RunStatus,
  RunSummary,
  StateType,
  TimelineEntry
} from '@crvouga/atlas-schema';
import type { ChartSimulation } from './simulation';

export const ITEM_STATUSES = ['passed', 'flaky', 'failed', 'not-reached', 'not-yet-run', 'spec-only'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export type StatusCounts = Record<ItemStatus, number> & { total: number };

/** Where an item stands against a second spec version laid over this one. Always `same` today. */
export type SpecChange = 'same' | 'added' | 'removed' | 'changed';

export type MediaState = 'available' | 'missing' | 'processing';

export type ImageMedia = { state: MediaState; thumb: string | null; full: string | null };

export type VideoMedia = {
  state: MediaState;
  src: string | null;
  poster: string | null;
  durationMs: number | null;
  captions: string | null;
};

export type StateKind = 'screen' | 'final' | 'group' | 'parallel' | 'region' | 'chart-link';

export type QuestionView = {
  id: string;
  number: number;
  section: string;
  title: string;
  body: string;
  specToday: string | null;
  file: string;
  states: string[];
  transitions: string[];
};

export type NoteView = { title: string; body: string; file: string };

export type PathRef = { id: string; name: string };

export type StateResult = {
  runId: string;
  status: RunStatus;
  screenshot: ImageMedia;
  screenshotsByPath: { path: PathRef; image: ImageMedia }[];
  checks: CheckResult[];
  /** Expected, observed and missing business events, with the CloudEvents seen when the run had a source. */
  businessEvents: BusinessEvents | null;
  reachedBy: PathRef[];
  notes: string[];
  looksLike: string[];
  recognizer: { matched: boolean; signals: { signal: string; expected: string; visible: boolean }[] } | null;
  /** Seeds that start paths with this screen showing. */
  seeds: string[];
};

export type StateView = {
  key: string;
  name: string;
  chartId: string;
  contextId: string;
  file: string;
  parent: string | null;
  children: string[];
  depth: number;
  type: StateType;
  kind: StateKind;
  initial: string | null;
  description: string;
  snapshot: string | null;
  confidence: Confidence | null;
  sources: string[];
  owner: string | null;
  tier: string | null;
  quint: string | null;
  gherkin: string[];
  contracts: BusinessContract[];
  design: DesignLink | null;
  hints: string[];
  specChecks: string[];
  specBusinessEvents: string[];
  deadEnd: string | null;
  childChartId: string | null;
  incoming: string[];
  outgoing: string[];
  questionIds: string[];
  knownIssues: NoteView[];
  status: ItemStatus;
  result: StateResult | null;
  change: SpecChange;
};

export type EventKindSource = 'spec' | 'structure' | 'run' | 'guess';

export type TransitionResult = {
  runId: string;
  status: RunStatus;
  how: string | null;
  reason: string | null;
  clip: VideoMedia;
  timeline: TimelineEntry[];
  reachedBy: PathRef[];
};

export type TransitionView = {
  id: string;
  chartId: string;
  source: string;
  target: string | null;
  event: string;
  kind: EventKind;
  kindSource: EventKindSource;
  timeSpan: string | null;
  handOff: boolean;
  carriedBy: string | null;
  questionIds: string[];
  knownIssues: NoteView[];
  status: ItemStatus;
  result: TransitionResult | null;
  change: SpecChange;
};

export type JourneyStep = {
  index: number;
  event: string;
  transitionIds: string[];
  handOff: boolean;
  from: string[];
  to: string[];
};

export type JourneyRunPath = {
  id: string;
  name: string;
  /** The seed the stretch started from; null when it started at the beginning. */
  seed: string | null;
  status: RunStatus;
  progress: 'queued' | 'running' | 'complete';
  stoppedAt: string | null;
  error: string | null;
  steps: { transition: string | null; event: string; status: RunStatus | null; reason: string | null }[];
};

export type JourneyView = {
  id: string;
  name: string;
  description: string;
  file: string;
  chartIds: string[];
  owner: string | null;
  tour: boolean;
  events: string[];
  endsIn: string[];
  steps: JourneyStep[];
  replay: { ok: boolean; failedAt: string | null; missingEnds: string[] };
  status: ItemStatus;
  runPaths: JourneyRunPath[];
};

export type ChartView = {
  id: string;
  name: string;
  file: string;
  dir: string;
  contextId: string;
  description: string;
  contracts: BusinessContract[];
  parent: { chartId: string; state: string } | null;
  childChartIds: string[];
  initial: string | null;
  rootStates: string[];
  states: string[];
  transitions: string[];
  journeyIds: string[];
  layout: LayoutFile | null;
  screens: StatusCounts;
  events: StatusCounts;
  /** Changes only when states, nesting or transitions change, never when results do. */
  structureKey: string;
};

export type ContextView = {
  id: string;
  name: string;
  description: string;
  owner: string | null;
  chartIds: string[];
  topChartIds: string[];
  screens: StatusCounts;
  events: StatusCounts;
  journeys: StatusCounts;
};

export type HandOffView = {
  from: string;
  to: string;
  event: string;
  description: string;
  fromContext: string;
  toContext: string;
  fromState: string | null;
  toState: string | null;
};

export type RunReport = { label: string; url: string };

export type RunView = {
  id: string;
  info: RunInfo;
  progress: 'running' | 'complete';
  privacyPassed: boolean | null;
  outOfDate: boolean;
  /** Links to the other formats the run wrote: JUnit, CTRF, Mermaid. */
  reports: RunReport[];
  paths: {
    id: string;
    name: string;
    kind: 'journey' | 'generated';
    status: ItemStatus;
    progress: 'queued' | 'running' | 'complete';
    steps: number;
    seed: string | null;
    durationMs: number | null;
    error: string | null;
    stoppedAt: string | null;
    traces: RunReport[];
  }[];
};

export type RemovedState = {
  name: string;
  chartId: string | null;
  status: RunStatus;
  screenshot: ImageMedia;
  description: string;
};

export type RemovedTransition = {
  id: string;
  source: string;
  event: string;
  target: string | null;
  status: RunStatus;
};

export type AtlasView = {
  simulation: (chartId: string) => ChartSimulation;
  title: string;
  description: string;
  ref: string | null;
  mode: 'spec-only' | 'run';
  contexts: ContextView[];
  charts: Map<string, ChartView>;
  states: Map<string, StateView>;
  transitions: Map<string, TransitionView>;
  journeys: JourneyView[];
  questions: Map<string, QuestionView>;
  excluded: string[];
  handOffs: HandOffView[];
  run: RunView | null;
  runs: RunSummary[];
  removed: { states: RemovedState[]; transitions: RemovedTransition[] };
  totals: { screens: StatusCounts; events: StatusCounts; journeys: StatusCounts };
  issues: DataIssue[];
};
