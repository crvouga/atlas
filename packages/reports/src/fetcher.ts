/**
 * @module Cacheable reads of a commit-keyed reports API
 *
 * The client side of the older, commit-addressed reports API (`/<sha>/explorer`, `/<sha>/spec`,
 * `/<sha>/sources`, `/<sha>/tests/<source>/<testId>`, ...). Commit pages, sources, stylesheets and
 * test timelines go through TanStack Query. Frame files also land in
 * `ReportCache` (IndexedDB on the wall, a map in tests) so a scrub reads
 * bytes the browser already kept, without putting multi-megabyte HTML into
 * the query document. A 503 from the API means reports are not available and throws {@link ReportsUnavailable};
 * a 404 for a spec, test or frame is answered as `null` (or an empty stylesheet), not an error.
 */

import type { ExplorerData } from './explorer-types';
import type {
  CommitPage,
  SourceRecord,
} from './protocol';
import type { HtmlReportBlob } from './recording-bundle';
import type { RunReport } from './report-types';
import type { HttpClient } from './http';
import { QueryClient } from '@tanstack/solid-query';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Thrown when the reports API answers 503: no reports store is configured or reachable. Its message is `reports_unavailable`. */
export class ReportsUnavailable extends Error {
  constructor() {
    super('reports_unavailable');
    this.name = 'ReportsUnavailable';
  }
}

/** String store the query persister and frame files share. */
export type ReportCache = {
  /** The saved value, or null when there is none. */
  get(key: string): Promise<string | null>;
  /** Saves a value, replacing any under the key. */
  set(key: string, value: string): Promise<void>;
  /** Forgets a key; a missing key is not an error. */
  remove(key: string): Promise<void>;
};

/** A {@link ReportCache} held in a `Map`, lost on reload. For tests and hosts without persistent storage. */
export function memoryReportCache(): ReportCache {
  const map = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(map.get(key) ?? null),
    set: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

/** Creates the TanStack `QueryClient` the fetcher expects: results stay fresh 5 minutes, are kept 1 day, and are neither retried nor refetched on window focus. */
export function reportQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * MINUTE,
        gcTime: DAY,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** The TanStack query keys of each read, so a host can invalidate or persist them. Every key starts with `reports`. */
export const reportQueryKey = {
  commits: ['reports', 'commits'] as const,
  explorer: (sha: string) => ['reports', 'explorer', sha] as const,
  spec: (sha: string, path: string) => ['reports', 'spec', sha, path] as const,
  sources: (sha: string) => ['reports', 'sources', sha] as const,
  css: (sha: string) => ['reports', 'css', sha] as const,
  test: (sha: string, source: string, testId: string) =>
    ['reports', 'test', sha, source, testId] as const,
  blob: (sha: string, source: string, testId: string, file: string) =>
    ['reports', 'blob', sha, source, testId, file] as const,
};

/** The reads the explorer makes. Rejections are `ReportsUnavailable` (503) or an `Error` naming the HTTP status. */
export type ReportFetcher = {
  /** The specs and parts recorded for a commit. Never served from a stale query (always refetched). */
  explorer(sha: string): Promise<ExplorerData>;
  /** The text of one spec of a commit, or null when it is not there. */
  spec(sha: string, path: string): Promise<string | null>;
  /** One page of commits; pass the previous page's `cursor`, or null for the first page. */
  commits(cursor: string | null): Promise<CommitPage>;
  /** The spec-run sources of a commit. */
  sources(sha: string): Promise<readonly SourceRecord[]>;
  /** The stylesheet snapshots of a commit render with; empty when there is none. */
  frameCss(sha: string): Promise<string>;
  /** One recorded test's report, or null when it is not there. */
  test(sha: string, source: string, testId: string): Promise<RunReport | null>;
  /** One captured file of a test, or null when it is missing (a missing file is retried on the next call). Resolved from the `ReportCache` before the network. */
  blob(
    sha: string,
    source: string,
    testId: string,
    file: string
  ): Promise<HtmlReportBlob | null>;
};

/** What {@link createHttpReportFetcher} needs. */
export type ReportFetcherArgs = {
  /** The HTTP client used for every request. */
  readonly http: HttpClient;
  /** The URL prefix of the reports API, prepended to each path with no added slash (for example `/api/reports`). */
  readonly apiBase: string;
  /** The query cache; see {@link reportQueryClient}. */
  readonly client: QueryClient;
  /** Where captured frame files are kept between visits. */
  readonly cache: ReportCache;
};

function apiUrl(apiBase: string, path: string): string {
  return `${apiBase}${path}`;
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 503) throw new ReportsUnavailable();
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

function isTextType(contentType: string): boolean {
  const type = contentType.toLowerCase();
  return (
    type.startsWith('text/') || type.includes('json') || type.includes('xml')
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function decodeBlob(response: Response): Promise<HtmlReportBlob | null> {
  if (response.status === 404) return null;
  if (response.status === 503) throw new ReportsUnavailable();
  if (!response.ok) throw new Error(String(response.status));
  const contentType =
    response.headers.get('content-type') ?? 'application/octet-stream';
  if (isTextType(contentType))
    return { contentType, text: await response.text() };
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { contentType, base64: toBase64(bytes) };
}

function cachedBlob(raw: string | null): HtmlReportBlob | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as HtmlReportBlob;
    return typeof parsed.contentType === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function missingFrame(): Error {
  const error = new Error('missing_frame');
  error.name = 'MissingFrame';
  return error;
}

function isMissingFrame(error: unknown): boolean {
  return error instanceof Error && error.name === 'MissingFrame';
}

async function loadBlob(
  args: ReportFetcherArgs,
  path: string,
  key: string
): Promise<HtmlReportBlob | null> {
  const saved = cachedBlob(await args.cache.get(key));
  if (saved !== null) return saved;
  const blob = await decodeBlob(
    await args.http.fetch(apiUrl(args.apiBase, path))
  );
  if (blob !== null) await args.cache.set(key, JSON.stringify(blob));
  return blob;
}

type BlobRef = {
  readonly sha: string;
  readonly source: string;
  readonly testId: string;
  readonly file: string;
};

/** A 404 is not a successful query, so a later scrub can try the file again. */
async function fetchBlob(
  args: ReportFetcherArgs,
  ref: BlobRef
): Promise<HtmlReportBlob | null> {
  const key = reportQueryKey.blob(ref.sha, ref.source, ref.testId, ref.file);
  try {
    return await args.client.fetchQuery({
      queryKey: key,
      staleTime: Number.POSITIVE_INFINITY,
      retry: false,
      queryFn: async () => {
        const path = blobPath(ref.sha, ref.source, ref.testId, ref.file);
        const blob = await loadBlob(args, path, key.join('\n'));
        if (blob === null) throw missingFrame();
        return blob;
      },
    });
  } catch (error) {
    if (isMissingFrame(error)) return null;
    throw error;
  }
}

function blobPath(
  sha: string,
  source: string,
  testId: string,
  file: string
): string {
  const encoded = file
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `/${sha}/tests/${encodeURIComponent(source)}/${encodeURIComponent(testId)}/files/${encoded}`;
}

/** Creates a {@link ReportFetcher} over HTTP with query-cached reads. Frame files resolve from `cache` before the network. */
export function createHttpReportFetcher(
  args: ReportFetcherArgs
): ReportFetcher {
  const { http, apiBase, client } = args;
  return {
    explorer: (sha) =>
      client.fetchQuery({
        queryKey: reportQueryKey.explorer(sha),
        staleTime: 0,
        queryFn: async () =>
          readJson<ExplorerData>(
            await http.fetch(apiUrl(apiBase, `/${sha}/explorer`))
          ),
      }),
    spec: (sha, path) =>
      client.fetchQuery({
        queryKey: reportQueryKey.spec(sha, path),
        queryFn: async () => {
          const response = await http.fetch(
            apiUrl(apiBase, `/${sha}/spec?path=${encodeURIComponent(path)}`)
          );
          if (response.status === 404) return null;
          if (response.status === 503) throw new ReportsUnavailable();
          if (!response.ok)
            throw new Error(`Reports API answered ${response.status}`);
          return response.text();
        },
      }),
    commits: (cursor) =>
      client.fetchQuery({
        queryKey: [...reportQueryKey.commits, cursor ?? ''],
        queryFn: async () => {
          const query =
            cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`;
          return readJson<CommitPage>(await http.fetch(apiUrl(apiBase, query)));
        },
      }),
    sources: (sha) =>
      client.fetchQuery({
        queryKey: reportQueryKey.sources(sha),
        queryFn: async () => {
          const page = await readJson<{ sources: readonly SourceRecord[] }>(
            await http.fetch(apiUrl(apiBase, `/${sha}/sources`))
          );
          return page.sources;
        },
      }),
    frameCss: (sha) =>
      client.fetchQuery({
        queryKey: reportQueryKey.css(sha),
        queryFn: async () => {
          const response = await http.fetch(
            apiUrl(apiBase, `/${sha}/frame.css`)
          );
          if (response.status === 404) return '';
          if (response.status === 503) throw new ReportsUnavailable();
          if (!response.ok) throw new Error(String(response.status));
          return response.text();
        },
      }),
    test: (sha, source, testId) =>
      client.fetchQuery({
        queryKey: reportQueryKey.test(sha, source, testId),
        queryFn: async () => {
          const response = await http.fetch(
            apiUrl(
              apiBase,
              `/${sha}/tests/${encodeURIComponent(source)}/${encodeURIComponent(testId)}`
            )
          );
          if (response.status === 404) return null;
          return readJson<RunReport>(response);
        },
      }),
    blob: (sha, source, testId, file) =>
      fetchBlob(args, { sha, source, testId, file }),
  };
}
