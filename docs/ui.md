# Viewer UI conventions

Read this before changing the Atlas viewer or settings UI. React and Mantine are the design system.
Use the installed version in `package.json` (currently 9.7.3) and its [official documentation](https://mantine.dev/).
Look up unfamiliar interactions before writing them; component props and compound components usually solve them.

## One setup

- `packages/visualizer/src/ui/theme.tsx` owns the only theme and `AtlasThemeProvider`.
- Both `src/main.tsx` (reports) and `src/admin/main.tsx` (settings) use that provider and Mantine's styles.
- Keep Atlas's blue navigation, neutral surfaces, system typography, and light color scheme. Outcome colors
  come from `statusColor`: green passed, red failed, orange flaky, blue running, gray unknown/unrun.
  Always accompany color with text or a named status mark. Unknown evidence must never look passed.
- The theme darkens the existing Mantine outcome scales and muted text to meet small-text contrast requirements. Use the default sizes, radii, font sizes, shadows and variants. Defaults belong in the theme, not in features.
  The spacing vocabulary is Mantine's `xs`, `sm`, `md`, `lg`, `xl`.

## Compose directly

Use `AppShell` for persistent navigation, `Container size="xl"` for report pages (`md` for settings),
`Stack` for vertical flow, `Group` for horizontal flow, and `SimpleGrid` for responsive metrics/forms.
Page headers contain a `Title order={1}`, descriptive `Text c="dimmed"`, then the page's controls.
Use `Title order={2}` for sections and `order={3}` for subsections; do not choose heading sizes per page.

Use Mantine components directly. Do not add wrappers for ordinary buttons, inputs, cards, menus, or dialogs.
Shared product compositions include `SpecHeader`, `ResultRow`, `StatusMark`, `Origin`, `Stage`, and `TestDetail`:
they preserve evidence semantics, provenance, URL selection, or playback behavior.

- Primary action: `Button variant="filled"`. Secondary: default `Button` (light). Quiet: `variant="subtle"`.
  Destructive action: `color="red"`. Icon-only action: `ActionIcon` with an `aria-label`, usually a `Tooltip`.
- Inputs: Mantine inputs with a visible `label`, `description` when needed, and `error` for validation.
  Use `NativeSelect` for small native option lists; keep form values controlled. Settings validation and
  authorization stay on the server; its optional JSON editor also validates with the shared schema.
- Use `Menu` for navigation menus, `Popover` for view options, `Drawer` for sources/test details,
  `Modal` for modal content, and `Spotlight` for search. Let Mantine own dismissal, focus and keyboard behavior.
  When an action opens a drawer from a popover, close and disable the parent popover during the drawer's lifetime;
  return focus to its persistent trigger. Do not fix overlapping focus traps by raising z-index values.
- Use `Tabs` for view modes and `Accordion` for disclosure. URL-backed selections stay in the existing router.
- Render typed router links with Mantine's `renderRoot={props => <Link {...props} ... />}`.
  This keeps route/search type inference and native navigation semantics.
- Use `Table` in `Table.ScrollContainer` for wide evidence, with column headers. Long lists must retain
  `Bounded`/show-more controls. Do not fetch unopened results' recordings eagerly.
- Loading: named `Loader`/`Skeleton` or explicit text with `role="status"`. Error: `Alert color="red"` and
  a retry when possible. Empty: descriptive `Text` and a relevant action. Use built-in loading/disabled states.
- Waiting is bounded. A focused page (a spec, a recording) loads what its link names on its own and never waits for
  the whole catalog. `loadingPolicy.stallMs` in `evidence/load-state.tsx` is how long a read may take before the page
  names what is affected, keeps the rest usable and offers `Try again` and a way back that keeps the selected scope.
  A missing spec or layer is an explicit unavailable state with its path, never an endless `Loading…`. Layers that
  fail to read are counted (`EvidenceIncomplete`) and the rest stays usable. Search disclosed as incomplete (still
  reading, or specs it could not read) never reports "no match" as final. `tests/resilient-navigation.test.tsx`
  holds the request budgets for a large catalog.
- Spec overview links use a centered `Group`: status, flexible title/folder, then outcome and time. Keep gaps
  explicit with theme spacing; stack metadata on narrow screens instead of crowding the title.

## Executable spec source

`SourceText` is the common source reader for Gherkin, Quint, DMN/XML, Alloy, OpenSLO/YAML and statechart
XML/JSON/YAML. Show it expanded near the top of document pages; preserve indentation, comments and the
complete file. Do not replace source with a trimmed snapshot. Mantine `CodeHighlightTabs` supplies file
labels, line numbers, horizontal scrolling and copying. The full file is expanded by default. Native
collapse/expand controls can limit long files to 70vh; the Recorded results action jumps to the existing
results section and moves keyboard focus there. Keep scenario selection,
filters, traces, decision tables and model declaration links working alongside the source.

`ui/highlight.ts` owns the one lazy Shiki adapter. It imports only the supported grammars and caches the
engine. The shared source composition installs that adapter when source is displayed; the Mantine theme
and component defaults still live only in `ui/theme.tsx`. Quint/Alloy grammar sources and licenses live in
[`ui/grammars/README.md`](../packages/visualizer/src/ui/grammars/README.md). Unknown formats remain plain
text, and parse failures must leave the source visible. Syntax highlighting never means a spec passed.

## Behaviors: Read, Watch, Inspect

A Gherkin page reads as behaviors: each scenario, or each example row of an outline (never the outline template as an
extra), is one behavior in one coverage state (`evidence/behavior.ts`). Opening a behavior shows Mantine `Tabs`:
**Read** (the steps with the example's values filled in), **Watch** (what is expected next to the matched recording,
its status and provenance) and **Inspect** (the existing check detail: runs, environments, attempts, files). A behavior
with a playable recording opens on Watch, one in a run in progress on Inspect, otherwise on Read. The video is read only
when Watch is on screen.

- States stay distinct and none but `demonstrated` is a pass with proof: recording missing, recording of an older spec
  revision, no recording, API only, failed, running, skipped, parked (tagged `@parked`, `@wip`, `@pending`) and not executed.
  Counts are in the Coverage section above the source; an empty state is left out except `demonstrated`.
- The promise's revision (the spec's fingerprint now) and the evidence's revision (the fingerprint the layer recorded)
  are shown separately. A known difference demotes a recording to "Recording is older" with an alert; a missing
  fingerprint is "not recorded", never a match.
- Whether the evidence applies is a separate reading (`evidence/applicability.ts`), shown on Watch and Inspect and as a
  row badge when it is stale (or unknown against a named release): `applies`, `stale` (an earlier promise or another
  build), `unknown`, or `none`. It never changes a status or a coverage state. Age is when the checks ran
  (`recordedAtMs`), never when the layer was uploaded or annotated. A release is named in the address (`release` build,
  `releaseSha`, `releasePlatform`); a branch name or a passing run never supplies one. Another platform, a missing
  build or commit, or a checkout with local changes (`freshness`) is `unknown`, never an exact match. Producers say
  what they know with labels: `build`, `platform`, and `applies-to` with `applies-to-by` (the policy that asserts the
  evidence still holds for those builds; without it the assertion is refused). The "Stale or unverified" filter
  (`evidence=stale`) lists every behavior whose evidence does not apply, including those with none.
- A recording is always labelled illustrative: it shows one run and does not approve a behavior for production.
  `demo`/`representative` tags only add a "Representative demo" label.
- The spec index searches titles, paths and declared domains, and can group by the domain from spec metadata (specs with
  none are listed under "No domain declared"; the Tests view reports domain problems).

## UI catalog

`/catalog` (`catalog/`) is the viewer's inventory of captured UI states ([the guide](ui-catalog.md)). It is computed in the page from
the layers the viewer already holds (`catalog/provider.tsx`, only while the page is open), so states appear as results stream in and
it works without a server. Cards are Mantine `Card`s in a responsive `SimpleGrid`; the filters live in the shell's navigation column
(`UiCatalogFilters`) and the open state in a `Drawer`, and both are the address (`catalog/search.ts`).

- Only `captured` is called captured. Every other coverage (`Capture failed`, `Capturing`, `Skipped`, `Not captured yet`) has its own
  words and mark, and a cell without a picture says so in words instead of showing an empty frame. Never show a plan as a result.
- A backend that is not available, a notice, and layers that could not be read are shown above the grid; the catalog says it may be
  incomplete. Waiting follows the loading policy below, and layers still arriving are counted.
- Pictures are `loading="lazy"` and only the cards on screen are fetched. The grid is bounded with *Show more*.
- The open state shows every profile side by side with the layer, backend, producer, shard, commit and time of each picture.

## Reliability

An open test shows its reliability (`explorer/Reliability.tsx`, worked out by `reports/reliability` from the history the page
already holds). Never show a bare percentage: it always comes with the number of independent executions it rests on, the
"Insufficient evidence" badge below the minimum (one pass is not established reliability), the scope (environment,
producer, branch, parameters, time window, spec revision) and the warning notes (pooled environments, failed cases
published again, bounded history). First-try success is over executions that recorded their tries only; a result that
did not run or did not finish is excluded by name and never counted as a pass. The scope and the open executions table
are in the address (`rel*`), so a link reproduces the figure and the executions behind it.

## Product latency

A test's duration and its product latency are different things and the viewer never mixes them (`explorer/ProductLatency.tsx`,
`@crvouga/atlas/reports/latency`). Statistics and the trend are labelled test execution time. Product latency is read only from
measurements named `product-latency`; it shows boundaries, group (device, build, day), samples, budget and breaches, and a
baseline comparison that lists changes of instrumentation or conditions. Percentiles and product claims that the evidence
cannot support are shown as `Withheld` with the reason, a partial interval is badged, timeouts count as samples and breaches,
and a test with no latency says it is unknown, not fast.

## Outcome summary

A test or behavior detail states what the **selected** result says apart from what the other current sources say
(`evidence/outcome.ts`, `outcome-summary.tsx`). The heading is the selected source's outcome first ("Selected result
passed; another scoped source failed"), never the combined status; the combined status is labelled as the worst current
result. Each other current source is one click away, and sources that share an environment are told apart by status,
time, revision and their place among them. A failure leads with whether the behavior was reached (decided only by the
recorded step `kind`: a `hook`, `setup`, `fixture`, `before*` or `given` step failing is "Behavior not verified: setup
failed", `when`, `then`, `assertion` or `expect` is "Expectation not met", anything else is unknown), then the expected
and observed values and the closest step and video, then the original output. The cause (product, test harness,
environment) is unknown unless the producer declared it under the `atlas.failure` extension; it is never read from error
wording. Records of one source whose outcome changed are listed oldest first, and a later pass is never called a fix.
In the explorer the chosen source is the `source` search parameter (a layer id; unlike `layer` it does not pin a run).

## Watch a filtered set as a playlist

The Artifacts tab and an opened run have a **Watch these N results** button. It opens a Mantine `Modal` (`explorer/playlist.tsx`)
over the same filtered set the page lists, in the same order (`explorer/playlist-entries.ts` builds the entries).

- Every result of the set is an entry. A failed one is never dropped, and one with no recording, an API-only one or one
  whose file is missing says so in words (`Recording not available`, `API only`, `No recording`); none of these is shown as
  demonstrated. A set longer than the page's limit says it is only the newest results.
- Only the selected clip is read: the list is the metadata the catalog already sent, the selected result's evidence is read
  when it is selected, and the one `<video>` uses `preload="metadata"`. Opening the playlist downloads no recordings in bulk.
  Posters and durations of unselected entries are not shown for that reason.
- One player: selecting another clip replaces it, and the position of the clip left is kept for the session so returning
  resumes there. Previous/next and advancing on end move over the watchable entries; a result with nothing to play is
  selected from the list to read why.
- A clip that fails to load, or whose autoplay the browser blocked, stays in the list and offers Retry, Play and Next clip.
  Speed, "Play the next clip when one ends" and "Repeat" are labelled controls. Captions (`text/vtt` attachments) are offered
  as `<track>` elements.
- The scenario (title, recorded steps, why it failed) sits beside the player with the recording's scope badges
  (paced, scripted, silent, synthetic) and the sentence that the length is the recording's, not production latency. Developer
  details opens the test pinned to that run's record and closes the playlist.

## Review collections

The **Collections** tab (`explorer/collections.tsx`, `?tab=collections&collection=<id>&rev=<n>`) lists and opens review
collections, and the Artifacts tab's **Freeze as review collection** button (a Mantine `Modal`) freezes the filtered set as it is
listed. A collection is curation, not a test run (`@crvouga/atlas/reports/review-collection`, `docs/server.md#review-collections`).

- The page never shows one status for the whole collection. Every entry shows the status it was **recorded** with ("Failed as
  recorded"), its time, run, commit, layer and tries in order, so entries from several runs are never read as one execution; the
  note at the top says how many runs they come from. The order is the curator's: a failed or incomplete take stays beside a
  later passing replay and is never collapsed to the newest pass.
- A revision is frozen. Opening an older revision says a newer one exists; a change is a new revision, never an edit.
- An entry whose source is gone (`unavailable`) or cannot be checked (`unverified`) stays in its place with the reason and
  what it was when frozen, and its recording says it is not available. Nothing is removed or replaced.
- Notes, time-coded gap notes (`m:ss`, or seconds; a mistake is said, not guessed) and the **Reviewed** switch are separate
  records with who and when. They change no outcome and the page says a mark is not an approval. Writing needs a token that
  may publish, held only in this tab; a read-only visitor is refused with the server's reason and can still Read, Watch and
  Inspect. **Download manifest** is the portable index; the share link adds no access.

## Search inside recordings

The Artifacts tab has a **Search inside recordings** section (`explorer/RecordingTextSearch.tsx`; words in `inside`). It
applies the shared matcher (`find/`) to the transcript, caption and screen-text segments producers attached
(`explorer/recording-text.ts`; format in [rich evidence](rich-evidence.md#words-in-recordings)), so phrases, close
spellings, meaning and typed filters (`status:failed`) behave as in every search box.

- Nothing is read until words are typed; then each listed result's evidence and text files are read a few at a time
  through the report API (the same access rules as playing the recording). The video is never read. A file the viewer
  may not read is not indexed and is reported as not searched, never counted or quoted. There is no stored index.
- A result shows the indexed words exactly as indexed, why it matched (exact, close spelling, meaning), the source (spoken,
  on screen, caption), generated text with its generator, confidence and a warning, the time range, the owning result and
  retry attempt, and the result's own outcome. A match is never described as the behavior passing.
- "No match" is only said about searched recordings. Recordings with no text (`Not indexed`), silent or unsupported ones
  and unreadable text (`Failed`) are counted separately and listed under **Recordings that were not searched**.
- A result opens the playlist on that result, that attempt's video and, when its time is usable and reachable, that time.
  With no usable time the recording opens at its start and a note says seeking is unavailable.

## Icons and notation marks

Use named imports from `@tabler/icons-react` for all UI glyphs. The icon package supplies SVG paths;
Mantine still supplies every control and interaction. Use size 16 for compact inline glyphs and size 20
for standalone actions, with `aria-hidden="true"` when the adjacent text or control names the action.
Do not draw SVG icons, use Unicode glyphs as buttons, or add another icon library. Mantine's built-in
icons are fine. Keep textual keyboard shortcuts and path separators as text.

`SpecLogo` maps every `SpecKind` to a bundled SVG mark, used in navigation and page headers. Keep the
visible notation label; marks are decorative. Sources, licenses and the DMN notation-mark choice are in
[`spec-logos/README.md`](../packages/visualizer/src/components/spec-logos/README.md). Add a sourced SVG
and update this mapping when adding a format. Brand artwork preserves upstream colors independently of
Atlas's theme. SVG data plots and statechart arrow markers are geometry, not handcrafted UI icons.

## Search

All search boxes (finder, test list, Runs tab, an opened run) use `src/find/query.ts` for the query language and
`src/find/rank.ts` for matching; do not add a second matcher or filter on `includes`. Build documents from
`src/find/behaviors.ts` so a behavior has the same fields and facets everywhere. Match first, then count, filter and sort
the whole set, then page. Show filters typed in the box as removable chips, show what was not understood
(`SearchNotes`), show why a result matched and mark exact ones, and say when matching is words only (no embedder, or
a failed one). A bounded list says it is bounded and offers all results. Selection follows result identity, never a
position, when results change. The query, filters and sort stay in the address.

## Accessibility and responsive behavior

The shell collapses its index below Mantine's `md` breakpoint; its named Burger toggles mobile navigation.
Navigation closes after choosing a destination. Use responsive props and the theme's breakpoints; no custom
media-query system. Let controls wrap, use one form column on mobile, and keep dialogs inside the viewport.
Wide tables scroll inside their container. Native video/audio controls remain available.

Preserve labels, status announcements, keyboard shortcuts, selected states, meaningful headings and focus
restoration. Mantine respects reduced motion through the central theme. Avoid nested interactive controls.
Never rely on color alone, remove focus outlines, or hide an important action only to make a layout fit.

## Styling policy and exceptions

Default custom CSS: zero. First try Mantine defaults, central defaults, variants, props, layout components,
and theme tokens. Do not add Tailwind, Radix, another design system, CSS modules, custom token scales,
inline styles, or `styles` objects for ordinary UI. Document a concrete functional limitation here before
adding an exception; `scripts/ui-architecture.test.ts` checks these boundaries in the normal test suite.

The central List Styles API adjustment makes item labels fill the available width, including Mantine's column wrappers;
List has no full-width label prop. This keeps all report rows usable without feature styles.

The narrowly scoped exceptions are:

1. **Interactive statechart graph:** React Flow and ELK provide graph layout, pan/zoom, edges and minimap,
   which Mantine does not supply. Graph nodes and controls use Mantine. `src/map/map.module.css` only covers
   SVG strokes, graph handles, edge-label geometry and graph selection/dimming. The two edge-label transforms
   and node dimensions are computed by the layout engine, not visual design tokens.
2. **Captured evidence:** native video/audio and sandboxed iframes render recorded bytes. HTML snapshots use
   the existing isolated shadow tree and intrinsic phone coordinates; their captured styles never style Atlas.
   Recorded click markers and intrinsic image/video dimensions are evidence coordinates, not UI spacing.
3. **Public compatibility APIs:** `solid-js` and `@tanstack/solid-query` remain dependencies of existing
   report-library entry points. They render no Atlas screen. Do not import them into the viewer or add Solid UI.
4. **Syntax rendering:** Shiki is the syntax engine behind Mantine's official code-highlight adapter,
   not a second component system. Its token styles and escaped HTML are generated by the highlighter.
   The supported Shiki line transformer supplies the existing Quint `line-N` navigation anchors.
   No feature CSS, handcrafted code controls or custom syntax color theme is introduced.
5. **Consumer test fixture:** `examples/todo/app` is the app Atlas tests and records, not an Atlas screen.
   Its intentionally separate implementation and selectors are test inputs; the overhaul does not restyle it.

## Inventory and migration boundary

| Area | Screens/interactions | Mantine composition |
| --- | --- | --- |
| Shared shell | Project switching, spec navigation, run selection, connection status, diagnostics, mobile index | AppShell, Burger, NavLink, Menu, Popover, NativeSelect, Drawer |
| UI catalog | Captured UI states per profile as cards with coverage badges, filters in the index column, surface coverage, an open state with its profiles side by side and where each picture came from, manifest download | AppShell navbar, SimpleGrid, Card, Image, MultiSelect, TextInput, Drawer, Accordion, Table, Badge, Alert |
| Project home | Tests/runs/artifacts tabs, a run's Artifacts (files of its layers, shared recordings, direct links), Watch playlist of a filtered set, metrics, search, status/environment/domain/artifact-tag filters, run and artifact facets with saved views, grouping, sorting, show more | Container, Tabs, SimpleGrid, Paper, TextInput, MultiSelect, Popover, Button, Accordion, Modal, Grid, Switch |
| Test detail | Current outcomes, statistics, duration graph, product latency with budgets and baselines, history, artifacts, recording; the `layer` address parameter pins it to one run's result, labelled "This run" against "Latest combined evidence" | Drawer, Table, Badge, Alert, Stage |
| Specs | All six existing kinds, overview/index with title search and folder or declared-domain grouping, Gherkin rules/scenarios/examples with a coverage summary and Read / Watch / Inspect per behavior, Quint declarations/traces, DMN tables, source text | SpecHeader, Accordion, Tabs, Table, CodeHighlightTabs, ResultRow |
| Statecharts | Graph, screen/event/journey details, developer metadata, chart test results | Mantine cards/navigation and product compositions; graph exception above |
| Evidence | Steps, retries, annotations, facts, unknown extensions, safe downloads and previews | List, Badge, Accordion, Code, Image, native media |
| Recordings | Pictures/video/timeline, actor selection, moments, failure jumps, timing, model-state differences | Tabs, Slider, Button, ScrollArea, Table, Progress |
| Search/help | Ranked, filterable and semantic search across behaviors, runs and results; complete results; shortcut help, recording shortcuts | Spotlight, TextInput, NativeSelect, Button chips, Alert, Modal, Kbd |
| Administration | Token access, S3 storage notice, garbage collection policy (saved in S3), live timeouts, report rules, limits, raw JSON, conflicts | Same provider/theme, Fieldset, Mantine inputs, Accordion, Alert |

The hash routes (`/`, `/chart/$chartId`, `/specs/$kind`), query contracts, project scoping, streaming,
report APIs and data adapters remain the migration boundary. `/admin` still serves an independent document:
it lazily bundles the shared React settings entry once, so API-only servers do not need a prebuilt viewer.

## Checks

Run `bunx tsc --noEmit -p packages/visualizer`,
`bun test --cwd packages/visualizer --preload ./tests/preload.ts tests`,
`bun test scripts/ui-architecture.test.ts`, `bun run client:build`, then `bun run docs` and `bun run docs:check`.
Before pushing, run the full repository checks from `AGENTS.md`, including package build and consumer smoke
when dependencies change. DOM tests use the same `AtlasThemeProvider` with Mantine's supported `env="test"`.
Use semantic/product selectors, not Mantine's private class names. Inspect real desktop and narrow layouts,
menus, dialogs, complex evidence and settings in the browser; do not describe a DOM test as a visual audit.
