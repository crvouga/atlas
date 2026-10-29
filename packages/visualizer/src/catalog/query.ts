/** @module Catalog search model
 * A UI-only query over recorded catalog facts. The public catalog API and its literal filters are unchanged.
 */
import { filterUiCatalog, type UiCatalog, type UiCatalogQuery, type UiCatalogState } from '@crvouga/atlas/reports/ui-catalog';
import { splitList } from '@crvouga/atlas/reports/artifact-query';
import { indexCorpus, matchText, tokens, type FindDoc, type FindIndex } from '../find/rank';
import { parseSearch } from '../find/query';
import type { CatalogSearch } from './search';
import { coverageWord } from './words';

/** The catalog's exact recorded facets; kind and fixture are local additions to the search UI. */
export const CATALOG_FIELDS = ['coverage', 'profile', 'area', 'route', 'cohort', 'flag', 'surface', 'producer', 'attribute', 'kind', 'fixture'] as const;
export type CatalogField = typeof CATALOG_FIELDS[number];
/** Sorts offered in the same input as filters. */
export const CATALOG_SORTS = { relevance: 'Best matches', recent: 'Newest captures', oldest: 'Oldest captures', title: 'Title A–Z', 'title-desc': 'Title Z–A', coverage: 'Needs attention first' } as const;
type Sort = keyof typeof CATALOG_SORTS;
/** A removable piece of the expression; raw is preserved for URL round trips. */
export type CatalogToken = { raw: string; value: string; field?: string };
/** Human-readable pills keep opaque profile keys out of the visible search control. */
export function catalogChipLabel(catalog: UiCatalog, token: CatalogToken): string {
  if (token.field === 'profile') return `Profile: ${catalog.profiles.find(profile => profile.key === token.value)?.label ?? token.value}`;
  if (token.field === 'sort' && Object.hasOwn(CATALOG_SORTS, token.value)) return `Sort: ${CATALOG_SORTS[token.value as Sort]}`;
  if (token.field === 'coverage') return `Coverage: ${token.value.split(',').map(coverageWord).join(', ')}`;
  return token.raw;
}
const RELATED = [
  ['appointment', 'booking', 'reservation', 'visit'],
  ['error', 'failure', 'failed', 'invalid', 'broken', 'unavailable', 'offline'],
  ['loading', 'waiting', 'pending', 'progress'],
  ['empty', 'blank', 'nothing'],
  ['login', 'signin', 'authentication'],
  ['settings', 'preferences', 'configuration'],
  ['payment', 'billing', 'checkout'],
  ['dialog', 'modal', 'overlay'],
  ['success', 'successful', 'confirmation', 'confirmed']
] as const;
const fieldAliases: Record<string, string> = { status: 'coverage', state: 'kind', type: 'kind', environment: 'profile', device: 'profile', screen: 'kind', flags: 'flag', order: 'sort' };

/** Split free text and quoted facet values without losing the original expression. */
export function catalogTokens(text: string): CatalogToken[] {
  return [...text.matchAll(/(?:[^\s"']+:)?"(?:\\.|[^"\\])*"|[^\s]+/g)].map(([raw]) => {
    const at = raw.indexOf(':');
    const field = at > 0 && /^[a-z-]+$/i.test(raw.slice(0, at)) ? raw.slice(0, at).toLowerCase() : undefined;
    const encoded = field ? raw.slice(at + 1) : raw;
    let value = encoded.replace(/^"|"$/g, '');
    if (encoded.startsWith('"') && encoded.endsWith('"')) {
      try { value = JSON.parse(encoded); } catch { /* Keep incomplete input editable. */ }
    }
    return { raw, value, ...(field ? { field: Object.hasOwn(fieldAliases, field) ? fieldAliases[field] : field } : {}) };
  });
}
/** Encode one fact as an editable expression chip. */
export function catalogToken(field: string, value: string): string {
  return `${field}:${/[\s"]/u.test(value) ? JSON.stringify(value) : value}`;
}
/** Read old facet links as chips alongside the richer UI-only expression. */
export function catalogExpression(search: CatalogSearch): string {
  return [search.find, search.q, ...CATALOG_FIELDS.flatMap(field => field === 'kind' || field === 'fixture' ? [] : splitList(search[field] ?? '').map(value => catalogToken(field, value)))].filter(Boolean).join(' ');
}
/** Clear the old UI controls when normalizing an edited expression into its own URL parameter. */
export const CLEAR_CATALOG_SEARCH = { find: undefined, q: undefined, coverage: undefined, profile: undefined, area: undefined, route: undefined, cohort: undefined, flag: undefined, surface: undefined, producer: undefined, attribute: undefined };
/** Append chips, replacing the previous sort and avoiding duplicate filters. */
export function addCatalogTokens(current: readonly CatalogToken[], text: string): string {
  let next = [...current];
  for (const token of catalogTokens(text)) {
    if (token.field === 'sort') next = next.filter(item => item.field !== 'sort');
    if (!next.some(item => item.raw.toLowerCase() === token.raw.toLowerCase())) next.push(token);
  }
  return next.map(token => token.raw).join(' ');
}
function expand(text: string): string {
  const words = new Set(tokens(text));
  return RELATED.filter(group => group.some(word => words.has(tokens(word)[0]!))).flat().join(' ');
}
function doc(id: string, title: string, metadata: string): FindDoc {
  return { id, title, subtitle: '', fields: [{ name: 'title', text: title }, { name: 'metadata', text: metadata }, { name: 'description', text: expand(`${title} ${metadata}`) }], kind: 'screen', group: 'Flows', status: null, related: [], target: { to: '/', search: {} }, recording: null };
}
function stateDoc(state: UiCatalogState): FindDoc {
  // Coverage is deliberately excluded: an error screen can have a successful capture.
  return doc(state.id, state.title, [state.id, state.route, state.fixture, state.cohort, state.area, state.kind, ...state.flags, ...state.covers, ...state.producers, ...Object.entries(state.attributes).flat(), ...state.cells.map(cell => cell.profile.label)].filter(Boolean).join(' '));
}
const indexes = new WeakMap<UiCatalog, FindIndex>();
function index(catalog: UiCatalog): FindIndex {
  let found = indexes.get(catalog);
  if (!found) { found = indexCorpus(catalog.states.map(stateDoc)); indexes.set(catalog, found); }
  return found;
}
function matching(index: FindIndex, text: string) {
  // The shared matcher permits common words to be absent when ranking. Catalog chips promise an intersection,
  // so match each term independently, retaining its typo/stem/phrase handling, then intersect the hits.
  let combined: ReturnType<typeof matchText> = null;
  for (const token of catalogTokens(text)) {
    let hits = matchText(index, parseSearch(token.raw), { snippets: false });
    // The shared word index is Latin-based. Literal matching preserves non-Latin product names and stop-word-only terms.
    if (hits === null && token.value.trim()) hits = matchText(index, parseSearch(JSON.stringify(token.value)), { snippets: false });
    if (hits === null) continue;
    if (combined === null) combined = hits;
    else {
      const scores = new Map(hits.map(hit => [hit.doc.id, hit.score]));
      combined = combined.filter(hit => scores.has(hit.doc.id)).map(hit => ({ ...hit, score: hit.score + scores.get(hit.doc.id)! }));
    }
  }
  return combined?.sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title)) ?? null;
}
/** Apply all terms, recorded facets and a stable sort; never change a state or capture outcome. */
export function searchCatalog(catalog: UiCatalog, expression: string): { catalog: UiCatalog; issues: string[]; sort: Sort } {
  const parsed = catalogTokens(expression);
  const issues: string[] = [];
  let sort: Sort = 'relevance';
  const query: Record<string, string[]> = {};
  for (const token of parsed.filter(token => token.field)) {
    const field = token.field!;
    if (field === 'sort' && Object.hasOwn(CATALOG_SORTS, token.value)) { sort = token.value as Sort; continue; }
    if (!(CATALOG_FIELDS as readonly string[]).includes(field) || !token.value) { issues.push(`“${token.raw}” is not a supported filter. Choose a suggestion to correct it.`); continue; }
    const values = field === 'coverage' ? token.value.split(',') : [token.value];
    if (field === 'coverage' && values.some(value => !['captured', 'failed', 'capturing', 'missing', 'skipped'].includes(value))) { issues.push(`“${token.raw}” is not a capture coverage value.`); continue; }
    query[field] = [...(query[field] ?? []), ...values];
  }
  const literal = parsed.filter(token => !token.field).map(token => token.raw).join(' ');
  const hits = literal ? matching(index(catalog), literal) : null;
  const scores = hits === null ? null : new Map(hits.map(hit => [hit.doc.id, hit.score]));
  const filtered = filterUiCatalog(catalog, query as UiCatalogQuery);
  const states = filtered.states.filter(state => (!scores || scores.has(state.id)) && (!query.kind || query.kind.includes(state.kind ?? '')) && (!query.fixture || query.fixture.includes(state.fixture ?? '')));
  const time = (state: UiCatalogState) => Math.max(0, ...state.cells.map(cell => cell.capture?.origin.recordedAtMs ?? 0));
  const attention = (state: UiCatalogState) => Math.min(...state.cells.map(cell => ({ failed: 0, missing: 1, capturing: 2, skipped: 3, captured: 4 })[cell.coverage] ?? 5));
  const sorted = [...states].sort((a, b) => {
    const order = sort === 'relevance' ? (scores?.get(b.id) ?? 0) - (scores?.get(a.id) ?? 0) : sort === 'recent' ? time(b) - time(a) : sort === 'oldest' ? time(a) - time(b) : sort === 'coverage' ? attention(a) - attention(b) : 0;
    return order || (sort === 'title-desc' ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title)) || a.id.localeCompare(b.id);
  });
  const coverage = { captured: 0, failed: 0, capturing: 0, skipped: 0, missing: 0 };
  const profiles = new Set<string>();
  let cells = 0, undeclared = 0;
  for (const state of sorted) for (const cell of state.cells) { cells++; profiles.add(cell.profile.key); coverage[cell.coverage]++; if (cell.expected === 'undeclared') undeclared++; }
  return { catalog: { ...filtered, states: sorted, summary: { ...filtered.summary, states: sorted.length, profiles: profiles.size, cells, coverage, undeclared } }, issues, sort };
}

/** A bounded autocomplete choice from the catalog's own facts or its sorting actions. */
export type CatalogSuggestion = { value: string; label: string; detail: string; count?: number };
const choices = new WeakMap<UiCatalog, { values: CatalogSuggestion[]; index: FindIndex }>();
function catalogChoices(catalog: UiCatalog) {
  let found = choices.get(catalog);
  if (found) return found;
  const values: CatalogSuggestion[] = [];
  const facets = { coverage: catalog.facets.coverage, profile: catalog.facets.profiles, area: catalog.facets.areas, route: catalog.facets.routes, cohort: catalog.facets.cohorts, flag: catalog.facets.flags, surface: catalog.facets.surfaces, producer: catalog.facets.producers, attribute: catalog.facets.attributes ?? [] };
  for (const [field, entries] of Object.entries(facets)) for (const entry of entries) values.push({ value: catalogToken(field, entry.value), label: entry.label ?? (field === 'coverage' ? coverageWord(entry.value) : entry.value), detail: field === 'coverage' ? 'Capture coverage' : field, count: entry.count });
  for (const field of ['kind', 'fixture'] as const) {
    const counts = new Map<string, number>();
    for (const state of catalog.states) if (state[field]) counts.set(state[field]!, (counts.get(state[field]!) ?? 0) + 1);
    for (const [value, count] of counts) values.push({ value: catalogToken(field, value), label: value, detail: field === 'kind' ? 'UI state kind' : field, count });
  }
  // Plain title words make product vocabulary discoverable, without forcing users to know a facet's name.
  const words = new Map<string, number>();
  for (const state of catalog.states) for (const word of new Set(state.title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])) words.set(word, (words.get(word) ?? 0) + 1);
  for (const [word, count] of words) values.push({ value: word, label: word, detail: 'Search term', count });
  for (const [sort, label] of Object.entries(CATALOG_SORTS)) values.push({ value: `sort:${sort}`, label, detail: 'Sort' });
  found = { values, index: indexCorpus(values.map((value, i) => doc(String(i), value.label, `${value.value} ${value.detail}`))) };
  choices.set(catalog, found);
  return found;
}
/** Forgiving spelling, prefixes and related wording, ranked before drawing at most 12 choices. */
export function suggestCatalog(catalog: UiCatalog, draft: string, selected: readonly CatalogToken[]): CatalogSuggestion[] {
  const { values, index } = catalogChoices(catalog);
  const typed = catalogTokens(draft)[0];
  const field = typed?.field;
  const needle = field ? typed.value : draft;
  const hits = needle.trim() ? matching(index, needle.replace(/:/g, ' ')) ?? [] : null;
  const wanted = hits ? hits.map(hit => values[Number(hit.doc.id)]!) : values;
  return wanted.filter(value => (!field || value.value.startsWith(`${field}:`)) && !selected.some(token => token.raw === value.value)).slice(0, 12);
}
