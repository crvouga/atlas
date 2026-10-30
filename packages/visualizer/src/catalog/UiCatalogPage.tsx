/**
 * @module UI catalog page
 *
 * A browsable inventory of the product's user interface: each state captured once per profile (viewport, color scheme, device),
 * with where each picture came from, and what is expected and not captured yet. It reads the report the viewer already holds, so
 * states appear as layers arrive and no reload or rebuilt file is needed. A state is shown as captured only when a passing
 * capture exists; a backend or layer that could not be read is named, and nothing that depended on it is shown as captured.
 * Pictures are loaded lazily, only for the cards on screen.
 */
import { IconArrowsExchange, IconDownload } from '@tabler/icons-react';
import type { UiCapture, UiCatalog, UiCatalogState, UiCell } from '@crvouga/atlas/reports/ui-catalog';
import { UI_COVERAGE } from '@crvouga/atlas/reports/ui-catalog';
import { Accordion, Alert, Anchor, Badge, Button, Card, Code, Container, Divider, Drawer, Group, Pagination, ScrollArea, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useEvidence } from '../evidence/evidence-context';
import { ago, exactTime, plural, shortSha, useNow } from '../evidence/format';
import { EvidenceIncomplete, EvidenceWaiting } from '../evidence/load-state';
import { StatusMark } from '../evidence/marks';
import { Picture, imageSource } from './Picture';
import { CollectionPanel } from './CollectionPanel';
import { UiCatalogCompare } from './UiCatalogCompare';
import { useUiCatalog } from './provider';
import { useCatalogNavigate, useCatalogSearch } from './search';
import { coverageStatus, coverageWord } from './words';
import { UiCatalogFilters } from './UiCatalogFilters';
import { catalogExpression, CLEAR_CATALOG_SEARCH, searchCatalog } from './query';

/** How many state cards are drawn before "Show more". */
const CARDS = 48;
/** How many rows of the surface table are drawn before "Show more". */
const SURFACES = 100;

function CoverageBadge({ cell }: { cell: UiCell }) {
  return (
    <Badge variant="light" color={cell.coverage === 'captured' ? 'green' : cell.coverage === 'failed' ? 'red' : cell.coverage === 'capturing' ? 'blue' : 'gray'} leftSection={<StatusMark status={coverageStatus(cell.coverage)} size={12} />}>
      {cell.profile.label}: {coverageWord(cell.coverage)}
    </Badge>
  );
}

function StateCard({ state, shown }: { state: UiCatalogState; shown: UiCell }) {
  return (
    <Card withBorder role="listitem" data-state={state.id}>
      <Card.Section p="sm">
        <Picture cell={shown} title={state.title} height={160} />
      </Card.Section>
      <Stack gap="xs" mt="sm">
        <Anchor
          fw={700}
          aria-label={`Open ${state.title}`}
          renderRoot={(props) => <Link {...props} to="/catalog" search={((prev: Record<string, unknown>) => ({ ...prev, state: state.id })) as never} resetScroll={false} />}
        >
          {state.title}
        </Anchor>
        <Text c="dimmed" fz="xs">
          {state.id}
          {state.route ? ` · ${state.route}` : ''}
        </Text>
        <Group gap="xs" aria-label={`${state.title} by profile`}>
          {state.cells.map((cell) => (
            <CoverageBadge key={cell.profile.key} cell={cell} />
          ))}
        </Group>
      </Stack>
    </Card>
  );
}

function Origin({ capture, now }: { capture: UiCapture; now: number }) {
  const { origin } = capture;
  const sha = shortSha(origin.sha);
  return (
    <Text c="dimmed" fz="xs" component="div">
      From layer <Code>{origin.layer.slice(0, 12)}</Code> in backend <Code>{origin.backend}</Code>, producer {origin.producer}
      {capture.labels.shard ? `, shard ${capture.labels.shard}` : ''}
      {origin.branch ? `, ${origin.branch}` : ''}
      {sha ? <> at <Code>{sha}</Code></> : ''}
      {', '}
      <time dateTime={new Date(origin.recordedAtMs).toISOString()} title={exactTime(origin.recordedAtMs)}>
        {ago(origin.recordedAtMs, now)}
      </time>
      {origin.freshness === 'modified' ? ', recorded with local changes' : origin.freshness === 'unknown' ? ', origin not captured' : ''}
      {capture.alternatives > 0 ? `, ${plural(capture.alternatives, 'other capture', 'other captures')} from other producers` : ''}
    </Text>
  );
}

function CellColumn({ cell, state, now }: { cell: UiCell; state: UiCatalogState; now: number }) {
  const source = cell.coverage === 'captured' || cell.coverage === 'failed' ? imageSource(cell.capture?.image) : null;
  return (
    <Stack gap="xs" component="section" aria-label={`${state.title} in ${cell.profile.label}`}>
      <Title order={3}>{cell.profile.label}</Title>
      <Group gap="xs">
        <StatusMark status={coverageStatus(cell.coverage)} size={16} />
        <Text fw={600}>{coverageWord(cell.coverage)}</Text>
        {cell.expected === 'undeclared' && <Badge variant="outline">Not in the expected set</Badge>}
        {cell.expected === 'declared' && cell.coverage !== 'captured' && <Badge variant="outline">Expected</Badge>}
      </Group>
      <Picture cell={cell} title={state.title} />
      {source && (
        <Anchor href={source} target="_blank" rel="noreferrer noopener" fz="sm">
          Open the picture{cell.capture?.image?.width && cell.capture.image.height ? ` (${cell.capture.image.width}×${cell.capture.image.height})` : ''}
        </Anchor>
      )}
      {cell.capture?.detail && (
        <Text fz="sm" role="note">
          {cell.capture.detail}
        </Text>
      )}
      {cell.capture ? <Origin capture={cell.capture} now={now} /> : cell.planned ? <Text c="dimmed" fz="xs">Expected by plan layer <Code>{cell.planned.layer.slice(0, 12)}</Code> in backend <Code>{cell.planned.backend}</Code>. Nothing has been captured.</Text> : null}
    </Stack>
  );
}

/** The open state: every profile side by side, with the facts declared about it and where each picture came from. */
function StateDetail({ state, states, onSelect, onClose }: { state: UiCatalogState | null; states: readonly UiCatalogState[]; onSelect: (id: string) => void; onClose: () => void }) {
  const navigation = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const index = states.findIndex((item) => item.id === state?.id);
  const select = (page: number) => {
    const next = states[page - 1];
    if (!next || next.id === state?.id) return;
    // Keep focus inside a stable element even when numbered controls are replaced.
    navigation.current?.focus();
    if (viewport.current) viewport.current.scrollTop = 0;
    onSelect(next.id);
  };
  const now = useNow();
  const facts: [string, string][] = state ? [
    ['Route', state.route ?? ''], ['Fixture', state.fixture ?? ''], ['Cohort', state.cohort ?? ''], ['Area', state.area ?? ''],
    ['Feature flags', state.flags.join(', ')], ['Surfaces covered', state.covers.join(', ')], ['Producers', state.producers.join(', ')],
    ...Object.entries(state.attributes ?? {})
  ] : [];
  return (
    <Drawer.Root opened={!!state} onClose={onClose} position="right" size="xl"
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || index < 0) return;
        const target = event.target as HTMLElement;
        if (target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="slider"], [role="combobox"]')) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.stopPropagation();
        select(index + (event.key === 'ArrowLeft' ? 0 : 2));
      }}
    >
      <Drawer.Overlay />
      <Drawer.Content p={0} h="100%">
        <Stack h="100%" gap={0}>
          <Drawer.Header flex="0 0 auto">
            <Drawer.Title>{state?.title}</Drawer.Title>
            <Drawer.CloseButton aria-label="Close the state" />
          </Drawer.Header>
          {state && <>
            <ScrollArea flex={1} mih={0} viewportRef={viewport}>
              <Drawer.Body>
                <Stack gap="md">
                  <Text c="dimmed" fz="sm">
                    {state.id}
                  </Text>
                  <Table aria-label="Declared facts" withRowBorders>
                    <Table.Tbody>
                      {facts.map(([name, value]) => (
                        <Table.Tr key={name}>
                          <Table.Th scope="row" w="40%">{name}</Table.Th>
                          <Table.Td>{value || <Text span c="dimmed">Not declared</Text>}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  <Title order={3}>Profiles side by side</Title>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                    {state.cells.map((cell) => (
                      <CellColumn key={cell.profile.key} cell={cell} state={state} now={now} />
                    ))}
                  </SimpleGrid>
                </Stack>
              </Drawer.Body>
            </ScrollArea>
            <Divider />
            <Stack gap="xs" component="nav" p="lg" flex="0 0 auto" aria-label="Catalog item navigation" tabIndex={-1} ref={navigation}>
              <Text role="status" aria-live="polite" aria-atomic="true">
                {index >= 0 ? `Item ${index + 1} of ${states.length}: ${state.title}` : `${state.title} is outside the current filters.`}
              </Text>
              {index >= 0 && (
                <Pagination
                  total={states.length}
                  value={index + 1}
                  onChange={select}
                  layout="responsive"
                  formatLabel={({ page, totalPages }) => `Item ${page} of ${totalPages}`}
                  getControlProps={(control) => ({ 'aria-label': control === 'previous' ? 'Previous catalog item' : 'Next catalog item' })}
                  getItemProps={(page) => ({ 'aria-label': `Go to item ${page}: ${states[page - 1]!.title}`, 'aria-current': page === index + 1 ? 'page' : undefined })}
                />
              )}
              <Text c="dimmed" fz="sm">Use Left and Right arrow keys to move between items. Press Escape to close.</Text>
            </Stack>
          </>}
        </Stack>
      </Drawer.Content>
    </Drawer.Root>
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

function Surfaces({ catalog }: { catalog: UiCatalog }) {
  const [rows, setRows] = useState(SURFACES);
  if (!catalog.surfaces.length) return null;
  const open = catalog.summary.uncoveredSurfaces;
  const inventoried = catalog.surfaces.some((surface) => surface.inventoried);
  return (
    <Accordion variant="contained" defaultValue={open ? 'surfaces' : null}>
      <Accordion.Item value="surfaces">
        <Accordion.Control>
          Coverage of the product&rsquo;s surfaces: {plural(catalog.surfaces.length, 'surface', 'surfaces')}, {open === 0 ? 'all with a captured state' : `${open} without one`}
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
  const expression = catalogExpression(search);
  const [pending, setPending] = useState({ expression, text: '' });
  const draft = pending.expression === expression ? pending.text : '';
  const setDraft = (text: string, base = expression) => setPending({ expression: base, text });
  useEffect(() => setShown(CARDS), [expression, draft]);
  const committed = useMemo(() => whole ? searchCatalog(whole, expression) : null, [whole, expression]);
  const result = useMemo(() => draft && whole ? searchCatalog(whole, `${expression} ${draft}`) : committed, [whole, expression, draft, committed]);
  const catalog = result?.catalog;
  const narrowed = Boolean(expression || draft);
  const unavailable = evidence.backends.filter((backend) => !backend.available);
  const open = catalog && search.state ? whole?.states.find((state) => state.id === search.state) ?? null : null;
  return (
    <Container size="xl" w="100%" py="xl" component="article" aria-label="UI catalog">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Title order={1}>UI catalog</Title>
            <Text c="dimmed">Each state of the product&rsquo;s interface, captured once per profile, with where every picture came from.</Text>
          </Stack>
          {catalog && catalog.states.length > 0 && (
            <Group gap="sm">
              {!search.compare && (
                <Button type="button" variant="default" leftSection={<IconArrowsExchange size={16} aria-hidden="true" />} onClick={() => go({ compare: 'commit' })}>
                  Compare
                </Button>
              )}
              <Button type="button" leftSection={<IconDownload size={16} aria-hidden="true" />} onClick={() => download(catalog)}>
                Download the manifest
              </Button>
            </Group>
          )}
        </Group>
        {whole && <UiCatalogFilters catalog={whole} expression={expression} draft={draft} onDraft={setDraft} issues={committed?.issues ?? []} />}
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
        {catalog && whole && search.compare && <UiCatalogCompare whole={whole} expression={`${expression} ${draft}`} />}
        {catalog && whole && !search.compare && (
          <>
            <Summary catalog={catalog} narrowed={narrowed} />
            <Surfaces catalog={whole} />
            <CollectionPanel />
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
                <SimpleGrid role="list" cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="md" aria-label="States">
                  {catalog.states.slice(0, shown).map((state) => (
                    <StateCard key={state.id} state={state} shown={state.cells.find((cell) => cell.coverage === 'captured') ?? state.cells[0]!} />
                  ))}
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
        {search.state && catalog && !open && evidence.ready && evidence.pending === 0 && (
          <Alert role="status" color="gray" title="That state is not in the catalog">
            <Text span inherit>{search.state}</Text> has no recorded capture or plan yet. It appears here if a layer that holds it arrives.{' '}
            <Anchor renderRoot={(props) => <Link {...props} to="/catalog" search={((prev: Record<string, unknown>) => ({ ...prev, state: undefined })) as never} />}>Back to the catalog</Anchor>
          </Alert>
        )}
      </Stack>
      <StateDetail state={open} states={catalog?.states ?? []} onSelect={(id) => go({ state: id })} onClose={() => go({ state: undefined })} />
    </Container>
  );
}
