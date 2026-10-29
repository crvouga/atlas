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
import type { Annotation, Attachment, Attempt, Check, EvidenceScope, Step } from '../../schema/src/layer';
import type { EvidenceStatus } from './explorer-types';
import type { EvidenceSummary, VideoCounts, VideoOwner, VideoRef } from './evidence-types';
import { normalizeTags } from './artifact-tags';
import { effectiveScope } from './evidence-scope';
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
  /** What its evidence shows, as its producer declared it (see `EvidenceScope`). */
  readonly scope?: EvidenceScope;
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
 * label the later holder wins. `artifactTags` are the attachments' own normalized tags and are never inherited. `roles` are the attachments' roles (or, without one, what their media type or file
 * name implies), sorted and distinct. `videos` lists every attachment whose effective media type is video, with the
 * check, retry attempt or step that holds it (see {@link isVideoAttachment}), each with the scope that applies to it.
 */
export function summarizeEvidence(...holders: readonly EvidenceHolder[]): EvidenceSummary | undefined {
  return summarize(holders, 'check');
}

/**
 * Like {@link summarizeEvidence} for the checks of a part: a video that declares no scope, and sits in a holder that
 * declares none, takes the scope `inherited` from its part or layer (the nearest declaration of the two, see
 * `effectiveScope`). Without `inherited` it is the same as `summarizeEvidence`.
 */
export function summarizeEvidenceIn(inherited: EvidenceScope | undefined, ...holders: readonly EvidenceHolder[]): EvidenceSummary | undefined {
  return summarize(holders, 'check', inherited);
}

/**
 * Like {@link summarizeEvidenceIn}, knowing which bundle keys the layer names but does not hold (`unstored`, see
 * `unstoredKeys`): a video whose only bytes are such a key is `available: false`, never a recording. Without
 * `unstored` it is the same as `summarizeEvidenceIn`.
 */
export function summarizeStoredEvidence(inherited: EvidenceScope | undefined, unstored: ReadonlySet<string> | undefined, ...holders: readonly EvidenceHolder[]): EvidenceSummary | undefined {
  return summarize(holders, 'check', inherited, false, unstored);
}

/**
 * Like {@link summarizeEvidence} for a layer and its parts: the same summary, but a video attached to the layer or a
 * part is owned by the `layer`, not by a check.
 */
export function summarizeLayerEvidence(...holders: readonly EvidenceHolder[]): EvidenceSummary | undefined {
  // The first holder is the layer: its scope reaches the parts after it, which may declare their own.
  return summarize(holders, 'layer', undefined, true);
}

/** Like {@link summarizeLayerEvidence}, knowing which bundle keys the layer names but does not hold (see {@link summarizeStoredEvidence}). */
export function summarizeStoredLayerEvidence(unstored: ReadonlySet<string> | undefined, ...holders: readonly EvidenceHolder[]): EvidenceSummary | undefined {
  return summarize(holders, 'layer', undefined, true, unstored);
}

function summarize(holders: readonly EvidenceHolder[], owner: VideoOwner, inherited?: EvidenceScope, firstIsParent = false, unstored?: ReadonlySet<string>): EvidenceSummary | undefined {
  if (!holders.some(holder => count(holder) > 0)) return undefined;
  const roles = new Set<string>();
  const tags = new Set<string>();
  const artifactTags = new Set<string>();
  const labels: Record<string, string> = {};
  const videos: VideoRef[] = [];
  let attachments = 0, steps = 0, annotations = 0, attempts = 0, links = 0;
  const tried: { index: number; status: EvidenceStatus }[] = [];
  const attachmentsOf = (list: readonly Attachment[] | undefined, by: VideoOwner, scopes: readonly (EvidenceScope | undefined)[], where: { attempt?: number; step?: string } = {}) => {
    for (const item of list ?? []) {
      attachments += 1;
      for (const tag of normalizeTags(item.tags)) artifactTags.add(tag);
      roles.add(item.role ?? roleOfType(item.contentType ?? contentTypeOf(item.name)));
      const video = videoOf(item, by, where, effectiveScope(item.scope, ...scopes), unstored, list);
      if (video) videos.push(video);
    }
  };
  const stepsOf = (list: readonly Step[] | undefined, scopes: readonly (EvidenceScope | undefined)[], attempt?: number) => { for (const step of list ?? []) attachmentsOf(step.attachments, 'step', scopes, { ...(attempt === undefined ? {} : { attempt }), step: step.name }); };
  for (const [index, holder] of holders.entries()) {
    const around = [holder.scope, inherited, ...(firstIsParent && index > 0 ? [holders[0]?.scope] : [])];
    attachmentsOf(holder.attachments, owner, around);
    // Attachments on steps and attempts are part of the check too.
    stepsOf(holder.steps, around);
    for (const attempt of holder.attempts ?? []) { const tried = [attempt.scope, ...around]; attachmentsOf(attempt.attachments, 'attempt', tried, { attempt: attempt.index }); stepsOf(attempt.steps, tried, attempt.index); }
    steps += holder.steps?.length ?? 0;
    annotations += holder.annotations?.length ?? 0;
    attempts += holder.attempts?.length ?? 0;
    for (const attempt of holder.attempts ?? []) tried.push({ index: attempt.index, status: attempt.status });
    links += holder.links?.length ?? 0;
    for (const tag of holder.tags ?? []) tags.add(tag);
    Object.assign(labels, holder.labels);
  }
  // The outcome of each try in the order it was made, so a reader can tell a first-try pass from one that needed a retry.
  const attemptStatuses = tried.sort((a, b) => a.index - b.index).map(attempt => attempt.status);
  return { attachments, steps, annotations, attempts, ...(attemptStatuses.length ? { attemptStatuses } : {}), links, tags: [...tags], ...(artifactTags.size ? { artifactTags: [...artifactTags].sort() } : {}), labels, roles: [...roles].sort(), ...(videos.length ? { videos } : {}) };
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

/**
 * What identifies an attachment's bytes: its digest, else its bundle key, address or inline text. Attachments with the
 * same identity are the same file however many results reference them. Undefined when it names no bytes at all (it can
 * never be opened). This is the `recording` of a {@link VideoRef}.
 */
export function attachmentIdentity(item: Pick<Attachment, 'name' | 'sha256' | 'bundleKey' | 'uri' | 'text'>): string | undefined {
  return item.sha256 ? `sha256:${item.sha256}` : item.bundleKey ?? item.uri ?? (item.text === undefined ? undefined : `inline:${item.name}`);
}

/** The bundle key of the image an attachment names as its poster among its siblings, when the layer's bundle holds it. */
function posterKey(item: Attachment, siblings: readonly Attachment[] | undefined, unstored: ReadonlySet<string> | undefined): string | undefined {
  if (item.poster === undefined) return undefined;
  const poster = siblings?.find(other => other !== item && other.id === item.poster);
  if (!poster?.bundleKey || unstored?.has(poster.bundleKey)) return undefined;
  return (poster.contentType ?? contentTypeOf(poster.name)).toLowerCase().startsWith('image/') ? poster.bundleKey : undefined;
}

function videoOf(item: Attachment, owner: VideoOwner, where: { attempt?: number; step?: string }, scope: EvidenceScope | undefined, unstored?: ReadonlySet<string>, siblings?: readonly Attachment[]): VideoRef | undefined {
  if (!isVideoAttachment(item)) return undefined;
  // A bundle key the layer's bundle does not hold names bytes that are not there: only an address or inline text can still carry them, and the digest of lost bytes identifies nothing playable.
  const lost = item.bundleKey !== undefined && unstored?.has(item.bundleKey) === true;
  const recording = lost ? attachmentIdentity({ name: item.name, uri: item.uri, text: item.text }) : attachmentIdentity(item);
  const tags = normalizeTags(item.tags);
  const poster = posterKey(item, siblings, unstored);
  return { name: item.name, owner, ...where, ...(tags.length ? { tags } : {}), ...(recording === undefined ? {} : { recording }), available: recording !== undefined, ...(lost && recording === undefined ? { reason: 'not-in-bundle' as const } : {}), ...(item.durationMs !== undefined && Number.isFinite(item.durationMs) ? { durationMs: item.durationMs } : {}), ...(poster === undefined ? {} : { poster }), ...(scope ? { scope } : {}) };
}

/**
 * Counts references, distinct playable recordings and unplayable references. Undefined when there is no reference, so
 * "no video" and "nothing known about video" look the same on the wire.
 */
export function videoCounts(videos: readonly VideoRef[] | undefined): VideoCounts | undefined {
  if (!videos?.length) return undefined;
  const distinct = new Set<string>();
  let unavailable = 0, missing = 0;
  for (const video of videos) {
    if (video.available && video.recording !== undefined) distinct.add(video.recording);
    else { unavailable += 1; if (video.reason === 'not-in-bundle') missing += 1; }
  }
  return { references: videos.length, recordings: distinct.size, unavailable, ...(missing ? { missing } : {}) };
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
  /** The scope the check inherits: its part's declaration, else its layer's. Absent when neither declared one, which is unknown, not live or physical. */
  readonly inheritedScope?: EvidenceScope;
};

/** One result's evidence, from a layer: the first check with id `checkId` (in a part of kind `kind`, when given) plus the layer's own evidence. Null when the layer holds no such check. */
export function checkDetailOf(layer: { readonly id: string; readonly parts: readonly { readonly kind: string; readonly checks: readonly Check[]; readonly scope?: EvidenceScope }[] } & EvidenceHolder, checkId: string, kind?: string): CheckDetail | null {
  for (const part of layer.parts) {
    if (kind !== undefined && part.kind !== kind) continue;
    const check = part.checks.find(item => item.id === checkId);
    if (check) {
      const inheritedScope = effectiveScope(part.scope, layer.scope);
      return { layer: layer.id, kind: part.kind, check, run: runEvidence(layer), ...(inheritedScope ? { inheritedScope } : {}) };
    }
  }
  return null;
}

/** What a layer carries as a whole (its scope, tags, labels, links, attachments, annotations and extensions; not its parts' checks). Absent fields stay absent. */
export function runEvidence(layer: EvidenceHolder): EvidenceHolder {
  const { tags, labels, links, attachments, annotations, extensions, scope } = layer;
  return { ...(scope ? { scope } : {}), ...(tags ? { tags } : {}), ...(labels ? { labels } : {}), ...(links ? { links } : {}), ...(attachments ? { attachments } : {}), ...(annotations ? { annotations } : {}), ...(extensions ? { extensions } : {}) };
}

/** What one part of a layer (one kind of report) carries as a whole, named by the part. */
export type PartEvidence = EvidenceHolder & {
  readonly kind: string;
  readonly id: string;
  readonly title: string;
};

/**
 * The parts of a layer that carry evidence of their own (attachments, links, labels…), each with its name. Parts
 * that carry none are left out. A part's files belong to the run, not to any one check.
 */
export function partsEvidence(layer: { readonly parts: readonly (EvidenceHolder & { readonly kind: string; readonly id: string; readonly title: string })[] }): PartEvidence[] {
  return layer.parts.flatMap(part => {
    const evidence = runEvidence(part);
    return Object.keys(evidence).length ? [{ kind: part.kind, id: part.id, title: part.title, ...evidence }] : [];
  });
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

/**
 * The bundle keys that attachments of a layer, its parts and their checks name, but that the layer's `bundle` index does
 * not hold: files the producer referenced and never stored. Empty for a layer whose every file is there. This reads only
 * the index, never a blob, so it is cheap enough to ask of every layer as it is read.
 */
export function unstoredKeys(layer: EvidenceHolder & { readonly parts: readonly (EvidenceHolder & { readonly checks: readonly EvidenceHolder[] })[]; readonly bundle: Readonly<Record<string, unknown>> }): string[] {
  const missing = new Set<string>();
  for (const holder of [layer, ...layer.parts, ...layer.parts.flatMap(part => part.checks)])
    for (const key of bundleKeysOf(holder)) if (!Object.hasOwn(layer.bundle, key)) missing.add(key);
  return [...missing];
}
