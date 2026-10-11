import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { reportsDevPlugin } from './vite/reports-dev-plugin';
import { atlasDevPlugin } from './vite/atlas-dev-plugin';

export default defineConfig({
  base: './',
  plugins: [react(), atlasDevPlugin(), ...(process.env.ATLAS_REPORTS_MODULE ? [reportsDevPlugin({ repoRoot: process.env.INIT_CWD || process.cwd(), appModule: process.env.ATLAS_REPORTS_MODULE })] : [])],
  worker: { format: 'es' },
  server: { port: Number(process.env.PORT ?? 5180), strictPort: false },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2_500 }
});
