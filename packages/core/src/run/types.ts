import type { CloudEvent } from '../events/cloudevents';
import type { StateValue } from '../graph';
import type { PlannedPath } from '../plan';

export type RunMode = 'fast' | 'showcase';
export type Status = 'passed' | 'failed' | 'flaky' | 'not-reached';
export type EventKind = 'user' | 'system' | 'time' | 'hand-off';

/** `client` names which client's screen it is in a multi-client run; `also` holds the other clients' screens at the same moment. */
export type Image = { png: string; webp?: string; client?: string; also?: Image[] };
export type Clip = { video: string; poster?: string; durationMs: number; client?: string };

export type TimelineEntry = {
  atMs: number;
  kind: 'tap' | 'type' | 'system' | 'screen' | 'toast' | 'note' | 'time' | 'notification';
  label: string;
  x?: number;
  y?: number;
  text?: string;
  system?: { source?: string; endpoint?: string; eventType?: string; payload?: unknown; responseStatus?: number };
  /** The client that did it, in a multi-client run. */
  client?: string;
};

type TimelineState = { origin: number; entries: TimelineEntry[] };

/**
 * What a step records while it runs: taps, typing, system calls, the screen change. `for(client)`
 * returns a view onto the same timeline that tags every entry with that client.
 */
export class Timeline {
  private readonly state: TimelineState;
  readonly client?: string;

  constructor(state: TimelineState = { origin: Date.now(), entries: [] }, client?: string) {
    this.state = state;
    this.client = client;
  }

  get entries() {
    return this.state.entries;
  }

  restart() {
    this.state.origin = Date.now();
    this.state.entries = [];
  }

  add(entry: Omit<TimelineEntry, 'atMs'>) {
    this.state.entries.push({ atMs: Date.now() - this.state.origin, ...(this.client ? { client: this.client } : {}), ...entry });
  }

  for(client: string) {
    return new Timeline(this.state, client);
  }
}

export type RecognizerResult = {
  matched: boolean;
  signals: { signal: string; expected: 'visible' | 'hidden' | string; visible: boolean }[];
};

export type CheckResult = { check: string; passed: boolean; expected?: string; actual?: string };

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
  name: string;
  open(input: { path: PlannedPath; attempt: number; mode: RunMode; directory: string; timeline: Timeline }): Promise<C>;
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
  dispose?(): Promise<void>;
};

/** How one event is made to happen. Keyed by the event's exact name in the spec. */
export type EventImplementation<C> = {
  kind: EventKind;
  /** The client that does it, in a multi-client run: its screen is recorded for the clip. */
  client?: string;
  /** A plain-language note on how the runner makes it happen (shown to developers). */
  how: string;
  /** Test data the event needs before the path starts (a condition modelled as an event). */
  prepare?(ctx: C, tools: StepTools): Promise<void>;
  run(ctx: C, tools: StepTools): Promise<void>;
  /** Set when the event cannot be triggered reliably yet: the path stops before it. */
  blocked?: string;
};

/** How one state is recognised from the outside, and what is checked there. */
export type StateImplementation<C> = {
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
  /** Set when the configuration cannot be seeded yet: paths start from another seed. */
  blocked?: string;
};

export type Implementation<C> = {
  events: Record<string, EventImplementation<C>>;
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
  name: string;
  /** Where "now" is in the source; `collect` returns what arrived after this mark. */
  mark(): unknown;
  collect(mark?: unknown): Promise<{ events: CloudEvent[]; text?: string }>;
  close?(): Promise<void>;
};

/** How a business event named in `meta.events` is recognised in what a source collected. */
export type EventMatcher = { type: string } | { pattern: RegExp } | ((events: CloudEvent[], text: string) => boolean);

export type PrivacyRules = {
  /** Patterns that must never appear on screen or in a manifest. */
  deny?: { name: string; pattern: RegExp }[];
  /** Emails that may appear (synthetic domains, support addresses). */
  allowEmails?: RegExp[];
  /** Hosts the run may target; loopback only by default. */
  allowHosts?: string[];
};

/**
 * A driver for anything you can reach from Node: a domain model, an API client, a CLI. `create`
 * returns a fresh context per path attempt; recognisers and events work on it directly.
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
