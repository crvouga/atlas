import type { Annotation, Attachment, Attempt, Check, Step } from '../../schema/src/layer';
import type { EvidenceSummary } from './evidence-types';
import { contentTypeOf } from './media-types';

/** Anything that may carry evidence: a layer, a part or a check. */
export type EvidenceHolder = {
  readonly tags?: readonly string[];
  readonly labels?: Readonly<Record<string, string>>;
  readonly links?: readonly { readonly url: string; readonly name?: string | undefined; readonly rel?: string | undefined }[];
  readonly attachments?: readonly Attachment[];
  readonly annotations?: readonly Annotation[];
  readonly steps?: readonly Step[];
  readonly attempts?: readonly Attempt[];
  readonly extensions?: Readonly<Record<string, unknown>>;
};

function count(holder: EvidenceHolder): number {
  return (holder.attachments?.length ?? 0) + (holder.steps?.length ?? 0) + (holder.annotations?.length ?? 0) + (holder.attempts?.length ?? 0) + (holder.tags?.length ?? 0) + (holder.links?.length ?? 0) + Object.keys(holder.labels ?? {}).length + Object.keys(holder.extensions ?? {}).length;
}

/**
 * What a result carries beyond its outcome, as counts and short facts. It rides in every row of the
 * report so a list can show "3 attachments, 12 steps" without opening anything; the evidence itself is
 * read when someone asks for it. Undefined when there is none.
 */
export function summarizeEvidence(...holders: readonly EvidenceHolder[]): EvidenceSummary | undefined {
  if (!holders.some(holder => count(holder) > 0)) return undefined;
  const roles = new Set<string>();
  const tags = new Set<string>();
  const labels: Record<string, string> = {};
  let attachments = 0, steps = 0, annotations = 0, attempts = 0, links = 0;
  const attachmentsOf = (list: readonly Attachment[] | undefined) => { for (const item of list ?? []) { attachments += 1; roles.add(item.role ?? roleOfType(item.contentType ?? contentTypeOf(item.name))); } };
  for (const holder of holders) {
    attachmentsOf(holder.attachments);
    // Attachments on steps and attempts are part of the check too.
    for (const step of holder.steps ?? []) attachmentsOf(step.attachments);
    for (const attempt of holder.attempts ?? []) { attachmentsOf(attempt.attachments); for (const step of attempt.steps ?? []) attachmentsOf(step.attachments); }
    steps += holder.steps?.length ?? 0;
    annotations += holder.annotations?.length ?? 0;
    attempts += holder.attempts?.length ?? 0;
    links += holder.links?.length ?? 0;
    for (const tag of holder.tags ?? []) tags.add(tag);
    Object.assign(labels, holder.labels);
  }
  return { attachments, steps, annotations, attempts, links, tags: [...tags], labels, roles: [...roles].sort() };
}

/** A role to show when a producer gave none: what the media type says it is. */
export function roleOfType(contentType: string | undefined): string {
  const type = (contentType ?? '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'text/html') return 'snapshot';
  if (type.startsWith('text/') || type.includes('json') || type.includes('xml')) return 'text';
  return 'file';
}

/** All of one result's evidence, read when someone opens it. */
export type CheckDetail = {
  readonly layer: string;
  readonly kind: string;
  readonly check: Check;
  /** What the run as a whole carries: its logs, its links, its labels. */
  readonly run: EvidenceHolder;
};

/** One result's evidence, from a layer. Null when the layer holds no such check. */
export function checkDetailOf(layer: { readonly id: string; readonly parts: readonly { readonly kind: string; readonly checks: readonly Check[] }[] } & EvidenceHolder, checkId: string, kind?: string): CheckDetail | null {
  for (const part of layer.parts) {
    if (kind !== undefined && part.kind !== kind) continue;
    const check = part.checks.find(item => item.id === checkId);
    if (check) return { layer: layer.id, kind: part.kind, check, run: runEvidence(layer) };
  }
  return null;
}

/** What a layer carries as a whole. */
export function runEvidence(layer: EvidenceHolder): EvidenceHolder {
  const { tags, labels, links, attachments, annotations, extensions } = layer;
  return { ...(tags ? { tags } : {}), ...(labels ? { labels } : {}), ...(links ? { links } : {}), ...(attachments ? { attachments } : {}), ...(annotations ? { annotations } : {}), ...(extensions ? { extensions } : {}) };
}

/** Every bundle key a result's evidence points to, for copying a layer's files somewhere. */
export function bundleKeysOf(holder: EvidenceHolder): string[] {
  const keys = new Set<string>();
  const take = (list: readonly Attachment[] | undefined) => { for (const item of list ?? []) if (item.bundleKey) keys.add(item.bundleKey); };
  take(holder.attachments);
  for (const step of holder.steps ?? []) take(step.attachments);
  for (const attempt of holder.attempts ?? []) { take(attempt.attachments); for (const step of attempt.steps ?? []) take(step.attachments); }
  return [...keys];
}
