import type { BundleIndex } from './bundle';
import type { ReportPart, SpecEntry } from './explorer-types';
import type { SourceRecord } from './protocol';

export type LayerParameters = Readonly<Record<string, string>>;
/** What a layer may carry as a whole. All optional and open: see docs/extending.md. */
export type LayerExtras = Partial<Pick<import('../../schema/src/layer').LayerDocument, 'tags' | 'labels' | 'links' | 'attachments' | 'annotations' | 'extensions'>>;

export type LayerSummary = LayerExtras & {
  readonly freshness?: 'unknown' | 'modified';
  readonly id: string;
  readonly recordedAtMs: number;
  readonly producer: string;
  readonly sha: string | null;
  readonly branch: string | null;
  /** The client this layer checked, when it said. Normalized when the layer is read. */
  readonly environment?: string | null;
  readonly runUrl: string | null;
  readonly parameters: LayerParameters;
  readonly specs: readonly SpecEntry[];
  readonly parts: readonly ReportPart[];
  readonly source: SourceRecord | null;
  readonly recording: { readonly type: 'layer' } | { readonly type: 'commit'; readonly sha: string; readonly source: string } | null;
};
export type ReportLayer = LayerSummary & { readonly bundle: BundleIndex };
export type ReportOutline = {
  readonly specs: readonly SpecEntry[];
  readonly sha: string | null;
  readonly changedFiles: readonly string[];
};
