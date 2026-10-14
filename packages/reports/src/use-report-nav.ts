/**
 * @module Report viewer navigation state
 *
 * The Solid state behind the report viewer's navigation: the current route (kept in the URL hash), help and command
 * palette visibility, frame stepping and auto-play, keyboard shortcuts and the document title. Everything outside the
 * reactive state (the location, the keyboard, timers) is injected, so it runs the same in a browser and in tests. It
 * creates signals and effects, so it must be called inside a Solid root, which also owns its cleanup.
 */
import type { Timers } from './clock';
import type { FlatFrame } from './frames';
import { selectedFrame, testFrames } from './frames';
import type { Route } from './hash';
import { buildHash, parseHash } from './hash';
import { onReportKeyDown } from './keyboard';
import type { ReportData } from './types';
import type { Accessor } from 'solid-js';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import type { ReportNavigation } from './navigation';

/** What the viewer's views read and call to move around a report. */
export type ReportNav = {
  /** The current route: the list, or one test with its params. Updates at once, before the URL is written. */
  route: Accessor<Route>;
  /** Whether the keyboard help is open. */
  showHelp: Accessor<boolean>;
  /** Whether the command palette is open. */
  showPalette: Accessor<boolean>;
  /** Whether frames are advancing on a timer. */
  playing: Accessor<boolean>;
  /** Goes to `route`. A normal navigation adds a history entry and writes the URL now; with `replace` true it updates the route at once and writes the URL, replacing the entry, 200 ms after the last such call. */
  navigate: (route: Route, replace?: boolean) => void;
  /** Write the in-memory route to the URL now (end of a scrub drag). */
  commitHash: () => void;
  /** Sets one param of the current test route (replacing history); does nothing on the list route. */
  setParam: (key: string, value: string) => void;
  /** Selects a frame of the current test (its 1-based position goes into the `frame` param), or clears the selection with `null`; `node` also sets the `node` param. Does nothing on the list route. */
  goFrame: (frame: FlatFrame | null, node?: string | undefined) => void;
  /** Moves the selected frame by `delta` (negative goes back); does nothing at either end or off a test route. */
  stepFrame: (delta: number) => void;
  /** Opens the help if closed, else closes it. */
  toggleHelp: () => void;
  /** Closes the help. */
  closeHelp: () => void;
  /** Opens the palette if closed, else closes it. */
  togglePalette: () => void;
  /** Closes the palette. */
  closePalette: () => void;
  /** Starts advancing one frame every 700 ms, or stops if playing. Stops by itself at the last frame, or when the route stops being a test. */
  togglePlay: () => void;
  /** Stops playback. */
  stopPlay: () => void;
};

function advancePlay(
  data: ReportData,
  route: Accessor<Route>,
  navigate: ReportNav['navigate'],
  stopPlay: () => void
): void {
  const r = route();
  const test =
    r.view === 'test'
      ? (data.tests.find((t) => t.report.meta.testId === r.testId) ?? null)
      : null;
  if (r.view !== 'test' || !test) {
    stopPlay();
    return;
  }
  const frames = testFrames(test);
  const cur = selectedFrame(frames, r);
  const idx = cur ? cur.index : -1;
  const frame = frames[idx + 1];
  if (idx < 0 || !frame) {
    stopPlay();
    return;
  }
  navigate(
    {
      view: 'test',
      testId: r.testId,
      params: { ...r.params, frame: String(frame.index + 1) },
    },
    true
  );
}

function bindWindowListeners(opts: {
  data: ReportData;
  navigation: ReportNavigation;
  cancelHashWrite: () => void;
  route: Accessor<Route>;
  setRoute: (r: Route) => void;
  showHelp: Accessor<boolean>;
  setShowHelp: (v: boolean | ((p: boolean) => boolean)) => void;
  showPalette: Accessor<boolean>;
  togglePalette: () => void;
  stopPlay: () => void;
  navigate: (route: Route, replace?: boolean) => void;
  goFrame: ReportNav['goFrame'];
  togglePlay: () => void;
  setParam: ReportNav['setParam'];
}): void {
  onCleanup(
    opts.navigation.subscribeHash(() => {
      opts.cancelHashWrite();
      opts.stopPlay();
      opts.setRoute(parseHash(opts.navigation.readHash()));
    })
  );
  onCleanup(
    opts.navigation.subscribeKeys((e) =>
      onReportKeyDown(e, opts.data, {
        toggleHelp: () => opts.setShowHelp((p) => !p),
        showHelp: opts.showHelp,
        showPalette: opts.showPalette,
        togglePalette: opts.togglePalette,
        stopPlay: opts.stopPlay,
        navigate: (next) => opts.navigate(next),
        goFrame: opts.goFrame,
        togglePlay: opts.togglePlay,
        setParam: opts.setParam,
        route: opts.route,
      })
    )
  );

  createEffect(() => {
    const r = opts.route();
    const test =
      r.view === 'test'
        ? opts.data.tests.find((t) => t.report.meta.testId === r.testId)
        : null;
    opts.navigation.setTitle(
      (test ? `${test.report.meta.title} · ` : '') + opts.data.title
    );
  });
}

function makeReportNav(state: {
  readonly route: Accessor<Route>;
  readonly showHelp: Accessor<boolean>;
  readonly showPalette: Accessor<boolean>;
  readonly playing: Accessor<boolean>;
  readonly navigate: ReportNav['navigate'];
  readonly commitHash: ReportNav['commitHash'];
  readonly setParam: ReportNav['setParam'];
  readonly goFrame: ReportNav['goFrame'];
  readonly stepFrame: ReportNav['stepFrame'];
  readonly toggleHelp: ReportNav['toggleHelp'];
  readonly closeHelp: ReportNav['closeHelp'];
  readonly togglePalette: ReportNav['togglePalette'];
  readonly closePalette: ReportNav['closePalette'];
  readonly togglePlay: ReportNav['togglePlay'];
  readonly stopPlay: ReportNav['stopPlay'];
}): ReportNav {
  return state;
}

function navigateFrame(args: {
  readonly route: Route;
  readonly navigate: ReportNav['navigate'];
  readonly frame: FlatFrame | null;
  readonly node?: string;
}): void {
  if (args.route.view !== 'test') return;
  const params: Record<string, string> = {
    ...args.route.params,
    frame: args.frame ? String(args.frame.index + 1) : '',
  };
  if (args.node !== undefined) params['node'] = args.node || '';
  args.navigate({ view: 'test', testId: args.route.testId, params }, true);
}

/**
 * Route signal backed by the URL hash. Replace-navigation (scrub, play,
 * toggles) updates the in-memory route at once and writes the URL on a
 * trailing debounce: rendering never waits on history, and rapid scrubbing
 * cannot trip replaceState rate limits.
 */
function createHashRoute(navigation: ReportNavigation, timers: Timers) {
  const [route, setRoute] = createSignal<Route>(
    parseHash(navigation.readHash())
  );
  let hashTimer: ReturnType<Timers['setTimeout']> | null = null;
  const cancelHashWrite = () => {
    if (hashTimer !== null) timers.clearTimeout(hashTimer);
    hashTimer = null;
  };
  const commitHash = () => {
    cancelHashWrite();
    navigation.writeHash(buildHash(route()), true);
  };
  const navigate = (next: Route, replace = false) => {
    cancelHashWrite();
    setRoute(next);
    if (replace) hashTimer = timers.setTimeout(commitHash, 200);
    else navigation.writeHash(buildHash(next), false);
  };
  onCleanup(cancelHashWrite);
  return { route, setRoute, commitHash, navigate, cancelHashWrite };
}

/**
 * Creates the navigation state for a report: the route from the URL hash (and kept in sync when it changes), help and
 * palette state, playback, keyboard shortcuts and the page title (`<test title> · <report title>`).
 *
 * Reading the hash is the only way in: an unrecognised hash is the list route, and `parseHash` throws `URIError` on a
 * malformed percent-escape. Subscriptions and timers are released when the surrounding Solid root is disposed. Must be
 * called inside a Solid root.
 *
 * @param data the report whose tests the routes name.
 * @param navigation where the hash, keys and title live (the browser, or a fake).
 * @param timers timer functions for the hash-write debounce and playback.
 */
export function useReportNav(
  data: ReportData,
  navigation: ReportNavigation,
  timers: Timers
): ReportNav {
  const { route, setRoute, commitHash, navigate, cancelHashWrite } =
    createHashRoute(navigation, timers);
  const [showHelp, setShowHelp] = createSignal(false);
  const [showPalette, setShowPalette] = createSignal(false);
  const { playing, stopPlay, togglePlay } = createPlayback(
    data,
    route,
    navigate,
    timers
  );

  const goFrame = (frame: FlatFrame | null, node?: string) =>
    navigateFrame({
      route: route(),
      navigate,
      frame,
      ...(node !== undefined ? { node } : {}),
    });

  const setParam = (key: string, value: string) => {
    const r = route();
    if (r.view !== 'test') return;
    navigate(
      { view: 'test', testId: r.testId, params: { ...r.params, [key]: value } },
      true
    );
  };

  const stepFrame = (delta: number) => {
    const r = route();
    if (r.view !== 'test') return;
    const test =
      data.tests.find((t) => t.report.meta.testId === r.testId) ?? null;
    if (!test) return;
    const frames = testFrames(test);
    const sel = selectedFrame(frames, r);
    const next = (sel ? sel.index : -1) + delta;
    if (next < 0 || next >= frames.length) return;
    goFrame(frames[next] ?? null);
  };

  bindWindowListeners({
    data,
    navigation,
    cancelHashWrite,
    route,
    setRoute,
    showHelp,
    setShowHelp,
    showPalette,
    togglePalette: () => setShowPalette((open) => !open),
    stopPlay,
    navigate,
    goFrame,
    togglePlay,
    setParam,
  });

  return makeReportNav({
    route,
    showHelp,
    showPalette,
    playing,
    navigate,
    commitHash,
    setParam,
    goFrame,
    stepFrame,
    toggleHelp: () => setShowHelp(!showHelp()),
    closeHelp: () => setShowHelp(false),
    togglePalette: () => setShowPalette((open) => !open),
    closePalette: () => setShowPalette(false),
    togglePlay,
    stopPlay,
  });
}

function createPlayback(
  data: ReportData,
  route: Accessor<Route>,
  navigate: ReportNav['navigate'],
  timers: Timers
) {
  let timer: ReturnType<Timers['setInterval']> | null = null;
  const [playing, setPlaying] = createSignal(false);
  const stopPlay = () => {
    if (timer !== null) timers.clearInterval(timer);
    timer = null;
    setPlaying(false);
  };
  const togglePlay = () => {
    if (playing()) {
      stopPlay();
      return;
    }
    setPlaying(true);
    timer = timers.setInterval(
      () => advancePlay(data, route, navigate, stopPlay),
      700
    );
  };
  onCleanup(stopPlay);
  return { playing, stopPlay, togglePlay };
}
