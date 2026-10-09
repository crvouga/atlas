import { AtlasChangeSchema, type AtlasChange } from '@crvouga/atlas-schema';

export type { AtlasChange } from '@crvouga/atlas-schema';

export type AtlasAdapter = {
  kind: 'static' | 'dev' | 'api';
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
  if (!path || path.split(/[\\/]/).some((part) => part === '..' || part === '.') || path.startsWith('/')) throw new Error('The file path must stay inside its report.');
  return path.split('/').map(encodeURIComponent).join('/');
}

async function get(url: string) {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new LoadError(url, null, 'The server could not be reached.');
  }
  if (response.status === 404) throw new LoadError(url, 404, 'The file is not there.');
  if (!response.ok) throw new LoadError(url, response.status, `The server answered with an error (${response.status}).`);
  return response;
}

export async function getJson(url: string): Promise<unknown> {
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
export function createHttpAdapter(baseUrl: string, kind: AtlasAdapter['kind'] = 'static', eventsUrl?: string): AtlasAdapter {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, window.location.href).href;
  const location = new URL(base);
  if (!['http:', 'https:'].includes(location.protocol) || location.username || location.password) throw new Error('Use an HTTP URL without credentials.');
  const url = (path: string) => new URL(path, base).href;
  const runPath = (runId: string) => {
    if (!runId || runId === '.' || runId === '..' || /[\\/]/.test(runId)) throw new Error('The report id must name one run.');
    return `runs/${encodeURIComponent(runId)}`;
  };
  return {
    kind,
    label: base,
    specIndex: () => getJson(url('specs/index.json')),
    specFile: async (path) => (await get(url(`specs/${encodePath(path)}`))).text(),
    runsIndex: async () => {
      try {
        return await getJson(url(kind === 'api' ? 'runs' : 'runs/index.json'));
      } catch (error) {
        if (kind !== 'api' && error instanceof LoadError && error.status === 404) return { runs: [] };
        throw error;
      }
    },
    manifest: (runId) => getJson(url(`${runPath(runId)}/${kind === 'api' ? 'manifest' : 'manifest.json'}`)),
    manifestPath: (runId) => url(`${runPath(runId)}/${kind === 'api' ? 'manifest' : 'manifest.json'}`),
    mediaUrl: (runId, path) => {
      try {
        return url(`${runPath(runId)}/${kind === 'api' ? 'files/' : ''}${encodePath(path)}`);
      } catch {
        return '';
      }
    },
    subscribe: eventsUrl ? subscribeToEvents(new URL(eventsUrl, base).href) : null
  };
}

function subscribeToEvents(url: string): NonNullable<AtlasAdapter['subscribe']> {
  const location = new URL(url);
  if (!['http:', 'https:'].includes(location.protocol) || location.username || location.password) throw new Error('Use an HTTP event URL without credentials.');
  return (onChange) => {
    if (typeof EventSource === 'undefined') return () => undefined;
    const stream = new EventSource(url);
    const receive = (event: MessageEvent<string>) => {
      try {
        const change = AtlasChangeSchema.safeParse(JSON.parse(event.data));
        if (change.success) onChange(change.data);
      } catch {
        return;
      }
    };
    stream.addEventListener('message', receive);
    stream.addEventListener('atlas:change', receive);
    stream.addEventListener('open', () => onChange({ scope: 'runs', files: [], runIds: [] }));
    return () => stream.close();
  };
}
