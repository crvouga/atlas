# The report contract

This is the normative description of what Atlas reads and writes when it reports on specs of any
kind: Gherkin features, Quint models, DMN tables, Alloy structures, OpenSLO objectives, statecharts,
unit tests, linters, anything that ends in "this check passed or failed". If this page and the code
disagree, that is a bug: [file it](reporting-issues.md).

The contract is small on purpose. It is one document (the **layer**), one rule (how layers compose),
and one interface (the **backend** that stores them). Everything else, the viewer, the gate, the CLI,
is built on those three and can be replaced.

- [Concepts](#concepts)
- [The layer document](#the-layer-document)
- [How layers compose](#how-layers-compose)
- [Guarantees](#guarantees)
- [Statuses and the gate](#statuses-and-the-gate)
- [Backends](#backends)
- [Where bytes go](#where-bytes-go)
- [Versioning and stability](#versioning-and-stability)
- [Failure behaviour](#failure-behaviour)
- [Speed](#speed)
- [Other documents of the contract](#other-documents-of-the-contract)

## Concepts

| Term | Meaning |
| --- | --- |
| **Check** | One thing a producer verified, with a stable `id` and a status: `passed`, `failed`, `running` or `not-run`. |
| **Layer** | One focused recording: the checks one **producer** ran, on one **environment**, from one version and branch, at one time. Immutable, addressed by its content. |
| **Producer** | A stable name for the suite or tool that makes layers: `gherkin`, `web-e2e`, `quint`, `openslo`. |
| **Environment** | The client that was checked: `desktop-web`, `mobile-web`, `ios`, `android`, or any other lowercase name. |
| **Slot** | The cell a check fills: producer, kind, spec, check id, environment and parameters. |
| **Backend** | A store that holds layers. Any [`ObjectStore`](#backends): a directory, a bucket, a device lab. |
| **Report** | The result of laying every layer of every backend over the current specs. Computed, never stored. |

Two ideas follow, and the rest of this page is their consequences.

1. **A report is a function of the set of layers.** There is no "the run". Nothing partitions a
   report by run, commit, branch, machine or backend; those are provenance written on each layer.
2. **Partial runs are the normal way to build a report.** A node that runs one shard, a branch that
   re-runs one scenario, a device lab that checks one environment: each publishes the layer of what it
   ran. The report fills in as layers arrive, and no node needs to know about any other.

## The layer document

`layers/manifests/<id>.json`, schema version **1**. The JSON Schema (draft 2020-12) is shipped as
[`@crvouga/atlas/schemas/layer.schema.json`](../packages/schema/schemas/layer.schema.json), and the
Zod schema as `LayerDocumentSchema` from `@crvouga/atlas/schema`.

```json
{
  "schemaVersion": 1,
  "id": "9f2c…64 hex digits",
  "producer": "gherkin",
  "recordedAtMs": 1760000000000,
  "sha": "0123456789abcdef0123456789abcdef01234567",
  "branch": "main",
  "runUrl": "https://ci.example.com/runs/42",
  "environment": "ios",
  "parameters": { "device": "iphone-15" },
  "specs": [{ "path": "specs/join.feature", "domain": "list", "kind": "gherkin", "title": "Join a list", "fingerprint": "13:1a2b3c:4d5e6f" }],
  "parts": [{
    "id": "gherkin", "kind": "behavior", "title": "Gherkin", "recordedAtMs": 1760000000000, "sha": "0123…",
    "checks": [
      { "id": "specs/join.feature > Joins", "title": "Joins", "status": "passed", "detail": "", "specPath": "specs/join.feature", "measurements": [], "durationMs": 120 },
      { "id": "specs/join.feature > Leaves", "title": "Leaves", "status": "failed", "detail": "expected 2 members, saw 3", "specPath": "specs/join.feature", "measurements": [{ "name": "latency", "value": 1400, "unit": "ms", "limit": 2500 }] }
    ]
  }],
  "source": null,
  "recording": null,
  "bundle": {}
}
```

| Field | Rule |
| --- | --- |
| `schemaVersion` | `1`. A layer without it, written before it existed, is version 1. |
| `id` | 64 lowercase hex digits: the SHA-256 of this document without `id`. Opaque to readers. The same checks recorded the same way give the same id, so publishing twice is harmless. |
| `producer` | Required, non-empty. Part of the [slot](#how-layers-compose). |
| `recordedAtMs` | When the checks ran, epoch milliseconds, `>= 0`. The newest completed result wins its slot. Take it from the test run, never from the moment of publishing, or a retried publish would claim to be newer than a later run. |
| `sha`, `branch`, `runUrl` | Provenance, or `null`. **Never part of the slot.** |
| `environment` | The client checked, or absent. Normalised to a lowercase slug: `iOS` → `ios`, `Desktop Web` → `desktop-web`, `iphone` → `ios`, `mobile browser` → `mobile-web`. Any other name is kept. Part of the slot. |
| `parameters` | Other string choices that make a result its own slot, such as `{ "device": "iphone-15" }`. A parameter named `environment` is read as the environment. Part of the slot. |
| `freshness` | `modified`: recorded from a checkout with uncommitted changes. `unknown`: origin not captured. Advisory only; see [Statuses](#statuses-and-the-gate). |
| `specs` | The specs the layer was recorded against, with a `fingerprint` of their text, so a reader can warn when a spec changed since. Optional. |
| `parts[].kind` | An open category (`behavior`, `performance`, `accessibility`, …). A new kind needs no change to any reader. Part of the slot. |
| `parts[].checks[]` | `id` (required, stable), `title`, `status`, `detail`, `specPath`, `measurements`, `durationMs`. |
| `checks[].specPath` | The spec the check belongs to, as `specs/<path inside the specs directory>`. Anything before the first `specs/` is dropped, so `packages/app/specs/join.feature` and `specs/join.feature` are the same spec. |
| `measurements[]` | `{ name, value, unit, limit? }`, finite numbers. A measurement over its `limit` is shown, and never fails the check by itself. |
| `source`, `recording`, `bundle` | Optional timelines and captured files (screenshots, frames) a suite recorded. `null` and `{}` for a layer of plain checks. |

**Unknown fields are allowed and preserved.** Every object in the schema is loose. A later minor
version may add fields; an older reader ignores them and a copy carries them along.

### Choosing a check id

The check `id` is the one thing only the producer can get right, and everything depends on it: the
newer result replaces the older one only if both used the same id.

- Make it **stable** across runs: derive it from the check's identity (file, suite, name), never from
  an index, a timestamp, a random seed or a path's position in a plan.
- Make it **unique** within the layer. Publishing refuses a layer with a repeated id. When importing
  CTRF or JUnit, a repeated id gets `#2`, `#3`, … so no check is silently counted as another.
- Keep it **human**. It is what the gate prints.
- Changing an id retires the old check: its last result stays in the report until the layers that
  hold it are left out. Rename deliberately.

Atlas's own importers build ids this way:

| Source | Check id | `specPath` |
| --- | --- | --- |
| CTRF | `filePath > suite… > name` (parts that exist) | `filePath`, when present |
| JUnit XML | `file or classname > name` | the `file` attribute, when present |
| Atlas run (`manifest.json`) | the path's `key`, which the same start and events give in every run | the root chart's file |
| `publishChecks` / `--checks` | whatever you give | whatever you give |

## How layers compose

A **slot** is the tuple

```
(producer, kind, specPath, check id, environment, parameters)
```

with `parameters` compared as sorted key/value pairs. Branch, commit, backend, layer id and run are
**not** in the slot. Each slot shows exactly one result: the winner among every layer that filled it.

The winner is decided by these rules, in order:

1. A **completed** result (`passed` or `failed`) beats an **unfinished** one (`running` or `not-run`),
   whatever their times. An unfinished layer never erases a completed outcome.
2. Between results of the same completeness, the **newer** `recordedAtMs` wins.
3. At the same time, **`failed` beats `passed`**, and `running` beats `not-run`. A tie fails.
4. At the same status, the greater `layerId|backendId` wins, so no input order can change the answer.

Consequences you can rely on:

- Desktop web, mobile web, iOS and Android results of the same check sit side by side.
- A layer that ran one scenario leaves every other scenario as the newest layer that ran it.
- Re-running a failing check on any branch and passing replaces the failure. Re-running and failing
  replaces the pass.
- A spec in the current specs with no layer at all stays visible as having no results. A spec that
  was removed keeps its evidence, outside the outline.
- An immutable layer held by several backends is **one** layer, reported by the backend whose id sorts
  first.

Leaving a layer, backend, environment, branch or version out of the input is how earlier outcomes are
inspected.

## Guarantees

These are tested (`packages/reports/tests/composition-laws.test.ts`, over random partial runs) and
are part of the contract:

| Guarantee | Meaning |
| --- | --- |
| **Order independence** | The report does not depend on the order backends or layers are read in. |
| **Partition independence** | Splitting the same layers across any number of backends, machines or branches, with any overlap, gives the same report. This is what makes partial runs on separate nodes safe. |
| **Idempotence** | A layer present twice, in one backend or several, counts once. Publishing the same checks again writes the same layer. |
| **Monotonic** | A layer changes only the slots it fills. Adding a layer never changes a result it did not record. |
| **Deletion-free** | Nothing in the contract removes or rewrites a layer. Retention is the operator's choice. |
| **Unknown is not a pass** | A layer that cannot be read, a backend that is down, and a check that is `running` or `not-run` never count as passing. The gate fails closed. |
| **Aggregation by copying** | Layers are immutable and never share a key with different bytes, so combining stores is copying files (`atlas report merge`, `cp -R`, `rsync`, a CI artifact download). Copying is idempotent and commutative. |

## Statuses and the gate

| Status | Meaning | Counts as |
| --- | --- | --- |
| `passed` | The check ran and its expectation held. | Pass |
| `failed` | The check ran and its expectation did not hold. | Fail |
| `running` | The check has started and not finished. | Not done: fails the gate |
| `not-run` | The check was skipped, pending, blocked, or never reached. | Nothing: never a pass, never a failure |

Tools map to these four. CTRF `skipped`, `pending` and `other`, and JUnit `<skipped>`, are `not-run`.
An Atlas path that passed on retry (`flaky`) is `passed`, with the detail "Passed on retry (flaky)".

Timings that only qualify a check (parts of kind `performance`) are not counted as checks when
anything else is recorded. A measurement over its allowance is reported and never fails a check.

**Freshness never changes a status.** A layer whose spec fingerprint no longer matches, whose
checkout was modified, or whose related code changed still shows its recorded outcome, with a
warning ("Potentially outdated: spec changed"). Atlas favours quick, possibly stale evidence over
none, and never invents a result.

### `atlas report status`

The gate passes (exit 0) only when **all** of these hold:

- at least one check has completed (`passed` or `failed`): a report where everything was skipped has
  no evidence;
- no slot's winning result is `failed`;
- no slot's winning result is `running`;
- every backend and every layer could be read (a notice is a failure);
- every environment named by `--require-environments` has at least one check;
- with `--require-all-specs`, every spec in `--specs <dir>` has at least one result.

Exit codes: `0` the report passes, `1` it does not, `2` the command itself is wrong (a store
directory that does not exist, a missing flag). A CI job can tell a broken invocation from a red report.

`--format json` prints a [`ReportStatus`](../packages/schema/schemas/report-status.schema.json)
(`schemaVersion: 1`): `ok`, `reasons`, `checks`, `byEnvironment`, `layers`, `backends`, `notices`,
`specsWithoutEvidence`, `specs` (each spec's counts, per environment) and `failing`. The text and markdown formats are for people and are not a
contract; parse the JSON.

## Backends

A backend is any implementation of `ObjectStore` (`@crvouga/atlas/reports/object-store`), seven
async methods over keys and bytes:

| Method | Rule |
| --- | --- |
| `get(key)` | The object with its `contentType` and `size`, or `null` when missing. Transport errors throw. |
| `put(key, bytes, contentType)` | Idempotent: writing a key twice overwrites without error. The content type round-trips. |
| `head(key)` | `true`/`false`. Never throws for a missing key. |
| `delete(key)`, `deleteMany(keys)` | A missing key is a no-op. |
| `getUri(key)` | A URL the host can load directly, or `null`. |
| `listKeys(prefix?)` | Keys in code-unit order, optionally filtered by prefix. |
| `withPrefix(prefix)` | A store scoped to a prefix. Keys relative to it. Prefixes compose. |

It needs nothing else: no transactions, no rename, no locks, no conditional writes. That is what
lets a plain bucket, a directory and a device lab compose.

Atlas ships `directoryStore(dir)` (`@crvouga/atlas/reports/directory-store`), with atomic writes. For
anything else, write an adapter and prove it:

```ts
import { verifyObjectStore } from '@crvouga/atlas/reports/object-store-conformance';

const { ok, failures } = await verifyObjectStore(myS3Store); // writes under a scratch prefix, cleans up
```

Several backends are one report: pass them all to `combineBackends`, to the viewer
(`reportsHost`), or to the CLI (`--store` for directories, `--backends <module>` for the rest). A
backend that cannot be reached is named in the notices and leaves the others usable; asking again
retries it.

## Where bytes go

All keys are relative to the backend. Layers are written **bottom up**, so a reader never meets an
entry whose content has not arrived:

1. `layers/blobs/<sha256>.gz`: recorded files (screenshots, frames), content-addressed and shared
   between layers. Skipped entirely for a layer of plain checks.
2. `layers/manifests/<id>.json`: the layer document, written once.
3. `layers/index/<inverted-time>-<id>.json`: `{"id": "<id>"}`, the catalog entry, written last. The
   time is inverted so a listing is newest first.

Two producers never write different bytes to one key: every key is derived from content. A crash
between steps leaves unreferenced blobs, never a catalog entry without its layer.

Stores written before layers existed (`commits/<sha>/…`, `versions/…`, `index/…`) are read in place
and composed with layers; Atlas never rewrites them. `copyStore` and `atlas report merge` copy
`layers/` only, because commit-keyed objects are mutable.

## Versioning and stability

- `schemaVersion` is the **major** version of the layer document. This is version 1.
- Within a version, changes are **additive**: a new optional field, a new open `kind`. Readers ignore
  unknown fields, so an older Atlas reads a newer minor version.
- The closed vocabularies, `status` and `freshness`, change only with a new major version. A reader
  never has to guess what an unknown status means.
- A reader reads every version **at or below its own**. A layer of a newer major version is refused by
  name ("Written with layer schema version 2; … Upgrade @crvouga/atlas") and shows up as a notice. It
  is never half understood and never counted as a pass.
- A breaking change to the document, to the [slot](#how-layers-compose) or to the
  [winner rules](#how-layers-compose) is a major version of the contract **and** a major release of
  `@crvouga/atlas` (a `!` commit). It also ships a migration note.
- The contract is guarded by `packages/reports/tests/fixtures/layer-v1.json`, a layer that must keep
  parsing, and by the emitted JSON Schemas, which a test keeps equal to the Zod schemas. **Never edit
  the fixture to make a test pass.**

## Failure behaviour

| What happens | What Atlas does |
| --- | --- |
| A backend is unreachable | Named in `notices` and in the backend list as unavailable; every other backend is used. The gate fails. |
| A layer is not JSON, fails the schema, or is a newer major version | Skipped with a notice naming the layer and why. The gate fails. |
| A catalog entry names a layer that is missing | A notice; the gate fails. |
| Two layers disagree | The [winner rules](#how-layers-compose) decide, the same way everywhere. |
| A publish is interrupted | Unreferenced blobs may remain. No partial layer is ever visible. Publish again. |
| A publish is retried | The same layer; nothing changes. |
| Two nodes publish at once | They write different keys, or identical bytes to the same key. |
| A required field is missing at publish | `publishChecks` throws, naming each problem by its path. Nothing is written. |
| A check id repeats within a layer | `publishChecks` throws. Importers number repeats (`#2`). |

## Speed

- Publishing a layer of plain checks is one `head` and two small writes.
- A report is one linear pass over the checks of every layer. Reading dominates it: each layer is
  one catalog read and one manifest read, a few at a time (16 by default).
- Measured on a laptop with a directory backend: 300 layers of 50 checks in about 0.2 s; 1,000 layers
  of 100 checks, each recorded against 1,000 specs (100,000 results), in about 0.9 s. Composing two
  thousand layers of 100 checks (200,000 results) already in memory takes about 0.3 s.
  `performance.test.ts` holds budgets ten times looser, to catch an accidental quadratic step on a
  slow machine.
- A directory backend lists only the directories a prefix can reach. The viewer polls a small index,
  reads an immutable layer once and caches it forever, and loads recordings only when opened.

## Other documents of the contract

| Document | Schema | Purpose |
| --- | --- | --- |
| Layer | `layer.schema.json` | What a producer publishes. This page. |
| Publish checks | `publish-checks.schema.json` | The input of `publishChecks` and `atlas report publish --checks`: a layer without the parts the publisher fills in. |
| Report status | `report-status.schema.json` | The output of `atlas report status --format json`. |
| Run manifest | `manifest.schema.json` | What `atlas run` writes for a statechart run. Publish it as a layer with `--manifest`. |
| Runs index, sources, change notices | `runs-index`, `report-sources`, `atlas-change` | How the viewer finds runs. See [report backends](report-backends.md). |
| CloudEvents | `cloud-event.schema.json` | Business events a run observed. |

All of them are JSON Schema 2020-12 and ship in the package at `@crvouga/atlas/schemas/<name>.schema.json`.
