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

`inventory.ts` lists 80 finite review branches. `inventory.test.ts` fails if a story or route changes without updating that inventory. This is an inventory of distinct product branches, rather than a claim to enumerate every possible data value or combination of filters.

| Area | Covered branches |
| --- | --- |
| Reports | Tests, Runs, Artifacts, Compare, Catalog health, Collections; selected/failed test detail, run detail, failed/stale filters, no search matches |
| Navigation | Statechart overview, selected chart/screen/event, all five spec indexes and documents, Sources drawer, Search and commands, unknown route and missing chart/spec |
| Behaviors | Index/no matches, selected Read/Watch/Inspect, expanded workspace; demonstrated, older recording, missing recording, no recording, API only, failed, running, skipped, parked and not executed |
| UI catalog | Populated grid, comparison, focused gallery, declared facts, no matches; captured pictures in two profiles, failed capture, capturing and planned but missing capture |
| Critiques | Ranked opinions, selected findings, critic agreement, rate-limited critic, earlier picture and no opinions |
| Resilience | Empty tests/runs/artifacts/behaviors/catalog; pending tests/catalog/spec; unavailable reports/behaviors/catalog/spec; incomplete evidence and bounded stalled spec |
| Administration | Access, loaded settings, rejected credentials, revision conflict, mobile access |
| Responsive | Named mobile test explorer, feature, catalog and settings; every other story can use the same viewport toolbar |

Interactive controls within these screens remain real: use them to examine nested disclosure, gallery zoom, keyboard search, environment and release filters, compare selection, settings forms, retries and playback. Arbitrary uploads, future evidence extensions, every combination of filters, all browser/media decoding failures and real authentication/storage/network integration are outside this finite fixture set; existing DOM, protocol and integration suites cover their respective contracts. Add an explicit story whenever a new product branch is introduced.

## Fixtures and isolation

The Storybook configuration builds the existing coffee example layers in memory and adds clearly named Storybook catalog and behavior fixtures. It serializes immutable ObjectStore contents as base64 into a virtual module; the browser reconstructs them and uses the actual reports API implementation to answer only fixture requests. It never contacts or writes a real Atlas server. Each story has a fresh router and query cache; `beforeEach` installs a matching transport and returns cleanup. Settings requests are simulated locally, including a real 409 response for conflict handling.

The ten behavior states come from a real Gherkin feature, published checks, revision fingerprints and an existing example video. Critic scores and findings are explicitly illustrative fixture opinions, not council ratings. State selection keys are derived through production catalog/behavior readers. Screenshots and video are existing illustrative coffee-example assets, not screenshots of Atlas and not council audit evidence. The configuration serves and emits their actual attachment URLs for dev and built stories, so native image/video elements load bytes without an external host.

A council round should record the reviewed story IDs, viewport, rating dimensions, remaining blockers, actual screenshots and before/after explanations in the PR comment. A successful build or browser smoke is not a visual quality rating or an accessibility certification.
