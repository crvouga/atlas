/**
 * @module The critic contract
 *
 * A critic is an automated reviewer of the UI catalog: it is handed one captured UI (an image and what is known about
 * it) and answers with a judgement. Model-based, LLM-based and classic ML or heuristic critics are the same thing
 * here, with no kind privileged: the contract is `describe`, optionally `setup`, and `evaluate` of one image. The
 * runner (`runCritic`) owns everything else: concurrency, retries, rate limits, budgets, caching, publishing and
 * progress. A critic never talks to Atlas, never publishes, and never sees a credential it was not configured with.
 *
 * Critics are producers that publish layers. Atlas never executes one inside the server.
 *
 * @see docs/critics.md
 */
import type { Critique } from '../../schema/src/critique';

/** One captured UI state of the catalog, as a critic is told about it. */
export type CatalogEntry = {
  /** The entry's stable identity in the catalog. */
  readonly key: string;
  /** What a person calls it. */
  readonly title: string;
  /** The route or screen it shows, when known. */
  readonly route?: string;
  /** The kind of UI state: `screen`, `overlay`, `loading`, `error`, `empty`, or anything else the catalog declares. */
  readonly state: string;
  /** The device or browser profile it was captured with, in whatever shape the catalog records it. */
  readonly profile?: unknown;
};

/** An entry to judge together with the hash of the image bytes that were stored for it. */
export type JudgeableEntry = CatalogEntry & {
  /** SHA-256 of the exact image bytes, lowercase hex. A critique is anchored to it, and an identical image is never judged twice. */
  readonly imageSha256: string;
};

/** What a critic says about itself before it runs, so a person can decide whether to run it. */
export type CriticDescription = {
  /** Where images are sent: a host or provider name, or `null` when they never leave the machine. A run that sends images to a third party needs explicit confirmation. */
  readonly sendsImagesTo: string | null;
  /** The model that judges, when there is one. Part of what makes two critiques the same. */
  readonly model?: { readonly id: string; readonly provider?: string };
  /** Everything else that decides the answer and is fixed for the run: temperature, seed, the SHA-256 of the rubric. Part of what makes two critiques the same. Never put a credential here. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** Whether `setup` must run first (for example to download and verify a checkpoint). */
  readonly needsSetup: boolean;
};

/** What `evaluate` is handed: the exact stored bytes, their hash, the entry and a signal that fires on timeout or cancellation. */
export type CriticInput = {
  /** The exact bytes that were stored. */
  readonly image: Uint8Array;
  /** Their SHA-256, lowercase hex. */
  readonly imageSha256: string;
  /** What is known about the UI. */
  readonly entry: CatalogEntry;
  /** Aborted when the call times out or the run is cancelled. A critic that can stop early should. */
  readonly signal: AbortSignal;
};

/**
 * What `evaluate` returns: a critique without its `schema`, `subject`, `critic`, `model` and `parameters`, which the
 * runner fills in from the critic and the entry so they cannot disagree with what was run. A critic that has only a
 * score returns `{ verdict: { score } }`; a richer one adds `findings`.
 */
export type CriticAnswer = Pick<Critique, 'verdict' | 'findings' | 'usage'>;

/**
 * A critic. `evaluate` judges one image and may throw: throw a `CriticError` subclass (`RateLimitedError`,
 * `InvalidOutputError`) to say why, and the runner records the failure and retries it on the next run. It never
 * becomes a score.
 */
export type Critic = {
  /** Short and stable: `uiclip`, `vision-llm`. With the version it names the critic in every critique and, as `critic.<name>`, the producer of its layers. */
  readonly name: string;
  /** Of the critic's own logic. A newer version replaces an older one's critiques and is judged again. */
  readonly version: string;
  /** Open vocabulary: `model`, `llm`, `ml`, `heuristic`, or anything else. */
  readonly kind?: string;
  /** Where images go, which model, which fixed parameters, whether setup is needed. */
  describe(): CriticDescription;
  /** Provisions what the critic needs, such as downloading and verifying a checkpoint. Inference never downloads anything. */
  setup?(): Promise<void>;
  /** Judges one image. */
  evaluate(input: CriticInput): Promise<CriticAnswer>;
};

/**
 * Why a critic could not produce a verdict. `reason` is a code in an open vocabulary and is what is recorded in the
 * critique (`failure.reason`); the message is recorded too, after credentials are redacted from it.
 */
export class CriticError extends Error {
  /** @param reason the code recorded in the critique, such as `error`, `timeout`, `rate-limited`, `invalid-output`. */
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = 'CriticError';
  }
}

/** A provider answered that it is rate limited. `retryAfterMs` is its `Retry-After`, when it said: the runner waits at least that long before trying again. */
export class RateLimitedError extends CriticError {
  /** @param retryAfterMs milliseconds the provider asked to wait, when it said. */
  constructor(message: string, readonly retryAfterMs?: number) {
    super('rate-limited', message);
    this.name = 'RateLimitedError';
  }
}

/** A provider answered with something that is not the structure that was asked for. The entry is recorded as failed and no score is invented. */
export class InvalidOutputError extends CriticError {
  constructor(message: string) {
    super('invalid-output', message);
    this.name = 'InvalidOutputError';
  }
}

/**
 * Checks a critic's shape and returns it unchanged, so a typo is found where the critic is defined and not in the middle
 * of a run. Throws when the name is not made of lowercase letters, digits, `-` and `.`, or when the version is empty.
 *
 * @example
 * export default defineCritic({
 *   name: 'contrast', version: '1.0.0', kind: 'heuristic',
 *   describe: () => ({ sendsImagesTo: null, needsSetup: false }),
 *   evaluate: async ({ image }) => ({ verdict: { score: measureContrast(image), scale: '0..1, higher is better' } })
 * });
 */
export function defineCritic<T extends Critic>(critic: T): T {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(critic.name)) throw new Error(`Invalid critic name "${critic.name}": use lowercase letters, digits, "-" and "."`);
  if (!critic.version) throw new Error(`Critic "${critic.name}" has no version`);
  return critic;
}
