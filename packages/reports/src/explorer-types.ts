/**
 * @module Explorer data types
 *
 * The plain shapes the reports explorer shares between the store readers, the API routes and the viewer: a spec
 * entry, a commit's spec inventory, the four result statuses, measurements, checks and parts. They are types only
 * and carry no behaviour. The vocabulary matches the layer document (`docs/report-contract.md`): `status` is the
 * closed set of four, everything else about a check is open.
 */

/** Commit-scoped definitions and independently produced evidence. One spec of the outline a report is laid over. */
export type SpecEntry = {
  /** `specs/<path inside the specs directory>`. The `specPath` a check uses to say which spec it belongs to. */
  readonly path: string;
  /** Groups specs in the viewer (by default the project's folder name). */
  readonly domain: string;
  /** The notation: `gherkin`, `quint`, `dmn`, `alloy`, `openslo`, a file extension, or `document`. An open vocabulary. */
  readonly kind: string;
  readonly title: string;
  /** A fingerprint of the spec's text, so a reader can warn when a spec changed since a layer recorded it. Opaque. */
  readonly fingerprint?: string;
};

/** The specs of one commit. */
export type SpecInventory = {
  /** The 40-hex-digit commit. */
  readonly sha: string;
  readonly entries: readonly SpecEntry[];
};

/** The four result statuses. The only closed vocabulary in the format: `not-run` is never a pass and `running` is not done. */
export type EvidenceStatus = 'passed' | 'failed' | 'running' | 'not-run';

/** A number a check recorded. Exceeding `limit` is shown and never fails the check by itself. */
export type EvidenceMeasurement = {
  readonly name: string;
  readonly value: number;
  /** The unit of `value` and `limit`, such as `ms`. */
  readonly unit: string;
  /** The allowance for `value`, in the same unit, when there is one. */
  readonly limit?: number;
};

/** What a check may carry beyond its outcome. All optional and open: see docs/extending.md. */
export type EvidenceExtras = Partial<Pick<import('../../schema/src/layer').Check, 'tags' | 'labels' | 'links' | 'steps' | 'attachments' | 'annotations' | 'attempts' | 'extensions'>>;

/** One check of a part, as recorded. */
export type EvidenceCheck = EvidenceExtras & {
  /** Stable across runs; the newer result replaces the older one only if both used the same id. */
  readonly id: string;
  readonly title: string;
  readonly status: EvidenceStatus;
  /** Why the check has this status, for a person. */
  readonly detail: string;
  /** The spec the check belongs to, as `specs/<path>`. */
  readonly specPath?: string;
  readonly measurements: readonly EvidenceMeasurement[];
  /** How long the check took, when the producer measured it. */
  readonly durationMs?: number;
};

/** `kind` is an open producer key; new parts need no protocol change. */
export type ReportPart = EvidenceExtras & {
  /** `modified`: recorded from a checkout with uncommitted changes; `unknown`: origin not captured. Advisory; never changes a status. */
  readonly freshness?: 'unknown' | 'modified';
  /** String choices that make a result its own slot (a device, a seed). */
  readonly parameters?: Readonly<Record<string, string>>;
  /** The commit the part was recorded at. */
  readonly sha: string;
  /** The part's id; when the part is published it is the `producer` of the layer made from it. */
  readonly id: string;
  /** Open category (`behavior`, `performance`, ...); part of the slot. */
  readonly kind: string;
  readonly title: string;
  /** When the checks ran, epoch milliseconds. */
  readonly recordedAtMs: number;
  readonly checks: readonly EvidenceCheck[];
};
/** The part of a {@link ReportPart} that a spec run's evidence file carries: its `kind`, `title` and `checks`. */
export type ReportPartOutput = Pick<ReportPart, 'kind' | 'title' | 'checks'>;

/** What the explorer shows for one commit: its specs (or null when none were recorded) and the parts recorded against it. */
export type ExplorerData = {
  readonly inventory: SpecInventory | null;
  readonly parts: readonly ReportPart[];
  /** A message to show instead of data, when something could not be read. */
  readonly notice?: string;
};

/** The checkout a workspace reads from. */
export type WorkspaceVersion = {
  readonly sha: string;
  readonly branch: string;
  /** True when the checkout has uncommitted changes. */
  readonly dirty: boolean;
};

/** Only composition roots provide checkout content; it is never CI evidence. */
export type WorkspaceReports = {
  readonly version: WorkspaceVersion;
  readonly inventory: SpecInventory;
  readonly parts: readonly ReportPart[];
  readonly readSpec: (path: string) => Promise<string | null>;
};
