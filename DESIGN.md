---
name: Atlas
description: A gazetteer of a recorded run, with an open index and one white plate.
colors:
  place: "#1d4e89"
  failed: "#b42318"
  failed-ink: "#8f1d14"
  failed-soft: "#fde8e4"
  failed-line: "#f0b4ad"
  unreliable: "#9a3412"
  unreliable-mark: "#9a3412"
  unreliable-soft: "#f6efe8"
  working: "#4f735c"
  working-ink: "#2c4a38"
  working-soft: "#e7efe9"
  working-line: "#c5d5cb"
  ink: "#1c2430"
  ink-strong: "#2c3848"
  ink-quiet: "#3d4d5c"
  faint: "#5c6e7c"
  ground: "#e7eef2"
  ground-raised: "#f4f8fa"
  sheet: "#ffffff"
  line: "#d5e0e7"
  line-strong: "#c5d3dc"
  not-reached: "#cbd5e1"
  unrun: "#e2e8f0"
  badge-neutral: "#eef2f7"
  map-user: "#6b5b86"
  map-user-ink: "#3e3a4a"
  map-user-soft: "#f2f0f4"
  map-user-line: "#d4cedd"
  map-system: "#8d6840"
  map-system-ink: "#5c4630"
  map-system-soft: "#f6f1ea"
  map-system-line: "#e0d0b8"
  map-time: "#3e6d86"
  map-time-ink: "#2f5568"
  map-time-soft: "#eef3f6"
  map-time-line: "#c5d4de"
  map-handoff: "#3e6e68"
  map-handoff-ink: "#2f5550"
  map-handoff-soft: "#eef3f2"
  map-handoff-line: "#c5d6d2"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 2.4vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    letterSpacing: "-0.03em"
  moment:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.35rem, 2.2vw, 1.75rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 700
  body:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  row: "8px"
  sheet: "16px"
  pill: "999px"
  focus: "0.375rem"
spacing:
  row-y: "8px"
  row-x: "10px"
  row-gap: "12px"
  gutter: "16px"
  bar-gap: "20px"
  bar-x: "24px"
  plate-y: "28px"
  plate-x: "32px"
  plate-bottom: "48px"
components:
  button-quiet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.55rem 0.75rem"
    height: "2.5rem"
  button-quiet-hover:
    backgroundColor: "{colors.ground-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.55rem 0.75rem"
    height: "2.5rem"
  search-field:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.row}"
    padding: "0 12px"
    height: "36px"
    width: "min(280px, 36vw)"
  gazetteer-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.row}"
    padding: "8px 10px"
  gazetteer-row-hover:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.row}"
    padding: "8px 10px"
  gazetteer-row-current:
    backgroundColor: "{colors.place}"
    textColor: "{colors.sheet}"
    typography: "{typography.body}"
    rounded: "{rounded.row}"
    padding: "8px 10px"
  plate:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.display}"
    rounded: "{rounded.sheet}"
    padding: "28px 32px 48px"
  moment-step:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "0.55rem 0.75rem"
    height: "2.5rem"
  moment-step-current:
    backgroundColor: "{colors.place}"
    textColor: "{colors.sheet}"
    typography: "{typography.body}"
    padding: "0.55rem 0.75rem"
    height: "2.5rem"
  moment-step-failed:
    textColor: "{colors.failed}"
    typography: "{typography.body}"
    padding: "0.55rem 0.75rem"
    height: "2.5rem"
  moment-step-failed-current:
    backgroundColor: "{colors.failed}"
    textColor: "{colors.sheet}"
    typography: "{typography.body}"
    padding: "0.55rem 0.75rem"
    height: "2.5rem"
  outcome-badge:
    backgroundColor: "{colors.badge-neutral}"
    textColor: "{colors.ink-quiet}"
    rounded: "{rounded.pill}"
    padding: "0.15rem 0.6rem"
  outcome-badge-working:
    backgroundColor: "{colors.working-soft}"
    textColor: "{colors.working-ink}"
    rounded: "{rounded.pill}"
    padding: "0.15rem 0.6rem"
  outcome-badge-failed:
    backgroundColor: "{colors.failed-soft}"
    textColor: "{colors.failed-ink}"
    rounded: "{rounded.pill}"
    padding: "0.15rem 0.6rem"
  outcome-badge-unreliable:
    backgroundColor: "{colors.unreliable-soft}"
    textColor: "{colors.unreliable}"
    rounded: "{rounded.pill}"
    padding: "0.15rem 0.6rem"
---

# Design System: Atlas

## Overview

**Creative North Star: "Gazetteer"**

Atlas is a gazetteer of a recorded run. The index stays open, and one white plate shows the place you opened: its name in large type, its screen, and the events that leave it. Choosing a place, a spec, or a recorded moment replaces only that plate. The index does not move.

A spec of any kind is another index row, the filename and its extension, not a second kind of page. A recorded test is the same plate: the moment large, the steps beside it. The ground is a cool gray-blue. The plate is a white sheet. Place blue is reserved for where you are: the bar, the current row, the current step, links, and the focus ring.

Ink is the reading color. Failure red marks only a failed place, event, or moment. Unreliable is a separate brown and is never redrawn as that red. Type is one self-hosted face, Atkinson Hyperlegible, at 400 and 700. The reading is quiet. The chosen row is the loudest thing on the page.

**Key Characteristics:**

- The index stays open beside one white plate
- Place blue marks where you are
- Status is a word on the right of the row
- Failure and unreliable are different colors
- At 760px the document scrolls, sheet first
- One typeface, two weights

## Colors

Cool gray-blue ground, ink for reading, one blue for where you are, red only for failure, and a separate brown for unreliable.

### Primary

- **Place Blue** (#1d4e89): The header bar, the current index row, the current moment step, links, text selection, and the focus ring. It marks where you are.

### Secondary

- **Failure** (#b42318): The failed status word in the index, a failed event on the plate, a failed moment, and the fill of a failed step that is also current.
- **Failed Ink** (#8f1d14): Failed outcome-badge text, a failed check, and the warning note on the plate.
- **Failed Soft** (#fde8e4): The background of a failed outcome badge and of that warning note.
- **Failed Line** (#f0b4ad): The stroke of a failed edge on the map.

### Tertiary

- **Unreliable** (#9a3412): The unreliable status word in the index, and the text of an unreliable outcome badge. It is not Failure.
- **Unreliable Mark** (#9a3412): The dot, the summary segment, and the map frame for an unreliable result. The same brown as the word, and still not Failure.
- **Unreliable Soft** (#f6efe8): The background of an unreliable outcome badge.
- **Working** (#4f735c): A passed dot, summary segment, and map frame. The index does not color the word “Working.”
- **Working Ink** (#2c4a38): Passed badge text and a passed check mark.
- **Working Soft** (#e7efe9): The background of a passed outcome badge.
- **Working Line** (#c5d5cb): The border of a passed frame on the map.

Kind color is map-only. It distinguishes who caused an edge. It is not plate language.

- **Map User** (#6b5b86), **Map User Ink** (#3e3a4a), **Map User Soft** (#f2f0f4), **Map User Line** (#d4cedd): A user action on the map legend and on map edges.
- **Map System** (#8d6840), **Map System Ink** (#5c4630), **Map System Soft** (#f6f1ea), **Map System Line** (#e0d0b8): A system event on the map legend and on map edges.
- **Map Time** (#3e6d86), **Map Time Ink** (#2f5568), **Map Time Soft** (#eef3f6), **Map Time Line** (#c5d4de): Time passing on the map legend and on map edges.
- **Map Hand-off** (#3e6e68), **Map Hand-off Ink** (#2f5550), **Map Hand-off Soft** (#eef3f2), **Map Hand-off Line** (#c5d6d2): A hand-off on map edges and edge chips. The legend does not give it a swatch.

### Neutral

- **Ink** (#1c2430): Reading text, and the ink in the plate shadow.
- **Ink Strong** (#2c3848): Supporting lines on the plate, such as a place description.
- **Ink Quiet** (#3d4d5c): Status words that are not Broken or Unreliable, index group names, the spec extension, and the destination of an event. The muted text token is this same value.
- **Faint** (#5c6e7c): An unchecked mark, and the dashed dot for not reached.
- **Ground** (#e7eef2): The page background.
- **Ground Raised** (#f4f8fa): The index column, and the hover fill of a quiet control.
- **Sheet** (#ffffff): The plate, the search field, and quiet controls.
- **Line** (#d5e0e7): The index rule, the event rule, and dividers.
- **Line Strong** (#c5d3dc): The border of a quiet control, and the dashed edge of something not yet run.
- **Not Reached** (#cbd5e1): The uncovered segment of a summary bar.
- **Unrun** (#e2e8f0): The hatch of a summary bar when nothing has been run.
- **Badge Neutral** (#eef2f7): A resting outcome badge, and the track of a summary bar.

### Named Rules

**The Place Blue Rule.** Place blue is the header, the current index row, the current moment step, links, and the focus ring. It marks where you are. It is not a tint for decoration.

**The Status Word Rule.** The index states the outcome in words on the right. Only Broken and Unreliable are colored, in Failure and Unreliable. Every other status word is Ink Quiet. The current row is Place Blue with white text, and the status word turns white with it.

**The Map Kind Rule.** User, system, time, and hand-off colors are for the map legend and map edges. On the plate, an event is ink, and a failed event is Failure. The plate does not color an event by kind.

## Typography

**Display Font:** Atkinson Hyperlegible (with ui-sans-serif, system-ui, sans-serif)
**Body Font:** Atkinson Hyperlegible (with ui-sans-serif, system-ui, sans-serif)
**Label/Mono Font:** ui-monospace, SFMono-Regular, Menlo, monospace, for code and file names only

**Character:** One highly legible text face. The large line is tight and tracked slightly closed. Reading text is regular. Emphasis is bold. There is no second display cut.

The face is self-hosted, normal style, `font-display: swap`, weights 400 and 700 only. The files are `atkinson-hyperlegible-latin-400-normal.woff2` and `atkinson-hyperlegible-latin-700-normal.woff2` under the visualizer font folder. Provenance: SIL Open Font License, sourced from the fontsource/Google Fonts Atkinson Hyperlegible 5.2.5 latin files. Not generated.

### Hierarchy

- **Display** (700, clamp(1.75rem, 2.4vw, 2.25rem), line-height 1.05, letter-spacing -0.03em): The plate title. The open place, the open spec, or the open recorded moment.
- **Headline** (700, 1.25rem, letter-spacing -0.03em): The product name in the bar. A map plate’s own name is 1.75rem, with the same tracking and line-height 1.1.
- **Moment** (700, clamp(1.35rem, 2.2vw, 1.75rem), line-height 1.1, letter-spacing -0.03em): The large moment on a recorded test, time and outcome. A failed moment is Failure.
- **Title** (700, 0.9rem): A section on the plate, such as the events that leave the place. Index headings are 0.95rem. Index group names are 0.8rem in Ink Quiet.
- **Body** (400, 1rem, line-height 1.45): Index names, events, and running text. A status aside, only when the badge does not already say it, is 0.85rem in Ink Quiet.
- **Label** (400, 0.8rem): The status word and the spec extension. Broken and Unreliable keep that weight and take their color. Outcome badges are 0.75rem.

### Named Rules

**The One Face Rule.** Atkinson Hyperlegible, self-hosted, at 400 and 700, is the only text face. Monospace is for code and file names, not for titles.

**The Plate Title Rule.** The open place, spec, or moment is set at clamp(1.75rem, 2.4vw, 2.25rem), weight 700, letter-spacing -0.03em, line-height 1.05.

## Layout

The shell is a blue bar over two columns: an index fixed at 300px, and one plate in the remaining width. The bar is at least 64px tall, padded 10px 24px, with a 20px gap. The index lists places, then journeys, then specs. A spec row is the filename and the extension. The plate sits 16px in from the main edge, and its own padding is 28px 32px 48px.

A place plate sets the screen beside the events that leave it, in a split with a 28px gap. That split stacks at 900px. A recorded test uses the same plate: the moment large, the steps beside it, about 1.4 parts to a column of 14rem to 22rem. That split stacks at 800px. Events are a list with 12px of vertical padding and a rule between them, not cards. Map descriptions stop near 62 characters. The index row’s internal gap is 12px.

At 760px the document scrolls. The sheet leads, because the main column moves ahead of the index. The index follows, and its side rule becomes a top rule. From 900px down the plate’s margin and radius are already zero, so the narrow page is a flush sheet and then the list. The plate’s padding does not change. The bar becomes three rows: the name and tools, the run line, then a full-width search.

Motion is short. Opacity and width use 220ms and cubic-bezier(0.2, 0.7, 0.2, 1). When reduced motion is requested, that duration is 0ms and transitions and animations are removed.

### Named Rules

**The Open Index Rule.** The index stays open. Choosing a place, a spec, or a recorded moment replaces only the plate.

**The Narrow Document Rule.** At 760px the document scrolls. The sheet leads. The index follows.

## Elevation & Depth

Depth is one white plate lifted off the ground. The ground shows around it. The same shadow carries the map when the map is the thing on the plate. A second, stronger shadow is only the issues drawer, over a light scrim. Map nodes keep a smaller card shadow. That stays on the map.

### Shadow Vocabulary

- **Sheet** (`box-shadow: 0 1px 2px rgba(28, 36, 48, 0.04), 0 8px 18px rgba(28, 36, 48, 0.05)`): The place plate, the recorded-test plate, and the map plate.
- **Raised** (`box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05)`): The full screen frame inside a plate.
- **Pop** (`box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12)`): The issues drawer. Its scrim is rgba(15, 23, 42, 0.18).
- **Card** (`box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06)`): Map screens, the map legend, and map zoom controls. Map only.

### Named Rules

**The One Sheet Rule.** Depth is one white plate lifted off the ground. Its shadow is 0 1px 2px rgba(28, 36, 48, 0.04), 0 8px 18px rgba(28, 36, 48, 0.05). Places are not a card grid.

## Shapes

The plate is a 16px sheet with no border. Index rows, the search field, and the run picker are 8px, the same size as the small radius token (0.5rem), written as 8px on those controls. The medium radius (0.75rem) is the map legend. The large radius (1rem) is a map screen. Pills (999px) are outcome badges. The focus outline uses a 0.375rem corner. Event lists are not rounded: they are a bottom rule in Line.

Below 900px the plate’s radius goes to zero with its margin, so the flush sheet is square.

### Named Rules

**The Two Radii Rule.** The plate is a 16px sheet. Index rows, the search field, and the run picker are 8px. Pills are for outcome badges, not for the plate or the index.

## Components

Controls are quiet. The chosen row is the strong state. Outcome is a word, or a small badge, never a kind-colored chip on the plate.

### Buttons

- **Shape:** Gently rounded (0.5rem), not a pill.
- **Quiet:** Sheet background, Ink text, a 1px Line Strong border, padding 0.55rem 0.75rem, at least 2.5rem tall, type at 0.875rem. This is Play, Previous moment, Next moment, and the other controls on a recorded test.
- **Hover / Focus:** Hover fills Ground Raised. Focus inside a recorded test is a 2px Place Blue outline, 2px out. The rest of the shell uses a 3px Place Blue outline, 2px out. Disabled controls drop to 55% opacity.
- **Current step:** Not the quiet button. A full-width step with a bottom rule. Current is Place Blue with white text. A failed step is Failure at weight 700. A failed step that is also current is Failure filled with white text.

### Chips

Outcome badges sit by a plate title. They are pills, 0.75rem, weight 700, padding 0.15rem 0.6rem, with a 0.6rem dot.

- **Working:** Working Soft background, Working Ink text, Working dot.
- **Broken:** Failed Soft background, Failed Ink text, Failure dot.
- **Unreliable:** Unreliable Soft background, Unreliable text, Unreliable Mark dot.
- **Not reached:** Ground background, a dashed Line Strong border, a dashed Faint dot.
- **Not run yet and spec only:** Ground background, a solid Line border.
- **Resting:** Badge Neutral background, Ink Quiet text.

Kind chips belong to the map legend and map edges, not to this badge.

### Cards / Containers

- **Corner Style:** The plate is a 16px sheet. It becomes square when it goes flush below 900px.
- **Background:** Sheet, on Ground.
- **Shadow Strategy:** The sheet shadow. See Elevation & Depth.
- **Border:** None on the plate. Events inside it use a Line rule.
- **Internal Padding:** 28px 32px 48px. The plate’s outer margin is 16px until the flush breakpoint.

### Inputs / Fields

- **Style:** The search field is Sheet on the blue bar, Ink text, no border, 8px radius, 36px tall, padding 0 12px, width min(280px, 36vw). The placeholder reads “Find a place or a spec.” The caret is Place Blue.
- **Focus:** A 3px Place Blue outline, 2px out.
- **Run picker:** On the bar, a transparent select, white text, a 1px border at rgba(255, 255, 255, 0.55), 8px radius, 36px tall.
- **Error / Disabled:** A disabled quiet control is at 55% opacity. A failed filter or step uses Failure, not a separate input chrome.

### Navigation

The bar is Place Blue, at least 64px tall. The product name is the headline size, weight 700, letter-spacing -0.03em, in white. The current mode is white and underlined. The other modes and the run line sit a step back, at 0.95rem. Search sits at the end of the bar. At 760px the search takes the full width on its own row.

The index is the navigation. Rows are 8px radius, padding 8px 10px, the name on the left and the status word on the right. A chart name, a place, a journey, and a spec row are weight 400. Hover fills the row with Sheet. The current row is Place Blue with white text, including the status word. Broken is Failure. Unreliable is Unreliable. Every other status word is Ink Quiet.

### Plate

The signature surface. The title is the display size. The badge says the status. An extra sentence appears only when it adds what the badge does not: Unreliable worked only on a retry, Spec only has not been checked, or an event carries the run’s own reason. Under that, the screen and the events that leave the place. The phone sketch does not repeat the description, the checks already written on the plate, or a status the badge already states. Hints that exist only on the sketch stay in the phone. A missing picture still says so when the badge does not. An event is 1rem Ink, with the destination in Ink Quiet, a Line rule underneath, and a Ground wash on hover. A failed event is Failure at weight 700, destination included. A link back to the map is Place Blue.

### Recorded moment

The same plate. The title is still the display size (“Moment 3 / 12: …”). The moment itself is the moment size, weight 700. A failed moment is Failure. The steps are a list beside it. The current step is Place Blue with white text. A failed step is Failure at weight 700. A failed current step is filled with Failure and white text.

## Do's and Don'ts

### Do:

- **Do** keep the index open. Choosing a place, a spec, or a recorded moment replaces only the plate.
- **Do** set the plate title at clamp(1.75rem, 2.4vw, 2.25rem), weight 700, letter-spacing -0.03em, line-height 1.05.
- **Do** put the status word on the right of the index row. Broken is Failure. Unreliable is Unreliable. Any other status word is Ink Quiet. The current row is Place Blue with white text, status word included.
- **Do** draw the plate as a white sheet with a 16px radius and the shadow 0 1px 2px rgba(28, 36, 48, 0.04), 0 8px 18px rgba(28, 36, 48, 0.05).
- **Do** at 760px, scroll the document. The sheet leads. The index follows.
- **Do** show a spec as an index row, filename and extension, and a recorded test as the same plate: the moment large, the steps beside it.

### Don't:

- **Don't** replace the index and the plate with a card grid.
- **Don't** send a spec or a recorded test to a detached page.
- **Don't** paint an unreliable result with Failure red.
- **Don't** set titles in a second display face. Atkinson Hyperlegible at 400 and 700 is the text face. Monospace is for code and file names.
