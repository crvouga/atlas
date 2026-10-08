import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { atlasDevPlugin } from './vite/atlas-dev-plugin';

export default defineConfig({
  base: './',
  plugins: [react(), atlasDevPlugin()],
  worker: { format: 'es' },
  server: { port: Number(process.env.PORT ?? 5180), strictPort: false },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2_500 }
});
