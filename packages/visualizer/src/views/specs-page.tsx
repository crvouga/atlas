import { SpecIndexSchema } from '@crvouga/atlas-schema';
import { useQuery } from '@tanstack/react-query';
import { keys, useAdapter } from '../data/queries';
import { EvidenceBrowser } from '../reports/evidence-browser';
import '../reports/reports.css';

export function SpecsPage() {
  const adapter = useAdapter();
  const index = useQuery({ queryKey: keys.specIndex, queryFn: async () => SpecIndexSchema.parse(await adapter.specIndex()), retry: false });
  const specs = (index.data?.files ?? []).map(path => ({ path: `specs/${path}`, title: path.split('/').at(-1) ?? path, domain: path.split('/')[0] ?? 'Overview', kind: path.split('.').at(-1) ?? 'document' }));
  return <EvidenceBrowser fallbackSpecs={specs} readSpec={path => adapter.specFile(path.replace(/^specs\//, ''))} />;
}
