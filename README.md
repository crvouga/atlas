# Atlas

**Specs of any kind, reported as layered evidence.** Atlas lays the results of every suite that
checks your specs (Gherkin, Quint, DMN, Alloy, OpenSLO, unit and end-to-end tests, linters,
statecharts) over the specs themselves, across machines, branches, environments and storage
backends, and tells you in one command whether the product still does what it was specified to do.

- **Any spec, any runner.** Anything that ends in "this check passed or failed" publishes a *layer*:
  from a JUnit or CTRF file, a ten-line script, or code. No runner and no notation is privileged.
- **Layered, never partitioned.** A report is computed from layers, not stored as "the run". Partial
  runs on separate nodes, branches and devices are how a report is built, and they compose without
  coordinating: the same layers give the same report in any order, split any way.
- **Open evidence.** A result carries whatever your framework produces: screenshots, videos, traces, logs, DOM
  snapshots, timelines, retries, annotations, your own structured data. Any media type, nothing registered, and
  new kinds never break older readers ([extending](docs/extending.md)). Specs stay opinionated (statecharts,
  Gherkin, Quint, DMN, Alloy, OpenSLO); evidence stays open.
- **Open standards, stable schemas.** JUnit XML and CTRF in, JSON Schema 2020-12 contracts, a
  versioned layer format with a golden fixture, and an `ObjectStore` interface any bucket fits.
- **One node, one bucket.** Developers' worktrees and every CI job publish to S3 (or R2, MinIO, a
  folder). One `atlas serve` shows the whole project to developers and the business, from the
  bucket, with no checkout and no state of its own ([deploying](docs/deploying.md)).
- **Fast and fail-closed.** Publishing is two small writes. A thousand layers of a hundred checks
  combine in about a second. An unreadable layer, a downed backend or a check still running is never
  counted as a pass.
- **Executable statecharts too.** Atlas can also run a product's flows as statecharts against the
  real app, and publishes those runs as layers like any other ([below](#executable-statecharts)).

```
 any suite   ──▶ layer ─┐                              atlas report status   exit 1 unless it passes
 any node    ──▶ layer ─┼─▶ backends ─▶ combine ─▶     the visualizer        browse it beside the specs
 any branch  ──▶ layer ─┘   (directories, buckets, …)   combineBackends()     your own code
```

> [!IMPORTANT]
> **Dogfooding phase:** Atlas is developed by using it in real projects. Those projects install the
> published package from npm and report bugs and missing features as GitHub issues; they do not
> change this repository. If you are integrating Atlas, or are an agent working in a project that
> uses it, read **[integrating Atlas](docs/integrating.md)**, then
> [using Atlas from another project](docs/dogfooding.md) and [reporting issues](docs/reporting-issues.md).
> Releases are automatic: see [releasing](https://github.com/crvouga/atlas/blob/main/docs/releasing.md).

## Integrate in five minutes

```sh
bun add -d @crvouga/atlas            # or npm install -D / pnpm add -D; runs on Bun and Node 22.18+

# 1. Each suite publishes a layer of what it ran: a JUnit or CTRF file, an Atlas run, or a checks file.
bunx atlas report publish --store atlas-reports --producer web-e2e --junit out.xml --specs ./specs --environment desktop-web

# 2. Any number of nodes, branches and machines do the same into their own stores. Copying stores
#    together is the aggregate: layers are immutable and named by their content.
bunx atlas report merge --store node-1 --store node-2 --into all

# 3. The gate: exit 1 on a failed check, a check still running, an unreadable layer, a backend that
#    is down, or an environment with no results.
bunx atlas report status --store all --specs ./specs --require-environments desktop-web,ios
```

| Read | When |
| --- | --- |
| **[Integrating Atlas](docs/integrating.md)** | Start here. Step by step, with the command and expected output for each step, a CI workflow for sharded nodes, and troubleshooting. |
| **[Running Atlas for a project](docs/deploying.md)** | Production: an S3 bucket and its policies, publishing from CI and from laptops, the node (Docker, Kubernetes, auth), filters, operating it and performance. |
| [The report contract](docs/report-contract.md) | The exact rules: the layer document, how layers compose, guarantees, backends, versioning, failure behaviour. |
| **[Evidence: attachments, timelines and everything else](docs/extending.md)** | What a result can carry, the rules that keep the format compatible forever, and how to attach anything from any framework. |
| [Report backends and live snapshots](docs/report-backends.md) | Connecting directories, HTTP files and APIs, streaming, and writing another transport. |
| [`@crvouga/atlas/reports`](packages/reports/README.md) | The programmatic API: `publishChecks`, `combineBackends`, `reportStatus`, `directoryStore`, `reportsHost`. |
| [`@crvouga/atlas/schema`](packages/schema/README.md) | The JSON Schemas and Zod schemas of every document. |

## One package

Atlas is a single npm package. Each part is its own import path, so a bundler keeps only what you
import. It runs on Bun and on Node 22.18 or later, with any package manager:

```sh
bun add -d @crvouga/atlas
```

| Import | What it is |
| --- | --- |
| [`@crvouga/atlas/reports/<module>`](packages/reports) | Evidence for any spec: publish layers (`publish-checks`, `ingest`), store them (`s3-store`, `directory-store`, any `object-store`), combine and gate them (`compose`, `report-status`), copy them (`copy-store`), serve them (`@crvouga/atlas/server`, `host`). |
| [`@crvouga/atlas/schema`](packages/schema) | The contract: Zod schemas and JSON Schemas for layers, check files, report status, specs, journeys, manifests, timelines and the runs index. |
| [`@crvouga/atlas`](packages/core) | Spec loading (SCXML and XState), composition, lint, planning, the runner, multi-client runs (`combineDrivers`), `httpDriver` and `functionDriver`, CloudEvents, privacy, config and the `atlas` CLI. `@crvouga/atlas/spec` is a browser-safe subset; `@crvouga/atlas/signals` holds the driver-neutral signals. |
| [`@crvouga/atlas/playwright`](packages/playwright) | Playwright driver: signal-based screen recognisers, paced taps and typing with a touch overlay, device-resolution screenshots and H.264 clips. |
| [`@crvouga/atlas/bun`](packages/bun) | Bun WebView driver: Bun's built-in headless browser (the system WebKit on macOS, Chrome elsewhere), nothing to download. |
| [`@crvouga/atlas/webdriver`](packages/webdriver) | W3C WebDriver driver with no dependencies: Safari, Chrome, Firefox and Edge, and native iOS and Android apps through Appium. |
| [`@crvouga/atlas/detox`](packages/detox) | Detox driver for iOS and Android apps, inside a Detox test run. |
| [`@crvouga/atlas/vitest`](packages/vitest) | Run a config as a test suite in Vitest, `bun test` or any Jest-style runner, one test per planned path. |
| [`atlas-visualizer`](packages/visualizer) (command) | Browse specs, charts and layered reports: every spec with its result per environment, every state with its screenshots, every transition with its clip. |

Two commands install with it: `atlas` (`report`, `lint`, `plan`, `run`, `merge`, `export`) and
`atlas-visualizer`.

## Reports for any spec

Atlas separates *what the product should do* (the specs) from *evidence of what it did* (layers).
Evidence is published by whatever checks the spec, and read back as one report.

**A layer** is one focused recording: the checks one producer ran, on one environment, from one
commit and branch, at one time. It is immutable and addressed by its content. Publish one from:

| You have | Publish with |
| --- | --- |
| JUnit XML from Cucumber, Jest, Vitest, Bun, pytest, `go test`, Playwright, … | `atlas report publish --junit out.xml` |
| [CTRF](https://ctrf.io) JSON | `atlas report publish --ctrf ctrf.json` |
| An Atlas statechart run | `atlas report publish --manifest atlas-runs/<run>/manifest.json` |
| A script, a model checker, an SLO evaluation, a linter | `atlas report publish --checks checks.json`, or `publishChecks(store, …)` |

**Layers compose by one rule.** A *slot* is `(producer, kind, spec, check id, environment,
parameters)`. Each slot shows the newest completed result of any layer that filled it. Branch, commit,
backend and run are provenance and never split a slot. So desktop web, mobile web, iOS and Android
results of one check sit side by side; a layer that re-ran one scenario leaves every other scenario as
the last layer that ran it; and a fix on any branch replaces the failure it fixes.

**The report does not depend on how layers arrived.** Order of reading, number of backends, how
the layers were split across nodes, and duplicates are all invisible. This is tested over random
partial runs, and it is why you can shard a suite across ten machines, re-run one failing check
locally, and publish a device lab's layers from elsewhere, with nothing to coordinate.

**Backends** hold layers. A backend is any implementation of the seven-method `ObjectStore`
interface. Atlas ships an S3 store (AWS S3, R2, MinIO and anything that speaks its protocol, with no SDK)
and a directory store with atomic writes, and `verifyObjectStore` proves an adapter before you trust it. Several backends are one report, and one
that is down is named and skipped.

**The gate** is `atlas report status`. It exits 0 only if some check completed, none failed, none is
still running, every layer and backend could be read, and every `--require-environments` environment
has results. `--format json` is a [stable schema](packages/schema/schemas/report-status.schema.json). Exit code 1
means the report does not pass; 2 means the command itself was wrong (a missing store directory, a bad
flag).

**The node** is `atlas serve`: one process that serves the viewer and the report from the store.
Point `ATLAS_STORE` at a bucket and every developer's laptop and every CI job publishes into it with the
same command; everyone then looks at one report. Uploads default to its local data folder; choose a shared write backend when running several copies. See
[running Atlas for a project](docs/deploying.md).

```sh
export ATLAS_STORE=s3://my-bucket/atlas/my-project   # AWS_* or `aws sso login` for credentials
atlas report doctor                                  # is the bucket usable, and what is missing?
atlas report publish --producer unit --junit out.xml --specs ./specs   # from CI or a laptop
atlas serve                                   # the whole project, at :8080
```

**The viewer** shows each spec (Gherkin, Quint, DMN, Alloy, OpenSLO, and the rest by file type) with
its combined result per environment and the layer behind it. See
[integrating Atlas](docs/integrating.md#6-browse-it).

```ts
import { combineBackends } from '@crvouga/atlas/reports/compose';
import { directoryStore } from '@crvouga/atlas/reports/directory-store';
import { reportStatus } from '@crvouga/atlas/reports/report-status';

const report = await combineBackends([
  { id: 'ci', store: directoryStore('all') },
  { id: 'lab', label: 'Device lab', store: deviceLabStore() }
]);
const status = reportStatus(report, { requireEnvironments: ['ios'] });
if (!status.ok) throw new Error(status.reasons.join('\n'));
```

## Open standards

Atlas invents as little as it can. Everything it reads or writes is a format other tools already
understand, or a JSON Schema it publishes.

| Standard | Used for |
| --- | --- |
| [JUnit XML](https://github.com/testmoapp/junitxml) | Read: any test runner's results become a layer. Written: `junit.xml`, one test case per statechart path. |
| [CTRF](https://ctrf.io) | Read: any CTRF report becomes a layer. Written: `ctrf.json` for each statechart run. |
| [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) | The contract: layers, check files, report status, run manifests, journeys, state nodes, timelines and the runs index (`@crvouga/atlas/schemas/*.schema.json`) |
| [Gherkin](https://cucumber.io/docs/gherkin/), [Quint](https://quint-lang.org), [DMN](https://www.omg.org/spec/DMN), [Alloy](https://alloytools.org), [OpenSLO](https://openslo.com) | Spec kinds the viewer lays results over, each in its own tab. Any other file is a spec of its own type. |
| [W3C SCXML](https://www.w3.org/TR/scxml/) | Statecharts (`*.scxml`), with business metadata in an `atlas` XML namespace |
| [XState v5](https://stately.ai/docs/machines) machine config | Statecharts (`*.machine.json`, `*.machine.yaml`): the JSON shape Stately Studio imports and exports |
| [WebVTT](https://www.w3.org/TR/webvtt1/) | Captions for every clip: each tap, keystroke, system call and screen change |
| [CloudEvents 1.0](https://cloudevents.io) | Business events the product emits (HTTP structured, binary and batch modes) |
| [W3C WebDriver](https://www.w3.org/TR/webdriver2/) | Driving browsers and, through Appium, native iOS and Android apps |
| [WAI-ARIA](https://www.w3.org/TR/wai-aria/) roles and accessible names | Signals that recognise screens the same way on every driver |
| MP4 / H.264 | Clips of each transition, encoded with FFmpeg |
| PNG / WebP | Screenshots at device resolution, with WebP thumbnails |
| [Mermaid](https://mermaid.js.org/syntax/stateDiagram.html) `stateDiagram-v2` | `chart.mmd`, and `atlas export --format mermaid` |

## Executable statecharts

Atlas can also run a product's flows as statecharts against the real app. Write down how the product
behaves as statecharts in open formats (W3C SCXML, XState v5 machine config), then let Atlas lint
them, plan paths that cover every transition, run those paths through any driver (a browser, a
phone, a plain function), and write a manifest of what happened, with screenshots, video clips,
captions, business events and standard test reports.

```
specs/                     atlas lint      the charts are pure, reachable, free of silent dead ends,
  app.scxml          ──▶                   and every journey replays
  child.machine.yaml       atlas plan      curated journeys + shortest paths covering every transition
  journeys.yaml            atlas run       each path against the product, through a driver
                                  │
                                  ▼
                           atlas-runs/<run>/manifest.json, junit.xml, ctrf.json, chart.mmd, media/
```

Each run publishes as a layer (`atlas report publish --manifest <run>/manifest.json`), so it combines
with every other suite's evidence. Shards, seeds, several clients in one run, drivers (Playwright,
Bun WebView, WebDriver and Appium, Detox, plain functions), business events and the privacy scan are
in **[Executable statecharts](docs/statecharts.md)**, which starts with a runnable example,
[`examples/todo`](https://github.com/crvouga/atlas/tree/main/examples/todo).

## License

[MIT](LICENSE)
