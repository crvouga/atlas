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
| Project home | Tests/runs tabs, a run's Artifacts (files of its layers, shared recordings, direct links), metrics, search, status/environment/domain filters, grouping, sorting, show more | Container, Tabs, SimpleGrid, Paper, TextInput, Button, Accordion |
| Test detail | Current outcomes, statistics, duration graph, history, artifacts, recording; the `layer` address parameter pins it to one run's result, labelled "This run" against "Latest combined evidence" | Drawer, Table, Badge, Alert, Stage |
| Specs | All six existing kinds, overview/index, Gherkin rules/scenarios/examples, Quint declarations/traces, DMN tables, source text | SpecHeader, Accordion, Table, CodeHighlightTabs, ResultRow |
| Statecharts | Graph, screen/event/journey details, developer metadata, chart test results | Mantine cards/navigation and product compositions; graph exception above |
| Evidence | Steps, retries, annotations, facts, unknown extensions, safe downloads and previews | List, Badge, Accordion, Code, Image, native media |
| Recordings | Pictures/video/timeline, actor selection, moments, failure jumps, timing, model-state differences | Tabs, Slider, Button, ScrollArea, Table, Progress |
| Search/help | Ranked and semantic search, shortcut help, recording shortcuts | Spotlight, Modal, Kbd |
| Administration | Token access, storage backends/write destination, live timeouts, report rules, limits, raw JSON, conflicts | Same provider/theme, Fieldset, Mantine inputs, Accordion, Alert |

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
