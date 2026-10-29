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
- A recording is always labelled illustrative: it shows one run and does not approve a behavior for production.
  `demo`/`representative` tags only add a "Representative demo" label.
- The spec index searches titles, paths and declared domains, and can group by the domain from spec metadata (specs with
  none are listed under "No domain declared"; the Tests view reports domain problems).

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
| Project home | Tests/runs/artifacts tabs, a run's Artifacts (files of its layers, shared recordings, direct links), metrics, search, status/environment/domain/artifact-tag filters, run and artifact facets with saved views, grouping, sorting, show more | Container, Tabs, SimpleGrid, Paper, TextInput, MultiSelect, Popover, Button, Accordion |
| Test detail | Current outcomes, statistics, duration graph, history, artifacts, recording; the `layer` address parameter pins it to one run's result, labelled "This run" against "Latest combined evidence" | Drawer, Table, Badge, Alert, Stage |
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
