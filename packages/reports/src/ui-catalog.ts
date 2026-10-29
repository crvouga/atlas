/**
 * @module UI catalog
 *
 * A browsable inventory of a product's user interface, computed from layers and nothing else: each **state** (a screen, or
 * one state of a screen) captured once per **profile** (viewport, color scheme, device), with the facts needed to find and
 * trust it, and what should exist but has not been captured yet. `uiCatalog` is a pure function of the winning results of
 * the layers it is given, so it inherits the report contract's laws: the same layers in any order, split any way across
 * backends, shards and machines, give the same catalog; a layer changes only the cells it fills; an unreadable layer is
 * absent, never captured. It imports no collection framework and knows nothing about how a picture was taken.
 *
 * How the convention maps onto the layer format is in {@link ./ui-state}: a state is a check of a `ui-state` part, a profile
 * is the layer's `environment` and `parameters`, the expected set is a `ui-plan` part. The viewer computes the catalog from
 * the report it already streams (so it fills in as results arrive), and the server answers the same document at
 * `GET /api/reports/ui-catalog`.
 *
 * @see docs/ui-catalog.md
 * @see docs/report-contract.md#how-layers-compose
 */
import type { BackendInfo, LayerEvidence, LayerHeader } from './evidence-types';
import type { EvidenceStatus } from './explorer-types';
import { joinList, splitList } from './artifact-query';
import { combineEvidence, parameterKey, replaces, type EvidenceResult } from './layer-merge';
import { environmentLabel } from './layer-axes';
import { UI_PLAN_KIND, UI_STATE_KIND, type UiScreenshot } from './ui-state';

/** The `schemaVersion` of the catalog document. */
export const UI_CATALOG_VERSION = 1;

/** One profile: the client and the choices a state was captured under. Its `key` identifies it across layers. */
export type UiProfile = {
  /** Stable identity: the environment and the sorted parameters. */
  readonly key: string;
  /** The client (`desktop-web`, `ios`…), or null when the layer named none. */
  readonly environment: string | null;
  /** The layer's other choices, such as `{ viewport: '390x844', scheme: 'dark' }`. */
  readonly parameters: Readonly<Record<string, string>>;
  /** For a person: the client and each parameter's value. */
  readonly label: string;
};

/**
 * How one state stands in one profile. `captured`: a capture passed. `failed`: it was attempted and failed (its `detail`
 * says why). `capturing`: it is being taken now. `skipped`: a producer recorded it as not run. `missing`: expected, and
 * nothing has been recorded. Only `captured` is ever shown as captured; every other value means there is no picture to trust.
 */
export type UiCoverage = 'captured' | 'failed' | 'capturing' | 'skipped' | 'missing';

/** The values of {@link UiCoverage}, in the order a person reads them. */
export const UI_COVERAGE = ['captured', 'failed', 'capturing', 'skipped', 'missing'] as const;

/** A picture, with the address a browser loads it from. */
export type UiImage = UiScreenshot & {
  /** Where the stored bytes are, relative to the reports API root (`/layers/<layer>/blobs/attachments/<sha256>`). Absent for an address-only or omitted picture. */
  readonly path?: string;
};

/** Where a capture came from: the layer, the backend that holds it, and the provenance the layer recorded. */
export type UiOrigin = {
  readonly layer: string;
  readonly backend: string;
  readonly producer: string;
  readonly recordedAtMs: number;
  readonly sha: string | null;
  readonly branch: string | null;
  readonly runUrl: string | null;
  readonly freshness?: 'unknown' | 'modified';
};

/** The winning capture of one cell. */
export type UiCapture = {
  readonly status: EvidenceStatus;
  /** Why it failed or was skipped; empty otherwise. */
  readonly detail: string;
  readonly durationMs: number | null;
  /** The picture, or null when the capture has none (or it was left out: see `omitted`). */
  readonly image: UiImage | null;
  /** The check's labels: what describes the capture without splitting it (a `shard`, a `browser`). */
  readonly labels: Readonly<Record<string, string>>;
  readonly origin: UiOrigin;
  /** How many other captures of this cell exist from other producers. The winner is the one the report contract picks. */
  readonly alternatives: number;
};

/** One state in one profile. */
export type UiCell = {
  readonly profile: UiProfile;
  readonly coverage: UiCoverage;
  /** Whether a plan expects this state in this profile: `declared`; `undeclared` when plans exist and none names it; `unknown` when no plan was published at all. */
  readonly expected: 'declared' | 'undeclared' | 'unknown';
  readonly capture: UiCapture | null;
  /** The layer of the plan that expects it, when one does. */
  readonly planned: { readonly layer: string; readonly backend: string } | null;
};

/** One state of the product's interface, across its profiles. */
export type UiCatalogState = {
  /** The check id the producers gave it. */
  readonly id: string;
  readonly title: string;
  readonly route: string | null;
  readonly fixture: string | null;
  readonly cohort: string | null;
  readonly area: string | null;
  /** The kind of UI state the producers declared (`screen`, `overlay`, `loading`…), or null when none did. */
  readonly kind: string | null;
  readonly flags: readonly string[];
  /** The surfaces it covers. */
  readonly covers: readonly string[];
  /** Facts of the producers' own (`locale`, `brand`…), by name. Where two producers disagree the newest result's value is kept. Empty when none declared any. */
  readonly attributes: Readonly<Record<string, string>>;
  /** The producers that captured or planned it. */
  readonly producers: readonly string[];
  /** One cell per profile, ordered by the profile's label. */
  readonly cells: readonly UiCell[];
};

/** One surface of the product: an inventory entry, or something a state says it covers. */
export type UiSurface = {
  readonly id: string;
  /** True when a `ui-plan` inventory entry names it: the product is known to have it. */
  readonly inventoried: boolean;
  /** States that cover it. */
  readonly states: number;
  /** Of those, states with at least one captured profile. */
  readonly captured: number;
  /** `covered`: some covering state is captured. `uncaptured`: states cover it and none is captured yet. `uncovered`: no state covers it. */
  readonly status: 'covered' | 'uncaptured' | 'uncovered';
};

/** A value of a facet and how many states have it. */
export type UiFacetValue = { readonly value: string; readonly count: number; readonly label?: string };

/** The values each filter offers, over every state of the catalog. */
export type UiCatalogFacets = {
  readonly profiles: readonly UiFacetValue[];
  readonly coverage: readonly UiFacetValue[];
  readonly areas: readonly UiFacetValue[];
  readonly routes: readonly UiFacetValue[];
  readonly cohorts: readonly UiFacetValue[];
  readonly flags: readonly UiFacetValue[];
  readonly surfaces: readonly UiFacetValue[];
  readonly producers: readonly UiFacetValue[];
  /** Every `name=value` pair of the states' attributes: the values the `attribute` filter takes. */
  readonly attributes: readonly UiFacetValue[];
};

/** The catalog in numbers. Cells count a state once per profile. */
export type UiCatalogSummary = {
  readonly states: number;
  readonly profiles: number;
  readonly cells: number;
  readonly coverage: Readonly<Record<UiCoverage, number>>;
  /** Captured or failed cells no plan expects. Zero when no plan was published, because then nothing is known to be unexpected. */
  readonly undeclared: number;
  /** Whether any plan (an expected set) was published. Without one, `missing` can only ever be zero. */
  readonly planned: boolean;
  readonly surfaces: number;
  readonly uncoveredSurfaces: number;
};

/** The catalog, as `GET /api/reports/ui-catalog` answers it (`version` is the report's, when the caller knows it). */
export type UiCatalog = {
  readonly schemaVersion: typeof UI_CATALOG_VERSION;
  readonly version?: string;
  readonly summary: UiCatalogSummary;
  readonly profiles: readonly UiProfile[];
  readonly states: readonly UiCatalogState[];
  readonly surfaces: readonly UiSurface[];
  readonly facets: UiCatalogFacets;
  /** What could not be read. A state that depended on it is not in the catalog as captured. Filled by the caller who read the backends. */
  readonly sources: { readonly layers: number; readonly backends: readonly BackendInfo[]; readonly notices: readonly string[] };
};

/** What a caller may say about how the layers were read. */
export type UiCatalogOptions = {
  /** The report's version, repeated in the document. */
  readonly version?: string;
  /** The backends, with whether each could be read. */
  readonly backends?: readonly BackendInfo[];
  /** What could not be read. */
  readonly notices?: readonly string[];
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The profile of a layer: its environment and its other parameters. */
export function uiProfile(layer: Pick<LayerHeader, 'environment' | 'parameters'>): UiProfile {
  const parameters = layer.parameters;
  const values = Object.entries(parameters).sort(([a], [b]) => compare(a, b)).map(([, value]) => value);
  return {
    key: `${layer.environment ?? ''}|${parameterKey(parameters)}`,
    environment: layer.environment,
    parameters,
    label: [layer.environment ? environmentLabel(layer.environment) : 'No environment', ...values].join(' · ')
  };
}

// Keys of stored files are `attachments/<hex>`: nothing to escape, which is worth not asking `encodeURIComponent` about thousands of times.
const PLAIN = /^[\w.-]+(?:\/[\w.-]+)*$/;

function encodeKey(key: string): string {
  return PLAIN.test(key) ? key : key.split('/').map(encodeURIComponent).join('/');
}

const layerPaths = new WeakMap<LayerHeader, string>();

function layerPath(layer: LayerHeader): string {
  let found = layerPaths.get(layer);
  if (found === undefined) layerPaths.set(layer, found = `/layers/${encodeURIComponent(layer.id)}/blobs/`);
  return found;
}

function imageOf(result: EvidenceResult): UiImage | null {
  const shot = result.row.state?.screenshot;
  if (!shot) return null;
  const webAddress = shot.uri && /^https?:\/\//i.test(shot.uri) ? shot.uri : undefined;
  const { uri: _uri, ...rest } = shot;
  // A live layer has no stored files; an archived one serves them by their key.
  const path = shot.bundleKey && !result.layer.live ? `${layerPath(result.layer)}${encodeKey(shot.bundleKey)}` : undefined;
  return { ...rest, ...(webAddress ? { uri: webAddress } : {}), ...(path ? { path } : {}) };
}

// A layer holds thousands of captures that share one profile and one origin, so each is made once per layer, not once per cell.
const layerProfiles = new WeakMap<LayerHeader, UiProfile>();
const layerOrigins = new WeakMap<LayerHeader, UiOrigin>();

function profileOf(layer: LayerHeader): UiProfile {
  let found = layerProfiles.get(layer);
  if (!found) layerProfiles.set(layer, found = uiProfile(layer));
  return found;
}

function originOf(layer: LayerHeader): UiOrigin {
  let found = layerOrigins.get(layer);
  if (!found) layerOrigins.set(layer, found = makeOrigin(layer));
  return found;
}

function makeOrigin(layer: LayerHeader): UiOrigin {
  return {
    layer: layer.id, backend: layer.backend, producer: layer.producer, recordedAtMs: layer.recordedAtMs, sha: layer.sha, branch: layer.branch, runUrl: layer.runUrl,
    ...(layer.freshness ? { freshness: layer.freshness } : {})
  };
}

function coverageOf(status: EvidenceStatus): UiCoverage {
  return status === 'passed' ? 'captured' : status === 'failed' ? 'failed' : status === 'running' ? 'capturing' : 'skipped';
}

/** The attributes of a state's results: a name's value is the newest result's that declared it. */
function attributesOf(newestFirstResults: readonly EvidenceResult[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const result of newestFirstResults) {
    const given = result.row.state?.attributes;
    if (given) for (const name of Object.keys(given)) if (!(name in out)) out[name] = given[name]!;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => compare(a, b)));
}

/** The newest result first, ties broken by the report contract's own order so no input order shows. */
function newestFirst(a: EvidenceResult, b: EvidenceResult): number {
  return replaces(a, b) ? -1 : replaces(b, a) ? 1 : 0;
}

/** The result `newestFirst` puts first, without ordering the rest. */
function newest(results: readonly EvidenceResult[]): EvidenceResult | undefined {
  let best = results[0];
  for (let i = 1; i < results.length; i++) if (replaces(results[i]!, best!)) best = results[i];
  return best;
}

type Cell = { profile: UiProfile; captures: EvidenceResult[]; plans: EvidenceResult[] };

function facetOf(values: Iterable<readonly string[]>, labels?: ReadonlyMap<string, string>): UiFacetValue[] {
  const counts = new Map<string, number>();
  for (const list of values) for (const value of new Set(list)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count, ...(labels?.get(value) ? { label: labels.get(value)! } : {}) })).sort((a, b) => b.count - a.count || compare(a.value, b.value));
}

/** A state's attributes as the `name=value` texts the `attribute` filter takes. */
function attributePairs(state: Pick<UiCatalogState, 'attributes'>): string[] {
  return Object.entries(state.attributes).map(([name, value]) => `${name}=${value}`);
}

function emptyCoverage(): Record<UiCoverage, number> {
  return { captured: 0, failed: 0, capturing: 0, skipped: 0, missing: 0 };
}

/**
 * The UI catalog of some layers (as the effective report holds them, or any set of {@link LayerEvidence}).
 *
 * Only rows of `ui-state` and `ui-plan` parts take part. The winner of every slot is decided by the report contract
 * (`combineEvidence`), so the result does not depend on the order of `layers` or on how they are divided among backends. A
 * state is the set of cells that share a check `id`; a cell is one profile of it. A cell is `captured` only when the winning
 * capture passed; a plan that nothing has captured is `missing`. When no plan exists nothing is `missing` and nothing is
 * `undeclared`: what is expected is then unknown, and the catalog says so (`summary.planned`).
 *
 * @example
 * ```ts
 * const catalog = uiCatalog(effective.layers, { version: effective.version, backends: effective.backends });
 * catalog.states.map(state => [state.id, state.cells.map(cell => cell.coverage)]);
 * ```
 */
export function uiCatalog(layers: readonly LayerEvidence[], options: UiCatalogOptions = {}): UiCatalog {
  const taking: LayerEvidence[] = [];
  for (const entry of layers) {
    const rows = entry.rows.filter(row => row.kind === UI_STATE_KIND || row.kind === UI_PLAN_KIND);
    if (rows.length) taking.push({ ...entry, rows });
  }
  const winners = combineEvidence({ specs: [], sha: null, changedFiles: [] }, taking).unassigned;
  const planned = winners.some(result => result.row.kind === UI_PLAN_KIND && !result.row.state?.inventory);

  const states = new Map<string, { results: EvidenceResult[]; cells: Map<string, Cell> }>();
  const inventory = new Set<string>();
  for (const result of winners) {
    if (result.row.kind === UI_PLAN_KIND && result.row.state?.inventory) { inventory.add(result.row.id); continue; }
    let state = states.get(result.row.id);
    if (!state) states.set(result.row.id, state = { results: [], cells: new Map() });
    state.results.push(result);
    const profile = profileOf(result.layer);
    let cell = state.cells.get(profile.key);
    if (!cell) state.cells.set(profile.key, cell = { profile, captures: [], plans: [] });
    (result.row.kind === UI_PLAN_KIND ? cell.plans : cell.captures).push(result);
  }

  const profiles = new Map<string, UiProfile>();
  const catalogStates: UiCatalogState[] = [];
  for (const [id, state] of [...states].sort(([a], [b]) => compare(a, b))) {
    const ordered = state.results.length > 1 ? state.results.slice().sort(newestFirst) : state.results;
    const scalar = (pick: (result: EvidenceResult) => string | undefined) => ordered.map(pick).find((value): value is string => value !== undefined) ?? null;
    const union = (pick: (result: EvidenceResult) => readonly string[] | undefined) => [...new Set(ordered.flatMap(result => pick(result) ?? []))].sort(compare);
    const cells: UiCell[] = [...state.cells.values()].sort((a, b) => compare(a.profile.label, b.profile.label) || compare(a.profile.key, b.profile.key)).map(cell => {
      profiles.set(cell.profile.key, cell.profile);
      const best = newest(cell.captures);
      const plan = newest(cell.plans);
      const capture: UiCapture | null = best ? {
        status: best.row.status, detail: best.row.detail, durationMs: best.row.durationMs, image: imageOf(best),
        labels: best.row.evidence?.labels ?? {}, origin: originOf(best.layer), alternatives: cell.captures.length - 1
      } : null;
      return {
        profile: cell.profile,
        coverage: best ? coverageOf(best.row.status) : 'missing',
        expected: plan ? 'declared' : planned ? 'undeclared' : 'unknown',
        capture,
        planned: plan ? { layer: plan.layer.id, backend: plan.layer.backend } : null
      } satisfies UiCell;
    });
    catalogStates.push({
      id, title: ordered[0]?.row.title ?? id,
      route: scalar(result => result.row.state?.route), fixture: scalar(result => result.row.state?.fixture), cohort: scalar(result => result.row.state?.cohort), area: scalar(result => result.row.state?.area), kind: scalar(result => result.row.state?.kind),
      flags: union(result => result.row.state?.flags), covers: union(result => result.row.state?.covers), attributes: attributesOf(ordered),
      producers: [...new Set(ordered.map(result => result.layer.producer))].sort(compare), cells
    });
  }

  const surfaces = new Map<string, { states: number; captured: number }>();
  for (const id of inventory) surfaces.set(id, { states: 0, captured: 0 });
  for (const state of catalogStates) {
    const has = state.cells.some(cell => cell.coverage === 'captured');
    for (const surface of state.covers) {
      const found = surfaces.get(surface) ?? { states: 0, captured: 0 };
      found.states += 1;
      if (has) found.captured += 1;
      surfaces.set(surface, found);
    }
  }
  const surfaceList: UiSurface[] = [...surfaces].sort(([a], [b]) => compare(a, b)).map(([id, found]) => ({
    id, inventoried: inventory.has(id), states: found.states, captured: found.captured,
    status: found.captured > 0 ? 'covered' : found.states > 0 ? 'uncaptured' : 'uncovered'
  }));

  const coverage = emptyCoverage();
  let undeclared = 0, cells = 0;
  for (const state of catalogStates) for (const cell of state.cells) {
    coverage[cell.coverage] += 1;
    cells += 1;
    if (cell.expected === 'undeclared') undeclared += 1;
  }
  const profileList = [...profiles.values()].sort((a, b) => compare(a.label, b.label) || compare(a.key, b.key));
  const labels = new Map(profileList.map(profile => [profile.key, profile.label]));
  return {
    schemaVersion: UI_CATALOG_VERSION,
    ...(options.version ? { version: options.version } : {}),
    summary: { states: catalogStates.length, profiles: profileList.length, cells, coverage, undeclared, planned, surfaces: surfaceList.length, uncoveredSurfaces: surfaceList.filter(surface => surface.status !== 'covered').length },
    profiles: profileList,
    states: catalogStates,
    surfaces: surfaceList,
    facets: {
      profiles: facetOf(catalogStates.map(state => state.cells.map(cell => cell.profile.key)), labels),
      coverage: UI_COVERAGE.map(value => ({ value, count: catalogStates.filter(state => state.cells.some(cell => cell.coverage === value)).length })),
      areas: facetOf(catalogStates.map(state => (state.area ? [state.area] : []))),
      routes: facetOf(catalogStates.map(state => (state.route ? [state.route] : []))),
      cohorts: facetOf(catalogStates.map(state => (state.cohort ? [state.cohort] : []))),
      flags: facetOf(catalogStates.map(state => state.flags)),
      surfaces: facetOf(catalogStates.map(state => state.covers)),
      producers: facetOf(catalogStates.map(state => state.producers)),
      attributes: facetOf(catalogStates.map(state => attributePairs(state)))
    },
    sources: { layers: taking.length, backends: options.backends ?? [], notices: options.notices ?? [] }
  };
}

/** What a person narrows the catalog by. Every field is optional; nothing asked is everything. Values within a field are alternatives, fields combine with AND. */
export type UiCatalogQuery = {
  /** Words (all of them) found in the id, title, route, fixture, cohort, area, flags, surfaces, producers or attribute values. */
  readonly q?: string;
  readonly coverage?: readonly UiCoverage[];
  /** Profile keys, as {@link UiProfile.key}. */
  readonly profile?: readonly string[];
  readonly area?: readonly string[];
  readonly route?: readonly string[];
  readonly cohort?: readonly string[];
  readonly flag?: readonly string[];
  /** Surfaces a state covers. */
  readonly surface?: readonly string[];
  readonly producer?: readonly string[];
  /** `name=value` pairs of the states' `attributes`. Several values of one name are alternatives; different names combine with AND. */
  readonly attribute?: readonly string[];
};

const LIST_FIELDS = ['coverage', 'profile', 'area', 'route', 'cohort', 'flag', 'surface', 'producer', 'attribute'] as const;

/** Reads a query from URL search parameters (`q`, and the comma-separated {@link UiCatalogQuery} lists). Unknown coverage values are left out, never an error. */
export function parseUiCatalogQuery(params: URLSearchParams): UiCatalogQuery {
  const query: Record<string, unknown> = {};
  const q = params.get('q')?.trim();
  if (q) query.q = q;
  for (const name of LIST_FIELDS) {
    const values = params.getAll(name).flatMap(splitList);
    const kept = name === 'coverage' ? values.filter(value => (UI_COVERAGE as readonly string[]).includes(value)) : values;
    if (kept.length) query[name] = kept;
  }
  return query as UiCatalogQuery;
}

/** A query as URL search parameters, the form {@link parseUiCatalogQuery} reads back. */
export function uiCatalogParams(query: UiCatalogQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  for (const name of LIST_FIELDS) { const joined = joinList(query[name] ?? []); if (joined) params.set(name, joined); }
  return params;
}

/** Whether a query narrows anything. */
export function isUiCatalogFiltered(query: UiCatalogQuery): boolean {
  return Boolean(query.q) || LIST_FIELDS.some(name => (query[name]?.length ?? 0) > 0);
}

// A state is searched for words on every keystroke and every request, so its text is made once.
const haystacks = new WeakMap<UiCatalogState, string>();

function haystack(state: UiCatalogState): string {
  let text = haystacks.get(state);
  if (text === undefined) haystacks.set(state, text = [state.id, state.title, state.route, state.fixture, state.cohort, state.area, ...state.flags, ...state.covers, ...state.producers, ...Object.values(state.attributes ?? {})].filter(Boolean).join(' ').toLowerCase());
  return text;
}

/** Whether a state has one of the wanted `name=value` pairs for every name that was asked about. */
function hasAttributes(state: UiCatalogState, wanted: readonly string[] | undefined): boolean {
  if (!wanted?.length) return true;
  const byName = new Map<string, string[]>();
  for (const pair of wanted) {
    const at = pair.indexOf('=');
    if (at <= 0) return false;
    const name = pair.slice(0, at);
    byName.set(name, [...(byName.get(name) ?? []), pair.slice(at + 1)]);
  }
  const have = state.attributes ?? {};
  for (const [name, values] of byName) if (!values.some(value => have[name] === value)) return false;
  return true;
}

/**
 * The part of a catalog a query asks for. A state is kept when it matches the words and the fact filters; its cells are
 * kept when they match the `profile` and `coverage` filters, and a state left with no cell is dropped. The summary is
 * recomputed for what is kept; the profiles, surfaces, facets and sources stay those of the whole catalog, so the
 * controls keep offering every choice.
 */
export function filterUiCatalog(catalog: UiCatalog, query: UiCatalogQuery): UiCatalog {
  if (!isUiCatalogFiltered(query)) return catalog;
  const terms = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const any = (wanted: readonly string[] | undefined, has: (value: string) => boolean) => !wanted?.length || wanted.some(has);
  const states: UiCatalogState[] = [];
  for (const state of catalog.states) {
    if (terms.length) { const text = haystack(state); if (!terms.every(term => text.includes(term))) continue; }
    if (!any(query.area, value => state.area === value) || !any(query.route, value => state.route === value) || !any(query.cohort, value => state.cohort === value)) continue;
    if (!any(query.flag, value => state.flags.includes(value)) || !any(query.surface, value => state.covers.includes(value)) || !any(query.producer, value => state.producers.includes(value))) continue;
    if (!hasAttributes(state, query.attribute)) continue;
    const cells = state.cells.filter(cell => any(query.profile, value => cell.profile.key === value) && any(query.coverage, value => cell.coverage === value));
    if (cells.length) states.push(cells.length === state.cells.length ? state : { ...state, cells });
  }
  const coverage = emptyCoverage();
  let cells = 0, undeclared = 0;
  for (const state of states) for (const cell of state.cells) { coverage[cell.coverage] += 1; cells += 1; if (cell.expected === 'undeclared') undeclared += 1; }
  return { ...catalog, states, summary: { ...catalog.summary, states: states.length, cells, coverage, undeclared } };
}

/** A page of a catalog's states, for a document that would otherwise be large. The summary, facets and sources are the whole catalog's. */
export function pageUiCatalog(catalog: UiCatalog, page: { readonly limit?: number; readonly offset?: number }): UiCatalog & { readonly total: number; readonly offset: number; readonly limit: number } {
  const offset = Math.max(0, page.offset ?? 0);
  const limit = Math.max(0, page.limit ?? 200);
  return { ...catalog, total: catalog.states.length, offset, limit, states: catalog.states.slice(offset, offset + limit) };
}

/**
 * The catalog as Markdown for a person or an agent reading text: the summary in words, the surfaces that are not covered, and
 * one line per state with its coverage in each profile. Only `captured` is called captured.
 */
export function uiCatalogMarkdown(catalog: UiCatalog): string {
  const { summary } = catalog;
  const lines = [
    '# UI catalog', '',
    `${summary.states} states in ${summary.profiles} profiles: ${UI_COVERAGE.map(value => `${summary.coverage[value]} ${value}`).join(', ')}.`,
    summary.planned ? `${summary.undeclared} captured cells are not in any plan.` : 'No plan was published, so what should exist is unknown and nothing is shown as missing.'
  ];
  for (const notice of catalog.sources.notices) lines.push('', `> ${notice}`);
  const open = catalog.surfaces.filter(surface => surface.status !== 'covered');
  if (open.length) lines.push('', '## Surfaces without a captured state', '', ...open.map(surface => `- ${surface.id}: ${surface.status === 'uncovered' ? 'no state covers it' : 'covered by states that are not captured'}`));
  lines.push('', '## States', '');
  for (const state of catalog.states) {
    lines.push(`- **${state.title}** (${state.id})${state.route ? ` ${state.route}` : ''}: ${state.cells.map(cell => `${cell.profile.label} ${cell.coverage}`).join('; ')}`);
  }
  return `${lines.join('\n')}\n`;
}
