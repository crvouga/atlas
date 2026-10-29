/**
 * @module Saved views
 *
 * A saved view is a name for a set of filters on the Runs or Artifacts tab of one project, kept in this browser. It is a
 * live query, not a snapshot: opening it asks again and shows what matches the newest report, so its results change as
 * runs arrive. (An immutable collection of reviewed results is a different thing, and is not what this stores.) Unreadable
 * storage is treated as no saved views, never as an error.
 */
import { FILTER_FIELDS, type ExplorerSearch } from './search';

/** The storage key of the saved views of this browser, all projects. */
export const VIEWS_KEY = 'atlas.savedViews.v1';

/** A saved live query. `filters` holds only the filter fields of the address, as the address writes them. */
export type SavedView = {
  readonly id: string;
  readonly name: string;
  /** The tab it opens on. */
  readonly tab: 'runs' | 'artifacts';
  /** The project it belongs to (the page's `?project=`), or an empty string. */
  readonly project: string;
  readonly filters: Readonly<Record<string, string | true>>;
  readonly savedAtMs: number;
};

/** The filters of an address, ready to save: only the fields that narrow, with their values. */
export function filtersOf(search: ExplorerSearch): Record<string, string | true> {
  const filters: Record<string, string | true> = {};
  for (const field of FILTER_FIELDS) {
    const value = search[field];
    if (value !== undefined) filters[field] = value;
  }
  return filters;
}

/** Whether an address is exactly a saved view's query on its tab (ignoring anything that is not a filter). */
export function isView(view: SavedView, search: ExplorerSearch): boolean {
  if ((search.tab ?? 'tests') !== view.tab) return false;
  const now = filtersOf(search);
  const keys = Object.keys(now);
  return keys.length === Object.keys(view.filters).length && keys.every((key) => now[key] === view.filters[key]);
}

/** The saved views of this browser, oldest first; empty when none or when storage cannot be read. */
export function readViews(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(VIEWS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedView =>
        !!item && typeof item.id === 'string' && typeof item.name === 'string' && (item.tab === 'runs' || item.tab === 'artifacts') && typeof item.project === 'string' && !!item.filters && typeof item.filters === 'object'
    );
  } catch {
    return [];
  }
}

/** Keeps the saved views. Returns false when storage refused them (full, private or unavailable), so the page can say so. */
export function writeViews(views: readonly SavedView[], storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(VIEWS_KEY, JSON.stringify(views));
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
