import { useEffect, useMemo } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { createReportsApp } from '@crvouga/atlas/reports/reports-route';
import type { ObjectStore } from '@crvouga/atlas/reports/object-store';
import { ObjectStoreWithPrefix } from '@crvouga/atlas/reports/store-prefix';
import { specEntry } from '@crvouga/atlas/reports/spec-inventory';
import { ALL_SOURCES } from '@crvouga/atlas/reports/evidence-view';
import fixture from 'virtual:atlas-stories';
import { createAtlasRouter } from '../src/app/router';
import { AdapterContext, createQueryClient } from '../src/data/queries';
import { LoadError, type AtlasAdapter } from '../src/data/adapters';
import { useUiStore } from '../src/state/ui-store';
import { loadingPolicy } from '../src/evidence/load-state';
import { setFinderOpen } from '../src/find/open';
import { SettingsPage } from '../src/admin/SettingsPage';

export type FixtureState = 'populated' | 'empty' | 'loading' | 'error' | 'spec-error' | 'incomplete' | 'stalled';
export type ScreenArgs = { at: string; state: FixtureState };
const never = () => new Promise<never>(() => {});
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

/** Installs only local fixture requests; all other requests continue to the real browser fetch. */
export function installFixture(state: FixtureState = 'populated', settingsFailure?: number) {
  const nativeFetch = globalThis.fetch;
  const stallMs = loadingPolicy.stallMs;
  if (state === 'stalled') loadingPolicy.stallMs = 100;
  const specs = state === 'empty' ? {} : fixture.specs;
  const populated = state !== 'empty';
  const app = createReportsApp({
    store: storeOf(populated ? fixture.stores.shared : undefined),
    localStore: storeOf(populated ? fixture.stores.local : undefined),
    backends: [{ id: 'device-lab', label: 'Device lab', store: storeOf(populated ? fixture.stores['device-lab'] : undefined) }],
    clock: { now: () => Date.parse('2026-11-04T12:00:00Z') },
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>)
    },
    outline: async () => ({ specs: Object.keys(specs).map((path) => specEntry(`specs/${path}`, specs[path]!)), sha: 'c0ffee' + '1'.repeat(34), changedFiles: [], readSpec: async (path) => specs[path.replace(/^specs\//, '')] ?? null })
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(new URL(String(input), window.location.href), init);
    const url = new URL(request.url);
    if (url.origin !== window.location.origin) return nativeFetch(input, init);
    if (url.pathname.startsWith('/api/settings')) {
      if (settingsFailure && (settingsFailure !== 409 || request.method === 'PUT')) return Response.json({ detail: settingsFailure === 409 ? 'Settings changed on the server. Reload before saving.' : 'The token is invalid or has expired.' }, { status: settingsFailure });
      if (url.pathname.endsWith('/gc/run')) return Response.json({ runs: [] });
      if (url.pathname.endsWith('/gc')) return Response.json({ revision: 'storybook-1', policy: null, saved: false, lastRuns: [] });
      return Response.json({ revision: 'storybook-1', settings: {}, active: { refreshSeconds: 10 }, restartRequired: false });
    }
    if (url.pathname.startsWith('/api/reports')) {
      if (state === 'loading') return never();
      if (state === 'incomplete' && url.pathname.includes('/evidence/rows/shared/')) return Response.json({ error: 'layer_unreadable' }, { status: 503 });
      if (state === 'error') return Response.json({ error: 'reports_unavailable' }, { status: 503 });
      return app.request(url.pathname.slice('/api/reports'.length) + url.search, init);
    }
    if (url.pathname === '/api/live') return Response.json({ runs: [] });
    return nativeFetch(input, init);
  }) as typeof fetch;
  setFinderOpen(false);
  useUiStore.setState({ excluded: ALL_SOURCES, resultFilter: 'all', sourcesOpen: false });
  return () => { globalThis.fetch = nativeFetch; loadingPolicy.stallMs = stallMs; setFinderOpen(false); };
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
