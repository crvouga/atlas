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

/** Parse an HTTP delivery in either CloudEvents content mode (structured, binary or batch). */
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
      ...(header('ce-time') ? { time: header('ce-time') } : {}),
      ...(header('ce-subject') ? { subject: header('ce-subject') } : {}),
      ...(contentType ? { datacontenttype: contentType } : {}),
      data
    }
  ];
}

/**
 * An HTTP endpoint the system under test sends CloudEvents to (any content mode). Point the
 * product's event bus, webhook relay or OpenTelemetry collector's CloudEvents exporter at it.
 */
export async function cloudEventsHttpSource(options: { port?: number; host?: string } = {}): Promise<EventSource & { url: string }> {
  const received: CloudEvent[] = [];
  let mark = 0;
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
    mark: () => {
      mark = received.length;
    },
    collect: async () => ({ events: received.slice(mark) }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

/** Lines appended to a log file during a step, for products whose only event stream is a log. */
export function logFileSource(file: string, options: { settleMs?: number } = {}): EventSource {
  let offset = 0;
  return {
    name: `log:${file}`,
    mark: () => {
      try {
        offset = statSync(file).size;
      } catch {
        offset = 0;
      }
    },
    collect: async () => {
      await new Promise((r) => setTimeout(r, options.settleMs ?? 1_000));
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

export type BusinessEventResult = {
  expected: string[];
  observed: string[];
  missing: string[];
  noSignal: string[];
  events: CloudEvent[];
};

/**
 * Compare the business events a state expects with what the sources saw. A business event is
 * observed when its matcher matches; with no matcher, a CloudEvent whose `type` equals the name.
 * Events with neither a matcher nor any CloudEvents source are "no signal", never "missing".
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
