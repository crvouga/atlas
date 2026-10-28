/**
 * @module Layer types
 *
 * The in-memory shapes of a layer: `LayerSummary` (everything but its captured files), `ReportLayer` (the summary plus
 * the index of those files) and `ReportOutline` (the specs a report is laid over). The stored form is the layer
 * document of `packages/schema/src/layer.ts`; these types are what the reader and publisher code hands around after
 * parsing it. Fields follow the layer document, so adding a field here means adding an optional field there.
 *
 * @see docs/report-contract.md#the-layer-document
 */
import type { LayerRun } from '../../schema/src/layer';
import type { BundleIndex } from './bundle';
import type { ReportPart, SpecEntry } from './explorer-types';
import type { SourceRecord } from './protocol';

/** String choices (such as `{ device: 'iphone-15' }`) that make a result its own slot. Compared as sorted key/value pairs. */
export type LayerParameters = Readonly<Record<string, string>>;
/** What a layer may carry as a whole. All optional and open: see docs/extending.md. */
export type LayerExtras = Partial<Pick<import('../../schema/src/layer').LayerDocument, 'tags' | 'labels' | 'links' | 'attachments' | 'annotations' | 'extensions'>>;

/** A layer without its captured files: what composition and the viewer's lists read. */
export type LayerSummary = LayerExtras & {
  /** `modified`: recorded from a checkout with uncommitted changes. `unknown`: origin not captured. Absent for a clean checkout. Advisory; never changes a status. */
  readonly freshness?: 'unknown' | 'modified';
  /** The layer's content digest: 64 lowercase hex digits. Opaque to readers. Legacy commit-keyed recordings use `part-<sha>-<id>` or `source-<sha>-<id>` instead. */
  readonly id: string;
  /** When the checks ran, epoch milliseconds. The newest completed result wins its slot. */
  readonly recordedAtMs: number;
  /** The stable name of the suite or tool that made the layer. Part of the slot. */
  readonly producer: string;
  /** Provenance: the commit recorded, or `null`. Never part of the slot. */
  readonly sha: string | null;
  /** Provenance: the branch recorded, or `null`. Never part of the slot. */
  readonly branch: string | null;
  /** The client this layer checked, when it said. Normalized when the layer is read. */
  readonly environment?: string | null;
  /** Provenance: the CI run that produced the layer, or `null`. Never part of the slot. */
  readonly runUrl: string | null;
  /** The execution (one invocation of a local or manual run) the layer belongs to, when the producer named one. Grouping and display only; never part of the slot. Absent: the run is told by `runUrl`, else `branch@sha`. */
  readonly run?: LayerRun;
  /** Free choices that make a result its own slot. The `environment` parameter is read as the environment (see `layerPlace`). */
  readonly parameters: LayerParameters;
  /** The specs the layer was recorded against, with fingerprints of their text. */
  readonly specs: readonly SpecEntry[];
  /** The checks, grouped by producer-defined kind. */
  readonly parts: readonly ReportPart[];
  /** The recorded statechart run behind the layer (timelines and tests), or `null` for a layer of plain checks. */
  readonly source: SourceRecord | null;
  /** Where the layer's timelines and captured files are read from: its own bundle (`layer`), an older commit-keyed recording (`commit`), or nowhere (`null`). */
  readonly recording: { readonly type: 'layer' } | { readonly type: 'commit'; readonly sha: string; readonly source: string } | null;
};
/** A layer with the index that locates its captured files (screenshots, frames) in the store. */
export type ReportLayer = LayerSummary & { readonly bundle: BundleIndex };
/** The current specs a report is laid over, and the commit and changes freshness warnings are judged against. */
export type ReportOutline = {
  /** The specs that make the outline of the report. A spec here with no layer shows as having no results. */
  readonly specs: readonly SpecEntry[];
  /** The commit the specs are from, or `null` when unknown. */
  readonly sha: string | null;
  /** Paths changed since the layers were recorded; a result touching one is warned as potentially outdated. */
  readonly changedFiles: readonly string[];
};
