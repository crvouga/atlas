# Atlas visualizer

A map of how a product behaves: every screen a user can see, every event that moves them on, the
named journeys through them, and whether the latest run of the app did what the spec says. It
reads two independent sources and works with whatever exists:

1. **Spec only.** Charts render from the specs directory alone, with designed placeholders where
   screenshots will go.
2. **Partial runs.** Real screenshots and clips replace each placeholder as a run writes them.
3. **Full runs.** Everything is populated, with history across runs.

## Point it at your project

```sh
atlas-visualizer dev --specs ./specs --runs ./atlas-runs
```

| Flag              | Meaning                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `--specs <dir>`   | Statecharts, journeys and notes. Default `./specs`.                                                      |
| `--runs <dir>`    | One directory per run, each with a `manifest.json` (what `atlas run` writes). Default `./atlas-runs`.    |
| `--fixture <name>`| Show a bundled example instead: `spec-only`, `partial`, `full`, `failures`, `removed`, `malformed`, `large`. |
| `--out <dir>`     | `build`: the static site (default `./atlas-site`). `publish-data`: the data only (default `./atlas-data`). |
| `--keep <n>`      | How many of the newest runs to publish (default 30).                                                     |
| `--no-data`       | `build`: leave the data out, to host it elsewhere.                                                       |
| `--port <n>`, `--host <host>` | `dev`: where to listen (default `localhost:5180`, or the next free port).                   |

Relative paths resolve against the directory the command was run from. Without flags the
environment is read: `ATLAS_SPECS_ROOT`, `ATLAS_RUNS_ROOT` (relative to `INIT_CWD`, which pnpm sets
to where you ran it, or the current directory) and `ATLAS_FIXTURE`. With nothing configured and no
`specs/` directory, the `full` example is shown.

Editing a spec file or a run finishing updates the open page in about a second, without a reload,
keeping selection, zoom and pan.

### Explore large charts

Use **Show details** on a child machine or collapsed group to explore its interior in place.
**Hide details** returns it to a summary card; incoming and outgoing events stay connected.
**Collapse all** gives a high-level map, while **Expand all** opens every nested group and child.
Detail levels are remembered per chart during the browser session, along with zoom and pan.
**Compact** replaces screenshot cards with smaller state cards. Saved layout pins apply to the
original view; alternate detail levels are laid out automatically.

Select a journey to open its navigator. The full path is highlighted and unrelated branches fade.
Choose any step, use **Previous / Next**, or **Play / Pause** to follow the journey. Each step reveals
its destination and focuses the camera, including parallel branches and child-machine hand-offs.
**Inspect this event** opens the recording and details while keeping your place in the journey.
**Path only** hides unrelated states and events and lays out the remaining path. **Fit journey**
shows the full route; **Back to path overview** leaves step mode. Journey and step live in the URL
so browser history and shared links preserve your place.

Search **Find a state** to jump directly into any nested state; its ancestors open automatically.
Use arrow keys and Enter in search. On the map, `/` opens search, `F` fits the map or journey,
`←` / `→` moves through journey steps, Space plays or pauses, and Escape returns to path overview.
Minimap and legend controls keep orientation and event meanings available without covering the map.
On smaller screens the journey navigator moves below the map and details open as a bottom sheet.

### Commands

```sh
atlas-visualizer dev          --specs <dir> --runs <dir>             # live, from disk
atlas-visualizer build        --specs <dir> --runs <dir> --out site  # static site + its data
atlas-visualizer publish-data --specs <dir> --runs <dir> --out data  # data only
```

`build` writes a static site that any file server can host, with the spec and the newest runs
under `<out>/data`. URLs use the hash, so deep links work without server rewrites. A run whose
privacy check failed or is missing is never published. With `--no-data`, set
`VITE_ATLAS_BASE_URL` at build time to where `publish-data` output is hosted; `VITE_ATLAS_POLL_MS`
sets how often the site checks for new runs (default 60 s, plus when the tab regains focus).

### Inside this workspace

```sh
pnpm --filter @crvouga/atlas-visualizer dev                       # ATLAS_SPECS_ROOT / ATLAS_RUNS_ROOT, or the example
ATLAS_FIXTURE=partial pnpm --filter @crvouga/atlas-visualizer dev # one of the fixtures
pnpm --filter @crvouga/atlas-visualizer test                      # parsing, composition, statuses, every fixture
pnpm --filter @crvouga/atlas-visualizer fixtures                  # regenerate the fixtures (needs ImageMagick, cwebp, ffmpeg)
```

`publish-data` and `build` scripts do the same as the CLI, writing to `public/data` (or
`ATLAS_OUT`) and `dist`.

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
- **Run manifests** (`<runs>/<run-id>/manifest.json`, the `@crvouga/atlas-schema` contract):
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
