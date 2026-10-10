# Atlas reports

Atlas owns reusable evidence publication, storage, retention, APIs, report navigation and snapshot interpretation. All nondeterministic work is provided through structural `ObjectStore`, `Clock`, `Timers` and `HttpClient` ports. There are no consumer-repository dependencies.

Consumers capture `RunReport` timelines and use `publishSource`, `publishPart` and `publishInventory` to publish them. Existing commit-keyed and compressed report stores remain readable, including reusable sources and independent producer evidence. `createReportsApp` mounts a read-only Hono API over injected stores; it is hosted alongside Atlas, not the product under test.

The Atlas visualizer's Specs and evidence view includes Gherkin rules, backgrounds, scenarios and example tables, Quint declaration outlines and recorded state traces, DMN decision tables, source documents, contributing layer selection, outcomes, measurements, timelines, per-actor snapshots, action targets and performance hotspots. Missing evidence is never interpreted as a passing result.

`exportEvidence({ fetch, target })` copies a reports API into the static layout consumed by the visualizer, preserving layer provenance and captured files. It returns the list of unavailable artifacts. The caller provides a fresh output store; it must not publish the export until it completes.

## Combining evidence

Current specs define the outline. `combineLayers` fills it with the newest completed result for each producer, check and parameter set, across branches and commits. Equal-time conflicts favor failure. Unfinished runs do not erase completed outcomes. Missing specs stay visible and removed specs retain their evidence outside the outline. Disable layers to inspect earlier outcomes.

Immutable manifests retain every publication and share content-addressed recording blobs. `createReportsApp` accepts an `outline` callback for current documents, fingerprints and advisory changed paths. `/layers` serves bounded pages with a short metadata cache, and `/active` exposes local spec-suite runs to the live Atlas viewer. The workspace `bun run spec` publishes each finished package as the next package starts; Atlas refreshes layers while active runs continue. Recording blobs load only when opened. The browser fills older pages in the background and renders bounded result pages. Existing commit-addressed recordings are discovered in place and deduplicated against their archived layers. No automatic branch-based pruning removes accumulated evidence.

The reports API composes its remote store as the authoritative primary with a local filesystem cache. Reads populate ordered cache tiers, writes reach the primary before caches, cache write failures do not hide successful durable writes, and remote listings remain authoritative with a short in-process cache. Cache entries expire quickly so other publishers' updates appear; on a remote outage the dev viewer may serve a previously observed cached report. Objects above the cache size limit bypass local copying.

Spec runs persist each completed test timeline as it finishes, including failed timelines; the runner uses Bun's one-failure bail mode to stop starting further test files. The package collector still publishes the partial report and failed suite verdict before `bun run spec` exits.

Freshness warnings preserve the recorded outcome. Changed spec fingerprints or related working-tree files warn; missing fingerprints are unknown, and a different commit warns when related code has not been compared. No rerun is implied. This deliberately favors quick, potentially stale evidence over a consistent fresh execution; release verification remains separate.

## Standalone development

Configure `ATLAS_REPORTS_MODULE` with a host composition module exporting `reportsDevFetch(request, repoRoot)`. Atlas's Vite middleware serves it at `/api/reports`, alongside specs and chart runs. `INIT_CWD` identifies the consuming repository. Credentials stay in that server module.

For a separately hosted reports API, set `VITE_ATLAS_REPORTS_URL` when building the visualizer. Otherwise a built site reads `data/evidence/`, populated with `exportEvidence`. Atlas still browses specs if evidence is absent.

## Verification

`bun test tests` exercises this package without a consumer. The visualizer runs `bun run test:reports` for automated DOM and parsing checks. Consumers should retain black-box integration suites for their object-store and harness adapters. The migrated reporting contracts are in `specs/developer-tools/` at the Atlas root.
