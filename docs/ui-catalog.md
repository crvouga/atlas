# The UI catalog

A browsable inventory of a product's user interface: each **state** (a screen, or one state of a screen) captured once per
**profile** (a viewport, a color scheme, a device), with the facts needed to find and trust it, and what should exist but has not
been captured yet. Any program that can write a layer can feed it, and the catalog fills in as results stream in, so a run of
thousands of captures can be watched while it happens and split across as many machines as needed.

Nothing about it is new to the report contract. A state is an ordinary check with a screenshot, the expected set is an ordinary
layer, and the stream is the one every viewer already holds. This page is the convention that makes those usable as a catalog, the
decisions behind it, and what is not built yet.

- [How a state is written](#how-a-state-is-written)
- [What is expected](#what-is-expected)
- [Publishing from any collector](#publishing-from-any-collector)
- [Sharding](#sharding)
- [Streaming and loading](#streaming-and-loading)
- [Exploring it](#exploring-it)
- [Decisions](#decisions)
- [What stays in your project, and what is not built yet](#what-stays-in-your-project-and-what-is-not-built-yet)

## How a state is written

A state is one **check** in a layer whose part has `kind` **`ui-state`**.

| Part of the idea | Where it goes |
| --- | --- |
| The state's identity | The check `id`. Make it stable (`checkout/payment`, `home?cohort=new`): a new capture replaces an old one only if the id is the same. |
| How the capture went | `status`: `passed` is **captured**, `failed` is attempted and failed (say why in `detail`), `running` is being taken, `not-run` is skipped. |
| The picture | An attachment with `role: "screenshot"` (else the first image), stored in the layer by content or given as an `https` `uri`. `width` and `height` help the viewer lay it out. |
| The profile | The layer's `environment` (`desktop-web`, `mobile-web`, `ios`, `android`) and `parameters` (`{ "viewport": "390x844", "scheme": "dark" }`). Parameters split a slot, so the same state at another viewport is **another result, side by side**, never a replacement. |
| Facts the producer declares | The check's `extensions["atlas.ui-state"]`: `route`, `fixture`, `cohort`, `area`, `flags` (a list), `covers` (the product surfaces the state shows). All optional. |
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

## Sharding

A shard is **any publisher that does not know the others**: by case, by profile, by area or by machine; Atlas does not care which.
Each publishes its own layers (a `shard` label records which, and is shown with each capture). The guarantees are those of every
layer ([the contract](report-contract.md#guarantees)), which is what the tests prove for the catalog:

- The captures of N shards (N is 1 or more), combined, equal the catalog one unsharded run produces.
- Running a shard again replaces only the cells it produces (a newer `recordedAtMs` wins its slot); every other cell is untouched.
- A shard that never publishes leaves its cells **not captured yet** when a plan names them, and absent otherwise. They are never
  shown as captured, and the other shards' cells are unaffected.
- Atlas does not need the shard count. Completeness is the plan: a cell is expected because a plan says so.

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
and time. *Download the manifest* saves the filtered catalog as JSON.

```sh
curl "$ATLAS_SERVER_URL/api/reports/ui-catalog?coverage=failed,missing&profile=…"   # JSON; add format=markdown for text
```

`GET /api/reports/ui-catalog` answers the same document the viewer computes (`uiCatalog` from
`@crvouga/atlas/reports/ui-catalog`), filtered by `q`, `coverage`, `profile`, `area`, `route`, `cohort`, `flag`, `surface` and
`producer`, paged with `limit` and `offset`, with an ETag. Its picture `path` is relative to `/api/reports`.

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
| Where it lives | `@crvouga/atlas/reports/ui-catalog` (model), `…/ui-catalog-publish` (builders), `…/ui-state` (convention); the viewer's `/catalog`; the server's `/api/reports/ui-catalog`; `@crvouga/atlas/playwright`'s `captureUiState`. |
| Exploration capabilities | Search, filters, profile comparison, coverage and surface coverage, failure diagnostics, deep links, manifest export. |
| Static export | The catalog is computed from the layers a viewer holds, so a static export (`atlas client build`) shows it; it just does not stream. |

## What stays in your project, and what is not built yet

**Stays in a project** (it is specific to the product): the list of states and profiles to capture, the inventory of surfaces,
fixtures and test data, the runner that drives the product to each state, and the readiness conditions of each screen.

**Not built yet:** a command line to list and publish a catalog without a script (use `atlas report publish --checks` today), a
dedicated static single-file export, diff views that compare two commits of a state, and a hosting-platform publish step beyond
`atlas serve`. The first slice makes the catalog explorable, streaming, shardable and independent of how it was collected.
