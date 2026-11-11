/** @module Screen sharing
 * Fast Markdown handoffs and a focused share dialog, including a manual fallback when clipboard access is unavailable.
 */
import type { UiCatalogState, UiCell } from '@crvouga/atlas/reports/ui-catalog';
import { Alert, Anchor, Button, Group, Modal, Popover, Stack, Text, Textarea, TextInput, VisuallyHidden } from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import { IconCheck, IconCopy, IconShare } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import { useUiCatalog } from './provider';
import { screenHandoff } from './handoff';
import { withEvidence } from './server-catalog';
import { IconAction } from './IconAction';
import { useCatalogSearch, type CatalogSearch } from './search';

/**
 * Share a specific state/profile from a card or focused screen, with truthful evidence and no clipboard-only dead end.
 * `compact` draws the same named actions as icon buttons for cards and toolbars.
 */
export function ScreenActions({ state, cell, selection, share = true, compact = false }: { state: UiCatalogState; cell?: UiCell; selection?: CatalogSearch; share?: boolean; compact?: boolean }) {
  const { search } = useCatalogSearch();
  const catalog = useUiCatalog();
  const [opened, setOpened] = useState(false);
  const clipboard = useClipboard();
  const notices = [...(catalog?.sources.notices ?? []), ...(catalog?.sources.backends ?? []).filter(backend => !backend.available).map(backend => `Backend ${backend.id} is unavailable; its evidence is unknown.`)];
  // Every profile of the state, with the evidence of the given state where it has it: read through a server, the catalog's
  // own copy is an index without pictures or origins, and the state drawn carries the evidence that was read.
  const listed = catalog?.states.find(item => item.id === state.id);
  const fullState = listed ? withEvidence(listed, state) : state;
  const buildHandoff = () => screenHandoff(fullState, cell, { ...search, ...selection }, catalog?.version, notices);
  const handoff = opened || clipboard.error ? buildHandoff() : null;
  useEffect(() => { setOpened(false); clipboard.reset(); }, [state.id]);
  const copy = (text: string) => { clipboard.copy(text); };
  const denied = !!clipboard.error && !opened;
  const fallback = share
    ? <Button variant="subtle" onClick={() => setOpened(true)}>Select Markdown manually</Button>
    : <Textarea label="Screen Markdown" value={handoff?.markdown ?? ''} readOnly autosize minRows={4} maxRows={8} onFocus={event => event.currentTarget.select()} />;
  return <>
    {compact ? <Popover opened={denied} onChange={open => { if (!open) clipboard.reset(); }} position="bottom-end" width={320} shadow="md" withRoles={false}>
      <Popover.Target>
        <Group gap={2} wrap="nowrap">
          <IconAction label="Copy as Markdown" onClick={() => copy(buildHandoff().markdown)}>
            {clipboard.copied ? <IconCheck size={16} aria-hidden="true" /> : <IconCopy size={16} aria-hidden="true" />}
          </IconAction>
          {share && <IconAction label="Share screen" onClick={() => { clipboard.reset(); setOpened(true); }}><IconShare size={16} aria-hidden="true" /></IconAction>}
          {clipboard.copied && <VisuallyHidden role="status">Copied to clipboard</VisuallyHidden>}
        </Group>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Alert color="red" title="Clipboard unavailable">{fallback}</Alert>
      </Popover.Dropdown>
    </Popover> : <>
      <Group gap="xs">
        <Button leftSection={<IconCopy size={16} aria-hidden="true" />} onClick={() => copy(buildHandoff().markdown)}>Copy as Markdown</Button>
        {share && <Button variant="subtle" leftSection={<IconShare size={16} aria-hidden="true" />} onClick={() => { clipboard.reset(); setOpened(true); }}>Share screen</Button>}
        {clipboard.copied && <Text size="sm" c="dimmed" role="status">Copied to clipboard</Text>}
      </Group>
      {denied && <Alert color="red" title="Clipboard unavailable">{fallback}</Alert>}
    </>}
    {share && <Modal opened={opened} onClose={() => setOpened(false)} title={`Share ${state.title}`} size="lg" onKeyDown={event => { if ((event.target as HTMLElement).closest('[data-atlas-command-palette]')) return; event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); setOpened(false); } }} closeButtonProps={{ 'aria-label': 'Close screen sharing' }}>
      {handoff && <Stack gap="md">
        <Text size="sm" c="dimmed">Send this screen and profile to a teammate or agent. Links show the current evidence and require the same read access as Atlas.</Text>
        <TextInput label="Screen link" value={handoff.viewerUrl} readOnly onFocus={event => event.currentTarget.select()} />
        <Group gap="xs">
          <Button size="xs" onClick={() => copy(handoff.viewerUrl)}>Copy screen link</Button>
          <Anchor href={handoff.viewerUrl}>Open screen</Anchor>
        </Group>
        {handoff.documentUrl ? <>
          <TextInput label="Agent Markdown link" description="Readable over HTTP without opening the viewer or running JavaScript." value={handoff.documentUrl} readOnly onFocus={event => event.currentTarget.select()} />
          <Group gap="xs"><Button size="xs" onClick={() => copy(handoff.documentUrl!)}>Copy agent link</Button><Anchor href={handoff.documentUrl} target="_blank" rel="noreferrer noopener">Read agent document</Anchor></Group>
        </> : <Text size="sm" c="dimmed">This static viewer has no live agent endpoint. Copy the complete Markdown below.</Text>}
        <Textarea label="Screen Markdown" description="Includes facts, image links, capture provenance and missing-evidence warnings." value={handoff.markdown} readOnly autosize minRows={8} maxRows={16} onFocus={event => event.currentTarget.select()} />
        <Group gap="sm">
          <Button variant="filled" leftSection={<IconCopy size={16} aria-hidden="true" />} onClick={() => copy(handoff.markdown)}>Copy screen Markdown</Button>
          {clipboard.copied && <Text size="sm" c="dimmed" role="status">Copied to clipboard</Text>}
        </Group>
        {clipboard.error && <Alert color="red" title="Clipboard unavailable">Select and copy a link or the Markdown field manually.</Alert>}
      </Stack>}
    </Modal>}
  </>;
}
