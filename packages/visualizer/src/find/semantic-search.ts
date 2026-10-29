/**
 * @module Semantic search state
 *
 * The optional meaning-based part of every search box. Lexical results are always shown first and never wait for it;
 * when an embedder is available the query and the candidate documents are embedded in the background and the results
 * are re-ranked (`applySemantic`). The state it reports is part of the interface: a search says when it is words only
 * (no embedder here, or the embedder failed) and when it is still refining, so a missing paraphrase is never mistaken
 * for no match.
 */
import { useEffect, useRef, useState } from 'react';

import type { FindDoc } from './rank';
import { createWorkerEmbedder, embeddingsAvailable, embedText, textHash, type Embedder } from './semantic';

/** How the semantic part of a search stands. */
export type SemanticStatus = 'idle' | 'unavailable' | 'working' | 'ready' | 'failed';

/** At most this many documents are embedded for one query, lexical matches first. A catalog of thousands is never embedded whole. */
export const EMBED_CAP = 400;

/** What a search box tells a person about its semantic part, or null when there is nothing to say. */
export function semanticNote(status: SemanticStatus): string | null {
  if (status === 'working') return 'Refining by meaning…';
  if (status === 'unavailable') return 'Matching words and spellings only; meaning-based search is not available here.';
  if (status === 'failed') return 'Matching words and spellings only; meaning-based search failed, so paraphrases may be missing.';
  return null;
}

/** The vectors of documents already embedded, by their text, so a live run does not embed the suite again. */
const vectorCache = new Map<string, Float32Array>();

let provided: (() => Embedder) | null = null;
let shared: Embedder | null = null;
let failure: string | null = null;

/**
 * Supplies the embedder every search box uses (a host with its own model, or a test with a fake), or null to go back
 * to the browser's worker. Clears a remembered failure and the cached vectors.
 */
export function provideEmbedder(factory: (() => Embedder) | null): void {
  provided = factory;
  shared = null;
  failure = null;
  vectorCache.clear();
}

function embedder(): Embedder | null {
  if (shared) return shared;
  if (provided) shared = provided();
  else if (embeddingsAvailable()) shared = createWorkerEmbedder();
  return shared;
}

/** Whether a semantic provider exists here at all. */
export function semanticAvailable(): boolean {
  return provided !== null || embeddingsAvailable();
}

/** The vectors already known for these documents, by document id. */
export function cachedVectors(docs: readonly FindDoc[]): ReadonlyMap<string, Float32Array> {
  const vectors = new Map<string, Float32Array>();
  for (const doc of docs) {
    const vector = vectorCache.get(textHash(embedText(doc)));
    if (vector) vectors.set(doc.id, vector);
  }
  return vectors;
}

/**
 * Embeds the query, then the documents in batches (`ordered`, at most {@link EMBED_CAP}), calling `onQuery` with the
 * query's vector and `onBatch` after each batch. Stops quietly when `cancelled()`; rejects when the embedder fails.
 */
export async function embedQuery(
  provider: Embedder,
  needle: string,
  ordered: readonly FindDoc[],
  hooks: { readonly cancelled: () => boolean; readonly onQuery: (vector: Float32Array) => void; readonly onBatch: () => void }
): Promise<void> {
  const [vector] = await provider.embed([needle]);
  if (hooks.cancelled()) return;
  if (!vector) throw new Error('The embedder returned nothing');
  hooks.onQuery(vector);
  const limited = ordered.slice(0, EMBED_CAP);
  for (let start = 0; start < limited.length; start += 8) {
    if (hooks.cancelled()) return;
    const missing = limited.slice(start, start + 8).filter((doc) => !vectorCache.has(textHash(embedText(doc))));
    if (missing.length > 0) {
      const batch = await provider.embed(missing.map((doc) => embedText(doc)));
      if (hooks.cancelled()) return;
      missing.forEach((doc, at) => {
        const found = batch[at];
        if (found) vectorCache.set(textHash(embedText(doc)), found);
      });
    }
    hooks.onBatch();
  }
}

/** What {@link useSemantic} gives back. */
export type SemanticState = {
  readonly status: SemanticStatus;
  /** The vector of the query being shown, or null until it is embedded (never the vector of an earlier query). */
  readonly queryVector: Float32Array | null;
  readonly vectors: ReadonlyMap<string, Float32Array>;
};

/**
 * Embeds `query` and the best candidates among `docs` in the background while `enabled`. `lexical` are the documents
 * the words found (embedded first). The state says when the search is words only or still refining.
 */
export function useSemantic(enabled: boolean, query: string, docs: readonly FindDoc[], lexical: readonly FindDoc[]): SemanticState {
  const needle = query.trim();
  const [state, setState] = useState<{ query: string; status: SemanticStatus; vector: Float32Array | null }>({ query: '', status: 'idle', vector: null });
  const [vectors, setVectors] = useState<ReadonlyMap<string, Float32Array>>(() => new Map());
  const first = useRef(lexical);
  first.current = lexical;
  useEffect(() => {
    if (!enabled || !needle) {
      setState({ query: needle, status: 'idle', vector: null });
      return;
    }
    const provider = failure === null ? embedder() : null;
    if (failure !== null) {
      setState({ query: needle, status: 'failed', vector: null });
      return;
    }
    if (!provider) {
      setState({ query: needle, status: 'unavailable', vector: null });
      return;
    }
    let cancelled = false;
    setState({ query: needle, status: 'working', vector: null });
    const ranked = new Set(first.current.map((doc) => doc.id));
    const ordered = [...first.current, ...docs.filter((doc) => !ranked.has(doc.id))];
    void embedQuery(provider, needle, ordered, {
      cancelled: () => cancelled,
      onQuery: (vector) => setState({ query: needle, status: 'working', vector }),
      onBatch: () => setVectors(cachedVectors(docs))
    }).then(
      () => {
        if (!cancelled) setState((held) => (held.query === needle ? { ...held, status: 'ready' } : held));
      },
      (error: unknown) => {
        failure = error instanceof Error ? error.message : 'The embedder failed';
        if (!cancelled) setState({ query: needle, status: 'failed', vector: null });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, needle, docs]);
  return { status: state.query === needle ? state.status : enabled && needle ? 'working' : 'idle', queryVector: state.query === needle ? state.vector : null, vectors };
}
