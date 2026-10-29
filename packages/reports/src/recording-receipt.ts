/**
 * @module Recording receipts
 *
 * Answers "did the recordings we expected get published?" apart from "did the tests pass?". `recordingReceipt` reads the
 * checks a producer is about to publish (after their files were stored) and describes, per check that declared a
 * `recordingExpectation`, whether its video was uploaded, only referenced, left out (with a reason) or never attached.
 * `recordingCompleteness` reduces the winning results of a report to the figures `atlas report status` prints. Neither
 * reads a clock or the environment, and neither changes a status, a slot or a winner: a receipt describes publication, it
 * does not decide a result. A layer with no receipt is Unknown, never Complete.
 *
 * @see docs/rich-evidence.md#recording-completeness
 */
import type { RecordingCompleteness, RecordingReceipt } from '../../schema/src/layer';
import type { RecordingCounts } from './evidence-types';
import { contentTypeOf } from './media-types';

type Loose = Record<string, unknown>;

/** Is this attachment a screen recording: a role of `video`, or a `video/*` media type? */
export function isVideoAttachment(attachment: Loose): boolean {
  if (attachment.role === 'video') return true;
  const type = typeof attachment.contentType === 'string' ? attachment.contentType : typeof attachment.name === 'string' ? contentTypeOf(attachment.name) : '';
  return type.startsWith('video/');
}

/** Every video attachment of a holder, its steps and its attempts, at any depth. */
function videosOf(holder: Loose): Loose[] {
  const found: Loose[] = [];
  const take = (list: unknown) => { if (Array.isArray(list)) for (const item of list as Loose[]) if (isVideoAttachment(item)) found.push(item); };
  take(holder.attachments);
  for (const step of (holder.steps as Loose[] | undefined) ?? []) take(step.attachments);
  for (const attempt of (holder.attempts as Loose[] | undefined) ?? []) {
    take(attempt.attachments);
    for (const step of (attempt.steps as Loose[] | undefined) ?? []) take(step.attachments);
  }
  return found;
}

/**
 * The receipt for the checks of one layer, or `undefined` when no check declares a `recordingExpectation` (the layer then
 * claims nothing). Call it with checks whose attachment bytes are already stored (`bundleKey`, `bytes` and `sha256` set).
 *
 * A `required` check is `uploaded` when any video of it has stored bytes, `referenced` when one has only a `uri`,
 * `skipped` when its videos were left out (the attachment's `omitted` is the reason) and `unresolved` when it has no
 * video at all. A `not-applicable` check is listed but is neither expected nor missing. Items are sorted by check id so the
 * same input is always the same receipt.
 */
export function recordingReceipt(checks: readonly Loose[]): RecordingReceipt | undefined {
  const items: RecordingReceipt['items'] = [];
  const count = { uploaded: 0, referenced: 0, skipped: 0, unresolved: 0, notApplicable: 0 };
  for (const check of checks) {
    const expectation = check.recordingExpectation;
    if (expectation !== 'required' && expectation !== 'not-applicable') continue;
    const check_ = String(check.id);
    if (expectation === 'not-applicable') {
      count.notApplicable += 1;
      items.push({ check: check_, state: 'not-applicable' });
      continue;
    }
    const files = videosOf(check).map(video => {
      const state = typeof video.bundleKey === 'string' ? 'uploaded' : typeof video.uri === 'string' ? 'referenced' : 'skipped';
      return {
        name: String(video.name),
        state,
        ...(typeof video.bytes === 'number' ? { bytes: video.bytes } : {}),
        ...(typeof video.sha256 === 'string' ? { sha256: video.sha256 } : {}),
        ...(state === 'skipped' ? { reason: typeof video.omitted === 'string' ? video.omitted : 'bytes-not-attached' } : {})
      };
    });
    const first = (state: string) => files.find(file => file.state === state);
    const state = first('uploaded') ? 'uploaded' : first('referenced') ? 'referenced' : first('skipped') ? 'skipped' : 'unresolved';
    const reason = state === 'skipped' ? first('skipped')?.reason : state === 'unresolved' ? 'no-video-attached' : undefined;
    count[state as keyof typeof count] += 1;
    items.push({ check: check_, state, ...(reason ? { reason } : {}), ...(files.length ? { files } : {}) });
  }
  if (!items.length) return undefined;
  items.sort((a, b) => (a.check < b.check ? -1 : a.check > b.check ? 1 : 0));
  return { expected: count.uploaded + count.referenced + count.skipped + count.unresolved, ...count, items };
}

/** One result as {@link recordingCompleteness} reads it. */
export type RecordingResult = {
  readonly spec: string | null;
  readonly check: string;
  readonly environment: string | null;
  readonly layer: string;
  /** Whether the layer the result came from carried a receipt. */
  readonly hasReceipt: boolean;
  /** The result's item in that receipt, when its check declared an expectation. */
  readonly recording?: { readonly state: string; readonly reason?: string };
};

/**
 * Reduces the winning results of a report to its recording completeness. `incomplete` when any expected recording is
 * skipped or unresolved; otherwise `unknown` when a contributing layer has no receipt (nothing is claimed for it, and a
 * report with no results at all is unknown too); otherwise `complete` when something was expected and `none-expected` when
 * nothing was. Gaps are sorted so the output never depends on read order.
 */
export function recordingCompleteness(results: readonly RecordingResult[]): RecordingCompleteness {
  const count = { expected: 0, uploaded: 0, referenced: 0, skipped: 0, unresolved: 0, notApplicable: 0 };
  const gaps: RecordingCompleteness['gaps'] = [];
  const without = new Set<string>();
  for (const result of results) {
    if (!result.hasReceipt) { without.add(result.layer); continue; }
    const state = result.recording?.state;
    if (state === undefined) continue;
    if (state === 'not-applicable') { count.notApplicable += 1; continue; }
    count.expected += 1;
    if (state === 'uploaded' || state === 'referenced' || state === 'skipped' || state === 'unresolved') count[state] += 1;
    // A state this reader does not know is a gap: it is never counted as uploaded.
    if (state !== 'uploaded' && state !== 'referenced') {
      gaps.push({ spec: result.spec, check: result.check, layer: result.layer, environment: result.environment, state, ...(result.recording?.reason ? { reason: result.recording.reason } : {}) });
    }
  }
  const text = (value: string | null) => value ?? '';
  gaps.sort((a, b) => (text(a.spec) + a.check + text(a.environment) + a.layer < text(b.spec) + b.check + text(b.environment) + b.layer ? -1 : 1));
  const state = gaps.length ? 'incomplete' : without.size || !results.length ? 'unknown' : count.expected ? 'complete' : 'none-expected';
  return { state, ...count, layersWithoutReceipt: without.size, gaps };
}

/** A run's recording completeness, from the receipts of its layers (see {@link runRecordings}). */
export type RunRecordings = {
  /** `incomplete`: a recording is skipped or unresolved. `unknown`: no gap is known, but a layer declared no expectations. `complete`: everything expected was published. `none-expected`: every layer declared expectations and none required a recording. */
  readonly state: 'complete' | 'incomplete' | 'none-expected' | 'unknown';
  /** Recordings the layers expected. */
  readonly expected: number;
  /** Of those, uploaded or referenced by address. */
  readonly published: number;
  readonly skipped: number;
  readonly unresolved: number;
  /** Intentionally unrecorded checks: neither expected nor missing. */
  readonly notApplicable: number;
  /** Layers of the run that declared no expectations: nothing is claimed for them. */
  readonly layersWithoutReceipt: number;
};

/**
 * The recording completeness of a run, from the `recordings` counts of each of its layers (`undefined` for a layer that
 * has no receipt). `undefined` when no layer has a receipt: the run claims nothing, which a reader treats as `unknown`.
 * A gap always wins (`incomplete`); otherwise a layer without a receipt keeps the run `unknown`, never `complete`. Reads
 * only the counts, never a recording, and never changes a status.
 */
export function runRecordings(layers: readonly (RecordingCounts | undefined)[]): RunRecordings | undefined {
  const receipts = layers.filter((layer): layer is RecordingCounts => layer !== undefined);
  if (!receipts.length) return undefined;
  const sum = (pick: (counts: RecordingCounts) => number) => receipts.reduce((total, counts) => total + pick(counts), 0);
  const skipped = sum(counts => counts.skipped), unresolved = sum(counts => counts.unresolved), expected = sum(counts => counts.expected);
  const layersWithoutReceipt = layers.length - receipts.length;
  const state = skipped + unresolved > 0 ? 'incomplete' : layersWithoutReceipt > 0 ? 'unknown' : expected > 0 ? 'complete' : 'none-expected';
  return { state, expected, published: sum(counts => counts.uploaded + counts.referenced), skipped, unresolved, notApplicable: sum(counts => counts.notApplicable), layersWithoutReceipt };
}
