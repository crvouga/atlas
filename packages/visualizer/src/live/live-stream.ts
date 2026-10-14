import { AtlasChangeSchema, type AtlasChange } from '@crvouga/atlas/schema';
import { useSyncExternalStore } from 'react';

import { runtimeConfig, runtimeUrl } from '../runtime';

/** What the server tells a viewer as it happens. */
export type LiveEvent =
  | { readonly type: 'open' }
  | { readonly type: 'report'; readonly report: ReportAnnouncement }
  | { readonly type: 'change'; readonly change: AtlasChange };

/** One announcement that results arrived: enough to say who sent them without asking again. */
export type ReportAnnouncement = {
  readonly version: string;
  readonly totalLayers: number;
  readonly addedTotal: number;
  readonly added: readonly {
    readonly id: string;
    readonly producer: string;
    readonly environment?: string | null;
    readonly branch?: string | null;
    readonly counts?: Readonly<Record<string, number>>;
  }[];
};

/** `connecting` before the first answer, `live` while the stream is open, `reconnecting` after it was lost. */
export type LiveStatus = 'off' | 'connecting' | 'live' | 'reconnecting';

type Listener = (event: LiveEvent) => void;

/** The server sends a comment every 15 seconds; this long without a word means the connection is dead. */
const SILENCE_MS = 45_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

type Stream = {
  readonly url: string;
  readonly listeners: Set<Listener>;
  source: EventSource | null;
  status: LiveStatus;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  watchdog: ReturnType<typeof setTimeout> | null;
};

const streams = new Map<string, Stream>();
const statusListeners = new Set<() => void>();

function setStatus(stream: Stream, status: LiveStatus) {
  if (stream.status === status) return;
  stream.status = status;
  for (const listener of statusListeners) listener();
}

function emit(stream: Stream, event: LiveEvent) {
  for (const listener of [...stream.listeners]) {
    try {
      listener(event);
    } catch {
      // One listener's mistake must not stop the others hearing.
    }
  }
}

function parse(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function connect(stream: Stream) {
  if (typeof EventSource === 'undefined') return;
  stream.timer = null;
  const source = new EventSource(stream.url);
  stream.source = source;
  const heard = () => {
    if (stream.watchdog) clearTimeout(stream.watchdog);
    stream.watchdog = setTimeout(() => lose(stream), SILENCE_MS);
  };
  source.addEventListener('open', () => {
    heard();
    stream.attempts = 0;
    setStatus(stream, 'live');
    // Anything may have happened while the stream was away, so a (re)connection reads everything again.
    emit(stream, { type: 'open' });
  });
  source.addEventListener('hello', heard);
  source.addEventListener('report', (event) => {
    heard();
    const report = parse((event as MessageEvent<string>).data) as ReportAnnouncement | null;
    if (report && typeof report.version === 'string') emit(stream, { type: 'report', report: { ...report, added: Array.isArray(report.added) ? report.added : [] } });
  });
  source.addEventListener('atlas:change', (event) => {
    heard();
    const change = AtlasChangeSchema.safeParse(parse((event as MessageEvent<string>).data));
    if (change.success) emit(stream, { type: 'change', change: change.data });
  });
  // A heartbeat is a comment, which the browser does not show us, so any named event above resets the watchdog
  // and a quiet server is told apart by the connection itself: the browser closes a connection that stops answering.
  source.addEventListener('error', () => {
    setStatus(stream, stream.attempts === 0 && stream.status === 'connecting' ? 'connecting' : 'reconnecting');
    // The browser retries a dropped stream by itself. A refused one (401, 503) it gives up on: retry that here, slowly.
    if (source.readyState === EventSource.CLOSED) lose(stream);
  });
  heard();
}

function lose(stream: Stream) {
  if (stream.watchdog) clearTimeout(stream.watchdog);
  stream.watchdog = null;
  stream.source?.close();
  stream.source = null;
  if (!stream.listeners.size) return;
  setStatus(stream, 'reconnecting');
  if (stream.timer) return;
  const wait = BACKOFF_MS[Math.min(stream.attempts, BACKOFF_MS.length - 1)]!;
  stream.attempts += 1;
  stream.timer = setTimeout(() => connect(stream), wait);
}

function release(stream: Stream) {
  if (stream.listeners.size) return;
  if (stream.timer) clearTimeout(stream.timer);
  if (stream.watchdog) clearTimeout(stream.watchdog);
  stream.source?.close();
  streams.delete(stream.url);
  setStatus(stream, 'off');
}

/**
 * Hear what the server at `url` announces. Everything in the page that listens to one address shares one
 * connection, which is opened with the first listener and closed with the last.
 */
export function listenLive(url: string, listener: Listener): () => void {
  let stream = streams.get(url);
  if (!stream) {
    stream = { url, listeners: new Set(), source: null, status: 'connecting', attempts: 0, timer: null, watchdog: null };
    streams.set(url, stream);
    stream.listeners.add(listener);
    connect(stream);
    for (const notify of statusListeners) notify();
  } else {
    stream.listeners.add(listener);
  }
  const mine = stream;
  return () => {
    mine.listeners.delete(listener);
    release(mine);
  };
}

/** Changes to specs and runs, in the form the data layer already understands. */
export function listenChanges(url: string, onChange: (change: AtlasChange) => void): () => void {
  return listenLive(url, (event) => {
    if (event.type === 'change') onChange(event.change);
    // A fresh connection may have missed changes while it was away.
    if (event.type === 'open') onChange({ scope: 'runs', files: [], runIds: [] });
  });
}

/** The address of this server's event stream, when the page has one. */
export const eventsAddress = () => runtimeUrl(runtimeConfig()?.eventsUrl);

function snapshot(): LiveStatus {
  const url = eventsAddress();
  return (url && streams.get(url)?.status) || (url ? 'connecting' : 'off');
}

function subscribeStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Whether the report on screen is being kept up to date by the server. `off` for a static site. */
export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(subscribeStatus, snapshot, () => 'off');
}

/** Test seam: forget every stream. */
export function resetLiveStreams() {
  for (const stream of streams.values()) {
    stream.listeners.clear();
    release(stream);
  }
  streams.clear();
}

/**
 * `act` at once, and then no more than once per `ms` however often it is called: a call made inside the wait
 * runs when the wait ends. The last word is never lost.
 */
export function throttled(act: () => void, ms: number): (() => void) & { cancel: () => void } {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const call = () => {
    if (timer) return;
    const wait = last + ms - Date.now();
    if (wait <= 0) { last = Date.now(); act(); return; }
    timer = setTimeout(() => { timer = null; last = Date.now(); act(); }, wait);
  };
  call.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return call;
}
