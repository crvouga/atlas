/**
 * @module Report evidence types
 *
 * The shapes the report API and the viewer exchange about layers: a layer's header (origin and totals), its rows
 * (one per check), the backends that contributed, runs in progress, and the address of a recorded test's
 * timeline. These are the wire shapes of `/api/reports/*`, so within a version they only gain optional fields.
 * Also holds {@link recordingPaths}, the one place the URL layout of a recording is defined.
 *
 * @see docs/report-contract.md
 */
import type { EvidenceMeasurement, EvidenceStatus } from './explorer-types';
import type { EvidenceScope, LayerRun } from '../../schema/src/layer';
import type { LayerParameters } from './layer-types';

/** Where a recorded test's timeline and captured files are read from. */
export type RecordingAddress =
  | { readonly type: 'layer'; readonly layer: string }
  | { readonly type: 'commit'; readonly sha: string; readonly source: string }
  | { readonly type: 'live'; readonly source: string };

/** One store that contributes report layers. */
export type BackendInfo = {
  /** Stable backend id (lowercase letters, digits, hyphens); names where a result came from. */
  readonly id: string;
  /** What a person sees for the backend. */
  readonly label: string;
  /** Spec runs on this machine write here while they are still running. */
  readonly live: boolean;
  /** False when the backend could not be read; a notice says why, and its results are unknown, not passed. */
  readonly available: boolean;
};

/** How many results have each status (`passed`, `failed`, `running`, `not-run`). */
export type StatusCounts = Readonly<Record<EvidenceStatus, number>>;

/** Who holds a recording: the whole layer (or one of its parts), one check, one retry attempt of a check, or one step. */
export type VideoOwner = 'layer' | 'check' | 'attempt' | 'step';

/**
 * One reference to a video, found by its effective media type (the producer's `contentType`, else the one the file
 * name implies; a `video` role alone counts only when nothing else says what the file is). A reference is not a
 * recording: the same bytes referenced from three checks are three references and one recording.
 */
export type VideoRef = {
  /** The attachment's name, for a person. */
  readonly name: string;
  readonly owner: VideoOwner;
  /** The try that holds it, when `owner` is `attempt` or the step is inside one. */
  readonly attempt?: number;
  /** The name of the step that holds it, when `owner` is `step`. */
  readonly step?: string;
  /** The normalized tags of this attachment itself (`demo`), so a query can ask for a tagged video rather than a result that has a video and some tagged file. Absent when it has none (and in documents of older servers). */
  readonly tags?: readonly string[];
  /** What identifies the bytes (digest, bundle key or address); references with the same one are the same recording. Absent when `available` is false. */
  readonly recording?: string;
  /** False when the reference names no bytes at all (no bundle key, address or inline text), so it can never be played. */
  readonly available: boolean;
  /** What this recording shows, as declared for it: its own `scope`, else its attempt's, check's, part's or layer's. Absent when none declared one: its scope is unknown, not live, physical or audible. */
  readonly scope?: EvidenceScope;
};

/** Video availability as counts: references, distinct playable recordings (deduplicated), and references that cannot be played. */
export type VideoCounts = {
  /** Every reference to a video, playable or not. */
  readonly references: number;
  /** Distinct playable recordings: identical bytes referenced twice are one. */
  readonly recordings: number;
  /** References that name no bytes. A report that predates availability metadata has none of these and none of the others. */
  readonly unavailable: number;
};

/**
 * What a result (or a run) carries beyond its outcome, as counts and short facts: attachments, steps,
 * annotations, retries, tags, labels, links. It is only there when there is something. The evidence itself
 * is read when someone opens the result.
 */
export type EvidenceSummary = {
  /** Attachments on the result, including those on its steps and attempts. */
  readonly attachments: number;
  readonly steps: number;
  readonly annotations: number;
  /** How many tries were recorded when the check was retried. */
  readonly attempts: number;
  /** The status of each recorded try, in the order they were made (its length is `attempts`). Absent when no try was recorded, and in reports written before this was recorded: a first try is then unknown, never assumed to have passed. */
  readonly attemptStatuses?: readonly EvidenceStatus[];
  readonly links: number;
  readonly tags: readonly string[];
  /** The normalized tags of the attachments themselves (`#demo` is `demo`), sorted and distinct. Absent when no attachment is tagged. Unlike `tags` they are never inherited from a check or run. */
  readonly artifactTags?: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  /** The distinct roles of its attachments (or what their media types say), to show what kind of evidence there is. */
  readonly roles: readonly string[];
  /** Its references to videos, wherever they are held (layer, check, attempt, step). Only there when it has any. */
  readonly videos?: readonly VideoRef[];
};

/** A report layer's origin and totals. Its checks are read separately, once. */
export type LayerHeader = {
  /** The layer's id: 64 hex digits for an archived layer, `live-<source>` for a live one. */
  readonly id: string;
  /** The id of the backend it was read from (the one whose id sorts first when several hold it). */
  readonly backend: string;
  /** The suite or tool that made it. Part of the slot. */
  readonly producer: string;
  /** The package directory of a spec run, when the layer came from one. */
  readonly packageDir: string | null;
  /** When the checks ran, epoch milliseconds; the newest completed result wins its slot. */
  readonly recordedAtMs: number;
  /** Provenance: the commit it was recorded at. Never part of the slot. */
  readonly sha: string | null;
  /** Provenance: the branch it was recorded on. Never part of the slot. */
  readonly branch: string | null;
  /** The client this layer checked. Null when the layer did not say. */
  readonly environment: string | null;
  /** Provenance: the CI run that made it. */
  readonly runUrl: string | null;
  /** Other string choices that make a result its own slot. */
  readonly parameters: LayerParameters;
  /** `modified`: recorded from a checkout with uncommitted changes; `unknown`: origin not captured; absent: clean. Advisory; never changes a status. */
  readonly freshness?: 'unknown' | 'modified';
  /** The execution the producer named for it (one local or manual invocation), or absent. Grouping and display only; never part of the slot. */
  readonly run?: LayerRun;
  /** Where this layer's recorded timelines and captured files are read from, or null when it has none. */
  readonly recording: RecordingAddress | null;
  /** From a spec run that has not been collected into a layer yet. */
  readonly live: boolean;
  /** Its checks by status. Parts of kind `performance` are not counted when anything else was recorded. */
  readonly counts: StatusCounts;
  /** Equal for the mutable and the archived address of one execution. */
  readonly execution: string;
  /** What the run as a whole carries: its logs, links and labels. */
  readonly evidence?: EvidenceSummary;
  /** Counts from the layer's recording receipt: how many expected recordings were published. Absent when the layer declared no expectations: its completeness is unknown, not complete. Never changes a status. */
  readonly recordings?: RecordingCounts;
};

/** How many recordings a layer expected and what became of them (see `RecordingReceipt`). */
export type RecordingCounts = {
  /** Checks that required a recording: `uploaded + referenced + skipped + unresolved`. */
  readonly expected: number;
  /** Stored in the layer, with a checksum. */
  readonly uploaded: number;
  /** Given only by `uri`: Atlas cannot vouch for it. */
  readonly referenced: number;
  /** Captured but left out, with a reason (too large, not allowed…). */
  readonly skipped: number;
  /** No video was attached at all. */
  readonly unresolved: number;
  /** Intentionally unrecorded checks: neither expected nor missing. */
  readonly notApplicable: number;
};

/** One check of one report part. */
export type LayerRow = {
  /** The kind of the part holding the check (`behavior`, `performance`, ...). Part of the slot. */
  readonly kind: string;
  /** The check's stable id. Part of the slot. */
  readonly id: string;
  readonly title: string;
  readonly status: EvidenceStatus;
  /** The spec the check belongs to (`specs/<path>`), or null. */
  readonly specPath: string | null;
  /** Why it has this status, for a person; empty when there is nothing to add. */
  readonly detail: string;
  readonly measurements: readonly EvidenceMeasurement[];
  /** The recorded test behind this check, when it has a timeline to open. */
  readonly testId: string | null;
  /** What distinguishes this recorded test from another run of the same check. */
  readonly variant: LayerParameters;
  /** How long the check took, milliseconds, or null when unknown. */
  readonly durationMs: number | null;
  /** What this result carries beyond its outcome. Absent when nothing. */
  readonly evidence?: EvidenceSummary;
  /** What became of this check's expected recording: `uploaded`, `referenced`, `skipped`, `unresolved` or `not-applicable`, with a reason when it is not uploaded. Absent when the check declared no expectation. Independent of `status`. */
  readonly recording?: { readonly state: string; readonly reason?: string };
};

/** The checks of one layer, read separately from its header. */
export type LayerRows = {
  /** The layer's id. */
  readonly id: string;
  readonly rows: readonly LayerRow[];
  /** Spec path to the fingerprint the layer recorded for it. */
  readonly fingerprints: Readonly<Record<string, string>>;
};

/** A layer's rows together with its header: everything composition needs to lay the layer over the specs. */
export type LayerEvidence = LayerRows & { readonly layer: LayerHeader };

/** A spec run that is writing results right now. */
export type ActiveRun = {
  readonly source: string;
  readonly packageDir: string;
  readonly bucket: string;
  readonly startedAtMs: number;
  /** Spec files the run planned, when the producer recorded it. */
  readonly plannedChecks?: number;
  /** Checks finished so far: passed, failed or not-run. */
  readonly completed: number;
  /** Of those, how many failed. */
  readonly failed: number;
};

/** One page of the layer listing the viewer reads. */
export type EvidencePage = {
  /** The layers on this page, newest first. */
  readonly layers: readonly LayerHeader[];
  /** Opaque token for the next page, or null at the end. */
  readonly cursor: string | null;
  /** What could not be read; a gate treats any as unknown, never as a pass. */
  readonly notices: readonly string[];
  readonly backends: readonly BackendInfo[];
  /** Runs writing results right now. */
  readonly active: readonly ActiveRun[];
};

/**
 * The report API paths (relative to the reports API root) of one recorded test: its `report` JSON, a `file(path)`
 * builder for its captured files (each path segment is URL-encoded), and the `css` its snapshots render with.
 * The layout depends on where the recording lives: an archived layer, a commit (the older layout) or a live run.
 */
export function recordingPaths(address: RecordingAddress, testId: string) {
  const test = encodeURIComponent(testId);
  const file = (base: string) => (path: string) =>
    `${base}/files/${path.split('/').map(encodeURIComponent).join('/')}`;
  if (address.type === 'layer') {
    const base = `/layers/${address.layer}/tests/${test}`;
    return { report: `${base}/report.json`, file: file(base), css: `/layers/${address.layer}/frame.css` };
  }
  if (address.type === 'live') {
    const base = `/live/${encodeURIComponent(address.source)}/tests/${test}`;
    return { report: `${base}/report.json`, file: file(base), css: `/live/${encodeURIComponent(address.source)}/frame.css` };
  }
  const base = `/${address.sha}/tests/${encodeURIComponent(address.source)}/${test}`;
  return { report: base, file: file(base), css: `/${address.sha}/frame.css` };
}
