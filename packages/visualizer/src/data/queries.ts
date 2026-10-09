import { RunsIndexSchema, SpecIndexSchema, type DataIssue } from '@crvouga/atlas-schema';
import { QueryClient, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useMemo } from 'react';

import { ReportSourcesContext, type BackendEntry } from '../app/report-sources';
import { LoadError, type AtlasAdapter } from './adapters';
import { useAdapter } from './adapters/context';
import { reportKey, sourceRuns, type ReportBackend, type SourcedRunSummary } from './adapters/report-backend';
import { buildAtlasView, type AtlasView } from './model';
import { createIssueSink, isRecord } from './parse/issues';
import { parseManifest, parseRunsIndex } from './parse/manifest';
import { parseSpec } from './parse/spec';

export { AdapterContext, useAdapter } from './adapters/context';

const configuredPollMs = Number(import.meta.env.VITE_ATLAS_POLL_MS ?? 60_000);
const POLL_MS = Number.isFinite(configuredPollMs) && configuredPollMs >= 1000 ? configuredPollMs : 60_000;
const RUNNING_POLL_MS = 2000;
export const LATEST = 'latest';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, error) => !(error instanceof LoadError && error.status === 404) && count < 2,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false
      }
    }
  });
}

export const keys = {
  specIndex: (source: string) => ['spec', source, 'index'] as const,
  specFile: (source: string, path: string) => ['spec', source, 'file', path] as const,
  runsIndex: (source: string) => ['reports', source, 'index'] as const,
  manifests: (source: string) => ['reports', source, 'manifest'] as const,
  manifest: (source: string, runId: string) => ['reports', source, 'manifest', runId] as const
};

function specKey(adapter: AtlasAdapter) {
  return `${adapter.kind}:${adapter.label}`;
}

function useBackends() {
  const adapter = useAdapter();
  const registry = useContext(ReportSourcesContext);
  const fallback = useMemo<BackendEntry[]>(() => [{
    backend: { ...adapter, id: 'workspace', cacheKey: specKey(adapter), pollMs: POLL_MS },
    config: { id: 'workspace', label: adapter.label, type: 'http', baseUrl: adapter.label },
    enabled: true,
    custom: false
  }], [adapter]);
  return registry?.entries ?? fallback;
}

export function useLiveUpdates(enabled = true) {
  const adapter = useAdapter();
  const entries = useBackends();
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe: (() => void)[] = [];
    if (adapter.subscribe) unsubscribe.push(adapter.subscribe((change) => {
      if (change.scope !== 'specs') return;
      void client.invalidateQueries({ queryKey: keys.specIndex(specKey(adapter)) });
      if (!change.files.length) void client.invalidateQueries({ queryKey: ['spec', specKey(adapter)] });
      for (const file of change.files) void client.invalidateQueries({ queryKey: keys.specFile(specKey(adapter), file) });
    }));
    for (const { backend, enabled: active } of entries) {
      if (!active || !backend.subscribe) continue;
      unsubscribe.push(backend.subscribe((change) => {
        if (change.scope !== 'runs') return;
        void client.invalidateQueries({ queryKey: keys.runsIndex(backend.cacheKey) });
        if (!change.runIds.length) void client.invalidateQueries({ queryKey: keys.manifests(backend.cacheKey) });
        for (const id of change.runIds) void client.invalidateQueries({ queryKey: keys.manifest(backend.cacheKey, id) });
      }));
    }
    return () => { for (const stop of unsubscribe) stop(); };
  }, [adapter, entries, client, enabled]);
}

export function selectReport(runs: SourcedRunSummary[], backends: ReportBackend[], param?: string) {
  const summary = !param || param === LATEST ? runs[0] : runs.find((run) => run.id === param) ?? runs.find((run) => run.nativeId === param && run.sourceId === 'workspace') ?? runs.find((run) => run.nativeId === param);
  if (summary) {
    const backend = backends.find((source) => source.id === summary.sourceId);
    return backend ? { backend, nativeId: summary.nativeId, id: summary.id, summary } : null;
  }
  if (!param || param === LATEST) return null;
  const separator = param.indexOf('~');
  const sourceId = separator < 0 ? 'workspace' : param.slice(0, separator);
  const backend = backends.find((source) => source.id === sourceId);
  try {
    const nativeId = separator < 0 ? param : decodeURIComponent(param.slice(separator + 1));
    return backend && nativeId ? { backend, nativeId, id: reportKey(backend.id, nativeId), summary: undefined } : null;
  } catch {
    return null;
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown problem.';
}

function combineFiles(results: { data?: string; error: Error | null; isPending: boolean }[]) {
  return {
    texts: results.map((result) => result.data),
    errors: results.map((result) => result.error ? errorText(result.error) : null),
    loading: results.some((result) => result.isPending)
  };
}

export type LoadState = { loading: boolean; error: string | null; retry: () => void };
export type SourceHealth = { id: string; label: string; kind: string; enabled: boolean; loading: boolean; refreshing: boolean; error: string | null; count: number; running: number; updatedAt: number };
export type AtlasData = {
  view: AtlasView | null;
  spec: LoadState;
  runs: LoadState;
  run: LoadState & { id: string | null; waiting: boolean; summary: SourcedRunSummary | null };
  reports: SourcedRunSummary[];
  sources: SourceHealth[];
  latestRunId: string | null;
  updatedAt: number;
  refreshing: boolean;
  refresh: () => void;
};

export function useAtlasData(runParam: string | undefined, live = true): AtlasData {
  const adapter = useAdapter();
  const entries = useBackends();
  const client = useQueryClient();
  const source = specKey(adapter);
  const specIndex = useQuery({ queryKey: keys.specIndex(source), queryFn: async () => SpecIndexSchema.parse(await adapter.specIndex()), refetchInterval: live && adapter.kind !== 'dev' ? POLL_MS : false, refetchOnWindowFocus: live ? 'always' : false });
  const index = useMemo(() => {
    const parsed = SpecIndexSchema.safeParse(specIndex.data);
    return parsed.success ? parsed.data : null;
  }, [specIndex.data]);
  const files = useQueries({
    queries: (index?.files ?? []).map((path) => ({
      queryKey: keys.specFile(source, path),
      queryFn: () => adapter.specFile(path),
      refetchInterval: live && adapter.kind !== 'dev' ? POLL_MS : false,
      refetchOnWindowFocus: live ? 'always' as const : false as const
    })),
    combine: combineFiles
  });
  const indexes = useQueries({
    queries: entries.map(({ backend, enabled }) => ({
      queryKey: keys.runsIndex(backend.cacheKey),
      queryFn: async () => {
        const raw = await backend.runsIndex();
        if (!RunsIndexSchema.safeParse(raw).success) throw new Error('This source returned an invalid report index.');
        return raw;
      },
      enabled,
      refetchInterval: live && enabled ? backend.pollMs : false,
      refetchOnWindowFocus: live && enabled ? 'always' as const : false as const
    }))
  });
  const parsedSources = indexes.map((result, i) => {
    const entry = entries[i]!;
    const sink = createIssueSink();
    const parsed = result.data === undefined || !entry.enabled ? { runs: [], excluded: [] } : parseRunsIndex(`${entry.backend.label}/runs`, result.data, sink);
    return { ...entry, ...parsed, issues: sink.issues, result };
  });
  const reports = parsedSources.flatMap(({ backend, runs }) => sourceRuns(backend, runs)).sort((a, b) =>
    (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0) || a.id.localeCompare(b.id)
  );
  const selection = selectReport(reports, entries.filter((entry) => entry.enabled).map((entry) => entry.backend), runParam);
  const backend = selection?.backend;
  const nativeId = selection?.nativeId;
  const manifest = useQuery({
    queryKey: keys.manifest(backend?.cacheKey ?? '', nativeId ?? ''),
    queryFn: async () => {
      if (!backend || !nativeId) throw new Error('This report source is unavailable.');
      const raw = await backend.manifest(nativeId);
      if (!isRecord(raw)) throw new LoadError(backend.manifestPath(nativeId), 200, 'The report snapshot is not a JSON object.');
      if (isRecord(raw.run) && typeof raw.run.finishedAt === 'string') {
        const info = raw.run;
        client.setQueryData(keys.runsIndex(backend.cacheKey), (previous: unknown) => {
          if (!isRecord(previous) || !Array.isArray(previous.runs)) return previous;
          if (!previous.runs.some((run) => isRecord(run) && run.id === nativeId && run.progress === 'running')) return previous;
          return { ...previous, runs: previous.runs.map((run) => isRecord(run) && run.id === nativeId ? { ...run, progress: 'complete', execution: info.progress ?? run.execution, durationMs: info.durationMs ?? run.durationMs } : run) };
        });
      }
      return raw;
    },
    enabled: Boolean(backend && nativeId),
    refetchInterval: (query) => {
      const raw = query.state.data;
      if (isRecord(raw) && isRecord(raw.run) && typeof raw.run.finishedAt === 'string') return false;
      const running = selection?.summary?.progress === 'running' || (isRecord(raw) && isRecord(raw.run) && raw.run.finishedAt === null);
      return live && running ? RUNNING_POLL_MS : false;
    },
    refetchOnWindowFocus: live ? 'always' : false,
    staleTime: selection?.summary?.progress === 'running' ? 0 : Number.POSITIVE_INFINITY
  });
  const specDoc = useMemo(() => {
    if (!index || files.loading) return null;
    const sink = createIssueSink();
    const doc = parseSpec({ ref: index.ref ?? null, files: index.files.map((path, i) => ({ path, text: files.texts[i] ?? null, error: files.errors[i] ?? undefined })) }, sink);
    return { doc, issues: sink.issues };
  }, [index, files]);
  const runParsed = useMemo(() => {
    if (!selection || manifest.data === undefined) return null;
    const sink = createIssueSink();
    const run = parseManifest(selection.id, selection.backend.manifestPath(selection.nativeId), manifest.data, sink);
    return { run, issues: sink.issues };
  }, [selection?.id, backend, nativeId, manifest.data]);
  const waiting = Boolean(selection?.summary?.progress === 'running' && !manifest.data && (!manifest.error || manifest.error instanceof LoadError && manifest.error.status === 404));
  const runIssues: DataIssue[] = [...parsedSources.flatMap((entry) => entry.issues), ...(runParsed?.issues ?? [])];
  for (const entry of parsedSources) if (entry.enabled && entry.result.error) runIssues.push({ severity: 'warning', file: entry.backend.label, path: '', message: `This source could not be refreshed: ${errorText(entry.result.error)}. Available reports are kept.` });
  if (manifest.error && selection && !waiting) runIssues.push({ severity: 'warning', file: selection.backend.manifestPath(selection.nativeId), path: '', message: `This report could not be refreshed: ${errorText(manifest.error)}. The last available snapshot is kept.` });
  const view = specDoc ? buildAtlasView({
    spec: specDoc.doc,
    specIssues: specDoc.issues,
    runs: reports,
    run: runParsed?.run ?? null,
    runIssues,
    runProgress: runParsed?.run?.info.finishedAt === null ? 'running' : typeof runParsed?.run?.info.finishedAt === 'string' ? 'complete' : selection?.summary?.progress,
    resolveMedia: (id, path) => {
      const resolved = selectReport(reports, entries.map((entry) => entry.backend), id);
      return resolved ? resolved.backend.mediaUrl(resolved.nativeId, path) : '';
    }
  }) : null;
  if (view) for (const entry of parsedSources) for (const item of entry.excluded) if (!view.excluded.includes(item)) view.excluded.push(item);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['spec', source] });
    for (const { backend: reportBackend, enabled } of entries) if (enabled) void client.invalidateQueries({ queryKey: ['reports', reportBackend.cacheKey] });
  };
  const sources = parsedSources.map(({ backend: reportBackend, enabled, runs, result }) => ({
    id: reportBackend.id,
    label: reportBackend.label,
    kind: reportBackend.kind,
    enabled,
    loading: enabled && result.isPending,
    refreshing: result.isFetching,
    error: result.error ? errorText(result.error) : null,
    count: runs.length,
    running: runs.filter((run) => run.progress === 'running').length,
    updatedAt: result.dataUpdatedAt
  }));
  return {
    view,
    spec: { loading: specIndex.isPending || files.loading, error: specIndex.error ? errorText(specIndex.error) : specIndex.data !== undefined && !index ? 'The spec index is not in a supported format.' : null, retry: refresh },
    runs: { loading: sources.some((entry) => entry.loading), error: sources.find((entry) => entry.enabled && entry.error)?.error ?? null, retry: refresh },
    run: { id: selection?.id ?? null, summary: selection?.summary ?? null, waiting, loading: Boolean(selection) && manifest.isPending, error: waiting ? null : manifest.error ? errorText(manifest.error) : runParam && runParam !== LATEST && !selection ? 'This report source is disabled or unavailable.' : null, retry: selection ? () => void manifest.refetch() : refresh },
    reports,
    sources,
    latestRunId: reports[0]?.id ?? null,
    updatedAt: Math.max(manifest.dataUpdatedAt, ...sources.map((entry) => entry.updatedAt), 0),
    refreshing: manifest.isFetching || sources.some((entry) => entry.refreshing),
    refresh
  };
}
