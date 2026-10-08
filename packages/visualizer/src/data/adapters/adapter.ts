export type AtlasChange = { scope: 'specs' | 'runs'; files: string[]; runIds: string[] };

export type AtlasAdapter = {
  kind: 'static' | 'dev';
  /** Where the data comes from, for the developer section. */
  label: string;
  specIndex: () => Promise<unknown>;
  specFile: (path: string) => Promise<string>;
  runsIndex: () => Promise<unknown>;
  manifest: (runId: string) => Promise<unknown>;
  manifestPath: (runId: string) => string;
  mediaUrl: (runId: string, path: string) => string;
  /** Pushes a change as soon as a spec or run changes on disk. Dev only. */
  subscribe: ((onChange: (change: AtlasChange) => void) => () => void) | null;
};

export class LoadError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    message: string
  ) {
    super(message);
  }
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function get(url: string) {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-cache' });
  } catch {
    throw new LoadError(url, null, 'The server could not be reached.');
  }
  if (response.status === 404) throw new LoadError(url, 404, 'The file is not there.');
  if (!response.ok) throw new LoadError(url, response.status, `The server answered with an error (${response.status}).`);
  return response;
}

async function getJson(url: string): Promise<unknown> {
  const text = await (await get(url)).text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LoadError(url, 200, 'The file is not valid JSON.');
  }
}

/**
 * Files over HTTP from a base URL laid out as `specs/index.json`, `specs/<path>`,
 * `runs/index.json` and `runs/<id>/manifest.json` plus media.
 */
export function createHttpAdapter(baseUrl: string, kind: AtlasAdapter['kind'] = 'static'): AtlasAdapter {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, window.location.href).href;
  const url = (path: string) => new URL(path, base).href;
  return {
    kind,
    label: base,
    specIndex: () => getJson(url('specs/index.json')),
    specFile: async (path) => (await get(url(`specs/${encodePath(path)}`))).text(),
    runsIndex: async () => {
      try {
        return await getJson(url('runs/index.json'));
      } catch (error) {
        if (error instanceof LoadError && error.status === 404) return { runs: [] };
        throw error;
      }
    },
    manifest: (runId) => getJson(url(`runs/${encodeURIComponent(runId)}/manifest.json`)),
    manifestPath: (runId) => `runs/${runId}/manifest.json`,
    mediaUrl: (runId, path) => url(`runs/${encodeURIComponent(runId)}/${encodePath(path)}`),
    subscribe: null
  };
}
