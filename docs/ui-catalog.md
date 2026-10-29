# The UI catalog

A browsable inventory of a product's user interface: each **state** (a screen, or one state of a screen) captured once per
**profile** (a viewport, a color scheme, a device), with the facts needed to find and trust it, and what should exist but has not
been captured yet. Any program that can write a layer can feed it, and the catalog fills in as results stream in, so a run of
thousands of captures can be watched while it happens and split across as many machines as needed.

Nothing about it is new to the report contract. A state is an ordinary check with a screenshot, the expected set is an ordinary
layer, and the stream is the one every viewer already holds. This page is the convention that makes those usable as a catalog, the
decisions behind it, the command line, and what stays in your project.

Developing Atlas itself? `bun run dev` populates the todo example's catalog automatically, alongside its other reports.
Choose **UI catalog** from the spec-type menu to browse seven states across desktop and mobile profiles, including
empty, offline and pending-sync states. The collector is
[`examples/todo/catalog.ts`](https://github.com/crvouga/atlas/blob/main/examples/todo/catalog.ts): it starts its own isolated
app server, drives the real UI, publishes the expected set and screenshots, and closes its browser and server.

- [How a state is written](#how-a-state-is-written)
- [What is expected](#what-is-expected)
- [Publishing from any collector](#publishing-from-any-collector)
- [The command line](#the-command-line)
- [Sharding](#sharding)
- [Collecting with a queue](#collecting-with-a-queue)
- [Streaming and loading](#streaming-and-loading)
- [Exploring it](#exploring-it)
- [Comparing two commits or two profiles](#comparing-two-commits-or-two-profiles)
- [A single file that needs no server](#a-single-file-that-needs-no-server)
- [Decisions](#decisions)
- [What stays in your project, and what Atlas does not do](#what-stays-in-your-project-and-what-atlas-does-not-do)

## How a state is written

A state is one **check** in a layer whose part has `kind` **`ui-state`**.

| Part of the idea | Where it goes |
| --- | --- |
| The state's identity | The check `id`. Make it stable (`checkout/payment`, `home?cohort=new`): a new capture replaces an old one only if the id is the same. |
| How the capture went | `status`: `passed` is **captured**, `failed` is attempted and failed (say why in `detail`), `running` is being taken, `not-run` is skipped. |
| The picture | An attachment with `role: "screenshot"` (else the first image), stored in the layer by content or given as an `https` `uri`. `width` and `height` help the viewer lay it out. |
| The profile | The layer's `environment` (`desktop-web`, `mobile-web`, `ios`, `android`) and `parameters` (`{ "viewport": "390x844", "scheme": "dark" }`). Parameters split a slot, so the same state at another viewport is **another result, side by side**, never a replacement. |
| Facts the producer declares | The check's `extensions["atlas.ui-state"]`: `route`, `fixture`, `cohort`, `area`, `kind` (the kind of UI state: `screen`, `overlay`, `loading`, `error`, `empty`… an open vocabulary that [critics](critics.md#reading-the-catalog) judge a state by), `flags` (a list), `covers` (the product surfaces the state shows). All optional. |
| Facts that describe without splitting | The check's `labels` (`shard`, `browser`) and `tags`. Labels never make a different slot. |
| Where it came from | The layer's `producer`, `sha`, `branch`, `runUrl`, `freshness`, `recordedAtMs`: shown with every capture, with the layer id and the backend that holds it. |

```json
{
  "producer": "device-farm", "kind": "ui-state", "environment": "mobile-web",
  "parameters": { "viewport": "390x844", "scheme": "dark" }, "recordedAtMs": 1760000000000,
  "checks": [{
    "id": "checkout/payment", "title": "Payment, card declined", "status": "passed",
    "labels": { "shard": "2/8" },
    "extensions": { "atlas.ui-state": { "route": "/checkout", "fixture": "declined-card", "cohort": "new-customer", "flags": ["new-nav"], "covers": ["payment-form"] } },
    "attachments": [{ "name": "payment.png", "role": "screenshot", "contentType": "image/png", "path": "payment.png" }]
  }]
}
```

`atlas report publish --checks file.json --store …` publishes that file, reading `payment.png` from beside it. Nothing in it
mentions how the page was driven. Because a state is a check, the gate counts it (a `failed` capture fails `atlas report status`),
`atlas report status` lists it, and a reader that does not know the catalog still shows a check with a screenshot. Evidence never
decides a result: a picture that cannot be read leaves the check, its status and its slot as they were.

## What is expected

What should exist is a **layer too**, of kind **`ui-plan`**: the same ids, the same profiles (environment and parameters), every
check `not-run`, published by a planner, by each shard for the states it was given, or both. A plan fills a slot of its own (the
kind is part of the slot), so a capture never erases it and it never hides a capture; and `not-run` is never a pass.

| A cell (one state in one profile) is | When |
| --- | --- |
| **Captured** | the winning capture passed |
| **Capture failed** | the winning capture failed (its `detail` says why, and a diagnostic picture may be attached) |
| **Capturing** | the winning result is `running` |
| **Skipped** | a producer recorded it as `not-run` |
| **Not captured yet** | a plan expects it and nothing has been recorded |

A captured cell that no plan names is shown as **not in the expected set**. **Without any plan, nothing is "not captured yet" and
nothing is "not in the expected set"**: what should exist is then unknown, and the catalog says so instead of guessing. "Not yet
captured" is therefore different from "never declared".

Coverage against an **inventory of the product's surfaces** is a plan entry with `"inventory": true` (the id is the surface;
nothing is captured for it). A state says which surfaces it shows in `covers`. The catalog lists every surface as *covered* (a
state that shows it is captured), *states cover it, none captured yet*, or *no state covers it*.

## Publishing from any collector

Any program that writes the layer format feeds the catalog: a shell script, a Go test, a Storybook crawler, a device farm.

```ts
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { uiPlanLayer, uiStateLayer } from '@crvouga/atlas/reports/ui-catalog-publish';

// The planner, once: what the product should have, in every profile.
await publishChecks(store, uiPlanLayer({
  producer: 'catalog-plan', recordedAtMs: Date.now(), environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'dark' },
  states: [{ id: 'checkout/payment', covers: ['payment-form'] }, { id: 'settings', inventory: true }]
}));

// Each collector or shard, with its own captures and no knowledge of the others.
await publishChecks(store, uiStateLayer({
  producer: 'web-capture', recordedAtMs: Date.now(), environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'dark' }, shard: '2/8',
  states: [{ id: 'checkout/payment', route: '/checkout', covers: ['payment-form'], screenshot: { data: png, width: 390, height: 844 } }]
}));
```

`uiStateLayer` and `uiPlanLayer` only build the input of `publishChecks`; they use no browser and no test framework. `store` can be
a directory, a bucket or the server (`httpStore`), exactly as for any layer.

**Playwright is one adapter and not a dependency.** `captureUiState(page, { id, ready })` from `@crvouga/atlas/playwright` waits
for a readiness check (bounded), photographs the page and returns the capture for `uiStateLayer`. A page that never became ready is
a `failed` capture that says why (with a picture of what it showed), never an exception that ends the run. Nothing that reads,
composes or shows the catalog imports a collection framework, and a test keeps it that way.

## The command line

`atlas ui-catalog` does the same without a script. Every subcommand prints a JSON document with `--format json`
([`atlas ui-catalog --help`](reference/cli.md) lists every flag), and exits `0` it worked, `1` the answer is no, `2` the command was wrong.

```sh
# The expected set under one profile. The file is {"states":[{"id":"checkout/payment","covers":["payment-form"]},{"id":"settings","inventory":true}]}.
atlas ui-catalog plan --states plan.json --producer catalog-plan --environment mobile-web --param viewport=390x844 --param scheme=dark

# The states one collector or shard captured. "screenshot" names a file beside captures.json.
atlas ui-catalog publish --captures captures.json --producer web-capture --environment mobile-web --param viewport=390x844 --param scheme=dark --shard 2/8

atlas ui-catalog status                          # exit 1 while anything failed, is missing, is still being captured or could not be read
atlas ui-catalog diff --from 3f9a2c1 --to 8b41d70 # two commits (the whole id, or at least 7 digits)
atlas ui-catalog export --out public/catalog.html # one file, no server
atlas ui-catalog collect --catalog atlas.catalog.ts --exec "node ./collect-batch.mjs" # one shard of a shared queue
```

`captures.json` is `{"states":[…]}` (or just the list); a state is `{"id","title"?,"status"?,"detail"?,"route"?,"fixture"?,"cohort"?,"area"?,
"flags"?,"covers"?,"labels"?,"tags"?,"durationMs"?,"screenshot"?}` with `screenshot` a file name or `{"path"|"uri","width"?,"height"?,"contentType"?}`.
A misspelled field is refused with its path, not ignored. A picture file is read from beside the file and from each `--attach-root`,
never from a hidden file or a link out. **A `passed` state whose picture cannot be read is published as `failed`, with the reason**: a
state without its picture is not shown as captured. `--recorded-at` defaults to the file's modification time, so publishing the same
file twice is the same layer.

`status` is the gate: it exits `1` unless the catalog holds a state and nothing needs attention (a failed capture, a state a plan expects
with nothing captured, a capture still in progress, a backend or layer that could not be read). Without a plan nothing is expected, so
nothing can be missing: it says so. A skipped cell is counted, not a problem. Schemas: `ui-catalog-publish-result`,
`ui-catalog-status`, `ui-catalog-diff-result`, `ui-catalog-export-result`.

## Sharding

A shard is **any publisher that does not know the others**: by case, by profile, by area or by machine; Atlas does not care which.
Each publishes its own layers (a `shard` label records which, and is shown with each capture). The guarantees are those of every
layer ([the contract](report-contract.md#guarantees)), which is what the tests prove for the catalog:

- The captures of N shards (N is 1 or more), combined, equal the catalog one unsharded run produces.
- Running a shard again replaces only the cells it produces (a newer `recordedAtMs` wins its slot); every other cell is untouched.
- A shard that never publishes leaves its cells **not captured yet** when a plan names them, and absent otherwise. They are never
  shown as captured, and the other shards' cells are unaffected.
- Atlas does not need the shard count. Completeness is the plan: a cell is expected because a plan says so.

That is all publishing needs. Deciding **what each shard collects next** is the [queue](#collecting-with-a-queue)'s job.

## Collecting with a queue

Publishing needs no coordination, but deciding what to collect does: a static split (`--shard 3/16`) leaves fast shards idle while a
slow one holds its slice, a shard that dies leaves a hole, the most urgent item can run last, and two runners that start at once collect
the same items. An Atlas server can instead hand out the work. The project declares its catalog once; any number of shards (local
processes, CI matrix jobs, a device lab) run the same command, claim the most urgent work, collect it, publish it and claim again until
nothing is left. They coordinate only through the server, and a shard can join or leave at any time.

### Define the catalog once

```ts
// atlas.catalog.ts in your project
import { defineCatalog } from '@crvouga/atlas/reports/ui-catalog-definition';

export default defineCatalog({
  name: 'web-app',
  matrix: {
    // Dimensions and their values are your data: Atlas has no built-in names (locale, tenant, role… work the same).
    dimensions: {
      device: { values: ['mobile', 'desktop'], profile: device => ({ environment: `${device}-web`, viewport: device === 'mobile' ? '390x844' : '1440x1000' }) },
      scheme: { values: ['light', 'dark'] },
      deployment: { values: async () => loadDeployments() }
    },
    exclude: [{ deployment: 'production', scheme: 'dark' }]
  },
  states: async () => loadStatesFromMyCollector(),          // ids and declared facts, as a plan entry
  group: item => `${item.state.id}|${item.profile.device}`,   // optional: what one capture takes together (here both schemes)
  inventory: async () => loadSurfaceInventory(),              // optional, as `inventory: true` plan entries
  maxAttempts: 3,                                             // optional: retry limit per collection
  staleAfterMs: 7 * 24 * 3_600_000                            // optional: recollect a picture older than a week
});
```

- **Every combination of values is a profile**, less the exclusions (a partial match). Every dimension value is a profile parameter, so
  each combination is its own slot, as for any layer. A dimension's `profile(value)` adds what that value contributes: `environment`
  (the client) and any other key as a parameter.
- **Ambiguity is refused, never resolved silently**: an exclusion or `--where` naming a dimension or value the matrix does not declare
  (the message lists the declared ones), two dimensions that both set `environment` for one profile, or set one parameter to different
  values. A profile that depends on two dimensions is a combined dimension, or an exclusion.
- **The definition is resolved once.** `values`, `states`, `inventory` and `group` run when it is published; the stored document
  records the result, so every shard sees the same matrix. Its version is the SHA-256 of its canonical JSON: the same definition is the
  same version wherever it is resolved, and publishing it twice stores it once.
- **Publishing it writes ordinary plan layers**: one `ui-plan` layer per profile, by the producer `ui-catalog:<name>`. Adding a value
  (`tablet`, `staging`) is a one-line change: every state in the new profiles is expected and not captured yet, and goes straight to the
  front of the queue; results in the other profiles are untouched.

### One command per shard

```sh
# Each shard runs the same command, once or on forty machines. --store (or ATLAS_STORE) is the server.
atlas ui-catalog collect --catalog atlas.catalog.ts --exec "node ./collect-batch.mjs"

# A runner that can only do some profiles narrows what it takes, with your own dimension names.
atlas ui-catalog collect --catalog atlas.catalog.ts --where deployment=development --where device=mobile --exec "…"

# Bounded, for a CI job with a timeout; --stale-before also recollects pictures older than the run.
atlas ui-catalog collect --catalog atlas.catalog.ts --max-units 200 --max-minutes 40 --stale-before "$RUN_STARTED_AT" --exec "…"
```

`collect` publishes the definition, claims a batch, runs `--exec` for it, publishes the captures, and claims again until nothing is left
for this shard (exit `0`, or `1` when anything it collected failed) or a bound is reached. `--exec` runs in a shell with `ATLAS_UI_BATCH`,
a JSON file with the claim and its `states` (each with its `item` key, its declared facts and its `profile`), and `ATLAS_UI_CAPTURES`,
where it writes `{"states":[…]}` in the shape `publish --captures` reads, each state naming its `item`, with pictures beside it. An item
it wrote nothing for is failed. On SIGINT or SIGTERM the claim is released, so its units go back to the queue at once. The result is the
`ui-catalog-collect-result` document.

A collector that stays in one process (one browser, one warm environment) uses the library instead:

```ts
import { collectCatalog } from '@crvouga/atlas/reports/ui-catalog-collect';
import { httpStore } from '@crvouga/atlas/reports/http-store';

await collectCatalog({
  store: httpStore({ url: process.env.ATLAS_SERVER_URL!, token: process.env.ATLAS_TOKEN }),
  catalog, shard: { id: `ci-${process.env.GITHUB_JOB}-${index}`, where: { deployment: 'development' } }, batchSize: 25,
  capture: async (unit, signal) => Promise.all(unit.items.map(async item => ({ item: item.key, ...(await captureUiState(page, { id: item.state.id, ready })) })))
});
```

`signal` aborts when the claim is lost, and what was captured for a lost claim is not published: a shard never publishes work it no
longer holds. A capture that throws records its items as failed, with the reason, and collection goes on. `captureUiState` stays an
optional adapter; nothing in the queue imports a collection framework.

### The order work is handed out in

| Tier | A unit is here when |
| --- | --- |
| **failed** | the newest result of any of its items failed (a readiness timeout is a failed capture) |
| **empty** | an item was never captured, was skipped, or the unit was claimed and let go of (expired or released) without a new result |
| **unknown** | an item has no readable result while a backend or a layer could not be read: it may have one, so it is never called empty |
| **stale** | every item is captured, and the oldest was recorded before the claim's `staleBeforeMs` (or is older than `staleAfterMs`); oldest first |
| **fresh** | captured and not due: never handed out |

A unit is as urgent as its most urgent item; ties break by unit key, so two servers given the same data give the same order. The order
is recomputed as results arrive, so an item that fails mid-run goes back near the head, until it has failed `maxAttempts` times in a row
within one **collection** (the `--collection` id, by default the `--run-id` or `ATLAS_RUN_ID`, else the definition version): then it is
no longer handed out in that collection, and shows as failed. Claiming reads an index of the newest result per item, built once per
report version; it never rebuilds the catalog document or lists layers per request. A test claims from 50 000 items with 100 concurrent
shards.

### Claims

A claim is a lease on a batch of units held by one shard: renewed by heartbeat (every third of `leaseSeconds`, default 120), closed unit
by unit as captures labelled with the claim id (`labels["atlas.claim"]`) arrive, released when the shard is done, and given back to the
queue when it expires. No unit is ever held by two live claims. A shard that publishes after its claim expired and another shard
re-claimed the unit leaves two layers, and the newest `recordedAtMs` wins the cell, as always. A claim request retried with the same
idempotency key returns the same claim, never a second batch.

Claims are kept by the server in its store (`server/ui-catalog/queue.json`, in S3 like the rest of its state) and written before a claim
is answered. After a restart they are restored with their leases; those that lapsed meanwhile expire and their units go back to the
queue, so no unit is lost and none is held forever. One node serves a project's queue. There is no mode without a server: a guessed
order that other shards cannot see would defeat the point, so `collect` against a directory or a bucket is refused.

| Endpoint | Role | What it does |
| --- | --- | --- |
| `PUT /api/ui-catalog/definitions/{version}` | publish | Store a definition and publish its plan layers |
| `GET /api/ui-catalog/definitions/{version}` | read | Read it back |
| `POST /api/ui-catalog/claims` | publish | `{ shard, definition, batchSize?, where?, leaseSeconds?, collection?, staleBeforeMs?, idempotencyKey? }` → a claim, or `204` when nothing is due |
| `POST /api/ui-catalog/claims/{id}/heartbeat` | publish | Renew the lease; `410` once it expired or ended |
| `DELETE /api/ui-catalog/claims/{id}` | publish | Release it; units without a result go back as empty |
| `GET /api/ui-catalog/queue` | read | Units by tier, live claims, shards (active, idle or lost), failures re-queued, units at the retry limit, unknown units and why, throughput and time to empty |

Under `/api/projects/{project}/…` each project has its own queue. `/catalog` shows the queue as a **Collection** panel once a definition
is published: what is left by tier, what is being collected now and by which shard, shards that are active, idle or lost, units that hit
the retry limit, and throughput.

`atlas ui-catalog status` stays the gate: the plan says what is expected, so a CI job that collected only part of the queue gates on the
whole catalog, not on its share.

## Streaming and loading

- **Streaming.** There is no second stream. A viewer holds the report over `/api/events` and reads what changed with
  `/api/reports/evidence/effective?since=<version>`; the catalog is computed from the report it holds, so a capture appears when
  its layer arrives, with no reload and no file rebuilt. Events carry metadata only; the picture is fetched when a card is on screen.
- **Reconnecting.** A viewer that was offline or whose stream dropped reads the delta since the version it holds (or the whole report
  when the server no longer remembers it). Cells are keyed by state and profile, so nothing is missing and nothing is duplicated.
- **No stream.** A viewer without the stream (or a static export) polls, as the rest of the viewer does, and shows everything that exists.
- **Slow and failing backends.** Each backend is listed and read on its own, so a slow one never holds back the others: their
  captures are shown, and the slow backend's appear when it answers. A backend that fails, or a layer that cannot be read, is named
  on the page and in the document (`sources`); a capture that depended on it is not shown as captured.
- **Images.** A picture is a file in the layer, addressed by content (`/layers/<layer>/blobs/attachments/<sha256>`), loaded lazily
  for the cards on screen, and served under the same untrusted-bytes rules as every attachment. A picture given as a `uri` is
  followed only if it is `http` or `https`. A producer may leave the bytes out (`omitted`), which is told apart from never taken.

## Exploring it

The viewer's **UI catalog** (`/catalog`, in the menu beside the spec types once the report holds a state or a plan) shows a card per
state with its picture and a coverage badge per profile, and filters by words, coverage, profile, area, route, cohort, feature flag,
surface and producer. The address holds the filters and the open state, so a link reproduces the view. Opening a state shows its
profiles side by side with the declared facts, the failure reason, and for each picture the layer, backend, producer, shard, commit
and time. A persistent bottom bar holds the previous/next arrows and numbered pagination. They move through all states matching the current filters, including states
beyond the cards currently shown. Left/Right arrow keys navigate while the detail is focused; Escape closes it and returns
focus to its opener. Navigation stops at either end, announces the current item and total, and keeps the filters in the address.
A linked state outside the filters still opens, with an explanation instead of an incorrect position. *Download the manifest* saves the filtered catalog as JSON.

```sh
curl "$ATLAS_SERVER_URL/api/reports/ui-catalog?coverage=failed,missing&profile=…"   # JSON; add format=markdown for text
```

A separate process that reviews the pictures (a [critic](critics.md#reading-the-catalog)) reads the same catalog as a flat list at
`GET /api/reports/ui-catalog/entries`: cursor-paged, `since` a report version, with the hash of each stored picture.

`GET /api/reports/ui-catalog` answers the same document the viewer computes (`uiCatalog` from
`@crvouga/atlas/reports/ui-catalog`), filtered by `q`, `coverage`, `profile`, `area`, `route`, `cohort`, `flag`, `surface` and
`producer`, paged with `limit` and `offset`, with an ETag. Its picture `path` is relative to `/api/reports`.

## Comparing two commits or two profiles

The viewer's **Compare** button on `/catalog` (`?compare=commit&from=<commit>&to=<commit>`, or `?compare=profile&from=<profile>&to=<profile>`,
so a link reproduces it) and `atlas ui-catalog diff` set one side against the other. Every pair is one state in one profile.

| A pair is | When |
| --- | --- |
| **Unchanged** | the same coverage and, when captured, the same stored picture |
| **Picture changed** | captured on both sides, and the picture's bytes (SHA-256) differ. This is not a measure of how many pixels differ |
| **Coverage changed** | it stands differently (captured against failed, failed against not captured yet…). A capture that did not pass is never compared by picture |
| **Cannot tell** | captured on both sides, but a picture has no content hash (it is given only by address, or was left out) |
| **Only after** / **Only before** | one side has no such cell. It may be new, renamed, or the other side's shard may not have run: it is not called a regression |

- **Two commits** compares the layers recorded at each commit. A layer replaces the older one of its slot, so the report keeps only the
  newest capture of every state; the comparison therefore reads the layers themselves (the viewer asks for the layer list and the rows of
  the two commits only; the command line reads the stores). Layers recorded from a checkout with uncommitted changes are not a commit's
  own result and are left out. A commit is the whole id or at least 7 digits that name exactly one commit; anything else is an error
  that lists the commits found, never a guess.
- **Two profiles** sets each state's cell in one profile beside its cell in another (desktop against mobile, light against dark) in
  the report the viewer holds.
- A layer or backend that could not be read is named, and what it held is unknown, never "unchanged": `diff` exits `1` for it.
  `--fail-on-change` also exits `1` for any difference, for a gate that must stay the same.
- The filters (words, area, route, cohort, flag, surface, producer) narrow a comparison; coverage does not, because coverage is what is
  compared.

## A single file that needs no server

`atlas ui-catalog export --out catalog.html` writes the catalog as **one HTML file**: the pictures embedded as `data:` addresses, the
manifest embedded as JSON (`<script type="application/json" id="ui-catalog">`), a search box and a coverage filter. Open it from a disk,
attach it to a ticket or serve it as a file. It is the catalog at the moment it was made, and says so; it does not stream (for that,
serve the store with `atlas serve` or build the site with `atlas client build`, which shows the same catalog).

- **Size.** Hosting platforms cap the size of one file. `--max-mb` (default 32) limits the embedded pictures; pictures past it are listed
  in the page as left out, with the reason, in the order the page shows them, and the manifest stays complete. `--images none` embeds none.
  `--manifest catalog.json` also writes the manifest as its own file.
- **Safe to open.** The page is generated from data written by test runs, and treats it so: text is escaped, only PNG, JPEG, GIF and WebP
  bytes (by their first bytes, never SVG, never a layer's claimed type) are embedded, a picture given by address is linked only if it is
  `http` or `https`, and a Content-Security-Policy forbids every network request. Without scripts every state is simply shown.
- It is a generated document, not the viewer: it carries its own small inline style and script because it must work with no build
  and no server, which [the viewer's UI conventions](ui.md) forbid inside the viewer.

## Decisions

The questions the original proposal left open, and how they are answered here. Each is the simplest answer that stays inside the
[stable contracts](report-contract.md#versioning-and-stability): optional fields only, no change to a slot or a winner.

| Question | Decision |
| --- | --- |
| Layer and event schema | An existing check in a `ui-state` part, a `screenshot` attachment, facts under the `atlas.ui-state` extension. No new part type, no new schema version. The report row gained one optional field, `state`, only for `ui-state` and `ui-plan` rows. |
| Identity and slot | The check id is the state; the slot is the usual (producer, kind, spec, id, environment, parameters). Profile dimensions are `parameters` because they must split the slot; labels never do. |
| Expected versus captured | A `ui-plan` layer. `ui-plan` is a diagnostic kind (like `performance`): it qualifies a check and is not counted as one when the check has any other result. |
| Coverage against an inventory | `inventory: true` plan entries plus each state's `covers`. |
| Carrying images | By content in the layer (`bundleKey`) or by `uri`; loaded lazily; the existing size limits of an upload apply. |
| The event stream | No new stream or events: the existing `report` event and `?since=` deltas. |
| Sharding | No shard concept in the format; a shard is any publisher. A `shard` label is provenance. Completeness comes from the plan, so Atlas needs no shard count. |
| What moves | Reading, composing, the viewer, the document and the API, the publish builders, a Playwright capture adapter. Staying with a product: its state declarations, its inventory, its fixtures and its runner. |
| Where it lives | `@crvouga/atlas/reports/ui-catalog` (model), `…/ui-catalog-publish` (builders), `…/ui-state` (convention), `…/ui-catalog-definition`, `…/ui-catalog-queue` and `…/ui-catalog-collect` (the queue); the viewer's `/catalog`; the server's `/api/reports/ui-catalog` and `/api/ui-catalog/…`; `@crvouga/atlas/playwright`'s `captureUiState`. |
| Exploration capabilities | Search, filters, profile comparison, coverage and surface coverage, failure diagnostics, deep links, manifest export. |
| Static export | Two ways, neither needs a server. The catalog is computed from the layers a viewer holds, so the static site (`atlas client build`) shows it, without streaming. `atlas ui-catalog export` writes it as one self-contained HTML file with a size budget. |
| Comparing | Two commits (from the layers recorded at each, because the report keeps only the newest) or two profiles; pictures by content hash, never by a pixel measure; one-sided states are not regressions. |
| Command line | `atlas ui-catalog plan`, `publish`, `status`, `diff`, `export` and `collect`, each with `--format json`. The collector `collect` runs is the product's. |
| Who collects what next | A claimable priority queue on the server ([Collecting with a queue](#collecting-with-a-queue)): a definition with a profile matrix the project declares, claims handed out failed, empty, unknown, then stale first, leases renewed by heartbeat. |
| Where claims live, and concurrency | In the server process, under one lock, and in one JSON document in its store, written before a claim is answered. Restored after a restart; lapsed claims expire. One node serves a project's queue. |
| Lease and heartbeat | Per claim, chosen by the shard (`leaseSeconds`, default 120, 10 to 3600), renewed every third of it by `collect`. |
| Batch size | Chosen by the shard (`--batch-size`, default 25, at most 500). |
| Grouping | Declared by the definition (`group`, a function resolved into the stored document). A group may span any dimension; `where` takes a unit only when every item matches. |
| What makes a result stale | Its age only: `staleBeforeMs` on a claim (`--stale-before`), or the definition's `staleAfterMs`. Without either, nothing captured is due, so a queue can be empty. |
| Retry limits | `maxAttempts` (default 3) failures in a row within a collection, counted when captures labelled with a claim arrive; a pass resets it. A collection is the `--collection` id, by default the run id, else the definition version. No backoff. |
| Fairness | None beyond `where`: a shard takes the batch it asks for. |
| A mode without a server | None: `collect` needs a server. |
| A newer definition mid-collection | Claims name their definition and stay valid until they end; new claims use whichever definition they name. Units with the same key are the same unit across versions, so no unit is held twice. |
| Run identity | The queue is continuous, with no run boundary. `atlas ui-catalog status` gates the whole catalog. |
| Dimensions and the slot | Every dimension value is a parameter, so it splits the slot; `environment` is set only through a `profile` function. Colliding parameters are refused; a profile that depends on two dimensions is a combined dimension. |
| Changing a dimension or removing a state | A new definition version. New profiles are expected and empty; results in old profiles, and of removed states, stay readable as they were and are never handed out. The plan layers of the old version are not withdrawn (a layer cannot be), so the catalog keeps showing what it showed. |

## What stays in your project, and what Atlas does not do

A project that had its own catalog moves each role it had to Atlas, and keeps only what is specific to its product. The eight roles, and
where each now is:

| # | Role | In Atlas | Stays in your project |
| --- | --- | --- | --- |
| 1 | Declaration of the states to capture, and the plan of what is expected | The plan format (`ui-plan` layers), `uiPlanLayer`, `atlas ui-catalog plan` | **The list itself**: which states and profiles your product has |
| 2 | A capture helper, with readiness checks and diagnostics | An optional adapter, `captureUiState` in `@crvouga/atlas/playwright`; any other tool writes the same layer | **The readiness condition of each screen**, and the helper for a framework Atlas has no adapter for |
| 3 | An evidence store: one atomic record per capture, images by content | Layers and the stores that hold them (`publishChecks`, a directory, S3, a server) | Nothing |
| 4 | An inventory of the product's surfaces, and reconciliation against it | Reconciliation: `inventory` plan entries and `covers`, the surface coverage table | **The inventory**: the list of surfaces your product has |
| 5 | A manifest and report builder | `uiCatalog`, the JSON manifest, Markdown, the single HTML file | Nothing |
| 6 | A viewer: as a single file, as a site, and live | `atlas ui-catalog export`, `atlas client build`, and `/catalog` on `atlas serve` | Nothing |
| 7 | A command line (list, run, report, publish, watch) | `atlas ui-catalog plan\|publish\|status\|diff\|export\|collect`, the queue that hands out work; watching is the live `/catalog` and `atlas report stream` | **Run**: the collector that drives your product to each state |
| 8 | A publish step to a hosting platform | Not in Atlas, see below | **The deploy step** of your platform |

What stays is, in one list: the states and profiles to capture, the inventory of surfaces, the fixtures and test data, the runner that
drives the product to each state, the readiness condition of each screen, and the deploy step of your hosting platform. Nothing else is
specific to your product, so a project that installs a release holds none of the reporting and exploring code, only that.

**A hosting publish step is not a command, on purpose.** Publishing to a platform needs that platform's credentials and API, which Atlas
neither holds nor should. Hand the platform what Atlas produces: the `export` file (or a folder of them) for any host that serves
files, the output of `atlas client build` for a static site, or run `atlas serve` for a live one. Keep the credentials in the CI of the
project, where they already are.

**Not built:** reconciliation against an external inventory beyond `inventory` entries and `covers`; a comparison of pictures by pixels
(only by content); a comparison fetched from the server (the viewer and the command line read the layers themselves).
