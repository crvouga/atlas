# Atlas

**Specs of any kind, reported as layered evidence.** Atlas lays the results of every suite that
checks your specs (Gherkin, Quint, DMN, Alloy, OpenSLO, unit and end-to-end tests, linters,
statecharts) over the specs themselves, across machines, branches, environments and storage
backends, and tells you in one command whether the product still does what it was specified to do.

- **Any spec, any runner.** Anything that ends in "this check passed or failed" publishes a *layer*:
  from a JUnit or CTRF file, a ten-line script, or code. No runner and no notation is privileged.
- **Layered within each project.** A report is computed from layers, not stored as "the run". Partial
  runs on separate nodes, branches and devices are how a report is built, and they compose without
  coordinating: the same layers give the same report in any order, split any way.
- **Open evidence.** A result carries whatever your framework produces: screenshots, videos, traces, logs, DOM
  snapshots, timelines, retries, annotations, your own structured data. Any media type, nothing registered, and
  new kinds never break older readers ([extending](docs/extending.md)). Specs stay opinionated (statecharts,
  Gherkin, Quint, DMN, Alloy, OpenSLO); evidence stays open.
- **Open standards, stable schemas.** JUnit XML and CTRF in, JSON Schema 2020-12 contracts, a
  versioned layer format with a golden fixture, and an `ObjectStore` interface any bucket fits.
- **One node, many projects.** `atlas server` runs a Bun API and serves the Atlas client from the same host. Reports, specs, recordings and live progress are partitioned by project slug.
  Every laptop and CI job sends results to it as they finish (`atlas report publish`, or `atlas report stream` while
  a suite runs), it keeps them in an S3-compatible bucket (AWS S3, R2, MinIO; required, nothing else is used), and every client sees the combined report
  update live, receiving only what changed ([the server](docs/server.md), [deploying](docs/deploying.md)).
- **Fast and fail-closed.** Publishing is two small writes. A thousand layers of a hundred checks
  combine in about a second. An unreadable layer, a downed backend or a check still running is never
  counted as a pass.
- **Executable statecharts too.** Atlas can also run a product's flows as statecharts against the
  real app, and publishes those runs as layers like any other ([below](#executable-statecharts)).

```
 any suite   ──▶ layer ─┐                              atlas report status   exit 1 unless it passes
 any node    ──▶ layer ─┼─▶ backends ─▶ combine ─▶     the Atlas client        browse it beside the specs
 any branch  ──▶ layer ─┘   (directories, buckets, …)   combineBackends()     your own code
```

> [!IMPORTANT]
> **Dogfooding phase:** Atlas is developed by using it in real projects. Those projects install the
> published package from npm and report bugs and missing features as GitHub issues; they do not
> change this repository. If you are integrating Atlas, or are an agent working in a project that
> uses it, read **[integrating Atlas](docs/integrating.md)**, then
> [using Atlas from another project](docs/dogfooding.md) and [reporting issues](docs/reporting-issues.md).
> Releases are automatic: see [releasing](https://github.com/crvouga/atlas/blob/main/docs/releasing.md).

## Given this repo link to integrate Atlas?

Start with **[the agent integration playbook](docs/agents.md#given-only-this-repository-link)** in your own
project. It covers choosing an integration, installing with your package manager, finding docs for your installed
version, running without a server, connecting real suites, and proving completion. **[Verify Atlas locally](docs/quickstart.md)**
is a copyable walkthrough with expected JSON and exit codes; it needs no credentials or existing test suite.
The machine-readable index is [llms.txt](llms.txt), and [llms-full.txt](llms-full.txt) contains the guides in one file.

## Develop in an agent IDE

Superset, super.engineering and Orca lifecycle configuration is checked in. Run `bun run dev --setup`,
then use the IDE's Run target or `bun run dev` to start services, run the full example workflow, and keep the
API, settings and hot-reloading viewer available. Use `bun run dev --server` for the server alone,
`bun run dev --preview` for the separate examples viewer, and `bun run dev --status` for this checkout's
actual URLs. [Workspace development](docs/workspaces.md) covers ports, cleanup and agent workflows.

The manual package commands are deliberately limited:

| Command | Purpose |
| --- | --- |
| `bun run dev` | Develop: start services, populate examples and keep the viewer available. |
| `bun run check` | Run the complete verification workflow; `--only <group>` selects one gate. |
| `bun run test` | Run the full test suite. |
| `bun run build` | Build the publishable package. |
| `bun run docs` | Generate docs and schemas; `--check` verifies their contracts. |
| `bun run smoke` | Verify the packed package from a clean Bun/Node consumer. |

Development modes and lifecycle operations are flags on `dev`; there are no parallel development aliases.


## Run this repository's example

For contributors working in an Atlas checkout with dependencies installed (`bun install --frozen-lockfile`).
Consumer projects install the npm package instead; they do not need to clone or build this repository.

For the complete workflow in one command, run `bun run dev`; it starts the required services automatically.
The lower-level commands remain available in two terminals:

```sh
bun scripts/atlas.mjs          # starts the project-agnostic Atlas node at http://localhost:5180
bun scripts/examples.ts run    # runs tests and streams results, current steps and progress as they execute
```

The server starts independently; it never loads example specs or reports. **It needs S3-compatible storage** (see [Required S3 storage](#required-s3-storage)): copy `.env.example` to `.env` and fill in the `ATLAS_S3_*` variables first, or it exits at once and lists every one that is missing. `bun scripts/examples.ts run` publishes the Todo example under `todo-app`. Select a project using the top-right picker, then use the spec dropdown breadcrumbs to navigate. Other projects set `ATLAS_SERVER_URL`, `ATLAS_PROJECT` (for example `checkout-service`) and their publish token. Every uploader talks to the node; storage credentials stay on the server.

Every Gherkin scenario runs, including sharing and renaming. Test reports show running spinners,
live step logs and a Running status filter. Producers send heartbeats every
5 seconds. A run becomes interrupted after 30 seconds without a heartbeat, or 15 minutes without progress;
configure `ATLAS_RUN_TIMEOUT_SECONDS` and `ATLAS_RUN_STALL_SECONDS` (0 disables the progress timeout),
or edit these settings in the client. An interruption never turns missing outcomes into passes.

The workflow also captures the todo app's [UI catalog](docs/ui-catalog.md): seven states in desktop and mobile
profiles, including empty lists, sync outages and pending changes. Choose **UI catalog** from the spec-type menu
to browse the screenshots. The expected inventory, surface coverage and pictures are published automatically.

## Deploy to Railway without code

Copy this image URI into **Railway → New service → Docker image**:

```text
ghcr.io/crvouga/atlas:latest
```

The image includes the Atlas server and viewer; hosting it needs no repository, Dockerfile, build command
or package installation. [`latest` on GHCR](https://github.com/users/crvouga/packages/container/atlas) follows
the newest checked `main` image, independently of npm releases.

1. Leave the start command unset. Add a long random secret as `ATLAS_TOKEN` (at least 12 characters;
   use 48 or more).
2. Add the five required storage variables (`ATLAS_S3_ENDPOINT`, `ATLAS_S3_BUCKET`, `ATLAS_S3_REGION`,
   `ATLAS_S3_ACCESS_KEY_ID`, `ATLAS_S3_SECRET_ACCESS_KEY`; see [Required S3 storage](#required-s3-storage)) for a
   bucket you own, and keep one replica. All reports and settings live in that bucket, so no volume is needed and
   the service refuses to start, listing what is missing, without them.
3. Set the healthcheck path to `/readyz` and generate a public domain. Railway supplies `PORT`;
   leave `ATLAS_PORT` unset. Open the domain and sign in with the token as the password (any username).
4. Enable **Settings → Source → Configure Auto Updates → Anytime** to follow `latest`.
   [Railway checks for image updates periodically](https://docs.railway.com/deployments/image-auto-updates);
   detection can take a few hours.

For the exact image from a run, open **[CI](https://github.com/crvouga/atlas/actions/workflows/ci.yml) →
run → Summary → Atlas CI**. The summary includes a copyable full commit tag, the immutable registry digest,
whether that run updated `latest`, all job results, npm release details and artifact links. Use the commit
tag to pin or roll back a deployment. The [deployment guide](docs/deploying.md#run-it) covers optional reader
and publisher tokens, the S3 bucket and sending results from your projects.

### Deploy without authentication

For anonymous access, use this image in Railway instead:

```text
ghcr.io/crvouga/atlas-insecure:latest
```

It contains the same server and viewer, with anonymous reading, uploads and administration enabled.
Follow the Railway steps above, leaving `ATLAS_TOKEN`, `ATLAS_PUBLISH_TOKEN`, `ATLAS_READ_TOKEN` and
configuration-file auth tokens unset. Open the generated domain directly; no sign-in is required.
Anyone who discovers the URL can read reports, upload results and change settings. An unlisted URL
is not access control. See the [anonymous deployment guide](docs/deploying.md#deploy-without-authentication)
for a token-free project configuration and verification commands.

## For AI agents

Atlas is built to be integrated and operated by agents, with nothing to click and nothing to guess.

- **`atlas init`** detects a project's test runners, specs and CI and prints a plan (`--format json`) of the exact commands to
  run each suite and send its results; `--write` creates the CI workflow and an `AGENTS.md` section. Running it twice
  changes nothing.
- **Init and report commands print JSON on request** (`--format json`) with published JSON Schemas and consistent
  exit codes (`0` worked, `1` the answer is no, `2` the command was wrong). Reapplying init or publishing identical evidence is safe.
- **The server describes itself:** `GET /api/openapi.json` (OpenAPI 3.1) and `GET /llms.txt` (a guide for an agent given only
  the address) need no token; errors are RFC 9457 problem documents that say what to do.
- **Documentation is generated from the code beside it:** `llms.txt` / `llms-full.txt` (also in the package), the TypeScript
  reference in [`docs/reference/`](docs/reference/server.md), the CLI and HTTP references, and the settings tables; tests fail when
  any of it drifts.

Start with **[Atlas for AI agents](docs/agents.md)**. A [copyable integration brief](docs/agents.md#an-integration-brief-you-can-give-an-agent)
lets a user hand an agent this repository URL and a concrete definition of done.

## Integrate in five minutes

```sh
bun add -d @crvouga/atlas            # or npm install -D / pnpm add -D

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
| **[The Atlas server](docs/server.md)** | The living application: configuration, tokens, the upload and streaming protocol, the full API, what it refuses, performance. |
| **[Running Atlas for a project](docs/deploying.md)** | Production: the server (Docker, Kubernetes, auth), sending results from CI and laptops, an S3 bucket and its policies, filters, operating it. |
| [The report contract](docs/report-contract.md) | The exact rules: the layer document, how layers compose, guarantees, backends, versioning, failure behaviour. |
| **[Evidence: attachments, timelines and everything else](docs/extending.md)** | What a result can carry, the rules that keep the format compatible forever, and how to attach anything from any framework. |
| [Report backends and live snapshots](docs/report-backends.md) | Connecting directories, HTTP files and APIs, streaming, and writing another transport. |
| [`@crvouga/atlas/reports`](packages/reports/README.md) | The programmatic API: `publishChecks`, `combineBackends`, `reportStatus`, `directoryStore`, `reportsHost`. |
| [`@crvouga/atlas/schema`](packages/schema/README.md) | The JSON Schemas and Zod schemas of every document. |

## One package

Atlas is a single npm package. Each part is its own import path, so a bundler keeps only what you
import. Use your project's package manager:

<!-- generated:runtime-requirements -->
Supported runtimes (from `package.json`): **node `>=22.18.0`** or **bun `>=1.2.0`**. Node consumers do not need Bun unless they use the Bun WebView driver.
<!-- /generated:runtime-requirements -->

```sh
bun add -d @crvouga/atlas
```

| Import | What it is |
| --- | --- |
| [`@crvouga/atlas/reports/<module>`](packages/reports) | Evidence for any spec: publish layers (`publish-checks`, `ingest`, `reporter` to stream them), store them (`s3-store`, `directory-store`, `http-store` for a server, any `object-store`), combine and gate them (`compose`, `report-status`), copy them (`copy-store`). |
| [`@crvouga/atlas/server`](packages/server) | The Atlas server as a `fetch` handler (`createAtlasServer`), served over HTTP on Bun and Node (`listen`). |
| [`@crvouga/atlas/schema`](packages/schema) | The contract: Zod schemas and JSON Schemas for layers, check files, report status, specs, journeys, manifests, timelines and the runs index. |
| [`@crvouga/atlas`](packages/core) | Spec loading (SCXML and XState), composition, lint, planning, the runner, multi-client runs (`combineDrivers`), `httpDriver` and `functionDriver`, CloudEvents, privacy, config and the `atlas` CLI. `@crvouga/atlas/spec` is a browser-safe subset; `@crvouga/atlas/signals` holds the driver-neutral signals. |
| [`@crvouga/atlas/playwright`](packages/playwright) | Playwright driver: signal-based screen recognisers, paced taps and typing with a touch overlay, device-resolution screenshots and H.264 clips. |
| [`@crvouga/atlas/bun`](packages/bun) | Bun WebView driver: Bun's built-in headless browser (the system WebKit on macOS, Chrome elsewhere), nothing to download. |
| [`@crvouga/atlas/webdriver`](packages/webdriver) | W3C WebDriver driver with no dependencies: Safari, Chrome, Firefox and Edge, and native iOS and Android apps through Appium. |
| [`@crvouga/atlas/detox`](packages/detox) | Detox driver for iOS and Android apps, inside a Detox test run. |
| [`@crvouga/atlas/vitest`](packages/vitest) | Run a config as a test suite in Vitest, `bun test` or any Jest-style runner, one test per planned path. |
| [`atlas client`](packages/visualizer) (command) | Browse specs, charts and layered reports: every spec with its result per environment, every state with its screenshots, every transition with its clip. |

Two commands install with it: `atlas` (`report`, `lint`, `plan`, `run`, `merge`, `export`) and
`atlas client`.

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

**The server** is `atlas serve`: one process that serves the client, takes in results and streams the report to
every client. Point `ATLAS_STORE` at it and every developer's laptop and every CI job sends results with the same
commands that write to a folder; everyone then looks at one report, live. Results are kept in an S3-compatible bucket
and nowhere else ([required storage](#required-s3-storage)). `atlas dev` runs the same server with the client's dev server in front, so
development is one host too. See [the server](docs/server.md) and
[running Atlas for a project](docs/deploying.md).

Deploy the server using the [Railway setup above](#deploy-to-railway-without-code), or follow the
[deployment guide](docs/deploying.md#run-it) for other hosts.

```sh
atlas serve                                          # the project's server, at :8080 (needs ATLAS_S3_*; ATLAS_TOKEN says who may upload)

export ATLAS_STORE=https://atlas.example.com ATLAS_TOKEN=…   # on every laptop and CI job
atlas report publish --producer unit --junit out.xml --specs ./specs     # when a suite is done
my-suite --json | atlas report stream --producer e2e --environment ios  # or as its checks finish
atlas report status --branch main --ignore-modified  # the gate, answered by the server
```

### Required S3 storage

The Atlas server keeps **all reports and all user state in S3-compatible object storage, and nowhere else**: no local
disk, no memory, no database, no browser storage. *User state* is one JSON document in the bucket,
`server/state.json`, that holds the **garbage collection policy** (defined in the Atlas UI at `/admin`) and the
settings saved there. The server reads the policy from that document each time it collects. Until someone saves a
policy, garbage collection is off and nothing is ever deleted.

Because of that, the storage settings are **required environment variables with no defaults** (see
[`.env.example`](https://github.com/crvouga/atlas/blob/main/.env.example)), and the server **refuses to start** (exit status 2) without them:

| Variable | Required | Meaning |
| --- | --- | --- |
| `ATLAS_S3_ENDPOINT` | yes | S3 API endpoint, e.g. `https://s3.eu-west-1.amazonaws.com` |
| `ATLAS_S3_BUCKET` | yes | Bucket for reports and user state; it must already exist |
| `ATLAS_S3_REGION` | yes | Bucket region (`auto` for Cloudflare R2) |
| `ATLAS_S3_ACCESS_KEY_ID` | yes | Access key of an account that may list, read, write and delete in the bucket |
| `ATLAS_S3_SECRET_ACCESS_KEY` | yes | Its secret key |
| `ATLAS_S3_PREFIX` | no | Folder inside the bucket (default: the bucket root) |
| `ATLAS_S3_PATH_STYLE` | no | `1` (default) for `endpoint/bucket/key`, `0` for virtual-hosted style |
| `ATLAS_S3_SESSION_TOKEN` | no | Only for temporary credentials |

If a variable is missing or malformed, or S3 rejects the settings, Atlas lists **every** variable with `[MISSING]`
or `[INVALID]` next to the ones that are wrong, says why storage is required, and exits non-zero:

```text
==============================================================================
  ATLAS CANNOT START: S3 STORAGE IS NOT USABLE
==============================================================================
  Why:    the S3 configuration is missing or invalid.
  Reason: Atlas stores ALL reports and ALL user state (the garbage collection policy and saved
          settings) in S3-compatible object storage, and nowhere else. …
  Required environment variables:
  [MISSING] ATLAS_S3_ENDPOINT           S3 API endpoint of the object storage service
  [ok]      ATLAS_S3_BUCKET             Bucket that holds reports and user state; it must already exist
  …
```

See [the server guide](docs/server.md#required-s3-storage) for the details and
[user state and garbage collection](docs/server.md#user-state-and-garbage-collection) for how the policy works.

**The client** shows each spec (Gherkin, Quint, DMN, Alloy, OpenSLO, and the rest by file type) with
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
| [Gherkin](https://cucumber.io/docs/gherkin/), [Quint](https://quint-lang.org), [DMN](https://www.omg.org/spec/DMN), [Alloy](https://alloytools.org), [OpenSLO](https://openslo.com) | Spec kinds the client lays results over, each in its own tab. Any other file is a spec of its own type. |
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

Native [CodeceptJS, Mocha, Jest and Node test reporters](docs/runners.md) upload directly to the project server. Open **Settings** in the client to configure storage and report settings for the next restart.
