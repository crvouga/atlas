import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { resolveRoots } from './vite/atlas-files';
import { servesExampleReports } from './vite/example-reports';
import { reportsDevPlugin } from './vite/reports-dev-plugin';
import { atlasDevPlugin } from './vite/atlas-dev-plugin';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const reportsModule = process.env.ATLAS_REPORTS_MODULE || (servesExampleReports(resolveRoots().specs) ? path.join(appRoot, 'vite/example-reports.ts') : '');

export default defineConfig({
  base: './',
  plugins: [react(), atlasDevPlugin(), ...(reportsModule ? [reportsDevPlugin({ repoRoot: process.env.INIT_CWD || process.cwd(), appModule: reportsModule })] : [])],
  worker: { format: 'es' },
  server: { port: Number(process.env.PORT ?? 5180), strictPort: false },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2_500 }
});
