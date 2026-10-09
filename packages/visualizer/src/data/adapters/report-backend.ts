import type { RemoteReportSource, RunSummary } from '@crvouga/atlas-schema';

import { createDevAdapter, createHttpAdapter, type AtlasAdapter } from './index';

export type ReportBackend = Pick<AtlasAdapter, 'label' | 'runsIndex' | 'manifest' | 'manifestPath' | 'mediaUrl' | 'subscribe'> & {
  id: string;
  kind: string;
  cacheKey: string;
  pollMs: number;
};

export type SourcedRunSummary = RunSummary & { sourceId: string; sourceLabel: string; nativeId: string };

export function reportKey(sourceId: string, runId: string) {
  return `${sourceId}~${encodeURIComponent(runId)}`;
}

export function sourceRuns(backend: ReportBackend, runs: RunSummary[]): SourcedRunSummary[] {
  return runs.map((run) => ({ ...run, id: reportKey(backend.id, run.id), nativeId: run.id, sourceId: backend.id, sourceLabel: backend.label }));
}

export function createReportBackend(config: RemoteReportSource): ReportBackend {
  const adapter = config.live && import.meta.hot
    ? createDevAdapter(config.baseUrl, config.label, config.id)
    : createHttpAdapter(config.baseUrl, config.type === 'api' ? 'api' : 'static', config.eventsUrl);
  return {
    ...adapter,
    id: config.id,
    label: config.label,
    kind: config.live ? 'directory' : config.type,
    cacheKey: JSON.stringify([config.id, config.type, adapter.label, config.baseUrl, config.eventsUrl]),
    pollMs: config.pollMs ?? 10_000
  };
}
