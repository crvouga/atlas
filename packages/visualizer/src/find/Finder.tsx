import { Badge, Button, Group, Kbd, List, Modal, Stack, Text } from '@mantine/core';
import { Spotlight, useSpotlight } from '@mantine/spotlight';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAtlas } from '../app/atlas-context';
import { useTestCatalog } from '../explorer/catalog';
import { SearchNotes } from '../explorer/search-notes';
import { keys, specKey, useAdapter } from '../data/queries';
import { useEvidence } from '../evidence/evidence-context';
import { plural } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { kindOfFile } from '../spec-kind';
import { describeHit } from './behaviors';
import { corpusFrom } from './corpus';
import { finderStore, isHelpOpen, setFinderOpen, setHelpOpen, toggleFinder, useFinderOpen, useHelpOpen } from './open';
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
  { keys: '⌘K  or  Ctrl+K', does: 'Find a flow' },
  { keys: '/', does: 'Find a flow' },
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
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A';
}
/**
 * Reads the text of every spec for search, a few at a time, once `enabled`. Each file lands as it arrives, so a search
 * can use what is read so far; `read` of `total` say how far it is, and `failed` how many could not be read at all.
 */
function useSpecTexts(files: readonly string[], enabled: boolean, open: boolean) {
  const adapter = useAdapter();
  const client = useQueryClient();
  const source = specKey(adapter);
  const cache = useRef(new Map<string, string>());
  const unreadable = useRef(new Set<string>());
  const [texts, setTexts] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [pending, setPending] = useState(false);
  const [failedFiles, setFailedFiles] = useState<ReadonlySet<string>>(() => new Set());
  const key = files.join('\n');
  // Opening the finder is another chance for the files that could not be read.
  useEffect(() => {
    if (!open || unreadable.current.size === 0) return;
    for (const file of unreadable.current) cache.current.delete(file);
    unreadable.current.clear();
    setFailedFiles(new Set());
  }, [open]);
  useEffect(() => {
    if (!enabled) return;
    const wanted = key.length === 0 ? [] : key.split('\n');
    let cancelled = false;
    const missing = wanted.filter((file) => !cache.current.has(file));
    if (missing.length === 0) {
      setPending(false);
      return;
    }
    setPending(true);
    let cursor = 0;
    const pull = async () => {
      for (;;) {
        const file = missing[cursor++];
        if (file === undefined || cancelled) return;
        let text = '';
        try {
          text = await client.fetchQuery({ queryKey: keys.specFile(source, file), queryFn: () => adapter.specFile(file), retry: false });
        } catch {
          text = '';
          unreadable.current.add(file);
        }
        if (cancelled) return;
        cache.current.set(file, text);
        setTexts(new Map(cache.current));
        if (unreadable.current.has(file)) setFailedFiles(new Set(unreadable.current));
      }
    };
    void Promise.all([pull(), pull(), pull(), pull()]).then(() => {
      if (!cancelled) setPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, client, enabled, key, source]);
  const read = useMemo(() => files.filter((file) => texts.has(file)).length, [files, texts]);
  const failed = useMemo(() => files.filter((file) => failedFiles.has(file)).length, [files, failedFiles]);
  return { texts, pending, total: files.length, read, failed };
}
export function Finder() {
  const open = useFinderOpen();
  const help = useHelpOpen();
  const { view } = useAtlas();
  const evidence = useEvidence();
  const navigate = useNavigate();
  const routeSearch = useSearch({ strict: false });
  const readable = useMemo(() => evidence.files.filter((file) => kindOfFile(file)), [evidence.files]);
  // Reading every spec's text is for search, and a focused page needs its own spec first: start only once search is wanted.
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (open) setWanted(true);
  }, [open]);
  const { texts, pending, total: specTotal, read, failed } = useSpecTexts(readable, wanted, open);
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
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const store = finderStore;
  const spotlightState = useSpotlight(store);

  const parsed = useMemo(() => parseSearch(query), [query]);
  // Every match, best first: the list below is the first FINDER_LIMIT of it, and says so when there are more.
  const everything = useMemo(() => rankIndex(index, query, Number.POSITIVE_INFINITY), [index, query]);
  const lexical = useMemo(() => (showAll ? everything : everything.slice(0, FINDER_LIMIT)), [everything, showAll]);
  const searchable = useMemo(() => {
    const notations = splitQuery(parsed.words).notations;
    return docs.filter((doc) => (notations.size === 0 || notations.has(notationOf(doc))) && passesFilters(doc.facets, parsed.filters));
  }, [docs, parsed]);
  const lexicalDocs = useMemo(() => lexical.map((hit) => hit.doc), [lexical]);
  const literal = parsed.phrases.length + parsed.identifiers.length > 0;
  const semantic = useSemantic(open && parsed.words.length > 0 && !literal, parsed.words, searchable, lexicalDocs);
  const shown = useMemo<Ranked[]>(
    () => (semantic.queryVector ? applySemantic(searchable, lexical, semantic.queryVector, semantic.vectors, showAll ? Number.POSITIVE_INFINITY : FINDER_LIMIT) : lexical),
    [semantic.queryVector, searchable, lexical, semantic.vectors, showAll]
  );
  const ordered = useMemo(() => FIND_GROUPS.flatMap((group) => shown.filter((hit) => hit.doc.group === group)), [shown]);
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        toggleFinder();
        return;
      }
      if (event.key === 'Escape' && isHelpOpen()) {
        event.preventDefault();
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
    if (catalog.model && query.trim()) {
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
    if (hit) openTarget(hit.doc.recording ?? hit.doc.target);
  };
  return (
    <>
      <Spotlight.Root
        store={store}
        shortcut={null}
        query={query}
        onQueryChange={setQuery}
        title="Find"
        attributes={{ content: { 'aria-label': 'Find' } }}
        onKeyDownCapture={onCommandKey}
        scrollable
        maxHeight="60vh"
      >
        {/* Spotlight updates selection silently; notify its public store after keyboard handling so ARIA follows it. */}
        <Spotlight.Search
          onKeyDown={() => queueMicrotask(() => store.setState(store.getState()))}
          role="combobox"
          aria-expanded={open}
          aria-controls="atlas-finder-actions"
          aria-activedescendant={ordered[Math.max(0, spotlightState.selected)]?.doc.id}
          aria-label="Find a flow"
          placeholder='Try "add a todo" or "gherkin"'
        />
        <Spotlight.ActionsList id="atlas-finder-actions" role="listbox" aria-label="Flows, specs and runs">
          {shown.length === 0 && (
            <Spotlight.Empty>
              {!query.trim()
                ? 'Type what someone does. For example, add a todo.'
                : unindexed
                  ? `No match yet. ${unindexed}, so this is not the final answer.`
                  : failed > 0
                    ? `Nothing close to that. ${plural(failed, 'spec', 'specs')} could not be read, so search may miss ${failed === 1 ? 'it' : 'them'}.`
                    : 'Nothing close to that.'}
            </Spotlight.Empty>
          )}
          {FIND_GROUPS.map((group) => {
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
                    role="option"
                    data-selected={ordered[Math.max(0, spotlightState.selected)]?.doc.id === hit.doc.id || undefined}
                    aria-selected={ordered[Math.max(0, spotlightState.selected)]?.doc.id === hit.doc.id}
                    onClick={() => openTarget(hit.doc.target)}
                    label={hit.doc.title}
                    description={[hit.snippet !== hit.doc.subtitle ? hit.snippet : '', hit.doc.subtitle, query.trim() ? describeHit(hit) : ''].filter(Boolean).join(' · ')}
                    leftSection={hit.doc.status ? <StatusMark status={hit.doc.status} size={16} /> : undefined}
                    rightSection={
                      <Group gap="xs" wrap="nowrap">
                        {hit.exact && <Badge color="blue">Exact</Badge>}
                        {hit.partial && <Badge color="gray" variant="outline">Partial</Badge>}
                        <Badge color="gray">{KIND_WORD[hit.doc.kind]}</Badge>
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
                {query.trim() && total > 0
                  ? bounded
                    ? `Showing the first ${shown.length} of ${total} results, not all of them.`
                    : `${total} ${total === 1 ? 'result' : 'results'}.`
                  : '↑↓ move'}
              </Text>
              {(unindexed || failed > 0) && (
                <Text role="status" size="xs" c="dimmed">
                  {unindexed ? `Searching what is read so far: ${unindexed}` : `${plural(failed, 'spec', 'specs')} could not be read and ${failed === 1 ? 'is' : 'are'} not searched`}
                </Text>
              )}
              {notice && (
                <Text role="status" size="xs" c="dimmed">
                  {notice}
                </Text>
              )}
              <SearchNotes issues={parsed.issues} semantic={query.trim() ? semantic.status : 'idle'} />
            </Stack>
            <Group gap="xs" wrap="wrap" justify="flex-end">
              {bounded && (
                <Button size="compact-xs" variant="light" onClick={seeAll}>
                  See all {total} results
                </Button>
              )}
              <Text size="xs" c="dimmed">
                ↵ open · ⇧↵ all results · esc close
              </Text>
            </Group>
          </Group>
        </Spotlight.Footer>
      </Spotlight.Root>
      <Modal
        opened={help}
        onClose={() => setHelpOpen(false)}
        title="Keyboard shortcuts"
        attributes={{ content: { 'aria-label': 'Keyboard shortcuts' } }}
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
