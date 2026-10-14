# Atlas reports

Evidence for specs of any kind, kept as immutable **layers** and read back as one report. Start with
[integrating Atlas](../../docs/integrating.md); the exact rules are in
[the report contract](../../docs/report-contract.md).

## The short API

Every module is its own import path: `@crvouga/atlas/reports/<module>`. Nothing runs at import.

| Module | Exports | For |
| --- | --- | --- |
| `publish-checks` | `publishChecks(store, input)` | Publish the checks of one producer as one layer. Validates, is idempotent, reads no clock. |
| `ingest` | `checksFromCtrf`, `checksFromJunit`, `checksFromManifest` | Turn a CTRF report, JUnit XML or an Atlas run into checks, with stable ids. |
| `compose` | `combineBackends(backends, options?)`, `summarize` | Read every layer of every backend and lay them over the specs. A down backend or unreadable layer becomes a notice. |
| `report-status` | `reportStatus(report, { requireEnvironments? })`, `formatStatusText`, `formatStatusMarkdown` | The gate: `ok`, `reasons`, `failing`, counts per environment. Fails closed. |
| `directory-store` | `directoryStore(dir)` | A backend on a directory, with atomic writes. |
| `s3-store` | `s3Store({ bucket, prefix, region, endpoint })`, `S3Error` | A backend on AWS S3, R2, MinIO and anything with the S3 protocol. No SDK: SigV4 over `fetch`, retries, region redirects, a request cap. |
| `aws-credentials` | `credentialChain()` | Credentials the way an AWS SDK finds them: environment, IRSA, ECS, shared file, the AWS CLI (SSO), EC2. Refreshed before they expire. |
| `store-url` | `openStore(url)`, `parseStoreLocation`, `storeSpecs` | `s3://bucket/prefix?…`, a folder, or `ATLAS_STORE`, as a store. |
| `spec-set` | `publishSpecSet`, `latestSpecSet`, `collectSpecFiles` | Publish the specs of a commit, and pick the newest committed set of `main` as the outline. |
| `run-bundle` | `publishRunBundle`, `listRunSummaries` | Upload a finished statechart run with its media (privacy-gated). |
| `report-index` | `ReportIndex` | The report, maintained incrementally: each layer read once, only winners kept. |
| `@crvouga/atlas/server` | `createAtlasServer({ backends, write, site, tokens, include })`, `listen` | The live report server as a `fetch` handler, served over HTTP on Bun and Node. |
| `doctor` | `inspectStore`, `iamPolicy` | Check a store end to end; the least-privilege IAM policy. |
| `object-store` | `ObjectStore` | The backend interface: seven methods, no transactions. |
| `object-store-conformance` | `verifyObjectStore(store)` | Prove a backend you wrote meets the interface. Runs under any test runner. |
| `copy-store` | `copyStore(from, to)` | Copy the layers a store is missing. Idempotent and commutative: how partial reports meet. |
| `host` | `reportsHost({ specs, stores })` | The reports half of the viewer for your stores and specs directory. |
| `layer-merge` | `combineEvidence`, `layerEvidence`, `textFingerprint` | The composition rule itself, over layers already in memory. |
| `directory-outline` | `loadDirectoryOutline(dir)` | A specs directory as the outline reports are laid over. |

```ts
import { combineBackends } from '@crvouga/atlas/reports/compose';
import { directoryStore } from '@crvouga/atlas/reports/directory-store';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { reportStatus } from '@crvouga/atlas/reports/report-status';

const store = directoryStore('atlas-reports');
await publishChecks(store, {
  producer: 'quint',
  environment: 'desktop-web',
  recordedAtMs: Date.now(),
  checks: [{ id: 'specs/booking.qnt > no double booking', title: 'No double booking', status: 'passed', specPath: 'specs/booking.qnt' }]
});

const report = await combineBackends([{ id: 'local', store }]);
const status = reportStatus(report);   // { ok, reasons, checks, byEnvironment, failing, notices, … }
```

The CLI is the same API for people without code: `atlas report publish | status | merge`.

## Recordings, commit-keyed parts and the viewer's API

Everything below is the machinery under the viewer: recorded timelines and captured files
(`publishSource`), commit-keyed parts (`publishPart`) that older stores hold, and the read-only API
(`createReportsApp`) the viewer calls. Most projects need only the API above: plain checks need none
of it, and `reportsHost` wraps `createReportsApp` for your stores.


Atlas owns reusable evidence publication, storage, retention, APIs, report navigation and snapshot interpretation. All nondeterministic work is provided through structural `ObjectStore`, `Clock`, `Timers` and `HttpClient` ports. There are no consumer-repository dependencies.

Consumers capture `RunReport` timelines and use `publishSource`, `publishPart` and `publishInventory` to publish them. Existing commit-keyed and compressed report stores remain readable, including reusable sources and independent producer evidence. `createReportsApp` mounts a read-only Hono API over injected stores; it is hosted alongside Atlas, not the product under test.

The Atlas visualizer shows each kind of spec in its own tab, with every spec's recorded outcome in the index: Gherkin rules, scenarios and example tables with the result of each scenario, Quint declarations with their recorded traces, DMN decision tables, and the checks of any other document. Each result keeps its origin, measurements, recorded steps, per-actor snapshots, action targets and timings. Missing evidence is never interpreted as a passing result.

`exportEvidence({ fetch, target })` copies a reports API into the static layout consumed by the visualizer, preserving layer provenance and captured files. It returns the list of unavailable artifacts. The caller provides a fresh output store; it must not publish the export until it completes.

## Combining evidence

Current specs define the outline. A layer is one focused recording: the checks it actually ran, on one environment, from one version and branch, in one store. `combineEvidence` fills the outline from every layer. The newest completed result wins only its own producer, check, environment and parameter set. Desktop web, mobile web, iOS and Android of the same check all stay visible, and any other recorded environment does too. A layer that ran one scenario leaves every other scenario as the newest layer that did run it, so the report fills without one suite that runs everything. Equal-time conflicts favor failure. Unfinished runs do not erase completed outcomes. Missing specs stay visible and removed specs retain their evidence outside the outline. `evidenceView` groups those results by check: the outcomes, the recorded timings that qualify them, and a summary per spec. A timing over its allowance never fails a check. `checkHistory` returns every layer's own record of one check, so a superseded result stays readable. Leaving a backend, an environment, a branch, a version or one layer out (`contributes`) is how earlier outcomes are inspected.

## Backends

`createReportsApp` combines layers from several stores. `localStore` is the backend `local` ("This machine"), `store` is `shared` ("Shared reports"), and `backends` adds any number of further named stores. A backend is any `ObjectStore`: the local disk, a shared bucket, S3, or a device lab. Every layer says which backend, version, branch and environment it came from. An unavailable backend is named in the page's notices and leaves the others usable; `GET /evidence?retry=1` asks it again without waiting.

| Route | Returns |
| --- | --- |
| `GET /evidence` | A bounded page of layer origins and totals (`LayerHeader`), the backends, the running suites and any notices. `?cursor=` reads the next, older page. |
| `GET /evidence/rows/:backend/:id` | One layer's checks (`LayerRow`) and recorded spec fingerprints. Immutable layers are cacheable forever. |
| `GET /layers/:id/…` | An archived layer's `frame.css`, `tests/<test>/report.json` and `tests/<test>/files/<path>`. |
| `GET /live/:source/…` | The same files of a suite that is still running. |
| `GET /outline`, `GET /outline/spec?path=` | The current specs, their fingerprints, and one document. |

The index is small and is what a viewer polls. A layer's checks are read once and never again for an immutable layer. Recording blobs load only when opened. Existing commit-addressed recordings are discovered in place and deduplicated against their archived layers by execution. No automatic branch-based pruning removes accumulated evidence.

## Results while a suite runs

A producer announces a running suite by writing `{ packageDir, bucket, startedAtMs, plannedChecks? }` under `active/` in the local store, and removes it when the suite ends. Given `live: { bucket, origin?, frameCss? }`, the API reads the tests that suite has finished from the bucket it writes into and serves them as one live layer (`live-<source>`), so each result appears when its test ends, not when its package does. Its recordings are readable under `/live/<source>/`. When the suite ends, its live layer stays until the collected layer for the same producer appears, or thirty seconds pass. A live layer is never exported.

The reports API composes its remote store as the authoritative primary with a local filesystem cache. Reads populate ordered cache tiers, writes reach the primary before caches, cache write failures do not hide successful durable writes, and remote listings remain authoritative with a short in-process cache. Cache entries expire quickly so other publishers' updates appear; on a remote outage the dev viewer may serve a previously observed cached report. Objects above the cache size limit bypass local copying.

Spec runs persist each completed test timeline as it finishes, including failed timelines. The package collector still publishes the partial report and failed suite verdict.

Freshness warnings preserve the recorded outcome. Changed spec fingerprints or related working-tree files warn; missing fingerprints are unknown, and a different commit warns when related code has not been compared. No rerun is implied. This deliberately favors quick, potentially stale evidence over a consistent fresh execution; release verification remains separate.

## Standalone development

For your own stores and specs directory, use `reportsHost` ([integrating Atlas](../../docs/integrating.md#6-browse-it)). The rest of this section is for hosts that compose the API themselves.

Configure `ATLAS_REPORTS_MODULE` with a host composition module exporting `reportsDevFetch(request, repoRoot)`. Atlas's Vite middleware serves it at `/api/reports`, alongside specs and chart runs. `INIT_CWD` identifies the consuming repository. Credentials stay in that server module.

When that module is unset and the open specs are the coffee example or the todo example, the visualizer dev server serves an in-memory layered report for those documents instead. Any other spec set is left alone. The todo example's own module serves that same layered report and adds the desktop web layer `example:run` writes.

For a separately hosted reports API, set `VITE_ATLAS_REPORTS_URL` when building the visualizer. Otherwise a built site reads `data/evidence/`, populated with `exportEvidence`. Atlas still browses specs if evidence is absent.

## Verification

`bun test tests` exercises this package without a consumer. The visualizer runs `bun run test:reports` for automated DOM and parsing checks. Consumers should retain black-box integration suites for their object-store and harness adapters. The migrated reporting contracts are in `specs/developer-tools/` at the Atlas root.
