import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReportsApp } from '@crvouga/atlas/reports/reports-route';

import { directoryStore } from './report-store';
import { loadOutline } from './spec-outline';

const here = path.dirname(fileURLToPath(import.meta.url));
const store = directoryStore(path.join(here, 'atlas-reports'));
const clock = { now: () => Date.now() };
const timers = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
  clearInterval: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>)
};

let app: ReturnType<typeof createReportsApp> | undefined;

async function reportsApp() {
  app ??= createReportsApp({
    store: null,
    localStore: store,
    clock,
    timers,
    outline: () => loadOutline(path.join(here, 'specs'), path.resolve(here, '../..'))
  });
  return app;
}

/** Vite asks for `/api/reports/...`. The reports app serves `/evidence` and `/outline` at its root. */
export async function reportsDevFetch(request: Request, _repoRoot: string): Promise<Response> {
  const url = new URL(request.url);
  const prefix = '/api/reports';
  const pathname = url.pathname === prefix || url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length) || '/' : url.pathname;
  return (await reportsApp()).request(new Request(`http://reports${pathname}${url.search}`, { method: request.method, headers: request.headers }));
}
