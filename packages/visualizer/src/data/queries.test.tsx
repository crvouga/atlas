// @vitest-environment happy-dom
import type { Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReportSources } from '../app/report-sources';
import type { AtlasAdapter, AtlasChange } from './adapters';
import type { ReportBackend } from './adapters/report-backend';
import type { AtlasData } from './queries';
import { ReportSourcesContext } from '../app/report-sources';
import { LoadError } from './adapters';
import { AdapterContext, createQueryClient, useAtlasData, useLiveUpdates } from './queries';

const machine = {
  id: 'Product',
  initial: 'Start',
  states: {
    Start: { meta: { description: 'Start here.' }, on: { Continue: 'Done' } },
    Done: { type: 'final', meta: { description: 'Finished.' } }
  }
};
const spec: AtlasAdapter = {
  kind: 'static',
  label: 'spec',
  specIndex: async () => ({ schemaVersion: 1, generatedAt: '2026-10-09T10:00:00Z', files: ['machine.json'] }),
  specFile: async () => JSON.stringify(machine),
  runsIndex: async () => ({ runs: [] }),
  manifest: async () => ({}),
  manifestPath: () => '',
  mediaUrl: () => '',
  subscribe: null
};

function backend(id: string, startedAt: string) {
  let snapshot: unknown = {
    schemaVersion: 1,
    run: { id: 'same', startedAt, durationMs: 10, mode: 'fast', specVersion: 'v1', finishedAt: null },
    states: { Start: { status: 'passed', screenshot: { png: 'start.png' } }, Done: { status: 'not-reached' } }
  };
  let failure: Error | null = null;
  let complete = false;
  const listeners = new Set<(change: AtlasChange) => void>();
  const source: ReportBackend = {
    id,
    label: id,
    kind: 'api',
    cacheKey: id,
    pollMs: 60_000,
    runsIndex: vi.fn(async () => ({ runs: [{ id: 'same', startedAt, progress: complete ? 'complete' : 'running' }] })),
    manifest: vi.fn(async () => {
      if (failure) throw failure;
      return snapshot;
    }),
    manifestPath: (run) => `/${id}/${run}/manifest`,
    mediaUrl: (run, file) => `/${id}/${run}/${file}`,
    subscribe: (receive) => {
      listeners.add(receive);
      return () => {
        listeners.delete(receive);
      };
    }
  };
  return {
    source,
    listeners,
    update: (raw: unknown, finished = false) => {
      snapshot = raw;
      complete = finished;
    },
    fail: (error: Error | null) => {
      failure = error;
    },
    notify: () => {
      for (const receive of listeners) receive({ scope: 'runs', files: [], runIds: ['same'] });
    }
  };
}

let root: Root;
let container: HTMLDivElement;
let current: AtlasData;
let selected: string | undefined;
let live: boolean;
let client: ReturnType<typeof createQueryClient>;
let registry: ReportSources;
let first: ReturnType<typeof backend>;
let second: ReturnType<typeof backend>;

function Probe() {
  useLiveUpdates(live);
  current = useAtlasData(selected, live);
  return <output>{current.view?.run?.id}</output>;
}
async function render() {
  await act(async () =>
    root.render(
      <AdapterContext.Provider value={spec}>
        <QueryClientProvider client={client}>
          <ReportSourcesContext.Provider value={registry}>
            <Probe />
          </ReportSourcesContext.Provider>
        </QueryClientProvider>
      </AdapterContext.Provider>
    )
  );
}
async function waitFor(assertion: () => void) {
  let failure: unknown;
  for (let attempt = 0; attempt < 50; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    try {
      assertion();
      return;
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  selected = undefined;
  live = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
  first = backend('first', '2026-10-08T10:00:00Z');
  second = backend('second', '2026-10-09T10:00:00Z');
  registry = {
    entries: [first.source, second.source].map((source) => ({
      backend: source,
      enabled: true,
      custom: false,
      config: { id: source.id, label: source.label, type: 'api', baseUrl: `https://${source.id}.example.test` }
    })),
    loading: false,
    error: null,
    retry: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn()
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

describe('live report queries', () => {
  it('selects the newest running report and isolates media and cache across colliding ids', async () => {
    await render();
    await waitFor(() => expect(current.view?.run?.id).toBe('second~same'));
    expect(current.reports).toHaveLength(2);
    expect(current.view?.states.get('Start')?.result?.screenshot.full).toBe('/second/same/start.png');
    expect(current.view?.states.get('Done')?.status).toBe('not-yet-run');
    selected = 'first~same';
    await render();
    await waitFor(() => expect(current.view?.run?.id).toBe('first~same'));
    expect(current.view?.states.get('Start')?.result?.screenshot.full).toBe('/first/same/start.png');
  });

  it('keeps the last valid snapshot during refresh failures and accepts the final snapshot', async () => {
    await render();
    await waitFor(() => expect(current.view?.run?.id).toBe('second~same'));
    second.fail(new LoadError('/second/manifest', 200, 'The file is not valid JSON.'));
    await act(async () => second.notify());
    await waitFor(() => expect(current.run.error).toContain('not valid JSON'));
    expect(current.view?.states.get('Start')?.status).toBe('passed');
    second.fail(null);
    second.update(
      {
        schemaVersion: 1,
        run: {
          id: 'same',
          startedAt: '2026-10-09T10:00:00Z',
          durationMs: 100,
          mode: 'fast',
          specVersion: 'v1',
          finishedAt: '2026-10-09T10:01:00Z'
        },
        states: { Done: { status: 'passed', screenshot: { png: 'done.png' } } }
      },
      true
    );
    await act(async () => second.notify());
    await waitFor(() => expect(current.view?.states.get('Done')?.status).toBe('passed'));
    expect(current.view?.run?.progress).toBe('complete');
    expect(current.run.error).toBeNull();
  });

  it('keeps other sources and the spec available when one source fails', async () => {
    first.source.runsIndex = vi.fn(async () => {
      throw new Error('Source offline');
    });
    await render();
    await waitFor(() => expect(current.sources.find((source) => source.id === 'first')?.error).toBe('Source offline'));
    expect(current.reports).toHaveLength(1);
    expect(current.view?.charts.size).toBe(1);
    expect(current.view?.run?.id).toBe('second~same');
  });

  it('waits for the first report snapshot and loads it on a change notification', async () => {
    second.fail(new LoadError('/second/manifest', 404, 'The file is not there.'));
    await render();
    await waitFor(() => expect(current.run.waiting).toBe(true));
    expect(current.run.error).toBeNull();
    expect(current.view?.states.size).toBe(2);
    second.fail(null);
    await act(async () => second.notify());
    await waitFor(() => expect(current.view?.states.get('Start')?.status).toBe('passed'));
    expect(current.run.waiting).toBe(false);
  });

  it('unsubscribes while paused and removes disabled sources without hiding the spec', async () => {
    await render();
    await waitFor(() => expect(second.listeners.size).toBe(1));
    live = false;
    await render();
    expect(second.listeners.size).toBe(0);
    registry = { ...registry, entries: registry.entries.map((entry) => ({ ...entry, enabled: false })) };
    await render();
    await waitFor(() => expect(current.reports).toHaveLength(0));
    expect(current.view?.states.get('Start')?.status).toBe('spec-only');
  });

  it('retains an existing report index when a source returns malformed data', async () => {
    await render();
    await waitFor(() => expect(current.reports).toHaveLength(2));
    second.source.runsIndex = vi.fn(async () => ({ runs: 'unfinished' }));
    await act(async () => second.notify());
    await waitFor(() => expect(current.sources.find((source) => source.id === 'second')?.error).toContain('invalid report index'));
    expect(current.reports).toHaveLength(2);
    expect(current.view?.run?.id).toBe('second~same');
  });

  it('polls running snapshots without a stream and observes completion', async () => {
    registry = { ...registry, entries: registry.entries.map((entry) => ({ ...entry, backend: { ...entry.backend, subscribe: null } })) };
    await render();
    await waitFor(() => expect(current.view?.run?.id).toBe('second~same'));
    live = false;
    await render();
    vi.useFakeTimers();
    try {
      const calls = vi.mocked(second.source.manifest).mock.calls.length;
      second.update(
        {
          schemaVersion: 1,
          run: {
            id: 'same',
            startedAt: '2026-10-09T10:00:00Z',
            durationMs: 100,
            mode: 'fast',
            specVersion: 'v1',
            finishedAt: '2026-10-09T10:01:00Z'
          },
          states: { Done: { status: 'passed' } }
        },
        true
      );
      live = true;
      await render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(vi.mocked(second.source.manifest).mock.calls.length).toBeGreaterThan(calls);
      expect(current.view?.states.get('Done')?.status).toBe('passed');
      expect(current.view?.run?.progress).toBe('complete');
    } finally {
      vi.useRealTimers();
    }
  });
});
