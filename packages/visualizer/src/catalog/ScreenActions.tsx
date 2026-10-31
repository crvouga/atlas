/** @module Screen sharing
 * Fast Markdown handoffs and a focused share dialog, including a manual fallback when clipboard access is unavailable.
 */
import type { UiCatalogState, UiCell } from '@crvouga/atlas/reports/ui-catalog';
import { Alert, Anchor, Button, Group, Modal, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useClipboard } from '@mantine/hooks';
import { IconCopy, IconShare } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

import { useUiCatalog } from './provider';
import { screenHandoff } from './handoff';
import { useCatalogSearch, type CatalogSearch } from './search';

/** Share a specific state/profile from a card or focused screen, with truthful evidence and no clipboard-only dead end. */
export function ScreenActions({ state, cell, selection, share = true }: { state: UiCatalogState; cell?: UiCell; selection?: CatalogSearch; share?: boolean }) {
  const { search } = useCatalogSearch();
  const catalog = useUiCatalog();
  const [opened, setOpened] = useState(false);
  const clipboard = useClipboard();
  const notices = [...(catalog?.sources.notices ?? []), ...(catalog?.sources.backends ?? []).filter(backend => !backend.available).map(backend => `Backend ${backend.id} is unavailable; its evidence is unknown.`)];
  const fullState = catalog?.states.find(item => item.id === state.id) ?? state;
  const buildHandoff = () => screenHandoff(fullState, cell, { ...search, ...selection }, catalog?.version, notices);
  const handoff = opened || clipboard.error ? buildHandoff() : null;
  useEffect(() => { setOpened(false); clipboard.reset(); }, [state.id]);
  const copy = (text: string) => { clipboard.copy(text); };
  return <>
    <Group gap="xs">
      <Button variant="default" leftSection={<IconCopy size={16} aria-hidden="true" />} onClick={() => copy(buildHandoff().markdown)}>Copy as Markdown</Button>
      {share && <Button variant="subtle" leftSection={<IconShare size={16} aria-hidden="true" />} onClick={() => { clipboard.reset(); setOpened(true); }}>Share screen</Button>}
    </Group>
    {clipboard.copied && <Text size="sm" role="status">Copied to clipboard</Text>}
    {clipboard.error && !opened && <Alert color="red" title="Clipboard unavailable">
      {share ? <Button variant="subtle" onClick={() => setOpened(true)}>Select Markdown manually</Button> : <Textarea label="Screen Markdown" value={handoff?.markdown ?? ''} readOnly autosize minRows={4} maxRows={8} onFocus={event => event.currentTarget.select()} />}
    </Alert>}
    {share && <Modal opened={opened} onClose={() => setOpened(false)} title={`Share ${state.title}`} size="lg" onKeyDown={event => { if ((event.target as HTMLElement).closest('[data-atlas-command-palette]')) return; event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); setOpened(false); } }} closeButtonProps={{ 'aria-label': 'Close screen sharing' }}>
      {handoff && <Stack gap="md">
        <Text size="sm" c="dimmed">Send this screen and profile to a teammate or agent. Links show the current evidence and require the same read access as Atlas.</Text>
        <TextInput label="Screen link" value={handoff.viewerUrl} readOnly onFocus={event => event.currentTarget.select()} />
        <Group gap="xs">
          <Button variant="default" onClick={() => copy(handoff.viewerUrl)}>Copy screen link</Button>
          <Anchor href={handoff.viewerUrl}>Open screen</Anchor>
        </Group>
        {handoff.documentUrl ? <>
          <TextInput label="Agent Markdown link" description="Readable over HTTP without opening the viewer or running JavaScript." value={handoff.documentUrl} readOnly onFocus={event => event.currentTarget.select()} />
          <Group gap="xs"><Button variant="default" onClick={() => copy(handoff.documentUrl!)}>Copy agent link</Button><Anchor href={handoff.documentUrl} target="_blank" rel="noreferrer noopener">Read agent document</Anchor></Group>
        </> : <Text size="sm" c="dimmed">This static viewer has no live agent endpoint. Copy the complete Markdown below.</Text>}
        <Textarea label="Screen Markdown" description="Includes facts, image links, capture provenance and missing-evidence warnings." value={handoff.markdown} readOnly autosize minRows={8} maxRows={16} onFocus={event => event.currentTarget.select()} />
        <Button leftSection={<IconCopy size={16} aria-hidden="true" />} onClick={() => copy(handoff.markdown)}>Copy screen Markdown</Button>
        {clipboard.copied && <Text role="status">Copied to clipboard</Text>}
        {clipboard.error && <Alert color="red" title="Clipboard unavailable">Select and copy a link or the Markdown field manually.</Alert>}
      </Stack>}
    </Modal>}
  </>;
}
