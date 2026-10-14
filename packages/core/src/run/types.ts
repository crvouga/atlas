/**
 * @module Run types and function driver
 *
 * The contracts between a run and the things it drives: `Driver` (owns the system under test for one
 * path attempt), `Implementation` (how each event is made to happen and each state recognised), `Seed`,
 * event sources and privacy rules, plus the status vocabulary and `Timeline`. These shapes are what
 * integrators write against, so they change only by adding optional fields. Also holds
 * `functionDriver`, the simplest complete driver.
 *
 * @see docs/statecharts.md
 */
import type { CloudEvent } from '../events/cloudevents';
import type { StateValue } from '../graph';
import type { PlannedPath } from '../plan';

/** `fast` runs without pacing and takes screenshots only; `showcase` paces steps like a person and records a clip of every transition. */
export type RunMode = 'fast' | 'showcase';
/** The result of a path, state, transition or journey: `flaky` passed only on the retry; `not-reached` was never run, was blocked, or has no covering path. */
export type Status = 'passed' | 'failed' | 'flaky' | 'not-reached';
/** Who or what makes an event happen: a `user` action, a `system` call, the passing of `time`, or a `hand-off` from a child chart (inserted by the planner, usually a no-op). */
export type EventKind = 'user' | 'system' | 'time' | 'hand-off';

/** `client` names which client's screen it is in a multi-client run; `also` holds the other clients' screens at the same moment. */
export type Image = {
  /** Path to the PNG. A driver returns an absolute path; in a manifest it is relative to the run directory. */
  png: string;
  /** Path to a WebP thumbnail, when one was made. */
  webp?: string;
  client?: string;
  also?: Image[];
};
/** A recorded video of one transition. */
export type Clip = {
  /** Path to the MP4 (relative to the run directory in a manifest). */
  video: string;
  /** Path to a poster image, when one was made. */
  poster?: string;
  durationMs: number;
  /** The client whose screen was recorded, in a multi-client run. */
  client?: string;
};

/** One thing that happened during a step, which becomes a caption on the step's clip. */
export type TimelineEntry = {
  /** Milliseconds since the step began (see `Timeline.restart`). */
  atMs: number;
  /** What kind of thing happened. */
  kind: 'tap' | 'type' | 'system' | 'screen' | 'toast' | 'note' | 'time' | 'notification';
  /** The caption. */
  label: string;
  /** For a tap, where it landed (page pixels for the Playwright driver). */
  x?: number;
  y?: number;
  /** For typing, what was typed; shown in the caption. */
  text?: string;
  /** For a system call, what it was (never bodies). */
  system?: { source?: string; endpoint?: string; eventType?: string; payload?: unknown; responseStatus?: number };
  /** The client that did it, in a multi-client run. */
  client?: string;
};

type TimelineState = { origin: number; entries: TimelineEntry[] };

/**
 * What a step records while it runs: taps, typing, system calls, the screen change. `for(client)`
 * returns a view onto the same timeline that tags every entry with that client. The runner restarts
 * it at the start of every step, so entries are relative to the step they belong to.
 */
export class Timeline {
  private readonly state: TimelineState;
  /** The client this view tags entries with; `undefined` on the root timeline. */
  readonly client: string | undefined;

  constructor(state: TimelineState = { origin: Date.now(), entries: [] }, client?: string) {
    this.state = state;
    this.client = client;
  }

  /** Every entry added since the last `restart`, in order, shared by all views of the timeline. */
  get entries() {
    return this.state.entries;
  }

  /** Clears the entries and makes now the origin for `atMs`. */
  restart() {
    this.state.origin = Date.now();
    this.state.entries = [];
  }

  /** Appends an entry stamped with the time since the origin, and with this view's client when it has one. */
  add(entry: Omit<TimelineEntry, 'atMs'>) {
    this.state.entries.push({ atMs: Date.now() - this.state.origin, ...(this.client ? { client: this.client } : {}), ...entry });
  }

  /** A view of the same timeline that tags what it adds with `client`. */
  for(client: string) {
    return new Timeline(this.state, client);
  }
}

/** What a state recogniser found. */
export type RecognizerResult = {
  /** Whether the state is showing. */
  matched: boolean;
  /** What was looked at, shown to explain a failure. `expected` is `visible` or `hidden`. */
  signals: { signal: string; expected: 'visible' | 'hidden' | string; visible: boolean }[];
};

/** The result of one of a state's `meta.checks`; a failed check fails the state. */
export type CheckResult = {
  /** The check statement, quoted from the spec. */
  check: string;
  passed: boolean;
  expected?: string;
  actual?: string;
};

/** Per-attempt tools handed to every implementation. */
export type StepTools = {
  timeline: Timeline;
  mode: RunMode;
  /** Pause for the pacing of the current mode (no-op in fast mode for the default pauses). */
  hold(ms: number): Promise<void>;
  /** Scratch space shared by the events of one path attempt. */
  data: Record<string, unknown>;
};

/**
 * Which client a media hook should look at, in a multi-client run: the client a state is
 * recognised on, or the client an event is done on. Single-client drivers ignore it.
 */
export type Focus = { client?: string };

/**
 * A driver owns the thing under test for one path attempt: a browser context (Playwright), a
 * device (Detox, WebDriver/Appium), a model or an API client. Only `open` and `close` are
 * required; media hooks are used when present. `combineDrivers` runs several at once.
 */
export type Driver<C> = {
  /** Shown in reports as the driver the run used. */
  name: string;
  /**
   * Creates a fresh context for one attempt of one path. `attempt` is 1, or 2 for the retry;
   * `directory` is a scratch directory for this attempt; the driver should log what it does to `timeline`.
   */
  open(input: { path: PlannedPath; attempt: number; mode: RunMode; directory: string; timeline: Timeline }): Promise<C>;
  /**
   * Releases the context. `traceFile` is where a trace may be written when `failed`; return the path
   * actually written as `trace` (or one per client as `traces`) to attach it to the report.
   */
  close(ctx: C, input: { failed: boolean; traceFile: string }): Promise<{ trace?: string; traces?: Record<string, string> } | void>;
  /** A settled, deterministic screenshot of the current screen. */
  screenshot?(ctx: C, file: string, focus?: Focus): Promise<Image | null>;
  /** Start recording one transition; `stop` encodes it and returns the clip. */
  record?(ctx: C, workDirectory: string, focus?: Focus): Promise<{ stop(output: string): Promise<Clip | null> }>;
  /** Visible text of the screen, for the privacy scan (every client's screen when unfocused). */
  text?(ctx: C, focus?: Focus): Promise<string>;
  /** Pause between actions; drivers can show it (a touch overlay idling) or ignore it. */
  hold?(ctx: C, ms: number, focus?: Focus): Promise<void>;
  /** The clients of a multi-client driver, by name, with the driver each runs on. */
  clients?: Record<string, string>;
  /** Pacing for showcase mode, in milliseconds. */
  pacing?: { before: number; after: number };
  /**
   * How many path attempts can have a context open at once (browser contexts are independent; a
   * single device is not). Runs use at most this many workers; 1 when omitted.
   */
  concurrency?: number;
  /** Releases what is shared by all contexts (a browser, a server); called once after the last path. */
  dispose?(): Promise<void>;
};

/** How one event is made to happen. Keyed by the event's exact name in the spec. */
export type EventImplementation<C> = {
  /** Who makes the event happen; recorded with the event in the manifest. */
  kind: EventKind;
  /** The client that does it, in a multi-client run: its screen is recorded for the clip. */
  client?: string;
  /** A plain-language note on how the runner makes it happen (shown to developers). */
  how: string;
  /** Test data the event needs before the path starts (a condition modelled as an event). */
  prepare?(ctx: C, tools: StepTools): Promise<void>;
  /** Makes the event happen. The runner then waits for the target state to be recognised, so `run` does not need to wait for it; it should throw only when the event cannot be done. */
  run(ctx: C, tools: StepTools): Promise<void>;
  /** Set when the event cannot be triggered reliably yet: the path stops before it. */
  blocked?: string;
};

/** How one state is recognised from the outside, and what is checked there. */
export type StateImplementation<C> = {
  /** Looks at the system from the outside and says whether the state is showing. Called repeatedly (with growing pauses, until `stepTimeoutMs`) while the runner waits for the state, so it must be cheap and side-effect free. */
  recognize(ctx: C): Promise<RecognizerResult>;
  /** The client whose screen shows it, in a multi-client run: that screen is the screenshot. */
  client?: string;
  /** Shown too briefly to wait for: not seeing it is not a failure. */
  transient?: boolean;
  /** States the UI cannot tell apart; never reported as "looks like" each other. */
  sameAs?: string;
  /** Where to look when the state changes off-screen (open a tab, reload). */
  lookIn?(ctx: C): Promise<void>;
  /** Within-state actions after the screenshot (dismiss a success message). */
  settle?(ctx: C): Promise<void>;
  /** Results for the state's `meta.checks`, evaluated once the state is recognised. */
  checks?(ctx: C): Promise<CheckResult[]>;
};

/**
 * Puts the system directly in one configuration of the chart (create the data, sign in, open the
 * screen), so paths can start there instead of walking every step before it. A seed must leave
 * the system exactly as the steps that lead there would: then results of the stretch before it
 * and the stretch after it compose, and Atlas checks that by recognising the state both ways.
 */
export type Seed<C> = {
  /** A state name (with the default configuration inside and beside it) or a full state value. */
  at: string | StateValue;
  /** A plain-language note on how the seed gets there (shown to developers). */
  how: string;
  run(ctx: C, input: { path: PlannedPath; tools: StepTools }): Promise<void>;
  /**
   * The state the seed leaves on screen, recognised before the first step. In a parallel state
   * it says which region the seed opens. The state `at` names (or its active leaf), or the last
   * active leaf, when omitted.
   */
  shows?: string;
  /**
   * Events this seed exists for: a variant of a configuration (the same states, different data,
   * such as a member at an address no lab serves). It starts only paths that take one of these
   * events, and paths that take one start from a seed that lists it.
   */
  for?: string[];
  /** Set when the configuration cannot be seeded yet: paths start from another seed. */
  blocked?: string;
};

/**
 * How a driver makes each event of the spec happen and recognises each state: everything the charts
 * do not say. Events and states are keyed by their exact names in the spec; only leaf states need a
 * recogniser.
 */
export type Implementation<C> = {
  /** By event name; an event with no entry is reported as blocked. */
  events: Record<string, EventImplementation<C>>;
  /** By state name; only leaf states need one. */
  states: Record<string, StateImplementation<C>>;
  /**
   * Named seeds: configurations paths can start from. Journeys are cut at every seeded
   * configuration they pass through, so each stretch runs on its own and in parallel.
   */
  seeds?: Record<string, Seed<C>>;
  /** Put the system in the scope's start configuration, for paths that start without a seed. */
  setup?(ctx: C, input: { path: PlannedPath; tools: StepTools }): Promise<void>;
  /** Whether `setup` can start a path in this configuration; a string is the reason it cannot. */
  canStart?(active: string[]): true | string;
  /**
   * Ids that tell this attempt's business events from those of attempts running beside it (a
   * user id, a trace id). Shared event sources keep only events and log lines that contain one.
   */
  correlate?(ctx: C): string[] | Promise<string[]>;
};

/** Where business events come from: a CloudEvents endpoint, a log, a message queue. */
export type EventSource = {
  /** Identifies the source; a name starting with `log:` marks a log file, anything else counts as a CloudEvents source. */
  name: string;
  /** Where "now" is in the source; `collect` returns what arrived after this mark. */
  mark(): unknown;
  /** Returns what arrived since `mark` (everything when omitted): CloudEvents and/or raw log text. */
  collect(mark?: unknown): Promise<{ events: CloudEvent[]; text?: string }>;
  /** Releases the source; called when the run ends. */
  close?(): Promise<void>;
};

/** How a business event named in `meta.events` is recognised in what a source collected. */
export type EventMatcher = { type: string } | { pattern: RegExp } | ((events: CloudEvent[], text: string) => boolean);

/** Rules for what may appear on screen and in a manifest. They extend the defaults (see `DEFAULT_PRIVACY`) except `allowHosts`, which replaces them. */
export type PrivacyRules = {
  /** Patterns that must never appear on screen or in a manifest. */
  deny?: { name: string; pattern: RegExp }[];
  /** Emails that may appear (synthetic domains, support addresses). */
  allowEmails?: RegExp[];
  /** Hosts the run may target; loopback only by default. */
  allowHosts?: string[];
};

/**
 * A driver for anything you can reach from code: a domain model, an API client, a CLI. `create`
 * returns a fresh context per path attempt; recognisers and events work on it directly. It takes
 * no screenshots or clips, and any number of attempts can run side by side unless `concurrency` says otherwise.
 *
 * @param create builds the context for one attempt; it may be async.
 * @param options.name the driver's name in reports; `function` when omitted.
 * @param options.dispose called with the context when the attempt ends.
 * @param options.concurrency how many contexts may be open at once; unlimited when omitted.
 * @see docs/statecharts.md
 *
 * @example
 * const driver = functionDriver(() => new TodoModel());
 */
export function functionDriver<C>(
  create: (input: { path: PlannedPath; timeline: Timeline }) => C | Promise<C>,
  options: { name?: string; dispose?: (ctx: C) => void | Promise<void>; concurrency?: number } = {}
): Driver<C> {
  return {
    name: options.name ?? 'function',
    concurrency: options.concurrency ?? Number.POSITIVE_INFINITY,
    open: ({ path, timeline }) => Promise.resolve(create({ path, timeline })),
    close: async (ctx) => {
      await options.dispose?.(ctx);
    }
  };
}
