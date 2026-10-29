# Evidence: attachments, timelines, snapshots and everything else

Atlas is opinionated about **specs** and open about **evidence**.

- A *spec* says what the product should do, in a notation Atlas knows how to read and show: statecharts,
  Gherkin, Quint, DMN, Alloy, OpenSLO. That list is short on purpose, and each notation gets a real view.
- *Evidence* is what a test run left behind. It is open-ended, because every framework leaves something
  different: a screenshot, a video, a Playwright trace, a HAR, a DOM or accessibility snapshot, a console
  log, a flame graph, a coverage map, a diff, a timeline of requests. Atlas stores any of it, shows what it
  can, and keeps and offers the rest.

The format is built so that a new kind of evidence **never** needs a new version of Atlas to be recorded, and
never breaks anyone who has not upgraded. This page is the model and the rules that guarantee it.

- [What a result can carry](#what-a-result-can-carry)
- [The rules that keep it compatible, forever](#the-rules-that-keep-it-compatible-forever)
- [Attach evidence](#attach-evidence)
- [What each part looks like](#what-each-part-looks-like)
- [Adding something new](#adding-something-new)

## What a result can carry

A check is a result: an `id`, a `status`, a `title`, and a `detail`. Beyond that, a check (and a layer, and a part) may
carry any of these. Every one is optional.

| Field | What it is |
| --- | --- |
| `attachments[]` | Files and values: a screenshot, a video, a trace, a log, a snapshot, a HAR, a report. Any media type. |
| `steps[]` | A timeline: what happened, in order, with timing, nested with `parentId`. |
| `annotations[]` | Notes about the result: a warning, a deprecation, an accessibility finding, a coverage figure. |
| `attempts[]` | Every try, when the check was retried. |
| `tags[]` | Free labels to filter by: `smoke`, `payments`. |
| `labels{}` | Facts about the result that are not its identity: `owner`, `severity`, `browser`, `build`. |
| `scope{}` | What the evidence does and does not show: surface, device kind, synthetic data, scripted dependencies, audio, pacing, what was asserted and its limits. Unknown when absent. See [Evidence scope](rich-evidence.md#evidence-scope). |
| `links[]` | Where to read more: the CI run, the issue, the trace client. |
| `extensions{}` | Structured data of your own or a tool's, under a name you own. |
| `measurements[]` | Numbers, with units and an allowance (already part of the contract). A measurement of `kind` `product-latency` names a user-visible response time between two events; see [Product latency](rich-evidence.md#product-latency). |

An attachment may carry its own `tags[]` (`demo`): shown as `#demo` and searchable; see
[Tagging artifacts and demos](rich-evidence.md#tagging-artifacts-and-demos).

On a **layer** the same fields describe the whole run: its CI log, a coverage report, an archive of traces, the
build number, a link to the pipeline.

```json
{
  "id": "specs/checkout.feature > Pays by card",
  "title": "Pays by card",
  "status": "failed",
  "detail": "expected a receipt",
  "tags": ["smoke"],
  "labels": { "owner": "payments-team", "browser": "chromium" },
  "steps": [
    { "id": "open", "name": "Open the cart", "kind": "action", "status": "passed", "offsetMs": 0, "durationMs": 800 },
    { "id": "req", "parentId": "open", "name": "GET /cart", "kind": "request", "status": "passed", "offsetMs": 20, "durationMs": 120 },
    { "name": "Pay", "kind": "action", "status": "failed", "offsetMs": 900, "durationMs": 3000, "detail": "timeout",
      "attachments": [{ "name": "failure.png", "role": "screenshot", "contentType": "image/png", "bundleKey": "attachments/<sha256>" }] }
  ],
  "attachments": [
    { "name": "run.webm", "role": "video", "contentType": "video/webm", "bundleKey": "attachments/<sha256>", "durationMs": 4200 },
    { "name": "trace.zip", "role": "trace", "contentType": "application/zip", "uri": "https://artifacts.example.com/trace.zip" }
  ],
  "annotations": [{ "type": "accessibility", "level": "warning", "message": "Low contrast on Pay", "source": { "file": "src/pay.tsx", "line": 12 } }],
  "attempts": [{ "index": 0, "status": "failed" }, { "index": 1, "status": "failed" }],
  "extensions": { "com.example.coverage": { "lines": 0.82 } }
}
```

The complete reference, with every field, is the JSON Schema
[`layer.schema.json`](../packages/schema/schemas/layer.schema.json) (what a stored layer is) and
[`publish-checks.schema.json`](../packages/schema/schemas/publish-checks.schema.json) (what you hand to
`publishChecks` or `atlas report publish --checks`, where an attachment may name a `path` or carry `data`).

## The rules that keep it compatible, forever

These are part of [the report contract](report-contract.md#versioning-and-stability). They are why a layer
written today is readable by every Atlas to come, and a layer written by a future Atlas is readable today.

1. **Everything new is optional.** A layer with none of the fields above is as valid as it has ever been. No
   field is ever made required, renamed, removed, or given a different meaning.
2. **Every object is open.** A reader keeps and ignores fields it does not know, at every level: layer, part,
   check, step, attachment, annotation, measurement. A field added next year survives a read by an Atlas that
   does not know it, and a copy carries it along.
3. **Vocabularies are open strings.** `role`, `kind`, `type`, `level`, a step's `status` and the `kind` of a
   part have conventional values (below), not a list. A value nobody has heard of is shown generically, and
   never rejected.
4. **Only three things are closed**, and they will stay so: a check's `status` (`passed`, `failed`, `running`,
   `not-run`), `freshness`, and `schemaVersion`. Everything that decides a result is in those. Anything richer
   goes in evidence.
5. **`extensions` is yours.** Put structured data of your own under a key you own: a reverse domain
   (`com.example.coverage`) or your tool's name (`io.playwright`). Readers preserve it, show it as raw data, and
   never fail on it. Two tools cannot collide, because each uses its own name.
6. **Evidence never decides a result.** A status, a slot and a winner never depend on an attachment, a step or an
   annotation. A reader that cannot read a piece of evidence drops *that piece* and keeps the check, its status
   and the rest of its evidence. A broken screenshot reference never turns a pass into an unknown.
7. **Bytes are by reference.** A layer holds files as `bundleKey` (stored in the layer, by content, once), `uri`
   (somewhere else), or a short inline `text`. Producers never need to know how files are stored.
8. **New kinds of evidence are data.** Recording a new role, media type, annotation type or extension namespace needs no
   change to Atlas. Showing it nicely needs one renderer, and until then it is listed with its name and a
   download.

Two checks guard this in the repository: `packages/reports/tests/fixtures/layer-v1-extended.json` (a layer carrying
every kind of evidence and values from the future) and `layer-extensibility.test.ts`, which proves unknown
fields survive at every level, malformed evidence is dropped without losing the result, and a reader of the
first version of the format still reads it all.

## Attach evidence

### From the command line

```sh
# Files a CTRF report names (attachments, a base64 screenshot, stdout and stderr, steps, retries, tags) are
# read from the report's own folder and stored in the layer.
atlas report publish --producer e2e --ctrf ctrf-report.json --environment desktop-web

# Files and facts about the whole run.
atlas report publish --producer e2e --junit out.xml \
  --attach ci.log --attach trace=playwright-traces.zip \
  --label build=4821 --label browser=chromium --link 'CI=https://ci.example.com/runs/42'
```

- `--attach <file>` attaches a file to the whole layer. `--attach <role>=<file>` also gives it a role.
- `--label key=value` and `--link [name=]<url>` add facts and links about the run.
- A file the report names that cannot be found, is not allowed, or is over `--max-attachment-mb` (512) is skipped
  with a warning; the results are still published. All the files of one publish together are limited by
  `--max-total-attachment-mb` (2048), because they are held in memory while stored.
- **A report is data from a test run, not instructions.** The files it names are read only from its own folder
  and from each `--attach-root <dir>` you give; never a hidden file (`.env`, `.aws`, `.git`), never a link that
  leads out, never an absolute path elsewhere. Otherwise a test could print
  `[[ATTACHMENT|/home/runner/.aws/credentials]]` and have it uploaded. What you type with `--attach` is yours to
  choose, and is read as written.
- CTRF is mapped completely: `steps`, `attachments`, `screenshot`, `stdout`, `stderr`, `retryAttempts`, `tags`,
  `browser`, `device`, `flaky`, `snippet` and `extra`. JUnit gives each test its `<system-out>`, `<system-err>`,
  `<properties>` and Jenkins `[[ATTACHMENT|path]]` lines. An Atlas run gives each path its steps.

### From a checks file

For anything else, write what you have. `path` is read relative to the file; the same screenshot used twice is
stored once.

```json
{
  "producer": "playwright",
  "environment": "desktop-web",
  "recordedAtMs": 1760000000000,
  "labels": { "build": "4821" },
  "checks": [
    {
      "id": "specs/checkout.feature > Pays by card",
      "title": "Pays by card",
      "status": "failed",
      "detail": "expected a receipt",
      "specPath": "specs/checkout.feature",
      "tags": ["smoke"],
      "steps": [
        { "id": "open", "name": "Open the cart", "kind": "action", "status": "passed", "offsetMs": 0, "durationMs": 800 },
        { "name": "Pay", "kind": "action", "status": "failed", "offsetMs": 900, "durationMs": 3000, "attachments": [{ "name": "failure.png", "role": "screenshot", "path": "evidence/failure.png" }] }
      ],
      "attachments": [
        { "name": "run.webm", "role": "video", "path": "evidence/run.webm" },
        { "name": "console.log", "role": "log", "text": "warn: slow response" }
      ],
      "annotations": [{ "type": "accessibility", "level": "warning", "message": "Low contrast on Pay" }],
      "extensions": { "io.playwright": { "retries": 1 } }
    }
  ]
}
```

### From code

```ts
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';

await publishChecks(store, {
  producer: 'e2e',
  recordedAtMs: Date.now(),
  checks: [{
    id: 'pay', title: 'Pays by card', status: 'failed',
    attachments: [
      { name: 'failure.png', role: 'screenshot', data: await Bun.file('failure.png').bytes() }, // bytes: stored in the layer
      { name: 'trace.zip', role: 'trace', uri: 'https://artifacts.example.com/trace.zip' }       // elsewhere: a reference
    ],
    steps: [{ name: 'Pay', kind: 'action', status: 'failed', offsetMs: 900, durationMs: 3000 }],
    extensions: { 'com.example.cost': { cents: 3 } }
  }]
});
```

Give bytes as `data` (or `base64`, or a long `text`); the publisher stores them in the layer by content,
fills in `bundleKey`, `bytes` and `sha256`, and removes what you handed over. Identical files are stored once.
Publishing the same input twice writes the same layer.

## What each part looks like

**Attachments** are shown by what they are, from their media type:

| Media type | Shown as |
| --- | --- |
| `image/*` | A picture, opening full size |
| `video/*` | A video with controls, seekable (range requests) |
| `audio/*` | An audio player |
| `text/html` | A page snapshot in a frame with no permissions: nothing in it can run |
| `application/pdf` | A frame |
| `text/*`, JSON, XML, YAML | The text, pretty-printed for JSON, up to 200 000 characters |
| anything else | Its name, its role, its type and size, and a download |

Attachment bytes are served as untrusted: never sniffed, with a sandboxing policy, never embeddable by another site.
An attachment's `uri` is followed only if it is an `http` or `https` address.

**Steps** are a flat list: order them by `offsetMs`, nest them by `parentId`. Whatever your framework calls them
(actions, hooks, requests, spans, Given/When/Then) they fit. **Annotations** show their `level` (`info`,
`warning`, `error`; any other level is shown as written) and where in the source they point.
**Extensions** you add appear as raw data under the result, so nothing a tool recorded is out of reach.

Conventional values, in case you want to be understood by others: attachment `role`: `screenshot`, `video`,
`trace`, `log`, `snapshot`, `har`, `coverage`, `diff`, `report`, `captions`. Step `kind`: `action`,
`assertion`, `hook`, `request`, `span`, `given`, `when`, `then`. Step `status`: `passed`, `failed`, `skipped`.
Annotation `type`: `note`, `warning`, `deprecation`, `issue`, `accessibility`, `coverage`.

## Adding something new

| You want to record | Do |
| --- | --- |
| A kind of file Atlas has never seen | Attach it with its media type and a `role`. It is stored and offered for download today. |
| Structured data of your own | Put it in `extensions` under a name you own. It is kept, and shown as raw data. |
| A new annotation type, role or step kind | Use it. Open vocabularies need no registration. |
| Something that should be shown well | Ask for a renderer (below). |
| A field every tool should have | Open an issue. It is added as an optional field, and the rules above guarantee nothing breaks. |

**A renderer** is one entry in the client's list (`artifactRenderers` in
`packages/visualizer/src/evidence/artifacts.tsx`): how to show an attachment of a media type. The first one that
matches wins:

```tsx
registerArtifactRenderer({
  id: 'flamegraph',
  matches: (attachment, mediaType) => mediaType === 'application/x-flamegraph',
  render: (attachment, { url }) => <FlameGraph src={url} />
});
```

The client is part of Atlas, so a renderer for a new media type is a contribution to Atlas: file an issue
([reporting issues](reporting-issues.md)) with a sample file. Until it lands, the attachment is still stored,
listed with its name, role, type and size, and offered for download, and everything else about the result is
unaffected.
