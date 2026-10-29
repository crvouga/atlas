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
- [Reading the catalog](#reading-the-catalog)
- [Running critics](#running-critics)
- [The `atlas critic` command](#the-atlas-critic-command)
- [Configuring critics](#configuring-critics)
- [The built-in UIClip critic](#the-built-in-uiclip-critic)
- [The LLM critic and bringing your own AI](#the-llm-critic-and-bringing-your-own-ai)
- [When the server goes away](#when-the-server-goes-away)
- [State-aware judging, calibration and modes](#state-aware-judging-calibration-and-modes)
- [Authentication and authorization](#authentication-and-authorization)
- [Credentials](#credentials)
- [The viewer: needs polish](#the-viewer-needs-polish)
- [What is not here yet](#what-is-not-here-yet)

## What is available

Import `@crvouga/atlas/critics`. It needs no model, no provider SDK and no network; a critic brings its own.

| You want | Use |
| --- | --- |
| Define a critic | `defineCritic` (the contract below) |
| List, page through, follow and fetch the pictures of the UI catalog | `createCatalogClient` ([below](#reading-the-catalog)) |
| Judge many images with caching, retries, rate limits, timeouts and budgets | `runCritic` |
| Store the opinions | `critiqueLayer`, `publishCritiques` (a layer of parts of kind `critique`) |
| Read them back | `readCritique`, `critiquesOfLayer`, `critiqueCurrency` |
| Read a score in context, measure a threshold, decide an exit code | `relativeVerdict`, `calibrate`, `gateDecision` |
| Keep keys out of configuration and logs | `parseCredentialRef`, `resolveCredential`, `assertNoLiteralCredentials`, `createRedactor` |
| Keep critiques that could not be sent and send them later | `spoolingStore`, `flushSpool` |
| A UIClip critic, an LLM critic over any provider | `@crvouga/atlas/critics/uiclip`, `@crvouga/atlas/critics/llm` |
| Run all of it from a terminal or CI | `atlas critic list \| setup \| doctor \| run` ([below](#the-atlas-critic-command)) |
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

## Reading the catalog

A critic reads the [UI catalog](ui-catalog.md) from the server; it never reads a store directly and needs no browser or
collection framework. `GET /api/reports/ui-catalog/entries` lists **entries**: one per captured state per profile that has a picture
stored in its layer, each with the hash of that picture (`image.sha256`), where its bytes are (`image.path`), its `state` kind
(`screen`, `overlay`, `loading`, `error`, `empty`, or `unknown` when the producer declared none: set `kind` in the state's
`atlas.ui-state` facts) and the `critiques` already made of it, each marked `current` or `earlier-image`.

| A critic wants to | It asks |
| --- | --- |
| Iterate everything, a page at a time | `?limit=` and the opaque `nextCursor` of the previous page as `?cursor=`. Entries are in key order and the cursor names the last key, so each entry is seen once and in the same order |
| Resume where it stopped | keep the `version` of the **first** page; later ask `?since=<version>` for the entries whose layer was added or changed since (an entry that is included but not new is harmless: the cache skips an image it has judged). A version the server does not remember is answered with the whole catalog and `since.honored: false` |
| Judge only what it has not judged | `?unjudgedBy=<critic>@<version>`: entries with no current critique with a verdict from that critic (a failed critique is retried) |
| Narrow | `?state=`, `?area=`, `?profile=`, `?route=`, `?q=` |
| Be told something changed | hold `/api/events`; a `report` event carries the new version, then read `?since=`. A missed event costs nothing: the next read covers it |
| Get a picture | `GET /api/reports` + `image.path`, the same safe attachment path every viewer uses; check the bytes against `image.sha256` |

```ts
import { createCatalogClient } from '@crvouga/atlas/critics';

const catalog = createCatalogClient({ url: 'https://atlas.example.com', token: process.env.ATLAS_CRITIC_TOKEN });
const { version, entries } = await catalog.read({ unjudgedBy: { name: 'uiclip', version: '1.0.0' } });
for (const entry of entries) judge(entry, await catalog.image(entry));          // image() refuses bytes that are not the hash
for await (const batch of catalog.follow({ since: version })) handle(batch.entries); // catch up on connecting and after every drop, none twice
```

`follow` connects to the event stream, catches up with a `since` read, and then reads again after every `report` event. When the
connection drops it reconnects after a pause and the next read starts from the version it holds, so nothing is missed; an entry
is handed over once per picture. The token is sent as `Authorization: Bearer` and is never put in an address or an error. The
list is a function of the report, so the same layers in any order give the same entries.

## The `atlas critic` command

`atlas critic list | setup | doctor | run` runs critics on this machine (a laptop, CI, a worker). Every command takes
`--format json`; the documents validate against `critic-list-result`, `critic-setup-result`, `critic-doctor-result` and
`critic-run-result`. The full usage is in the [command reference](reference/cli.md).

```sh
atlas critic list                                   # what is configured, ready, and where images go
atlas critic setup uiclip                           # fetch and verify the model checkpoint (the only download)
atlas critic doctor                                 # server, token scope, catalog, model files, credentials, providers
atlas critic run --critic uiclip --unjudged         # judge what uiclip has not judged yet
atlas critic run --critic vision --all --dry-run    # how many, and where images would go; sends and publishes nothing
```

- **Interactive when there is a terminal.** Missing choices (the critic, the server, the scope) are asked for, and a run that
  sends images to a third party names the destination and the number of images and waits for a yes.
- **Never interactive without one** (no terminal, `--non-interactive`, or `--format json`): every choice is a flag, a missing one
  exits `2` and names the flags, and sending images to a third party needs `--yes`. Nothing is ever prompted for.
- **Exit codes.** `0` it worked; `1` the answer is no (a critic failed on an entry, a gate was crossed, `doctor` found a
  problem); `2` the command was wrong (a missing flag, a gate refused for lack of evidence, a configuration that holds a
  credential). Stopping at a budget is not a failure.
- **`doctor`** reports each problem separately with how to fix it: the server unreachable; the token missing or not accepted; its
  scope (a `read` token cannot publish, a `publish` or `admin` token can do more than a critic needs, and a server with no
  tokens is open, so **every caller is an administrator**); a server too old to list the catalog; and, for each configured
  critic, its model file and checksum, its optional dependencies, its credential, and whether its provider answers.
- **`setup uiclip`** downloads the checkpoint only if it is missing, verifies it against the pinned SHA-256 (a bad checksum is
  an error, a bad download is discarded) and uses a verified file as it is. Judging never downloads anything and refuses a
  checkpoint that does not match.
- **Scope.** `--all`, `--unjudged`, `--since <version>`, or filters (`--area`, `--profile`, `--state`, `--route`, `--q`); at least one
  is required. A score is read against the project's scores of the same state kind and against the entry's previous picture
  (`verdict.relative`).
- **Cost.** `--max-images`, `--max-tokens`, `--max-cost`, `--concurrency`, `--timeout-ms`; see [running critics](#running-critics).
- **Modes.** `--mode report|warn|gate`, `--threshold state=score`, `--calibration file.json`; see
  [modes](#state-aware-judging-calibration-and-modes). `gate` is refused (exit `2`, before anything is spent) without a calibration of
  this critic and version with held-out evidence for every state kind in scope.

## Configuring critics

`atlas critic` reads `atlas.critics.json` (or `--config`). It may be committed: it names a credential by **reference**
(`env:NAME`, `file:PATH`) and a literal credential in it is refused, with a message that says where and never repeats it.
Paths are relative to the file.

```json
{
  "server": { "url": "https://atlas.example.com", "token": "env:ATLAS_CRITIC_TOKEN" },
  "critics": {
    "uiclip": { "type": "uiclip", "checkpoint": { "path": ".atlas/models/uiclip.onnx", "sha256": "<64 hex digits you pinned>", "url": "https://models.example.com/uiclip.onnx" } },
    "vision": { "type": "llm", "baseUrl": "https://llm.example.com/v1", "apiKey": "env:LLM_API_KEY", "model": "<model id>", "rubricFile": "rubric.md" },
    "contrast": { "type": "module", "module": "./critics/contrast.ts" }
  }
}
```

The server is `--server`, `server.url`, `ATLAS_SERVER_URL` or an https `ATLAS_STORE`; the token is `server.token`,
`ATLAS_CRITIC_TOKEN` or `ATLAS_TOKEN`, and is refused over plain `http://` beyond this machine. A `module` critic is any
file whose default export is a `defineCritic` result (a heuristic, a classic model, a wrapper around your own service), on
equal footing with the others; its `name` must equal its key, because the name is the producer of its layers. Critiques are
published as `critic.<name>`.

## The built-in UIClip critic

`@crvouga/atlas/critics/uiclip` is a model-based critic that gives one score per image and keeps images on this machine. It is an
**adapter**: importing it needs nothing installed, and the model runs in an ONNX Runtime session opened only when a run starts
(`loadOnnxRuntime`, which needs the optional `onnxruntime-node` and `sharp` and names whichever is missing). A test or another
runtime passes its own `UiclipRuntime` (`score(image)`), so no model is needed to test anything.

- **Pinned checkpoint.** You pin the SHA-256 of the checkpoint in the configuration. Atlas ships no checkpoint address: the
  weights' license must be checked before a project downloads them, and that choice is yours.
- **`setupUiclip`** is the only place anything is downloaded (https only, hashed as it arrives, discarded on a mismatch);
  `verifyCheckpoint` refuses a missing, unpinned or different file; inference never downloads.
- **Report-only by design.** A single global score cannot say what to fix, and ordinary loading overlays and bottom sheets score
  poorly. A run reports the score with its standing among the scores of the same state kind, so a loading overlay is compared with
  other loading overlays; calibrate before reading it as a threshold.
- **Not validated against a particular checkpoint.** The preprocessing is CLIP's (resize to 224 by 224, normalise) and the score is
  the first output; measure the critic on your own labelled examples with `calibrate` before trusting it.

## The LLM critic and bringing your own AI

`@crvouga/atlas/critics/llm` asks a vision-capable model to review an image against a **rubric** and answer with structured
findings. It is provider-agnostic: an `LlmProvider` is `complete(request)` plus declared capabilities, so a developer brings their own
model and account. `openAiCompatibleProvider` speaks the widely implemented chat-completions protocol with plain `fetch` (hosted
services and local servers alike), so there is no SDK to install; a provider for anything else is a few lines.

- The rubric is recorded as a hash. The answer must be one JSON object with a `score` and optional `findings`; anything else is
  `invalid-output` and no score is invented. A provider's `429` becomes a rate limit with its `Retry-After`; a timeout, a refused
  credential and an unreachable provider are failed critiques with a reason code.
- The key is read from its reference when the critic is built, sent only as the `Authorization` header, and kept out of every result,
  progress line, error and JSON document (the runner redacts what it records). Plain `http` is allowed only for a provider on this
  machine.
- **Images may leave the machine.** `describe().sendsImagesTo` is the provider's host, shown by `list`, `doctor` and `run --dry-run`
  and confirmed before a run that sends images there.

```ts
import { createLlmCritic, openAiCompatibleProvider } from '@crvouga/atlas/critics/llm';

const critic = createLlmCritic({ model: 'my-vision-model', rubric: 'Judge spacing and contrast.', provider: openAiCompatibleProvider({ baseUrl: 'https://llm.example.com/v1', apiKey }) });
```

## When the server goes away

A run that cannot reach the server while publishing does not lose its work. The objects of the layer (its files, the layer, its
catalog entry) are written to the spool directory (`.atlas/critic-spool`, or `--spool`, or `spool` in the configuration); the run
reports how many, and exits normally. The next `atlas critic run` sends them first, **byte for byte what was written and in the
order it was written**, and removes each once the server has it. A layer is content-addressed and the store protocol is
idempotent, so one that did arrive is not duplicated, and a spool that is empty is not an error. A refusal (`401`, `403`, `409`,
`413`, `422`) is not spooled: it will not pass by waiting. `spoolingStore` and `flushSpool` do the same for your own code.

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

## The viewer: needs polish

`Needs polish` (`/critiques`, in the spec-type menu once any critic has recorded an opinion) ranks the captured states one critic
judged, lowest first, so the likeliest problems are reviewed first. When every ranked score carries its standing within its state
kind, that standing ranks them (a loading overlay is not compared with a full screen); otherwise the raw score does, read as
higher-is-better. The address holds the critic, the state kind and the open entry.

- **Opinions, not results.** Critiques have their own place, wording and mark, never a passed or failed mark, and are never in a test
  count or the gate.
- **Anchored to pixels.** A state whose picture changed since it was judged is listed apart as *not judged at the current picture*, its
  older opinion shown as judging an earlier picture; it is never ranked and never hidden.
- **Failures are data.** A critic that could not judge says why (the reason code) and that this says nothing about the picture.
- **Detail.** An open entry shows the verdict and its standing, every finding (category, severity, where, why, suggestion; unknown
  categories and severities are shown as they are) and where the opinion came from: critic, version, model, parameters, the hash of
  the picture it judged, the layer and the cost.

## What is not here yet

Still to come, tracked in [issue 50](https://github.com/crvouga/atlas/issues/50):

- the **UIClip critic's parity** with the in-house package it is meant to absorb: its exact preprocessing and score head, checked
  against a real checkpoint (no checkpoint address ships until the weights' license is settled), and the per-provider adapters beyond
  the OpenAI-compatible one;
- **`atlas critic watch`** (a worker that follows the catalog; `createCatalogClient(…).follow` is the building block),
  **`review`** (marking a finding valid or not) and **`calibrate`** (the library function `calibrate` exists; the command and the
  labelled-example format do not);
- the viewer's **finding overlays drawn on the image**, an **agreement view** across critics, and **human accept and dismiss marks**.
