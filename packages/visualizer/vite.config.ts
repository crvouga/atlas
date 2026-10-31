import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { viewerCacheDir } from './vite/cache';
import { resolveRoots } from './vite/atlas-files';
import { servesExampleReports } from './vite/example-reports';
import { reportsDevPlugin } from './vite/reports-dev-plugin';
import { atlasDevPlugin } from './vite/atlas-dev-plugin';
import { atlasServerPage, atlasServerProxy } from './vite/atlas-server-proxy';

const appRoot = path.dirname(fileURLToPath(import.meta.url));

// `atlas dev` runs the Atlas server on a port of its own and tells this config where. The browser then talks to
// this dev server alone: `/api` is proxied to the server, and the page gets the same address book a served
// build gets, so the viewer cannot tell the two apart. Without a server, the viewer reads the working tree.
const serverUrl = process.env.ATLAS_API_URL || '';
const reportsModule = serverUrl ? '' : process.env.ATLAS_REPORTS_MODULE || (servesExampleReports(resolveRoots().specs) ? path.join(appRoot, 'vite/example-reports.ts') : '');

export default defineConfig({
  base: './',
  cacheDir: viewerCacheDir(appRoot, [process.cwd(), process.env.INIT_CWD, serverUrl, reportsModule,
    process.env.ATLAS_SPECS_ROOT, process.env.ATLAS_RUNS_ROOT, process.env.ATLAS_FIXTURE]),
  plugins: serverUrl
    ? [react(), atlasServerPage()]
    : [react(), atlasDevPlugin(), ...(reportsModule ? [reportsDevPlugin({ repoRoot: process.env.INIT_CWD || process.cwd(), appModule: reportsModule })] : [])],
  worker: { format: 'es' },
  server: { port: Number(process.env.PORT ?? 5180), strictPort: false, ...(serverUrl ? atlasServerProxy(serverUrl) : {}) },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2_500 }
});
