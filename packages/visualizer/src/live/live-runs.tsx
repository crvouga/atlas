import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LiveRun } from '@crvouga/atlas/schema';
import { runtimeConfig, runtimeUrl } from '../runtime';
import { eventsAddress, listenLive, useLiveStatus } from './live-stream';
import { liveInvalidator } from './live-query';
import type { LiveCheck } from '@crvouga/atlas/schema';
import { useUiStore } from '../state/ui-store';
import { indexLiveTests } from './report-progress';

export type LiveTest = { run: LiveRun; check: LiveCheck };
type LiveState = { tests: readonly LiveTest[]; index: ReturnType<typeof indexLiveTests>; error: string | null };
const EMPTY: LiveState = { tests: [], index: new Map(), error: null };
const LiveContext = createContext<LiveState>(EMPTY);

/** One subscription shared by report rows; leases never rewrite historical report results. */
export function LiveRunsProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const client = useQueryClient();
  const streaming = useLiveStatus() === 'live';
  const excluded = useUiStore(s => s.excluded);
  const api = runtimeUrl(runtimeConfig()?.api);
  const url = api && enabled ? `${api.replace(/\/$/, '')}/live` : undefined;
  const key = ['live-runs', url] as const;
  const query = useQuery({ queryKey: key, enabled: !!url, retry: false, staleTime: 0, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always',
    queryFn: async ({ signal }) => {
      const response = await fetch(url!, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`Live feed unavailable (${response.status}). Last received results may be stale.`);
      const fetched = (await response.json()) as { runs: LiveRun[] };
      // An event can arrive while this HTTP snapshot is in flight. Keep its newer progress,
      // while still loading the other runs from the snapshot rather than cancelling it.
      const held = client.getQueryData<{ runs: LiveRun[] }>(key);
      const runs = new Map(fetched.runs.map(run => [run.id, run]));
      for (const run of held?.runs ?? []) {
        const read = runs.get(run.id);
        if (!read || run.sequence > read.sequence || (run.sequence === read.sequence &&
          ((run.status !== 'running' && read.status === 'running') || run.lastHeartbeatAtMs > read.lastHeartbeatAtMs))) runs.set(run.id, run);
      }
      return { runs: [...runs.values()].sort((a, b) => b.startedAtMs - a.startedAtMs || a.id.localeCompare(b.id)).slice(0, 50) };
    }, refetchInterval: streaming ? 60_000 : 2000, refetchIntervalInBackground: true });
  useEffect(() => {
    const address = eventsAddress();
    if (!address || !url) return;
    const refresh = liveInvalidator(client, ['live-runs', url]);
    const stop = listenLive(address, event => {
      if (event.type === 'run') {
        client.setQueryData<{ runs: LiveRun[] }>(['live-runs', url], held => ({ runs: [event.run, ...(held?.runs ?? []).filter(run => run.id !== event.run.id)]
          .sort((a, b) => b.startedAtMs - a.startedAtMs || a.id.localeCompare(b.id)).slice(0, 50) }));
      }
      if (event.type === 'open' || (event.type === 'change' && event.change.scope === 'runs' && !event.change.liveRunId)) refresh();
    });
    return () => { stop(); refresh.cancel(); };
  }, [client, url]);
  const value = useMemo(() => {
    const tests: LiveTest[] = [];
    for (const run of [...(query.data?.runs ?? [])].sort((a, b) => b.startedAtMs - a.startedAtMs)) {
      if (excluded.branches.includes(run.branch ?? 'Unknown branch') || excluded.versions.includes(run.sha ?? 'unknown') ||
        excluded.environments.includes(run.environment || 'unspecified') || excluded.backends.length > 0) continue;
      const checks = new Map([...run.recent, ...run.current].map(check => [check.id, check]));
      for (const check of checks.values()) tests.push({ run, check: run.status !== 'running' && check.status === 'running'
        ? { ...check, status: 'not-run', detail: run.reason ?? 'Run ended before this test completed.' } : check });
    }
    return { tests, index: indexLiveTests(tests), error: query.error?.message ?? null };
  }, [query.data, query.error, excluded]);
  return <LiveContext.Provider value={url ? value : EMPTY}>{children}</LiveContext.Provider>;
}

export function useLiveTests() {
  return useContext(LiveContext);
}
