/**
 * @module Reports host for a project's own stores
 *
 * Mounts the reports API (outline of a specs directory, layers from one or more stores) as a plain
 * `(request, repoRoot) => Response` function, for a dev server or a project's own server to call at
 * `/api/reports`. It owns opening the stores and lazily building the app once per repository root; the report
 * logic itself is in `reports-route.ts` and `compose.ts`. Node/Bun only. It forwards only the method, URL and
 * headers of a request (not the body), so it serves reads.
 *
 * @see docs/dogfooding.md
 */
import path from 'node:path';

import { openStore, storeId, storeSpecs } from './store-url';

import type { BackendInput } from './compose';
import { loadDirectoryOutline } from './directory-outline';
import { createReportsApp } from './reports-route';

/** Options of {@link reportsHost}. */
export type ReportsHostOptions = {
  /** The specs directory, relative to the project. Its files are the outline every layer fills. */
  readonly specs: string;
  /**
   * Where layers are: a directory, an `s3://` URL, or any backend. Several stores are one report: layers
   * from all of them are laid over the same specs. Default: `ATLAS_STORE`.
   */
  readonly stores?: readonly (string | BackendInput)[];
  /** Groups the specs in the viewer. Default: the repository folder's name, or `product`. */
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
 *
 * The returned function takes the incoming `Request` and the repository root (relative store paths and `specs`
 * resolve against it); a path starting `/api/reports` has that prefix removed before routing. The app is built
 * on first use and rebuilt if the root changes. A store given as a string is opened with `openStore` and gets an
 * id derived from its location; a failure while answering (for example a wrong `specs` path) is a 500 whose JSON
 * body names the `specs` directory and the store ids.
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
