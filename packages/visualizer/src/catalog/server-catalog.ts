/**
 * @module UI catalog through a server
 *
 * How the catalog page reads the catalog when a server can answer for it (the page config's `catalogIndex`), instead of
 * reading every result of the report and composing the catalog in the browser: a first small page of the index (the summary,
 * facets and the first states, enough to draw at once), then the whole index, which is compact (no pictures, origins or
 * plans), then, as results arrive, only what changed since the version held (`?since=`). The evidence a card draws is read
 * for the states on screen only, by id. Search, filters and sorting run in the browser over the whole index, so they mean
 * exactly what they mean over a composed catalog.
 *
 * Plain functions over a `read` of the reports API, so the request budget can be measured without a browser.
 */
import { joinList } from '@crvouga/atlas/reports/artifact-query';
import type { UiCatalog, UiCatalogState, UiCell } from '@crvouga/atlas/reports/ui-catalog';
import { applyUiCatalogIndexDelta, uiCatalogIndexOf, type UiCatalogIndex } from '@crvouga/atlas/reports/ui-catalog-index';

/** Reads a path of the reports API (`/ui-catalog?…`) as JSON. */
export type ReadReports = (path: string, signal?: AbortSignal) => Promise<unknown>;

/** How many states the first page carries: the first screen of cards, and the summary. */
export const FIRST_PAGE = 48;
/** How many states' evidence is read in one request: the cards one "Show more" adds. */
export const STATES_PER_READ = 24;
/** A limit no catalog reaches: "every state", for a server that pages by default. */
const ALL = 1_000_000;

/** An answer as an index: a server that predates `view=index` answers with the full document, which is projected here. */
function asIndex(answer: unknown): UiCatalogIndex {
  const document = answer as UiCatalogIndex | (UiCatalog & { total?: number; offset?: number; limit?: number });
  return 'view' in document && document.view === 'index' ? document : uiCatalogIndexOf(document as UiCatalog);
}

/** The first page of the index: enough to draw the first cards and the whole catalog's summary and facets. */
export async function readFirstIndexPage(read: ReadReports, signal?: AbortSignal): Promise<UiCatalogIndex> {
  return asIndex(await read(`/ui-catalog?view=index&limit=${FIRST_PAGE}`, signal));
}

/**
 * The whole index. Holding one, only what changed since its version is asked for; a server that no longer remembers that
 * version (or predates `since`) answers with everything, which then replaces what was held.
 */
export async function readIndex(read: ReadReports, held: UiCatalogIndex | undefined, signal?: AbortSignal): Promise<UiCatalogIndex> {
  if (!held?.version) return asIndex(await read(`/ui-catalog?view=index&limit=${ALL}`, signal));
  const answer = asIndex(await read(`/ui-catalog?view=index&limit=${ALL}&since=${encodeURIComponent(held.version)}`, signal));
  return applyUiCatalogIndexDelta(held, answer);
}

/** The full documents of some states, by id: what their cards and the open state draw. */
export async function readStates(read: ReadReports, ids: readonly string[], signal?: AbortSignal): Promise<ReadonlyMap<string, UiCatalogState>> {
  const answer = (await read(`/ui-catalog?${new URLSearchParams({ id: joinList(ids) ?? '', limit: String(ids.length) })}`, signal)) as UiCatalog;
  return new Map(answer.states.map(state => [state.id, state]));
}

/**
 * A state as a card draws it: the facts and the cells the page shows (filtered, or projected onto a definition), with each
 * cell's evidence taken from the state's full document. A cell the full document does not have is kept as it is.
 */
export function withEvidence(state: UiCatalogState, full: UiCatalogState | undefined): UiCatalogState {
  if (!full || full === state) return state;
  const cells = new Map<string, UiCell>(full.cells.map(cell => [cell.profile.key, cell]));
  return { ...full, ...state, cells: state.cells.map(cell => cells.get(cell.profile.key) ?? cell) };
}

/**
 * The full document of a catalog held as an index (for a download): the server's whole catalog, narrowed to the states and
 * cells the index shows, in its order, with the index's summary. One request, made only when asked for.
 */
export async function readFullCatalog(read: ReadReports, shown: UiCatalog, signal?: AbortSignal): Promise<UiCatalog> {
  const whole = (await read(`/ui-catalog?limit=${ALL}`, signal)) as UiCatalog;
  const full = new Map(whole.states.map(state => [state.id, state]));
  return { ...shown, states: shown.states.map(state => withEvidence(state, full.get(state.id))) };
}
