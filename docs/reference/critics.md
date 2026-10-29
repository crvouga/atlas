# Reference: critics

Automated reviewers of the UI catalog: the critic contract, the runner (caching, retries, rate limits, budgets), credential references and redaction, the `atlas.critique` evidence as layers, calibration and report, warn and gate modes. Import path `@crvouga/atlas/critics`.

> Generated from the doc comments of `packages/critics/src` by `bun run docs`. Do not edit: change the comment next to the code.

### The critic contract

Source: `packages/critics/src/contract.ts`

A critic is an automated reviewer of the UI catalog: it is handed one captured UI (an image and what is known about
it) and answers with a judgement. Model-based, LLM-based and classic ML or heuristic critics are the same thing
here, with no kind privileged: the contract is `describe`, optionally `setup`, and `evaluate` of one image. The
runner (`runCritic`) owns everything else: concurrency, retries, rate limits, budgets, caching, publishing and
progress. A critic never talks to Atlas, never publishes, and never sees a credential it was not configured with.

Critics are producers that publish layers. Atlas never executes one inside the server.

See docs/critics.md

#### `CatalogEntry`

```ts
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
```

One captured UI state of the catalog, as a critic is told about it.

#### `JudgeableEntry`

```ts
export type JudgeableEntry = CatalogEntry & {
  /** SHA-256 of the exact image bytes, lowercase hex. A critique is anchored to it, and an identical image is never judged twice. */
  readonly imageSha256: string;
};
```

An entry to judge together with the hash of the image bytes that were stored for it.

#### `CriticDescription`

```ts
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
```

What a critic says about itself before it runs, so a person can decide whether to run it.

#### `CriticInput`

```ts
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
```

What `evaluate` is handed: the exact stored bytes, their hash, the entry and a signal that fires on timeout or cancellation.

#### `CriticAnswer`

```ts
export type CriticAnswer = Pick<Critique, 'verdict' | 'findings' | 'usage'>;
```

What `evaluate` returns: a critique without its `schema`, `subject`, `critic`, `model` and `parameters`, which the
runner fills in from the critic and the entry so they cannot disagree with what was run. A critic that has only a
score returns `{ verdict: { score } }`; a richer one adds `findings`.

#### `Critic`

```ts
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
```

A critic. `evaluate` judges one image and may throw: throw a `CriticError` subclass (`RateLimitedError`,
`InvalidOutputError`) to say why, and the runner records the failure and retries it on the next run. It never
becomes a score.

#### `CriticError`

```ts
export class CriticError extends Error
```

Why a critic could not produce a verdict. `reason` is a code in an open vocabulary and is what is recorded in the
critique (`failure.reason`); the message is recorded too, after credentials are redacted from it.

#### `RateLimitedError`

```ts
export class RateLimitedError extends CriticError
```

A provider answered that it is rate limited. `retryAfterMs` is its `Retry-After`, when it said: the runner waits at least that long before trying again.

#### `InvalidOutputError`

```ts
export class InvalidOutputError extends CriticError
```

A provider answered with something that is not the structure that was asked for. The entry is recorded as failed and no score is invented.

#### `defineCritic`

```ts
export function defineCritic<T extends Critic>(critic: T): T
```

Checks a critic's shape and returns it unchanged, so a typo is found where the critic is defined and not in the middle
of a run. Throws when the name is not made of lowercase letters, digits, `-` and `.`, or when the version is empty.

**Example**

```ts
export default defineCritic({
  name: 'contrast', version: '1.0.0', kind: 'heuristic',
  describe: () => ({ sendsImagesTo: null, needsSetup: false }),
  evaluate: async ({ image }) => ({ verdict: { score: measureContrast(image), scale: '0..1, higher is better' } })
});
```

### Credentials for bring-your-own-AI critics

Source: `packages/critics/src/credentials.ts`

Configuration names a credential by reference (`env:OPENAI_API_KEY`, `file:~/.config/key`) and never contains one,
so it can be committed. A credential is read at run time and never written to a layer, a log, an error message, a
progress display, a cache file or JSON output: everything a run writes goes through a redactor built from the
credentials the run holds. A configuration that contains a literal credential is refused with a message that names
where it is and never repeats it.

See docs/critics.md#credentials

#### `CredentialRef`

```ts
export type CredentialRef = { readonly scheme: 'env'; readonly name: string } | { readonly scheme: 'file'; readonly path: string };
```

A credential by reference: the environment variable that holds it, or the file that does.

#### `REDACTED`

```ts
export const REDACTED = …
```

The text that stands for a credential in anything written.

#### `parseCredentialRef`

```ts
export function parseCredentialRef(text: string): CredentialRef | null
```

Reads a reference such as `env:OPENAI_API_KEY` or `file:/run/secrets/key`.

Returns `null` when the text is not a reference (so it may be a literal credential, which configuration must not
contain).

**Example**

```ts
parseCredentialRef('env:SOME_API_KEY'); // { scheme: 'env', name: 'SOME_API_KEY' }
```

#### `resolveCredential`

```ts
export async function resolveCredential(ref: string, source: { readonly env?: Readonly<Record<string, string | undefined>>; readonly readFile?: (path: string) => Promise<string> } = {}): Promise<string>
```

Resolves a reference to the credential it names, at run time.

Throws, naming the reference and never a value, when the text is not a reference, the variable is unset or empty, or
the file cannot be read or is empty. A trailing newline in a file is not part of the credential.

- `ref`: the reference from configuration.

- `source`: where to read from; the defaults are the process environment and the file system. Tests pass fakes.

#### `LiteralCredential`

```ts
export type LiteralCredential = { readonly path: string; readonly reason: string };
```

A place in a configuration that holds a literal credential: where, and why it was judged one. Never the value.

#### `findLiteralCredentials`

```ts
export function findLiteralCredentials(config: unknown, path = ''): LiteralCredential[]
```

Finds literal credentials in a configuration: a string under a key named like a credential (`apiKey`, `token`,
`secret`…) that is not a reference, and any string anywhere that has the shape of a provider key, token or JWT.
A key whose name ends in `Ref` or `Env`, or whose value is a reference, is fine.

Returns the findings in document order; the value of a finding is never included.

#### `assertNoLiteralCredentials`

```ts
export function assertNoLiteralCredentials(config: unknown): void
```

Refuses a configuration that contains a literal credential. Throws one error that lists every place, with the reason
and never the value.

#### `Redactor`

```ts
export type Redactor = (text: string) => string;
```

Replaces credentials in text with {@link REDACTED}.

#### `createRedactor`

```ts
export function createRedactor(secrets: readonly string[]): Redactor
```

Builds a redactor for the credentials a run holds. It removes each secret (and its URL-encoded and base64 forms) and
anything shaped like a provider key, token or JWT. Secrets shorter than 6 characters are ignored, because replacing
them would damage ordinary text and they are not credentials.

- `secrets`: the resolved credentials of the run.

### Critiques as layers

Source: `packages/critics/src/critique.ts`

Turns a critic's judgements into the checks of a layer (`critiqueChecks`, `critiqueLayer`) and reads them back
(`readCritique`, `critiquesOfLayer`). A critique is a check in a part of kind `critique` whose `status` says whether
the critic ran; the opinion is in `extensions["atlas.critique"]`, and is repeated in standard evidence (a
measurement for the score, an annotation for each finding) so a viewer that has never heard of critics still shows
it. Critiques are anchored to the image hash they judged: when an entry's image changes, an older critique is still
shown, as judging an earlier image, and the entry counts as not yet judged (`critiqueCurrency`).

See docs/critics.md
See docs/extending.md

#### `CRITIQUE_CHECK_PREFIX`

```ts
export const CRITIQUE_CHECK_PREFIX = …
```

The prefix of the id of every critique check: `critique/<entry key>`. It keeps a critique from ever sharing a slot with a test.

#### `CritiqueOutcome`

```ts
export type CritiqueOutcome = {
  /** The entry and the image that was judged. */
  readonly entry: JudgeableEntry;
  /** The critique with its subject, critic and verdict (or failure) filled in. */
  readonly critique: Critique;
};
```

The result of judging one entry: a critique, or the reason there is none. Either way it has what it judged.

#### `critiqueCheckId`

```ts
export function critiqueCheckId(entryKey: string): string
```

The check ids and labels one critique is published under.

#### `criticProducer`

```ts
export function criticProducer(criticName: string): string
```

`critic.<name>`: the producer of every layer of the critic's critiques. A critic-scoped token may publish only such layers.

#### `buildCritique`

```ts
export function buildCritique(critic: Pick<Critic, 'name' | 'version' | 'kind'>, description: CriticDescription, entry: JudgeableEntry, answer: Pick<Critique, 'verdict' | 'findings' | 'usage' | 'failure'>): Critique
```

Builds the critique a critic produced for an entry. It fills in `schema`, `subject`, `critic`, `model` and
`parameters` from the critic and the entry (so they cannot disagree with what was run) and keeps the verdict,
findings and usage as given.

- `critic`: the critic that ran.

- `description`: the critic's `describe()` at the time of the run.

- `entry`: the entry and the image hash that was judged.

- `answer`: the critic's answer, or a `failure` instead of one.

#### `critiqueChecks`

```ts
export function critiqueChecks(outcomes: readonly CritiqueOutcome[], options: { readonly threshold?: number } = {}): NonNullable<PublishChecksInput['checks']>
```

The checks of one layer for a set of outcomes, in the order given. A verdict is a `passed` check (the critic ran), a
failure a `failed` one with its reason code in `detail`. The score is a measurement named `polish`; each finding is
also an annotation of type `critique`. Nothing here decides a result: a low score is `passed`.

#### `critiqueLayer`

```ts
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
}): PublishChecksInput
```

The input of `publishChecks` for one critic's outcomes: producer `critic.<name>`, part kind `critique`. The model and
critic versions are labels and not part of the slot, so a newer version replaces an older one's critique of the same
entry. Pass `parameters` to move something (such as a model version) into the slot instead, to compare side by side.

- `args.critic`: the critic that ran.

- `args.outcomes`: what it produced, successes and failures.

- `args.recordedAtMs`: when, epoch milliseconds. Nothing here reads a clock, so the same input is the same layer.

#### `readCritique`

```ts
export function readCritique(check: { readonly extensions?: Readonly<Record<string, unknown>> | undefined }): Critique | null
```

Reads the critique of a check, or `null` when there is none that this reader can read: no `atlas.critique` extension,
one that is malformed (a missing `subject`, a score that is not a number), or one of a version this release does not
know. The check and its status are never affected: an unreadable opinion is unknown, not a pass and not a failure.
Fields and values it does not know (a new category, severity or label) are kept.

#### `FoundCritique`

```ts
export type FoundCritique = {
  readonly layerId: string;
  readonly producer: string;
  readonly recordedAtMs: number;
  readonly checkId: string;
  /** The check's own status: whether the critic ran, never what it thought. */
  readonly status: string;
  readonly critique: Critique;
};
```

A critique found in a layer, with where it was found and whether the critic ran.

#### `critiquesOfLayer`

```ts
export function critiquesOfLayer(layer: { readonly id: string; readonly producer: string; readonly parts: readonly { readonly kind: string; readonly recordedAtMs: number; readonly checks: readonly { readonly id: string; readonly status: string; readonly extensions?: Readonly<Record<string, unknown>> | undefined }[] }[] }): FoundCritique[]
```

Every readable critique in a layer's parts of kind `critique`. Checks whose critique cannot be read are left out, and
so is any `atlas.critique` extension in a part of another kind: a test result is never mistaken for an opinion.

#### `critiqueCurrency`

```ts
export function critiqueCurrency(critique: Pick<Critique, 'subject'>, currentImageSha256: string): 'current' | 'earlier-image'
```

Whether a critique judged the image an entry has now. `current`: yes. `earlier-image`: the entry's image has changed
since, so the critique is shown as judging an earlier image and the entry counts as not yet judged by that critic.

#### `critiqueIdentity`

```ts
export function critiqueIdentity(args: { readonly critic: { readonly name: string; readonly version: string }; readonly model?: { readonly id: string; readonly provider?: string | undefined } | undefined; readonly parameters?: Readonly<Record<string, unknown>> | undefined; readonly imageSha256: string }): string
```

The identity of a critique for caching: the critic, its version, the model, the fixed parameters (the rubric hash
among them) and the image hash. Two critiques with the same identity are the same judgement, and the second is not
made. Key order in `parameters` does not matter.

#### `identityOfCritique`

```ts
export function identityOfCritique(critique: Critique): string
```

The identity of an existing critique, as {@link critiqueIdentity} computes it for a run.

### Critics (`@crvouga/atlas/critics`)

Source: `packages/critics/src/index.ts`. Import: `@crvouga/atlas/critics`

Automated reviewers of the UI catalog that mark which UIs need polish. A critic is a producer: it judges one captured
UI at a time through one small contract (`defineCritic`), the runner (`runCritic`) owns concurrency, retries, rate
limits, budgets and caching, and the opinions are stored as ordinary layers of parts of kind `critique` with the
`atlas.critique` evidence (`critiqueLayer`, `readCritique`). A critique never changes whether a report passes: it is
not a test result, is not counted, and only a project that opts in to `gate` mode can fail a command on a score, and
only from calibrated, held-out evidence. Model-based, LLM-based and heuristic critics are the same on every
path. Nothing here needs a model, a provider SDK or a network; critics bring their own.

See docs/critics.md

### State-aware judging, calibration and modes

Source: `packages/critics/src/judging.ts`

A raw score is not absolute. A loading overlay is not a full screen, so a score is read against the project's scores
of the same state kind (`relativeVerdict`), and a threshold is measured per critic and per state kind against labelled
examples (`calibrate`), recording sample sizes, precision and recall and whether the figures are in-sample or
held-out. What happens when a score is low is the project's choice (`gateDecision`): `report` (shown, never fails
anything), `warn` (surfaced on the command line) or `gate` (exit code 1 when a threshold is crossed, but only on a
calibration with enough held-out evidence). A gate is computed here, by the reader, from critique data. It never
changes a check's status, a slot or a winner.

All scores are "higher is better". Everything here is pure.

See docs/critics.md#state-aware-judging-calibration-and-modes

#### `Relative`

```ts
export type Relative = NonNullable<NonNullable<Critique['verdict']>['relative']>;
```

The relative reading of a score, as stored in `verdict.relative`.

#### `relativeVerdict`

```ts
export function relativeVerdict(args: { readonly score: number; readonly stateKind: string; readonly population: readonly { readonly stateKind: string; readonly score: number }[]; readonly previousScore?: number }): Relative
```

Reads a score against the scores of the same state kind, and against the same entry's previous image.

`percentile` is where the score falls among the population's scores of `stateKind` (ties count half), 0..100, higher
is better; it is absent when no score of that state kind is known. Scores of other state kinds are ignored, so a
loading overlay is compared with other loading overlays and never with full screens. `delta` is the score minus
`previousScore` when there was one.

- `args.score`: the entry's raw score.

- `args.stateKind`: the kind of UI state of the entry.

- `args.population`: every known score of the critic, with its state kind. May include the entry's own.

- `args.previousScore`: the critic's score for the entry's previous image, when there was one.

#### `LabelledExample`

```ts
export type LabelledExample = {
  readonly score: number;
  readonly stateKind: string;
  /** True when the UI needs polish: a positive for the critic to find. */
  readonly bad: boolean;
  /** True for an example the threshold was not chosen on. */
  readonly heldOut?: boolean;
};
```

A labelled example for calibration: the critic's score for a UI, its state kind, and whether people judged it bad (needs polish).

#### `KindCalibration`

```ts
export type KindCalibration = {
  readonly stateKind: string;
  /** Scores below this are flagged as needing polish. `null`: none could be chosen. */
  readonly threshold: number | null;
  /** Examples of this state kind, all together. */
  readonly samples: number;
  /** How many of them are bad, and how many good. */
  readonly positives: number;
  readonly negatives: number;
  /** Of what was flagged, the share that was bad; `null` when nothing was flagged. Measured on the examples named by `evaluatedOn`. */
  readonly precision: number | null;
  /** Of what was bad, the share that was flagged; `null` when nothing was bad. */
  readonly recall: number | null;
  /** True when the figures are measured on the examples the threshold was chosen on, which flatters them. */
  readonly inSample: boolean;
  /** Which examples the precision and recall are over: the `fit` examples (in-sample) or the `held-out` ones. */
  readonly evaluatedOn: 'fit' | 'held-out';
};
```

The calibration of one state kind. `threshold` flags a score below it; `null` when the examples cannot tell (one class missing).

#### `Calibration`

```ts
export type Calibration = {
  readonly schema: 1;
  readonly critic: { readonly name: string; readonly version: string };
  readonly kinds: readonly KindCalibration[];
};
```

The result of `calibrate`: per state kind, with the critic's provenance.

#### `calibrate`

```ts
export function calibrate(critic: { readonly name: string; readonly version: string }, examples: readonly LabelledExample[]): Calibration
```

Measures a critic against labelled examples, per state kind, and proposes a threshold for each.

The threshold of a state kind is chosen on its examples that are not `heldOut` (best F1, then best precision, then
the lower threshold), among the midpoints between neighbouring scores. If there are held-out examples of that kind,
precision and recall are measured on them and `inSample` is false; otherwise they are measured on the same examples
the threshold was chosen on and `inSample` is true, so nobody mistakes them for evidence. A state kind without both
a good and a bad example gets `threshold: null`. State kinds come out sorted.

- `critic`: the critic whose scores these are.

- `examples`: labelled examples; scores must be finite.

#### `GateMode`

```ts
export type GateMode = 'report' | 'warn' | 'gate';
```

What happens when a score is below its threshold. `report` shows it and never fails anything. `warn` surfaces it on the command line. `gate` exits 1.

#### `MinimumEvidence`

```ts
export type MinimumEvidence = {
  /** Bad examples and good examples of the state kind, each. Default 10. */
  readonly perClass: number;
  /** Whether precision and recall must be measured on held-out examples. Default true. */
  readonly heldOut: boolean;
};
```

The least evidence a calibration must have before `gate` is allowed.

#### `DEFAULT_MINIMUM_EVIDENCE`

```ts
export const DEFAULT_MINIMUM_EVIDENCE: MinimumEvidence
```

The default minimum evidence for `gate`: 10 bad and 10 good examples per state kind, measured on held-out examples.

#### `BelowThreshold`

```ts
export type BelowThreshold = { readonly entryKey: string; readonly stateKind: string; readonly score: number; readonly threshold: number };
```

A score below its state kind's threshold.

#### `GateDecision`

```ts
export type GateDecision = {
  readonly mode: GateMode;
  /** 0 it passes (always, in `report` and `warn`), 1 a threshold was crossed in `gate`, 2 `gate` was refused for lack of evidence. */
  readonly exitCode: 0 | 1 | 2;
  /** Scores below their threshold, in the order given. */
  readonly below: readonly BelowThreshold[];
  /** Entries with no score to judge (the critic failed or gave none). Never counted as below, never as fine. */
  readonly unjudged: readonly string[];
  /** For `warn`: one line per score below its threshold. */
  readonly warnings: readonly string[];
  /** For a refused `gate`: what is missing, per state kind. */
  readonly refusal: readonly string[];
};
```

The decision: the exit code and why. `refusal` is set when `gate` was asked for without enough evidence.

#### `gateDecision`

```ts
export function gateDecision(args: {
  readonly mode: GateMode;
  readonly critic: { readonly name: string; readonly version: string };
  readonly scores: readonly { readonly entryKey: string; readonly stateKind: string; readonly score: number | null }[];
  readonly calibration?: Calibration;
  readonly thresholds?: Readonly<Record<string, number>>;
  readonly minimum?: MinimumEvidence;
}): GateDecision
```

Decides what a set of critic scores means for the exit code of a command.

`report` and `warn` always give exit code 0 (`warn` also lists a warning for each score below its threshold).
`gate` gives 1 when any score is below its state kind's threshold, but first requires, for every state kind present, a
calibration of this critic and version with a threshold and at least `minimum.perClass` bad and good examples,
measured on held-out examples when `minimum.heldOut`. Without that it refuses (exit 2) and says what is missing.
An explicit `thresholds` entry replaces the calibrated threshold of its state kind but never waives the evidence.

- `args.scores`: the critic's scores, one per entry; `score: null` for an entry it could not judge.

- `args.calibration`: the critic's calibration, when there is one.

- `args.thresholds`: thresholds by state kind that replace the calibrated ones.

### Publishing critiques

Source: `packages/critics/src/publish.ts`

`publishCritiques` publishes a critic's outcomes as one layer through any store, after checking that the layer is
within what a critic-scoped credential may publish. The layer is content-addressed, so publishing the same outcomes
again writes the same layer and changes nothing.

See docs/critics.md

#### `publishCritiques`

```ts
export async function publishCritiques(store: ObjectStore, args: Parameters<typeof critiqueLayer>[0], options: PublishChecksOptions = {}): Promise<ReportLayer | null>
```

Publishes the layer {@link critiqueLayer} builds for `args`. Returns the stored layer, or `null` when there is nothing
to publish (no outcomes). Throws when the layer would be outside a critic's scope, which cannot happen for a layer
built here and is checked so that a change cannot make it happen quietly.

- `store`: where to publish.

- `args`: see {@link critiqueLayer}.

- `options`: attachment limits, as for `publishChecks`.

### The critic runner

Source: `packages/critics/src/runner.ts`

Runs one critic over entries of the UI catalog and returns the critiques to publish. The runner, not the critic, owns
everything around the judgement: skipping what was already judged (same critic, version, model, parameters and image
hash), fetching images only when needed, a bounded number of concurrent calls, a per-call timeout, retries with
jittered backoff that honour a provider's `Retry-After`, budgets (images, tokens, money) that stop the run cleanly,
and credential redaction of every message it records. Failures are data: a crash, a timeout, a rate limit that never
cleared and an unparseable answer each become a critique with a `failure` and a reason code, which the next run
retries, and never a score.

Results are returned in the order of the entries, so the same inputs publish the same layer. Nothing here reads a
clock, the environment or the network on its own: images, time, sleeping and randomness are passed in.

See docs/critics.md#running-critics

#### `Budget`

```ts
export type Budget = {
  /** The most images to start judging in one run (retries of one image count once). */
  readonly maxImages?: number;
  /** The most tokens (input and output) to spend, summed from what critics report as `usage`. */
  readonly maxTokens?: number;
  /** The most money to spend, in US dollars, summed from what critics report as `usage.costUsd`. */
  readonly maxCostUsd?: number;
};
```

The most a run may spend before it stops cleanly. Any limit left out is unlimited.

#### `RunOptions`

```ts
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
```

What a run was told to do and how. Everything but the critic, the entries and `loadImage` has a default.

#### `ProgressEvent`

```ts
export type ProgressEvent = {
  readonly entryKey: string;
  readonly result: 'judged' | 'skipped' | 'failed';
  readonly judged: number;
  readonly skipped: number;
  readonly failed: number;
  readonly waiting: number;
};
```

One step of progress. `waiting` counts entries not yet started.

#### `StoppedBy`

```ts
export type StoppedBy = 'budget' | 'aborted';
```

Why a run ended before every entry was handled: it `budget`ed out or was `aborted`.

#### `RunResult`

```ts
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
```

What a run did. `outcomes` are what to publish (verdicts and failures); counts and `spent` are for the summary.

#### `runCritic`

```ts
export async function runCritic(options: RunOptions): Promise<RunResult>
```

Runs a critic over entries. Entries with a current critique of the same identity are skipped without fetching their
image; the rest are judged with bounded concurrency, a timeout and retries. The run never throws for a critic's
failure: it records it. It throws only for a wrong call (a non-positive `concurrency`, `maxAttempts` or `timeoutMs`).

A run stops cleanly when a budget is reached or the signal aborts: calls in flight finish (or are aborted), what was
finished is returned in `outcomes` to publish, and `stoppedBy` says why. With concurrency above 1 a budget can be
overshot by the calls already in flight.

**Example**

```ts
const result = await runCritic({ critic, entries, loadImage: entry => fetchImage(entry), existing, budget: { maxImages: 200 } });
await publishChecks(store, critiqueLayer({ critic, outcomes: result.outcomes, recordedAtMs: Date.now() }));
```

### The scope of a critic's credential

Source: `packages/critics/src/scope.ts`

A critic only needs to add opinions, so its credential may read and publish layers whose producer is `critic.<name>`
and whose parts are all of kind `critique`, and nothing else. `criticScopeViolation` names the rule a layer breaks;
the server applies it to every layer a critic-role token uploads, so a stolen critic token cannot forge test results.

See docs/critics.md#authentication-and-authorization

#### `criticScopeViolation`

```ts
export function criticScopeViolation(layer: { readonly producer?: unknown; readonly parts?: unknown }): string | null
```

The rule a layer breaks for a critic-scoped credential, or `null` when it is within scope. The message says which rule
and what was found, so the critic can fix it.
