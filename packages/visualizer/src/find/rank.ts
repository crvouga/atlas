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

export const FIELD_WEIGHT = { title: 5, steps: 3, description: 2, path: 0.5 } as const;

export type FieldName = keyof typeof FIELD_WEIGHT;

export type FindField = { readonly name: FieldName; readonly text: string };

export type FindGroup = 'Flows' | 'Specs' | 'Runs';

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
  };
};

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
};

export type Ranked = { readonly doc: FindDoc; readonly score: number; readonly snippet: string };

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

type Posting = { readonly doc: number; readonly weight: number; readonly snippet: string; readonly snippetRank: number };

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
        if (!prior) best.set(term, { doc, weight, snippet: fromField, snippetRank: rank });
        else if (weight > prior.weight || rank > prior.snippetRank) {
          best.set(term, {
            doc,
            weight: Math.max(weight, prior.weight),
            snippet: rank > prior.snippetRank ? fromField : prior.snippet,
            snippetRank: Math.max(rank, prior.snippetRank)
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

type Scored = Ranked & { readonly misses: number };

function scoreAll(index: FindIndex, query: string): Scored[] {
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
  return index.docs.map((doc, docIndex) => {
    let score = 0;
    let misses = 0;
    let snippet = '';
    let snippetRankSeen = 0;
    for (const entry of queries) {
      let best = 0;
      let bestSnippet = '';
      let bestRank = 0;
      let hit = false;
      for (const candidate of entry.candidates) {
        const posting = index.postings.get(candidate.term)?.find((item) => item.doc === docIndex);
        if (!posting) continue;
        hit = true;
        const value = idf(index.df.get(candidate.term) ?? 0, total) * posting.weight * candidate.factor;
        if (value > best) best = value;
        if (posting.snippetRank > bestRank) {
          bestRank = posting.snippetRank;
          bestSnippet = posting.snippet;
        }
      }
      if (hit) score += best;
      else if (entry.rare) misses++;
      if (bestRank > snippetRankSeen && bestSnippet) {
        snippetRankSeen = bestRank;
        snippet = bestSnippet;
      }
    }
    return { doc, score, misses, snippet: lineSnippet(snippet, queryTerms) };
  });
}

/** Journeys first, then failing runs. An empty box stays a short list of stories. */
export function suggest(docs: readonly FindDoc[], limit = 40): Ranked[] {
  const journeys = docs.filter((doc) => doc.kind === 'journey');
  const failing = docs.filter((doc) => doc.kind === 'run' && doc.status === 'failed');
  return [...journeys, ...failing].slice(0, limit).map((doc) => ({ doc, score: 0, snippet: '' }));
}

/**
 * Rank documents for a query. A document that misses a rare query word sinks below every
 * document that explains it, so a word that is in almost every row cannot win on its own.
 * Matching a document also lists its `related` rows.
 */
export function rankIndex(index: FindIndex, query: string, limit = 40): Ranked[] {
  const { notations, rest } = splitQuery(query);
  const allows = (doc: FindDoc) => notations.size === 0 || notations.has(notationOf(doc));
  if (rest.trim().length === 0 || tokens(rest).length === 0) {
    if (notations.size === 0) return suggest(index.docs, limit);
    return listOfType(index.docs.filter(allows), limit);
  }
  const scored = scoreAll(index, rest).filter((entry) => entry.score > 0 && allows(entry.doc));
  scored.sort((a, b) => a.misses - b.misses || b.score - a.score || (a.doc.title < b.doc.title ? -1 : a.doc.title > b.doc.title ? 1 : 0));
  const byId = new Map(index.docs.map((doc) => [doc.id, doc]));
  const seen = new Set<string>();
  const out: Ranked[] = [];
  for (const hit of scored) {
    if (out.length >= limit) break;
    if (!seen.has(hit.doc.id)) {
      out.push({ doc: hit.doc, score: hit.score, snippet: hit.snippet });
      seen.add(hit.doc.id);
    }
    for (const id of hit.doc.related) {
      if (out.length >= limit || seen.has(id)) continue;
      const doc = byId.get(id);
      if (!doc || !allows(doc)) continue;
      const own = scored.find((entry) => entry.doc.id === id);
      out.push({ doc, score: hit.score, snippet: own?.snippet || hit.snippet });
      seen.add(id);
    }
  }
  return out;
}

export function rank(docs: readonly FindDoc[], query: string, limit = 40): Ranked[] {
  return rankIndex(indexCorpus(docs), query, limit);
}
