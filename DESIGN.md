---
name: Atlas
description: A neutral workbench. Specs on the left, what was recorded for them on the right, one blue for what is chosen.
colors:
  place: "#0b63ce"
  place-soft: "#e8f1fd"
  ink: "#0f1419"
  ink-strong: "#2f3336"
  ink-quiet: "#536471"
  faint: "#8b98a5"
  ground: "#ffffff"
  ground-raised: "#f7f9f9"
  line: "#eff3f4"
  line-strong: "#cfd9de"
  passed: "#1a7f37"
  passed-ink: "#116329"
  passed-soft: "#e6f4ea"
  failed: "#cf222e"
  failed-ink: "#a40e26"
  failed-soft: "#ffebe9"
  unreliable: "#9a6700"
  unreliable-ink: "#7d4e00"
  unreliable-soft: "#fff8c5"
  not-reached: "#cfd9de"
  unrun: "#eff3f4"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  section:
    fontSize: "1rem"
    fontWeight: 600
  body:
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
  row:
    fontSize: "0.9rem"
    fontWeight: 400
  label:
    fontSize: "0.75rem"
    fontWeight: 600
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
rounded:
  row: "8px"
  list: "12px"
  pill: "999px"
spacing:
  header-height: "3.25rem"
  index-width: "20rem"
  page-x: "40px"
  page-y: "28px"
  row-y: "10px"
  row-x: "14px"
components:
  tab:
    textColor: "{colors.ink-quiet}"
    typography: "{typography.body}"
  tab-current:
    textColor: "{colors.ink}"
    underline: "2px {colors.place}"
  index-row:
    textColor: "{colors.ink}"
    rounded: "{rounded.row}"
    padding: "6px 10px"
  index-row-current:
    backgroundColor: "{colors.place-soft}"
    fontWeight: 600
  index-row-no-results:
    textColor: "{colors.ink-quiet}"
  result-list:
    border: "1px solid {colors.line-strong}"
    rounded: "{rounded.list}"
  button-primary:
    backgroundColor: "{colors.place}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  button-quiet:
    backgroundColor: "{colors.ground}"
    border: "1px solid {colors.line-strong}"
    rounded: "{rounded.pill}"
    height: "2.125rem"
---

# Design System: Atlas

## Overview

Atlas looks like a tool people already know how to use: white surfaces, gray text in three steps,
hairline rules, and one blue. There is no themed palette, no display typeface and no card on a
tinted ground. The interface gets out of the way of two things: the spec, and what was recorded
when it ran.

The header carries the product's name and one tab per kind of spec: Statecharts, then Gherkin,
Quint, DMN, Alloy and OpenSLO when the spec set has files of that kind. Under it, an index of
specs stays open on the left and one page fills the rest.

## Colors

- **Blue** (`place`, #0b63ce) marks what is chosen or can be followed: the current tab's
  underline, the current index row (as a soft fill), links, the primary button, a running suite.
  On the statechart map it also marks what the person does.
- **Ink** (#0f1419) is reading text. **Ink quiet** (#536471) is supporting text: paths, times,
  origins, a spec that has no results. **Faint** (#8b98a5) is for marks and separators only.
- **Passed**, **Failed** and **Unreliable** are outcomes, never decoration. They appear as a small
  mark, a count, a thin meter, and the failing step or error block. A passed count stays quiet
  gray in the index; a failed count is red and bold, so failures are what the eye finds.
- A timing over its allowance uses the unreliable color. It qualifies a result and never fails it.

## Typography

The system font, in a few sizes. A page title is 1.375rem at weight 650. A section (a rule, a
group of traces) is 1rem at 600. Rows are 0.9rem. Labels above groups are 0.75rem at 600 in ink
quiet. Monospace is for paths, revisions, code and error text.

## Layout

A 3.25rem header over two columns: a 20rem index and the page. Both are white; a hairline
separates them. The page is padded 28px 40px and its content stops at 58rem, except a recording,
which uses the full width.

- **Index.** A row of four filters (All, Results, Failing, None, each with its count), then specs
  grouped by folder. Every row has an outcome mark, the spec's title on up to two lines, and what
  was recorded ("12 passed", "3 failed"). A spec with no results is quieter and says nothing on
  the right. A folder heading carries the total for its specs.
- **Spec page.** Path, title, a thin meter, the counts, and where the newest result came from.
  Then each check as a row in a bordered list: mark, name, duration and age. A failed row shows
  its first error line without being opened. An opened row shows the recorded steps with each
  outcome, the error under the step that failed, the timing, a button to open the recording, and
  every other run of that check.
- **Recording.** A way back, the check's name, its outcome and origin. Steps on the left, the
  chosen moment on the right, with a transport row above it. Timing is a second tab.
- **Sources.** A sheet from the right: backends, branches and runs, each with a checkbox.
- **Test explorer.** The home of a project without statecharts. The project's title over two tabs, Tests and Runs.
  Tests: an insight strip (tests by outcome with a meter, flaky, average and p95 duration, each environment with its
  tally, runs and when the last result arrived; each one filters when clicked), then one toolbar row (a pill search
  box that filters as you type, Group by, Sort), the status filter with counts, environment chips, producer and domain
  selects, and the grouped list: one bordered group per spec (under quiet domain labels), its header a chevron, the
  title, the path in mono, a meter and the tally; rows with mark, title, one chip per environment, badges, then average,
  pass rate, runs and age in aligned columns. Large reports open with groups closed and show fifty rows a group at a
  time. Opening a test puts its detail beside the list (above it when narrow); everything is in the address. Runs: a
  table of CI runs; opening one lists its results by spec. The index lists domains and their specs with tallies.

At 760px the document scrolls: header (tabs on their own row), page, then the index.

## Components

- **Outcome mark.** A 14 to 16px circle: green with a check, red with a cross, a blue turning arc
  for running, a gray ring for not run, a dashed gray ring for no results. It always has a text
  alternative.
- **Tally.** The short count on an index row. Only a failure is colored.
- **Meter.** A 6px rounded bar split by outcome. Scenarios without a result show as gray.
- **Insight tile.** A white tile with a hairline border and 12px corners: a quiet label, one number at 1.5rem/650, and
  a quiet note. A tile that filters is a button; when its filter is on, its border is blue and its fill blue-soft.
- **Environment chip.** An environment's name after a 10px outcome mark, in outcome ink (red and bold when it failed
  there, quiet green when it passed, gray otherwise). A test checked on several environments has one chip each.
- **Trend.** A 2px gray line of durations over time, a red dot on each failed result, the newest point marked; under
  it a strip of 8px cells, one per recorded result, colored by outcome, oldest on the left. Hover gives the details.
- **Origin.** Backend, branch, short revision, "with local changes" when the checkout was
  modified, and how long ago, separated by middle dots in ink quiet.
- **Buttons.** Pills. The one primary action on a result (Open recording) is blue with white
  text. Everything else is a quiet outlined pill or a text link.

## Do

- Keep the index open; choosing a spec replaces only the page.
- State outcomes in words next to their mark.
- Show where a result came from wherever a result is shown.
- Leave "no results" visibly different from "passed".

## Don't

- Don't add a second accent color or tint a surface to decorate it.
- Don't put a page on a card over a colored ground.
- Don't paint a slow timing or an unreliable result red.
- Don't give a recording a large display title; the check's own name is the title.
