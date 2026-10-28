/**
 * @module Publishing checks as a layer
 *
 * `publishChecks` turns the checks of one producer into one immutable layer in any store: the whole integration for a suite
 * that has no timeline to record. Attachments of any kind are stored by content (the same screenshot attached ten times is
 * stored once). Nothing here reads a clock or the environment, so the same input is always the same layer and a retried CI
 * step changes nothing.
 *
 * @see docs/integrating.md
 * @see docs/extending.md
 */

import { PublishChecksSchema, type Attachment, type PublishChecksInput } from '../../schema/src/layer';
import { writeBundle, type BundleEntry } from './bundle';
import type { ReportPart } from './explorer-types';
import { normalizeEnvironment } from './layer-axes';
import { publishLayerBundle } from './layer-store';
import type { LayerSummary, ReportLayer } from './layer-types';
import { contentTypeOf } from './media-types';
import type { ObjectStore } from './object-store';
import { parseWith } from './parse-with';
import { sha256Hex } from './sigv4';

/** Limits that protect the machine publishing: the largest single attachment, and the most attachment bytes in one layer (they are held in memory while stored). */
export type PublishChecksOptions = {
  /** Refuse a single attachment larger than this many bytes. Default 512 MiB. */
  readonly maxAttachmentBytes?: number;
  /** Refuse a layer whose attachments together are larger than this, because they are held in memory while stored. Default 2 GiB. */
  readonly maxTotalAttachmentBytes?: number;
};

/** A small text value stays in the layer's own document; anything longer is stored as a file. */
const INLINE_TEXT_BYTES = 8 * 1024;
const encoder = new TextEncoder();

type Loose = Record<string, unknown>;

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

/**
 * Move the bytes of every attachment, at every level, into the layer: a file by its content (so the same
 * screenshot attached ten times is stored once), referred to by `bundleKey`. What a producer wrote as `data`,
 * `base64` or a long `text` becomes a reference; a short `text` stays inline; a `uri` is left alone.
 */
async function materialize(holder: Loose, entries: Map<string, BundleEntry>, limit: number): Promise<Loose> {
  const out: Loose = { ...holder };
  if (Array.isArray(out.attachments)) {
    out.attachments = await Promise.all((out.attachments as Loose[]).map(async (given): Promise<Attachment> => {
      const { path: file, base64, data, ...kept } = given as Loose & { path?: string; base64?: string; data?: Uint8Array };
      if (file !== undefined) throw new Error(`publishChecks: attachment "${String(kept.name)}" names a file (path). Reading files is the command line's job: read it and pass its bytes as data`);
      const text = typeof kept.text === 'string' ? kept.text : undefined;
      let bytes: Uint8Array | null = data ?? (base64 === undefined ? null : decodeBase64(base64));
      if (!bytes && text !== undefined && encoder.encode(text).length > INLINE_TEXT_BYTES) bytes = encoder.encode(text);
      if (!bytes) return { ...(kept as Attachment), ...(text !== undefined ? { bytes: encoder.encode(text).length } : {}) };
      if (bytes.length > limit) throw new Error(`publishChecks: attachment "${String(kept.name)}" is ${bytes.length} bytes, over the limit of ${limit}. Store it elsewhere and attach its uri`);
      const sha256 = await sha256Hex(bytes);
      const contentType = (kept.contentType as string | undefined) ?? contentTypeOf(String(kept.name));
      entries.set(`attachments/${sha256}`, { key: `attachments/${sha256}`, bytes, contentType });
      const { text: _inline, ...rest } = kept;
      return { ...(rest as Attachment), contentType, bundleKey: `attachments/${sha256}`, bytes: bytes.length, sha256 };
    }));
  }
  if (Array.isArray(out.steps)) out.steps = await Promise.all((out.steps as Loose[]).map(step => materialize(step, entries, limit)));
  if (Array.isArray(out.attempts)) out.attempts = await Promise.all((out.attempts as Loose[]).map(attempt => materialize(attempt, entries, limit)));
  return out;
}

/**
 * Publish the checks of one producer as one immutable layer. This is the whole integration for a
 * suite that has no timelines to record: Gherkin scenarios, a Quint run, a DMN table test, an SLO
 * evaluation, a linter, anything that ends in "this check passed or failed".
 *
 * A check may carry whatever evidence its framework has: attachments of any media type (screenshots,
 * videos, traces, logs, DOM snapshots…), timeline steps, annotations, retries, tags, labels, links and
 * namespaced `extensions`. All of it is optional (docs/extending.md).
 *
 * Nothing here reads a clock: `recordedAtMs` is when the checks ran, given by the caller. Publishing
 * the same input twice therefore writes the same layer, and a retried CI step changes nothing.
 * Each check's `id` is its identity across runs. It must be stable and unique within the layer.
 */
export async function publishChecks(store: ObjectStore, input: PublishChecksInput, options: PublishChecksOptions = {}): Promise<ReportLayer> {
  const args = parseWith(PublishChecksSchema, input, 'publishChecks');
  const seen = new Set<string>();
  for (const check of args.checks) {
    if (seen.has(check.id)) throw new Error(`publishChecks: check id "${check.id}" appears twice; a check keeps one id across runs, so ids must be unique`);
    seen.add(check.id);
  }
  const limit = options.maxAttachmentBytes ?? 512 * 1024 * 1024;
  const entries = new Map<string, BundleEntry>();
  const checks = await Promise.all(args.checks.map(check => materialize(check as Loose, entries, limit)));
  const layerEvidence = await materialize({ attachments: args.attachments }, entries, limit);
  const total = [...entries.values()].reduce((sum, entry) => sum + entry.bytes.length, 0);
  const totalLimit = options.maxTotalAttachmentBytes ?? 2 * 1024 * 1024 * 1024;
  if (total > totalLimit) throw new Error(`publishChecks: attachments total ${total} bytes, over the limit of ${totalLimit}. Attach the largest by uri, or publish in several layers`);
  const environment = normalizeEnvironment(args.environment ?? args.parameters.environment);
  const { environment: _folded, ...parameters } = args.parameters;
  const part: ReportPart = {
    sha: args.sha ?? '',
    id: args.producer,
    kind: args.kind,
    title: args.title ?? args.producer,
    recordedAtMs: args.recordedAtMs,
    checks: checks as unknown as ReportPart['checks']
  };
  // Key order is part of the layer's identity: build it the one way.
  const summary: Omit<LayerSummary, 'id'> = {
    ...(args.freshness ? { freshness: args.freshness } : {}),
    producer: args.producer,
    recordedAtMs: args.recordedAtMs,
    sha: args.sha,
    branch: args.branch,
    runUrl: args.runUrl,
    ...(args.run ? { run: args.run } : {}),
    ...(environment ? { environment } : {}),
    parameters: Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    specs: args.specs as LayerSummary['specs'],
    parts: [part],
    source: null,
    recording: null,
    ...(args.tags?.length ? { tags: args.tags } : {}),
    ...(args.labels && Object.keys(args.labels).length ? { labels: Object.fromEntries(Object.entries(args.labels).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) } : {}),
    ...(args.links?.length ? { links: args.links } : {}),
    ...((layerEvidence.attachments as Attachment[] | undefined)?.length ? { attachments: layerEvidence.attachments as Attachment[] } : {}),
    ...(args.annotations?.length ? { annotations: args.annotations } : {}),
    ...(args.extensions && Object.keys(args.extensions).length ? { extensions: args.extensions } : {})
  };
  const bundle = entries.size ? await writeBundle(store, (async function* () { for (const entry of [...entries.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) yield entry; })(), 'layers/blobs/') : {};
  return publishLayerBundle(store, summary, bundle);
}
