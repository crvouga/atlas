/**
 * @module Reading spec texts for search and indexes
 *
 * The finder and the project-wide behavior index both need the text of many specs, not only the one on screen. They
 * read it here: a few files at a time, each landing as it arrives so a search can use what is read so far, through the
 * same query cache the spec pages use (so a file is never fetched twice and a page opened afterwards finds it ready).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { keys, specKey, useAdapter } from '../data/queries';

/** How many spec files are read at once. */
const READERS = 4;

/**
 * Reads the text of every spec in `files`, a few at a time, once `enabled`. Each file lands as it arrives, so a search
 * can use what is read so far; `read` of `total` say how far it is, and `failed` how many could not be read at all
 * (`texts` holds an empty text for them). Files the query cache already holds are available at once, without a request.
 * Setting `open` (the finder opening) gives the files that could not be read another chance.
 */
export function useSpecTexts(files: readonly string[], enabled: boolean, open: boolean) {
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
    // What the pages already read is not asked for again.
    let seeded = false;
    for (const file of wanted) {
      if (cache.current.has(file)) continue;
      const held = client.getQueryData<string>(keys.specFile(source, file));
      if (typeof held === 'string') {
        cache.current.set(file, held);
        seeded = true;
      }
    }
    if (seeded) setTexts(new Map(cache.current));
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
    void Promise.all(Array.from({ length: READERS }, pull)).then(() => {
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
