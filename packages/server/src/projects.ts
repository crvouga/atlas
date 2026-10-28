/** @module Project routing
 * One node serves isolated project stores through the same authenticated API. Legacy unqualified requests address
 * the default project; named projects use scoped stores without rewriting uploaded report documents.
 */
import { ProjectSlugSchema } from '../../schema/src/project';
import { ObjectStoreWithPrefix } from '../../reports/src/store-prefix';
import { writeUtf8 } from '../../reports/src/object-io';
import { createAuth } from './auth';
import { problemResponse } from './problem';
import type { AtlasServer, AtlasServerOptions } from './app';
import type { ObjectStore } from '../../reports/src/object-store';
import type { HttpStore } from '../../reports/src/http-store';
import type { GcPolicy, GcRun } from '../../schema/src/user-state';

const REGISTRY = 'server/projects/';
const SCOPED = /^\/api\/projects\/([^/]+)(\/.*)$/;
const GLOBAL = new Set(['/api/settings', '/api/settings/gc', '/api/settings/gc/run', '/api/projects', '/api/openapi.json', '/api/server']);
const scopeStore = (store: ObjectStore, slug: string) => typeof (store as Partial<HttpStore>).forProject === 'function'
  ? (store as HttpStore).forProject(slug) : new ObjectStoreWithPrefix(store, `projects/${slug}`);

/** Wrap the single-project protocol in project selection. Auth, upload validation and composition stay identical. */
export function projectServer(options: AtlasServerOptions, create: (options: AtlasServerOptions) => AtlasServer): AtlasServer {
  const base = create(options);
  const auth = createAuth(options.tokens ?? [], options.anonymousRead ?? false);
  const write = options.backends.find(backend => backend.id === options.write)!.store;
  const registry = options.liveStore ?? write;
  const known = new Set<string>();
  const children = new Map<string, { server: AtlasServer; touched: number; pending: number }>();
  let closed = false;
  let listing: Promise<void> | undefined;
  let listedAt = 0;
  const announce = () => {
    base.events.publish('projects', {});
    for (const child of children.values()) child.server.events.publish('projects', {});
  };
  const discover = () => {
    if (listing) return listing;
    listing = (async () => {
      const reads = await Promise.allSettled([...new Set([registry, ...options.backends.map(backend => backend.store)])].map(store => store.listKeys(REGISTRY)));
      let reachable = false;
      for (const read of reads) if (read.status === 'fulfilled') {
        reachable = true;
        for (const key of read.value) {
          const slug = key.slice(REGISTRY.length).replace(/\.json$/, '');
          if (key.endsWith('.json') && ProjectSlugSchema.safeParse(slug).success && !known.has(slug)) { known.add(slug); announce(); }
        }
      }
      if (!reachable) throw new Error('Project catalog is unavailable.');
      listedAt = Date.now();
    })().finally(() => { listing = undefined; });
    return listing;
  };
  const ready = base.ready;
  const expire = () => {
    for (const [slug, child] of children) if (!child.pending && child.server.events.count === 0 && Date.now() - child.touched > 300_000) {
      child.server.close(); children.delete(slug);
    }
  };
  const timer = setInterval(expire, 60_000); timer.unref?.();
  /** The application of one named project, created on first use over a store scoped to it. `null` when too many are active. */
  const ensureChild = (slug: string) => {
    let child = children.get(slug);
    if (child) return child;
    expire();
    if (children.size >= 64) return null;
    child = { touched: Date.now(), pending: 0, server: create({ ...options,
      ...(options.log ? { log: line => options.log!({ ...line, project: slug }) } : {}),
      backends: options.backends.map(backend => ({ ...backend, store: scopeStore(backend.store, slug) })),
      ...(options.liveStore ? { liveStore: scopeStore(options.liveStore, slug) } : {}), site: undefined, settings: undefined, gc: undefined
    }) };
    children.set(slug, child);
    return child;
  };

  // Garbage collection. The policy is read from S3 every time, never cached, so a policy saved in the UI is the one applied.
  const clock = options.now ?? Date.now;
  let collecting: Promise<GcRun[]> | undefined;
  let lastCollectedAt = 0;
  const collectAll = (policy: GcPolicy, dryRun: boolean): Promise<GcRun[]> => {
    collecting ??= (async () => {
      const runs: GcRun[] = [];
      await discover().catch(() => {});
      for (const slug of ['default', ...[...known].filter(item => item !== 'default').sort()]) {
        if (closed) break;
        if (slug === 'default') { runs.push(await base.collectGarbage(policy, { dryRun, project: slug })); continue; }
        const child = ensureChild(slug);
        if (!child) { runs.push({ project: slug, dryRun, at: new Date(clock()).toISOString(), candidates: 0, deletedLayers: 0, deletedBlobs: 0, keptLayers: 0, error: 'Too many active projects; this one was skipped.' }); continue; }
        child.pending++;
        try { await child.server.ready; runs.push(await child.server.collectGarbage(policy, { dryRun, project: slug })); }
        finally { child.pending--; child.touched = Date.now(); }
      }
      if (!dryRun) options.gc?.record(runs);
      return runs;
    })().finally(() => { collecting = undefined; });
    return collecting;
  };
  const gcTimer = options.gc ? setInterval(() => {
    void (async () => {
      if (closed || collecting) return;
      const policy = await options.gc!.policy();
      if (!policy?.enabled || clock() - lastCollectedAt < policy.intervalHours * 3_600_000) return;
      await base.ready;
      lastCollectedAt = clock();
      await collectAll(policy, false);
    })().catch(error => options.log?.({ level: 'error', gc: 'schedule', error: String(error) }));
  }, options.gcCheckMs ?? 60_000) : undefined;
  gcTimer?.unref?.();
  const routes = [...base.routes, { method: 'GET', path: '/api/projects' }, { method: 'POST', path: '/api/settings/gc/run' }];
  for (const route of base.routes) if (route.path.startsWith('/api/') && route.path !== '/api/*' && !GLOBAL.has(route.path)) routes.push({ method: route.method, path: route.path.replace('/api/', '/api/projects/:project/') });

  return { ...base, routes, ready,
    async fetch(request) {
      try {
        if (closed) return problemResponse(503, 'Atlas is stopping.');
        const url = new URL(request.url);
        if (url.pathname === '/api/settings/gc/run' && request.method === 'POST') {
          const verdict = auth.check(request, 'admin');
          if (!verdict.ok) return problemResponse(verdict.status, verdict.message, verdict.status === 401 ? { 'www-authenticate': 'Basic realm="Atlas"' } : {});
          const origin = request.headers.get('origin');
          const site = request.headers.get('sec-fetch-site');
          if (site === 'cross-site' || (origin && origin !== url.origin && site !== 'same-origin')) return problemResponse(403, 'Changes must come from this server origin.');
          if (!options.gc) return problemResponse(503, 'Garbage collection settings are managed by the embedding application.');
          const policy = await options.gc.policy();
          if (!policy) return problemResponse(409, 'No garbage collection policy has been saved yet, so nothing is deleted. Save one first.');
          const dryRun = ['1', 'true'].includes(url.searchParams.get('dryRun') ?? '');
          if (!dryRun && !policy.enabled) return problemResponse(409, 'The saved garbage collection policy is disabled. Enable it, or use dryRun to preview.');
          return Response.json({ runs: await collectAll(dryRun ? { ...policy, enabled: true } : policy, dryRun), policy }, { headers: { 'cache-control': 'no-store' } });
        }
        if (url.pathname === '/api/projects' && request.method === 'GET') {
          const verdict = auth.check(request, 'read');
          if (!verdict.ok) return problemResponse(verdict.status, verdict.message, verdict.status === 401 ? { 'www-authenticate': 'Basic realm="Atlas"' } : {});
          if (Date.now() - listedAt > 10_000) await discover();
          const includeDefault = base.index.stats().layers > 0 || known.size === 0;
          return Response.json({ projects: [...(includeDefault ? ['default'] : []), ...[...known].filter(slug => slug !== 'default').sort()].map(slug => ({ slug, name: slug === 'default' ? 'Default' : slug.split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join(' ') })) }, { headers: { 'cache-control': 'no-store' } });
        }
        const match = SCOPED.exec(url.pathname);
        const selectors = [match?.[1], ...url.searchParams.getAll('project'), request.headers.get('x-atlas-project')].filter((value): value is string => value !== null && value !== undefined);
        if (new Set(selectors).size > 1) return problemResponse(422, 'Conflicting project selectors.');
        const slug = selectors[0];
        if (slug !== undefined && !ProjectSlugSchema.safeParse(slug).success) return problemResponse(422, 'Invalid project slug. Use lowercase letters, digits and hyphens (1–64 characters).');
        if (!match && (!slug || GLOBAL.has(url.pathname) || !url.pathname.startsWith('/api/'))) return base.fetch(request);
        if (match) url.pathname = `/api${match[2]}`;
        if (GLOBAL.has(url.pathname)) return problemResponse(404, 'This operation belongs to the Atlas node.');
        url.searchParams.delete('project');
        const forwarded = new Request(url.href, request);
        if (url.pathname === '/api/events' && base.events.count + [...children.values()].reduce((sum, child) => sum + child.server.events.count, 0) >= (options.limits?.maxStreams ?? 500)) return problemResponse(503, 'Too many event streams on this Atlas node. Retry later.');
        if (!slug || slug === 'default') return base.fetch(forwarded);
        const writing = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
        const verdict = auth.check(request, writing ? 'publish' : 'read');
        if (!verdict.ok) return problemResponse(verdict.status, verdict.message, verdict.status === 401 ? { 'www-authenticate': 'Basic realm="Atlas"' } : {});
        if (writing) {
          const origin = request.headers.get('origin');
          const site = request.headers.get('sec-fetch-site');
          if (site === 'cross-site' || (origin && origin !== url.origin && site !== 'same-origin')) return problemResponse(403, 'Changes must come from this server origin.');
        }
        if (!known.has(slug)) {
          await discover();
          if (!known.has(slug)) {
            if (!writing) return problemResponse(404, 'Unknown project. Publish reports with this project slug first.');
          }
        }
        const child = ensureChild(slug);
        if (!child) return problemResponse(429, 'Too many active projects. Retry when another project is idle.');
        child.touched = Date.now(); child.pending++;
        try {
          await child.server.ready;
          const response = await child.server.fetch(forwarded);
          if (writing && response.ok && !known.has(slug)) {
            await writeUtf8(registry, `${REGISTRY}${slug}.json`, JSON.stringify({ slug }), 'application/json');
            known.add(slug);
            announce();
          }
          return response;
        }
        finally { child.pending--; child.touched = Date.now(); }
      } catch (error) {
        options.log?.({ level: 'error', error: String(error) });
        return problemResponse(503, 'The project backend is unavailable. Retry later.');
      }
    },
    close() { closed = true; clearInterval(timer); if (gcTimer) clearInterval(gcTimer); base.close(); for (const child of children.values()) child.server.close(); children.clear(); }
  };
}
