/**
 * @module Recording verification
 *
 * Answers "is the recording we published still there, and does it still look like the video we published?" apart from
 * "did the tests pass?" and apart from "was it uploaded?" (the receipt, see `recording-receipt.ts`). `verifyLayerRecordings`
 * reads each video a layer keeps in its bundle back from the store and checks, in order, that the layer's bundle still
 * lists its file, that the blob it lives in is still stored, that its size and SHA-256 are the ones recorded at upload,
 * and that its first bytes are the container header its media type promises. A problem is a gap in the evidence, named
 * with the check that holds the video; it never changes a status, a slot or a winner.
 *
 * Trap: this is a stored-bytes check, not a playback test. A file with a valid header can still fail to play in a given
 * browser (codec, truncation), and acknowledging an upload is not playback either. Videos given only by `uri` are counted
 * as `referenced`, not checked: Atlas holds no bytes to read back.
 *
 * @see docs/rich-evidence.md#recording-completeness
 */
import type { Attachment } from '../../schema/src/layer';
import { createBundleReader } from './bundle';
import { isVideoAttachment, type EvidenceHolder } from './evidence-detail';
import { contentTypeOf } from './media-types';
import type { ObjectStore } from './object-store';
import type { ReportLayer } from './layer-types';
import { LAYER_INDEX, readLayer } from './layer-store';
import { sha256Hex } from './sigv4';

/** What is wrong with a stored recording. An open vocabulary: a reader treats an unknown problem as a gap. */
export type RecordingProblem =
  /** The layer names the file but its bundle does not list it: stored, then gone (or never arrived). */
  | 'not-in-bundle'
  /** The bundle lists the file but a blob holding its bytes is no longer in the store (a 404 when played). */
  | 'blob-missing'
  /** The store could not be read just now. Not proof the bytes are gone, and not a pass. */
  | 'unreadable'
  /** The stored bytes are not as many as were recorded. */
  | 'size-mismatch'
  /** The stored bytes do not hash to the SHA-256 recorded at upload. */
  | 'checksum-mismatch'
  /** The stored bytes do not begin like the container their media type names, or are empty: incompatible or corrupt. */
  | 'undecodable';

/** One video of a layer that failed verification. */
export type RecordingGap = {
  /** The check that holds the video, or `null` for a video attached to the layer or a part. */
  readonly check: string | null;
  /** The attachment's name. */
  readonly name: string;
  readonly bundleKey: string;
  readonly problem: RecordingProblem;
  /** A short, non-secret explanation: sizes or the container found. */
  readonly reason: string;
};

/** What verifying one layer found. */
export type LayerRecordingVerification = {
  readonly layer: string;
  /** Videos read back from the store: those that name a bundle key. */
  readonly checked: number;
  /** Of those, the ones that passed every check. */
  readonly ok: number;
  /** Videos given only by `uri`, which Atlas cannot read back. */
  readonly referenced: number;
  readonly gaps: readonly RecordingGap[];
};

const MP4_BOXES = new Set(['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip', 'pnot']);
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/**
 * Whether the first bytes of a stored video are the container its media type names, as a reason it is not, or `null` when
 * it looks right or the type is one this check has no signature for (then nothing is claimed). Recognizes WebM and
 * Matroska (EBML), MP4, QuickTime and 3GPP (an ISO box), Ogg and AVI. An empty file is never a video.
 */
export function containerProblem(bytes: Uint8Array, contentType: string): string | null {
  if (!bytes.length) return 'the file is empty';
  const type = contentType.toLowerCase();
  const found = () => `its first bytes are not ${type}`;
  if (type.includes('webm') || type.includes('matroska')) return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 ? null : found();
  if (type.includes('mp4') || type.includes('quicktime') || type.includes('3gpp') || type.includes('m4v')) return bytes.length >= 8 && MP4_BOXES.has(ascii(bytes, 4, 8)) ? null : found();
  if (type.includes('ogg')) return ascii(bytes, 0, 4) === 'OggS' ? null : found();
  if (type.includes('msvideo')) return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'AVI ' ? null : found();
  return null;
}

type Held = { readonly check: string | null; readonly attachment: Attachment };

/** Every video attachment of a holder, its steps and its attempts. */
function videosOf(holder: EvidenceHolder, check: string | null): Held[] {
  const found: Held[] = [];
  const take = (list: readonly Attachment[] | undefined) => { for (const attachment of list ?? []) if (isVideoAttachment(attachment)) found.push({ check, attachment }); };
  take(holder.attachments);
  for (const step of holder.steps ?? []) take(step.attachments);
  for (const attempt of holder.attempts ?? []) { take(attempt.attachments); for (const step of attempt.steps ?? []) take(step.attachments); }
  return found;
}

/**
 * Reads back every video of `layer` that is kept in its bundle and reports the ones that are no longer retrievable or no
 * longer look like what was published (see {@link RecordingProblem}). Each blob is read once however many checks
 * reference it. A store that fails to answer is `unreadable`, never a pass. It only reads: nothing is written, and no
 * status changes.
 *
 * @example
 * ```ts
 * const layer = await readLayer(store, id);
 * const { gaps } = await verifyLayerRecordings(store, layer!);
 * gaps.map(gap => `${gap.check}: ${gap.problem}`);
 * ```
 */
export async function verifyLayerRecordings(store: ObjectStore, layer: ReportLayer): Promise<LayerRecordingVerification> {
  const holders: Held[] = [...videosOf(layer, null)];
  for (const part of layer.parts) {
    holders.push(...videosOf(part, null));
    for (const check of part.checks) holders.push(...videosOf(check, check.id));
  }
  const read = createBundleReader(store, layer.bundle);
  const bytesOf = new Map<string, Promise<{ bytes: Uint8Array; contentType: string } | 'missing' | 'unreadable'>>();
  const load = (key: string) => {
    let pending = bytesOf.get(key);
    if (!pending) {
      pending = read(key).then(entry => entry ?? 'missing' as const, () => 'unreadable' as const);
      bytesOf.set(key, pending);
    }
    return pending;
  };
  const gaps: RecordingGap[] = [];
  let checked = 0, ok = 0, referenced = 0;
  for (const { check, attachment } of holders) {
    const key = attachment.bundleKey;
    if (key === undefined) { if (attachment.uri !== undefined) referenced += 1; continue; }
    checked += 1;
    const gap = (problem: RecordingProblem, reason: string) => { gaps.push({ check, name: attachment.name, bundleKey: key, problem, reason }); };
    if (!Object.hasOwn(layer.bundle, key)) { gap('not-in-bundle', 'the layer names this file but its bundle does not list it'); continue; }
    const stored = await load(key);
    if (stored === 'unreadable') { gap('unreadable', 'the store could not be read'); continue; }
    if (stored === 'missing') { gap('blob-missing', 'a blob holding this file is no longer in the store'); continue; }
    if (attachment.bytes !== undefined && attachment.bytes !== stored.bytes.length) { gap('size-mismatch', `${stored.bytes.length} bytes stored, ${attachment.bytes} recorded`); continue; }
    if (attachment.sha256 !== undefined && attachment.sha256 !== await sha256Hex(stored.bytes)) { gap('checksum-mismatch', 'the stored bytes do not match the recorded SHA-256'); continue; }
    const problem = containerProblem(stored.bytes, attachment.contentType ?? (stored.contentType || contentTypeOf(attachment.name)));
    if (problem) { gap('undecodable', problem); continue; }
    ok += 1;
  }
  return { layer: layer.id, checked, ok, referenced, gaps };
}

/** What verifying the layers of one store found. */
export type StoreRecordingVerification = {
  readonly layers: readonly LayerRecordingVerification[];
  /** Layers that could not be read at all (their manifest is unreadable or gone): their recordings are unknown, not verified. */
  readonly notices: readonly string[];
};

/**
 * Verifies the recordings of the layers a store lists, newest first. `ids` narrows to layers whose id starts with one of
 * them (at least 7 hex digits); `limit` keeps only that many of the newest. A layer that cannot be read is a notice, never
 * skipped silently and never counted as verified. A store that cannot be listed rejects.
 */
export async function verifyStoreRecordings(store: ObjectStore, options: { readonly ids?: readonly string[]; readonly limit?: number; readonly include?: (layer: ReportLayer) => boolean } = {}): Promise<StoreRecordingVerification> {
  const keys = await store.listKeys(LAYER_INDEX);
  const wanted = options.ids?.length ? options.ids.map(id => id.toLowerCase()) : null;
  const ids = keys.flatMap(key => { const id = /-([0-9a-f]{64})\.json$/.exec(key)?.[1]; return id && (!wanted || wanted.some(prefix => id.startsWith(prefix))) ? [id] : []; });
  const layers: LayerRecordingVerification[] = [];
  const notices: string[] = [];
  for (const id of ids.slice(0, options.limit ?? ids.length)) {
    try {
      const layer = await readLayer(store, id);
      if (!layer) { notices.push(`layer ${id.slice(0, 12)} is listed but its manifest is missing`); continue; }
      if (options.include && !options.include(layer)) continue;
      layers.push(await verifyLayerRecordings(store, layer));
    } catch (error) {
      notices.push(`layer ${id.slice(0, 12)} could not be read: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }
  return { layers, notices };
}
