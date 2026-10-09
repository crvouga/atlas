import type { RemoteReportSource } from '@crvouga/atlas-schema';
import type { ReactNode } from 'react';
import { createContext, useContext, useMemo, useState } from 'react';
import { RemoteReportSourceSchema } from '@crvouga/atlas-schema';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod/v4';

import type { ReportBackend } from '../data/adapters/report-backend';
import { getJson, LoadError } from '../data/adapters';
import { useAdapter } from '../data/adapters/context';
import { createReportBackend } from '../data/adapters/report-backend';

const SourceListSchema = z
  .object({ schemaVersion: z.literal(1), sources: z.array(RemoteReportSourceSchema) })
  .refine(({ sources }) => new Set(sources.map((source) => source.id)).size === sources.length, 'Each source needs a unique id.');
const PreferencesSchema = z.object({ custom: z.array(RemoteReportSourceSchema), disabled: z.array(z.string()) });

export type BackendEntry = { backend: ReportBackend; config: RemoteReportSource; enabled: boolean; custom: boolean };
export type ReportSources = {
  entries: BackendEntry[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  add: (config: RemoteReportSource) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
};
export const ReportSourcesContext = createContext<ReportSources | null>(null);

export function useReportSources() {
  const registry = useContext(ReportSourcesContext);
  if (!registry) throw new Error('useReportSources needs a ReportSourcesProvider');
  return registry;
}

export function ReportSourcesProvider({ children }: { children: ReactNode }) {
  const adapter = useAdapter();
  const defaultConfig = useMemo<RemoteReportSource>(
    () => ({
      id: 'workspace',
      label: adapter.kind === 'dev' ? 'Workspace runs' : 'Published reports',
      type: 'http',
      baseUrl: adapter.kind === 'dev' ? '/__atlas/' : (import.meta.env.VITE_ATLAS_BASE_URL ?? './data/'),
      live: adapter.kind === 'dev'
    }),
    [adapter]
  );
  const configBase = defaultConfig.baseUrl.endsWith('/') ? defaultConfig.baseUrl : `${defaultConfig.baseUrl}/`;
  const configUrl = new URL(import.meta.env.VITE_ATLAS_SOURCES_URL ?? 'sources.json', new URL(configBase, window.location.href)).href;
  const storageKey = `atlas:sources:${configUrl}`;
  const [storageError, setStorageError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState(() => {
    try {
      const parsed = PreferencesSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? '{}'));
      return parsed.success ? parsed.data : { custom: [], disabled: [] };
    } catch {
      return { custom: [], disabled: [] };
    }
  });
  const configuration = useQuery({
    queryKey: ['report-sources', configUrl],
    queryFn: async () => {
      try {
        const parsed = SourceListSchema.parse(await getJson(configUrl));
        return parsed.sources.map((source) => ({
          ...source,
          baseUrl: new URL(source.baseUrl, configUrl).href,
          eventsUrl: source.eventsUrl
            ? new URL(source.eventsUrl, new URL(source.baseUrl.endsWith('/') ? source.baseUrl : `${source.baseUrl}/`, configUrl)).href
            : undefined
        }));
      } catch (error) {
        if (error instanceof LoadError && error.status === 404) return [defaultConfig];
        throw error;
      }
    }
  });
  const configured = configuration.data ?? [defaultConfig];
  const entries = useMemo(() => {
    const ids = new Set(configured.map((source) => source.id));
    const custom = preferences.custom.filter((source) => !ids.has(source.id));
    return [...configured, ...custom].map((config) => ({
      config,
      backend: createReportBackend(config),
      enabled: !preferences.disabled.includes(config.id),
      custom: !ids.has(config.id)
    }));
  }, [configured, preferences]);
  const update = (next: z.infer<typeof PreferencesSchema>) => {
    setPreferences(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError(null);
    } catch {
      setStorageError('Source preferences could not be saved in this browser. They remain active for this session.');
    }
  };
  const registry: ReportSources = {
    entries,
    loading: configuration.isPending,
    error: configuration.error ? `Source configuration could not be loaded: ${configuration.error.message}` : storageError,
    retry: () => void configuration.refetch(),
    add: (raw) => {
      const config = RemoteReportSourceSchema.parse({ ...raw, live: false });
      if (entries.some((entry) => entry.config.id === config.id)) throw new Error('A source with this id already exists.');
      update({ ...preferences, custom: [...preferences.custom, config] });
    },
    remove: (id) =>
      update({
        custom: preferences.custom.filter((source) => source.id !== id),
        disabled: preferences.disabled.filter((sourceId) => sourceId !== id)
      }),
    toggle: (id) =>
      update({
        ...preferences,
        disabled: preferences.disabled.includes(id)
          ? preferences.disabled.filter((sourceId) => sourceId !== id)
          : [...preferences.disabled, id]
      })
  };
  return <ReportSourcesContext.Provider value={registry}>{children}</ReportSourcesContext.Provider>;
}
