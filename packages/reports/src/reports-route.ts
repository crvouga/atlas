/**
 * @module Reports HTTP API
 *
 * The HTTP API behind the viewer, as one Hono app: the layer routes of `layers-route.ts`, the explorer routes, and the
 * read-only commit-keyed routes for recordings written before layers existed. Every route is a GET (or HEAD) with
 * `cache-control: no-store` unless a layer route says otherwise, and CORS reflects the caller's origin. Nothing here
 * writes. Mounted at `/api/reports` by `reportsHost` and by the Atlas server.
 *
 * Commit-keyed routes (`:sha` is a 40-hex commit; anything else is 404 `not_found`, no store configured is 503
 * `reports_unavailable`):
 * - `GET /` commits with a report, newest first (`?cursor=`), see `reportsListRoute`.
 * - `GET /:sha` one commit's run record.
 * - `GET /:sha/events` Server-Sent Events: the commit, then each source as it is read. A running commit stays open and
 *   sends new sources as they are published, for at most `REPORTS_TAIL_MS`; `?have=a,b` skips sources a reconnecting
 *   client already holds.
 * - `GET /:sha/sources` every source record of the commit, merged from the shared and the local store.
 * - `GET /:sha/frame.css` the stylesheet its snapshots render with.
 * - `GET /:sha/tests/:source/:testId` one test's timeline without frames.
 * - `GET /:sha/tests/:source/:testId/files/*` one frame file.
 * - `GET /:sha/tests/:source/:testId/events` a test, then its frames, as Server-Sent Events.
 * - `GET /:sha/explorer` and `GET /:sha/spec?path=` see `createReportsExplorerApp`.
 *
 * @see docs/server.md
 */
import type { LiveSource } from './evidence-live';
import type { ReportOutline } from './layer-types';
import { createLayersApp, type ReportBackend } from './layers-route';

import type { Clock, Timers } from './clock';
import {
  isCommitSha,
  isFramePath,
  isKeySegment,
} from './keys';
import type {
  CommitEvent,
  TestEvent,
} from './protocol';
import {
  EVENT_STREAM_CONTENT_TYPE,
  encodeSseEvent,
} from './protocol';
import {
  commitEvents,
  readCommit,
  readFrameBody,
  readFrameCss,
  readTestReport,
  testEvents,
} from './read';
import type { ObjectStore } from './object-store';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  createReportsExplorerApp,
  type ReportsExplorerDeps,
} from './reports-explorer-route';
import { reportsListRoute } from './reports-list-route';
import {
  reportsSources,
  reportsStoreForCommit,
  reportsStoreForSource,
} from './reports-store';

/** Intended commits per page of the commit list. The list route currently pages by its own constant of the same value (30) and does not read this one. */
export const REPORTS_PAGE_SIZE = 30;
/** How often, in milliseconds, a running commit's event stream re-lists the store for new sources. */
export const REPORTS_POLL_MS = 2_000;
/** How long, in milliseconds, a running commit's event stream stays open before it ends; the client reconnects. */
export const REPORTS_TAIL_MS = 5 * 60_000;

/** What `createReportsApp` and `createLayersApp` need from their host: stores, an outline of current specs, and time. */
export type ReportsAppDeps = ReportsExplorerDeps & {
  /** Loads the current specs (and the text of each) every report is laid over. Without it `GET /outline` answers 503. */
  readonly outline?: () => Promise<ReportOutline & { readSpec: (path: string) => Promise<string | null> }>;
  /** Leave layers out of the report, in every route. */
  readonly include?: (layer: import('./evidence-types').LayerHeader) => boolean;
  /** Further stores whose layers join the combined report beside `localStore` and `store`. */
  readonly backends?: readonly ReportBackend[];
  /** Results of spec runs that are still running on this machine. */
  readonly live?: LiveSource;
  /** The shared reports store; null when this deployment has no credential. */
  readonly store: ObjectStore | null;
  /** Time source; injected so caches and polling are testable. */
  readonly clock: Clock;
  /** Timer functions for the event streams; injected so tests need no real time. */
  readonly timers: Timers;
};

const NO_STORE = { 'cache-control': 'no-store' } as const;

function eventStream(
  events: AsyncGenerator<CommitEvent | TestEvent>
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await events.next();
      if (next.done === true) controller.close();
      else controller.enqueue(encoder.encode(encodeSseEvent(next.value)));
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': EVENT_STREAM_CONTENT_TYPE,
      'x-accel-buffering': 'no',
      ...NO_STORE,
    },
  });
}

function bytesResponse(
  bytes: Uint8Array,
  headers: Record<string, string>
): Response {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Response(copy, { status: 200, headers });
}

function frameFileParam(raw: string | undefined): string | null {
  if (raw === undefined || raw.length === 0) return null;
  let file: string;
  try {
    file = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isFramePath(file) ? file : null;
}

function haveSources(raw: string | undefined): ReadonlySet<string> {
  return new Set((raw ?? '').split(',').filter(isKeySegment));
}

function unavailable(): Response {
  return Response.json(
    { error: 'reports_unavailable' },
    { status: 503, headers: NO_STORE }
  );
}

function notFound(): Response {
  return Response.json(
    { error: 'not_found' },
    { status: 404, headers: NO_STORE }
  );
}

async function storeOf(
  deps: ReportsAppDeps,
  sha: string,
  source?: string
): Promise<NonNullable<ReportsAppDeps['store']> | Response> {
  if (!isCommitSha(sha)) return notFound();
  return (
    (await (source === undefined
      ? reportsStoreForCommit(deps, sha)
      : reportsStoreForSource(deps, sha, source))) ?? unavailable()
  );
}

function testParams(c: Context):
  | Response
  | {
      readonly sha: string;
      readonly source: string;
      readonly testId: string;
    } {
  const sha = c.req.param('sha');
  const source = c.req.param('source');
  const testId = c.req.param('testId');
  if (
    sha === undefined ||
    source === undefined ||
    testId === undefined ||
    !isCommitSha(sha) ||
    !isKeySegment(source) ||
    !isKeySegment(testId)
  ) {
    return notFound();
  }
  return { sha, source, testId };
}

function sourcesRoute(deps: ReportsAppDeps) {
  return async (c: Context) => {
    const sha = c.req.param('sha') ?? '';
    const store = await storeOf(deps, sha);
    if (store instanceof Response) return store;
    const sources = await reportsSources(deps, sha);
    return c.json({ sources }, 200, NO_STORE);
  };
}

function testRoute(deps: ReportsAppDeps) {
  return async (c: Context) => {
    const params = testParams(c);
    if (params instanceof Response) return params;
    const store = await storeOf(deps, params.sha, params.source);
    if (store instanceof Response) return store;
    const report = await readTestReport(store, params);
    if (report === null) return notFound();
    return c.json(report, 200, NO_STORE);
  };
}

/** Hono's tail `*` matches the rest of the path and does not expose it. */
function frameFileOf(
  url: string,
  params: { readonly source: string; readonly testId: string }
): string | null {
  const marker = `/tests/${params.source}/${params.testId}/files/`;
  const path = new URL(url).pathname;
  const at = path.indexOf(marker);
  if (at < 0) return null;
  return frameFileParam(path.slice(at + marker.length));
}

function fileRoute(deps: ReportsAppDeps) {
  return async (c: Context) => {
    const params = testParams(c);
    if (params instanceof Response) return params;
    const file = frameFileOf(c.req.url, params);
    if (file === null) return notFound();
    const store = await storeOf(deps, params.sha, params.source);
    if (store instanceof Response) return store;
    const body = await readFrameBody(store, { ...params, file });
    if (body === null) return notFound();
    return bytesResponse(body.bytes, {
      'content-type': body.contentType,
      ...NO_STORE,
    });
  };
}

function testEventsRoute(deps: ReportsAppDeps) {
  return async (c: Context) => {
    const params = testParams(c);
    if (params instanceof Response) return params;
    const store = await storeOf(deps, params.sha, params.source);
    if (store instanceof Response) return store;
    return eventStream(testEvents(store, params));
  };
}

/**
 * Builds the complete reports app (layer routes, explorer routes and the commit-keyed routes). Read-only: nothing it
 * serves can change a store. CORS reflects any caller's origin for GET, HEAD and OPTIONS.
 *
 * @example
 * const app = createReportsApp({ store: null, backends: [{ id: 'ci', label: 'CI', store }], clock: { now: Date.now }, timers });
 * const response = await app.request('/evidence');
 */
export function createReportsApp(deps: ReportsAppDeps) {
  return new Hono()
    .use('*', cors({ origin: (origin) => origin, allowMethods: ['GET', 'HEAD', 'OPTIONS'] }))
    .route('/', createLayersApp(deps))
    .route('/', createReportsExplorerApp(deps))
    .get('/', reportsListRoute(deps))
    .get('/:sha', async (c) => {
      const sha = c.req.param('sha');
      if (!isCommitSha(sha)) return notFound();
      const store = await storeOf(deps, sha);
      if (store instanceof Response) return store;
      const commit = await readCommit(store, sha);
      return commit === null ? notFound() : c.json(commit, 200, NO_STORE);
    })
    .get('/:sha/events', async (c) => {
      const sha = c.req.param('sha');
      if (!isCommitSha(sha)) return notFound();
      const store = await storeOf(deps, sha);
      if (store instanceof Response) return store;
      return eventStream(
        commitEvents(store, sha, {
          clock: deps.clock,
          timers: deps.timers,
          have: haveSources(c.req.query('have')),
          pollMs: REPORTS_POLL_MS,
          tailMs: REPORTS_TAIL_MS,
        })
      );
    })
    .get('/:sha/sources', sourcesRoute(deps))
    .get('/:sha/frame.css', async (c) => {
      const sha = c.req.param('sha');
      if (!isCommitSha(sha)) return notFound();
      const store = await storeOf(deps, sha);
      if (store instanceof Response) return store;
      const css = await readFrameCss(store, sha);
      if (css === null) return notFound();
      return new Response(css.body, {
        status: 200,
        headers: {
          'content-type': css.contentType,
          ...NO_STORE,
        },
      });
    })
    .get('/:sha/tests/:source/:testId', testRoute(deps))
    .get('/:sha/tests/:source/:testId/files/*', fileRoute(deps))
    .get('/:sha/tests/:source/:testId/events', testEventsRoute(deps));
}
