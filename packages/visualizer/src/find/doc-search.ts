/**
 * @module Searching a list of documents
 *
 * What the test list, the runs list and the results of an opened run call to narrow themselves by a typed query. It is
 * the finder's engine (`rank.ts`) applied to a whole list: every document that is eligible for the words, phrases and
 * identifiers of the query, best first, with the reason it matched; meaning-based additions when an embedder is
 * available. The structured filters (`status:`, `has:video`…) are applied by the caller with `passesFilters`, so a
 * count can leave one of them out; nothing here limits or pages the result.
 */
import { useMemo } from 'react';

import { applySemantic } from './semantic';
import { indexCorpus, matchText, type FindDoc, type FindIndex, type Ranked } from './rank';
import { parseSearch, passesFilters, type ParsedSearch } from './query';
import { useSemantic, type SemanticStatus } from './semantic-search';

/** The semantic part of a search to add to the words, when there is one. */
export type SemanticInput = {
  readonly queryVector: Float32Array | null;
  readonly vectors: ReadonlyMap<string, Float32Array>;
  /** The documents a paraphrase may add (those that pass the filters). */
  readonly docs: readonly FindDoc[];
};

/**
 * Every document eligible for the text of a search (words, quoted phrases, identifiers), best first, by document id; null
 * when the search has no text. A document missing a distinctive word is not eligible. With a semantic input, documents
 * close in meaning are added (not when the search asks for an exact phrase or identifier).
 */
export function searchList(index: FindIndex, parsed: ParsedSearch, semantic?: SemanticInput): Map<string, Ranked> | null {
  const lexical = matchText(index, parsed, { snippets: false });
  if (lexical === null) return null;
  const plain: Ranked[] = lexical.map(({ order: _order, misses: _misses, ...hit }) => hit);
  const literal = parsed.phrases.length + parsed.identifiers.length > 0;
  const list = semantic?.queryVector && !literal ? applySemantic(semantic.docs, plain, semantic.queryVector, semantic.vectors, Number.POSITIVE_INFINITY) : plain;
  return new Map(list.map((hit) => [hit.doc.id, hit]));
}

/** What {@link useDocSearch} reads out. */
export type DocSearch = {
  readonly parsed: ParsedSearch;
  /** Eligible documents by id, best first; null when the query has no text to match (it may still have filters). */
  readonly hits: ReadonlyMap<string, Ranked> | null;
  /** How the meaning-based part stands: idle when there is nothing to match by meaning. */
  readonly status: SemanticStatus;
};

/**
 * Parses `query` and searches `docs` with it: lexical results at once, meaning-based additions when they arrive. The
 * index is only built when the query has text.
 */
export function useDocSearch(docs: readonly FindDoc[], query: string | undefined): DocSearch {
  const parsed = useMemo(() => parseSearch(query ?? ''), [query]);
  const hasText = parsed.words.length > 0 || parsed.phrases.length > 0 || parsed.identifiers.length > 0;
  const index = useMemo(() => (hasText ? indexCorpus(docs) : null), [docs, hasText]);
  const lexical = useMemo(() => (index ? searchList(index, parsed) : null), [index, parsed]);
  const candidates = useMemo(() => (hasText ? docs.filter((doc) => passesFilters(doc.facets, parsed.filters)) : []), [docs, parsed, hasText]);
  const lexicalDocs = useMemo(() => (lexical ? [...lexical.values()].map((hit) => hit.doc) : []), [lexical]);
  const wantsMeaning = hasText && parsed.words.length > 0 && parsed.phrases.length + parsed.identifiers.length === 0;
  const semantic = useSemantic(wantsMeaning, parsed.words, candidates, lexicalDocs);
  const hits = useMemo(
    () => (index ? searchList(index, parsed, { queryVector: semantic.queryVector, vectors: semantic.vectors, docs: candidates }) : null),
    [index, parsed, semantic.queryVector, semantic.vectors, candidates]
  );
  return { parsed, hits, status: wantsMeaning ? semantic.status : 'idle' };
}
