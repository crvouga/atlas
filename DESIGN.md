---
name: Atlas
description: A calm review workbench. Recordings and pictures first, the numbers that explain them second, color only for outcomes.
colors:
  ground: "#f8f8f9"
  surface: "#ffffff"
  ink: "#18181b"
  ink-quiet: "#63636c"
  line: "#e4e4e7"
  ground-dark: "#09090b"
  surface-dark: "#121214"
  ink-dark: "#ececee"
  line-dark: "#2c2c31"
  link: "#1864ab"
  passed: "#2f9e44"
  failed: "#e03131"
  flaky: "#e8590c"
  running: "#1971c2"
typography:
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
  title: { fontSize: "1.375rem", fontWeight: 600, letterSpacing: "-0.015em" }
  section: { fontSize: "1.0625rem", fontWeight: 600 }
  subsection: { fontSize: "0.9375rem", fontWeight: 600 }
  body: { fontSize: "0.875rem", fontWeight: 400 }
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }
rounded:
  control: "8px"
  card: "12px"
---

# Design System: Atlas

## Overview

Atlas looks like a quiet monitoring dashboard: a soft ground, white cards with hairline borders and a faint shadow,
zinc text in two steps, and a near-black primary action. Color is kept for outcomes (passed, failed, flaky, running)
and links. It has a light and a dark scheme with the same structure; dark inverts the neutrals and keeps the outcomes.
The whole system is the Mantine theme in `packages/visualizer/src/ui/theme.tsx`; [the UI conventions](docs/ui.md) say how
pages are composed from it.

People open Atlas to review what tests recorded: videos, screenshots and the steps beside them. Every screen puts
that evidence first and largest, and the figures and provenance that qualify it after.

## Layout

- **Shell.** A floating header card (the name, the review destinations, the Explore menu, search, color scheme, view
  options, project) over one centered column, at most 1480px wide. A spec or place index is a card beside the page on
  wide screens and a drawer on narrow ones.
- **Page.** A heading (title, one quiet sentence, actions on the right), then cards. A list screen is one card: search
  and sort in its heading row, one compact row of filters, then rows. A detail screen is a header with the name, the
  outcome and one row of metadata, then the recording or picture, then panels of figures.
- **Rows.** An outcome mark, the name, quiet badges, then right-aligned figures. Hover is a faint fill; the selected
  row uses the primary tint.
- **States.** Empty, loading and unavailable are centered in their card: an icon, a short title, a sentence, one action.

## Color

- Neutral surfaces and text come from one zinc family in both schemes.
- **Passed** green, **Failed** red, **Flaky** orange, **Running** blue, unknown or not run gray. An outcome is always a
  mark or a word as well as a color, and unknown evidence never looks passed.
- Links are blue. The primary button is near-black (near-white in the dark scheme); there is one per view.

## Typography

Inter, falling back to the system font. Titles are 1.375rem at 600 with slightly tight tracking, card headings
1.0625rem, body 0.875rem. Supporting text is the dimmed zinc. Monospace is for paths, revisions, code and errors.
