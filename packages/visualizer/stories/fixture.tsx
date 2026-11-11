import { useEffect, useMemo } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { createReportsApp } from '@crvouga/atlas/reports/reports-route';
import type { ObjectStore } from '@crvouga/atlas/reports/object-store';
import { ObjectStoreWithPrefix } from '@crvouga/atlas/reports/store-prefix';
import { specEntry } from '@crvouga/atlas/reports/spec-inventory';
import { ALL_SOURCES } from '@crvouga/atlas/reports/evidence-view';
import type { EvidencePage, LayerRows } from '@crvouga/atlas/reports/evidence-types';
import { availabilityOf, foldReviewed, manifestOf } from '@crvouga/atlas/reports/review-collection';
import { listReviewCollections, readReviewCollection, readReviewNotes, recordReviewCollection, recordReviewNote } from '@crvouga/atlas/reports/review-collection-store';
import { TestHistory, type ArtifactResult } from '@crvouga/atlas/reports/test-catalog';
import type { LiveRun, UiQueueSummary } from '@crvouga/atlas/schema';
import fixture from 'virtual:atlas-stories';
import { createAtlasRouter } from '../src/app/router';
import { AdapterContext, createQueryClient } from '../src/data/queries';
import { LoadError, type AtlasAdapter } from '../src/data/adapters';
import { useUiStore } from '../src/state/ui-store';
import { loadingPolicy } from '../src/evidence/load-state';
import { setFinderOpen, setHelpOpen } from '../src/find/open';
import { SettingsPage } from '../src/admin/SettingsPage';

/** What the report API answers: the whole fixture, nothing, never, an error, or one of the partial failures. */
export type FixtureState = 'populated' | 'empty' | 'loading' | 'error' | 'spec-error' | 'incomplete' | 'stalled';
/**
 * What an Atlas server adds around the report, each off unless asked for: the project list, the event stream, a run in
 * progress, the UI catalog's collection queue, a server that refuses changes, and one from before review collections.
 */
export type ServerFixture = {
  readonly projects?: 'listed' | 'unavailable' | 'unsupported';
  readonly live?: 'connected' | 'connecting' | 'reconnecting';
  readonly running?: boolean;
  readonly queue?: boolean;
  readonly readOnly?: boolean;
  readonly legacy?: boolean;
};
/** What the settings API answers: a refusal by status, and whether a garbage collection policy was saved before. */
export type SettingsFixture = { readonly failure?: 401 | 403 | 409; readonly policy?: boolean };
export type FixtureOptions = { readonly state?: FixtureState; readonly server?: ServerFixture; readonly settings?: SettingsFixture };
export type ScreenArgs = { at: string; state: FixtureState; server?: ServerFixture };

/** The fixture's present: every "ago" and every live timestamp is measured from here. */
const NOW = Date.parse('2026-11-04T12:00:00Z');
const never = () => new Promise<never>(() => {});
const problem = (status: number, detail: string) => Response.json({ title: 'Refused', status, detail }, { status });

function storeOf(seed: Record<string, { base64: string; contentType: string }> = {}): ObjectStore {
  const objects = new Map(Object.entries(seed));
  const store: ObjectStore = {
    async get(key) { const found = objects.get(key); return found ? { body: new Blob([Uint8Array.from(atob(found.base64), c => c.charCodeAt(0))]).stream(), contentType: found.contentType, size: atob(found.base64).length } : null; },
    async put(key, bytes, contentType) { objects.set(key, { base64: btoa(String.fromCharCode(...bytes)), contentType }); },
    async head(key) { return objects.has(key); },
    async delete(key) { objects.delete(key); },
    async deleteMany(keys) { for (const key of keys) objects.delete(key); },
    async listKeys(prefix = '') { return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort(); },
    async getUri() { return null; },
    withPrefix(prefix) { return new ObjectStoreWithPrefix(store, prefix); }
  };
  return store;
}

/** A run a producer reports while it is still going: two results in, one check running. */
const LIVE_RUN: LiveRun = {
  id: '5d0a2f0e-6c1b-4c53-9a44-3f1f6c1d2b7e', producer: 'storybook-review', title: 'Nightly review, in progress', environment: 'desktop-web', branch: 'main',
  sha: fixture.selection.commits.current, plannedChecks: 4, status: 'running', startedAtMs: NOW - 90_000, lastHeartbeatAtMs: NOW - 2_000, lastProgressAtMs: NOW - 5_000,
  sequence: 3, completed: 2, passed: 2, failed: 0, notRun: 0, running: 1,
  current: [{ id: 'pays-at-the-counter', title: 'Review recordings: Pays at the counter', status: 'running', detail: '', specPath: 'specs/storybook/review.feature',
    steps: [{ name: 'Given a customer at the counter', status: 'passed' }, { name: 'When the customer pays at the counter' }] }],
  recent: [
    { id: 'opens-the-menu', title: 'Review recordings: Opens the menu', status: 'passed', detail: '', specPath: 'specs/storybook/review.feature', durationMs: 3600 },
    { id: 'adds-a-drink', title: 'Review recordings: Adds a drink', status: 'passed', detail: '', specPath: 'specs/storybook/review.feature', durationMs: 4300 }
  ]
};

/** The collection queue of a server whose shards are part way through the catalog. */
const QUEUE: UiQueueSummary = {
  schemaVersion: 1, definition: { version: 'storybook-1', name: 'Coffee screens', states: 5, profiles: 2, items: 10, units: 10 },
  tiers: { failed: 1, empty: 2, unknown: 0, stale: 2, fresh: 4 }, held: 2, requeued: 1,
  exhausted: [{ unit: 'coffee/error@desktop-web', attempts: 3, collection: 'storybook-capture' }],
  unknown: { count: 0, units: [], notices: [] },
  claims: [{ claimId: 'claim-0001', shard: 'capture-1', units: 2, done: 1, createdAtMs: NOW - 42_000, expiresAtMs: NOW + 258_000, ageMs: 42_000 }],
  shards: [
    { shard: 'capture-1', status: 'active', claims: 1, units: 6, done: 5, failed: 1, lastSeenAtMs: NOW - 3_000 },
    { shard: 'capture-2', status: 'idle', claims: 0, units: 4, done: 4, failed: 0, lastSeenAtMs: NOW - 240_000 },
    { shard: 'capture-3', status: 'lost', claims: 0, units: 2, done: 0, failed: 0, lastSeenAtMs: NOW - 1_800_000 }
  ],
  throughput: { unitsPerMinute: 1.5, etaMs: 160_000 }, time: NOW
};

/** An event stream that opens, stays silent, or opens and is lost, without a network. */
function eventSource(live: NonNullable<ServerFixture['live']>) {
  return class FixtureEventSource {
    static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 2;
    readyState = 0;
    readonly #heard = new Map<string, ((event: Event) => void)[]>();
    readonly #timers: ReturnType<typeof setTimeout>[] = [];
    constructor(readonly url: string) {
      if (live === 'connecting') return;
      this.#timers.push(setTimeout(() => { this.readyState = 1; this.#say('open'); }, 0));
      if (live === 'reconnecting') this.#timers.push(setTimeout(() => { this.readyState = 0; this.#say('error'); }, 50));
    }
    #say(name: string) { for (const handler of this.#heard.get(name) ?? []) handler(new Event(name)); }
    addEventListener(name: string, handler: (event: Event) => void) { this.#heard.set(name, [...(this.#heard.get(name) ?? []), handler]); }
    removeEventListener() {}
    close() { this.readyState = 2; for (const timer of this.#timers) clearTimeout(timer); }
  };
}

/** The review collection routes of a server, answered from the fixture's own store with the published readers and writers. */
function reviewCollections(app: ReturnType<typeof createReportsApp>, store: ObjectStore, server: ServerFixture) {
  let reading: Promise<ArtifactResult[]> | null = null;
  const recorded = () => (reading ??= (async () => {
    const history = new TestHistory();
    for (let cursor: string | null = null; ;) {
      const page: EvidencePage = await (await app.request(`/evidence${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)).json();
      for (const layer of page.layers) {
        const rows = await (await app.request(`/evidence/rows/${layer.backend}/${layer.id}`)).json() as LayerRows;
        history.add(layer, rows.rows, [], layer.backend, rows.fingerprints);
      }
      cursor = page.cursor;
      if (!cursor) break;
    }
    return history.evidenceResults().map(entry => entry.result);
  })());
  return async (request: Request, url: URL): Promise<Response> => {
    if (server.legacy) return problem(404, 'Not found.');
    const route = url.pathname.slice('/api/reports/review-collections'.length);
    const results = await recorded();
    const find = (layer: string, check: string, kind: string | undefined) => results.filter(item => item.layer === layer && item.id === check && (kind === undefined || item.kind === kind));
    if (request.method === 'POST') {
      if (server.readOnly) return problem(401, 'This server needs a token that may publish.');
      const input: unknown = await request.json();
      return Response.json(route === '/reviews' ? await recordReviewNote(store, input, 'storybook', NOW) : await recordReviewCollection(store, input, 'storybook', NOW, find), { status: 201 });
    }
    if (route === '') {
      const collections = (await listReviewCollections(store)).map(({ collection, revisions }) => ({
        id: collection.id, revision: collection.revision, revisions, title: collection.title, purpose: collection.purpose, audience: collection.audience,
        tags: collection.tags, entries: collection.entries.length, gaps: collection.gaps.length, createdBy: collection.createdBy, createdAtMs: collection.createdAtMs
      }));
      return Response.json({ schemaVersion: 1, collections });
    }
    const found = await readReviewCollection(store, url.searchParams.get('id') ?? '', Number(url.searchParams.get('revision')) || undefined);
    if (!found) return problem(404, 'No such collection or revision.');
    const notes = (await readReviewNotes(store, found.collection.id)).filter(note => note.revision === found.collection.revision);
    const availability = availabilityOf(found.collection, () => true, find);
    const reviewed = foldReviewed(notes);
    if (route === '/export') return Response.json(manifestOf(found.collection, availability, reviewed, NOW));
    return Response.json({ schemaVersion: 1, collection: found.collection, revisions: found.revisions, availability, reviews: notes, reviewed });
  };
}

/** The settings API of a server: the saved settings, the garbage collection policy and its runs, or a refusal. */
async function settingsApi(request: Request, url: URL, settings: SettingsFixture): Promise<Response> {
  const { failure, policy } = settings;
  if (failure && (failure !== 409 || request.method === 'PUT')) {
    return Response.json({ detail: failure === 409 ? 'Settings changed on the server. Reload before saving.' : failure === 403 ? 'This token may read reports but may not change settings.' : 'The token is invalid or has expired.' }, { status: failure });
  }
  const lastRuns = policy ? [
    { project: 'default', dryRun: false, at: '2026-11-04T06:00:00Z', candidates: 14, deletedLayers: 12, deletedBlobs: 31, keptLayers: 48 },
    { project: 'todo', dryRun: false, at: '2026-11-04T06:00:04Z', candidates: 3, deletedLayers: 0, deletedBlobs: 0, keptLayers: 20, error: 'The store refused a delete (503).' }
  ] : [];
  const saved = policy ? { enabled: true, maxAgeDays: 30, keepLatest: 10, intervalHours: 12 } : null;
  if (url.pathname.endsWith('/gc/run')) return Response.json({ runs: [{ project: 'default', dryRun: true, at: '2026-11-04T12:00:00Z', candidates: 3, deletedLayers: 0, deletedBlobs: 0, keptLayers: 57 }] });
  if (url.pathname.endsWith('/gc')) {
    return request.method === 'PUT'
      ? Response.json({ revision: 'storybook-2', policy: await request.json(), saved: true, lastRuns })
      : Response.json({ revision: 'storybook-1', policy: saved, saved: !!saved, lastRuns });
  }
  const active = { refreshSeconds: 10, heartbeatSeconds: 15, runTimeoutSeconds: 30, runStallSeconds: policy ? 600 : 900 };
  if (request.method === 'PUT') return Response.json({ revision: 'storybook-2', settings: await request.json(), active, restartRequired: true });
  return Response.json({ revision: 'storybook-1', settings: policy ? { runStallSeconds: 600, outlineBranch: 'main', include: { branches: ['main', 'release'] } } : {}, active, restartRequired: false });
}

/** Installs only local fixture requests; all other requests continue to the real browser fetch. Returns the cleanup. */
export function installFixture({ state = 'populated', server, settings = {} }: FixtureOptions = {}) {
  const nativeFetch = globalThis.fetch;
  const scope = globalThis as { __ATLAS_CONFIG__?: unknown; EventSource?: unknown };
  const held = { config: scope.__ATLAS_CONFIG__, events: scope.EventSource, stallMs: loadingPolicy.stallMs };
  if (state === 'stalled') loadingPolicy.stallMs = 100;
  // The address book a server writes into its page. Without it the viewer is a static report: no projects, no live updates.
  scope.__ATLAS_CONFIG__ = server ? { api: '/api', reportsUrl: '/api/reports', ...(server.projects ? { projectsUrl: '/api/projects' } : {}), ...(server.live ? { eventsUrl: '/api/events' } : {}) } : undefined;
  if (server?.live) scope.EventSource = eventSource(server.live);
  const specs = state === 'empty' ? {} : fixture.specs;
  const populated = state !== 'empty';
  const shared = storeOf(populated ? fixture.stores.shared : undefined);
  const app = createReportsApp({
    store: shared,
    localStore: storeOf(populated ? fixture.stores.local : undefined),
    backends: [{ id: 'device-lab', label: 'Device lab', store: storeOf(populated ? fixture.stores['device-lab'] : undefined) }],
    clock: { now: () => NOW },
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>)
    },
    outline: async () => ({ specs: Object.keys(specs).map((path) => specEntry(`specs/${path}`, specs[path]!)), sha: fixture.selection.commits.current, changedFiles: [], readSpec: async (path) => specs[path.replace(/^specs\//, '')] ?? null })
  });
  const collections = reviewCollections(app, shared, server ?? {});
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(new URL(String(input), window.location.href), init);
    const url = new URL(request.url);
    if (url.origin !== window.location.origin) return nativeFetch(input, init);
    if (url.pathname.startsWith('/api/settings')) return settingsApi(request, url, settings);
    if (url.pathname.startsWith('/api/reports')) {
      if (state === 'loading') return never();
      if (state === 'incomplete' && url.pathname.includes('/evidence/rows/shared/')) return Response.json({ error: 'layer_unreadable' }, { status: 503 });
      if (state === 'error') return Response.json({ error: 'reports_unavailable' }, { status: 503 });
      if (url.pathname.startsWith('/api/reports/review-collections')) return collections(request, url);
      if (server?.readOnly && request.method !== 'GET') return problem(401, 'This server needs a token that may publish.');
      const answer = await app.request(url.pathname.slice('/api/reports'.length) + url.search, init);
      if (!server?.running || url.pathname !== '/api/reports/evidence' || !answer.ok) return answer;
      const page = await answer.json() as EvidencePage;
      return Response.json({ ...page, active: [{ source: 'shared', packageDir: 'packages/storybook-review', bucket: 'main', startedAtMs: LIVE_RUN.startedAtMs, plannedChecks: 4, completed: 2, failed: 0 }] });
    }
    if (url.pathname === '/api/live') return Response.json({ runs: server?.running ? [LIVE_RUN] : [] });
    if (url.pathname === '/api/projects') {
      if (server?.projects === 'listed') return Response.json({ projects: [{ slug: 'default', name: 'Coffee shop' }, { slug: 'todo', name: 'Todo lists' }, { slug: 'mobile-app', name: 'Mobile app' }] });
      return problem(server?.projects === 'unavailable' ? 503 : 404, 'Projects are not available.');
    }
    if (url.pathname === '/api/ui-catalog/queue') return server?.queue ? Response.json(QUEUE) : problem(404, 'Not found.');
    return nativeFetch(input, init);
  }) as typeof fetch;
  setFinderOpen(false);
  setHelpOpen(false);
  useUiStore.setState({ excluded: ALL_SOURCES, resultFilter: 'all', sourcesOpen: false });
  return () => {
    globalThis.fetch = nativeFetch;
    scope.__ATLAS_CONFIG__ = held.config;
    scope.EventSource = held.events;
    loadingPolicy.stallMs = held.stallMs;
    setFinderOpen(false);
    setHelpOpen(false);
  };
}

/** A real viewer router and providers, with fresh query caches for each story. */
export function Screen({ at, state }: ScreenArgs) {
  const instance = useMemo(() => {
    const specs = state === 'empty' ? {} : fixture.specs;
    const adapter: AtlasAdapter = {
      kind: 'dev', label: 'Storybook fixtures',
      specIndex: async () => state === 'loading' ? never() : ({ schemaVersion: 1, generatedAt: '2026-11-04T12:00:00Z', files: Object.keys(specs) }),
      specFile: async (path) => {
        if (state === 'loading' || state === 'stalled') return never();
        if (state === 'spec-error') throw new LoadError(path, 503, 'This specification could not be read. Try again.');
        if (!(path in specs)) throw new LoadError(path, 404, 'The file is not there.');
        return specs[path]!;
      },
      runsIndex: async () => ({ schemaVersion: 1, runs: [] }), manifest: async () => ({}), manifestPath: (id) => id,
      mediaUrl: (_, path) => path, subscribe: null
    };
    return { adapter, router: createAtlasRouter(createMemoryHistory({ initialEntries: [at] })), client: createQueryClient() };
  }, [at, state]);
  useEffect(() => () => instance.client.clear(), [instance]);
  return <AdapterContext.Provider value={instance.adapter}><QueryClientProvider client={instance.client}><RouterProvider router={instance.router} /></QueryClientProvider></AdapterContext.Provider>;
}
export { SettingsPage };
