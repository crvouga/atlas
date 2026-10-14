import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ObjectStore } from '@crvouga/atlas/reports/object-store';
import { createReportsApp } from '@crvouga/atlas/reports/reports-route';
import { exampleReports, readExampleSpecs } from '../../packages/visualizer/vite/example-reports';

import { directoryStore } from './report-store';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The built-in layers (several environments, versions, branches and backends) plus whatever
 * `example:run` has written into the directory store. An empty directory leaves the built-in report.
 */
export async function exampleReportsApp(runStore: ObjectStore = directoryStore(path.join(here, 'atlas-reports'))) {
  const seeded = await exampleReports(readExampleSpecs(path.join(here, 'specs')));
  if (!seeded) throw new Error('The todo example specs were not loaded');
  return createReportsApp({
    ...seeded,
    backends: [...(seeded.backends ?? []), { id: 'example-run', label: 'Example run', store: runStore }]
  });
}

let app: ReturnType<typeof exampleReportsApp> | undefined;

async function reportsApp() {
  app ??= exampleReportsApp();
  return app;
}

/** Vite asks for `/api/reports/...`. The reports app serves `/evidence` and `/outline` at its root. */
export async function reportsDevFetch(request: Request, _repoRoot: string): Promise<Response> {
  const url = new URL(request.url);
  const prefix = '/api/reports';
  const pathname = url.pathname === prefix || url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length) || '/' : url.pathname;
  return (await reportsApp()).request(new Request(`http://reports${pathname}${url.search}`, { method: request.method, headers: request.headers }));
}
