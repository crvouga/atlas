/**
 * @module UI catalog filters
 *
 * The controls beside the catalog: words, coverage, profile, area, route, cohort, feature flag, surface and producer. Each offers
 * the values the catalog has with how many states have them. What is chosen is the address, so copying it or reloading restores
 * the same view; choices combine with AND across the controls and OR within one.
 */
import { UI_COVERAGE, isUiCatalogFiltered, type UiCatalogQuery, type UiFacetValue } from '@crvouga/atlas/reports/ui-catalog';
import { joinList } from '@crvouga/atlas/reports/artifact-query';
import { Button, MultiSelect, Stack, TextInput, Title } from '@mantine/core';
import { useMemo } from 'react';

import { useUiCatalog } from './provider';
import { useCatalogNavigate, useCatalogSearch } from './search';
import { coverageWord } from './words';

type Field = 'coverage' | 'profile' | 'area' | 'route' | 'cohort' | 'flag' | 'surface' | 'producer';

function Facet({ field, label, options, query }: { field: Field; label: string; options: readonly UiFacetValue[]; query: UiCatalogQuery }) {
  const go = useCatalogNavigate();
  const chosen = (query[field] ?? []) as readonly string[];
  const data = useMemo(() => options.map((option) => ({ value: option.value, label: `${option.label ?? (field === 'coverage' ? coverageWord(option.value) : option.value)} (${option.count})` })), [options, field]);
  if (!data.length && !chosen.length) return null;
  return (
    <MultiSelect
      label={label}
      data={data}
      value={[...chosen]}
      searchable
      clearable
      placeholder={chosen.length ? undefined : `Any ${label.toLowerCase()}`}
      nothingFoundMessage="Nothing found"
      onChange={(next) => go({ [field]: joinList(next) })}
    />
  );
}

/** The navigation column of the catalog page. */
export function UiCatalogFilters() {
  const catalog = useUiCatalog();
  const { query } = useCatalogSearch();
  const go = useCatalogNavigate();
  if (!catalog) return null;
  const { facets } = catalog;
  const coverage = UI_COVERAGE.map((value) => facets.coverage.find((facet) => facet.value === value) ?? { value, count: 0 }).filter((facet) => facet.count > 0 || query.coverage?.includes(facet.value as never));
  return (
    <Stack component="nav" aria-label="UI catalog filters" p="md" gap="sm">
      <Title order={2}>Find states</Title>
      <TextInput label="Search states" description="Id, title, route, fixture, cohort, flag or surface" value={query.q ?? ''} onChange={(event) => go({ q: event.currentTarget.value || undefined }, { replace: true })} />
      <Facet field="coverage" label="Coverage" options={coverage} query={query} />
      <Facet field="profile" label="Profile" options={facets.profiles} query={query} />
      <Facet field="area" label="Area" options={facets.areas} query={query} />
      <Facet field="route" label="Route" options={facets.routes} query={query} />
      <Facet field="cohort" label="Cohort" options={facets.cohorts} query={query} />
      <Facet field="flag" label="Feature flag" options={facets.flags} query={query} />
      <Facet field="surface" label="Surface" options={facets.surfaces} query={query} />
      <Facet field="producer" label="Producer" options={facets.producers} query={query} />
      {isUiCatalogFiltered(query) && (
        <Button type="button" variant="subtle" onClick={() => go({ q: undefined, coverage: undefined, profile: undefined, area: undefined, route: undefined, cohort: undefined, flag: undefined, surface: undefined, producer: undefined })}>
          Clear filters
        </Button>
      )}
    </Stack>
  );
}
