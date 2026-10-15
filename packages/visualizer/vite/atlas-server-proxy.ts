import type { Plugin, ProxyOptions } from 'vite';

/** What the viewer is told about the server it is served with: the same words `atlas serve` writes into its page. */
export const serverPageConfig = { api: './api', reportsUrl: './api/reports', dataUrl: './api/data/', eventsUrl: './api/events', projectsUrl: './api/projects', effective: true } as const;

/**
 * Put the Atlas server behind the dev server. The browser talks to one host; `/api` goes to the server, so the
 * page, its data and its event stream have one origin in development exactly as they do when deployed.
 */
export function atlasServerProxy(target: string): { readonly proxy: Record<string, ProxyOptions> } {
  return {
    proxy: {
      '/admin': { target, changeOrigin: false },
      '/api': {
        target,
        changeOrigin: false,
        ws: false,
        // The event stream stays open for hours: no timeout, and nothing may hold its bytes back.
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (response) => {
            if (String(response.headers['content-type'] ?? '').startsWith('text/event-stream')) response.headers['cache-control'] = 'no-cache, no-transform';
          });
        }
      }
    }
  };
}

/** Write the server's address book into the page the dev server serves. */
export function atlasServerPage(): Plugin {
  return {
    name: 'atlas-server-page',
    transformIndexHtml: () => [{ tag: 'script', children: `window.__ATLAS_CONFIG__=${JSON.stringify(serverPageConfig)}`, injectTo: 'head-prepend' }]
  };
}
