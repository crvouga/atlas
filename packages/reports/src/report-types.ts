/**
 * @module Recorded test timeline types
 *
 * The shapes of a recorded test run as the harness persists it and the viewer renders it: a timeline of steps, each
 * with frames (captured snapshots), plus per-run metadata, the suite and run indexes, and the options of a recording.
 * All times are epoch milliseconds unless a name says otherwise. Mostly types; the few functions are small id helpers
 * that keep ids safe to use as key segments.
 */
import type { Clock } from './clock';
import type { ObjectStore } from './object-store';

/** Observed elapsed work, independent of the simulation clock. */
export type ReportStepPerformance = {
  /** Observed elapsed time of the step, in milliseconds. */
  readonly executionMs: number;
  /** Time attributed to the step's own work, nested steps counted once (see `performanceHotspots`), in milliseconds. */
  readonly selfMs: number;
  /** Time spent capturing snapshots for the step, in milliseconds. */
  readonly snapshotMs: number;
};

/** Timing totals of a whole run. */
export type ReportPerformanceSummary = {
  /** Total observed elapsed work of the run, in milliseconds. */
  readonly executionMs: number;
  /** Part of that spent capturing snapshots, in milliseconds. */
  readonly snapshotMs: number;
  /** How many steps had a measurement. */
  readonly measuredSteps: number;
  /** How many measured steps were over `slowStepMs`. */
  readonly slowSteps: number;
  /** The allowance, in milliseconds, a step's own time is judged against. */
  readonly slowStepMs: number;
};

/** How to measure elapsed work while recording. */
export type ReportPerformanceOptions = {
  /** The monotonic clock to measure with; separate from the simulation clock. */
  readonly clock: Clock;
  /** Diagnostic threshold, not a portable CPU or paint-time assertion. */
  readonly slowStepMs: number;
};

/**
 * How a captured value is encoded on disk and rendered in the report.
 * `png` is a still, `html` is a page snapshot, and `video` is an mp4 of the moment or the whole test.
 * A runner may record any mix. The viewer treats a still, a video, and a timeline of frames as the same kind of evidence.
 */
export type SnapshotMedia = 'json' | 'html' | 'png' | 'text' | 'bytes' | 'video';

/** The outcome of one step. */
export type ReportStepStatus = 'passed' | 'failed';

/** Test outcome after the harness (e.g. the test runner) has weighed in. */
export type ReportTestStatus = 'passed' | 'failed' | 'skipped';

/**
 * One blob produced by a snapshotter at a point in time.
 * Multi-actor UI maps become one entry per nodeId.
 */
export type ReportSnapshotBlob = {
  /** The blob's name as its snapshotter gave it. */
  readonly name: string;
  /** How `file` is encoded. */
  readonly media: SnapshotMedia;
  /** Relative path under the test dir, e.g. `frames/f-00001.html.alice.html`. */
  readonly file: string;
  /** Which client (actor) the blob is of, when the snapshot has one per client. */
  readonly nodeId?: string;
};

/** Discrete visual/state capture within a report step. */
export type ReportFrame = {
  /** The frame's ordinal as the recorder assigned it. */
  readonly index: number;
  /** When it was captured, epoch milliseconds. */
  readonly capturedAtMs: number;
  /** How long the capture took, in milliseconds. */
  readonly durationMs?: number;
  /** The captured blobs, one per snapshotter (and per client). */
  readonly snapshots: readonly ReportSnapshotBlob[];
  /**
   * Gesture target, set only on the frame captured right before a UI step
   * acts (the target is still mounted). Viewers highlight it on this frame.
   */
  readonly hit?: ReportStepHit;
};

/**
 * Where a UI gesture landed — test-id path (chained first-match, as the
 * driver resolves it) + optional tap point relative to the target box.
 * Viewers resolve the path against the snapshot DOM for real geometry.
 */
export type ReportStepHit = {
  /** Chain of `data-testid` values, each looked up inside the previous match. */
  readonly path: readonly string[];
  /** Where in the target box the gesture landed, as fractions from 0 to 1 of its width and height. */
  readonly point?: {
    readonly xRatio: number;
    readonly yRatio: number;
  };
};

/**
 * One labeled entry on the report timeline. Steps nest: an `apply` step
 * holds the UI ops recorded while its action ran.
 */
export type ReportStep = {
  /** The step's ordinal as the recorder assigned it. */
  readonly index: number;
  /** An open category of step. Gherkin keywords (`given`, `when`, `then`, `and`, `but`) mark scenario lines. */
  readonly kind: string;
  /** Human title. */
  readonly title: string;
  readonly status: ReportStepStatus;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  /** `endedAtMs - startedAtMs`, in milliseconds. */
  readonly durationMs: number;
  /** Observed elapsed work, when measurement was on. */
  readonly performance?: ReportStepPerformance;
  /** Which client (actor) took the step, in a multi-client run. */
  readonly actorId?: string;
  /** The UI selector the step acted on. */
  readonly selector?: string;
  readonly detail?: string;
  /** The action performed, when the step is an applied action. */
  readonly action?: string;
  readonly args?: readonly unknown[];
  /** The failure message when `status` is `failed`. */
  readonly error?: string;
  readonly errorStack?: string;
  /** Captures taken during the step. */
  readonly frames: readonly ReportFrame[];
  /** Steps nested in this one. */
  readonly steps: readonly ReportStep[];
};

/** Metadata of one recorded test run. */
export type RunReportMeta = {
  /** The system under test the run exercised. */
  readonly system: string;
  /** The runtime it ran in. */
  readonly runtime: string;
  /** The seed of a randomised run. */
  readonly seed: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  /** `endedAtMs - startedAtMs`, in milliseconds. */
  readonly durationMs: number;
  /** Timing totals, when measurement was on. */
  readonly performance?: ReportPerformanceSummary;
  readonly status: ReportTestStatus;
  /** The run the test belongs to; see `sanitizeRunId`. */
  readonly runId: string;
  /** The test's id within the run; see `sanitizeTestId`. */
  readonly testId: string;
  /** Human title (defaults to `testId`). */
  readonly title: string;
  /** The clients (actors) that took part. */
  readonly actorIds: readonly string[];
  /** Repo-relative path of the test's source file (a spec), when known. */
  readonly sourceFile?: string;
  /** 1-based line of the call that opened this run, when known. */
  readonly sourceLine?: number;
  /** First failure message (step, property, or harness). */
  readonly error?: string;
  /** The stack of that failure. */
  readonly errorStack?: string;
};

/**
 * A file attached to the whole test. A runner that can capture each step puts stills and page
 * snapshots on `steps[].frames` instead, and the viewer builds a timeline from those. This list
 * is for what the runner can attach when it cannot: a video of the test, a few screenshots, a log.
 */
export type ReportArtifact = {
  /** Display name. */
  readonly name: string;
  /** How `file` is encoded. */
  readonly media: SnapshotMedia;
  /** Path of the file relative to the test's directory. */
  readonly file: string;
  /** For a video: path of a still to show before playing. */
  readonly poster?: string;
  /** For a video: path of its captions (WebVTT). */
  readonly captions?: string;
};

/** In-memory / persisted timeline for one test run. */
export type RunReport = {
  readonly meta: RunReportMeta;
  /** The top-level steps, in order; nested steps hang off each. */
  readonly steps: readonly ReportStep[];
  /** Whole-test files, for runners that cannot capture per step. */
  readonly artifacts?: readonly ReportArtifact[];
};

/** One test as a suite manifest lists it: the metadata without the timeline. */
export type SuiteTestSummary = {
  readonly testId: string;
  readonly title: string;
  readonly seed: string;
  readonly status: ReportTestStatus;
  readonly durationMs: number;
  /** How many steps the test recorded. */
  readonly stepCount: number;
  /** How many frames the test captured. */
  readonly frameCount: number;
  readonly system: string;
  readonly runtime: string;
  readonly sourceFile?: string;
  readonly error?: string;
};

/** A listing of a suite's tests, with the time it was last written. */
export type SuiteManifest = {
  readonly tests: readonly SuiteTestSummary[];
  /** When the listing was last written, epoch milliseconds. */
  readonly updatedAtMs: number;
};

/** One run as `runs/index.json` lists it. */
export type RunSummary = {
  /** The run id; see `sanitizeRunId`. */
  readonly id: string;
  /** When the run was last updated, epoch milliseconds. */
  readonly updatedAtMs: number;
  /** The run's overall outcome. */
  readonly status: ReportTestStatus;
  readonly testCount: number;
  readonly frameCount: number;
};

/** The index of the runs in a report bucket (stored at `runs/index.json`). */
export type RunsIndex = {
  readonly runs: readonly RunSummary[];
};

/** Metadata for an open `run.record(...)` call. */
export type RecordStepMeta = {
  readonly kind: string;
  readonly title: string;
  readonly actorId?: string;
  readonly selector?: string;
  readonly detail?: string;
  /** Press / gesture target; persisted onto the step's pre-action frame. */
  readonly hit?: ReportStepHit;
  /** Capture snapshots before `fn` (e.g. before close unmounts). */
  readonly snapshotBefore?: boolean;
  /** Skip registered snapshotters for this step. */
  readonly skipSnapshot?: boolean;
};

/** When a recording auto-opens a report step: on each applied action (`apply`) or never (`none`). */
export type ReportCaptureMode = 'apply' | 'none';

/** Options that turn on and shape the recording of a test run. */
export type RunReportOptions = {
  /** Enable elapsed work measurement with a separate monotonic clock. */
  readonly performance?: ReportPerformanceOptions;
  /** When false, reporting is disabled even if options object is passed. */
  readonly enabled?: boolean;
  /** Object store for this report bucket (required for persistence). */
  readonly store?: ObjectStore;
  /**
   * Run id under `runs/<runId>/`. Default: `YYYYMMDDTHHmmss` UTC from `now`.
   */
  readonly runId?: string;
  /**
   * Stable id for this test under the run (`tests/<testId>/`).
   * Default: sanitized system name.
   */
  readonly testId?: string;
  /** Human title shown in reports. Default: `testId`. */
  readonly title?: string;
  /**
   * Epoch-ms clock for step timestamps. Default: session clock.
   */
  readonly now?: () => number;
  /**
   * When to auto-open a report step. Default `apply` (each `s.apply`).
   * `advanceTime` never opens a step (avoids poll spam).
   */
  readonly capture?: ReportCaptureMode;
  /**
   * Capture the registered snapshotters (UI frames, state) onto each step.
   * Default true. False keeps the timeline — every step, its outcome and
   * error — without the frames, which are what make a report expensive.
   */
  readonly frames?: boolean;
  /** Repo-relative path to the test source file when known. */
  readonly sourceFile?: string;
  /** 1-based source line of the call that opened the run, when known. */
  readonly sourceLine?: number;
};

/** Makes a test id safe as a key segment: runs of characters outside `A-Za-z0-9._-` become one `_`, leading and trailing `_` are trimmed, and an empty result is `test`. */
export function sanitizeTestId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'test';
}

/** Makes a run id safe as a key segment: runs of characters outside `A-Za-z0-9._-` become one `_`, leading and trailing `_` are trimmed, and an empty result is `run`. */
export function sanitizeRunId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'run';
}

/** Mint `YYYYMMDDTHHmmss` UTC from epoch ms. */
export function mintRunId(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${day}T${h}${mi}${s}`;
}

/** Normalises the `report` option of a test: `undefined` or `false` is `null` (reporting off), `true` is `{ enabled: true }`, an options object with `enabled: false` is `null`, and any other object is returned with `enabled: true`. */
export function resolveReportOptions(
  report: boolean | RunReportOptions | undefined
): RunReportOptions | null {
  if (report === undefined || report === false) return null;
  if (report === true) return { enabled: true };
  if (report.enabled === false) return null;
  const { enabled: _enabled, ...rest } = report;
  return { enabled: true, ...rest };
}
