/**
 * @module Evidence of one result
 *
 * Reads the evidence (attachments, steps, annotations, attempts, tags, labels, links, extensions) that a layer, a
 * part or a check carries beyond its outcome: the short summary that rides in every report row, one result's full
 * detail, and the bundle keys its files live under. It only reads; evidence never decides a status, a slot or a
 * winner, so nothing here affects who wins.
 *
 * @see docs/extending.md
 * @see docs/report-contract.md (evidence)
 */
import type { Annotation, Attachment, Attempt, Check, Step } from '../../schema/src/layer';
import type { EvidenceSummary, VideoCounts, VideoOwner, VideoRef } from './evidence-types';
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
 *
 * Several holders (for example a check and its layer) are summed: `attachments` also counts those on steps and
 * attempts, `steps` counts only each holder's own top-level steps, tags are de-duplicated, and for a repeated
 * label the later holder wins. `roles` are the attachments' roles (or, without one, what their media type or file
 * name implies), sorted and distinct. `videos` lists every attachment whose effective media type is video, with the
 * check, retry attempt or step that holds it (see {@link isVideoAttachment}).
 */
export function summarizeEvidence(...holders: readonly EvidenceHolder[]): EvidenceSummary | undefined {
  return summarize(holders, 'check');
}

/**
 * Like {@link summarizeEvidence} for a layer and its parts: the same summary, but a video attached to the layer or a
 * part is owned by the `layer`, not by a check.
 */
export function summarizeLayerEvidence(...holders: readonly EvidenceHolder[]): EvidenceSummary | undefined {
  return summarize(holders, 'layer');
}

function summarize(holders: readonly EvidenceHolder[], owner: VideoOwner): EvidenceSummary | undefined {
  if (!holders.some(holder => count(holder) > 0)) return undefined;
  const roles = new Set<string>();
  const tags = new Set<string>();
  const labels: Record<string, string> = {};
  const videos: VideoRef[] = [];
  let attachments = 0, steps = 0, annotations = 0, attempts = 0, links = 0;
  const attachmentsOf = (list: readonly Attachment[] | undefined, by: VideoOwner, where: { attempt?: number; step?: string } = {}) => {
    for (const item of list ?? []) {
      attachments += 1;
      roles.add(item.role ?? roleOfType(item.contentType ?? contentTypeOf(item.name)));
      const video = videoOf(item, by, where);
      if (video) videos.push(video);
    }
  };
  const stepsOf = (list: readonly Step[] | undefined, attempt?: number) => { for (const step of list ?? []) attachmentsOf(step.attachments, 'step', { ...(attempt === undefined ? {} : { attempt }), step: step.name }); };
  for (const holder of holders) {
    attachmentsOf(holder.attachments, owner);
    // Attachments on steps and attempts are part of the check too.
    stepsOf(holder.steps);
    for (const attempt of holder.attempts ?? []) { attachmentsOf(attempt.attachments, 'attempt', { attempt: attempt.index }); stepsOf(attempt.steps, attempt.index); }
    steps += holder.steps?.length ?? 0;
    annotations += holder.annotations?.length ?? 0;
    attempts += holder.attempts?.length ?? 0;
    links += holder.links?.length ?? 0;
    for (const tag of holder.tags ?? []) tags.add(tag);
    Object.assign(labels, holder.labels);
  }
  return { attachments, steps, annotations, attempts, links, tags: [...tags], labels, roles: [...roles].sort(), ...(videos.length ? { videos } : {}) };
}

/**
 * Whether an attachment is a video, by its effective media type: the producer's `contentType`, else the one its file
 * name implies. A role never decides this on its own (`demo` on a PNG is not a video), except that a `video` role
 * settles a file whose type nothing says (`application/octet-stream`).
 */
export function isVideoAttachment(attachment: Pick<Attachment, 'name' | 'role' | 'contentType'>): boolean {
  const type = (attachment.contentType ?? contentTypeOf(attachment.name)).toLowerCase();
  return type.startsWith('video/') || (attachment.role === 'video' && type.startsWith('application/octet-stream'));
}

function videoOf(item: Attachment, owner: VideoOwner, where: { attempt?: number; step?: string }): VideoRef | undefined {
  if (!isVideoAttachment(item)) return undefined;
  const recording = item.sha256 ? `sha256:${item.sha256}` : item.bundleKey ?? item.uri ?? (item.text === undefined ? undefined : `inline:${item.name}`);
  return { name: item.name, owner, ...where, ...(recording === undefined ? {} : { recording }), available: recording !== undefined };
}

/**
 * Counts references, distinct playable recordings and unplayable references. Undefined when there is no reference, so
 * "no video" and "nothing known about video" look the same on the wire.
 */
export function videoCounts(videos: readonly VideoRef[] | undefined): VideoCounts | undefined {
  if (!videos?.length) return undefined;
  const distinct = new Set<string>();
  let unavailable = 0;
  for (const video of videos) {
    if (video.available && video.recording !== undefined) distinct.add(video.recording);
    else unavailable += 1;
  }
  return { references: videos.length, recordings: distinct.size, unavailable };
}

/** A role to show when a producer gave none, from the media type: `image`, `video`, `audio`, `snapshot` (text/html), `text` (text, JSON, XML) or `file`. Roles are an open vocabulary; a producer's own role always wins. */
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
  /** The id of the layer the check was read from. */
  readonly layer: string;
  /** The kind of the part that holds the check. */
  readonly kind: string;
  /** The check as recorded, with all of its evidence. */
  readonly check: Check;
  /** What the run as a whole carries: its logs, its links, its labels. */
  readonly run: EvidenceHolder;
};

/** One result's evidence, from a layer: the first check with id `checkId` (in a part of kind `kind`, when given) plus the layer's own evidence. Null when the layer holds no such check. */
export function checkDetailOf(layer: { readonly id: string; readonly parts: readonly { readonly kind: string; readonly checks: readonly Check[] }[] } & EvidenceHolder, checkId: string, kind?: string): CheckDetail | null {
  for (const part of layer.parts) {
    if (kind !== undefined && part.kind !== kind) continue;
    const check = part.checks.find(item => item.id === checkId);
    if (check) return { layer: layer.id, kind: part.kind, check, run: runEvidence(layer) };
  }
  return null;
}

/** What a layer carries as a whole (its tags, labels, links, attachments, annotations and extensions; not its parts' checks). Absent fields stay absent. */
export function runEvidence(layer: EvidenceHolder): EvidenceHolder {
  const { tags, labels, links, attachments, annotations, extensions } = layer;
  return { ...(tags ? { tags } : {}), ...(labels ? { labels } : {}), ...(links ? { links } : {}), ...(attachments ? { attachments } : {}), ...(annotations ? { annotations } : {}), ...(extensions ? { extensions } : {}) };
}

/** Every distinct bundle key (`bundleKey`) that the attachments of a holder, its steps and its attempts point to, so a layer's files can be copied. Attachments held by `uri` or inline `text` have none. */
export function bundleKeysOf(holder: EvidenceHolder): string[] {
  const keys = new Set<string>();
  const take = (list: readonly Attachment[] | undefined) => { for (const item of list ?? []) if (item.bundleKey) keys.add(item.bundleKey); };
  take(holder.attachments);
  for (const step of holder.steps ?? []) take(step.attachments);
  for (const attempt of holder.attempts ?? []) { take(attempt.attachments); for (const step of attempt.steps ?? []) take(step.attachments); }
  return [...keys];
}
