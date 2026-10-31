/** @module Settings command palette
 * The settings document uses the same page action inventory as the viewer, without loading report contexts.
 */
import { Button, Text } from '@mantine/core';
import { Spotlight, useSpotlight } from '@mantine/spotlight';
import { IconCommand } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { commandDocuments, commandPortalTarget, searchCommands, pageCommands, type AppCommand } from './commands';
import { finderStore, isFinderOpen, setFinderOpen, toggleFinder, useFinderOpen } from './open';
import { indexCorpus } from './rank';

/** A keyboard-accessible launcher and palette for the independent server settings application. */
export function PageCommandPalette() {
  const open = useFinderOpen();
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [shown, setShown] = useState(40);
  useLayoutEffect(() => { if (open) finderStore.setState(state => ({ ...state, selected: 0 })); setShown(40); }, [open, query]);
  const commands = useMemo(() => open ? pageCommands() : [], [open]);
  const index = useMemo(() => indexCorpus(commandDocuments(commands)), [commands]);
  const matches = useMemo(() => searchCommands(index, query.replace(/^\s*>/, '')), [index, query]);
  const pending = useRef<AppCommand | null>(null);
  const actionStarted = useRef(false);
  useEffect(() => { if (open) actionStarted.current = false; }, [open]);
  useEffect(() => {
    if (!open && pending.current) queueMicrotask(() => {
      const command = pending.current; pending.current = null;
      if (command?.run() === false) { setFinderOpen(true, true); setNotice('That action is no longer available. Choose a current action.'); }
    });
  }, [open]);
  const state = useSpotlight(finderStore);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey) return;
      if (event.key === 'Escape' && isFinderOpen()) { event.preventDefault(); event.stopImmediatePropagation(); setFinderOpen(false); return; }
      if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === 'k' && !event.shiftKey || event.key.toLowerCase() === 'p' && event.shiftKey)) {
        event.preventDefault(); toggleFinder();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  return <>
    <Button variant="subtle" leftSection={<IconCommand size={16} aria-hidden="true" />} aria-label="Search and commands" aria-keyshortcuts="Meta+K Control+K Meta+Shift+P Control+Shift+P" onClick={() => setFinderOpen(true, true)}>Commands</Button>
    <Spotlight.Root store={finderStore} shortcut={null} title="Settings commands" query={query} onQueryChange={setQuery}
      portalProps={{ target: commandPortalTarget() }} attributes={{ content: { 'aria-label': 'Settings commands', 'data-atlas-command-palette': true } }}
      onKeyDown={event => { if (event.key !== 'Tab') event.stopPropagation(); }} returnFocus={!actionStarted.current} scrollable maxHeight="60vh">
      <Spotlight.Search data-mantine-stop-propagation="true" aria-label="Settings commands" placeholder="Find an action or field…" role="combobox" aria-expanded={open} aria-controls="settings-command-actions" aria-activedescendant={matches[Math.max(0, state.selected)]?.doc.id} onKeyDown={() => queueMicrotask(() => finderStore.setState(finderStore.getState()))} />
      <Spotlight.ActionsList id="settings-command-actions" role="listbox" aria-label="Settings actions">
        {matches.length === 0 && <Spotlight.Empty>No available commands match. Expand a settings section to reveal its controls.</Spotlight.Empty>}
        {matches.slice(0, shown).map(({ doc }) => <Spotlight.Action key={doc.id} id={doc.id} ref={node => { if (node) node.id = doc.id; }} data-selected={matches[Math.max(0, state.selected)]?.doc.id === doc.id || undefined} data-mantine-stop-propagation="true" role="option" aria-selected={matches[Math.max(0, state.selected)]?.doc.id === doc.id}
          label={doc.title} description={doc.subtitle} leftSection={<IconCommand size={16} aria-hidden="true" />} onClick={() => {
            actionStarted.current = true; pending.current = commands.find(command => command.id === doc.id) ?? null; setFinderOpen(false);
          }} />)}
      </Spotlight.ActionsList>
      <Spotlight.Footer>{matches.length > shown && <Button data-mantine-stop-propagation="true" variant="subtle" onClick={() => setShown(shown + 40)}>Show more commands ({matches.length - shown} more)</Button>}<Text size="xs" c="dimmed" role="status">{notice || 'Cmd/Ctrl+K or Cmd/Ctrl+Shift+P · arrows choose · Enter runs · Escape closes. Form validation and confirmations still apply.'}</Text></Spotlight.Footer>
    </Spotlight.Root>
  </>;
}
