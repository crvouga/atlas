/**
 * @module UI catalog entries for critics
 *
 * The UI catalog seen as a flat, orderable list that a separate process can iterate: one **entry** per captured state in
 * one profile that has a stored picture, with the hash of that picture and the critiques already made of it. A critic
 * lists entries a page at a time with a stable cursor, asks only for those that changed since a report version it holds,
 * asks only for those a given critic has not judged at the picture they have now, and fetches the picture itself by the
 * `image.path` (served by the same safe attachment path as every other file). Nothing here is stored: entries are a function of the
 * report, so the same layers in any order give the same list, and a missed event is covered by the next read.
 *
 * Critiques are opinions, never results: they ride along as evidence of an entry and change nothing about whether a
 * report passes.
 *
 * @see docs/critics.md#reading-the-catalog
 * @see docs/ui-catalog.md
 */
import type { Critique } from '../../schema/src/critique';
import { CRITIQUE_PART_KIND } from '../../schema/src/critique';
import type { EvidenceStatus } from './explorer-types';
import type { LayerEvidence } from './evidence-types';
import { combineEvidence } from './layer-merge';
import { uiCatalog, type UiOrigin, type UiProfile } from './ui-catalog';

/** The `schemaVersion` of the entries document. */
export const CATALOG_ENTRIES_VERSION = 1;

/** The state kind of an entry whose producers declared none. It is unknown, not `screen`. */
export const UNKNOWN_STATE_KIND = 'unknown';

/** The picture an entry was captured as: the hash critiques are anchored to, and where its stored bytes are. */
export type EntryImage = {
  /** SHA-256 of the exact stored bytes, lowercase hex. */
  readonly sha256: string;
  /** Where the bytes are, relative to the reports API root: `/layers/<layer>/blobs/attachments/<sha256>`. */
  readonly path: string;
  readonly contentType?: string;
  readonly width?: number;
  readonly height?: number;
  readonly bytes?: number;
};

/** A critique already made of an entry (any critic), and whether it judged the picture the entry has now. */
export type EntryCritique = {
  readonly layer: string;
  readonly producer: string;
  readonly recordedAtMs: number;
  /** The check's own status: whether the critic ran, never what it thought. */
  readonly status: EvidenceStatus;
  /** `current`: it judged this picture. `earlier-image`: the picture changed since, so the entry counts as not yet judged by that critic. */
  readonly currency: 'current' | 'earlier-image';
  readonly critique: Critique;
};

/** One captured state in one profile, ready to be judged. */
export type CatalogEntry = {
  /** Stable identity, unique in the catalog: the state id, then `@` and the profile when it has one. */
  readonly key: string;
  readonly stateId: string;
  readonly title: string;
  readonly route: string | null;
  readonly area: string | null;
  /** The kind of UI state (`screen`, `overlay`, `loading`, `error`, `empty`…), or `unknown`. */
  readonly state: string;
  readonly profile: UiProfile;
  readonly image: EntryImage;
  /** The layer, backend and provenance of the capture. */
  readonly origin: UiOrigin;
  /** Critiques of this entry that win their slot, newest first. */
  readonly critiques: readonly EntryCritique[];
};

/** The entries of a report, and how many captured cells could not be offered for judging. */
export type CatalogEntrySet = {
  readonly entries: readonly CatalogEntry[];
  /** Captured cells without a stored picture of a known hash (given only by address, left out, or not yet archived). They are not entries. */
  readonly unjudgeable: number;
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The key of the entry for a state in a profile. The state id alone when the profile says nothing; else
 * `id@environment;name=value;…` with the parameters sorted and every part percent-encoded, so two profiles never share a key.
 */
export function catalogEntryKey(stateId: string, profile: Pick<UiProfile, 'environment' | 'parameters'>): string {
  const parameters = Object.entries(profile.parameters).sort(([a], [b]) => compare(a, b)).map(([name, text]) => `${encodeURIComponent(name)}=${encodeURIComponent(text)}`);
  if (!profile.environment && !parameters.length) return stateId;
  return `${stateId}@${[encodeURIComponent(profile.environment ?? ''), ...parameters].join(';')}`;
}

function hashOf(image: { readonly sha256?: string; readonly bundleKey?: string }): string | undefined {
  if (image.sha256 && /^[0-9a-f]{64}$/i.test(image.sha256)) return image.sha256.toLowerCase();
  return /(?:^|\/)([0-9a-f]{64})$/i.exec(image.bundleKey ?? '')?.[1]?.toLowerCase();
}

/**
 * The entries of some layers, in key order. Only a `captured` cell with a picture stored in its layer (`image.path`) and a
 * known hash is an entry. Critiques are matched to entries by `subject.entryKey`, take the winner of each of their slots by
 * the report contract, and are marked `earlier-image` when they judged other bytes.
 */
export function catalogEntries(layers: readonly LayerEvidence[]): CatalogEntrySet {
  const catalog = uiCatalog(layers);
  const opinions: LayerEvidence[] = [];
  for (const entry of layers) {
    const rows = entry.rows.filter(row => row.kind === CRITIQUE_PART_KIND && row.critique !== undefined);
    if (rows.length) opinions.push({ ...entry, rows });
  }
  const byEntry = new Map<string, { layer: LayerEvidence['layer']; status: EvidenceStatus; critique: Critique }[]>();
  for (const result of combineEvidence({ specs: [], sha: null, changedFiles: [] }, opinions).unassigned) {
    const critique = result.row.critique;
    if (!critique) continue;
    const list = byEntry.get(critique.subject.entryKey) ?? [];
    list.push({ layer: result.layer, status: result.row.status, critique });
    byEntry.set(critique.subject.entryKey, list);
  }

  const entries: CatalogEntry[] = [];
  let unjudgeable = 0;
  for (const state of catalog.states) {
    for (const cell of state.cells) {
      if (cell.coverage !== 'captured' || !cell.capture) continue;
      const image = cell.capture.image;
      const sha256 = image ? hashOf(image) : undefined;
      if (!image || !image.path || !sha256) { unjudgeable += 1; continue; }
      const key = catalogEntryKey(state.id, cell.profile);
      const critiques = (byEntry.get(key) ?? [])
        .map(found => ({
          layer: found.layer.id, producer: found.layer.producer, recordedAtMs: found.layer.recordedAtMs, status: found.status,
          currency: found.critique.subject.imageSha256 === sha256 ? 'current' as const : 'earlier-image' as const, critique: found.critique
        }))
        .sort((a, b) => b.recordedAtMs - a.recordedAtMs || compare(a.layer, b.layer));
      entries.push({
        key, stateId: state.id, title: state.title, route: state.route, area: state.area, state: state.kind ?? UNKNOWN_STATE_KIND, profile: cell.profile,
        image: { sha256, path: image.path, ...(image.contentType ? { contentType: image.contentType } : {}), ...(image.width !== undefined ? { width: image.width } : {}), ...(image.height !== undefined ? { height: image.height } : {}), ...(image.bytes !== undefined ? { bytes: image.bytes } : {}) },
        origin: cell.capture.origin, critiques
      });
    }
  }
  entries.sort((a, b) => compare(a.key, b.key));
  return { entries, unjudgeable };
}

/** Whether an entry has a current critique with a verdict from the critic (and, when given, its version). A failed critique is not a judgement: the next run retries it. */
export function isJudgedBy(entry: Pick<CatalogEntry, 'critiques'>, critic: { readonly name: string; readonly version?: string }): boolean {
  return entry.critiques.some(found => found.currency === 'current' && found.critique.critic.name === critic.name && (critic.version === undefined || found.critique.critic.version === critic.version) && found.critique.verdict !== undefined && !found.critique.failure);
}

/** What a critic narrows the entries by. Every field is optional; nothing asked is everything. Values within a field are alternatives, fields combine with AND. */
export type CatalogEntriesQuery = {
  /** Words (all of them) found in the key, title, route or area. */
  readonly q?: string;
  readonly area?: readonly string[];
  /** Profile keys, as `UiProfile.key`. */
  readonly profile?: readonly string[];
  /** State kinds: `screen`, `overlay`, `loading`… */
  readonly state?: readonly string[];
  readonly route?: readonly string[];
  /** Only entries with no current critique with a verdict from this critic (`name`, or `name@version`). */
  readonly unjudgedBy?: { readonly name: string; readonly version?: string };
  /** Only entries added or changed since this report version. A version the server does not remember is answered with everything. */
  readonly since?: string;
  /** Resume after the entry this cursor names. Opaque: take it from the previous page. */
  readonly cursor?: string;
  /** Entries per page. Default 100, at most 1000. */
  readonly limit?: number;
};

const LIST_FIELDS = ['area', 'profile', 'state', 'route'] as const;
const DEFAULT_LIMIT = 100;
/** The most entries one page holds. */
export const MAX_ENTRIES_LIMIT = 1000;

/** Reads a query from URL search parameters; the comma-separated lists, `q`, `unjudgedBy=name@version`, `since`, `cursor` and `limit`. A `limit` that is not a whole number is left out. */
export function parseCatalogEntriesQuery(params: URLSearchParams): CatalogEntriesQuery {
  const query: Record<string, unknown> = {};
  const q = params.get('q')?.trim();
  if (q) query.q = q;
  for (const name of LIST_FIELDS) {
    const values = params.getAll(name).flatMap(item => item.split(',')).map(item => item.trim()).filter(Boolean);
    if (values.length) query[name] = values;
  }
  const by = params.get('unjudgedBy')?.trim();
  if (by) { const at = by.lastIndexOf('@'); query.unjudgedBy = at > 0 ? { name: by.slice(0, at), version: by.slice(at + 1) } : { name: by }; }
  const since = params.get('since')?.trim();
  if (since) query.since = since;
  const cursor = params.get('cursor')?.trim();
  if (cursor) query.cursor = cursor;
  const limit = params.get('limit');
  if (limit !== null && /^\d+$/.test(limit)) query.limit = Number(limit);
  return query as CatalogEntriesQuery;
}

/** A query as URL search parameters, the form {@link parseCatalogEntriesQuery} reads back. */
export function catalogEntriesParams(query: CatalogEntriesQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  for (const name of LIST_FIELDS) if (query[name]?.length) params.set(name, query[name]!.join(','));
  if (query.unjudgedBy) params.set('unjudgedBy', query.unjudgedBy.version === undefined ? query.unjudgedBy.name : `${query.unjudgedBy.name}@${query.unjudgedBy.version}`);
  if (query.since) params.set('since', query.since);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  return params;
}

/** The opaque cursor after an entry. */
export function encodeEntryCursor(key: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(key)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** The key a cursor names, or `null` when it is not a cursor this reader made. */
export function decodeEntryCursor(cursor: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const binary = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'));
    const key = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
    return key !== '' && encodeEntryCursor(key) === cursor ? key : null;
  } catch { return null; }
}

/** One page of entries and where to resume. */
export type CatalogEntryPage = {
  /** The page, in key order. */
  readonly entries: readonly CatalogEntry[];
  /** Entries that match the query (all pages). */
  readonly total: number;
  /** The `cursor` of the next page, absent on the last. */
  readonly nextCursor?: string;
};

/**
 * One page of the entries that match a query, in key order. The order is by key and the cursor names the last key of a page, so
 * a critic that iterates sees each entry exactly once however the catalog grows meanwhile (a new entry that sorts before the
 * cursor is found by the next `since` read). `changed` is the set of layer ids that changed since `query.since`
 * (`ReportIndex.changedSince`): `null` means the version was not remembered, and then everything matches.
 *
 * @throws Error when `query.cursor` is not a cursor.
 */
export function pageCatalogEntries(all: readonly CatalogEntry[], query: CatalogEntriesQuery, changed: ReadonlySet<string> | null = null): CatalogEntryPage {
  const terms = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const any = (wanted: readonly string[] | undefined, has: (value: string) => boolean) => !wanted?.length || wanted.some(has);
  const after = query.cursor === undefined ? null : decodeEntryCursor(query.cursor);
  if (query.cursor !== undefined && after === null) throw new Error('The cursor is not one this server made; start again without it.');
  const limit = Math.min(MAX_ENTRIES_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIMIT));
  const matching = all.filter(entry => {
    if (terms.length) { const text = [entry.key, entry.title, entry.route, entry.area].filter(Boolean).join(' ').toLowerCase(); if (!terms.every(term => text.includes(term))) return false; }
    if (!any(query.area, value => entry.area === value) || !any(query.profile, value => entry.profile.key === value) || !any(query.state, value => entry.state === value) || !any(query.route, value => entry.route === value)) return false;
    if (query.unjudgedBy && isJudgedBy(entry, query.unjudgedBy)) return false;
    if (query.since !== undefined && changed !== null && !changed.has(entry.origin.layer)) return false;
    return true;
  });
  const rest = after === null ? matching : matching.filter(entry => entry.key > after);
  const page = rest.slice(0, limit);
  return { entries: page, total: matching.length, ...(rest.length > page.length ? { nextCursor: encodeEntryCursor(page[page.length - 1]!.key) } : {}) };
}
