/**
 * @module The critic runner
 *
 * Runs one critic over entries of the UI catalog and returns the critiques to publish. The runner, not the critic, owns
 * everything around the judgement: skipping what was already judged (same critic, version, model, parameters and image
 * hash), fetching images only when needed, a bounded number of concurrent calls, a per-call timeout, retries with
 * jittered backoff that honour a provider's `Retry-After`, budgets (images, tokens, money) that stop the run cleanly,
 * and credential redaction of every message it records. Failures are data: a crash, a timeout, a rate limit that never
 * cleared and an unparseable answer each become a critique with a `failure` and a reason code, which the next run
 * retries, and never a score.
 *
 * Results are returned in the order of the entries, so the same inputs publish the same layer. Nothing here reads a
 * clock, the environment or the network on its own: images, time, sleeping and randomness are passed in.
 *
 * @see docs/critics.md#running-critics
 */
import { z } from 'zod/v4';

import type { Critique } from '../../schema/src/critique';
import { sha256Hex } from '../../reports/src/sigv4';
import { CriticError, InvalidOutputError, RateLimitedError, type Critic, type CriticAnswer, type JudgeableEntry } from './contract';
import { buildCritique, critiqueIdentity, identityOfCritique, type CritiqueOutcome } from './critique';
import { createRedactor, type Redactor } from './credentials';

/** The most a run may spend before it stops cleanly. Any limit left out is unlimited. */
export type Budget = {
  /** The most images to start judging in one run (retries of one image count once). */
  readonly maxImages?: number;
  /** The most tokens (input and output) to spend, summed from what critics report as `usage`. */
  readonly maxTokens?: number;
  /** The most money to spend, in US dollars, summed from what critics report as `usage.costUsd`. */
  readonly maxCostUsd?: number;
};

/** What a run was told to do and how. Everything but the critic, the entries and `loadImage` has a default. */
export type RunOptions = {
  /** The critic to run. */
  readonly critic: Critic;
  /** The entries to judge, each with the hash of its stored image. Judged in this order; a repeated key is judged once. */
  readonly entries: Iterable<JudgeableEntry> | AsyncIterable<JudgeableEntry>;
  /** Fetches an entry's image bytes. Called only for entries that will be judged. The runner checks the bytes against `imageSha256`. */
  readonly loadImage: (entry: JudgeableEntry) => Promise<Uint8Array>;
  /** Critiques that already exist (read with `critiquesOfLayer`). One with a verdict and the same identity as this run's makes the image skipped; a failed one does not. */
  readonly existing?: readonly Critique[];
  /** Judge again even when a current critique exists. */
  readonly force?: boolean;
  /** Plan only: count what would be judged and skipped and say where images would go. Nothing is loaded, sent or returned to publish. */
  readonly dryRun?: boolean;
  /** Most calls in flight at once. Default 4. */
  readonly concurrency?: number;
  /** Most attempts for one image when the provider is rate limited. Default 4. */
  readonly maxAttempts?: number;
  /** A call that takes longer than this is recorded as `timeout`, and the run goes on. Default 60 000. */
  readonly timeoutMs?: number;
  /** Backoff between attempts: `baseMs` doubles each attempt up to `maxMs`, with full jitter, and never less than `Retry-After`. Defaults 500 and 30 000. */
  readonly backoff?: { readonly baseMs?: number; readonly maxMs?: number };
  /** Stop cleanly when any limit is reached. */
  readonly budget?: Budget;
  /** Credentials this run holds. Every recorded message has them removed. */
  readonly secrets?: readonly string[];
  /** Cancels the run: in-flight calls are aborted, what finished is returned. */
  readonly signal?: AbortSignal;
  /** Waits. Default `setTimeout`. Tests pass a fake. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** A number in [0, 1) for jitter. Default `Math.random`. */
  readonly random?: () => number;
  /** Called after each entry is finished or skipped, for progress. Receives no image bytes and no credentials. */
  readonly onProgress?: (event: ProgressEvent) => void;
};

/** One step of progress. `waiting` counts entries not yet started. */
export type ProgressEvent = {
  readonly entryKey: string;
  readonly result: 'judged' | 'skipped' | 'failed';
  readonly judged: number;
  readonly skipped: number;
  readonly failed: number;
  readonly waiting: number;
};

/** Why a run ended before every entry was handled: it `budget`ed out or was `aborted`. */
export type StoppedBy = 'budget' | 'aborted';

/** What a run did. `outcomes` are what to publish (verdicts and failures); counts and `spent` are for the summary. */
export type RunResult = {
  readonly critic: { readonly name: string; readonly version: string };
  /** Where images are sent, as the critic described it. */
  readonly sendsImagesTo: string | null;
  /** The critiques to publish, in entry order: verdicts and failures. */
  readonly outcomes: readonly CritiqueOutcome[];
  /** Entries with a current critique that were not judged again. */
  readonly skipped: number;
  /** Entries judged with a verdict. */
  readonly judged: number;
  /** Entries recorded as failed. */
  readonly failed: number;
  /** Entries left unhandled because the run stopped. */
  readonly waiting: number;
  /** Set when the run stopped early, and why. */
  readonly stoppedBy?: StoppedBy;
  /** What the run spent, from the usage critics reported. */
  readonly spent: { readonly images: number; readonly tokens: number; readonly costUsd: number };
  /** Whether this was a dry run: nothing was loaded, sent or to publish. */
  readonly dryRun: boolean;
};

/** The shape a critic's answer must have. A score that is not a finite number, or a finding with a bad region, is `invalid-output`. */
const AnswerSchema = z.object({
  verdict: z.looseObject({ score: z.number().finite().optional(), confidence: z.number().min(0).max(1).optional() }).optional(),
  findings: z.array(z.looseObject({ confidence: z.number().min(0).max(1).optional() })).optional(),
  usage: z.looseObject({ inputTokens: z.number().nonnegative().optional(), outputTokens: z.number().nonnegative().optional(), latencyMs: z.number().nonnegative().optional(), costUsd: z.number().nonnegative().optional() }).optional()
}).refine(answer => answer.verdict !== undefined || (answer.findings !== undefined && answer.findings.length > 0), 'the answer has neither a verdict nor findings');

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => {
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
});

const sha256Bytes = (bytes: Uint8Array) => sha256Hex(bytes);

/** Races a critic's call against a timeout and the run's cancellation. Rejects with `CriticError('timeout')` on timeout. */
async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, outer: AbortSignal | undefined): Promise<T> {
  const controller = new AbortController();
  const onOuter = () => controller.abort(outer?.reason);
  if (outer?.aborted) controller.abort(outer.reason);
  else outer?.addEventListener('abort', onOuter, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        // Settle first: aborting may make the critic's own call reject at once, and the reason must be the timeout.
        timer = setTimeout(() => { reject(new CriticError('timeout', `The critic did not answer within ${timeoutMs} ms`)); controller.abort(new Error('timeout')); }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}

/** Collects a sync or async iterable, keeping the first of each key. */
async function collect(entries: RunOptions['entries']): Promise<JudgeableEntry[]> {
  const seen = new Set<string>();
  const out: JudgeableEntry[] = [];
  for await (const entry of entries as AsyncIterable<JudgeableEntry>) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    out.push(entry);
  }
  return out;
}

/**
 * Runs a critic over entries. Entries with a current critique of the same identity are skipped without fetching their
 * image; the rest are judged with bounded concurrency, a timeout and retries. The run never throws for a critic's
 * failure: it records it. It throws only for a wrong call (a non-positive `concurrency`, `maxAttempts` or `timeoutMs`).
 *
 * A run stops cleanly when a budget is reached or the signal aborts: calls in flight finish (or are aborted), what was
 * finished is returned in `outcomes` to publish, and `stoppedBy` says why. With concurrency above 1 a budget can be
 * overshot by the calls already in flight.
 *
 * @example
 * const result = await runCritic({ critic, entries, loadImage: entry => fetchImage(entry), existing, budget: { maxImages: 200 } });
 * await publishChecks(store, critiqueLayer({ critic, outcomes: result.outcomes, recordedAtMs: Date.now() }));
 */
export async function runCritic(options: RunOptions): Promise<RunResult> {
  const concurrency = options.concurrency ?? 4;
  const maxAttempts = options.maxAttempts ?? 4;
  const timeoutMs = options.timeoutMs ?? 60_000;
  for (const [name, value] of [['concurrency', concurrency], ['maxAttempts', maxAttempts], ['timeoutMs', timeoutMs]] as const) {
    if (!Number.isFinite(value) || value < 1) throw new Error(`Invalid ${name}: ${value}`);
  }
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const redact: Redactor = createRedactor(options.secrets ?? []);
  const { critic } = options;
  const description = critic.describe();
  const entries = await collect(options.entries);

  const known = new Set<string>();
  if (!options.force) for (const critique of options.existing ?? []) if (critique.verdict !== undefined && !critique.failure) known.add(identityOfCritique(critique));
  const isKnown = (entry: JudgeableEntry) => known.has(critiqueIdentity({ critic, model: description.model, parameters: description.parameters, imageSha256: entry.imageSha256 }));

  const slots: (CritiqueOutcome | 'skipped' | undefined)[] = entries.map(entry => (isKnown(entry) ? 'skipped' : undefined));
  const identity = { name: critic.name, version: critic.version };
  const toJudge = slots.filter(slot => slot === undefined).length;
  if (options.dryRun) {
    return { critic: identity, sendsImagesTo: description.sendsImagesTo, outcomes: [], skipped: entries.length - toJudge, judged: 0, failed: 0, waiting: toJudge, spent: { images: 0, tokens: 0, costUsd: 0 }, dryRun: true };
  }

  const budget = options.budget ?? {};
  const spent = { images: 0, tokens: 0, costUsd: 0 };
  let judged = 0, failed = 0, skipped = entries.length - toJudge, stoppedBy: StoppedBy | undefined;
  const exhausted = () =>
    (budget.maxImages !== undefined && spent.images >= budget.maxImages) ||
    (budget.maxTokens !== undefined && spent.tokens >= budget.maxTokens) ||
    (budget.maxCostUsd !== undefined && spent.costUsd >= budget.maxCostUsd);
  const progress = (entry: JudgeableEntry, result: ProgressEvent['result']) => options.onProgress?.({ entryKey: entry.key, result, judged, skipped, failed, waiting: slots.filter(slot => slot === undefined).length - inFlight });
  let inFlight = 0;

  const fail = (entry: JudgeableEntry, reason: string, message: string): CritiqueOutcome => ({
    entry,
    critique: buildCritique(critic, description, entry, { failure: { reason, message: redact(message).slice(0, 500) } })
  });

  /** Judges one entry; `null` when the run was cancelled meanwhile, because a cancelled call is not a failure of the critic. */
  async function judge(entry: JudgeableEntry): Promise<CritiqueOutcome | null> {
    let image: Uint8Array;
    try {
      image = await options.loadImage(entry);
    } catch (error) {
      return fail(entry, 'image-unavailable', error instanceof Error ? error.message : String(error));
    }
    if ((await sha256Bytes(image)) !== entry.imageSha256) return fail(entry, 'image-mismatch', 'The image bytes are not the ones the catalog hashed; nothing was judged');
    for (let attempt = 1; ; attempt++) {
      if (options.signal?.aborted) return null;
      try {
        const answer = await withTimeout(signal => critic.evaluate({ image, imageSha256: entry.imageSha256, entry: { key: entry.key, title: entry.title, state: entry.state, ...(entry.route === undefined ? {} : { route: entry.route }), ...(entry.profile === undefined ? {} : { profile: entry.profile }) }, signal }), timeoutMs, options.signal);
        const checked = AnswerSchema.safeParse(answer);
        if (!checked.success) throw new InvalidOutputError(`The answer is not a critique: ${checked.error.issues[0]?.message ?? 'unknown'}`);
        const usage = (answer as CriticAnswer).usage;
        spent.tokens += (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
        spent.costUsd += usage?.costUsd ?? 0;
        return { entry, critique: buildCritique(critic, description, entry, answer as CriticAnswer) };
      } catch (error) {
        if (options.signal?.aborted) return null;
        if (error instanceof RateLimitedError && attempt < maxAttempts && !options.signal?.aborted) {
          const base = options.backoff?.baseMs ?? 500, cap = options.backoff?.maxMs ?? 30_000;
          const jittered = Math.floor(random() * Math.min(cap, base * 2 ** (attempt - 1)));
          await sleep(Math.max(error.retryAfterMs ?? 0, jittered), options.signal);
          continue;
        }
        if (error instanceof CriticError) return fail(entry, error.reason, error.message);
        return fail(entry, 'error', error instanceof Error ? error.message : String(error));
      }
    }
  }

  let next = 0;
  async function worker() {
    for (;;) {
      if (options.signal?.aborted) { stoppedBy ??= 'aborted'; return; }
      if (exhausted()) { stoppedBy ??= 'budget'; return; }
      let index = next;
      while (index < entries.length && slots[index] !== undefined) index++;
      if (index >= entries.length) return;
      next = index + 1;
      const entry = entries[index]!;
      inFlight += 1;
      spent.images += 1;
      const outcome = await judge(entry);
      inFlight -= 1;
      if (!outcome) { stoppedBy ??= 'aborted'; return; }
      slots[index] = outcome;
      if (outcome.critique.failure) failed += 1; else judged += 1;
      progress(entry, outcome.critique.failure ? 'failed' : 'judged');
    }
  }
  for (let index = 0; index < entries.length; index++) if (slots[index] === 'skipped') progress(entries[index]!, 'skipped');
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(toJudge, 1)) }, worker));

  // A run that handled every entry did not stop early, whatever the budget now says.
  const waiting = slots.filter(slot => slot === undefined).length;
  const outcomes = slots.filter((slot): slot is CritiqueOutcome => slot !== undefined && slot !== 'skipped');
  return { critic: identity, sendsImagesTo: description.sendsImagesTo, outcomes, skipped, judged, failed, waiting, ...(waiting > 0 && stoppedBy ? { stoppedBy } : {}), spent, dryRun: false };
}
