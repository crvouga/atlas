/**
 * @module Critiques as layers
 *
 * Turns a critic's judgements into the checks of a layer (`critiqueChecks`, `critiqueLayer`) and reads them back
 * (`readCritique`, `critiquesOfLayer`). A critique is a check in a part of kind `critique` whose `status` says whether
 * the critic ran; the opinion is in `extensions["atlas.critique"]`, and is repeated in standard evidence (a
 * measurement for the score, an annotation for each finding) so a viewer that has never heard of critics still shows
 * it. Critiques are anchored to the image hash they judged: when an entry's image changes, an older critique is still
 * shown, as judging an earlier image, and the entry counts as not yet judged (`critiqueCurrency`).
 *
 * @see docs/critics.md
 * @see docs/extending.md
 */
import {
  CRITIC_PRODUCER_PREFIX, CRITIQUE_EXTENSION, CRITIQUE_PART_KIND, CRITIQUE_SCHEMA_VERSION, CritiqueSchema,
  type Critique, type CritiqueFinding
} from '../../schema/src/critique';
import type { PublishChecksInput } from '../../schema/src/layer';
import type { Critic, CriticDescription, JudgeableEntry } from './contract';

/** The prefix of the id of every critique check: `critique/<entry key>`. It keeps a critique from ever sharing a slot with a test. */
export const CRITIQUE_CHECK_PREFIX = 'critique/';

/** The result of judging one entry: a critique, or the reason there is none. Either way it has what it judged. */
export type CritiqueOutcome = {
  /** The entry and the image that was judged. */
  readonly entry: JudgeableEntry;
  /** The critique with its subject, critic and verdict (or failure) filled in. */
  readonly critique: Critique;
};

/** The check ids and labels one critique is published under. */
export function critiqueCheckId(entryKey: string): string {
  return `${CRITIQUE_CHECK_PREFIX}${entryKey}`;
}

/** `critic.<name>`: the producer of every layer of the critic's critiques. A critic-scoped token may publish only such layers. */
export function criticProducer(criticName: string): string {
  return `${CRITIC_PRODUCER_PREFIX}${criticName}`;
}

const LEVELS: Readonly<Record<string, string>> = { info: 'info', minor: 'warning', warning: 'warning', major: 'error', critical: 'error', error: 'error' };

function findingMessage(finding: CritiqueFinding): string {
  const head = [finding.category, finding.rationale].filter(Boolean).join(': ');
  const text = head || 'Finding';
  return finding.suggestion ? `${text} (suggestion: ${finding.suggestion})` : text;
}

/**
 * Builds the critique a critic produced for an entry. It fills in `schema`, `subject`, `critic`, `model` and
 * `parameters` from the critic and the entry (so they cannot disagree with what was run) and keeps the verdict,
 * findings and usage as given.
 *
 * @param critic the critic that ran.
 * @param description the critic's `describe()` at the time of the run.
 * @param entry the entry and the image hash that was judged.
 * @param answer the critic's answer, or a `failure` instead of one.
 */
export function buildCritique(critic: Pick<Critic, 'name' | 'version' | 'kind'>, description: CriticDescription, entry: JudgeableEntry, answer: Pick<Critique, 'verdict' | 'findings' | 'usage' | 'failure'>): Critique {
  return {
    schema: CRITIQUE_SCHEMA_VERSION,
    subject: { entryKey: entry.key, imageSha256: entry.imageSha256, state: entry.state },
    critic: { name: critic.name, version: critic.version, ...(critic.kind ? { kind: critic.kind } : {}) },
    ...(description.model ? { model: { ...description.model } } : {}),
    ...(description.parameters ? { parameters: { ...description.parameters } } : {}),
    ...(answer.verdict ? { verdict: answer.verdict } : {}),
    ...(answer.findings ? { findings: answer.findings } : {}),
    ...(answer.failure ? { failure: answer.failure } : {}),
    ...(answer.usage ? { usage: answer.usage } : {})
  };
}

/**
 * The checks of one layer for a set of outcomes, in the order given. A verdict is a `passed` check (the critic ran), a
 * failure a `failed` one with its reason code in `detail`. The score is a measurement named `polish`; each finding is
 * also an annotation of type `critique`. Nothing here decides a result: a low score is `passed`.
 */
export function critiqueChecks(outcomes: readonly CritiqueOutcome[], options: { readonly threshold?: number } = {}): NonNullable<PublishChecksInput['checks']> {
  return outcomes.map(({ entry, critique }) => {
    const verdict = critique.verdict;
    const failure = critique.failure;
    const score = verdict?.score;
    return {
      id: critiqueCheckId(entry.key),
      title: `Critique of ${entry.title}`,
      status: failure ? 'failed' as const : 'passed' as const,
      detail: failure ? `${failure.reason}${failure.message ? `: ${failure.message}` : ''}` : [verdict?.label, score === undefined ? undefined : `score ${score}`].filter(Boolean).join(', '),
      measurements: score !== undefined && Number.isFinite(score) ? [{ name: 'polish', value: score, unit: 'score', ...(options.threshold === undefined ? {} : { limit: options.threshold }) }] : [],
      annotations: (critique.findings ?? []).map(finding => ({
        type: 'critique',
        level: LEVELS[finding.severity ?? 'info'] ?? 'info',
        message: findingMessage(finding),
        ...(finding.id ? { extensions: { [CRITIQUE_EXTENSION]: { finding: finding.id } } } : {})
      })),
      labels: { critic: critique.critic.name, 'critic-version': critique.critic.version, ...(critique.model ? { model: critique.model.id } : {}) },
      extensions: { [CRITIQUE_EXTENSION]: critique }
    };
  });
}

/**
 * The input of `publishChecks` for one critic's outcomes: producer `critic.<name>`, part kind `critique`. The model and
 * critic versions are labels and not part of the slot, so a newer version replaces an older one's critique of the same
 * entry. Pass `parameters` to move something (such as a model version) into the slot instead, to compare side by side.
 *
 * @param args.critic the critic that ran.
 * @param args.outcomes what it produced, successes and failures.
 * @param args.recordedAtMs when, epoch milliseconds. Nothing here reads a clock, so the same input is the same layer.
 */
export function critiqueLayer(args: {
  readonly critic: Pick<Critic, 'name' | 'version'>;
  readonly outcomes: readonly CritiqueOutcome[];
  readonly recordedAtMs: number;
  readonly sha?: string | null;
  readonly branch?: string | null;
  readonly runUrl?: string | null;
  readonly environment?: string | null;
  readonly parameters?: Readonly<Record<string, string>>;
  readonly threshold?: number;
}): PublishChecksInput {
  return {
    producer: criticProducer(args.critic.name),
    kind: CRITIQUE_PART_KIND,
    title: `Critiques by ${args.critic.name}`,
    recordedAtMs: args.recordedAtMs,
    sha: args.sha ?? null,
    branch: args.branch ?? null,
    runUrl: args.runUrl ?? null,
    ...(args.environment === undefined ? {} : { environment: args.environment }),
    parameters: { ...(args.parameters ?? {}) },
    labels: { critic: args.critic.name, 'critic-version': args.critic.version },
    checks: critiqueChecks(args.outcomes, args.threshold === undefined ? {} : { threshold: args.threshold })
  };
}

/**
 * Reads the critique of a check, or `null` when there is none that this reader can read: no `atlas.critique` extension,
 * one that is malformed (a missing `subject`, a score that is not a number), or one of a version this release does not
 * know. The check and its status are never affected: an unreadable opinion is unknown, not a pass and not a failure.
 * Fields and values it does not know (a new category, severity or label) are kept.
 */
export function readCritique(check: { readonly extensions?: Readonly<Record<string, unknown>> | undefined }): Critique | null {
  const raw = check.extensions?.[CRITIQUE_EXTENSION];
  if (raw === undefined) return null;
  const parsed = CritiqueSchema.safeParse(raw);
  if (!parsed.success || parsed.data.schema !== CRITIQUE_SCHEMA_VERSION) return null;
  return parsed.data;
}

/** A critique found in a layer, with where it was found and whether the critic ran. */
export type FoundCritique = {
  readonly layerId: string;
  readonly producer: string;
  readonly recordedAtMs: number;
  readonly checkId: string;
  /** The check's own status: whether the critic ran, never what it thought. */
  readonly status: string;
  readonly critique: Critique;
};

/**
 * Every readable critique in a layer's parts of kind `critique`. Checks whose critique cannot be read are left out, and
 * so is any `atlas.critique` extension in a part of another kind: a test result is never mistaken for an opinion.
 */
export function critiquesOfLayer(layer: { readonly id: string; readonly producer: string; readonly parts: readonly { readonly kind: string; readonly recordedAtMs: number; readonly checks: readonly { readonly id: string; readonly status: string; readonly extensions?: Readonly<Record<string, unknown>> | undefined }[] }[] }): FoundCritique[] {
  const found: FoundCritique[] = [];
  for (const part of layer.parts) {
    if (part.kind !== CRITIQUE_PART_KIND) continue;
    for (const check of part.checks) {
      const critique = readCritique(check);
      if (critique) found.push({ layerId: layer.id, producer: layer.producer, recordedAtMs: part.recordedAtMs, checkId: check.id, status: check.status, critique });
    }
  }
  return found;
}

/**
 * Whether a critique judged the image an entry has now. `current`: yes. `earlier-image`: the entry's image has changed
 * since, so the critique is shown as judging an earlier image and the entry counts as not yet judged by that critic.
 */
export function critiqueCurrency(critique: Pick<Critique, 'subject'>, currentImageSha256: string): 'current' | 'earlier-image' {
  return critique.subject.imageSha256 === currentImageSha256 ? 'current' : 'earlier-image';
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().filter(key => object[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
};

/**
 * The identity of a critique for caching: the critic, its version, the model, the fixed parameters (the rubric hash
 * among them) and the image hash. Two critiques with the same identity are the same judgement, and the second is not
 * made. Key order in `parameters` does not matter.
 */
export function critiqueIdentity(args: { readonly critic: { readonly name: string; readonly version: string }; readonly model?: { readonly id: string; readonly provider?: string | undefined } | undefined; readonly parameters?: Readonly<Record<string, unknown>> | undefined; readonly imageSha256: string }): string {
  return canonical([args.critic.name, args.critic.version, args.model?.id ?? null, args.model?.provider ?? null, args.parameters ?? {}, args.imageSha256]);
}

/** The identity of an existing critique, as {@link critiqueIdentity} computes it for a run. */
export function identityOfCritique(critique: Critique): string {
  return critiqueIdentity({ critic: critique.critic, model: critique.model, parameters: critique.parameters, imageSha256: critique.subject.imageSha256 });
}
