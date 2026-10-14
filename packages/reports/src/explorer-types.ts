/** Commit-scoped definitions and independently produced evidence. */
export type SpecEntry = {
  readonly path: string;
  readonly domain: string;
  readonly kind: string;
  readonly title: string;
  readonly fingerprint?: string;
};

export type SpecInventory = {
  readonly sha: string;
  readonly entries: readonly SpecEntry[];
};

export type EvidenceStatus = 'passed' | 'failed' | 'running' | 'not-run';

export type EvidenceMeasurement = {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly limit?: number;
};

/** What a check may carry beyond its outcome. All optional and open: see docs/extending.md. */
export type EvidenceExtras = Partial<Pick<import('../../schema/src/layer').Check, 'tags' | 'labels' | 'links' | 'steps' | 'attachments' | 'annotations' | 'attempts' | 'extensions'>>;

export type EvidenceCheck = EvidenceExtras & {
  readonly id: string;
  readonly title: string;
  readonly status: EvidenceStatus;
  readonly detail: string;
  readonly specPath?: string;
  readonly measurements: readonly EvidenceMeasurement[];
  /** How long the check took, when the producer measured it. */
  readonly durationMs?: number;
};

/** `kind` is an open producer key; new parts need no protocol change. */
export type ReportPart = EvidenceExtras & {
  readonly freshness?: 'unknown' | 'modified';
  readonly parameters?: Readonly<Record<string, string>>;
  readonly sha: string;
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly recordedAtMs: number;
  readonly checks: readonly EvidenceCheck[];
};
export type ReportPartOutput = Pick<ReportPart, 'kind' | 'title' | 'checks'>;

export type ExplorerData = {
  readonly inventory: SpecInventory | null;
  readonly parts: readonly ReportPart[];
  readonly notice?: string;
};

export type WorkspaceVersion = {
  readonly sha: string;
  readonly branch: string;
  readonly dirty: boolean;
};

/** Only composition roots provide checkout content; it is never CI evidence. */
export type WorkspaceReports = {
  readonly version: WorkspaceVersion;
  readonly inventory: SpecInventory;
  readonly parts: readonly ReportPart[];
  readonly readSpec: (path: string) => Promise<string | null>;
};
