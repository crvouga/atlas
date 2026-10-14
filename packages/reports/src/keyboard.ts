/**
 * @module Keyboard shortcuts of the reports viewer
 *
 * One `keydown` handler for the viewer: the command palette (Cmd/Ctrl+K), help (`?`), Escape, and, on a test page,
 * scrubbing frames, jumping between steps and failures, moving to the neighbouring test and toggling the view. It is
 * framework-free: everything it changes goes through the {@link KeyNavHandlers} the host supplies, and it ignores
 * keys typed into inputs, buttons and links.
 */
import type { HtmlReportTest } from './recording-bundle';

import { catalogParams } from './catalog';
import type { FlatFrame } from './frames';
import {
  actorIds,
  frameHasUi,
  neighborFailure,
  neighborStepFrame,
  selectedFrame,
  testFrames,
} from './frames';
import type { Route } from './hash';
import { showAside, showPress, viewMode, zoomMode } from './hash';
import type { ReportData } from './types';

/** What {@link onReportKeyDown} may ask the host to do, and what it reads from it. */
export type KeyNavHandlers = {
  /** Opens or closes the shortcut help. */
  toggleHelp: () => void;
  /** Whether the help is open. */
  showHelp: () => boolean;
  /** Whether the command palette is open; while it is, no other shortcut acts. */
  showPalette: () => boolean;
  togglePalette: () => void;
  /** Stops frame playback. */
  stopPlay: () => void;
  /** Goes to a route (writes the URL hash). */
  navigate: (route: Route) => void;
  /** Selects a frame, optionally of a given client (`node`). */
  goFrame: (frame: FlatFrame | null, node?: string) => void;
  togglePlay: () => void;
  /** Sets a URL param on the current route; the empty string removes it. */
  setParam: (key: string, value: string) => void;
  /** The current route. */
  route: () => Route;
};

function neighborTest(
  data: ReportData,
  testId: string,
  delta: number
): string | null {
  const i = data.tests.findIndex((t) => t.report.meta.testId === testId);
  const n = i + delta;
  if (i < 0 || n < 0 || n >= data.tests.length) return null;
  return data.tests[n]?.report.meta.testId ?? null;
}

function scrubKeys(
  e: KeyboardEvent,
  frames: FlatFrame[],
  sel: FlatFrame | null,
  h: KeyNavHandlers
): void {
  const idx = sel ? sel.index : -1;
  if (e.key === 'ArrowLeft' && idx > 0) h.goFrame(frames[idx - 1] ?? null);
  if (e.key === 'ArrowRight' && idx >= 0 && idx < frames.length - 1) {
    h.goFrame(frames[idx + 1] ?? null);
  }
  if (e.key === 'Home' && frames.length) h.goFrame(frames[0] ?? null);
  if (e.key === 'End' && frames.length) {
    h.goFrame(frames[frames.length - 1] ?? null);
  }
  if (e.key === ' ') {
    e.preventDefault();
    h.togglePlay();
  }
}

/** ↑/↓ jump between steps, N / Shift+N between failures. */
function jumpKeys(
  e: KeyboardEvent,
  frames: FlatFrame[],
  sel: FlatFrame | null,
  h: KeyNavHandlers
): void {
  const idx = sel ? sel.index : -1;
  let target: FlatFrame | null = null;
  if (e.key === 'ArrowDown') target = neighborStepFrame(frames, idx, 1);
  else if (e.key === 'ArrowUp') target = neighborStepFrame(frames, idx, -1);
  else if (e.key === 'n') target = neighborFailure(frames, idx, 1);
  else if (e.key === 'N') target = neighborFailure(frames, idx, -1);
  else return;
  e.preventDefault();
  if (target) h.goFrame(target);
}

function neighborKeys(
  e: KeyboardEvent,
  data: ReportData,
  testId: string,
  h: KeyNavHandlers
): void {
  const params = catalogParams(h.route().params);
  if (e.key === '[') {
    const id = neighborTest(data, testId, -1);
    if (id) h.navigate({ view: 'test', testId: id, params });
  }
  if (e.key === ']') {
    const id = neighborTest(data, testId, 1);
    if (id) h.navigate({ view: 'test', testId: id, params });
  }
}

function uiToggleKeys(
  e: KeyboardEvent,
  r: Route & { view: 'test' },
  h: KeyNavHandlers,
  ui: boolean
): void {
  if (!ui) return;
  if (e.key === 'm' || e.key === 'M') {
    h.setParam('view', viewMode(r) === 'multi' ? 'single' : '');
  }
  if (e.key === 'a' || e.key === 'A') {
    h.setParam('aside', showAside(r) ? '0' : '');
  }
  if (e.key === 'p' || e.key === 'P') {
    h.setParam('press', showPress(r) ? '0' : '');
  }
  if (e.key === 'f' || e.key === 'F') {
    const order = ['fit', '50', '75', '100'];
    const cur = zoomMode(r);
    const next = order[(order.indexOf(cur) + 1) % order.length] ?? 'fit';
    h.setParam('zoom', next === 'fit' ? '' : next);
  }
}

function viewKeys(
  e: KeyboardEvent,
  ctx: {
    data: ReportData;
    test: HtmlReportTest;
    sel: FlatFrame | null;
    route: Route & { view: 'test' };
    h: KeyNavHandlers;
  }
): void {
  neighborKeys(e, ctx.data, ctx.route.testId, ctx.h);
  uiToggleKeys(e, ctx.route, ctx.h, frameHasUi(ctx.sel));
  if (/^[1-9]$/.test(e.key)) {
    const ids = actorIds(ctx.sel, ctx.test);
    const n = Number.parseInt(e.key, 10);
    if (n >= 1 && n <= ids.length) ctx.h.goFrame(ctx.sel, ids[n - 1] ?? '');
  }
}

/**
 * Handles one `keydown` for the viewer. Keys: Cmd/Ctrl+K palette; `?` help; Escape closes help or the palette,
 * else stops playback and returns to the list. On a test page: Left/Right/Home/End scrub frames, Space plays,
 * Up/Down jump between steps, `n`/`N` between failures, `[`/`]` to the previous/next test (keeping the list's
 * params), `1`-`9` pick a client, and, when the frame has a UI snapshot, `m` single/multi view, `a` aside, `p`
 * press targets, `f` cycles zoom (fit, 50, 75, 100).
 *
 * Cmd/Ctrl+K and Escape-closing-the-palette work anywhere. Every other key is ignored while the palette is open and
 * while focus is in an input, textarea, select, button, link or editable element; the test-page keys also need the
 * route to be a test that is in `data`.
 */
export function onReportKeyDown(
  e: KeyboardEvent,
  data: ReportData,
  h: KeyNavHandlers
): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    h.togglePalette();
    return;
  }
  if (e.key === 'Escape' && h.showPalette()) {
    e.preventDefault();
    h.togglePalette();
    return;
  }
  if (h.showPalette()) return;
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName;
  if (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    tag === 'A' ||
    target?.isContentEditable
  ) {
    return;
  }
  if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    h.toggleHelp();
    return;
  }
  if (e.key === 'Escape') {
    if (h.showHelp()) {
      h.toggleHelp();
      return;
    }
    h.stopPlay();
    h.navigate({ view: 'list', params: {} });
    return;
  }
  const r = h.route();
  if (r.view !== 'test') return;
  const test =
    data.tests.find((t) => t.report.meta.testId === r.testId) ?? null;
  if (!test) return;
  const frames = testFrames(test);
  const sel = selectedFrame(frames, r);
  scrubKeys(e, frames, sel, h);
  jumpKeys(e, frames, sel, h);
  viewKeys(e, { data, test, sel, route: r, h });
}
