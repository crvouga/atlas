# Reference: schema

The contract: Zod schemas, and the JSON Schemas generated from them, for layers, checks, report status, command results, server responses and configuration. Import path `@crvouga/atlas/schema`.

> Generated from the doc comments of `packages/schema/src` by `bun run docs`. Do not edit: change the comment next to the code.

### Atlas server API documents

Source: `packages/schema/src/api.ts`

The JSON bodies the Atlas server speaks, as Zod schemas: the problem document every error uses (RFC 9457), what
`/api/server` and `/readyz` say about the server, the report a viewer reads (`/api/reports/evidence/effective`) and
what changed since a version of it, the store protocol's listings and acknowledgements, and the events on the
stream. The server's OpenAPI document (`@crvouga/atlas/openapi.json`) is generated from these, and each is also
published as a JSON Schema, so a client in any language can validate what it receives.

Every object is open (unknown keys are kept, not refused) because the API only grows: within a version a response
may gain optional fields, never lose or change one (see AGENTS.md, "The server is a living application"). A client
must ignore what it does not know.

See docs/server.md

#### `EvidenceStatusSchema`

```ts
export const EvidenceStatusSchema = …
```

One of the statuses a check has in a report: `passed`, `failed`, `running` (not finished) or `not-run`. Closed.

#### `ProblemSchema`

```ts
export const ProblemSchema = …
```

The body of every error the server answers, a Problem Details document (RFC 9457, `application/problem+json`).
`error` repeats `detail` for clients written before the standard was adopted; read `detail`.

#### `HealthSchema`

```ts
export const HealthSchema = …
```

What `GET /healthz` answers: the process is up.

#### `ReadySchema`

```ts
export const ReadySchema = …
```

What `GET /readyz` answers: whether the backends were read, and counts for logs. `ready` false comes with status 503.

#### `ServerInfoSchema`

```ts
export const ServerInfoSchema = …
```

What `GET /api/server` answers: what the server is, who is asking, and what it can do.

#### `BackendInfoSchema`

```ts
export const BackendInfoSchema = …
```

A backend as the report shows it: where results came from, and whether it could be read.

#### `VideoRefSchema`

```ts
export const VideoRefSchema = …
```

One reference to a video held by a layer, check, retry attempt or step, found by the attachment's effective media type.

#### `VideoCountsSchema`

```ts
export const VideoCountsSchema = …
```

Video references as counts: how many are referenced, how many distinct recordings can be played, how many cannot.

#### `EvidenceSummarySchema`

```ts
export const EvidenceSummarySchema = …
```

What a result carries beyond its outcome, as counts and short facts. Present only when there is something.

#### `LayerHeaderSchema`

```ts
export const LayerHeaderSchema = …
```

A layer as the report shows it: its origin and its checks by status.

#### `LayerRowSchema`

```ts
export const LayerRowSchema = …
```

One check of a layer as the report shows it.

#### `LayerRowsSchema`

```ts
export const LayerRowsSchema = …
```

A layer with its checks: the rows of one layer, read apart from its header.

#### `LayerEvidenceSchema`

```ts
export const LayerEvidenceSchema = …
```

A layer that holds winners, with only the rows that win.

#### `EffectiveEvidenceSchema`

```ts
export const EffectiveEvidenceSchema = …
```

The report as it stands: `GET /api/reports/evidence/effective`. Only the layers that win at least one check are
listed, each with only the rows that win, newest first. `version` is a hash of the report: equal exactly when the
report is, on every replica, so it works as an ETag and as the `since` of a delta.

#### `EffectiveDeltaSchema`

```ts
export const EffectiveDeltaSchema = …
```

What `GET /api/reports/evidence/effective?since=<version>` answers when the server remembers that version: only
what changed. Replace the layers of the same id, drop `removed`, take the rest whole; the result equals the full
report. When the server does not remember the version it answers with the whole report instead (no `delta` key).

#### `OutlineSpecSchema`

```ts
export const OutlineSpecSchema = …
```

A spec of the outline a report is laid over.

#### `OutlineSchema`

```ts
export const OutlineSchema = …
```

`GET /api/reports/outline`: the specs a report is laid over, from the newest committed spec set.

#### `EvidencePageSchema`

```ts
export const EvidencePageSchema = …
```

`GET /api/reports/evidence`: one page of layer headers, newest first. Used by clients that read the whole history.

#### `CheckDetailSchema`

```ts
export const CheckDetailSchema = …
```

`GET /api/reports/evidence/detail/{backend}/{id}`: everything one check carries, and what its run carries.

#### `StoreListingSchema`

```ts
export const StoreListingSchema = …
```

`GET /api/store?prefix=…`: one page of keys under `layers/`, in code-unit order.

#### `StoreWriteResultSchema`

```ts
export const StoreWriteResultSchema = …
```

`PUT /api/store/{key}` answered: the key was taken (`created`) or was already there with the same bytes.

#### `ChecksResultSchema`

```ts
export const ChecksResultSchema = …
```

`POST /api/checks` answered: the layer that was written.

#### `ArtifactTargetSchema`

```ts
export const ArtifactTargetSchema = …
```

Which attachment a reviewer's tags belong to: one attachment of one check of one archived layer.

#### `ArtifactTagEditSchema`

```ts
export const ArtifactTagEditSchema = …
```

The body of `POST /api/reports/artifact-tags`: tags to add to and to remove from one attachment. At least one tag overall.

#### `ArtifactTagEntrySchema`

```ts
export const ArtifactTagEntrySchema = …
```

One recorded edit of an attachment's reviewer tags. Entries are never changed or removed: they are the audit trail.

#### `ArtifactTagsSchema`

```ts
export const ArtifactTagsSchema = …
```

`GET /api/reports/artifact-tags`: every recorded edit, oldest first. Fold them with `foldArtifactTags`.

#### `HelloEventSchema`

```ts
export const HelloEventSchema = …
```

The data of the `hello` event: sent first on `/api/events`.

#### `ReportEventSchema`

```ts
export const ReportEventSchema = …
```

The data of the `report` event: layers arrived. Enough to say who sent what, without asking.

#### `PingEventSchema`

```ts
export const PingEventSchema = …
```

The data of the `ping` event: sent every `heartbeatSeconds`, so a quiet server is told apart from a dead connection.

#### `TestResultEntrySchema`

```ts
export const TestResultEntrySchema = …
```

One recorded result of a test in the test catalog: when, where, how it went and how long it took, and where it came from.

#### `TestSummarySchema`

```ts
export const TestSummarySchema = …
```

One test of the catalog: what it is, its current result per environment, and how it has gone over its recorded history.

#### `TestCatalogSchema`

```ts
export const TestCatalogSchema = …
```

`GET /api/reports/tests`: every test of the report with a summary, insights and facets. The summary and facets cover
every test; `tests` is the page of those the query matched.

#### `CatalogHealthSchema`

```ts
export const CatalogHealthSchema = …
```

`GET /api/reports/tests/health`: why the report's Specs, domains and counts may disagree. Counts keep the denominators
apart (spec files, defined specs, specs with an executed test, tests, outlines, examples, observations), `reconciliation`
walks from one to another, and `findings` name what to fix. It reads the report; it never changes what passed.

#### `TestHistorySchema`

```ts
export const TestHistorySchema = …
```

`GET /api/reports/tests/history`: one test and every result recorded for it (at most 100), newest first.

#### `TestReliabilitySchema`

```ts
export const TestReliabilitySchema = …
```

`GET /api/reports/tests/reliability`: how reliable one test is inside a scope, and exactly how that figure was counted.
The snapshots one run recorded for one producer, environment and parameter set are one independent execution; only
`passed` and `failed` executions are trials; `notes` say when the sample is too small, pooled, selectively rerun or
bounded. It reads results and never changes a status. It is not a production failure probability.

#### `ReportRunSchema`

```ts
export const ReportRunSchema = …
```

A run: the layers that name the same execution (else share a run URL, else a branch and commit), with what they recorded.

#### `QueryFacetValueSchema`

```ts
export const QueryFacetValueSchema = …
```

A value of a filter dimension and how many records have it.

#### `QueryFacetsSchema`

```ts
export const QueryFacetsSchema = …
```

The facets of a runs or artifacts query: per dimension, its values with disjunctive counts (the list's count if that value were the only one chosen, every other dimension's filter applied).

#### `RunListSchema`

```ts
export const RunListSchema = …
```

`GET /api/reports/runs`: runs, newest first.

#### `ArtifactResultSchema`

```ts
export const ArtifactResultSchema = …
```

One recorded result that carries evidence: where and when it was recorded and what it carries.

#### `ArtifactListSchema`

```ts
export const ArtifactListSchema = …
```

`GET /api/reports/artifacts`: recorded results that carry evidence, newest first, with the facets of the query.

#### `RunDetailSchema`

```ts
export const RunDetailSchema = …
```

`GET /api/reports/runs/detail`: one run and its last result for every test, environment and producer it recorded.

### Command results (`--format json`)

Source: `packages/schema/src/cli-results.ts`

What `atlas report publish`, `stream`, `merge` and `doctor` print on standard output with `--format json` (alias
`--json`), and what any `atlas` command prints on standard error for a command that was wrong: one JSON document,
so an agent or a script never has to parse prose. (`status` and `policy` already print documents:
`ReportStatusSchema`, and an IAM policy.) Each is also published as a JSON Schema.

Exit codes are the same with and without `--format json`: `0` it worked, `1` it ran and the answer is no (a
report that does not pass, a store that needs attention, checks that could not be sent), `2` the command itself
was wrong (a missing flag, a path that does not exist). Within a version these only gain optional fields.

See docs/agents.md

#### `PublishedLayerSchema`

```ts
export const PublishedLayerSchema = …
```

What was written for one layer by `atlas report publish`.

#### `PublishResultSchema`

```ts
export const PublishResultSchema = …
```

What `atlas report publish --format json` prints.

#### `StreamResultSchema`

```ts
export const StreamResultSchema = …
```

What `atlas report stream --format json` prints when its input ends.

#### `MergeResultSchema`

```ts
export const MergeResultSchema = …
```

What `atlas report merge --format json` prints.

#### `DoctorCheckSchema`

```ts
export const DoctorCheckSchema = …
```

One thing `atlas report doctor` checked about a store.

#### `DoctorResultSchema`

```ts
export const DoctorResultSchema = …
```

What `atlas report doctor --format json` prints.

#### `CommandErrorSchema`

```ts
export const CommandErrorSchema = …
```

What any `atlas` command prints on standard error, with `--format json`, when the command itself was wrong (exit code 2).

#### `InitSuiteSchema`

```ts
export const InitSuiteSchema = …
```

A test suite `atlas init` found, and the commands that run it and send its results.

#### `InitFileSchema`

```ts
export const InitFileSchema = …
```

A file `atlas init` creates or updates.

#### `InitPlanSchema`

```ts
export const InitPlanSchema = …
```

What `atlas init --format json` prints: everything found about the project, and everything it would change.
Without `--write` nothing is changed. With `--write`, the files are written and `written` says which.

#### `CLI_RESULTS`

```ts
export const CLI_RESULTS = …
```

JSON command contracts, shared by schema publication, agent documentation and executable command checks.
A new result needs an entry here and a runtime scenario in the documentation contract tests.

### Shared statechart vocabulary

Source: `packages/schema/src/common.ts`

Small schemas and types used by both the run manifest (`manifest.ts`) and the spec formats (`spec.ts`): the status
of a run result, who sends an event, how sure a spec is, screenshot references, status tallies, the shape of a
reading problem, and the transition id convention. The statuses and kinds are written by `atlas run` and read by
the visualizer.

See docs/statecharts.md

#### `RUN_STATUSES`

```ts
export const RUN_STATUSES = …
```

Outcome of a state, transition, path or journey in a statechart run: `passed`, `failed`, `flaky` (failed on the
first attempt and passed on the retry) or `not-reached` (no path got there, or the path was blocked before it).

#### `RunStatusSchema`

```ts
export const RunStatusSchema = …
```

Zod enum over `RUN_STATUSES`.

#### `RunStatus`

```ts
export type RunStatus = z.infer<typeof RunStatusSchema>;
```

One of `RUN_STATUSES`.

#### `EVENT_KINDS`

```ts
export const EVENT_KINDS = …
```

Who or what sends an event: a person using the product (`user`), another system (`system`), the
passage of time (`time`), or a child chart handing control back to its parent (`hand-off`).
`member` is read as `user`, for specs written before the kinds were renamed.

#### `EventKindSchema`

```ts
export const EventKindSchema = …
```

Zod schema for an `EVENT_KINDS` value that first rewrites the legacy value `member` to `user`, so specs written
before the kinds were renamed still parse.

#### `EventKind`

```ts
export type EventKind = z.infer<typeof EventKindSchema>;
```

One of `EVENT_KINDS`.

#### `CONFIDENCES`

```ts
export const CONFIDENCES = …
```

How sure a spec is about a state's description (`meta.confidence`): `confirmed` or `assumed`. A run records
`assumed` for a state whose spec does not say.

#### `ConfidenceSchema`

```ts
export const ConfidenceSchema = …
```

Zod enum over `CONFIDENCES`.

#### `Confidence`

```ts
export type Confidence = z.infer<typeof ConfidenceSchema>;
```

One of `CONFIDENCES`.

#### `ImageSchema`

```ts
export const ImageSchema = …
```

A screenshot of a state in a run manifest: `png` and an optional `webp` thumbnail, as paths relative to the run
directory (the folder holding `manifest.json`), plus the other clients' screens at the same moment in a
multi-client run.

#### `Image`

```ts
export type Image = z.infer<typeof ImageSchema>;
```

A parsed `ImageSchema` value.

#### `CountSchema`

```ts
export const CountSchema = …
```

Tally of states or transitions by status: `total` and one count per `RUN_STATUSES` value (`notReached` for
`not-reached`). Used by manifest coverage and run summaries.

#### `Count`

```ts
export type Count = z.infer<typeof CountSchema>;
```

A parsed `CountSchema` value.

#### `ISSUE_SEVERITIES`

```ts
export const ISSUE_SEVERITIES = …
```

Severities of a `DataIssue`, most serious first: `error`, `warning`, `info`.

#### `IssueSeverity`

```ts
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];
```

One of `ISSUE_SEVERITIES`.

#### `DataIssue`

```ts
export type DataIssue = {
  severity: IssueSeverity;
  file: string;
  path: string;
  message: string;
};
```

A problem found while reading a spec or manifest file, in words a non-engineer can read: how serious it is, which
file, where in the file (path segments joined with ` › `), and what is wrong. The visualizer shows these instead of
failing to load.

#### `TRANSITION_ID_SEPARATOR`

```ts
export const TRANSITION_ID_SEPARATOR = …
```

Separator inside a transition id (`<source state> :: <event>`). Ids are not escaped, so a state name containing it
makes an id ambiguous. The same value as core's `TRANSITION_SEPARATOR`.

#### `transitionId`

```ts
export function transitionId(source: string, event: string)
```

Builds the id of a transition, the key of `transitions` in a manifest: the source state's name,
`TRANSITION_ID_SEPARATOR`, then the event name.

### Schema package entry point (`@crvouga/atlas/schema`)

Source: `packages/schema/src/index.ts`. Import: `@crvouga/atlas/schema`

Re-exports every Zod schema, constant and inferred type of the Atlas contract: the layer format and report status
(`layer`), the statechart run manifest (`manifest`, `common`), the spec file formats (`spec`), the run index and
report sources the viewer reads (`runs-index`, `report-sources`) and the server configuration (`server-config`).
The JSON Schemas shipped in `schemas/` are generated from these by `bun run schemas`.

See docs/report-contract.md

### Layer document and report status schemas

Source: `packages/schema/src/layer.ts`

The stable evidence format. A layer is the one unit of evidence every producer writes and every reader combines;
this module also holds the input a producer hands to the publisher (`PublishChecksSchema`), the spec set a report is
laid over (`SpecSetSchema`) and the JSON `atlas report status` prints (`ReportStatusSchema`). Reports are never
stored
as a whole; they are computed by layering.

A layer is one focused recording: the checks one producer ran, on one environment, from one
version and branch. It is immutable and addressed by its content.

Compatibility, which is the point of this file:
- Within a schema major version a change only adds optional fields. Readers ignore fields they
  do not know (every object here is loose), so an old reader reads a newer minor layer.
- The closed enumerations (`status`, `freshness`) change only with a new major version.
- `schemaVersion` is the major version. A reader that is older than a layer says so; it never
  guesses.

Extensibility, which is what makes one format fit any test framework (docs/extending.md):
- Evidence is open. Beyond its outcome a check may carry attachments of any media type, timeline
  steps, annotations, retry attempts, tags, labels, links and namespaced `extensions`. Every one of
  them is optional, so a layer without them is as valid as it ever was.
- Vocabularies are open strings (`role`, `kind`, `type`, `level`, a step's `status`). The values
  documented here are conventions, not a list: a reader shows what it does not know in a generic way.
- `extensions` is where a producer or a tool puts structured data of its own, under a key it owns
  (`com.example.coverage`). Readers keep it and never fail on it.
- Evidence never decides a result. A reader that cannot read a piece of evidence drops that piece and
  keeps the check, its status and its place in the report.

See docs/report-contract.md
See docs/extending.md

#### `LAYER_SCHEMA_VERSION`

```ts
export const LAYER_SCHEMA_VERSION = …
```

The major version of the layer format, written as `schemaVersion` in every layer. `parseLayerDocument` reads a
layer without the field as this version and refuses any other.

#### `CHECK_STATUSES`

```ts
export const CHECK_STATUSES = …
```

Outcomes of a check. Anything not `passed` is not evidence of success.

#### `CheckStatusSchema`

```ts
export const CheckStatusSchema = …
```

Zod enum over `CHECK_STATUSES`, the closed vocabulary of a check's and an attempt's `status`. It changes only with
a new `schemaVersion`.

#### `CheckStatus`

```ts
export type CheckStatus = z.infer<typeof CheckStatusSchema>;
```

One of `CHECK_STATUSES`: `passed` and `failed` are completed results; `running` and `not-run` are unfinished and
never count as a pass.

#### `FRESHNESS`

```ts
export const FRESHNESS = …
```

Why a layer's origin is advisory: `modified` (recorded from a checkout with uncommitted changes) or `unknown`
(origin not captured). Absent on a layer from a clean commit. It never changes a status. A closed vocabulary: it
changes only with a new `schemaVersion`.

#### `LayerRunSchema`

```ts
export const LayerRunSchema = …
```

The execution a layer belongs to, named by the producer: one invocation of a local or manual run, which several
layers (shards, batches, producers) may share. Presentation and history grouping only: it never takes part in the
slot a result fills, in which result wins, or in a status. Absent, a run is told by its CI run URL, else `branch@sha`.
Within one project, layers that carry the same `id` are one run; a later invocation gets another `id`.

#### `LayerRun`

```ts
export type LayerRun = z.output<typeof LayerRunSchema>;
```

The execution of a layer, parsed from `LayerRunSchema`.

#### `MeasurementSchema`

```ts
export const MeasurementSchema = …
```

A number a check measured, such as a latency or a size, with its unit and an optional allowance. A measurement over
its `limit` is reported and never changes the check's status.

#### `ExtensionsSchema`

```ts
export const ExtensionsSchema = …
```

Structured data of a producer's or tool's own, by namespace: `{ "com.example.coverage": { … } }`.
Use a name you own (a reverse domain, or your tool's name). Readers preserve it and never fail on it.

#### `LinkSchema`

```ts
export const LinkSchema = …
```

A link attached to a layer, part, check or annotation: a URL, an optional name and why it is linked.

#### `MomentSchema`

```ts
export const MomentSchema = …
```

Where in a check something happened: at a step, and/or this long after the check started.

#### `EvidenceScopeSchema`

```ts
export const EvidenceScopeSchema = …
```

What a piece of evidence does and does not show, declared by the producer that made it: where it ran, whether its
data and dependencies were real, whether audio was captured, how it was paced and which assertions the result
stands on. Every field is optional and a field that is absent is unknown, never assumed live, physical or end to end.

It is a declaration, not a finding: Atlas shows it as the producer's word, apart from the dimensions the producer
names in `verified` (facts something independent checked). It describes evidence and never decides a status, a slot
or a winner. The nearest declaration wins as a whole, never field by field: an attachment's `scope`, else its
attempt's, else its check's, else its part's, else its layer's.

#### `EvidenceScope`

```ts
export type EvidenceScope = z.output<typeof EvidenceScopeSchema>;
```

A producer-declared evidence scope as stored in a layer, parsed from `EvidenceScopeSchema`.

#### `AttachmentSchema`

```ts
export const AttachmentSchema = …
```

A file or a value that goes with a result: a screenshot, a video, a trace, a log, a DOM or accessibility
snapshot, a HAR, a coverage report, a diff, anything. `contentType` says how to read it; `role` says what
it is for, in an open vocabulary (`screenshot`, `video`, `trace`, `log`, `snapshot`, `har`, `coverage`,
`diff`, `report`…). The bytes are in the layer (`bundleKey`), somewhere else (`uri`), or small enough to
sit inline (`text`).

#### `Attachment`

```ts
export type Attachment = z.output<typeof AttachmentSchema>;
```

An attachment as stored in a layer, parsed from `AttachmentSchema`.

#### `RECORDING_EXPECTATIONS`

```ts
export const RECORDING_EXPECTATIONS = …
```

Whether a check is expected to have a screen recording (a video). `required`: the producer expects one, and the layer's
recording receipt says whether it arrived. `not-applicable`: the check is intentionally unrecorded (an API-only check),
so it counts as neither a recorded pass nor a missing video. An open string: a reader treats any other value, and its
absence, as no expectation.

#### `RecordingItemSchema`

```ts
export const RecordingItemSchema = …
```

The state of one check's recording in a receipt, in an open vocabulary. Conventions: `uploaded` (the video's bytes are in
the layer, with a checksum), `referenced` (only a `uri` was given: Atlas cannot vouch for it), `skipped` (the video was
captured but its bytes were left out, with a reason), `unresolved` (no video was attached at all), `not-applicable`
(intentionally unrecorded). A reader shows a state it does not know as it is and never counts it as uploaded.

#### `RecordingReceiptSchema`

```ts
export const RecordingReceiptSchema = …
```

What a layer's producer published about the recordings it expected: counts and one item per check that expected a
recording (or declared itself not applicable). Written by `publishChecks` when any check declares a
`recordingExpectation`; a layer without it says nothing, which a reader reports as Unknown, never Complete. It only
describes publication: it never changes a check's status, its slot or which result wins.

#### `RecordingReceipt`

```ts
export type RecordingReceipt = z.output<typeof RecordingReceiptSchema>;
```

A recording receipt as stored in a layer, parsed from `RecordingReceiptSchema`.

#### `AnnotationSchema`

```ts
export const AnnotationSchema = …
```

A note about a result: a warning, a deprecation, a coverage figure, an accessibility finding, anything.

#### `Annotation`

```ts
export type Annotation = z.output<typeof AnnotationSchema>;
```

An annotation as stored in a layer, parsed from `AnnotationSchema`.

#### `StepSchema`

```ts
export const StepSchema = …
```

One entry on a check's timeline. Steps are a flat list: nest them with `parentId`, order them by
`offsetMs`. Whatever a framework calls its steps (actions, hooks, requests, spans), they fit.

#### `Step`

```ts
export type Step = z.output<typeof StepSchema>;
```

A timeline step as stored in a layer, parsed from `StepSchema`.

#### `AttemptSchema`

```ts
export const AttemptSchema = …
```

One try of a check that was retried. The check's own status is the last one.

#### `Attempt`

```ts
export type Attempt = z.output<typeof AttemptSchema>;
```

A retry attempt as stored in a layer, parsed from `AttemptSchema`.

#### `CheckSchema`

```ts
export const CheckSchema = …
```

One check: the unit that has a status, such as a Gherkin scenario, a test case or a lint rule. Its `id` is stable
across layers; with the layer's producer, the part's kind, the spec, the environment and the parameters it names
the slot a result fills, and the newest completed result of a slot wins. It carries the outcome (`status`,
`detail`, `measurements`) and, optionally, evidence (tags, labels, links, attachments, annotations, steps,
attempts, extensions) that never decides the result.

#### `Check`

```ts
export type Check = z.output<typeof CheckSchema>;
```

A check as stored in a layer, parsed from `CheckSchema`.

#### `SpecEntrySchema`

```ts
export const SpecEntrySchema = …
```

A spec a layer was recorded against: its path, domain, kind and title, and an advisory fingerprint of its text so a
reader can warn when the spec changed since.

#### `ReportPartSchema`

```ts
export const ReportPartSchema = …
```

A group of checks inside a layer, with an open `kind` (`behavior`, `performance`, `accessibility`…) that is part of
the slot a check fills. `publishChecks` writes a layer with one part. Parts may carry evidence of their own.

#### `LayerSourceSchema`

```ts
export const LayerSourceSchema = …
```

A suite that recorded timelines and captured files, beside its checks. Absent for a layer of plain checks.

#### `RecordingAddressSchema`

```ts
export const RecordingAddressSchema = …
```

Where the recorded tests of a suite live in the store: in the layer's own bundle (`layer`), or at the older address
of a commit and a source name (`commit`).

#### `BundleIndexSchema`

```ts
export const BundleIndexSchema = …
```

The captured files of a layer by file key (`attachments/<sha256>` for attachments): each file's media type and the
byte ranges (`blob` store key, `offset` and `size` in the decompressed blob) whose concatenation is the file.
Written last when a layer is published.

#### `LAYER_ID`

```ts
export const LAYER_ID = …
```

Pattern of a layer id, a spec-set id or a content digest: 64 lowercase hexadecimal digits (a SHA-256).

#### `LayerDocumentSchema`

```ts
export const LayerDocumentSchema = …
```

`layers/manifests/<id>.json`. The id is the SHA-256 of the document without it, so two producers
that record the same thing write the same layer, and a retried publish changes nothing.

#### `LayerDocument`

```ts
export type LayerDocument = z.output<typeof LayerDocumentSchema>;
```

A layer as a reader holds it: the output of `LayerDocumentSchema`, with defaults applied.

#### `ParsedLayer`

```ts
export type ParsedLayer = { readonly ok: true; readonly layer: LayerDocument } | { readonly ok: false; readonly reason: string };
```

The outcome of `parseLayerDocument`: the layer, or the reason it could not be read.

#### `parseLayerDocument`

```ts
export function parseLayerDocument(raw: unknown): ParsedLayer
```

Reads a layer manifest of any age and returns it, or the reason it cannot be read; it never throws. Layers written
before `schemaVersion` existed are version 1. A layer of a newer major version is refused by name ("Upgrade

See /report-contract.md

**Example**

```ts
import { parseLayerDocument } from '@crvouga/atlas/schema';

const parsed = parseLayerDocument(JSON.parse(text));
if (!parsed.ok) throw new Error(parsed.reason);
for (const part of parsed.layer.parts) console.log(part.kind, part.checks.length);
```

#### `AttachmentInputSchema`

```ts
export const AttachmentInputSchema = …
```

An attachment as a producer hands it over, before the publisher stores its bytes. Give the bytes as
`path` (a file, read by the CLI), `base64`, `data` (from code), or `text`; the publisher stores them in
the layer, fills in `bundleKey`, `bytes` and `sha256`, and removes these four.

#### `PublishChecksSchema`

```ts
export const PublishChecksSchema = …
```

The checks of a layer as a producer hands them to the publisher (`publishChecks`, `atlas report publish --checks`),
before the publisher fills in the rest: `id`, `schemaVersion`, the part around the checks and the bundle of
attachment bytes. It is the whole integration surface of a producer that has no timelines to record. `kind` names
the part and defaults to `checks`. Attachments may carry their bytes (`AttachmentInputSchema`). Emitted as
`publish-checks.schema.json`.

#### `PublishChecksInput`

```ts
export type PublishChecksInput = z.input<typeof PublishChecksSchema>;
```

What a caller passes to `publishChecks`: the input type of `PublishChecksSchema`, before defaults.

#### `RecordingCompletenessSchema`

```ts
export const RecordingCompletenessSchema = …
```

Recording completeness across the winning results of a report: `complete` (every expected recording was published),
`incomplete` (at least one is skipped or unresolved), `none-expected` (every layer declared its expectations, and none
required a recording) or `unknown` (a layer has no receipt, so nothing is claimed). Independent of the checks' outcomes.

#### `RecordingCompleteness`

```ts
export type RecordingCompleteness = z.output<typeof RecordingCompletenessSchema>;
```

A parsed `RecordingCompletenessSchema` value.

#### `REPORT_STATUS_SCHEMA_VERSION`

```ts
export const REPORT_STATUS_SCHEMA_VERSION = …
```

The `schemaVersion` of the `ReportStatus` JSON, currently 1.

#### `ReportStatusSchema`

```ts
export const ReportStatusSchema = …
```

What `atlas report status --format json` prints: the combined report in numbers, and whether it
passes. `ok` is the gate: nothing failed, nothing is still running, nothing could not be read,
and every required environment has results.

#### `ReportStatus`

```ts
export type ReportStatus = z.output<typeof ReportStatusSchema>;
```

A parsed `ReportStatusSchema` value.

#### `SpecSetSchema`

```ts
export const SpecSetSchema = …
```

The specs of one version of a project, as published: what the report is laid over. Layers of
evidence say what ran; a spec set says what the specs were. Like layers, spec sets are immutable and
never replace each other: the node shows the newest one of the branch you choose.

#### `SpecSet`

```ts
export type SpecSet = z.output<typeof SpecSetSchema>;
```

A parsed `SpecSetSchema` value.

### live-run.ts

Source: `packages/schema/src/live-run.ts`

@module Live run protocol
A live run is a producer lease, separate from immutable report layers. Server receipt times determine liveness.
Expiration means interrupted, never passed; completed check results retain the stable layer contract.

#### `LiveCheckSchema`

```ts
export const LiveCheckSchema = …
```

Small progress messages: no attachment bytes, bounded step history and text.

#### `LiveRunStartSchema`

```ts
export const LiveRunStartSchema = …
```

The producer starts one UUID-named run. Identity stays fixed for its lifetime.

#### `LiveRunUpdateSchema`

```ts
export const LiveRunUpdateSchema = …
```

Ordered deltas. A retried sequence must have identical content; terminal runs never accept more progress.

#### `LiveRunSchema`

```ts
export const LiveRunSchema = …
```

The bounded live feed response; completed and interrupted runs remain visible as recent history.

#### `LiveCheck`

```ts
export type LiveCheck = z.input<typeof LiveCheckSchema>;
```

The shape a producer uses for a progress check.

#### `LiveRun`

```ts
export type LiveRun = z.output<typeof LiveRunSchema>;
```

A server's live run snapshot.

### Statechart run manifest schemas

Source: `packages/schema/src/manifest.ts`

Zod schemas for `runs/<run-id>/manifest.json`, the file `atlas run` writes for one run of a statechart spec: run
info, the map of states and edges, one record per state, transition, path, journey and seed, the timeline and
business events observed, and coverage. The envelope keeps each section `unknown` so a reader can validate every
record on its own and keep the ones that parse (the visualizer's `parse/manifest.ts` does). Within a
`schemaVersion` only optional fields are added. A run is published into the layered report with `atlas report
publish --manifest`.

See docs/statecharts.md
See docs/report-contract.md

#### `MANIFEST_SCHEMA_VERSIONS`

```ts
export const MANIFEST_SCHEMA_VERSIONS = …
```

Manifest schema versions this package describes. Readers accept these and try newer ones.

#### `LATEST_MANIFEST_SCHEMA_VERSION`

```ts
export const LATEST_MANIFEST_SCHEMA_VERSION = …
```

The newest manifest `schemaVersion` this package describes. The visualizer reads a manifest without a version as
this one, and reads a newer one as far as it understands it.

#### `MEDIA_STATES`

```ts
export const MEDIA_STATES = …
```

Whether a screenshot or clip a run promised is `ready`, still `processing` or `failed`. Absent means ready.

#### `MediaStateSchema`

```ts
export const MediaStateSchema = …
```

Proposed: the runner marks media it has promised but not finished writing, so a viewer can
show "still processing" instead of a broken image. Absent means ready.

#### `TIMELINE_KINDS`

```ts
export const TIMELINE_KINDS = …
```

Kinds of `TimelineEntry` a driver records during a transition: `tap`, `type`, `system` (a call to or from another
system), `screen` (the screen changed), `toast`, `note`, `time` (a clock jump), `notification`. A reader shows a
kind it does not know as a `note`.

#### `SystemCallSchema`

```ts
export const SystemCallSchema = …
```

A call between the product and another system during a transition, recorded on a `system` timeline entry: source,
endpoint, event type, payload and response. The HTTP driver records these.

#### `TimeJumpSchema`

```ts
export const TimeJumpSchema = …
```

Proposed `kind: time`: a clock jump, with the dates before and after.

#### `NotificationSchema`

```ts
export const NotificationSchema = …
```

Proposed `kind: notification`: a push, email or text the member received.

#### `TimelineEntrySchema`

```ts
export const TimelineEntrySchema = …
```

One moment in a transition's timeline: what happened (`kind`, `label`), when (`atMs` from the start of the clip)
and the details that go with the kind. The timeline becomes the captions of the transition's clip.

#### `TimelineEntry`

```ts
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
```

A parsed `TimelineEntrySchema` value.

#### `CloudEventSchema`

```ts
export const CloudEventSchema = …
```

A CloudEvents 1.0 event (JSON format), as an event source observed it.

#### `CloudEvent`

```ts
export type CloudEvent = z.infer<typeof CloudEventSchema>;
```

A parsed `CloudEventSchema` value.

#### `BusinessEventsSchema`

```ts
export const BusinessEventsSchema = …
```

The business events a state expects (from `meta.events`) against what event sources observed while the step ran:
`expected`, `observed`, `missing`, and `noSignal` for those with no observable signal mapped.

#### `BusinessEvents`

```ts
export type BusinessEvents = z.infer<typeof BusinessEventsSchema>;
```

A parsed `BusinessEventsSchema` value.

#### `CheckResultSchema`

```ts
export const CheckResultSchema = …
```

The result of one item of a state's `meta.checks`: its text, whether it held, and what was expected and seen when
it did not. A failed check fails the state.

#### `CheckResult`

```ts
export type CheckResult = z.infer<typeof CheckResultSchema>;
```

A parsed `CheckResultSchema` value.

#### `RecognizerSchema`

```ts
export const RecognizerSchema = …
```

What a state's recogniser saw: whether the state matched, and each signal with what was expected (visible or
hidden) and whether it was visible.

#### `RunInfoSchema`

```ts
export const RunInfoSchema = …
```

The `run` section of a manifest: identity, timing and provenance of the run (id, start and finish, commit, branch,
environment, mode), the spec version and directory, how far it has got, and how the plan was split, scoped, reused
or merged.

#### `RunInfo`

```ts
export type RunInfo = z.infer<typeof RunInfoSchema>;
```

A parsed `RunInfoSchema` value.

#### `ManifestChartSchema`

```ts
export const ManifestChartSchema = …
```

A chart that took part in the run: its id, spec file and description, the state of its parent that invokes it, and,
for each of its final states, the hand-off event its parent receives.

#### `MapNodeSchema`

```ts
export const MapNodeSchema = …
```

A state in the map of the composed product: id, parent state, chart, type, initial child, and whether it is inside
the scope of the run.

#### `MapEdgeSchema`

```ts
export const MapEdgeSchema = …
```

A transition in the map: its id (see `transitionId`), source and target state names (the target is empty when the
event leads nowhere), the event, who sends it, and whether it is inside the scope of the run.

#### `StateRecordSchema`

```ts
export const StateRecordSchema = …
```

The result for one state: what the spec says about it (description, snapshot, confidence, sources, expected
events), whether the run reached it, its screenshots, what the recogniser saw, the business events and
`meta.checks` results, and the paths that reached it.

#### `StateRecord`

```ts
export type StateRecord = z.infer<typeof StateRecordSchema>;
```

A parsed `StateRecordSchema` value.

#### `ClipSchema`

```ts
export const ClipSchema = …
```

A video of one transition: `video` and `poster` as paths relative to the run directory, its duration, and which
client's screen it shows.

#### `Clip`

```ts
export type Clip = z.infer<typeof ClipSchema>;
```

A parsed `ClipSchema` value.

#### `TransitionRecordSchema`

```ts
export const TransitionRecordSchema = …
```

The result for one transition (an event leaving a state): source, target, event, who sends it, how the
implementation makes it happen, its status, clip and timeline, why it was not reached, and the paths that took it.
Keyed in a manifest by its id (see `transitionId`).

#### `TransitionRecord`

```ts
export type TransitionRecord = z.infer<typeof TransitionRecordSchema>;
```

A parsed `TransitionRecordSchema` value.

#### `PathStepSchema`

```ts
export const PathStepSchema = …
```

One step of a path: the event, the transition it takes and its outcome, with the reason when it was not reached.

#### `PathRecordSchema`

```ts
export const PathRecordSchema = …
```

The result for one planned path: a curated `journey` or a `generated` path covering transitions. It holds the
status, every attempt (a failed first attempt is retried once unless retries are off), the steps and where it
stopped, and the identity (`key`), start states and seed that let results from different runs compose.

#### `PathRecord`

```ts
export type PathRecord = z.infer<typeof PathRecordSchema>;
```

A parsed `PathRecordSchema` value.

#### `JourneyRecordSchema`

```ts
export const JourneyRecordSchema = …
```

A journey's result, composed from the paths it is cut into (one per seeded stretch).

#### `JourneyRecord`

```ts
export type JourneyRecord = z.infer<typeof JourneyRecordSchema>;
```

A parsed `JourneyRecordSchema` value.

#### `SeedRecordSchema`

```ts
export const SeedRecordSchema = …
```

A configuration the implementation can put the system in directly, and what checks it.

#### `SeedRecord`

```ts
export type SeedRecord = z.infer<typeof SeedRecordSchema>;
```

A parsed `SeedRecordSchema` value.

#### `ReportsSchema`

```ts
export const ReportsSchema = …
```

Other formats the run wrote, relative to the manifest: JUnit XML, CTRF JSON, Mermaid.

#### `PrivacySchema`

```ts
export const PrivacySchema = …
```

Result of the privacy scan of a run: whether it passed and what it found. Media of a run whose scan did not pass
are not uploaded with `--upload-run`.

#### `ManifestEnvelopeSchema`

```ts
export const ManifestEnvelopeSchema = …
```

The top level of `runs/<run-id>/manifest.json`. Sections are `unknown` here so a reader can
validate each record on its own and keep the valid ones; the record schemas above are the
contract for each entry.

### project.ts

Source: `packages/schema/src/project.ts`

@module Project identity
Project slugs partition every report, spec, recording and live run on an Atlas node.

#### `ProjectSlugSchema`

```ts
export const ProjectSlugSchema = …
```

A portable project namespace: 1–64 lowercase letters, digits or hyphens, starting and ending with a letter or digit.

#### `ProjectSchema`

```ts
export const ProjectSchema = …
```

One project advertised by a node. The default project contains uploads from older clients.

#### `ProjectsSchema`

```ts
export const ProjectsSchema = …
```

Project discovery response.

#### `Project`

```ts
export type Project = z.output<typeof ProjectSchema>;
```

A project's public identity.

### Report sources and change notices

Source: `packages/schema/src/report-sources.ts`

The files and events the viewer uses to find runs. `ReportSourcesSchema` validates the sources file named by
`ATLAS_SOURCES_FILE`, which lists extra places to read runs from (a directory, or another host over HTTP).
`AtlasChangeSchema` is the payload of the `atlas:change` event that tells a live viewer that specs or runs changed.
Both are read by the visualizer; the server sends the change notice.

See docs/report-backends.md

#### `RemoteReportSourceSchema`

```ts
export const RemoteReportSourceSchema = …
```

A source reached over HTTP: `type` `http` or `api`, a base URL without credentials, an optional events URL for live
updates, a polling interval in milliseconds (1 000 to 3 600 000) and a `live` flag. The id `workspace` is reserved
for the local runs directory.

#### `DirectoryReportSourceSchema`

```ts
export const DirectoryReportSourceSchema = …
```

A source that is a directory of runs on the machine running the viewer. A relative `runs` path is resolved against
the sources file.

#### `ReportSourceSchema`

```ts
export const ReportSourceSchema = …
```

One source: a directory or a remote host.

#### `ReportSource`

```ts
export type ReportSource = z.infer<typeof ReportSourceSchema>;
```

A parsed `ReportSourceSchema` value.

#### `RemoteReportSource`

```ts
export type RemoteReportSource = z.infer<typeof RemoteReportSourceSchema>;
```

A parsed `RemoteReportSourceSchema` value.

#### `ReportSourcesSchema`

```ts
export const ReportSourcesSchema = …
```

The sources file, `{ "schemaVersion": 1, "sources": [...] }`. Source ids must be unique.

#### `AtlasChangeSchema`

```ts
export const AtlasChangeSchema = …
```

The payload of the `atlas:change` event: which `scope` changed (`specs` or `runs`), the files and run ids concerned
(empty lists when not known), and the source that changed. Unknown payloads are ignored by the viewer.

#### `AtlasChange`

```ts
export type AtlasChange = z.infer<typeof AtlasChangeSchema>;
```

A parsed `AtlasChangeSchema` value.

### Runs index

Source: `packages/schema/src/runs-index.ts`

`runs/index.json`, the list of statechart runs a host serves, newest first, and the summary the viewer keeps for
each. The index lists runs as `unknown` so a reader can validate each summary on its own and drop the ones that do
not parse.

See docs/statecharts.md

#### `RUN_PROGRESS`

```ts
export const RUN_PROGRESS = …
```

Whether a run is still being written (`running`) or finished (`complete`).

#### `RunSummarySchema`

```ts
export const RunSummarySchema = …
```

One run in the index: its id, start, mode, commit, branch, duration and spec version, whether it is `running` or
complete, the planned and completed path counts of a running run, whether its manifest exists yet, and the state,
transition and journey tallies.

#### `RunSummary`

```ts
export type RunSummary = z.infer<typeof RunSummarySchema>;
```

A parsed `RunSummarySchema` value.

#### `RunsIndexSchema`

```ts
export const RunsIndexSchema = …
```

`runs/index.json`: the runs a host serves, newest first.

### Server configuration schema

Source: `packages/schema/src/server-config.ts`

The schema of `atlas.server.json`, the file that configures `atlas serve` and `atlas dev`: where to listen, which
bearer tokens may read, publish or administer, and limits. Where reports are kept is not here: the server stores
everything in S3-compatible storage named by required `ATLAS_S3_*` environment variables, never in this file.
Every field has a default. Unlike the report format, unknown keys are an error, so a typo (or a removed `data`,
`backends` or `write` key) is reported instead of ignored. Flags and environment variables override the file.

See docs/deploying.md
See docs/server.md

#### `ServerRoleSchema`

```ts
export const ServerRoleSchema = …
```

What a bearer token may do: `read` (look), `publish` (also upload) or `admin` (also remove scratch objects).

#### `ServerRole`

```ts
export type ServerRole = z.infer<typeof ServerRoleSchema>;
```

One of the roles of `ServerRoleSchema`.

#### `ServerTokenSchema`

```ts
export const ServerTokenSchema = …
```

A bearer token: a name for logs, a role, and the token itself or the name of the environment variable that holds it
(exactly one of the two).

#### `ServerConfigSchema`

```ts
export const ServerConfigSchema = …
```

The whole `atlas.server.json`: listening address, authentication, the viewer to serve, which layers take part in the report, refresh and heartbeat intervals, request limits and logging.

#### `ServerConfig`

```ts
export type ServerConfig = z.output<typeof ServerConfigSchema>;
```

A server configuration after parsing, with every default applied.

#### `ServerConfigInput`

```ts
export type ServerConfigInput = z.input<typeof ServerConfigSchema>;
```

A server configuration as written, before defaults are applied.

#### `ServerEditableSettingsSchema`

```ts
export const ServerEditableSettingsSchema = …
```

Report and live-run settings editable by an admin. Storage, authentication, listeners and the served site stay deployment-owned. Replaces the saved portion of the user state; omitted fields use defaults after restart.

#### `ServerSettingsSnapshotSchema`

```ts
export const ServerSettingsSnapshotSchema = …
```

The settings API response: editable configuration saved in the user state in S3, active values, concurrency revision and restart/precedence guidance. Authentication token settings are excluded.

### Statechart spec schemas

Source: `packages/schema/src/spec.ts`

Zod schemas for the files in a specs directory: the `meta` a chart's states carry, XState-style machine configs,
`journeys.yaml`, the optional product map `atlas.yaml`, `<chart>.layout.json` and `specs/index.json`, plus the
filename patterns that identify statechart files. They describe what a person writes, so readers validate each
piece on its own and report problems rather than rejecting the whole spec (the visualizer's `parse/spec.ts` does).
The pure subset of statecharts that Atlas executes is documented in `docs/statecharts.md`.

See docs/statecharts.md

#### `SPEC_SCHEMA_VERSION`

```ts
export const SPEC_SCHEMA_VERSION = …
```

Version of the spec file formats, currently 1. `LayoutFileSchema` and `SpecIndexSchema` accept only `schemaVersion:
1`.

#### `DesignLinkSchema`

```ts
export const DesignLinkSchema = …
```

A state's link to its design: an image (URL or spec-relative path), and optionally where the design lives, such as
a Figma frame.

#### `DesignLink`

```ts
export type DesignLink = z.infer<typeof DesignLinkSchema>;
```

A parsed `DesignLinkSchema` value.

#### `ContractStepSchema`

```ts
export const ContractStepSchema = …
```

One Given/When/Then line of a business contract: the keyword, its text, and an optional data table or doc string.

#### `BusinessContractSchema`

```ts
export const BusinessContractSchema = …
```

A business rule copied from its authoritative `source` as exact Given/When/Then steps, carried in a state's
`meta.contracts`.

#### `BusinessContract`

```ts
export type BusinessContract = z.infer<typeof BusinessContractSchema>;
```

A parsed `BusinessContractSchema` value.

#### `StateMetaShape`

```ts
export const StateMetaShape = …
```

Every field a state's `meta` may carry. Each one is optional on its own: the visualizer keeps
the fields that parse and reports the ones that don't.

#### `StateMetaSchema`

```ts
export const StateMetaSchema = …
```

`StateMetaShape` with every field optional: the `meta` of a state or of a whole chart.

#### `StateMeta`

```ts
export type StateMeta = z.infer<typeof StateMetaSchema>;
```

A parsed `StateMetaSchema` value.

#### `TransitionTargetSchema`

```ts
export const TransitionTargetSchema = …
```

The target of an event transition: a state name (or `#id`) written as a string, or an object with `target` and optional declarative `meta`.

#### `STATE_TYPES`

```ts
export const STATE_TYPES = …
```

Kinds of state in the composed map: `atomic`, `compound`, `parallel`, `final`.

#### `StateType`

```ts
export type StateType = (typeof STATE_TYPES)[number];
```

One of `STATE_TYPES`.

#### `StateNodeConfig`

```ts
export type StateNodeConfig = {
  id?: string | undefined;
  initial?: string | undefined;
  type?: 'parallel' | 'final' | undefined;
  meta?: StateMeta | undefined;
  states?: Record<string, StateNodeConfig> | undefined;
  on?: Record<string, z.infer<typeof TransitionTargetSchema>> | undefined;
};
```

TypeScript shape of one state of a machine config, matching `StateNodeSchema`: optional `id`, `initial`, `type`
(`parallel` or `final`), `meta`, nested `states` and `on` transitions.

#### `StateNodeSchema`

```ts
export const StateNodeSchema: z.ZodType<StateNodeConfig>
```

One state of an XState machine config, recursively, restricted to what Atlas reads: nesting, `parallel` and `final`
types, event transitions and `meta`. Guards, actions and the rest of XState are rejected by `atlas lint`, not by
this schema. Emitted as `state-node.schema.json`.

#### `MachineSchema`

```ts
export const MachineSchema = …
```

A whole chart: its `id`, optional `initial`, `type` and `meta`, and its `states`. The states are `unknown` here;
validate each with `StateNodeSchema`.

#### `JourneySchema`

```ts
export const JourneySchema = …
```

One curated journey in `journeys.yaml`: the business events replayed in order from the initial state, the states it
must end in, and an optional owner and tour flag. `atlas lint` replays every journey, and `atlas run` runs each as
its own path.

#### `JourneyConfig`

```ts
export type JourneyConfig = z.infer<typeof JourneySchema>;
```

A parsed `JourneySchema` value.

#### `JourneysFileSchema`

```ts
export const JourneysFileSchema = …
```

`journeys.yaml`: a `journeys` map from journey name to journey. The entries are `unknown` here; validate each with
`JourneySchema`.

#### `AtlasContextSchema`

```ts
export const AtlasContextSchema = …
```

A product area declared in `atlas.yaml`: its id, display name, description, owner and the spec-relative directories
whose charts belong to it.

#### `AtlasHandOffSchema`

```ts
export const AtlasHandOffSchema = …
```

A hand-off declared in `atlas.yaml` between two product areas: the ids of the area it `from` and `to`, and the
event that passes control.

#### `AtlasFileSchema`

```ts
export const AtlasFileSchema = …
```

`atlas.yaml` at the specs root: the product map. Optional; without it every directory holding a
chart becomes a context named after its first path segment.

#### `LayoutFileSchema`

```ts
export const LayoutFileSchema = …
```

`<chart>.layout.json` beside a chart: a hand-tuned layout the visualizer respects.

#### `LayoutFile`

```ts
export type LayoutFile = z.infer<typeof LayoutFileSchema>;
```

A parsed `LayoutFileSchema` value.

#### `SpecIndexSchema`

```ts
export const SpecIndexSchema = …
```

`specs/index.json`: the statechart files under the specs root, so a static host can serve the
spec without directory listings. `ref` names the branch or commit the files came from.

#### `SpecIndex`

```ts
export type SpecIndex = z.infer<typeof SpecIndexSchema>;
```

A parsed `SpecIndexSchema` value.

#### `STATECHART_FILE_PATTERNS`

```ts
export const STATECHART_FILE_PATTERNS = …
```

Patterns for the paths of statechart spec files: `atlas.yaml`, `machine.yaml|json` and `*.machine.yaml|json`,
`*.scxml`, `journeys.yaml`, `known-issues.md`, `open-questions.md` and `*.layout.json`, in any directory.

#### `isStatechartFile`

```ts
export function isStatechartFile(path: string)
```

Whether a spec-relative path (using `/`) matches `STATECHART_FILE_PATTERNS`.

### User state schema

Source: `packages/schema/src/user-state.ts`

The one JSON document that holds everything a person using Atlas has chosen, as opposed to what an operator deployed:
the garbage collection policy and the saved server settings. The server keeps it in S3-compatible object storage
(`server/state.json` under the configured prefix) and nowhere else: not in a file, a database or the browser. A
document that does not exist yet means nothing has been chosen; a document that cannot be read is an error, never
an empty state. Unknown keys are kept, so an older server does not drop what a newer one wrote.

See docs/server.md#user-state-and-garbage-collection

#### `GcPolicySchema`

```ts
export const GcPolicySchema = …
```

The garbage collection policy: which report layers the server may delete from S3, and when. Only layers that the
report has loaded and that no longer decide any result (every check they carry has since been superseded by a newer
layer) are ever candidates, and the newest `keepLatest` layers are always kept. With `enabled: false` nothing is deleted.

#### `GcPolicy`

```ts
export type GcPolicy = z.output<typeof GcPolicySchema>;
```

A garbage collection policy as stored, defaults applied.

#### `GcPolicyInput`

```ts
export type GcPolicyInput = z.input<typeof GcPolicySchema>;
```

A garbage collection policy as written, before defaults are applied.

#### `GcRunSchema`

```ts
export const GcRunSchema = …
```

What one pass of garbage collection found and did, for one project.

#### `GcRun`

```ts
export type GcRun = z.output<typeof GcRunSchema>;
```

One pass of garbage collection, see {@link GcRunSchema}.

#### `UserStateSchema`

```ts
export const UserStateSchema = …
```

The user state document stored in S3. Both parts are optional: absent means "never chosen".

#### `UserState`

```ts
export type UserState = z.output<typeof UserStateSchema>;
```

The user state document, see {@link UserStateSchema}.

#### `GcSnapshotSchema`

```ts
export const GcSnapshotSchema = …
```

`GET /api/settings/gc` and `PUT /api/settings/gc`: the policy as saved in S3 (`null` when none has been saved), the
revision to send back in `If-Match`, and the result of the last pass this server ran.

#### `GcSnapshot`

```ts
export type GcSnapshot = z.output<typeof GcSnapshotSchema>;
```

The garbage collection settings response, see {@link GcSnapshotSchema}.

#### `GcRunResultSchema`

```ts
export const GcRunResultSchema = …
```

`POST /api/settings/gc/run`: the passes that ran, one per project.
