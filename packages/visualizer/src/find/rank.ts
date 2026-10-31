/**
 * @module Ranked search
 *
 * The one matching engine behind every search box: the finder, the test list, the runs list and the results of one run.
 * It indexes documents (`FindDoc`) by their weighted fields, matches words by stem, everyday synonym, spelling and
 * the start of a longer word, applies the structured parts of a query (`query.ts`), and says why each document matched.
 */
import { parseSearch, passesFilters, type DocFacets, type ParsedSearch } from './query';

/** Everyday words a new person uses for the same action. The first word is the class id. */
const CLASSES: readonly (readonly string[])[] = [
  ['complete', 'done', 'finish', 'mark', 'check'],
  ['add', 'create', 'new', 'insert'],
  ['remove', 'delete', 'clear', 'discard', 'throw']
];

const STOP = new Set(['a', 'an', 'the', 'as', 'to', 'of', 'and', 'or', 'they', 'them', 'when', 'their', 'it', 'is', 'on']);

/** Query words that mean a kind of spec. The first list is the notation; the rest are what people call it. */
const TYPE_WORDS: readonly { readonly notation: string; readonly words: readonly string[] }[] = [
  { notation: 'gherkin', words: ['gherkin', 'cucumber', 'feature', 'scenario'] },
  { notation: 'quint', words: ['quint', 'qnt', 'model'] },
  { notation: 'statechart', words: ['statechart', 'scxml'] },
  { notation: 'dmn', words: ['dmn'] },
  { notation: 'alloy', words: ['alloy'] },
  { notation: 'openslo', words: ['openslo', 'slo'] }
];

const TYPE_PHRASES: readonly { readonly notation: string; readonly left: string; readonly right: string }[] = [
  { notation: 'statechart', left: 'state', right: 'machine' },
  { notation: 'statechart', left: 'state', right: 'chart' },
  { notation: 'dmn', left: 'decision', right: 'table' },
  { notation: 'openslo', left: 'open', right: 'slo' }
];

const TYPE_OF = new Map<string, string>();
for (const entry of TYPE_WORDS) for (const word of entry.words) TYPE_OF.set(word, entry.notation);

/** How much a word counts in each field of a document. */
export const FIELD_WEIGHT = { title: 5, steps: 3, description: 2, metadata: 1, path: 0.5 } as const;

/** Where in a document a word was found. `metadata` is domain, tags, labels, environments and producers. */
export type FieldName = keyof typeof FIELD_WEIGHT;

const FIELD_NAMES = Object.keys(FIELD_WEIGHT) as FieldName[];

/** One searchable text of a document and where it comes from. */
export type FindField = { readonly name: FieldName; readonly text: string };

export type FindGroup = 'Flows' | 'Specs' | 'Runs' | 'Commands';

export const FIND_GROUPS: readonly FindGroup[] = ['Flows', 'Specs', 'Runs'];

export type FindKind = 'journey' | 'event' | 'screen' | 'spec' | 'scenario' | 'action' | 'run';

export type FindStatus = 'passed' | 'failed' | 'running' | 'not-run' | 'none';

export type FindTarget = {
  readonly to: '/' | '/chart/$chartId' | '/specs/$kind';
  readonly chartId?: string;
  readonly kind?: string;
  readonly search: {
    readonly screen?: string;
    readonly event?: string;
    readonly journey?: string;
    readonly spec?: string;
    readonly check?: string;
    readonly view?: 'recording';
    /** A test opened in the explorer of a project without statecharts (`TestSummary.key`). */
    readonly test?: string;
  };
};

/** A searchable thing: a flow, a spec, a scenario, a recorded behavior or a run. */
export type FindDoc = {
  readonly id: string;
  readonly group: FindGroup;
  readonly kind: FindKind;
  readonly title: string;
  readonly subtitle: string;
  readonly fields: readonly FindField[];
  readonly status: FindStatus | null;
  /** Listed whenever this document matches, even when their own words do not. */
  readonly related: readonly string[];
  readonly target: FindTarget;
  readonly recording: FindTarget | null;
  /** What structured filters (`status:`, `has:video`…) read. Without it, a document passes no filter. */
  readonly facets?: DocFacets;
};

/** A matched document, and why it matched. */
export type Ranked = {
  readonly doc: FindDoc;
  readonly score: number;
  readonly snippet: string;
  /** Where the query's words were found. */
  readonly fields?: readonly FieldName[];
  /** True when a quoted phrase or an identifier was found literally. */
  readonly exact?: boolean;
  /** The literal phrases or identifiers found. */
  readonly literals?: readonly string[];
  /** True when a word matched only by a close spelling or the start of a longer word. */
  readonly fuzzy?: boolean;
  /** True when a distinctive query word is missing: a weaker match, listed below those that explain every word. */
  readonly partial?: boolean;
  /** True when it is listed because a matched document relates to it, not because it matched. */
  readonly related?: boolean;
  /** True when only the meaning of the query, not its words, brought it here. */
  readonly semantic?: boolean;
};

const CLASS_OF = new Map<string, string>();
for (const members of CLASSES) {
  const id = members[0]!;
  for (const member of members) CLASS_OF.set(member, id);
}

/** Inflections the stemmer strips, so a typo of "marking" still reaches the class of "mark". */
function inflections(word: string): string[] {
  if (word.endsWith('e')) return [word, `${word}s`, `${word}d`, `${word.slice(0, -1)}ing`];
  return [word, `${word}s`, `${word}ed`, `${word}ing`];
}

const ALIASES: readonly { readonly surface: string; readonly term: string }[] = CLASSES.flatMap((members) => {
  const id = members[0]!;
  return members.flatMap((member) => inflections(member).map((surface) => ({ surface, term: id })));
});

export function stem(raw: string): string {
  let word = raw;
  if (word.length > 5 && word.endsWith('ing')) word = word.slice(0, -3);
  else if (word.length > 4 && word.endsWith('ed')) word = word.slice(0, -2);
  else if (word.length > 4 && word.endsWith('es')) word = word.slice(0, -2);
  else if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) word = word.slice(0, -1);
  return word;
}

/** Class id when the word is an everyday verb, otherwise the stem. `completed` joins `complete`. */
export function canonical(raw: string): string {
  const stemmed = stem(raw);
  return CLASS_OF.get(raw) ?? CLASS_OF.get(stemmed) ?? CLASS_OF.get(`${stemmed}e`) ?? stemmed;
}

export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!piece || STOP.has(piece)) continue;
    const term = canonical(piece);
    if (term && !STOP.has(term)) out.push(term);
  }
  return out;
}

function damerau(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i]![0] = i;
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = i;
    const prev = rows[i - 1]!;
    const here = rows[i]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j]! + 1, here[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2]![j - 2]! + 1);
      here[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return limit + 1;
  }
  return rows[a.length]![b.length]!;
}

type Posting = { readonly doc: number; readonly weight: number; readonly snippet: string; readonly snippetRank: number; readonly fields: number };

/** Documents indexed for matching. Build once with {@link indexCorpus}; query many times. */
export type FindIndex = {
  readonly docs: readonly FindDoc[];
  readonly postings: ReadonlyMap<string, readonly Posting[]>;
  readonly surfaces: ReadonlyMap<string, string>;
  readonly df: ReadonlyMap<string, number>;
};

function snippetRank(name: FieldName): number {
  if (name === 'steps') return 2;
  if (name === 'description') return 1;
  return 0;
}

/** Indexes documents by the stems of the words in their fields. */
export function indexCorpus(docs: readonly FindDoc[]): FindIndex {
  const postings = new Map<string, Posting[]>();
  const best = new Map<string, Posting>();
  const surfaces = new Map<string, string>();
  for (let doc = 0; doc < docs.length; doc++) {
    best.clear();
    for (const field of docs[doc]!.fields) {
      const weight = FIELD_WEIGHT[field.name];
      const rank = snippetRank(field.name);
      for (const piece of field.text.toLowerCase().split(/[^a-z0-9]+/)) {
        if (!piece || STOP.has(piece)) continue;
        const term = canonical(piece);
        if (!term || STOP.has(term)) continue;
        if (piece.length >= 4 && !surfaces.has(piece)) surfaces.set(piece, term);
        const stemmed = stem(piece);
        if (stemmed.length >= 4 && !surfaces.has(stemmed)) surfaces.set(stemmed, canonical(stemmed));
        const prior = best.get(term);
        const fromField = rank > 0 ? field.text : '';
        const bit = 1 << FIELD_NAMES.indexOf(field.name);
        if (!prior) best.set(term, { doc, weight, snippet: fromField, snippetRank: rank, fields: bit });
        else {
          best.set(term, {
            doc,
            weight: Math.max(weight, prior.weight),
            snippet: rank > prior.snippetRank ? fromField : prior.snippet,
            snippetRank: Math.max(rank, prior.snippetRank),
            fields: prior.fields | bit
          });
        }
      }
    }
    for (const [term, posting] of best) {
      const list = postings.get(term);
      if (list) list.push(posting);
      else postings.set(term, [posting]);
    }
  }
  const df = new Map<string, number>();
  for (const [term, list] of postings) df.set(term, list.length);
  return { docs, postings, surfaces, df };
}

function idf(df: number, total: number): number {
  return Math.log((total + 1) / (df + 0.5));
}

type Candidate = { readonly term: string; readonly factor: number };

function candidatesFor(piece: string, index: FindIndex): Candidate[] {
  const factors = new Map<string, number>();
  factors.set(canonical(piece), 1);
  if (piece.length >= 4) {
    const limit = piece.length > 6 ? 2 : 1;
    const consider = (surface: string, term: string) => {
      if (surface.length > piece.length && surface.startsWith(piece)) {
        // The start of a longer word, so a word is found while it is still being typed.
        if ((factors.get(term) ?? 0) < 0.6) factors.set(term, 0.6);
        return;
      }
      if (Math.abs(surface.length - piece.length) > limit) return;
      const dist = damerau(piece, surface, limit);
      if (dist <= 0 || dist > limit) return;
      const factor = dist === 1 ? 0.85 : 0.7;
      const prior = factors.get(term) ?? 0;
      if (factor > prior) factors.set(term, factor);
    };
    for (const alias of ALIASES) consider(alias.surface, alias.term);
    for (const [surface, term] of index.surfaces) consider(surface, term);
  }
  return [...factors].map(([term, factor]) => ({ term, factor }));
}

function wordKeys(raw: string): string[] {
  const stemmed = stem(raw);
  return [raw, stemmed, stemmed.endsWith('e') ? stemmed.slice(0, -1) : `${stemmed}e`];
}

function notationOfWord(piece: string): string | null {
  for (const key of wordKeys(piece)) {
    const exact = TYPE_OF.get(key);
    if (exact) return exact;
  }
  if (piece.length < 5) return null;
  if (CLASS_OF.has(piece) || CLASS_OF.has(stem(piece)) || CLASS_OF.has(`${stem(piece)}e`)) return null;
  const limit = piece.length > 6 ? 2 : 1;
  let best: { readonly notation: string; readonly dist: number } | null = null;
  for (const [word, notation] of TYPE_OF) {
    if (word.length < 5 || Math.abs(word.length - piece.length) > limit) continue;
    const dist = damerau(piece, word, limit);
    if (dist <= 0 || dist > limit) continue;
    if (!best || dist < best.dist) best = { notation, dist };
  }
  return best?.notation ?? null;
}

function phraseNotation(left: string, right: string): string | null {
  const lk = new Set(wordKeys(left));
  const rk = new Set(wordKeys(right));
  for (const phrase of TYPE_PHRASES) {
    if (lk.has(phrase.left) && rk.has(phrase.right)) return phrase.notation;
  }
  return null;
}

/** The kind of spec a row opens, or `statechart` for a place, action, or journey on the chart. */
export function notationOf(doc: FindDoc): string {
  return doc.target.kind ?? (doc.target.to === '/chart/$chartId' ? 'statechart' : '');
}

/** Kind words in a query, and the query with those words removed. */
export function splitQuery(query: string): { readonly notations: ReadonlySet<string>; readonly rest: string } {
  const parts = query.toLowerCase().split(/[^a-z0-9]+/).filter((piece) => piece && !STOP.has(piece));
  const notations = new Set<string>();
  const rest: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const next = parts[i + 1];
    const phrase = next ? phraseNotation(parts[i]!, next) : null;
    if (phrase) {
      notations.add(phrase);
      i++;
      continue;
    }
    const notation = notationOfWord(parts[i]!);
    if (notation) notations.add(notation);
    else rest.push(parts[i]!);
  }
  return { notations, rest: rest.join(' ') };
}

const KIND_ORDER: Record<FindKind, number> = {
  journey: 0,
  event: 1,
  screen: 2,
  scenario: 3,
  action: 4,
  spec: 5,
  run: 6
};

function listOfType(docs: readonly FindDoc[], limit: number): Ranked[] {
  return [...docs]
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
    .slice(0, limit)
    .map((doc) => ({ doc, score: 0, snippet: '' }));
}

function lineSnippet(text: string, terms: ReadonlySet<string>): string {
  let best = '';
  let bestScore = 0;
  for (const line of text.split(/\n|(?<=\.)\s+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let score = 0;
    for (const term of tokens(trimmed)) if (terms.has(term)) score++;
    if (score > bestScore) {
      best = trimmed;
      bestScore = score;
    }
  }
  if (bestScore === 0) return '';
  return best.length > 140 ? `${best.slice(0, 137)}…` : best;
}

type Scored = Ranked & { readonly misses: number; readonly index: number };

/**
 * Scores every document that holds at least one query word. A word is matched through its candidates (itself, its
 * everyday synonyms, close spellings, longer words it starts); `allow` leaves documents out before they are scored.
 */
function scoreAll(index: FindIndex, query: string, allow?: (docIndex: number) => boolean): Scored[] {
  const pieces: string[] = [];
  const seen = new Set<string>();
  for (const piece of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!piece || STOP.has(piece)) continue;
    const exact = canonical(piece);
    if (seen.has(exact)) continue;
    seen.add(exact);
    pieces.push(piece);
  }
  const total = index.docs.length;
  const queries = pieces.map((piece) => {
    const candidates = candidatesFor(piece, index);
    const exact = canonical(piece);
    const df = index.df.get(exact) ?? 0;
    return { candidates, rare: df * 2 <= total };
  });
  const queryTerms = new Set(queries.flatMap((entry) => entry.candidates.map((candidate) => candidate.term)));
  const rareCount = queries.filter((entry) => entry.rare).length;
  type Acc = { score: number; rareHits: number; snippet: string; snippetRank: number; fields: number; fuzzy: boolean };
  const acc = new Map<number, Acc>();
  for (const entry of queries) {
    const best = new Map<number, { value: number; snippet: string; rank: number; fields: number; factor: number }>();
    for (const candidate of entry.candidates) {
      const postings = index.postings.get(candidate.term);
      if (!postings) continue;
      const weightOfTerm = idf(index.df.get(candidate.term) ?? 0, total);
      for (const posting of postings) {
        if (allow && !allow(posting.doc)) continue;
        const value = weightOfTerm * posting.weight * candidate.factor;
        const prior = best.get(posting.doc);
        if (!prior) best.set(posting.doc, { value, snippet: posting.snippet, rank: posting.snippetRank, fields: posting.fields, factor: candidate.factor });
        else {
          if (value > prior.value) {
            prior.value = value;
            prior.factor = candidate.factor;
            prior.fields = posting.fields;
          }
          if (posting.snippetRank > prior.rank) {
            prior.rank = posting.snippetRank;
            prior.snippet = posting.snippet;
          }
        }
      }
    }
    for (const [doc, hit] of best) {
      const own = acc.get(doc) ?? { score: 0, rareHits: 0, snippet: '', snippetRank: 0, fields: 0, fuzzy: false };
      own.score += hit.value;
      if (entry.rare) own.rareHits++;
      own.fields |= hit.fields;
      if (hit.factor < 1) own.fuzzy = true;
      if (hit.rank > own.snippetRank && hit.snippet) {
        own.snippetRank = hit.rank;
        own.snippet = hit.snippet;
      }
      acc.set(doc, own);
    }
  }
  const out: Scored[] = [];
  for (const [docIndex, hit] of acc) {
    if (hit.score <= 0) continue;
    const fields = FIELD_NAMES.filter((_, at) => (hit.fields & (1 << at)) !== 0);
    out.push({
      doc: index.docs[docIndex]!,
      index: docIndex,
      score: hit.score,
      misses: rareCount - hit.rareHits,
      snippet: lineSnippet(hit.snippet, queryTerms),
      fields,
      ...(hit.fuzzy ? { fuzzy: true } : {})
    });
  }
  return out;
}

/** Journeys first, then failing runs. An empty box stays a short list of stories. */
export function suggest(docs: readonly FindDoc[], limit = 40): Ranked[] {
  const journeys = docs.filter((doc) => doc.kind === 'journey');
  const failing = docs.filter((doc) => doc.kind === 'run' && doc.status === 'failed');
  return [...journeys, ...failing].slice(0, limit).map((doc) => ({ doc, score: 0, snippet: '' }));
}

const textOf = new WeakMap<FindDoc, string>();
/** Everything a document says, lowercased, for literal (quoted or identifier) matches. */
function literalText(doc: FindDoc): string {
  let text = textOf.get(doc);
  if (text === undefined) {
    text = [doc.id, doc.title, doc.subtitle, ...doc.fields.map((field) => field.text)].join('\n').toLowerCase();
    textOf.set(doc, text);
  }
  return text;
}

/** The literal phrases and identifiers of a search that a document contains, or null when it lacks one. */
function literalsIn(doc: FindDoc, parsed: ParsedSearch): string[] | null {
  const found: string[] = [];
  const text = literalText(doc);
  for (const literal of [...parsed.phrases, ...parsed.identifiers]) {
    if (!text.includes(literal)) return null;
    found.push(literal);
  }
  return found;
}

/** How a document matched the words, phrases and identifiers of a search (not its filters). */
export type TextMatch = Ranked & { readonly order: number; readonly misses: number };

/**
 * The documents that match the text of a search: its words (every distinctive word found, unless `partial`), and every
 * quoted phrase and identifier literally. Filters are not applied here; callers apply them with `passesFilters`, so
 * a count can leave one out. Returns null when the search has no text at all. Hits are best first: exact before
 * fuzzy, then by score and title.
 *
 * With `partial: true` a document that misses a distinctive word is kept, flagged `partial`, after those that do not.
 */
export function matchText(index: FindIndex, parsed: ParsedSearch, options: { readonly partial?: boolean; readonly words?: string; readonly allow?: (doc: FindDoc) => boolean; readonly snippets?: boolean } = {}): TextMatch[] | null {
  const words = options.words ?? parsed.words;
  const literal = parsed.phrases.length + parsed.identifiers.length > 0;
  const hasWords = tokens(words).length > 0;
  if (!hasWords && !literal) return null;
  const allow = options.allow;
  const pass = (docIndex: number) => {
    const doc = index.docs[docIndex]!;
    return (!allow || allow(doc)) && (!literal || literalsIn(doc, parsed) !== null);
  };
  let hits: TextMatch[];
  if (hasWords) {
    hits = [];
    for (const scored of scoreAll(index, words, pass)) {
      if (scored.misses > 0 && !options.partial) continue;
      const literals = literal ? literalsIn(scored.doc, parsed) : [];
      hits.push({ doc: scored.doc, score: scored.score, snippet: options.snippets === false ? '' : scored.snippet, fields: scored.fields, ...(scored.fuzzy ? { fuzzy: true } : {}), ...(scored.misses > 0 ? { partial: true } : {}), ...(literals?.length ? { exact: true, literals } : {}), order: scored.index, misses: scored.misses });
    }
  } else {
    hits = [];
    index.docs.forEach((doc, order) => {
      if (!pass(order)) return;
      hits.push({ doc, score: 0, snippet: '', exact: true, literals: literalsIn(doc, parsed) ?? [], order, misses: 0 });
    });
  }
  const compare = (a: TextMatch, b: TextMatch) =>
    a.misses - b.misses ||
    Number(b.exact === true) - Number(a.exact === true) ||
    b.score - a.score ||
    (a.doc.title < b.doc.title ? -1 : a.doc.title > b.doc.title ? 1 : 0);
  return hits.sort(compare);
}

/**
 * Rank documents for a query typed in a search box. A document that misses a distinctive word sinks below every
 * document that explains it (and is flagged `partial`), so a word that is in almost every row cannot win on its own.
 * Matching a document also lists its `related` rows. Filters and quoted phrases in the query narrow the result; a
 * kind word (`gherkin`) keeps only that kind of spec unless `kinds` is false.
 */
export function rankIndex(index: FindIndex, query: string, limit = 40, options: { readonly kinds?: boolean } = {}): Ranked[] {
  const parsed = parseSearch(query);
  const kinds = options.kinds !== false;
  const { notations, rest } = kinds ? splitQuery(parsed.words) : { notations: new Set<string>(), rest: parsed.words };
  const allows = (doc: FindDoc) => (notations.size === 0 || notations.has(notationOf(doc))) && passesFilters(doc.facets, parsed.filters);
  const matched = matchText(index, parsed, { partial: true, words: rest, allow: allows });
  if (matched === null) {
    if (parsed.tokens.length > 0) {
      return index.docs.filter(allows).slice(0, limit).map((doc) => ({ doc, score: 0, snippet: '' }));
    }
    if (notations.size === 0) return suggest(index.docs, limit);
    return listOfType(index.docs.filter(allows), limit);
  }
  const byId = new Map(index.docs.map((doc) => [doc.id, doc]));
  const seen = new Set<string>();
  const out: Ranked[] = [];
  const own = new Map(matched.map((hit) => [hit.doc.id, hit]));
  for (const hit of matched) {
    if (out.length >= limit) break;
    if (!seen.has(hit.doc.id)) {
      const { order: _order, misses: _misses, ...ranked } = hit;
      out.push(ranked);
      seen.add(hit.doc.id);
    }
    for (const id of hit.doc.related) {
      if (out.length >= limit || seen.has(id)) continue;
      const doc = byId.get(id);
      if (!doc || !allows(doc)) continue;
      const inherited = own.get(id);
      out.push({ doc, score: hit.score, snippet: inherited?.snippet || hit.snippet, ...(inherited ? {} : { related: true as const }) });
      seen.add(id);
    }
  }
  return out;
}

/** Index `docs` and rank them for `query`: see {@link rankIndex}. */
export function rank(docs: readonly FindDoc[], query: string, limit = 40): Ranked[] {
  return rankIndex(indexCorpus(docs), query, limit);
}
