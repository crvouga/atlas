/**
 * @module UI catalog page
 *
 * A browsable inventory of the product's user interface: each state captured once per profile (viewport, color scheme, device),
 * with where each picture came from, and what is expected and not captured yet. It reads the report the viewer already holds, so
 * states appear as layers arrive and no reload or rebuilt file is needed. A state is shown as captured only when a passing
 * capture exists; a backend or layer that could not be read is named, and nothing that depended on it is shown as captured.
 * Pictures are loaded lazily, only for the cards on screen.
 */
import { IconArrowsExchange, IconDownload, IconLayoutGrid, IconList } from '@tabler/icons-react';
import type { UiCatalog, UiCatalogState, UiCell } from '@crvouga/atlas/reports/ui-catalog';
import { UI_COVERAGE } from '@crvouga/atlas/reports/ui-catalog';
import { Accordion, Alert, Anchor, Badge, Button, Card, Code, Container, Box, Flex, Group, Modal, SegmentedControl, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useEvidence } from '../evidence/evidence-context';
import { plural } from '../evidence/format';
import { EvidenceIncomplete, EvidenceWaiting } from '../evidence/load-state';
import { StatusMark } from '../evidence/marks';
import { Picture } from './Picture';
import { ScreenActions } from './ScreenActions';
import { StateGallery } from './StateGallery';
import { CollectionPanel } from './CollectionPanel';
import { UiCatalogCompare } from './UiCatalogCompare';
import { useUiCatalog } from './provider';
import { useCatalogNavigate, useCatalogSearch, type CatalogSearch } from './search';
import { coverageStatus, coverageWord } from './words';
import { UiCatalogFilters } from './UiCatalogFilters';
import { catalogExpression, CLEAR_CATALOG_SEARCH, searchCatalog } from './query';

/** How many state cards are drawn before "Show more". */
const CARDS = 24;
/** How many rows of the surface table are drawn before "Show more". */
const SURFACES = 20;

function CoverageBadge({ cell }: { cell: UiCell }) {
  return (
    <Badge variant="light" color={cell.coverage === 'captured' ? 'green' : cell.coverage === 'failed' ? 'red' : cell.coverage === 'capturing' ? 'blue' : 'gray'} leftSection={<StatusMark status={coverageStatus(cell.coverage)} size={12} />}>
      {cell.profile.label}: {coverageWord(cell.coverage)}
    </Badge>
  );
}

function StateCard({ state, shown, list, selection, onRemember, onSelect }: {
  state: UiCatalogState; shown: UiCell; list: boolean; selection: CatalogSearch;
  onRemember: (id: string, kind: 'a' | 'button') => void; onSelect: () => void;
}) {
  return (
    <Card withBorder role="listitem" data-state={state.id}>
      <Flex direction={{ base: 'column', sm: list ? 'row' : 'column' }} gap="md">
      <Box w={{ base: '100%', sm: list ? 160 : '100%' }} flex="0 0 auto">
      <Picture cell={shown} title={state.title} height={list ? 120 : 240} onInspect={() => { onRemember(state.id, 'button'); onSelect(); }} />
      </Box>
      <Stack gap="xs" flex={1} miw={0}>
        <Anchor
          fw={700}
          onClick={() => onRemember(state.id, 'a')}
          aria-label={`Open ${state.title}`}
          renderRoot={(props) => <Link {...props} to="/catalog" search={((prev: Record<string, unknown>) => ({ ...prev, ...selection })) as never} resetScroll={false} />}
        >
          {state.title}
        </Anchor>
        <Text c="dimmed" fz="xs">
          {state.id}
          {state.route ? ` · ${state.route}` : ''}
        </Text>
        <Group gap="xs" aria-label={`${state.title} by profile`}>
          {state.cells.slice(0, 2).map((cell) => (
            <CoverageBadge key={cell.profile.key} cell={cell} />
          ))}
          {state.cells.length > 2 && <Text size="xs" c="dimmed">+{state.cells.length - 2} more profiles · Open to inspect</Text>}
        </Group>
        <ScreenActions state={state} cell={shown} selection={selection} />
      </Stack>
      </Flex>
    </Card>
  );
}

function download(catalog: UiCatalog) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ui-catalog.json';
  link.click();
  URL.revokeObjectURL(url);
}

function Summary({ catalog, narrowed }: { catalog: UiCatalog; narrowed: boolean }) {
  const { summary } = catalog;
  return (
    <Stack gap="xs">
      <Group gap="xs" role="status" aria-label="Catalog summary">
        <Badge variant="light">{plural(summary.states, 'state', 'states')}</Badge>
        <Badge variant="light">{plural(summary.profiles, 'profile', 'profiles')}</Badge>
        {UI_COVERAGE.map((value) =>
          summary.coverage[value] > 0 ? (
            <Badge key={value} variant="light" color={value === 'captured' ? 'green' : value === 'failed' ? 'red' : value === 'capturing' ? 'blue' : 'gray'}>
              {summary.coverage[value]} {coverageWord(value).toLowerCase()}
            </Badge>
          ) : null
        )}
        {summary.undeclared > 0 && <Badge variant="outline">{summary.undeclared} not in the expected set</Badge>}
      </Group>
      {narrowed && (
        <Text c="dimmed" fz="sm">
          Counts are for the states that match the filters.
        </Text>
      )}
      {!summary.planned && summary.cells > 0 && (
        <Text c="dimmed" fz="sm">
          No expected set has been published, so states that should exist but were never captured cannot be listed. Publish a <Code>ui-plan</Code> layer to see them as not captured yet.
        </Text>
      )}
    </Stack>
  );
}

function Surfaces({ catalog, onSelect }: { catalog: UiCatalog; onSelect: () => void }) {
  const [rows, setRows] = useState(SURFACES);
  if (!catalog.surfaces.length) return <Text role="status" c="dimmed">No product surfaces have been declared yet.</Text>;
  const uncovered = catalog.summary.uncoveredSurfaces;
  const inventoried = catalog.surfaces.some((surface) => surface.inventoried);
  return (
    <Accordion variant="contained" defaultValue="surfaces">
      <Accordion.Item value="surfaces">
        <Accordion.Control>
          Coverage of the product&rsquo;s surfaces: {plural(catalog.surfaces.length, 'surface', 'surfaces')}, {uncovered === 0 ? 'all with a captured state' : `${uncovered} without one`}
        </Accordion.Control>
        <Accordion.Panel>
          <Table.ScrollContainer minWidth={420}>
            <Table aria-label="Surfaces">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th scope="col">Surface</Table.Th>
                  <Table.Th scope="col">Coverage</Table.Th>
                  <Table.Th scope="col">States</Table.Th>
                  <Table.Th scope="col">Captured</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {catalog.surfaces.slice(0, rows).map((surface) => (
                  <Table.Tr key={surface.id} data-surface={surface.id}>
                    <Table.Td>
                      <Anchor
                        onClick={onSelect}
                        renderRoot={(props) => <Link {...props} to="/catalog" search={((prev: Record<string, unknown>) => ({ ...prev, surface: surface.id })) as never} resetScroll={false} />}
                      >
                        {surface.id}
                      </Anchor>
                      {inventoried && !surface.inventoried ? ' (not in the inventory)' : ''}
                    </Table.Td>
                    <Table.Td>{surface.status === 'covered' ? 'Covered' : surface.status === 'uncaptured' ? 'States cover it, none captured yet' : 'No state covers it'}</Table.Td>
                    <Table.Td>{surface.states}</Table.Td>
                    <Table.Td>{surface.captured}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {catalog.surfaces.length > rows && (
            <Button type="button" variant="subtle" onClick={() => setRows(rows + SURFACES)}>
              Show more surfaces ({catalog.surfaces.length - rows} more)
            </Button>
          )}
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

/** The `/catalog` route. */
export function UiCatalogPage() {
  const evidence = useEvidence();
  const whole = useUiCatalog();
  const { search } = useCatalogSearch();
  const go = useCatalogNavigate();
  const [shown, setShown] = useState(CARDS);
  const [detailsOpened, setDetailsOpened] = useState<'surfaces' | 'collection' | null>(null);
  const indexHeading = useRef<HTMLHeadingElement>(null);
  const wasFocused = useRef(!!search.state);
  const returning = useRef<{ id: string; kind: 'a' | 'button'; scroll: number } | null>(null);
  const remember = (id: string, kind: 'a' | 'button') => { returning.current = { id, kind, scroll: window.scrollY }; };
  useEffect(() => {
    if (search.state) { wasFocused.current = true; return; }
    if (!wasFocused.current) return;
    wasFocused.current = false;
    if (!returning.current) { indexHeading.current?.focus(); return; }
    const saved = returning.current;
    returning.current = null;
    const card = [...document.querySelectorAll<HTMLElement>('[data-state]')].find(card => card.dataset.state === saved.id);
    card?.querySelector<HTMLElement>(saved.kind)?.focus({ preventScroll: true });
    window.scrollTo(0, saved.scroll);
  }, [search.state]);
  const expression = catalogExpression(search);
  const [pending, setPending] = useState({ expression, text: '' });
  const draft = pending.expression === expression ? pending.text : '';
  const setDraft = (text: string, base = expression) => setPending({ expression: base, text });
  useEffect(() => { if (!search.state) setShown(CARDS); }, [expression, draft]);
  const committed = useMemo(() => whole ? searchCatalog(whole, expression) : null, [whole, expression]);
  const result = useMemo(() => draft && whole ? searchCatalog(whole, `${expression} ${draft}`) : committed, [whole, expression, draft, committed]);
  const catalog = result?.catalog;
  const narrowed = Boolean(expression || draft);
  const unavailable = evidence.backends.filter((backend) => !backend.available);
  const open = catalog && search.state ? whole?.states.find((state) => state.id === search.state) ?? null : null;
  const notices = <>
        {evidence.unavailable && (
          <Alert role="alert" color="red" title="Recorded results cannot be read">
            <Group gap="sm">
              <Text span inherit>{evidence.unavailable}</Text>
              <Button type="button" variant="subtle" onClick={evidence.retry}>Try again</Button>
            </Group>
          </Alert>
        )}
        {unavailable.length > 0 && (
          <Alert role="status" color="orange" title={`${plural(unavailable.length, 'backend is', 'backends are')} not available`}>
            {unavailable.map((backend) => backend.label).join(', ')}: captures held there are not shown, and nothing that depends on them is shown as captured. This catalog may be incomplete.
          </Alert>
        )}
        {evidence.notices.length > 0 && (
          <Alert role="status" color="orange" title="Some results could not be read">
            {evidence.notices.join(' ')}
          </Alert>
        )}
        <EvidenceIncomplete />
        {!evidence.ready && !evidence.unavailable && <EvidenceWaiting label="Reading the recorded states…" />}
        {evidence.ready && evidence.pending > 0 && (
          <Text role="status" c="dimmed" component="div">
            Reading {plural(evidence.pending, 'more layer', 'more layers')}; states appear here as they arrive.
          </Text>
        )}
  </>;
  const close = () => go({ state: undefined, image: undefined, panel: undefined });
  const matching = catalog?.states.find(state => state.id === open?.id);
  const initialProfile = matching?.cells.find(cell => cell.coverage === 'captured')?.profile.key ?? matching?.cells[0]?.profile.key;
  if (search.state) return (
    <Container size="xl" w="100%" py="xl" component="article" aria-label="UI catalog">
      <Stack gap="md">
        {notices}
        {open ? <StateGallery state={open} states={catalog?.states ?? []} scope={expression} profile={search.image ?? initialProfile}
          onProfile={image => go({ image }, { replace: true })} onSelect={state => go({ state, image: undefined, panel: undefined })} onClose={close} />
          : <>
            <Button variant="subtle" onClick={close}>Back to catalog</Button>
            {evidence.ready && evidence.pending === 0 && <Alert role="status" color="gray" title="That state is not in the catalog">
              <Text span inherit>{search.state}</Text> has no recorded capture or plan yet. It appears here if a layer that holds it arrives.
            </Alert>}
          </>}
      </Stack>
    </Container>
  );
  return (
    <Container size="xl" w="100%" py="xl" component="article" aria-label="UI catalog">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Title order={1} ref={indexHeading} tabIndex={-1}>UI catalog</Title>
            <Text c="dimmed">Explore the product through its screens. Search, filter and sort the catalog, then open a screen to inspect its images and details.</Text>
          </Stack>
          <Group gap="sm">
            {whole && <>
              <Button variant="subtle" onClick={() => setDetailsOpened('surfaces')}>Surface coverage</Button>
              <Button variant="subtle" onClick={() => setDetailsOpened('collection')}>Collection status</Button>
            </>}
            {catalog && catalog.states.length > 0 && (
              <>
              {!search.compare && (
                <Button type="button" variant="default" leftSection={<IconArrowsExchange size={16} aria-hidden="true" />} onClick={() => go({ compare: 'commit' })}>
                  Compare
                </Button>
              )}
              <Button type="button" leftSection={<IconDownload size={16} aria-hidden="true" />} onClick={() => download(catalog)}>
                Download the manifest
              </Button>
              </>
            )}
          </Group>
        </Group>
        {whole && <UiCatalogFilters catalog={whole} expression={expression} draft={draft} onDraft={setDraft} issues={committed?.issues ?? []} />}
        {notices}
        {catalog && whole && search.compare && <UiCatalogCompare whole={whole} expression={`${expression} ${draft}`} />}
        {catalog && whole && !search.compare && (
          <>
            <Summary catalog={catalog} narrowed={narrowed} />
            {whole.states.length === 0 && evidence.ready && (
              <Text c="dimmed" role="status" component="div" data-empty>
                No UI states have been recorded yet. A collector publishes a layer with a part of kind <Code>ui-state</Code>; states appear here the moment it arrives.
              </Text>
            )}
            {whole.states.length > 0 && catalog.states.length === 0 && (
              <Stack gap="xs" align="flex-start" role="status" data-no-match>
                <Text c="dimmed">Nothing matches these filters.</Text>
                <Button type="button" variant="light" onClick={() => { setDraft(''); go(CLEAR_CATALOG_SEARCH); }}>
                  Clear filters
                </Button>
              </Stack>
            )}
            {catalog.states.length > 0 && (
              <>
                <Group justify="space-between">
                <Text role="status">Showing {Math.min(shown, catalog.states.length)} of {catalog.states.length} matching states. Open a screen to inspect its images and details.</Text>
                <SegmentedControl aria-label="Catalog layout" value={search.layout === 'list' ? 'list' : 'grid'} onChange={layout => go({ layout })}
                  data={[
                    { value: 'grid', label: <Group gap="xs" wrap="nowrap"><IconLayoutGrid size={16} aria-hidden="true" />Grid</Group> },
                    { value: 'list', label: <Group gap="xs" wrap="nowrap"><IconList size={16} aria-hidden="true" />List</Group> }
                  ]} />
                </Group>
                <SimpleGrid role="list" cols={search.layout === 'list' ? 1 : { base: 1, sm: 2, lg: 3 }} spacing="md" aria-label="States">
                  {catalog.states.slice(0, shown).map(state => {
                    const cell = state.cells.find(cell => cell.coverage === 'captured') ?? state.cells[0]!;
                    const selection = { state: state.id, image: cell.profile.key, ...(draft ? { ...CLEAR_CATALOG_SEARCH, find: `${expression} ${draft}`.trim() } : {}) };
                    return <StateCard key={state.id} state={state} shown={cell} list={search.layout === 'list'} selection={selection} onRemember={remember} onSelect={() => go(selection)} />;
                  })}
                </SimpleGrid>
                {catalog.states.length > shown && (
                  <Button type="button" variant="subtle" onClick={() => setShown(shown + CARDS)}>
                    Show more ({catalog.states.length - shown} more)
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </Stack>
      <Modal opened={!!detailsOpened} onClose={() => setDetailsOpened(null)} title={detailsOpened === 'collection' ? 'Collection status' : 'Surface coverage'} size="xl" closeButtonProps={{ 'aria-label': 'Close catalog details' }}>
        {detailsOpened === 'surfaces' && whole && <Surfaces catalog={whole} onSelect={() => setDetailsOpened(null)} />}
        {detailsOpened === 'collection' && <CollectionPanel standalone />}
      </Modal>
    </Container>
  );
}
