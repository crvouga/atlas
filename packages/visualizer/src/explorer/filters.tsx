/**
 * @module Run and artifact filters
 *
 * The filter bar of the Runs and Artifacts tabs: words, artifact tag, media type, label, environment, branch, outcome,
 * feature domain and a time range, each offering the values the report has with counts in the scope of the list. What is
 * chosen shows as removable chips and is the address, so copying it or reloading restores the same view; named views keep
 * a query to open again. Choices combine with AND across the controls and OR within one.
 */
import { IconBookmark, IconLink, IconTrash, IconX } from '@tabler/icons-react';
import { Anchor, Badge, Box, Button, Checkbox, CopyButton, Flex, Group, MultiSelect, Popover, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import type { QueryFacets, QueryFacetValue } from '@crvouga/atlas/reports/artifact-query';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { currentProject } from '../runtime';
import { patched, useExplorerNavigate } from './navigate';
import { filtered, joined, NO_FILTERS, toggled, values, type ExplorerSearch } from './search';
import { filtersOf, isView, readViews, writeViews, type SavedView } from './views';

type Param = 'artifactTag' | 'type' | 'label' | 'env' | 'branch' | 'outcome' | 'domain' | 'producer';

const NOUN: Record<Param, string> = {
  artifactTag: 'Tag',
  type: 'Type',
  label: 'Label',
  env: 'Environment',
  branch: 'Branch',
  outcome: 'Outcome',
  domain: 'Domain',
  producer: 'Producer'
};

/** How a chosen value reads: tags with their hash, environments by name. */
function shown(param: Param, value: string): string {
  if (param === 'artifactTag') return `#${value}`;
  if (param === 'env') return environmentLabel(value);
  if (param === 'domain' && value === '(no spec)') return 'No spec';
  return value;
}

function Facet({ param, facets, search }: { param: Param; facets: readonly QueryFacetValue[]; search: ExplorerSearch }) {
  const go = useExplorerNavigate();
  const chosen = values(search[param]);
  const data = useMemo(() => facets.map((facet) => ({ value: facet.value, label: `${shown(param, facet.value)} (${facet.count})` })), [facets, param]);
  if (!data.length && !chosen.length) return null;
  return (
    <MultiSelect
      label={NOUN[param]}
      data={data}
      value={chosen}
      searchable
      clearable
      placeholder={chosen.length ? undefined : `Any ${NOUN[param].toLowerCase()}`}
      nothingFoundMessage="Nothing found"
      onChange={(next) => go({ [param]: joined(next) } as never)}
    />
  );
}

/** Saved views: name the current filters, open one again, delete it. They are live queries, said so beside the list. */
function Views({
  search,
  tab,
  views,
  onChange,
  failed
}: {
  search: ExplorerSearch;
  tab: 'runs' | 'artifacts';
  views: readonly SavedView[];
  onChange: (next: SavedView[]) => void;
  failed: boolean;
}) {
  const project = currentProject() ?? '';
  const [name, setName] = useState('');
  const mine = views.filter((view) => view.project === project && view.tab === tab);
  const keep = onChange;
  const narrowed = filtered(search);
  return (
    <Popover width={360} position="bottom-start" withArrow shadow="md" trapFocus>
      <Popover.Target>
        <Button type="button" variant="default" leftSection={<IconBookmark size={16} aria-hidden="true" />}>
          Views{mine.length ? ` (${mine.length})` : ''}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm" aria-label="Saved views">
          <Text size="sm" c="dimmed">
            A saved view is a live query: opening it asks again, so it shows what matches the newest report now. It is not a snapshot of the results you see today.
          </Text>
          {mine.length === 0 && (
            <Text size="sm" c="dimmed">
              No saved views for this tab yet.
            </Text>
          )}
          {mine.map((view) => (
            <Group key={view.id} justify="space-between" wrap="nowrap">
              <Anchor
                aria-label={`Open view ${view.name}`}
                renderRoot={(props) => (
                  <Link
                    {...props}
                    to="/"
                    search={patched({ ...NO_FILTERS, ...view.filters, tab: view.tab, openRun: undefined, test: undefined, layer: undefined } as never)}
                    resetScroll={false}
                    activeOptions={{ exact: true }}
                  />
                )}
              >
                {view.name}
              </Anchor>
              <Badge variant="outline" color="gray">
                Live query
              </Badge>
              <Button
                type="button"
                variant="subtle"
                color="red"
                aria-label={`Delete view ${view.name}`}
                onClick={() => keep(views.filter((entry) => entry.id !== view.id))}
              >
                <IconTrash size={16} aria-hidden="true" />
              </Button>
            </Group>
          ))}
          <TextInput label="View name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Demo review" />
          <Button
            type="button"
            disabled={!name.trim() || !narrowed}
            onClick={() => {
              const saved: SavedView = {
                id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                name: name.trim(),
                tab,
                project,
                filters: filtersOf(search),
                savedAtMs: Date.now()
              };
              keep([...views.filter((view) => !(view.project === project && view.tab === tab && view.name === saved.name)), saved]);
              setName('');
            }}
          >
            Save the current filters
          </Button>
          {!narrowed && (
            <Text size="sm" c="dimmed">
              Choose at least one filter to save a view.
            </Text>
          )}
          {failed && (
            <Text size="sm" c="red.7" role="alert">
              This browser would not keep the view, so it will be gone when the page closes.
            </Text>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/**
 * The filter bar for a tab. `facets` are the values on offer with their counts; `extra` is shown beside the controls (the
 * Runs tab's Has video button); `domains` offers the feature domain (artifacts only).
 */
export function FilterBar({
  facets,
  search,
  tab,
  extra
}: {
  facets: QueryFacets;
  search: ExplorerSearch;
  tab: 'runs' | 'artifacts';
  extra?: ReactNode;
}) {
  const go = useExplorerNavigate();
  const [draft, setDraft] = useState(search.q ?? '');
  // The address may change from elsewhere (a link, a saved view, back): follow it.
  useEffect(() => setDraft((current) => (current.trim() === (search.q ?? '').trim() ? current : (search.q ?? ''))), [search.q]);
  const params: Param[] = ['artifactTag', 'type', 'label', 'env', 'branch', 'outcome', ...(tab === 'artifacts' ? (['domain'] as const) : []), 'producer'];
  const chips = [
    ...params.flatMap((param) =>
      values(search[param]).map((value) => ({ label: `${NOUN[param]}: ${shown(param, value)}`, clear: { [param]: toggled(search[param], value) } as never }))
    ),
    ...(search.since ? [{ label: `From ${search.since}`, clear: { since: undefined } as never }] : []),
    ...(search.until ? [{ label: `Until ${search.until}`, clear: { until: undefined } as never }] : []),
    ...(search.q ? [{ label: `Words: ${search.q}`, clear: { q: undefined } as never }] : []),
    ...(search.video ? [{ label: 'Has video', clear: { video: undefined } as never }] : [])
  ];
  const [views, setViews] = useState<SavedView[]>(() => readViews());
  const [failed, setFailed] = useState(false);
  const saved = views.find((view) => view.project === (currentProject() ?? '') && isView(view, search));
  return (
    <Box aria-label="Filters" component="section" mb="md">
      <Stack gap="sm">
        <Flex gap="sm" align="flex-end" wrap="wrap">
          <TextInput
            flex={1}
            miw={{ base: '100%', sm: '15rem' }}
            type="search"
            aria-label={`Search ${tab}`}
            placeholder={tab === 'runs' ? 'Search runs by title, branch, commit, tag…' : 'Search by test, spec, tag, label…'}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              go({ q: event.target.value.trim() || undefined }, { replace: true });
            }}
          />
          <Views
            search={search}
            tab={tab}
            views={views}
            failed={failed}
            onChange={(next) => {
              setViews(next);
              setFailed(!writeViews(next));
            }}
          />
          <CopyButton value={typeof window === 'undefined' ? '' : window.location.href}>
            {({ copied, copy }) => (
              <Button type="button" variant="default" onClick={copy} leftSection={<IconLink size={16} aria-hidden="true" />}>
                {copied ? 'Link copied' : 'Copy link'}
              </Button>
            )}
          </CopyButton>
          {extra}
        </Flex>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
          <Facet param="artifactTag" facets={facets.artifactTags} search={search} />
          <Facet param="type" facets={facets.types} search={search} />
          <Facet param="label" facets={facets.labels} search={search} />
          <Facet param="env" facets={facets.environments} search={search} />
          <Facet param="branch" facets={facets.branches} search={search} />
          <Facet param="outcome" facets={facets.outcomes} search={search} />
          {tab === 'artifacts' && facets.domains && <Facet param="domain" facets={facets.domains} search={search} />}
          {facets.producers.length > 1 && <Facet param="producer" facets={facets.producers} search={search} />}
          <TextInput type="date" label="From" value={search.since ?? ''} onChange={(event) => go({ since: event.target.value || undefined })} />
          <TextInput type="date" label="Until" value={search.until ?? ''} onChange={(event) => go({ until: event.target.value || undefined })} />
        </SimpleGrid>
        {values(search.artifactTag).length > 0 && (
          <Checkbox
            label="Also match tags inherited from the check and run"
            description="Off: only tags written on the recording itself."
            checked={search.inherited === true}
            onChange={(event) => go({ inherited: event.currentTarget.checked ? true : undefined })}
          />
        )}
        {(chips.length > 0 || saved) && (
          <Flex gap="xs" align="center" wrap="wrap" aria-label="Active filters">
            {saved && (
              <Badge variant="light" aria-label={`Live query ${saved.name}`}>
                Live query: {saved.name}
              </Badge>
            )}
            {chips.map((chip) => (
              <Button key={chip.label} type="button" onClick={() => go(chip.clear)} aria-label={`Remove ${chip.label}`} variant="light">
                {chip.label}{' '}
                <Text aria-hidden="true" span inherit>
                  <IconX size={16} aria-hidden="true" />
                </Text>
              </Button>
            ))}
            {filtered(search) && (
              <Button type="button" variant="subtle" onClick={() => go(NO_FILTERS)}>
                Clear filters
              </Button>
            )}
            {saved && (
              <Text size="sm" c="dimmed">
                A live query, not a snapshot: it follows the newest report.
              </Text>
            )}
          </Flex>
        )}
      </Stack>
    </Box>
  );
}
