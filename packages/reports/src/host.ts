import path from 'node:path';

import { openStore, storeId, storeSpecs } from './store-url';

import type { BackendInput } from './compose';
import { loadDirectoryOutline } from './directory-outline';
import { createReportsApp } from './reports-route';

export type ReportsHostOptions = {
  /** The specs directory, relative to the project. Its files are the outline every layer fills. */
  readonly specs: string;
  /**
   * Where layers are: a directory, an `s3://` URL, or any backend. Several stores are one report: layers
   * from all of them are laid over the same specs. Default: `ATLAS_STORE`.
   */
  readonly stores?: readonly (string | BackendInput)[];
  /** Groups the specs in the viewer. */
  readonly domain?: string;
};

const PREFIX = '/api/reports';

/**
 * The reports half of the viewer, for a project's own stores. Export it from the module that
 * `ATLAS_REPORTS_MODULE` names:
 *
 * ```ts
 * import { reportsHost } from '@crvouga/atlas/reports/host';
 * export const reportsDevFetch = reportsHost({ specs: './specs', stores: ['./atlas-reports'] });
 * ```
 */
export function reportsHost(options: ReportsHostOptions): (request: Request, repoRoot: string) => Promise<Response> {
  let app: ReturnType<typeof createReportsApp> | undefined;
  let root = '';
  return async (request, repoRoot) => {
    if (!app || root !== repoRoot) {
      root = repoRoot;
      // Ids given by the caller are kept; the ones derived from the store step around them.
      const given = options.stores ?? storeSpecs([], process.env);
      const used = new Set(given.flatMap((store) => (typeof store === 'string' ? [] : [store.id])));
      const backends = given.map((store): BackendInput => {
        if (typeof store !== 'string') return store;
        const opened = openStore(store, { base: repoRoot, env: process.env });
        const id = storeId(opened.location, used);
        used.add(id);
        return { id, label: opened.location.kind === 'directory' ? path.basename(opened.location.directory) : opened.label, store: opened.store };
      });
      const specs = path.resolve(repoRoot, options.specs);
      app = createReportsApp({
        store: null,
        backends: backends.map(backend => ({ ...backend, label: backend.label ?? backend.id })),
        clock: { now: Date.now },
        timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as never), setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: handle => clearInterval(handle as never) },
        outline: () => loadDirectoryOutline(specs, { repoRoot, domain: options.domain ?? (path.basename(repoRoot) || 'product') })
      });
      // A wrong path says which one, instead of a bare "Internal Server Error".
      app.onError((error, c) => c.json({ error: error instanceof Error ? error.message : String(error), specs, stores: backends.map(backend => backend.id) }, 500));
    }
    const url = new URL(request.url);
    const pathname = url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`) ? url.pathname.slice(PREFIX.length) || '/' : url.pathname;
    return app.request(new Request(`http://reports${pathname}${url.search}`, { method: request.method, headers: request.headers }));
  };
}
