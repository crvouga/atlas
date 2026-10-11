import { expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AtlasAdapter } from '../src/data/adapters';
import { AdapterContext, keys, specKey, useAtlasData } from '../src/data/queries';

test('a mixed spec index keeps chart responses matched to their paths without loading supporting documents', async () => {
  // regression: atlas-mixed-spec-index
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const chart = 'product.machine.json';
  const paths = ['auth/matching-accounts.feature', 'auth/outside-accounts.qnt', 'billing/access.dmn', chart, 'ubiquitous-language.yml'];
  const requested: string[] = [];
  const adapter: AtlasAdapter = { kind: 'dev', label: 'Fixture', specIndex: async () => ({}), specFile: async path => { requested.push(path); throw new Error('Unexpected eager load'); }, runsIndex: async () => ({}), manifest: async () => ({}), manifestPath: id => id, mediaUrl: (_, path) => path, subscribe: null };
  const source = specKey(adapter);
  client.setQueryData(keys.specIndex(source), { schemaVersion: 1, generatedAt: '2026-10-10', files: paths });
  client.setQueryData(keys.specFile(source, chart), JSON.stringify({ id: 'product', initial: 'ready', states: { ready: {} } }));
  client.setQueryData(keys.runsIndex(source), { schemaVersion: 1, runs: [] });
  function Probe() { const data = useAtlasData(undefined); return <output>{JSON.stringify({ charts: data.view?.charts.size, issues: data.view?.issues.filter(issue => issue.severity !== 'info') })}</output>; }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AdapterContext.Provider value={adapter}><Probe /></AdapterContext.Provider></QueryClientProvider>));
    expect(JSON.parse(host.textContent!)).toMatchObject({ charts: 1, issues: [] });
    expect(requested).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); }
});


test('an actual chart loading failure keeps its own path and error', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, retryOnMount: false } } });
  const chart = 'product.machine.json';
  const adapter: AtlasAdapter = { kind: 'dev', label: 'Fixture', specIndex: async () => ({}), specFile: async () => { throw new Error('Storage unavailable'); }, runsIndex: async () => ({}), manifest: async () => ({}), manifestPath: id => id, mediaUrl: (_, path) => path, subscribe: null };
  const source = specKey(adapter);
  client.setQueryData(keys.specIndex(source), { schemaVersion: 1, generatedAt: '2026-10-10', files: ['auth/matching-accounts.feature', chart] });
  client.setQueryData(keys.runsIndex(source), { schemaVersion: 1, runs: [] });
  await expect(client.fetchQuery({ queryKey: keys.specFile(source, chart), queryFn: () => adapter.specFile(chart) })).rejects.toThrow('Storage unavailable');
  function Probe() { const data = useAtlasData(undefined); return <output>{JSON.stringify(data.view?.issues.filter(issue => issue.severity === 'error'))}</output>; }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AdapterContext.Provider value={adapter}><Probe /></AdapterContext.Provider></QueryClientProvider>));
    const issues = JSON.parse(host.textContent!) as { file: string; message: string }[];
    expect(issues).toHaveLength(1);
    expect(issues[0]!.file).toBe(chart);
    expect(issues[0]!.message).toContain('Storage unavailable');
  } finally { await act(async () => root.unmount()); host.remove(); client.clear(); }
});
