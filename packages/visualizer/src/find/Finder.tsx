import { Badge, Group, Kbd, List, Modal, Text } from '@mantine/core';
import { Spotlight, useSpotlight } from '@mantine/spotlight';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAtlas } from '../app/atlas-context';
import { keys, specKey, useAdapter } from '../data/queries';
import { useEvidence } from '../evidence/evidence-context';
import { StatusMark } from '../evidence/marks';
import { kindOfFile } from '../spec-kind';
import { corpusFrom } from './corpus';
import { finderStore, isHelpOpen, setFinderOpen, setHelpOpen, toggleFinder, useFinderOpen, useHelpOpen } from './open';
import { FIND_GROUPS, indexCorpus, notationOf, rankIndex, splitQuery, type FindDoc, type FindKind, type FindTarget } from './rank';
import { applySemantic, createWorkerEmbedder, embeddingsAvailable, embedText, textHash, type Embedder } from './semantic';

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
function useSpecTexts(files: readonly string[]) {
  const adapter = useAdapter();
  const client = useQueryClient();
  const source = specKey(adapter);
  const cache = useRef(new Map<string, string>());
  const [texts, setTexts] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [pending, setPending] = useState(false);
  const key = files.join('\n');
  useEffect(() => {
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
          text = await client.fetchQuery({ queryKey: keys.specFile(source, file), queryFn: () => adapter.specFile(file) });
        } catch {
          text = '';
        }
        if (cancelled) return;
        cache.current.set(file, text);
        setTexts(new Map(cache.current));
      }
    };
    void Promise.all([pull(), pull(), pull(), pull()]).then(() => {
      if (!cancelled) setPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, client, key, source]);
  return { texts, pending };
}
/** The vector cache outlives a keystroke, so a live run does not embed the suite again. */
const vectorCache = new Map<string, Float32Array>();
function vectorsFor(docs: readonly FindDoc[]): ReadonlyMap<string, Float32Array> {
  const vectors = new Map<string, Float32Array>();
  for (const doc of docs) {
    const vector = vectorCache.get(textHash(embedText(doc)));
    if (vector) vectors.set(doc.id, vector);
  }
  return vectors;
}
export function Finder() {
  const open = useFinderOpen();
  const help = useHelpOpen();
  const { view } = useAtlas();
  const evidence = useEvidence();
  const navigate = useNavigate();
  const routeSearch = useSearch({ strict: false });
  const readable = useMemo(() => evidence.files.filter((file) => kindOfFile(file)), [evidence.files]);
  const { texts, pending } = useSpecTexts(readable);
  const docs = useMemo(
    () => corpusFrom(view, evidence.files, evidence.titleOf, evidence.view, texts),
    [view, evidence.files, evidence.titleOf, evidence.view, texts]
  );
  const index = useMemo(() => indexCorpus(docs), [docs]);
  const [query, setQuery] = useState('');
  const store = finderStore;
  const spotlightState = useSpotlight(store);

  const lexical = useMemo(() => rankIndex(index, query), [index, query]);
  const [embedded, setEmbedded] = useState<{
    readonly query: string;
    readonly vector: Float32Array;
  } | null>(null);
  const [vectors, setVectors] = useState<ReadonlyMap<string, Float32Array>>(() => new Map());
  const queryVector = embedded !== null && embedded.query === query.trim() ? embedded.vector : null;
  const searchable = useMemo(() => {
    const notations = splitQuery(query).notations;
    if (notations.size === 0) return docs;
    return docs.filter((doc) => notations.has(notationOf(doc)));
  }, [docs, query]);
  const shown = useMemo(
    () => (queryVector ? applySemantic(searchable, lexical, queryVector, vectors) : lexical),
    [queryVector, searchable, lexical, vectors]
  );
  const ordered = useMemo(() => FIND_GROUPS.flatMap((group) => shown.filter((hit) => hit.doc.group === group)), [shown]);

  // Rank results ourselves, then let Spotlight own keyboard selection and scrolling.
  // Compound Spotlight does not initialize a selection when asynchronous results arrive.
  useEffect(() => {
    if (open) store.setState((state) => ({ ...state, selected: 0 }));
  }, [open, query, store]);
  const embedder = useRef<Embedder | null>(null);
  const embedFailed = useRef(false);
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
  useEffect(() => {
    if (!open || embedFailed.current || !embeddingsAvailable() || query.trim().length === 0) return;
    let cancelled = false;
    const needle = query.trim();
    embedder.current ??= createWorkerEmbedder();
    const rankedFirst = new Set(lexical.map((hit) => hit.doc.id));
    const ordered = [...lexical.map((hit) => hit.doc), ...docs.filter((doc) => !rankedFirst.has(doc.id))];
    void (async () => {
      try {
        const embedded = await embedder.current!.embed([needle]);
        const nextQuery = embedded[0];
        if (cancelled || !nextQuery) return;
        setEmbedded({ query: needle, vector: nextQuery });
        for (let start = 0; start < ordered.length && !cancelled; start += 8) {
          const batch = ordered.slice(start, start + 8);
          const missing = batch.filter((doc) => !vectorCache.has(textHash(embedText(doc))));
          if (missing.length > 0) {
            const batchVectors = await embedder.current!.embed(missing.map((doc) => embedText(doc)));
            if (cancelled) return;
            missing.forEach((doc, at) => {
              const vector = batchVectors[at];
              if (vector) vectorCache.set(textHash(embedText(doc)), vector);
            });
          }
          if (!cancelled) setVectors(vectorsFor(docs));
        }
      } catch {
        embedFailed.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, query, docs, lexical]);
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
  const onCommandKey = (event: ReactKeyboardEvent) => {
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
              {query.trim() ? 'Nothing close to that.' : 'Type what someone does. For example, add a todo.'}
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
                    description={[hit.snippet !== hit.doc.subtitle ? hit.snippet : '', hit.doc.subtitle].filter(Boolean).join(' · ')}
                    leftSection={hit.doc.status ? <StatusMark status={hit.doc.status} size={16} /> : undefined}
                    rightSection={<Badge color="gray">{KIND_WORD[hit.doc.kind]}</Badge>}
                  />
                ))}
              </Spotlight.ActionsGroup>
            ) : null;
          })}
        </Spotlight.ActionsList>
        <Spotlight.Footer>
          <Group gap="md" justify="space-between">
            <Text size="xs" c="dimmed">
              {pending ? 'Reading specs…' : '↑↓ move'}
            </Text>
            <Text size="xs" c="dimmed">
              ↵ open · esc close
            </Text>
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
