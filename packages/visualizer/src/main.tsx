import './styles/global.css';
import '@xyflow/react/dist/base.css';

import * as Tooltip from '@radix-ui/react-tooltip';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { router } from './app/router';
import { ReportSourcesProvider } from './app/report-sources';
import { AdapterContext } from './data/queries';
import { createAdapter } from './data/adapters';
import { createQueryClient } from './data/queries';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AdapterContext.Provider value={createAdapter()}>
        <QueryClientProvider client={createQueryClient()}>
          <ReportSourcesProvider>
            <Tooltip.Provider delayDuration={300}>
              <RouterProvider router={router} />
            </Tooltip.Provider>
          </ReportSourcesProvider>
        </QueryClientProvider>
      </AdapterContext.Provider>
    </StrictMode>
  );
}
