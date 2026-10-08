import { SpecIndexSchema, type DataIssue, type RunSummary } from '@crvouga/atlas-schema';
import { QueryClient, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo } from 'react';

import { LoadError, type AtlasAdapter } from './adapters';
import { buildAtlasView, type AtlasView } from './model';
import { createIssueSink } from './parse/issues';
import { parseManifest, parseRunsIndex } from './parse/manifest';
import { parseSpec } from './parse/spec';

export const AdapterContext = createContext<AtlasAdapter | null>(null);

export function useAdapter() {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error('useAdapter needs an AdapterContext provider');
  return adapter;
}

const POLL_MS = Number(import.meta.env.VITE_ATLAS_POLL_MS ?? 60_000);
const RUNNING_POLL_MS = 10_000;

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
  specIndex: ['spec-index'] as const,
  specFile: (path: string) => ['spec-file', path] as const,
  runsIndex: ['runs-index'] as const,
  manifest: (runId: string) => ['manifest', runId] as const
};

/** In dev, a spec or run changing on disk refetches just what changed. */
export function useLiveUpdates() {
  const adapter = useAdapter();
  const client = useQueryClient();
  useEffect(() => {
    if (!adapter.subscribe) return;
    return adapter.subscribe((change) => {
      if (change.scope === 'specs') {
        void client.invalidateQueries({ queryKey: keys.specIndex });
        for (const file of change.files) void client.invalidateQueries({ queryKey: keys.specFile(file) });
      } else {
        void client.invalidateQueries({ queryKey: keys.runsIndex });
        for (const runId of change.runIds) void client.invalidateQueries({ queryKey: keys.manifest(runId) });
      }
    });
  }, [adapter, client]);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown problem.';
}

function combineFiles(results: { data?: string; error: Error | null; isPending: boolean }[]) {
  return {
    texts: results.map((r) => r.data),
    errors: results.map((r) => (r.error ? errorText(r.error) : null)),
    loading: results.some((r) => r.isPending)
  };
}

export type LoadState = { loading: boolean; error: string | null; retry: () => void };

export type AtlasData = {
  view: AtlasView | null;
  spec: LoadState;
  runs: LoadState;
  run: LoadState & { id: string | null };
  latestRunId: string | null;
};

/** The newest run with a manifest; a run still going has none yet. */
export function latestCompleteRun(runs: RunSummary[]) {
  return runs.find((r) => r.progress !== 'running') ?? null;
}

export function useAtlasData(runParam: string | undefined): AtlasData {
  const adapter = useAdapter();
  const polling = adapter.kind === 'static';

  const specIndex = useQuery({ queryKey: keys.specIndex, queryFn: adapter.specIndex, refetchOnWindowFocus: polling });
  const index = useMemo(() => {
    const parsed = SpecIndexSchema.safeParse(specIndex.data);
    return parsed.success ? parsed.data : null;
  }, [specIndex.data]);

  const files = useQueries({
    queries: (index?.files ?? []).map((path) => ({
      queryKey: keys.specFile(path),
      queryFn: () => adapter.specFile(path)
    })),
    combine: combineFiles
  });

  const runsIndex = useQuery({
    queryKey: keys.runsIndex,
    queryFn: adapter.runsIndex,
    refetchInterval: polling ? POLL_MS : false,
    refetchOnWindowFocus: polling
  });

  const runsParsed = useMemo(() => {
    const sink = createIssueSink();
    const parsed = runsIndex.data === undefined ? { runs: [], excluded: [] } : parseRunsIndex('runs/index.json', runsIndex.data, sink);
    return { ...parsed, issues: sink.issues };
  }, [runsIndex.data]);

  const latest = latestCompleteRun(runsParsed.runs);
  const runId = !runParam || runParam === LATEST ? latest?.id ?? null : runParam;
  const summary = runsParsed.runs.find((r) => r.id === runId);

  const manifest = useQuery({
    queryKey: keys.manifest(runId ?? ''),
    queryFn: () => adapter.manifest(runId!),
    enabled: Boolean(runId),
    refetchInterval: polling && summary?.progress === 'running' ? RUNNING_POLL_MS : false
  });

  const specDoc = useMemo(() => {
    if (!index || files.loading) return null;
    const sink = createIssueSink();
    const doc = parseSpec(
      {
        ref: index.ref ?? null,
        files: index.files.map((path, i) => ({ path, text: files.texts[i] ?? null, error: files.errors[i] ?? undefined }))
      },
      sink
    );
    return { doc, issues: sink.issues };
  }, [index, files]);

  const runParsed = useMemo(() => {
    if (!runId || manifest.data === undefined) return null;
    const sink = createIssueSink();
    const run = parseManifest(runId, adapter.manifestPath(runId), manifest.data, sink);
    return { run, issues: sink.issues };
  }, [adapter, runId, manifest.data]);

  const view = useMemo(() => {
    if (!specDoc) return null;
    const runIssues: DataIssue[] = [...runsParsed.issues, ...(runParsed?.issues ?? [])];
    if (manifest.error && runId) {
      runIssues.push({ severity: 'error', file: adapter.manifestPath(runId), path: '', message: `This run could not be loaded: ${errorText(manifest.error)}` });
    }
    if (runsIndex.error) runIssues.push({ severity: 'warning', file: 'runs/index.json', path: '', message: `The list of runs could not be loaded: ${errorText(runsIndex.error)}` });
    const view = buildAtlasView({
      spec: specDoc.doc,
      specIssues: specDoc.issues,
      runs: runsParsed.runs,
      run: runParsed?.run ?? null,
      runIssues,
      runProgress: summary?.progress,
      resolveMedia: adapter.mediaUrl
    });
    for (const item of runsParsed.excluded) if (!view.excluded.includes(item)) view.excluded.push(item);
    return view;
  }, [specDoc, runsParsed, runParsed, manifest.error, runsIndex.error, runId, summary?.progress, adapter]);

  return {
    view,
    spec: {
      loading: specIndex.isPending || files.loading,
      error: specIndex.error ? errorText(specIndex.error) : null,
      retry: () => void specIndex.refetch()
    },
    runs: { loading: runsIndex.isPending, error: runsIndex.error ? errorText(runsIndex.error) : null, retry: () => void runsIndex.refetch() },
    run: {
      id: runId,
      loading: Boolean(runId) && manifest.isPending,
      error: manifest.error ? errorText(manifest.error) : null,
      retry: () => void manifest.refetch()
    },
    latestRunId: latest?.id ?? null
  };
}
