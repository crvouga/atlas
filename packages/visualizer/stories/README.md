# Atlas screen workshop

Run `bun run dev --storybook` from the repository root, then open the URL printed by Storybook (port 6006 by default; pass `--port 6007` to choose another). No server, S3 credentials or populated workspace is needed. Stories render the production router, pages and Mantine provider. Editing production UI updates the stories directly.

Use the viewport toolbar to review 1440px desktop and 390px mobile layouts. Named mobile stories pin the mobile viewport. The accessibility panel runs axe; check keyboard focus, reading order and responsive behavior manually too. The console reports interaction-play failures.

## Checks

```sh
bun run storybook:check
bun run storybook:build
bun run storybook:test --built
```

The check typechecks the stories and Storybook configuration, then verifies that the explicit inventory matches every named story, router route family and supported spec kind. Build emits the self-contained workshop to `.atlas-workspace/storybook/`. The browser test starts a temporary Bun static server on an available loopback port, visits every built story, waits for its render and interaction play, checks nonempty content and uncaught browser errors, and verifies a catalog image actually decodes. The server stops when the test finishes. To test a running workshop instead, omit `--built`; `ATLAS_STORYBOOK_URL` overrides its default address. Add `--a11y` to fail on serious or critical axe violations across the whole document, including portal dialogs. Set `ATLAS_STORYBOOK_STORY` to one story ID for a focused rerun. The demonstrated behavior also verifies that the video reaches its metadata-ready state.

## Screen and state inventory

Every screen, surface, state and variation has a named story, grouped by product area in the sidebar; one stories file
per area. `inventory.ts` lists all 366 of them by file, and `inventory.test.ts` fails if a story, a stories file or a
route family changes without updating that inventory. This is an inventory of distinct product branches, rather than a
claim to enumerate every possible data value or combination of filters.

| Area | Stories | File |
| --- | --- | --- |
| Behaviors/Coverage states | 10 | `BehaviorsCoverage.stories.tsx` |
| Behaviors/Index | 15 | `BehaviorsIndex.stories.tsx` |
| Behaviors/Workspace | 10 | `BehaviorsWorkspace.stories.tsx` |
| Catalog health | 4 | `CatalogHealth.stories.tsx` |
| Collections | 5 | `Collections.stories.tsx` |
| Compare | 16 | `Compare.stories.tsx` |
| Foundations/Compositions | 4 | `FoundationsCompositions.stories.tsx` |
| Foundations/Controls | 5 | `FoundationsControls.stories.tsx` |
| Foundations/Data display | 6 | `FoundationsDataDisplay.stories.tsx` |
| Foundations/Theme | 5 | `FoundationsTheme.stories.tsx` |
| Needs polish | 11 | `NeedsPolish.stories.tsx` |
| Recordings/Artifacts | 16 | `RecordingsArtifacts.stories.tsx` |
| Recordings/Playlist | 8 | `RecordingsPlaylist.stories.tsx` |
| Runs | 19 | `Runs.stories.tsx` |
| Settings | 13 | `Settings.stories.tsx` |
| Shell | 32 | `Shell.stories.tsx` |
| Specs/Alloy | 4 | `SpecsAlloy.stories.tsx` |
| Specs/DMN | 4 | `SpecsDmn.stories.tsx` |
| Specs/Gherkin | 24 | `SpecsGherkin.stories.tsx` |
| Specs/OpenSLO | 4 | `SpecsOpenSlo.stories.tsx` |
| Specs/Quint | 4 | `SpecsQuint.stories.tsx` |
| Statecharts | 10 | `Statecharts.stories.tsx` |
| States/Empty | 12 | `StatesEmpty.stories.tsx` |
| States/Errors | 12 | `StatesErrors.stories.tsx` |
| States/Loading | 11 | `StatesLoading.stories.tsx` |
| States/Unavailable | 12 | `StatesUnavailable.stories.tsx` |
| Tests/Explorer | 35 | `TestsExplorer.stories.tsx` |
| Tests/Test detail | 16 | `TestDetail.stories.tsx` |
| UI catalog | 39 | `UiCatalog.stories.tsx` |

`Foundations` renders the design system itself with the production theme: surfaces and outcome colors, typography,
controls, data display, and the `PageHeader`, `Panel` and `Metric` compositions every page is built from. `States`
gathers the empty, loading, unavailable and error branch of every destination. Stories named `Mobile…` pin the 390px
viewport. The toolbar's **Scheme** control switches every story between the light and dark color schemes, so stories are
not duplicated per scheme. `support.ts` holds what stories share: the screen meta, address builders and the fixture's keys.

## Screenshots for review

```sh
bun run storybook:build
bun packages/visualizer/stories/screenshots.ts .atlas-workspace/story-screenshots          # every story, light
ATLAS_STORYBOOK_SCHEME=dark bun packages/visualizer/stories/screenshots.ts shots-dark tests-explorer   # a filtered set, dark
```

The second argument keeps the stories whose id contains it. `ATLAS_STORYBOOK_DIR` names another built workshop and
`ATLAS_CHROMIUM` a browser binary when Playwright's own is not installed (the smoke honors both too).

Interactive controls within these screens remain real: use them to examine nested disclosure, gallery zoom, keyboard search, environment and release filters, compare selection, settings forms, retries and playback. Arbitrary uploads, future evidence extensions, every combination of filters, all browser/media decoding failures and real authentication/storage/network integration are outside this finite fixture set; existing DOM, protocol and integration suites cover their respective contracts. Add an explicit story whenever a new product branch is introduced.

## Fixtures and isolation

The Storybook configuration builds the existing coffee example layers in memory and adds clearly named Storybook catalog and behavior fixtures. It serializes immutable ObjectStore contents as base64 into a virtual module; the browser reconstructs them and uses the actual reports API implementation to answer only fixture requests. It never contacts or writes a real Atlas server. Each story has a fresh router and query cache; `beforeEach` installs a matching transport and returns cleanup. Settings requests are simulated locally, including a real 409 response for conflict handling.

The ten behavior states come from a real Gherkin feature, published checks, revision fingerprints and an existing example video. Critic scores and findings are explicitly illustrative fixture opinions, not council ratings. State selection keys are derived through production catalog/behavior readers. Screenshots and video are existing illustrative coffee-example assets, not screenshots of Atlas and not council audit evidence. The configuration serves and emits their actual attachment URLs for dev and built stories, so native image/video elements load bytes without an external host.

A council round should record the reviewed story IDs, viewport, rating dimensions, remaining blockers, actual screenshots and before/after explanations in the PR comment. A successful build or browser smoke is not a visual quality rating or an accessibility certification.
