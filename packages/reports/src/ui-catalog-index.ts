/**
 * @module UI catalog index
 *
 * A compact view of the UI catalog for a viewer that browses it through a server: every state with the facts that search,
 * filters, sorting and counts read, and none of the evidence a card draws (pictures, attachments, origins, labels, plans).
 * `GET /api/reports/ui-catalog?view=index` answers with it, and `?view=index&since=<version>` with only the states that
 * changed since a version the server remembers, plus the ids of those removed. A viewer reads the evidence of the states it
 * shows with `?id=<ids>` (the full document, for those states only).
 *
 * The index is a projection, never a judgement: a cell's `coverage` and `expected` are the full catalog's, unchanged. A
 * state's `fingerprint` changes whenever anything of its full document does (a new winner, picture, attachment or plan), so
 * a viewer can tell which held evidence is out of date. A viewer that is given a full catalog in place of an index (an older
 * server) projects it itself ({@link uiCatalogIndexOf}).
 *
 * @see docs/ui-catalog.md#streaming-and-loading
 */

import type { EvidenceStatus } from './explorer-types';
import { splitList } from './artifact-query';
import type { UiCapture, UiCatalog, UiCatalogState, UiCell, UiCoverage, UiProfile } from './ui-catalog';

/** One cell of an index state: its profile (a key of the document's `profiles`) and how it stands. */
export type UiCatalogIndexCell = {
  readonly profile: string;
  readonly coverage: UiCoverage;
  readonly expected: UiCell['expected'];
  /** The winning capture's status, or null when nothing was captured. */
  readonly status: EvidenceStatus | null;
  /** Why the capture failed or was skipped; absent when empty. */
  readonly detail?: string;
  /** When the winning capture was recorded, or null when nothing was captured. */
  readonly recordedAtMs: number | null;
  /** The producer of the winning capture; absent when nothing was captured. */
  readonly producer?: string;
  /** The winning capture's labels, only for one that did not pass (its failure `fingerprint`, `phase`, `attempts`, …); absent otherwise. */
  readonly labels?: Readonly<Record<string, string>>;
};

/** A state as the index holds it: its facts, its cells, and a fingerprint of its whole document. */
export type UiCatalogIndexState = Omit<UiCatalogState, 'cells'> & {
  readonly cells: readonly UiCatalogIndexCell[];
  /** Changes whenever anything in the state's full document does. Compare, never parse. */
  readonly fingerprint: string;
};

/** `GET /api/reports/ui-catalog?view=index`: the catalog's summary, facets and sources, with index states. */
export type UiCatalogIndex = Omit<UiCatalog, 'states'> & {
  readonly view: 'index';
  readonly states: readonly UiCatalogIndexState[];
  /** States that match the query (all pages); with an honored `since`, the states that changed. */
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  /** Present when `since` was asked. With `honored`, `states` holds only what changed and `removed` what went. */
  readonly since?: { readonly requested: string; readonly honored: boolean };
  /** With an honored `since`: the ids of the states that are no longer in the catalog. */
  readonly removed?: readonly string[];
};

// A small, fast, well-mixed string hash (cyrb53). Not cryptographic: it only has to change when the text does.
function hash(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const indexed = new WeakMap<UiCatalogState, UiCatalogIndexState>();

/** The index form of one full state. Made once per state object. */
export function uiIndexState(state: UiCatalogState): UiCatalogIndexState {
  let found = indexed.get(state);
  if (found) return found;
  const cells = state.cells.map((cell): UiCatalogIndexCell => ({
    profile: cell.profile.key, coverage: cell.coverage, expected: cell.expected, status: cell.capture?.status ?? null,
    ...(cell.capture?.detail ? { detail: cell.capture.detail } : {}), recordedAtMs: cell.capture?.origin.recordedAtMs ?? null,
    ...(cell.capture ? { producer: cell.capture.origin.producer } : {}),
    ...(cell.capture && cell.capture.status !== 'passed' && Object.keys(cell.capture.labels).length ? { labels: cell.capture.labels } : {})
  }));
  const { cells: _cells, ...facts } = state;
  found = { ...facts, cells, fingerprint: hash(JSON.stringify(state)) };
  indexed.set(state, found);
  return found;
}

/** The index of a full catalog document (or of a page of one), with paging fields. */
export function uiCatalogIndexOf(catalog: UiCatalog & { readonly total?: number; readonly offset?: number; readonly limit?: number }): UiCatalogIndex {
  const states = catalog.states.map(uiIndexState);
  return { ...catalog, view: 'index', states, total: catalog.total ?? states.length, offset: catalog.offset ?? 0, limit: catalog.limit ?? states.length };
}

/** Only the states with these exact ids (`?id=`), in the catalog's order. Nothing asked is everything. */
export function selectUiStates(catalog: UiCatalog, ids: readonly string[]): UiCatalog {
  if (!ids.length) return catalog;
  const wanted = new Set(ids);
  return { ...catalog, states: catalog.states.filter(state => wanted.has(state.id)) };
}

/** The `id` parameters of a request, comma-separated or repeated, as {@link selectUiStates} takes them. */
export function uiStateIds(params: URLSearchParams): string[] {
  return params.getAll('id').flatMap(splitList);
}

/**
 * Remembers the fingerprints of the index answers it gave, a few versions back, so that a later `since` is answered with
 * only what changed. Keyed by version and by the question's scope (its filters and definition), because a delta is only
 * meaningful against the same question. Bounded: the oldest is forgotten first, and a forgotten version is answered whole.
 */
export class UiCatalogIndexes {
  readonly #kept = new Map<string, ReadonlyMap<string, string>>();
  constructor(private readonly size = 16) {}

  /**
   * The index answer for a (filtered) catalog at `version`: one page of it, or with `since` the states that changed since
   * that version and the ids that went, when that version is remembered for the same `scope`; otherwise the whole catalog
   * with `since.honored` false.
   */
  answer(catalog: UiCatalog, options: { readonly version: string; readonly scope: string; readonly since?: string | null; readonly limit: number; readonly offset: number }): UiCatalogIndex {
    const states = catalog.states.map(uiIndexState);
    const now = new Map(states.map(state => [state.id, state.fingerprint]));
    const key = `${options.scope}\u0000${options.version}`;
    if (!this.#kept.has(key)) {
      if (this.#kept.size >= this.size) this.#kept.delete(this.#kept.keys().next().value!);
      this.#kept.set(key, now);
    }
    const base = { ...catalog, view: 'index' as const };
    const offset = Math.max(0, options.offset), limit = Math.max(0, options.limit);
    if (options.since) {
      const before = this.#kept.get(`${options.scope}\u0000${options.since}`);
      if (before) {
        const changed = states.filter(state => before.get(state.id) !== state.fingerprint);
        const removed = [...before.keys()].filter(id => !now.has(id));
        return { ...base, states: changed, total: changed.length, offset: 0, limit: changed.length, since: { requested: options.since, honored: true }, removed };
      }
      return { ...base, states: states.slice(offset, offset + limit), total: states.length, offset, limit, since: { requested: options.since, honored: false } };
    }
    return { ...base, states: states.slice(offset, offset + limit), total: states.length, offset, limit };
  }
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The index a viewer holds after a `since` answer: changed states replaced or added in id order, removed ones dropped, and
 * the summary, facets and sources taken from the answer. An answer that is not an honored delta replaces what was held.
 */
export function applyUiCatalogIndexDelta(held: UiCatalogIndex, answer: UiCatalogIndex): UiCatalogIndex {
  if (!answer.since?.honored) return answer;
  if (!answer.states.length && !answer.removed?.length) {
    // Nothing of the catalog changed: keep what is held, so nothing downstream is computed again for an unchanged report.
    return answer.version === held.version ? held : { ...answer, states: held.states, total: held.states.length, offset: 0, limit: held.states.length, removed: [] };
  }
  const byId = new Map(held.states.map(state => [state.id, state]));
  for (const id of answer.removed ?? []) byId.delete(id);
  for (const state of answer.states) byId.set(state.id, state);
  const states = [...byId.values()].sort((a, b) => compare(a.id, b.id));
  return { ...answer, states, total: states.length, offset: 0, limit: states.length };
}

// A cell of the index, made into the shape of a full one: its picture, origin and plan are not known here.
const hydrated = new WeakSet<UiCatalogState>();
const fromIndex = new WeakMap<UiCatalogIndexState, UiCatalogState>();

function fullProfile(profiles: ReadonlyMap<string, UiProfile>, key: string): UiProfile {
  return profiles.get(key) ?? { key, environment: null, parameters: {}, label: key };
}

/**
 * The index as a {@link UiCatalog}, for code that searches, filters, sorts and counts it. Each cell's `capture` holds only
 * the status, detail, time, producer and (for a capture that did not pass) labels the index carries: no picture,
 * attachments or origin beyond those. Such a
 * state answers true to {@link isIndexState}; read its full document (`?id=`) before drawing its evidence.
 */
export function uiCatalogFromIndex(index: UiCatalogIndex): UiCatalog {
  const profiles = new Map(index.profiles.map(profile => [profile.key, profile]));
  const states = index.states.map(item => {
    const known = fromIndex.get(item);
    if (known && known.cells.every(cell => cell.profile.label === profiles.get(cell.profile.key)?.label)) return known;
    const { cells, fingerprint: _fingerprint, ...facts } = item;
    const state: UiCatalogState = {
      ...facts,
      cells: cells.map((cell): UiCell => ({
        profile: fullProfile(profiles, cell.profile), coverage: cell.coverage, expected: cell.expected, planned: null,
        capture: cell.status === null ? null : {
          status: cell.status, detail: cell.detail ?? '', durationMs: null, image: null, labels: cell.labels ?? {}, alternatives: 0,
          origin: { layer: '', backend: '', producer: cell.producer ?? '', recordedAtMs: cell.recordedAtMs ?? 0, sha: null, branch: null, runUrl: null }
        } satisfies UiCapture
      }))
    };
    hydrated.add(state);
    fromIndex.set(item, state);
    return state;
  });
  const { view: _view, total: _total, offset: _offset, limit: _limit, since: _since, removed: _removed, ...rest } = index;
  return { ...rest, states };
}

/** Whether a state came from an index ({@link uiCatalogFromIndex}): its evidence (pictures, origins, plans) must be read before it is drawn. */
export function isIndexState(state: UiCatalogState): boolean {
  return hydrated.has(state);
}
