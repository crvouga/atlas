import type { EvidenceMeasurement, EvidenceStatus } from './explorer-types';
import type { LayerParameters } from './layer-types';

/** Where a recorded test's timeline and captured files are read from. */
export type RecordingAddress =
  | { readonly type: 'layer'; readonly layer: string }
  | { readonly type: 'commit'; readonly sha: string; readonly source: string }
  | { readonly type: 'live'; readonly source: string };

/** One store that contributes report layers. */
export type BackendInfo = {
  readonly id: string;
  readonly label: string;
  /** Spec runs on this machine write here while they are still running. */
  readonly live: boolean;
  readonly available: boolean;
};

export type StatusCounts = Readonly<Record<EvidenceStatus, number>>;

/** A report layer's origin and totals. Its checks are read separately, once. */
export type LayerHeader = {
  readonly id: string;
  readonly backend: string;
  readonly producer: string;
  readonly packageDir: string | null;
  readonly recordedAtMs: number;
  readonly sha: string | null;
  readonly branch: string | null;
  /** The client this layer checked. Null when the layer did not say. */
  readonly environment: string | null;
  readonly runUrl: string | null;
  readonly parameters: LayerParameters;
  readonly freshness?: 'unknown' | 'modified';
  readonly recording: RecordingAddress | null;
  /** From a spec run that has not been collected into a layer yet. */
  readonly live: boolean;
  readonly counts: StatusCounts;
  /** Equal for the mutable and the archived address of one execution. */
  readonly execution: string;
};

/** One check of one report part. */
export type LayerRow = {
  readonly kind: string;
  readonly id: string;
  readonly title: string;
  readonly status: EvidenceStatus;
  readonly specPath: string | null;
  readonly detail: string;
  readonly measurements: readonly EvidenceMeasurement[];
  /** The recorded test behind this check, when it has a timeline to open. */
  readonly testId: string | null;
  /** What distinguishes this recorded test from another run of the same check. */
  readonly variant: LayerParameters;
  readonly durationMs: number | null;
};

export type LayerRows = {
  readonly id: string;
  readonly rows: readonly LayerRow[];
  /** Spec path to the fingerprint the layer recorded for it. */
  readonly fingerprints: Readonly<Record<string, string>>;
};

export type LayerEvidence = LayerRows & { readonly layer: LayerHeader };

/** A spec run that is writing results right now. */
export type ActiveRun = {
  readonly source: string;
  readonly packageDir: string;
  readonly bucket: string;
  readonly startedAtMs: number;
  /** Spec files the run planned, when the producer recorded it. */
  readonly plannedChecks?: number;
  readonly completed: number;
  readonly failed: number;
};

export type EvidencePage = {
  readonly layers: readonly LayerHeader[];
  readonly cursor: string | null;
  readonly notices: readonly string[];
  readonly backends: readonly BackendInfo[];
  readonly active: readonly ActiveRun[];
};

/** The report API paths of one recorded test. */
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
