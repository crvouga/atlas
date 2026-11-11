/**
 * @module UI catalog definition scope
 *
 * Which history the catalog counts: every layer's (the default) or exactly one catalog definition version's states ×
 * profiles. The choice is the address's `definition`: a version pins the scope, so a shared link never drifts when another
 * definition is published, and `latest` is resolved to the version it names and written back into the address. The
 * definition is read from the server (`GET /api/ui-catalog/definitions/{version}`) and the catalog is projected here with
 * `scopeUiCatalog`, the same projection the server, the CLI and the export make, so the same scope gives the same totals.
 * A definition that cannot be read is said to be unavailable and nothing is counted: the page never quietly shows all history.
 */
import type { UiCatalog } from '@crvouga/atlas/reports/ui-catalog';
import { uiScopeSentence } from '@crvouga/atlas/reports/ui-catalog';
import { isDefinitionVersion, type UiDefinitionSelection } from '@crvouga/atlas/reports/ui-catalog-scope';
import type { UiCatalogDefinitionDocument } from '@crvouga/atlas/schema';
import { Alert, Button, Group, NativeSelect, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useEvidence } from '../evidence/evidence-context';
import { runtimeConfig, runtimeUrl } from '../runtime';
import { useCatalogNavigate } from './search';

/** What the address's `definition` resolves to. `selection` is undefined for all history and while the definition is read. */
export type DefinitionScopeState = {
  readonly requested: string | undefined;
  readonly selection: UiDefinitionSelection | undefined;
  /** The definition is being read: nothing is counted yet, so all history is not shown in its place. */
  readonly pending: boolean;
  /** Whether this viewer can read definitions at all (it is served by an Atlas server). */
  readonly server: boolean;
};

function apiRoot(): string | undefined {
  return runtimeUrl(runtimeConfig()?.api)?.replace(/\/$/, '');
}

/** Reads the scope the address asks for, and the latest published definition to offer. */
export function useDefinitionScope(requested: string | undefined): DefinitionScopeState {
  const api = apiRoot();
  const { version: report } = useEvidence();
  const go = useCatalogNavigate();
  const latest = useQuery({
    queryKey: ['ui-catalog-latest-definition', api, report],
    // The queue is read only when the latest definition is asked for, never just because the page is open.
    enabled: !!api && requested === 'latest',
    retry: false,
    queryFn: async ({ signal }): Promise<{ version: string; name: string } | null> => {
      const response = await fetch(`${api}/ui-catalog/queue`, { signal, cache: 'no-store' });
      if (!response.ok) return null;
      const summary = await response.json() as { definition?: { version?: string; name?: string } | null };
      return summary.definition?.version ? { version: summary.definition.version, name: summary.definition.name ?? '' } : null;
    }
  });
  const wanted = requested && requested !== 'all' ? requested : undefined;
  const version = wanted === 'latest' ? latest.data?.version : wanted;
  const document = useQuery({
    queryKey: ['ui-catalog-definition', api, version],
    enabled: !!api && !!version && isDefinitionVersion(version),
    retry: false,
    staleTime: Infinity,
    queryFn: async ({ signal }): Promise<UiCatalogDefinitionDocument | null> => {
      const response = await fetch(`${api}/ui-catalog/definitions/${version}`, { signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`The definition could not be read (${response.status}).`);
      return await response.json() as UiCatalogDefinitionDocument;
    }
  });
  // `latest` is resolved once and pinned in the address, so the link shared from here keeps meaning this version.
  useEffect(() => {
    if (wanted === 'latest' && latest.data?.version) go({ definition: latest.data.version }, { replace: true });
  }, [wanted, latest.data?.version]);
  const server = !!api;
  if (requested === 'all') return { requested, selection: { kind: 'all-history' }, pending: false, server };
  if (!wanted) return { requested, selection: undefined, pending: false, server };
  const unavailable = (reason: string): DefinitionScopeState => ({ requested, selection: { kind: 'definition', version: version ?? wanted, document: null, reason }, pending: false, server });
  if (!api) return unavailable('Definitions are read from an Atlas server, and this viewer has none');
  if (wanted === 'latest') {
    if (latest.isPending) return { requested, selection: undefined, pending: true, server };
    if (!latest.data) return unavailable('No definition has been published to this server');
  }
  if (!version || !isDefinitionVersion(version)) return unavailable(`"${wanted}" is not a definition version`);
  if (document.isPending) return { requested, selection: undefined, pending: true, server };
  if (document.isError) return unavailable(document.error.message);
  if (!document.data) return unavailable(`No definition ${version} has been published to this server`);
  return { requested, selection: { kind: 'definition', version, document: document.data }, pending: false, server };
}

/** The scope control and what the counts are of: a choice of all history or one definition, the sentence, and an unavailable scope named. */
export function DefinitionScope({ scope, catalog }: { scope: DefinitionScopeState; catalog: UiCatalog | null }) {
  const go = useCatalogNavigate();
  const selection = scope.selection?.kind === 'definition' ? scope.selection : undefined;
  if (!scope.server && !scope.requested) return null;
  // Choosing the active definition asks for `latest`, which is resolved and pinned to its version in the address.
  const options = [{ value: 'all', label: 'All history' }, { value: 'latest', label: 'Active definition (latest published)' }];
  const value = scope.pending ? (scope.requested ?? 'all') : selection?.version ?? 'all';
  if (value !== 'all' && value !== 'latest') options.push({ value, label: `Definition ${selection?.document?.name ? `${selection.document.name} ` : ''}${value.slice(0, 12)}` });
  const applied = catalog?.scope;
  return (
    <Stack gap={4} aria-label="Catalog scope">
      <Group gap="sm" align="flex-end">
        <NativeSelect label="Count" description="Every recorded state and profile, or exactly one definition's" data={options} value={value}
          onChange={event => go({ definition: event.currentTarget.value === 'all' ? undefined : event.currentTarget.value })} />
      </Group>
      {scope.pending && <Text role="status" c="dimmed" fz="sm">Reading the definition…</Text>}
      {applied?.status === 'unavailable' && (
        <Alert role="alert" color="orange" title="This definition is unavailable">
          <Stack gap="xs" align="flex-start">
            <Text inherit>{uiScopeSentence(applied)} Nothing is shown in its place: all history is a separate choice.</Text>
            <Button type="button" variant="subtle" onClick={() => go({ definition: undefined })}>Count all history instead</Button>
          </Stack>
        </Alert>
      )}
      {applied?.kind === 'definition' && applied.status === 'applied' && <Text c="dimmed" fz="xs">{uiScopeSentence(applied)}</Text>}
    </Stack>
  );
}
