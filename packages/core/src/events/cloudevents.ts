/**
 * @module Business event sources
 *
 * Where a run learns which business events actually happened: an HTTP endpoint that accepts
 * CloudEvents (`cloudEventsHttpSource`), or the lines a log file gains (`logFileSource`), plus the pure
 * functions that compare what a state expects (`meta.events`) with what was collected. Every source
 * implements `EventSource`: `mark()` records a position before a step and `collect(mark)` returns only
 * what arrived after it. An event with no way to be observed is reported as "no signal", never as
 * missing, so absence of evidence is not read as failure.
 *
 * @see docs/statecharts.md
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';

import type { EventMatcher, EventSource } from '../run/types';

/** A CloudEvents 1.0 event in the JSON format (https://cloudevents.io). */
export type CloudEvent = {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  time?: string;
  subject?: string;
  datacontenttype?: string;
  data?: unknown;
  [extension: string]: unknown;
};

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Parses an HTTP delivery in any CloudEvents content mode: structured (`application/cloudevents+json`),
 * batch (`application/cloudevents-batch+json`) or binary (`ce-*` headers, with the body as `data`).
 * A request with none of those (no `ce-type` header and a different content type) yields no events.
 * In binary mode a missing `ce-id` becomes a random UUID and a missing `ce-source` becomes `unknown`;
 * other `ce-*` headers become extension attributes; the body is parsed as JSON when the content type
 * says JSON and it parses, else kept as text.
 *
 * @param headers lower-cased header names, as Node's `IncomingMessage.headers`.
 * @throws SyntaxError when a structured or batch body is not valid JSON.
 */
export function cloudEventsFromHttp(headers: Record<string, string | string[] | undefined>, body: string): CloudEvent[] {
  const header = (name: string) => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const contentType = header('content-type') ?? '';
  if (contentType.startsWith('application/cloudevents-batch+json')) return JSON.parse(body) as CloudEvent[];
  if (contentType.startsWith('application/cloudevents+json')) return [JSON.parse(body) as CloudEvent];
  const type = header('ce-type');
  if (!type) return [];
  const time = header('ce-time');
  const subject = header('ce-subject');
  const extensions = Object.fromEntries(
    Object.entries(headers)
      .filter(([k]) => k.startsWith('ce-') && !['ce-specversion', 'ce-id', 'ce-source', 'ce-type', 'ce-time', 'ce-subject'].includes(k))
      .map(([k, v]) => [k.slice(3), Array.isArray(v) ? v[0] : v])
  );
  let data: unknown = body;
  if (contentType.includes('json') && body) {
    try {
      data = JSON.parse(body);
    } catch {
      data = body;
    }
  }
  return [
    {
      ...extensions,
      specversion: '1.0',
      id: header('ce-id') ?? randomUUID(),
      source: header('ce-source') ?? 'unknown',
      type,
      ...(time ? { time } : {}),
      ...(subject ? { subject } : {}),
      ...(contentType ? { datacontenttype: contentType } : {}),
      data
    }
  ];
}

/**
 * Starts an HTTP endpoint the system under test sends CloudEvents to (any content mode). Point the
 * product's event bus, webhook relay or OpenTelemetry collector's CloudEvents exporter at its `url`.
 *
 * It answers every valid POST with 202 and an unparseable delivery with 400, and keeps events in
 * memory. It does no authentication and listens on `127.0.0.1` unless `host` says otherwise, so
 * only the local machine can reach it by default. `mark()` is the number of events received so far.
 * Call `close()` to stop the server; `runPaths` does that for the sources it is given.
 *
 * @param options.port the port to listen on; an unused port when omitted (read the real one from `url`).
 * @param options.host the interface to listen on; `127.0.0.1` when omitted.
 *
 * @example
 * eventSources: async () => [await cloudEventsHttpSource({ port: 4318 })]
 */
export async function cloudEventsHttpSource(options: { port?: number; host?: string } = {}): Promise<EventSource & { url: string }> {
  const received: CloudEvent[] = [];
  const server: Server = createServer(async (req, res) => {
    try {
      const events = cloudEventsFromHttp(req.headers, await readBody(req));
      received.push(...events);
      res.writeHead(202).end();
    } catch {
      res.writeHead(400).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    name: 'cloudevents-http',
    url: `http://${options.host ?? '127.0.0.1'}:${port}/`,
    mark: () => received.length,
    collect: async (from) => ({ events: received.slice(typeof from === 'number' ? from : 0) }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

/**
 * An event source for products whose only event stream is a log file: `collect` returns the text
 * appended to the file since `mark` (match it with an `{ pattern }` matcher), and no CloudEvents.
 *
 * `mark()` is the file's size in bytes (0 when it does not exist). `collect` first waits `settleMs`
 * for the product to write, then reads from the mark to the end of the file; a missing or
 * unreadable file gives empty text, and a file that was truncated or rotated since the mark is not
 * detected. The source's name starts with `log:`, which is how the runner tells it from a CloudEvents source.
 *
 * @param file the log file path.
 * @param options.settleMs how long `collect` waits before reading, in milliseconds; 1000 when omitted.
 */
export function logFileSource(file: string, options: { settleMs?: number } = {}): EventSource {
  return {
    name: `log:${file}`,
    mark: () => {
      try {
        return statSync(file).size;
      } catch {
        return 0;
      }
    },
    collect: async (from) => {
      await new Promise((r) => setTimeout(r, options.settleMs ?? 1_000));
      const offset = typeof from === 'number' ? from : 0;
      try {
        const size = statSync(file).size;
        const length = Math.max(0, size - offset);
        const buffer = Buffer.alloc(length);
        const fd = openSync(file, 'r');
        readSync(fd, buffer, 0, length, offset);
        closeSync(fd);
        return { events: [], text: buffer.toString('utf8') };
      } catch {
        return { events: [], text: '' };
      }
    }
  };
}

/** The outcome of comparing a state's expected business events with what the sources collected. */
export type BusinessEventResult = {
  /** The names listed in the state's `meta.events`. */
  expected: string[];
  /** Expected names that a matcher (or a CloudEvent of that type) confirmed. */
  observed: string[];
  /** Expected names that could be observed but were not. */
  missing: string[];
  /** Expected names with no way to be observed (no matcher and no CloudEvents source). Not a failure. */
  noSignal: string[];
  /** The CloudEvents collected for this step. */
  events: CloudEvent[];
};

/**
 * Keeps what belongs to one attempt when attempts run side by side: events (whose JSON mentions an
 * id) and log lines that contain one of its correlation ids. Empty ids are ignored; with no ids,
 * everything is kept.
 */
export function correlated(collected: { events: CloudEvent[]; text: string }, ids: string[]) {
  const wanted = ids.filter(Boolean);
  if (!wanted.length) return collected;
  const mentions = (value: string) => wanted.some((id) => value.includes(id));
  return {
    events: collected.events.filter((e) => mentions(JSON.stringify(e))),
    text: collected.text.split('\n').filter(mentions).join('\n')
  };
}

/**
 * Compares the business events a state expects with what the sources saw, sorting each expected
 * name into `observed`, `missing` or `noSignal`. A business event is observed when its matcher
 * matches (a function gets the events and log text; `{ type }` compares CloudEvent types;
 * `{ pattern }` tests the log text); with no matcher, when a CloudEvent's `type` equals the name.
 * With neither a matcher nor any CloudEvents source (`hasCloudEvents` false) it is "no signal",
 * never "missing". Pure.
 *
 * @param matchers matchers by business event name.
 * @param hasCloudEvents whether any non-log source was configured.
 */
export function compareBusinessEvents(
  expected: string[],
  collected: { events: CloudEvent[]; text: string },
  matchers: Record<string, EventMatcher>,
  hasCloudEvents: boolean
): BusinessEventResult {
  const result: BusinessEventResult = { expected, observed: [], missing: [], noSignal: [], events: collected.events };
  for (const name of expected) {
    const matcher = matchers[name];
    let seen: boolean | null;
    if (typeof matcher === 'function') seen = matcher(collected.events, collected.text);
    else if (matcher && 'type' in matcher) seen = collected.events.some((e) => e.type === matcher.type);
    else if (matcher && 'pattern' in matcher) seen = matcher.pattern.test(collected.text);
    else seen = hasCloudEvents ? collected.events.some((e) => e.type === name) : null;
    if (seen === null) result.noSignal.push(name);
    else if (seen) result.observed.push(name);
    else result.missing.push(name);
  }
  return result;
}
