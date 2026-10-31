import { IconCommand } from '@tabler/icons-react';
import { Badge, Button, Group, Kbd, List, Modal, Stack, Text } from '@mantine/core';
import { Spotlight, useSpotlight } from '@mantine/spotlight';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAtlas } from '../app/atlas-context';
import { useTestCatalog } from '../explorer/catalog';
import { SearchNotes } from '../explorer/search-notes';
import { useEvidence } from '../evidence/evidence-context';
import { plural } from '../evidence/format';
import { useSpecTexts } from '../evidence/spec-texts';
import { StatusMark } from '../evidence/marks';
import { currentProject, runtimeConfig } from '../runtime';
import { useUiStore } from '../state/ui-store';
import { commandDocuments, commandPortalTarget, searchCommands, pageCommands, type AppCommand } from './commands';
import { kindOfFile, SPEC_KINDS } from '../spec-kind';
import { describeHit } from './behaviors';
import { corpusFrom } from './corpus';
import { finderStore, isCommandsOnly, isFinderOpen, isHelpOpen, setFinderOpen, setHelpOpen, toggleFinder, useFinderOpen, useHelpOpen } from './open';
import { parseSearch, passesFilters } from './query';
import { FIND_GROUPS, indexCorpus, notationOf, rankIndex, splitQuery, type FindKind, type FindTarget, type Ranked } from './rank';
import { applySemantic } from './semantic';
import { useSemantic } from './semantic-search';

/** The finder lists at most this many results; it says so, and offers all of them, when there are more. */
export const FINDER_LIMIT = 40;

const KIND_WORD: Record<FindKind, string> = {
  journey: 'Journey',
  event: 'Action',
  screen: 'Place',
  spec: 'Spec',
  scenario: 'Scenario',
  action: 'Action',
  run: 'Run'
};
const SHORTCUTS: readonly {
  readonly keys: string;
  readonly does: string;
}[] = [
  { keys: '⌘K  or  Ctrl+K', does: 'Search content and run commands' },
  { keys: '⌘⇧P  or  Ctrl+Shift+P', does: 'Open commands only (or type > in search)' },
  { keys: 'Tab  Shift+Tab', does: 'Move between controls; Enter/Space activates; arrows adjust fields' },
  { keys: '/', does: 'Open search and commands outside editable fields' },
  { keys: '↑  ↓', does: 'Move through the list' },
  { keys: 'Enter', does: 'Open' },
  { keys: 'Shift+Enter', does: 'See all results of the search' },
  { keys: '⌘Enter  or  Ctrl+Enter', does: 'Open the recording' },
  { keys: 'Esc', does: 'Close' },
  { keys: '?', does: 'Show these shortcuts' },
  { keys: '←  →', does: 'Previous and next moment' },
  { keys: 'Home  End', does: 'Start and end of a recording' }
];
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target.closest('[role="textbox"],[role="combobox"],[contenteditable="true"]');
}
export function Finder() {
  const open = useFinderOpen();
  const help = useHelpOpen();
  const { view } = useAtlas();
  const evidence = useEvidence();
  const navigate = useNavigate();
  const routeSearch = useSearch({ strict: false });
  const [query, setQuery] = useState('');
  useEffect(() => { if (open && isCommandsOnly()) setQuery('>'); }, [open]);
  const commandsOnly = query.trimStart().startsWith('>');
  const commandQuery = commandsOnly ? query.trimStart().slice(1).trim() : query;
  const readable = useMemo(() => evidence.files.filter((file) => kindOfFile(file)), [evidence.files]);
  // Reading every spec's text is for search, and a focused page needs its own spec first: start only once search is wanted.
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (open && !commandsOnly && !isCommandsOnly()) setWanted(true);
  }, [open, commandsOnly]);
  const { texts, pending, total: specTotal, read, failed } = useSpecTexts(readable, wanted, open && !commandsOnly);
  const catalog = useTestCatalog();
  const tests = useMemo(() => (catalog.model ? new Map(catalog.model.tests.map((test) => [test.key, test] as const)) : undefined), [catalog.model]);
  const docs = useMemo(
    () => corpusFrom(view, evidence.files, evidence.titleOf, evidence.view, texts, tests),
    [view, evidence.files, evidence.titleOf, evidence.view, texts, tests]
  );
  const index = useMemo(() => indexCorpus(docs), [docs]);
  // What search has not covered yet, so an empty answer is not read as "no such behavior".
  const unindexed = evidence.filesPending
    ? 'The spec list is still loading'
    : pending
      ? `${specTotal - read} of ${specTotal} specs are still being read`
      : !evidence.ready && !evidence.unavailable
        ? 'Recorded results are still loading'
        : '';
  const captured = useMemo(() => open ? pageCommands() : [], [open]);
  const commands = useMemo<AppCommand[]>(() => {
    const go = (action: () => void) => () => { useUiStore.getState().setSourcesOpen(false); action(); };
    const destinations: AppCommand[] = [
      { id: 'command:home', title: view && view.charts.size > 0 ? 'Go to Statecharts' : 'Go to project home', description: 'Navigate to the project home and graph', run: go(() => { void navigate({ to: '/', search: {} }); }) },
      { id: 'command:tests', title: 'Go to Tests', description: 'Browse test outcomes and failures', run: go(() => { void navigate({ to: '/', search: { view: 'tests' } }); }) },
      ...(['runs', 'artifacts', 'collections', 'compare', 'health'] as const).map(tab => ({
        id: `command:${tab}`, title: `Go to ${tab === 'health' ? 'Catalog health' : tab[0]!.toUpperCase() + tab.slice(1)}`,
        description: 'Navigate to the test explorer', run: go(() => { void navigate({ to: '/', search: { view: 'tests', tab } }); })
      })),
      { id: 'command:catalog', title: 'Go to UI catalog', description: 'Browse interface screens and captured images', run: go(() => { void navigate({ to: '/catalog', search: {} }); }) },
      { id: 'command:behaviors', title: 'Go to Behaviors', description: 'Read and watch product behavior', run: go(() => { void navigate({ to: '/behaviors', search: {} }); }) },
      { id: 'command:critiques', title: 'Go to Needs polish', description: 'Review critic feedback', run: go(() => { void navigate({ to: '/critiques', search: {} }); }) },
      ...SPEC_KINDS.map(kind => ({ id: `command:spec:${kind.id}`, title: `Go to ${kind.label}`, description: 'Browse specifications', run: go(() => { void navigate({ to: '/specs/$kind', params: { kind: kind.id }, search: {} }); }) })),
      { id: 'command:refresh', title: 'Refresh report', description: 'Retry reading report data and evidence', run: evidence.retry },
      { id: 'command:sources', title: 'Show evidence sources', description: 'Choose backends, branches, builds and environments', run: () => useUiStore.getState().setSourcesOpen(true) },
      { id: 'command:help', title: 'Show keyboard shortcuts', description: 'Keyboard help and command palette shortcuts', run: () => setHelpOpen(true) },
      { id: 'command:main', title: 'Focus main content', description: 'Skip navigation and focus the current page', run: () => document.querySelector<HTMLElement>('main')?.focus() }
    ];
    if (runtimeConfig()?.api) destinations.push({ id: 'command:settings', title: 'Go to Settings', description: 'Server settings and garbage collection', run: () => { window.location.href = `/admin${currentProject() ? `?project=${encodeURIComponent(currentProject()!)}` : ''}`; } });
    return [...destinations, ...captured];
  }, [captured, navigate, view?.charts.size, evidence.retry]);
  const commandIndex = useMemo(() => indexCorpus(commandDocuments(commandsOnly ? commands : commands.filter(command => !command.contentLink))), [commands, commandsOnly]);
  const commandMatches = useMemo(() => searchCommands(commandIndex, commandQuery), [commandIndex, commandQuery]);
  const pendingCommand = useRef<AppCommand | null>(null);
  const actionStarted = useRef(false);
  useEffect(() => { if (open) actionStarted.current = false; }, [open]);
  const runCommand = (command: AppCommand) => { actionStarted.current = true; pendingCommand.current = command; setFinderOpen(false); };
  const finishCommand = () => {
    const command = pendingCommand.current;
    pendingCommand.current = null;
    if (command?.run() === false) { setFinderOpen(true, true); setNotice('That action is no longer available. Choose an action from the current page.'); }
  };
  useEffect(() => { if (!open && pendingCommand.current) queueMicrotask(finishCommand); }, [open]);
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const store = finderStore;
  const spotlightState = useSpotlight(store);

  const parsed = useMemo(() => parseSearch(commandsOnly ? '' : query), [query, commandsOnly]);
  // Every match, best first: the list below is the first FINDER_LIMIT of it, and says so when there are more.
  const everything = useMemo(() => commandsOnly ? [] : rankIndex(index, query, Number.POSITIVE_INFINITY), [index, query, commandsOnly]);
  const lexical = useMemo(() => (showAll ? everything : everything.slice(0, FINDER_LIMIT)), [everything, showAll]);
  const searchable = useMemo(() => {
    const notations = splitQuery(parsed.words).notations;
    return docs.filter((doc) => (notations.size === 0 || notations.has(notationOf(doc))) && passesFilters(doc.facets, parsed.filters));
  }, [docs, parsed]);
  const lexicalDocs = useMemo(() => lexical.map((hit) => hit.doc), [lexical]);
  const literal = parsed.phrases.length + parsed.identifiers.length > 0;
  const semantic = useSemantic(open && !commandsOnly && parsed.words.length > 0 && !literal, parsed.words, searchable, lexicalDocs);
  const contentShown = useMemo<Ranked[]>(
    () => commandsOnly ? [] : (semantic.queryVector ? applySemantic(searchable, lexical, semantic.queryVector, semantic.vectors, showAll ? Number.POSITIVE_INFINITY : FINDER_LIMIT) : lexical),
    [semantic.queryVector, searchable, lexical, semantic.vectors, showAll, commandsOnly]
  );
  const shown = useMemo(() => [...contentShown, ...(showAll ? commandMatches : commandMatches.slice(0, FINDER_LIMIT))], [contentShown, commandMatches, showAll]);
  const groups = useMemo(() => !query.trim() || commandsOnly ? ['Commands' as const, ...FIND_GROUPS] : [...FIND_GROUPS, 'Commands' as const], [query, commandsOnly]);
  const ordered = useMemo(() => groups.flatMap(group => shown.filter(hit => hit.doc.group === group)), [shown, groups]);
  const total = everything.length;
  const bounded = !showAll && total > FINDER_LIMIT;
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;
  const selectedId = useRef<string | null>(null);
  useEffect(
    () =>
      store.subscribe((state) => {
        selectedId.current = orderedRef.current[Math.max(0, state.selected)]?.doc.id ?? null;
      }),
    [store]
  );

  // Rank results ourselves, then let Spotlight own keyboard selection and scrolling.
  // Compound Spotlight does not initialize a selection when asynchronous results arrive. A new query selects its first
  // result; results that change under the same query (specs read, meaning-based re-ranking) keep the selected result
  // selected by identity, and say so when it is gone, so Enter always opens what is highlighted.
  const lastQuery = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      lastQuery.current = null;
      return;
    }
    const first = ordered[0]?.doc.id ?? null;
    if (lastQuery.current !== query) {
      lastQuery.current = query;
      selectedId.current = first;
      setNotice(null);
      setShowAll(false);
      store.setState((state) => ({ ...state, selected: 0 }));
      return;
    }
    const kept = selectedId.current === null ? -1 : ordered.findIndex((hit) => hit.doc.id === selectedId.current);
    if (kept >= 0) {
      if (store.getState().selected !== kept) store.setState((state) => ({ ...state, selected: kept }));
    } else {
      if (selectedId.current !== null) setNotice('The results changed and the selected result is no longer listed, so the first result is selected.');
      selectedId.current = first;
      store.setState((state) => ({ ...state, selected: 0 }));
    }
  }, [open, query, ordered, store]);
  useEffect(() => {
    if (open) return;
    setQuery('');
  }, [open]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p' && !event.altKey) {
        event.preventDefault(); setFinderOpen(true, true); setQuery('>'); return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        toggleFinder();
        return;
      }
      if (event.key === 'Escape' && isFinderOpen()) { event.preventDefault(); event.stopImmediatePropagation(); setFinderOpen(false); return; }
      if (event.key === 'Escape' && isHelpOpen()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setHelpOpen(false);
        return;
      }
      if (isTypingTarget(event.target)) return;
      if ((event.key === '?' || (event.key === '/' && event.shiftKey)) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setFinderOpen(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const openTarget = (target: FindTarget) => {
    const run = typeof routeSearch.run === 'string' ? routeSearch.run : undefined;
    if (target.to === '/chart/$chartId' && target.chartId) {
      const chartId = target.chartId;
      void navigate({
        to: '/chart/$chartId',
        params: { chartId },
        search: { run, screen: target.search.screen, event: target.search.event, journey: target.search.journey }
      });
    } else if (target.to === '/specs/$kind' && target.kind && target.search.spec) {
      const kind = target.kind;
      void navigate({
        to: '/specs/$kind',
        params: { kind },
        search: { run, spec: target.search.spec, check: target.search.check, view: target.search.view }
      });
    } else if (target.to === '/' && target.search.test) {
      void navigate({ to: '/', search: { run, test: target.search.test } });
    }
    setFinderOpen(false);
  };
  // The full results of a search: the explorer's list when the project has one (it filters, counts and sorts everything),
  // else every result in this list.
  const seeAll = () => {
    if (!commandsOnly && catalog.model && query.trim()) {
      const run = typeof routeSearch.run === 'string' ? routeSearch.run : undefined;
      void navigate({ to: '/', search: { run, q: query.trim() } });
      setFinderOpen(false);
    } else setShowAll(true);
  };
  const onCommandKey = (event: ReactKeyboardEvent) => {
    if (event.key === 'Enter' && event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      seeAll();
      return;
    }
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    event.stopPropagation();
    const hit = ordered[Math.max(0, store.getState().selected)];
    if (hit) { const command = commands.find(command => command.id === hit.doc.id); if (command) runCommand(command); else openTarget(hit.doc.recording ?? hit.doc.target); }
  };
  return (
    <>
      <Spotlight.Root
        store={store}
        shortcut={null}
        query={query}
        onQueryChange={setQuery}
        title="Search and commands"
        returnFocus={!actionStarted.current}
        portalProps={{ target: commandPortalTarget() }}
        attributes={{ content: { 'aria-label': 'Find', 'data-atlas-command-palette': true } }}
        onKeyDownCapture={onCommandKey}
        onKeyDown={event => { if (event.key !== 'Tab') event.stopPropagation(); }}
        scrollable
        maxHeight="60vh"
      >
        {/* Spotlight updates selection silently; notify its public store after keyboard handling so ARIA follows it. */}
        <Spotlight.Search
          onKeyDown={() => queueMicrotask(() => store.setState(store.getState()))}
          data-mantine-stop-propagation="true"
          role="combobox"
          aria-expanded={open}
          aria-controls="atlas-finder-actions"
          aria-activedescendant={ordered[Math.max(0, spotlightState.selected)]?.doc.id}
          aria-label="Search and commands"
          placeholder='Search Atlas or type > for commands…'
        />
        <Spotlight.ActionsList id="atlas-finder-actions" role="listbox" aria-label="Commands, flows, specs and runs">
          {shown.length === 0 && (
            <Spotlight.Empty>
              {commandsOnly ? 'No commands match. Open a section to reveal its actions, then reopen the palette.' : !query.trim()
                ? 'Type what someone does. For example, add a todo.'
                : unindexed
                  ? `No match yet. ${unindexed}, so this is not the final answer.`
                  : failed > 0
                    ? `Nothing close to that. ${plural(failed, 'spec', 'specs')} could not be read, so search may miss ${failed === 1 ? 'it' : 'them'}.`
                    : 'Nothing close to that.'}
            </Spotlight.Empty>
          )}
          {groups.map((group) => {
            const hits = shown.filter((hit) => hit.doc.group === group);
            return hits.length ? (
              <Spotlight.ActionsGroup key={group} label={group}>
                {hits.map((hit) => (
                  <Spotlight.Action
                    key={hit.doc.id}
                    id={hit.doc.id}
                    ref={(node) => {
                      if (node) node.id = hit.doc.id;
                    }}
                    data-command={hit.doc.group === 'Commands' || undefined}
                    data-mantine-stop-propagation="true"
                    role="option"
                    data-selected={ordered[Math.max(0, spotlightState.selected)]?.doc.id === hit.doc.id || undefined}
                    aria-selected={ordered[Math.max(0, spotlightState.selected)]?.doc.id === hit.doc.id}
                    onClick={() => { const command = commands.find(command => command.id === hit.doc.id); if (command) runCommand(command); else openTarget(hit.doc.target); }}
                    label={hit.doc.title}
                    description={[hit.snippet !== hit.doc.subtitle ? hit.snippet : '', hit.doc.subtitle, query.trim() ? describeHit(hit) : ''].filter(Boolean).join(' · ')}
                    leftSection={hit.doc.group === 'Commands' ? <IconCommand size={16} aria-hidden="true" /> : hit.doc.status ? <StatusMark status={hit.doc.status} size={16} /> : undefined}
                    rightSection={
                      <Group gap="xs" wrap="nowrap">
                        {hit.exact && <Badge color="blue">Exact</Badge>}
                        {hit.partial && <Badge color="gray" variant="outline">Partial</Badge>}
                        <Badge color="gray">{hit.doc.group === 'Commands' ? 'Command' : KIND_WORD[hit.doc.kind]}</Badge>
                      </Group>
                    }
                  />
                ))}
              </Spotlight.ActionsGroup>
            ) : null;
          })}
        </Spotlight.ActionsList>
        <Spotlight.Footer>
          <Group gap="md" justify="space-between" align="flex-start">
            <Stack gap={0}>
              <Text role="status" size="xs" c="dimmed">
                {commandsOnly ? `${commandMatches.length} commands available for this search.` : query.trim() && total > 0
                  ? bounded
                    ? `Showing the first ${contentShown.length} of ${total} results, not all of them.`
                    : `${total} ${total === 1 ? 'result' : 'results'}.`
                  : '↑↓ move'}
              </Text>
              {!commandsOnly && (unindexed || failed > 0) && (
                <Text role="status" size="xs" c="dimmed">
                  {unindexed ? `Searching what is read so far: ${unindexed}` : `${plural(failed, 'spec', 'specs')} could not be read and ${failed === 1 ? 'is' : 'are'} not searched`}
                </Text>
              )}
              {notice && (
                <Text role="status" size="xs" c="dimmed">
                  {notice}
                </Text>
              )}
              <SearchNotes issues={parsed.issues} semantic={!commandsOnly && query.trim() ? semantic.status : 'idle'} />
            </Stack>
            <Group gap="xs" wrap="wrap" justify="flex-end">
              {!showAll && commandMatches.length > FINDER_LIMIT && <Button data-mantine-stop-propagation="true" size="compact-xs" onClick={() => setShowAll(true)}>Show all {commandMatches.length} commands</Button>}
              {bounded && (
                <Button data-mantine-stop-propagation="true" size="compact-xs" variant="light" onClick={seeAll}>
                  See all {total} results
                </Button>
              )}
              <Text size="xs" c="dimmed">
                ↵ run/open · &gt; commands · ⇧↵ all results · esc close
              </Text>
            </Group>
          </Group>
        </Spotlight.Footer>
      </Spotlight.Root>
      <Modal
        opened={help}
        onClose={() => setHelpOpen(false)}
        title="Keyboard shortcuts"
        portalProps={{ target: commandPortalTarget() }}
        onKeyDown={event => { if (event.key !== 'Tab') event.stopPropagation(); }}
        attributes={{ content: { 'aria-label': 'Keyboard shortcuts', 'data-atlas-command-palette': true, 'data-mantine-stop-propagation': true } }}
        closeButtonProps={{ 'aria-label': 'Close keyboard shortcuts', ...{ 'data-mantine-stop-propagation': true } }}
      >
        <List spacing="md" listStyleType="none">
          {SHORTCUTS.map((shortcut) => (
            <List.Item key={shortcut.keys}>
              <Group justify="space-between">
                <Kbd>{shortcut.keys}</Kbd>
                <Text>{shortcut.does}</Text>
              </Group>
            </List.Item>
          ))}
        </List>
      </Modal>
    </>
  );
}
