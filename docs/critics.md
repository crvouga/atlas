# Critics: automated reviewers that mark which UIs need polish

A **critic** looks at one captured UI (an image and what is known about it) and says how polished it is, and ideally
where and why it is not. A critic may be a pretrained model that gives a score, a vision-capable language model that
follows a rubric, or a classic measure such as a contrast ratio. All three are the same thing to Atlas, through one small
contract, so people review the likeliest problems first.

**Critics are producers that publish layers.** Atlas supplies the contract, the runner, the evidence format and the
credential. It never executes a model on the server and never holds a provider key. A critique is not a test result and
is not human review: it never changes whether a report passes.

- [What is available](#what-is-available)
- [The critic contract](#the-critic-contract)
- [A critique is a layer](#a-critique-is-a-layer)
- [Running critics](#running-critics)
- [State-aware judging, calibration and modes](#state-aware-judging-calibration-and-modes)
- [Authentication and authorization](#authentication-and-authorization)
- [Credentials](#credentials)
- [What is not here yet](#what-is-not-here-yet)

## What is available

Import `@crvouga/atlas/critics`. It needs no model, no provider SDK and no network; a critic brings its own.

| You want | Use |
| --- | --- |
| Define a critic | `defineCritic` (the contract below) |
| Judge many images with caching, retries, rate limits, timeouts and budgets | `runCritic` |
| Store the opinions | `critiqueLayer`, `publishCritiques` (a layer of parts of kind `critique`) |
| Read them back | `readCritique`, `critiquesOfLayer`, `critiqueCurrency` |
| Read a score in context, measure a threshold, decide an exit code | `relativeVerdict`, `calibrate`, `gateDecision` |
| Keep keys out of configuration and logs | `parseCredentialRef`, `resolveCredential`, `assertNoLiteralCredentials`, `createRedactor` |
| Let a token publish critiques and nothing else | the `critic` role (below) |

The JSON Schema of the evidence is [`critique.schema.json`](../packages/schema/schemas/critique.schema.json). The
function-level reference is generated from the code: [critics](reference/critics.md).

## The critic contract

```ts
import { defineCritic } from '@crvouga/atlas/critics';

export default defineCritic({
  name: 'contrast', version: '1.0.0', kind: 'heuristic',   // kind is an open string: model, llm, ml, heuristic…
  describe: () => ({ sendsImagesTo: null, needsSetup: false }),
  evaluate: async ({ image, imageSha256, entry, signal }) => ({
    verdict: { score: measureContrast(image), scale: '0..1, higher is better' }
  })
});
```

A critic only judges one image. `describe()` says where images are sent (`sendsImagesTo`, `null` when they never leave
the machine), the model, and the fixed parameters (temperature, the SHA-256 of the rubric): together with the critic's
`name` and `version` and the image hash they are the identity of a judgement. `evaluate` returns a `verdict` (a score
and how to read it), `findings`, or both, and may throw: throw a `RateLimitedError` (with the provider's `Retry-After` in
milliseconds), an `InvalidOutputError`, or any `CriticError` with your own reason code. The runner records the failure
and the next run retries it. A failure never becomes a score.

## A critique is a layer

A critique is a check inside a part of kind `critique`, in a layer whose `producer` is `critic.<name>`. The check's
`status` says only whether the critic ran: `passed` a verdict was produced, `failed` the critic could not produce one.
The opinion is evidence, by the rules of [extending.md](extending.md#the-rules-that-keep-it-compatible-forever), so it
can never decide a result. It lives in `extensions["atlas.critique"]` and is repeated as standard evidence, so a viewer
that has never heard of critics still shows it: the score is a measurement named `polish`, and each finding is an
annotation of type `critique`.

```json
{
  "producer": "critic.vision-llm",
  "kind": "critique",
  "checks": [{
    "id": "critique/checkout/payment-sheet",
    "status": "passed",
    "measurements": [{ "name": "polish", "value": 0.62, "unit": "score" }],
    "annotations": [{ "type": "critique", "level": "warning", "message": "spacing: Label touches both edges of the button. (suggestion: Increase horizontal padding.)" }],
    "extensions": { "atlas.critique": {
      "schema": 1,
      "subject": { "entryKey": "checkout/payment-sheet", "imageSha256": "…", "state": "overlay" },
      "critic": { "name": "vision-llm", "kind": "llm", "version": "1.0.0" },
      "model": { "id": "…", "provider": "…" },
      "parameters": { "temperature": 0, "rubric": "<sha256 of the rubric>" },
      "verdict": { "score": 0.62, "scale": "0..1, higher is better", "label": "needs-polish", "confidence": 0.7 },
      "findings": [{ "id": "f1", "category": "spacing", "severity": "minor", "region": { "unit": "px", "x": 24, "y": 612, "w": 342, "h": 48 }, "rationale": "Label touches both edges of the button.", "suggestion": "Increase horizontal padding." }]
    } }
  }]
}
```

- A single score (a model-based critic) is a valid critique: everything except `schema`, `subject` and `critic` is optional.
- `kind`, `category`, `severity`, `label` and failure `reason` are open strings, and every object is open. A value or field
  nobody has heard of is kept and shown generically, never rejected.
- A reader that cannot read the whole extension (a missing `subject`, a score that is not a number, a `schema` version it
  does not know) drops the extension and keeps the check and its status. An unreadable opinion is unknown.
- **Anchored to pixels.** `subject.imageSha256` is the hash of the image that was judged. When an entry's image changes,
  `critiqueCurrency` says the old critique judged an earlier image: it is shown, never hidden, and the entry counts as not
  yet judged.
- **Slots.** The producer is the critic's name; the critic and model versions are labels. A newer version of a critic
  replaces an older one's critique of the same entry. Put the version in `parameters` of `critiqueLayer` to compare
  versions side by side instead.
- **The prompt is recorded as a hash** (`parameters.rubric`), not as text.
- **Failures are data.** A crash, a timeout, a rate limit that never cleared and an unparseable answer are `failed`
  critiques with `failure.reason` (`error`, `timeout`, `rate-limited`, `invalid-output`, `image-mismatch`…) and a message.

**Critiques never change the gate.** Parts of kind `critique` are left out of every count and of `atlas report status`,
even when they are the only thing recorded (a report of opinions alone has no test results, so the gate says so). A low
score does not fail it, and neither does a critic that crashed. A project that wants a score to fail something opts in
with `gateDecision` in `gate` mode, which is computed by the reader from critique data and never changes a check's
status, a slot or a winner.

## Running critics

`runCritic` owns everything around the judgement; a critic only judges one image.

- **Caching.** An entry is skipped, without fetching its image, when a critique with a verdict already exists for the same
  critic, version, model, parameters and image hash (`existing`, read with `critiquesOfLayer`). Identical images across
  runs are judged once; only a changed image is judged again. A failed critique is not a cache hit. `force` judges again.
  Layers are content-addressed, so publishing the same outcomes twice is harmless.
- **Concurrency, timeout, rate limits.** A bounded number of calls in flight. A call over `timeoutMs` is aborted and
  recorded as `timeout`; the run goes on. A rate-limit answer waits at least `Retry-After`, with exponential backoff and
  jitter, for a bounded number of attempts, and then is recorded as `rate-limited`.
- **Budgets.** `budget: { maxImages, maxTokens, maxCostUsd }`. When one is reached the run stops cleanly and returns what
  it finished with `stoppedBy: 'budget'`. Cost and tokens come from the `usage` a critic reports.
- **Dry run.** `dryRun` loads and sends nothing and returns what would be judged and skipped, and where images would go
  (`sendsImagesTo`).
- **Reproducibility.** Results come back in the order of the entries, so the same inputs publish the same layer; a
  deterministic critic gives identical scores on every run. Atlas records what explains a result (critic, version,
  model, rubric hash, parameters) and does not promise that a language model answers the same twice. A re-run adds a
  newer layer instead of changing an old one.
- **Images may leave the machine.** `describe().sendsImagesTo` is the thing to show a person before a run that sends
  images to a third party, and to require explicit confirmation for.

```ts
import { critiquesOfLayer, publishCritiques, runCritic } from '@crvouga/atlas/critics';

const result = await runCritic({
  critic, entries, loadImage: (entry) => fetchImage(entry),
  existing: layers.flatMap((layer) => critiquesOfLayer(layer).map((found) => found.critique)),
  budget: { maxImages: 200 }, secrets: [providerKey]
});
await publishCritiques(store, { critic, outcomes: result.outcomes, recordedAtMs: Date.now() });
```

## State-aware judging, calibration and modes

A raw score is not absolute: a loading overlay is not a full screen.

- `relativeVerdict` reads a score against the project's scores of the **same state kind** (a percentile within the kind)
  and against the same entry's previous image (`delta`), and goes into `verdict.relative`.
- `calibrate` measures a critic against labelled examples **per state kind**: sample sizes, precision, recall, the
  threshold chosen, and `inSample`, which is true unless held-out examples were given. In-sample figures flatter a critic
  and are labelled as such.
- `gateDecision` turns scores into an exit code. Modes: `report` (default: shown, always exit 0), `warn` (a warning for each
  score below its threshold, exit 0), `gate` (exit 1 when a threshold is crossed). `gate` is **refused** (exit 2, with the
  reasons) unless every state kind present has a calibration of this critic and version with a threshold, at least 10 bad
  and 10 good examples, and held-out figures. An explicit threshold never waives that evidence.

## Authentication and authorization

Run critics against a server that has tokens: a server with no tokens is open and every caller is an administrator, a
critic included.

A token of role `critic` (`ATLAS_CRITIC_TOKEN`, or `role: "critic"` under `auth.tokens`) may do what `read` may, and
publish critiques, and nothing else. Through the store protocol (`PUT /api/store/…`) it may upload blobs and layers, and
the catalog entries that make them visible, whose `producer` is `critic.<name>` and whose parts are all of kind
`critique`. Anything else is `403` naming the rule it broke, and the layer is not stored. It cannot post test results,
start live runs, change settings or remove anything. `publish` and `admin` tokens may publish critiques too. As for every
token: send it as `Authorization: Bearer`, never in a URL, never over plain `http` beyond this machine.

## Credentials

Developers bring their own models and AI accounts. Configuration names a credential by **reference**
(`env:SOME_API_KEY`, `file:/run/secrets/key`) and never contains one, so it can be committed;
`assertNoLiteralCredentials` refuses a configuration with a literal key and says where, never what. Credentials are read at
run time (`resolveCredential`) and every message the runner records goes through a redactor (`secrets` in `runCritic`,
`createRedactor`) that removes them, in their URL-encoded and base64 forms too, and anything shaped like a provider key,
token or JWT. A credential never reaches a layer, a progress event or an error message.

## What is not here yet

This release delivers the contract, the evidence format, the runner, state-aware judging and calibration, credential
handling and the scoped `critic` role. Still to come, tracked in [issue 50](https://github.com/crvouga/atlas/issues/50):

- the **catalog read surface** for critics (cursor pagination, `since`, realtime events, images by hash), which builds on
  the UI catalog of [issue 43](https://github.com/crvouga/atlas/issues/43);
- the **`atlas critic` command** (`list`, `setup`, `doctor`, `run`, `watch`, `review`, `calibrate`), its interactive mode
  and its `--format json` documents;
- the **built-in UIClip critic** and the **LLM critic** with provider adapters;
- the **viewer**: a ranked "needs polish" list, finding overlays and agreement across critics. Until then critiques are
  stored, composed and kept out of test counts, and the viewer lists only test results.
