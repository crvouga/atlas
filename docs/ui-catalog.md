# The UI catalog

A browsable inventory of a product's user interface: each **state** (a screen, or one state of a screen) captured once per
**profile** (a viewport, a color scheme, a device), with the facts needed to find and trust it, and what should exist but has not
been captured yet. Any program that can write a layer can feed it, and the catalog fills in as results stream in, so a run of
thousands of captures can be watched while it happens and split across as many machines as needed.

Nothing about it is new to the report contract. A state is an ordinary check with a screenshot, the expected set is an ordinary
layer, and the stream is the one every viewer already holds. This page is the convention that makes those usable as a catalog, the
decisions behind it, the command line, and what stays in your project.

**Agents:** the order of work and the mistakes to avoid are in [Capturing and reading the UI catalog](agents.md#capturing-and-reading-the-ui-catalog). This page is the reference.

- [How a state is written](#how-a-state-is-written)
- [What is expected](#what-is-expected)
- [Publishing from any collector](#publishing-from-any-collector)
- [The command line](#the-command-line)
- [Sharding](#sharding)
- [Streaming and loading](#streaming-and-loading)
- [Exploring it](#exploring-it)
- [Comparing two commits or two profiles](#comparing-two-commits-or-two-profiles)
- [A single file that needs no server](#a-single-file-that-needs-no-server)
- [Stability: what may change and what may not](#stability-what-may-change-and-what-may-not)
- [Performance and scale](#performance-and-scale)
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
| Facts of your own | The same extension's `attributes`: a map of names to text (`{ "locale": "de-DE", "brand": "acme" }`), at most 32 of them per state. The catalog carries them, offers each `name=value` as a filter and shows them with the state. A new dimension needs no new Atlas, no new field and no new version. They never split a slot (a fact that must, such as another locale rendered as another picture, is a profile `parameter`) and never decide a result |
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
```

`captures.json` is `{"states":[…]}` (or just the list); a state is `{"id","title"?,"status"?,"detail"?,"route"?,"fixture"?,"cohort"?,"area"?,
"flags"?,"covers"?,"attributes"?,"labels"?,"tags"?,"durationMs"?,"screenshot"?}` with `screenshot` a file name or `{"path"|"uri","width"?,"height"?,"contentType"?}`.
A misspelled field is refused with its path, not ignored (a typo in a hand-written file is worth an error); put your own data in `attributes`, which takes any name. A picture file is read from beside the file and from each `--attach-root`,
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
surface, producer and the attributes your collectors declare. The address holds the filters and the open state, so a link reproduces the view. Opening a state shows its
profiles side by side with the declared facts, the failure reason, and for each picture the layer, backend, producer, shard, commit
and time. *Download the manifest* saves the filtered catalog as JSON.

Use **Search catalog** for free words, facets and sorting. Press Enter or Tab to turn words into chips;
each term must match, so `appointment` plus `error` finds appointment-related error screens. Search handles
close spellings, word forms and common related wording such as booking/appointment, unavailable/error and
preferences/settings. It searches recorded names and facts, including the declared UI state kind.
An error screen can have a successful capture: `kind:error` selects the product's error states, while
`coverage:failed` selects captures that failed.

Suggestions offer the catalog's own values, including profiles, routes, attributes and UI kinds. Type
`area:`, `kind:`, `profile:` or another facet name to explore its values; quote values with spaces
(`area:"Patient visits"`). Type `sort:` to choose best matches, newest/oldest captures, title order or
states needing attention. Arrow keys choose a suggestion, Enter/Tab adds it, Escape dismisses suggestions,
and Backspace in an empty field reopens the last chip for editing. Every chip also has a named,
keyboard-focusable remove button. The list previews drafts as you type, and committed chips are restored
from the address, including when returning from an open state or comparison. Values of the same facet are
alternatives; different facets and free terms combine with AND.

Rich viewer expressions use the optional `find` URL parameter; existing `q` and facet links still work.
The HTTP API and CLI continue to use their documented literal word and exact facet filters.

```sh
curl "$ATLAS_SERVER_URL/api/reports/ui-catalog?coverage=failed,missing&profile=…"   # JSON; add format=markdown for text
```

A separate process that reviews the pictures (a [critic](critics.md#reading-the-catalog)) reads the same catalog as a flat list at
`GET /api/reports/ui-catalog/entries`: cursor-paged, `since` a report version, with the hash of each stored picture.

`GET /api/reports/ui-catalog` answers the same document the viewer computes (`uiCatalog` from
`@crvouga/atlas/reports/ui-catalog`), filtered by `q`, `coverage`, `profile`, `area`, `route`, `cohort`, `flag`, `surface`, `producer` and
`attribute` (`name=value`), paged with `limit` and `offset`, with an ETag. Its picture `path` is relative to `/api/reports`.

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
- The filters (words, area, route, cohort, flag, surface, producer, attribute) narrow a comparison; coverage does not, because coverage is what is
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

## Stability: what may change and what may not

The UI catalog is built on the [report contract](report-contract.md#versioning-and-stability) and the
[server's API rules](server.md), and adds nothing that could break either. Four things are contracts, each with the same promise:
within version 1 **only optional things are added**, never removed, renamed or given another meaning.

| Contract | What is fixed | Where it grows |
| --- | --- | --- |
| **The convention in a layer** (`ui-state` and `ui-plan` parts, the `screenshot` attachment, the `atlas.ui-state` extension) | The part kinds, that a check id is the state, that `passed` is captured, that `environment` and `parameters` are the profile, that a plan is `not-run`. | New facts: put them in `attributes`, or add an optional key to the extension. A reader keeps the keys it knows and ignores the rest, and the layer keeps all of them. A reader never rejects a layer for what it does not understand: it leaves it out, and a state it cannot read is never captured. |
| **The catalog document** (`uiCatalog`, `GET /api/reports/ui-catalog`, the manifest) | The names and meaning of every field, the order of states and cells, and that only `captured` is a capture. | New optional fields, and new values of `coverage`, `expected` and a surface's `status`. |
| **The query** (`q`, `coverage`, `profile`, `area`, `route`, `cohort`, `flag`, `surface`, `producer`, `attribute`, `limit`, `offset`, `format`) | What each parameter selects, AND across parameters and OR within one. | New optional parameters. One the server does not know is ignored and the whole catalog is answered, as for every Atlas API. |
| **The command line** (`atlas ui-catalog …`, `--format json`) | Flags, exit codes and the result documents. | New optional flags and result fields. |

How to write a reader that never needs to change:

- **Ignore what you do not know.** Unknown fields of a document, unknown keys of the extension and unknown parameters are not errors.
  The published JSON Schemas are open objects for this reason (`additionalProperties` is not `false`).
- **Treat an unknown word as the cautious one.** `coverage` today is `captured`, `failed`, `capturing`, `skipped` or `missing`; a later
  version may add another (`quarantined`, `stale`…). A reader shows it as it is and counts it as *not captured*. `expected` that is not
  `declared` or `undeclared` is `unknown`; a surface `status` that is not `covered` is not covered. The schema types these as text for that reason.
- **Do not depend on absence meaning "none" unless the field says so.** `attributes` and `facets.attributes` are absent from a server that predates
  them; absent means none.
- **Never read evidence as a result.** A picture, an attribute or a fact never changes a status, a slot or a winner.

The promise is tested, not only written: `packages/reports/tests/fixtures/ui-catalog-v1.json` is the first version of the document,
frozen, and `ui-catalog-contract.test.ts` fails if the code stops writing any of it or changes any value. It also feeds every reader a
document from a "later version" (a new field on every object, new words for coverage) and a layer with keys nobody has heard of. Do not
edit the fixture to make a test pass; fix the code. A change a reader would have to be rewritten for is a new `schemaVersion`, a `!`
commit and a migration note, exactly as for the report contract.

Adding to the catalog, from least to most work:

1. **A new dimension of your product** (locale, brand, theme, build channel): write it as an `attribute`. Nothing in Atlas changes.
2. **A new profile choice** (another viewport, another scheme): it is a layer `parameter`, so it makes another result side by side.
3. **A new kind of state** (`toast`, `drawer`): `kind` is an open vocabulary. Write it.
4. **A new fact Atlas should know about** (searchable, a facet): add an optional key to `UiStateFacts`, read it in `uiStateFacts`, carry it
   in `UiCatalogState`, and add it to the schema as optional. Then run `bun run docs`.

## Performance and scale

The catalog is meant for runs of thousands of captures that are watched while they happen.

- **One pass, linear.** `uiCatalog` makes one pass over the winning results; a layer's profile, origin and file address are made once per
  layer and not once per cell. Filtering searches text built once per state. A test builds catalogs of 250 and 2,000 states and fails if the
  cost grows faster than the size (`ui-catalog-performance.test.ts`).
- **About 20,000 cells** (5,000 states in 4 profiles, captured by 40 shards) are combined in tens of milliseconds, filtered in under 10, and the
  first 200 states are serialized in a couple of milliseconds. Measure your own with
  `bun packages/server/bench/ui-catalog-bench.ts <states> <shards>`; run it before and after a change to `ui-catalog.ts`.
- **The server builds once per report version** and narrows per question; the written answer of a version and a query is kept and
  answered with an ETag (`304`) to a client that already has it. Page with `limit` (default 200): a page is a few kilobytes per state, and
  the whole catalog is never sent to look at one screen.
- **The viewer draws what is on screen.** It shows 48 cards and the first 100 surfaces and asks for more, loads each picture only when its
  card scrolls into view (`loading="lazy"`, decoded off the main thread, from a content address), offers at most
  100 options in a filter at a time, and rebuilds the catalog for newly arrived layers at low priority, so typing and scrolling are not held up
  while a run streams in.
- **Pictures are never in the stream.** An event carries metadata; the bytes are fetched on demand, by content.
- **Keep it so.** Before and after changing the index, the upload path or the viewer's data loading, run the server benchmark of
  [the server guide](server.md); for the catalog's own code, the benchmark above. Speed never buys a weaker guarantee: the same layers in any
  order, split any way, still give the same catalog.

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
| Static export | Two ways, neither needs a server. The catalog is computed from the layers a viewer holds, so the static site (`atlas client build`) shows it, without streaming. `atlas ui-catalog export` writes it as one self-contained HTML file with a size budget. |
| Comparing | Two commits (from the layers recorded at each, because the report keeps only the newest) or two profiles; pictures by content hash, never by a pixel measure; one-sided states are not regressions. |
| Growing without a break | `attributes` for new dimensions; open objects and open words in every reader; a frozen version 1 document that a test holds the code to. See [Stability](#stability-what-may-change-and-what-may-not). |
| Command line | `atlas ui-catalog plan`, `publish`, `status`, `diff` and `export`, each with `--format json`. Running a collector is not one: that is the product's. |

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
| 7 | A command line (list, run, report, publish, watch) | `atlas ui-catalog plan\|publish\|status\|diff\|export`; watching is the live `/catalog` and `atlas report stream` | **Run**: the runner that drives your product to each state |
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
