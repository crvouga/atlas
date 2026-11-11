/**
 * @module UI catalog page
 *
 * A browsable inventory of the product's user interface: each state captured once per profile (viewport, color scheme, device),
 * with where each picture came from, and what is expected and not captured yet. It reads the report the viewer already holds, so
 * states appear as layers arrive and no reload or rebuilt file is needed. A state is shown as captured only when a passing
 * capture exists; a backend or layer that could not be read is named, and nothing that depended on it is shown as captured.
 * Pictures are loaded lazily, only for the cards on screen.
 */
import { IconArrowLeft, IconArrowsExchange, IconDownload, IconLayoutGrid, IconList, IconPhotoOff, IconSearchOff } from '@tabler/icons-react';
import type { UiCatalog, UiCatalogState, UiCell } from '@crvouga/atlas/reports/ui-catalog';
import { UI_COVERAGE } from '@crvouga/atlas/reports/ui-catalog';
import { Accordion, Alert, Anchor, Badge, Button, Card, Code, Box, Flex, Group, Modal, SegmentedControl, SimpleGrid, Skeleton, Stack, Table, Text, ThemeIcon } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { PageHeader } from '../components/Page';

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

const COVERAGE_COLOR: Readonly<Record<string, string>> = { captured: 'green', failed: 'red', capturing: 'blue' };

function CoverageBadge({ cell }: { cell: UiCell }) {
  const loud = cell.coverage === 'failed' || cell.coverage === 'capturing';
  return (
    <Badge size="sm" maw="100%" variant={loud ? 'light' : 'default'} color={COVERAGE_COLOR[cell.coverage] ?? 'gray'} leftSection={<StatusMark status={coverageStatus(cell.coverage)} size={12} />}>
      {cell.profile.label}: {coverageWord(cell.coverage)}
    </Badge>
  );
}

function StateCard({ state, shown, list, selection, onRemember, onSelect }: {
  state: UiCatalogState; shown: UiCell; list: boolean; selection: CatalogSearch;
  onRemember: (id: string, kind: 'a' | 'button') => void; onSelect: () => void;
}) {
  return (
    <Card padding="sm" role="listitem" data-state={state.id}>
      <Flex direction={{ base: 'column', sm: list ? 'row' : 'column' }} gap={list ? 'md' : 'sm'} align={{ sm: list ? 'center' : 'stretch' }}>
        <Box w={{ base: '100%', sm: list ? 200 : '100%' }} flex="0 0 auto">
          <Picture cell={shown} title={state.title} height={list ? 120 : 240} onInspect={() => { onRemember(state.id, 'button'); onSelect(); }} />
        </Box>
        <Stack gap={6} flex={1} miw={0} px={4} pb={list ? 0 : 4}>
          <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
            <Stack gap={0} miw={0}>
              <Anchor
                fw={600}
                c="inherit"
                size="md"
                lineClamp={1}
                onClick={() => onRemember(state.id, 'a')}
                aria-label={`Open ${state.title}`}
                renderRoot={(props) => <Link {...props} to="/catalog" search={((prev: Record<string, unknown>) => ({ ...prev, ...selection })) as never} resetScroll={false} />}
              >
                {state.title}
              </Anchor>
              <Text c="dimmed" fz="xs" truncate>
                {state.id}
                {state.route ? ` · ${state.route}` : ''}
              </Text>
            </Stack>
            <ScreenActions state={state} cell={shown} selection={selection} compact />
          </Group>
          <Group gap={6} aria-label={`${state.title} by profile`}>
            {state.cells.slice(0, 2).map((cell) => (
              <CoverageBadge key={cell.profile.key} cell={cell} />
            ))}
            {state.cells.length > 2 && <Text size="xs" c="dimmed">+{state.cells.length - 2} more profiles · Open to inspect</Text>}
          </Group>
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

function Summary({ catalog, narrowed, showing }: { catalog: UiCatalog; narrowed: boolean; showing?: ReactNode }) {
  const { summary } = catalog;
  return (
    <Stack gap={4}>
      <Group justify="space-between" gap="sm">
        <Group gap="md" role="status" aria-label="Catalog summary">
          <Text size="sm" fw={500}>{plural(summary.states, 'state', 'states')}</Text>
          <Text size="sm" c="dimmed">{plural(summary.profiles, 'profile', 'profiles')}</Text>
          {UI_COVERAGE.map((value) =>
            summary.coverage[value] > 0 ? (
              <Group key={value} gap={6} wrap="nowrap">
                <StatusMark status={coverageStatus(value)} size={12} />
                <Text size="sm" c="dimmed">{summary.coverage[value]} {coverageWord(value).toLowerCase()}</Text>
              </Group>
            ) : null
          )}
          {summary.undeclared > 0 && <Text size="sm" c="dimmed">{summary.undeclared} not in the expected set</Text>}
        </Group>
        {showing}
      </Group>
      {narrowed && (
        <Text c="dimmed" fz="xs">
          Counts are for the states that match the filters.
        </Text>
      )}
      {!summary.planned && summary.cells > 0 && (
        <Text c="dimmed" fz="xs">
          No expected set has been published, so states that should exist but were never captured cannot be listed. Publish a <Code>ui-plan</Code> layer to see them as not captured yet.
        </Text>
      )}
    </Stack>
  );
}

/** A centered message for a catalog with nothing to draw: what happened, in the page's own words, and the one thing to do. */
function Blank({ icon, title, children, ...rest }: { icon: ReactNode; title: string; children?: ReactNode; 'data-empty'?: boolean; 'data-no-match'?: boolean }) {
  return (
    <Card>
      <Stack align="center" gap="xs" py="xl" role="status" {...rest}>
        <ThemeIcon variant="default" size={44} radius="xl" c="dimmed">{icon}</ThemeIcon>
        <Text fw={600}>{title}</Text>
        {children}
      </Stack>
    </Card>
  );
}

/** The shape of the grid while the first states are read, so the page does not jump when they arrive. */
function GridSkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" aria-hidden="true">
      {[0, 1, 2].map(card => (
        <Card key={card} padding="sm">
          <Stack gap="sm">
            <Skeleton h={240} radius="md" />
            <Skeleton h={14} w="60%" />
            <Skeleton h={10} w="40%" />
          </Stack>
        </Card>
      ))}
    </SimpleGrid>
  );
}

function Surfaces({ catalog, onSelect }: { catalog: UiCatalog; onSelect: () => void }) {
  const [rows, setRows] = useState(SURFACES);
  if (!catalog.surfaces.length) return <Text role="status" c="dimmed">No product surfaces have been declared yet.</Text>;
  const uncovered = catalog.summary.uncoveredSurfaces;
  const inventoried = catalog.surfaces.some((surface) => surface.inventoried);
  return (
    <Accordion defaultValue="surfaces">
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
  const article = useRef<HTMLDivElement>(null);
  const wasFocused = useRef(!!search.state);
  const returning = useRef<{ id: string; kind: 'a' | 'button'; scroll: number } | null>(null);
  const remember = (id: string, kind: 'a' | 'button') => { returning.current = { id, kind, scroll: window.scrollY }; };
  useEffect(() => {
    if (search.state) { wasFocused.current = true; return; }
    if (!wasFocused.current) return;
    wasFocused.current = false;
    if (!returning.current) {
      // The page heading is drawn by PageHeader, so it is made focusable here, only when focus has to land on it.
      const heading = article.current?.querySelector('h1');
      if (heading) { heading.tabIndex = -1; heading.focus(); }
      return;
    }
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
  const layoutControl = catalog && catalog.states.length > 0 && !search.compare ? (
    <SegmentedControl aria-label="Catalog layout" value={search.layout === 'list' ? 'list' : 'grid'} onChange={layout => go({ layout })}
      data={[
        { value: 'grid', label: <Group gap={6} wrap="nowrap"><IconLayoutGrid size={16} aria-hidden="true" />Grid</Group> },
        { value: 'list', label: <Group gap={6} wrap="nowrap"><IconList size={16} aria-hidden="true" />List</Group> }
      ]} />
  ) : null;
  if (search.state) return (
    <Stack gap="md" component="article" aria-label="UI catalog">
      {notices}
      {open ? <StateGallery state={open} states={catalog?.states ?? []} scope={expression} profile={search.image ?? initialProfile}
        onProfile={image => go({ image }, { replace: true })} onSelect={state => go({ state, image: undefined, panel: undefined })} onClose={close} />
        : <Card>
          <Stack gap="sm" align="flex-start">
            <Button variant="subtle" color="gray" size="compact-sm" ml={-8} leftSection={<IconArrowLeft size={16} aria-hidden="true" />} onClick={close}>Back to catalog</Button>
            {evidence.ready && evidence.pending === 0 && <Alert role="status" color="gray" w="100%" title="That state is not in the catalog">
              <Text span inherit>{search.state}</Text> has no recorded capture or plan yet. It appears here if a layer that holds it arrives.
            </Alert>}
          </Stack>
        </Card>}
    </Stack>
  );
  return (
    <Stack gap="md" component="article" aria-label="UI catalog" ref={article}>
      <PageHeader
        title="UI catalog"
        description="Browse captured screens and inspect the evidence behind each state."
        actions={<>
          {whole && <>
            <Button variant="subtle" color="gray" onClick={() => setDetailsOpened('surfaces')}>Surface coverage</Button>
            <Button variant="subtle" color="gray" onClick={() => setDetailsOpened('collection')}>Collection status</Button>
          </>}
          {catalog && catalog.states.length > 0 && (
            <>
              {!search.compare && (
                <Button type="button" leftSection={<IconArrowsExchange size={16} aria-hidden="true" />} onClick={() => go({ compare: 'commit' })}>
                  Compare
                </Button>
              )}
              <Button type="button" leftSection={<IconDownload size={16} aria-hidden="true" />} onClick={() => download(catalog)}>
                Download the manifest
              </Button>
            </>
          )}
        </>}
      />
      {whole && <UiCatalogFilters catalog={whole} expression={expression} draft={draft} onDraft={setDraft} issues={committed?.issues ?? []} end={layoutControl} />}
      {notices}
      {!evidence.ready && !evidence.unavailable && <GridSkeleton />}
      {catalog && whole && search.compare && <UiCatalogCompare whole={whole} expression={`${expression} ${draft}`} />}
      {catalog && whole && !search.compare && (
        <>
          {whole.states.length === 0 && evidence.ready && (
            <Blank data-empty icon={<IconPhotoOff size={22} aria-hidden="true" />} title="No UI states have been recorded yet.">
              <Text c="dimmed" size="sm" ta="center" maw={520}>
                A collector publishes a layer with a part of kind <Code>ui-state</Code>; states appear here the moment it arrives.
              </Text>
            </Blank>
          )}
          {whole.states.length > 0 && (
            <Summary catalog={catalog} narrowed={narrowed} showing={catalog.states.length > 0 && (
              <Text role="status" size="sm" c="dimmed">Showing {Math.min(shown, catalog.states.length)} of {catalog.states.length} matching states. Open a screen to inspect its images and details.</Text>
            )} />
          )}
          {whole.states.length > 0 && catalog.states.length === 0 && (
            <Blank data-no-match icon={<IconSearchOff size={22} aria-hidden="true" />} title="Nothing matches these filters.">
              <Button type="button" onClick={() => { setDraft(''); go(CLEAR_CATALOG_SEARCH); }}>
                Clear filters
              </Button>
            </Blank>
          )}
          {catalog.states.length > 0 && (
            <>
              <SimpleGrid role="list" cols={search.layout === 'list' ? 1 : { base: 1, sm: 2, lg: 3 }} spacing="md" aria-label="States">
                {catalog.states.slice(0, shown).map(state => {
                  const cell = state.cells.find(cell => cell.coverage === 'captured') ?? state.cells[0]!;
                  const selection = { state: state.id, image: cell.profile.key, ...(draft ? { ...CLEAR_CATALOG_SEARCH, find: `${expression} ${draft}`.trim() } : {}) };
                  return <StateCard key={state.id} state={state} shown={cell} list={search.layout === 'list'} selection={selection} onRemember={remember} onSelect={() => go(selection)} />;
                })}
              </SimpleGrid>
              {catalog.states.length > shown && (
                <Group justify="center">
                  <Button type="button" onClick={() => setShown(shown + CARDS)}>
                    Show more ({catalog.states.length - shown} more)
                  </Button>
                </Group>
              )}
            </>
          )}
        </>
      )}
      <Modal opened={!!detailsOpened} onClose={() => setDetailsOpened(null)} title={detailsOpened === 'collection' ? 'Collection status' : 'Surface coverage'} size="xl" closeButtonProps={{ 'aria-label': 'Close catalog details' }}>
        {detailsOpened === 'surfaces' && whole && <Surfaces catalog={whole} onSelect={() => setDetailsOpened(null)} />}
        {detailsOpened === 'collection' && <CollectionPanel standalone />}
      </Modal>
    </Stack>
  );
}
