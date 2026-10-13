# Atlas visualizer

A map of how a product behaves: every screen a user can see, every event that moves them on, the
named journeys through them, and whether the latest run of the app did what the spec says. It
reads two independent sources and works with whatever exists:

1. **Spec only.** Charts render from the specs directory alone, with designed placeholders where
   screenshots will go.
2. **Partial runs.** Real screenshots and clips replace each placeholder as a run writes them.
3. **Full runs.** Everything is populated, with history across runs.

The explorer is one header, an open index and one plate. The index lists every place and journey of
the product; each kind of spec (Gherkin, Quint, DMN, Alloy, OpenSLO) has its own tab, with the
recorded result of every spec in its index. The header finds a flow in ordinary language across
charts, specs and recorded runs. ⌘K (Ctrl+K on other keyboards) opens it, and `/` does the same
when you are not already typing. Local directories, published HTTP files and HTTP APIs
can supply reports simultaneously. Reports update through file watching, polling or server events.
Latest includes running reports; one unavailable backend leaves the others usable.

See [report backends and live snapshots](../../docs/report-backends.md) for configuration,
the API contract, streaming notifications and adding another transport.

## Point it at your project

```sh
atlas-visualizer dev --specs ./specs --runs ./atlas-runs
```

| Flag              | Meaning                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `--specs <dir>`   | Statecharts, journeys and notes. Default `./specs`.                                                      |
| `--runs <dir>`    | One directory per run, each with a `manifest.json` (what `atlas run` writes). Default `./atlas-runs`.    |
| `--sources <file>` | JSON configuration for additional directories, HTTP files or HTTP API sources. |
| `--fixture <name>`| Show a bundled example instead: `spec-only`, `partial`, `full`, `failures`, `removed`, `malformed`, `large`. |
| `--out <dir>`     | `build`: the static site (default `./atlas-site`). `publish-data`: the data only (default `./atlas-data`). |
| `--keep <n>`      | How many of the newest runs to publish (default 30).                                                     |
| `--no-data`       | `build`: leave the data out, to host it elsewhere.                                                       |
| `--port <n>`, `--host <host>` | `dev`: where to listen (default `localhost:5180`, or the next free port).                   |

Relative paths resolve against the directory the command was run from. Without flags the
environment is read: `ATLAS_SPECS_ROOT`, `ATLAS_RUNS_ROOT` (relative to `INIT_CWD` when your package
manager sets it to where you ran the command, or the current directory) and `ATLAS_FIXTURE`. With nothing configured and no
`specs/` directory, the `full` example is shown.

Editing a spec file or a run publishing a snapshot updates the open page in about a second, without a reload,
keeping selection, zoom and pan.

### Commands

```sh
atlas-visualizer dev          --specs <dir> --runs <dir>             # live, from disk
atlas-visualizer build        --specs <dir> --runs <dir> --out site  # static site + its data
atlas-visualizer publish-data --specs <dir> --runs <dir> --out data  # data only
```

`build` writes a static site that any file server can host, with the spec and the newest privacy-checked snapshots
under `<out>/data`. URLs use the hash, so deep links work without server rewrites. A run whose
privacy check failed or is missing is never published. With `--no-data`, set
`VITE_ATLAS_BASE_URL` at build time to where `publish-data` output is hosted; `VITE_ATLAS_POLL_MS`
sets how often the site checks for new runs (default 60 s, plus when the tab regains focus).

### Inside this repository

```sh
bun run viz:dev                          # ATLAS_SPECS_ROOT / ATLAS_RUNS_ROOT, or the example
ATLAS_FIXTURE=partial bun run viz:dev    # one of the fixtures
bun test packages/visualizer/src packages/visualizer/vite   # parsing, composition, statuses, every fixture
bun run viz:fixtures                     # regenerate the fixtures (needs ImageMagick, cwebp, ffmpeg)
```

`bun run viz:publish-data` and `bun run viz:build` do the same as the CLI, writing to `public/data` (or
`ATLAS_OUT`) and `dist`. `ATLAS_SOURCES_FILE` supplies additional sources, and
`VITE_ATLAS_SOURCES_URL` can point a hosted viewer at a separate source descriptor file.

## What it reads

Open formats first, so specs are not tied to this tool:

- **W3C SCXML** (`*.scxml`): `<state>`, `<parallel>`, `<final>`, `initial`, `<transition event target>`
  and `<invoke>`. Readable names and business metadata travel in the Atlas namespace
  (`atlas:name`, `<atlas:meta>`, a final state's `atlas:done-event`), as SCXML allows.
- **XState v5 machine config** (`*.machine.yaml`, `*.machine.yml`, `*.machine.json`), the JSON
  form Stately Studio imports and exports. A `machine.json` beside a `machine.yaml` is taken as
  the same chart.
- **Child charts** compose with the standard `invoke: { src, id, onDone }` (SCXML `<invoke>` plus a
  `done.invoke.<id>` transition), or the older `meta.childMachine` with `meta.childFinalEvents`.
  Each final state at the top of a child hands an event to the state that runs it: its
  `childFinalEvents` entry, its own `meta.doneEvent`, or `done.invoke.<id>`, handled by a
  transition of that name or the invoke's `onDone`. This is how the Atlas runner composes charts,
  so transition ids match the run manifests.
- **Journeys** (`journeys.yaml` beside a chart): named event lists, replayed through the composed
  chart with hand-off events inserted.
- **Notes** beside a chart: `open-questions.md`, `known-issues.md`; a `<chart>.layout.json` pins
  node positions; an optional `atlas.yaml` at the specs root declares contexts and hand-offs
  between them (without it, each top-level folder holding a chart is a context).
- **Run manifests** (`<runs>/<run-id>/manifest.json`, the `@crvouga/atlas/schema` contract):
  screenshots, clips with WebVTT captions (shown as the video's caption track), timelines,
  business events with the CloudEvents a source observed, paths, coverage, and links to the
  JUnit, CTRF and Mermaid reports the run wrote. Unknown fields and newer formats are read as far
  as they go.

The spec parsing is `@crvouga/atlas/spec`, the browser-safe part of the Atlas core.

## How it fits together

```
bin/atlas-visualizer.mjs   CLI: dev, build and publish-data through Vite's JS API
vite/atlas-files.ts        node: resolve the roots, find spec files, summarize run directories, safe paths
vite/atlas-dev-plugin.ts   dev adapter: serves /__atlas/{specs,runs}, range requests, change events over HMR
vite/publish.ts            lays out specs/ and runs/ (with index.json files) for a static host
src/data/adapters          static adapter (HTTP from a base URL) and dev adapter (same + HMR)
src/data/parse             tolerant parsing: each chart, state, transition, journey and run record on its own
src/data/model             the view model: spec + selected run → one status per state, event, journey
src/data/queries.ts        TanStack Query: per-file caching, live invalidation, polling
src/layout                 chart → ELK graph → positions in ELK's worker, cached by structure
src/map                    React Flow map: phone-frame screens, regions, child-chart boxes, event chips
src/components, src/views  header, legend, placeholders, panels, product map
src/evidence               spec tabs: index, result pages, recordings, sources
example/specs              the example spec every fixture is generated from
```

Components read only the view model (`AtlasView`), never raw files.

- **Statuses.** States and events resolve to working (`passed`), unreliable (`flaky`), broken
  (`failed`), not reached, not run yet (a run exists but didn't cover it), or spec only (no runs).
  Groups take the worst of themselves and what they contain. Run records the spec no longer has
  are listed as removed from the spec, never dropped.
- **Event kinds.** Who sends an event (`user`, `system`, `time`, `hand-off`; the older `member` is
  read as `user`) comes from, in order: chart `meta.eventKinds`; the structure (hand-offs); chart
  `meta.timeEvents`; the run record; a guess from the wording. The developer section says which.
- **Data issues.** Every skipped or guessed piece becomes a plain-language issue with its file and
  path, listed behind a quiet count in the header.
- **Layout.** ELK lays out each chart (nested states as regions, parallel states side by side) in
  its own worker. Positions are cached under a hash of the chart's structure only, so new results
  never move anything.

## Fixtures

`fixtures/` holds seven scenarios generated by `scripts/make-fixtures.ts` from `example/specs`, a
coffee-ordering app: an XState root chart with a parallel region that invokes a checkout chart
written in SCXML. Every screenshot and clip is synthetic. `large` is a generated six-context atlas
of about 500 states that mixes `invoke`, SCXML children and the legacy composition.

## License

MIT

## Specs and their results

Beside the statechart map, every other kind of spec has its own tab: Gherkin features, Quint models, DMN decision tables, Alloy structures and OpenSLO objectives. A tab appears when the specs folder has files of its kind. The index lists every spec with what was recorded for it, and filters to those with results, those failing, or those with none. A spec page shows each scenario, trace or check with its outcome; opening one shows the recorded steps, the error, the timings, every other run of the same check, and its recording.

Results come from the Atlas reports API (`/api/reports` in dev, `VITE_ATLAS_REPORTS_URL` when hosted elsewhere) or from a static `data/evidence` export. They combine across backends, branches, versions, environments and layers; **Sources** in the header switches any of them off. While a spec suite is running, the header says so and each finished test appears within a couple of seconds. See [Atlas reports](../reports/README.md) for the API and host configuration.

The coffee example ships those documents and a layered report, served in dev when `ATLAS_REPORTS_MODULE` is unset. That is `ATLAS_FIXTURE=full`, and the fallback when the working directory has no `specs/`. The same built-in report is served for `examples/todo/specs` when no host module is set. `atlas:viz` sets `ATLAS_REPORTS_MODULE` to the todo example's own store, so it shows the runs `atlas:run` wrote. Each built-in report is five layers: an older desktop web run, a mobile web branch, Android from a device lab, a focused iOS run, and a newer desktop web run that repeated one scenario. The same check stays visible on each environment. A feature with no layer stays empty.

The header title is the product's name, taken from `atlas.yaml`'s `title` up to its first dash or colon, or "Atlas".

`src/evidence/` holds this part of the viewer: `evidence-context.tsx` reads and combines the layers, `spec-index.tsx` is the index, `feature-page.tsx`, `model-page.tsx` and `document-page.tsx` are the three kinds of spec page, `check-detail.tsx` is one check's results, and `recording.tsx` is the recorded timeline. `tests/reports.test.tsx` drives the whole viewer against an in-memory reports API.
