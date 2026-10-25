import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import '@mantine/spotlight/styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import '@xyflow/react/dist/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReportSourcesProvider } from './app/report-sources';
import { router } from './app/router';
import { createAdapter } from './data/adapters';
import { AdapterContext, createQueryClient } from './data/queries';
import { AtlasThemeProvider } from './ui/theme';
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AdapterContext.Provider value={createAdapter()}>
        <QueryClientProvider client={createQueryClient()}>
          <ReportSourcesProvider>
            <AtlasThemeProvider>
              <RouterProvider router={router} />
            </AtlasThemeProvider>
          </ReportSourcesProvider>
        </QueryClientProvider>
      </AdapterContext.Provider>
    </StrictMode>
  );
}
