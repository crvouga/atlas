/**
 * @module Reviewers' marks of critiques
 *
 * A person who reads a critic's opinion can accept it (it is right: the finding is valid, the UI needs polish) or dismiss it (it is not).
 * A mark is stored like the critique it is about: a check in a layer of parts of kind `critique`, with the decision in
 * `extensions["atlas.critique-mark"]`, published under the producer `critic.review.<reviewer>`. That is within what a `critic`-role
 * token may publish, so marking needs no more power than critiquing, and any `publish` token may do it too. Because a mark is evidence in
 * an opinion part it is never counted, and it never changes a status, a slot or the gate: the server may refuse an upload, and it
 * never alters one.
 *
 * Each reviewer holds one mark per critic and finding of an entry: a newer mark replaces their older one (the slot rule), and a mark made
 * about a picture the entry no longer has is shown as that. Marks feed `atlas critic calibrate --from-marks`.
 *
 * @see docs/critics.md#reviewing-and-marking
 */
import type { ReportLayer } from '../../reports/src/layer-types';
import type { ObjectStore } from '../../reports/src/object-store';
import { publishChecks, type PublishChecksOptions } from '../../reports/src/publish-checks';
import { CRITIQUE_MARK_EXTENSION, CRITIQUE_MARK_PRODUCER_PREFIX, CRITIQUE_MARK_SCHEMA_VERSION, CRITIQUE_PART_KIND, type CritiqueMark } from '../../schema/src/critique';
import type { PublishChecksInput } from '../../schema/src/layer';
import { criticScopeViolation } from './scope';

/** The prefix of the id of every mark check: `critique-mark/…`. It keeps a mark from ever sharing a slot with a critique or a test. */
export const MARK_CHECK_PREFIX = 'critique-mark/';

/** One decision about a critic's opinion, ready to be recorded. */
export type MarkRequest = {
  /** The entry and the exact picture the marked critique judged. */
  readonly entry: { readonly key: string; readonly title: string; readonly imageSha256: string };
  /** The critic whose opinion is marked. */
  readonly critic: { readonly name: string; readonly version?: string };
  /** The `id` of one finding; absent marks the critique as a whole. */
  readonly finding?: string;
  readonly decision: 'accept' | 'dismiss';
  /** Why, in the reviewer's words. */
  readonly note?: string;
  /** The layer of the critique that was marked. */
  readonly layer?: string;
};

/**
 * The name a reviewer is recorded under, as a producer suffix: lowercase letters, digits, `-` and `.`. Anything else becomes `-`.
 * Throws for a name with nothing left. It is a name the reviewer chooses, never an account, an address or a login.
 */
export function reviewerName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (!slug) throw new Error(`"${name}" is not a usable reviewer name: use letters, digits, "-" and "."`);
  return slug;
}

/** `critic.review.<reviewer>`: the producer of a reviewer's marks. A critic-scoped token may publish it. */
export function reviewerProducer(reviewer: string): string {
  return `${CRITIQUE_MARK_PRODUCER_PREFIX}${reviewerName(reviewer)}`;
}

/** The id of the check a mark is stored under; it names the entry, the critic and the finding (`*` for the whole critique), so a reviewer's newer mark of the same subject replaces the older. */
export function markCheckId(request: Pick<MarkRequest, 'entry' | 'critic' | 'finding'>): string {
  return `${MARK_CHECK_PREFIX}${[request.entry.key, request.critic.name, request.finding ?? '*'].map(encodeURIComponent).join('/')}`;
}

/** The extension a mark is stored as. */
export function markExtension(request: MarkRequest, reviewer: string): CritiqueMark {
  return {
    schema: CRITIQUE_MARK_SCHEMA_VERSION,
    subject: { entryKey: request.entry.key, imageSha256: request.entry.imageSha256 },
    critic: { name: request.critic.name, ...(request.critic.version ? { version: request.critic.version } : {}) },
    ...(request.finding ? { finding: request.finding } : {}),
    decision: request.decision,
    reviewer: reviewerName(reviewer),
    ...(request.note ? { note: request.note } : {}),
    ...(request.layer ? { layer: request.layer } : {})
  };
}

/**
 * The input of `publishChecks` for a reviewer's marks: producer `critic.review.<reviewer>`, part kind `critique`. Each mark is a `passed`
 * check (it was recorded) with an `info` annotation in words, so a viewer that has never heard of marks still shows it.
 *
 * @param args.recordedAtMs when, epoch milliseconds. Nothing here reads a clock, so the same input is the same layer.
 */
export function markLayer(args: { readonly reviewer: string; readonly marks: readonly MarkRequest[]; readonly recordedAtMs: number }): PublishChecksInput {
  const reviewer = reviewerName(args.reviewer);
  return {
    producer: reviewerProducer(reviewer), kind: CRITIQUE_PART_KIND, title: `Marks by ${reviewer}`,
    recordedAtMs: args.recordedAtMs, sha: null, branch: null, runUrl: null, parameters: {}, labels: { reviewer },
    checks: args.marks.map(request => ({
      id: markCheckId(request),
      title: `${request.decision === 'accept' ? 'Accepted' : 'Dismissed'} ${request.critic.name}${request.finding ? ` finding ${request.finding}` : ''} on ${request.entry.title}`,
      status: 'passed' as const,
      detail: '',
      measurements: [],
      annotations: [{ type: 'critique-mark', level: 'info', message: `${reviewer} ${request.decision === 'accept' ? 'accepted' : 'dismissed'} ${request.critic.name}'s ${request.finding ? `finding ${request.finding}` : 'opinion'}${request.note ? `: ${request.note}` : ''}` }],
      labels: { critic: request.critic.name, reviewer },
      extensions: { [CRITIQUE_MARK_EXTENSION]: markExtension(request, reviewer) }
    }))
  };
}

/**
 * Publishes a reviewer's marks as one layer through any store, after checking the layer is within what a critic-scoped credential may
 * publish. Returns the stored layer, or `null` when there is nothing to publish. The layer is content-addressed: the same marks at the same time are the same layer.
 *
 * @param store where to publish.
 * @param args see {@link markLayer}.
 * @param options attachment limits, as for `publishChecks`.
 */
export async function publishMarks(store: ObjectStore, args: Parameters<typeof markLayer>[0], options: PublishChecksOptions = {}): Promise<ReportLayer | null> {
  if (!args.marks.length) return null;
  const input = markLayer(args);
  const violation = criticScopeViolation({ producer: input.producer, parts: [{ kind: input.kind }] });
  if (violation) throw new Error(violation);
  return publishChecks(store, input, options);
}
