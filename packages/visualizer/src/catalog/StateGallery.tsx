/**
 * @module Focused catalog item
 *
 * One screen and its captures, with image inspection and provenance in the same workspace.
 * Item navigation uses the index's complete filtered order, independently of the selected profile.
 */
import type { UiCapture, UiCatalogState, UiCell } from '@crvouga/atlas/reports/ui-catalog';
import { Badge, Box, Button, Code, Group, NativeSelect, Modal, Pagination, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { IconArrowLeft, IconArrowRight, IconArrowsMaximize } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';

import { ago, exactTime, plural, shortSha, useNow } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { GalleryProvider, ImageInspection, useGallery } from './Gallery';
import { galleryImage, Picture } from './Picture';
import { ScreenActions } from './ScreenActions';
import { useCatalogNavigate, useCatalogSearch } from './search';
import { coverageStatus, coverageWord } from './words';

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

function CaptureDetails({ cell }: { cell: UiCell }) {
  const now = useNow();
  return <Stack gap="xs">
    <Group gap="xs">
      <StatusMark status={coverageStatus(cell.coverage)} size={16} />
      <Text fw={600}>{coverageWord(cell.coverage)}</Text>
      {cell.expected === 'undeclared' && <Badge variant="outline">Not in the expected set</Badge>}
      {cell.expected === 'declared' && cell.coverage !== 'captured' && <Badge variant="outline">Expected</Badge>}
      {cell.capture?.image?.width && cell.capture.image.height && <Text size="sm" c="dimmed">{cell.capture.image.width}×{cell.capture.image.height}</Text>}
    </Group>
    {cell.capture?.detail && <Text size="sm" role="note">{cell.capture.detail}</Text>}
    {cell.capture ? <Origin capture={cell.capture} now={now} /> : cell.planned ? <Text c="dimmed" size="xs">Expected by plan layer <Code>{cell.planned.layer.slice(0, 12)}</Code> in backend <Code>{cell.planned.backend}</Code>. Nothing has been captured.</Text> : null}
  </Stack>;
}

function ItemDetails({ state }: { state: UiCatalogState }) {
  const facts: [string, string][] = [
    ['UI kind', state.kind ?? ''], ['Route', state.route ?? ''], ['Fixture', state.fixture ?? ''], ['Cohort', state.cohort ?? ''], ['Area', state.area ?? ''],
    ['Feature flags', state.flags.join(', ')], ['Surfaces covered', state.covers.join(', ')], ['Producers', state.producers.join(', ')],
    ...Object.entries(state.attributes ?? {})
  ];
  return <Table.ScrollContainer minWidth={320}>
    <Table aria-label="Declared facts"><Table.Tbody>
      {facts.map(([name, value]) => <Table.Tr key={name}><Table.Th scope="row">{name}</Table.Th><Table.Td>{value || <Text span c="dimmed">Not declared</Text>}</Table.Td></Table.Tr>)}
    </Table.Tbody></Table>
  </Table.ScrollContainer>;
}

interface StateGalleryProps {
  state: UiCatalogState;
  states: readonly UiCatalogState[];
  profile?: string;
  scope?: string;
  onProfile: (profile: string) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function FocusedGallery({ state, states, profile, scope, onProfile, onSelect, onClose }: StateGalleryProps) {
  const gallery = useGallery();
  const { search } = useCatalogSearch();
  const go = useCatalogNavigate();
  const panel = search.panel === 'facts' || search.panel === 'captures' ? search.panel : null;
  const closePanel = () => go({ panel: undefined }, { replace: true });
  const heading = useRef<HTMLHeadingElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
  const index = states.findIndex(item => item.id === state.id);
  const cell = state.cells.find(cell => cell.profile.key === profile) ?? state.cells.find(cell => galleryImage(cell, state.title)) ?? state.cells[0];
  const images = state.cells.flatMap(cell => { const image = galleryImage(cell, state.title); return image ? [{ cell, image }] : []; });
  const image = cell ? galleryImage(cell, state.title) : null;
  const imageIndex = images.findIndex(item => item.cell.profile.key === cell?.profile.key);
  useEffect(() => { heading.current?.focus(); window.scrollTo(0, 0); }, []);
  const select = (page: number) => {
    const next = states[page - 1];
    if (!next || next.id === state.id) return;
    navigation.current?.focus();
    onSelect(next.id);
  };
  return <Stack component="section" aria-label="Catalog details gallery" gap="md" onKeyDown={event => {
    if (gallery?.opened || panel || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="combobox"]')) return;
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (index >= 0 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      select(index + (event.key === 'ArrowLeft' ? 0 : 2));
    }
  }}>
    <Group justify="space-between" align="flex-start">
      <Stack gap="xs">
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} aria-hidden="true" />} onClick={onClose}>Back to catalog</Button>
        <Title ref={heading} tabIndex={-1} order={1}>{state.title}</Title>
        <Text c="dimmed" size="sm">{state.id}{state.route ? ` · ${state.route}` : ''}</Text>
        <Group gap="xs">
          <Button variant="default" onClick={() => go({ panel: 'facts' })}>Item details</Button>
          <Button variant="default" onClick={() => go({ panel: 'captures' })}>Capture details</Button>
        </Group>
        <ScreenActions state={state} cell={cell} />
      </Stack>
      <Stack component="nav" aria-label="Catalog item navigation" gap="xs" tabIndex={-1} ref={navigation}>
        <Text role="status" aria-live="polite" aria-atomic="true">{index >= 0 ? `Item ${index + 1} of ${states.length}: ${state.title}` : `${state.title} is outside the current filters.`}</Text>
        {index >= 0 && <>
          <Group gap="xs">
            <Button variant="default" aria-label="Previous catalog item" leftSection={<IconArrowLeft size={16} aria-hidden="true" />} disabled={index === 0} onClick={() => select(index)}>Previous item</Button>
            <Button aria-label="Next catalog item" rightSection={<IconArrowRight size={16} aria-hidden="true" />} disabled={index === states.length - 1} onClick={() => select(index + 2)}>Next item</Button>
          </Group>
          <Pagination total={states.length} value={index + 1} onChange={select} layout="responsive" withControls={false}
            formatLabel={({ page, totalPages }) => `Item ${page} of ${totalPages}`}
            getItemProps={page => ({ 'aria-label': `Go to item ${page}: ${states[page - 1]!.title}`, 'aria-current': page === index + 1 ? 'page' : undefined })} />
        </>}
      </Stack>
    </Group>
    <Text size="sm" c="dimmed">{scope ? <>Current catalog search: <Code>{scope}</Code>. </> : 'All catalog items. '}Left / Right for items; Escape to return to the catalog.</Text>
    <Paper withBorder p="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-end">
          <NativeSelect label="Image profile" value={cell?.profile.key ?? ''} onChange={event => onProfile(event.currentTarget.value)}
            data={state.cells.map(cell => ({ value: cell.profile.key, label: `${cell.profile.label} · ${coverageWord(cell.coverage)}` }))} />
          <Group gap="xs">
            <Button variant="default" disabled={imageIndex <= 0} onClick={() => onProfile(images[imageIndex - 1]!.cell.profile.key)}>Previous image</Button>
            <Text role="status">{imageIndex >= 0 ? `Image ${imageIndex + 1} of ${images.length}` : 'No image for this profile'}</Text>
            <Button variant="default" disabled={imageIndex >= images.length - 1 || images.length === 0} onClick={() => onProfile(images[imageIndex + 1]!.cell.profile.key)}>Next image</Button>
            {image && <Button leftSection={<IconArrowsMaximize size={16} aria-hidden="true" />} onClick={() => gallery?.open(image)}>Open full-screen</Button>}
          </Group>
        </Group>
        <Box h="65dvh" mih={360} flex="0 0 auto" miw={0} role="group" aria-label="Selected image">
          {image ? <ImageInspection key={`${state.id}|${cell!.profile.key}`} image={image} shortcuts={!gallery?.opened && !panel} />
            : <Picture cell={cell} title={state.title} height="100%" emptyMessage={cell ? undefined : 'No profiles have been recorded.'} />}
        </Box>
        {cell && <Group gap="xs"><StatusMark status={coverageStatus(cell.coverage)} size={16} /><Text size="sm">{coverageWord(cell.coverage)}</Text><Text size="sm" c="dimmed">{cell.capture?.image?.width && cell.capture.image.height ? `${cell.capture.image.width}×${cell.capture.image.height}` : cell.capture?.detail || 'Use Capture details for provenance and diagnostics.'}</Text></Group>}
      </Stack>
    </Paper>
    <Modal opened={!!panel} onClose={closePanel} title={panel === 'captures' ? `Capture details: ${state.title}` : `Item details: ${state.title}`} size="lg"
      closeButtonProps={{ 'aria-label': 'Close screen details' }} onKeyDown={event => { if ((event.target as HTMLElement).closest('[data-atlas-command-palette]')) return; event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); closePanel(); } }}>
      {panel === 'facts' ? <ItemDetails state={state} /> : panel === 'captures' ? <Stack gap="lg">
        {state.cells.map(profile => <Stack key={profile.profile.key} gap="xs" component="section" aria-label={`${state.title} in ${profile.profile.label}`}>
          <Title order={2}>{profile.profile.label}</Title><CaptureDetails cell={profile} />
        </Stack>)}
      </Stack> : null}
      <ScreenActions state={state} cell={cell} share={false} />
    </Modal>
  </Stack>;
}

/** Show an item's images and all recorded facts without an index or a side drawer. */
export function StateGallery(props: StateGalleryProps) {
  const images = props.state.cells.flatMap(cell => { const image = galleryImage(cell, props.state.title); return image ? [image] : []; });
  const cell = props.state.cells.find(cell => cell.profile.key === props.profile) ?? props.state.cells.find(cell => galleryImage(cell, props.state.title)) ?? props.state.cells[0];
  return <GalleryProvider images={images} actions={<ScreenActions state={props.state} cell={cell} share={false} />} onImageChange={image => {
    const cell = props.state.cells.find(cell => galleryImage(cell, props.state.title)?.name === image.name && galleryImage(cell, props.state.title)?.source === image.source);
    if (cell) props.onProfile(cell.profile.key);
  }}>
    <FocusedGallery {...props} />
  </GalleryProvider>;
}
