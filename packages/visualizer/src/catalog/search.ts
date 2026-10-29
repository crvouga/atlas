/**
 * @module UI catalog address
 *
 * Everything the UI catalog shows is in the address of the `/catalog` route, so a link reproduces the view: the words searched,
 * the filters, the open state and an open comparison (`compare`, `from`, `to`). Filters take comma-separated values (a comma or backslash inside a value is written `\,` or
 * `\\`), the same form `GET /api/reports/ui-catalog` takes. Anything unreadable is dropped, never an error.
 */
import { parseUiCatalogQuery, uiCatalogParams, type UiCatalogQuery } from '@crvouga/atlas/reports/ui-catalog';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { z } from 'zod/v4';

/** A search value as text: the router reads `123` as a number and `["a"]` as an array, both of which are meant as text here. */
const text = z
  .preprocess((value) => (typeof value === 'number' || typeof value === 'boolean' ? String(value) : value !== null && typeof value === 'object' ? JSON.stringify(value) : value), z.string().min(1))
  .optional()
  .catch(undefined);

/** The `/catalog` route's search: the query of `GET /api/reports/ui-catalog` and the state opened. */
export const CatalogSearchFields = {
  q: text,
  coverage: text,
  profile: text,
  area: text,
  route: text,
  cohort: text,
  flag: text,
  surface: text,
  producer: text,
  /** `name=value` pairs of the attributes a producer declared. */
  attribute: text,
  /** The open state: a state id. */
  state: text,
  /** A comparison is open: `commit` (two commits of the same profiles) or `profile` (two profiles of this report). */
  compare: text,
  /** The comparison's before side: a commit id, or a profile key. */
  from: text,
  /** The comparison's after side. */
  to: text,
  /** `1` shows the pairs that did not change too. */
  all: text
};

/** The parts of the address that are not filters of the catalog's states. */
const NOT_FILTERS = ['state', 'compare', 'from', 'to', 'all'];

/** The address's parts, as the router holds them. */
export type CatalogSearch = { readonly [K in keyof typeof CatalogSearchFields]?: string | undefined };

/** The query an address asks for. */
export function catalogQueryOf(search: CatalogSearch): UiCatalogQuery {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(search)) if (!NOT_FILTERS.includes(name) && typeof value === 'string') params.set(name, value);
  return parseUiCatalogQuery(params);
}

/** The address parts of a query, with the opened state kept as given. */
export function catalogSearchOf(query: UiCatalogQuery, state?: string): CatalogSearch {
  return { ...Object.fromEntries(uiCatalogParams(query)), ...(state ? { state } : {}) };
}

/** The catalog's search parameters, read from the address. */
export function useCatalogSearch(): { readonly search: CatalogSearch; readonly query: UiCatalogQuery } {
  const raw = useSearch({ strict: false }) as Record<string, unknown>;
  return useMemo(() => {
    const search: Record<string, string> = {};
    for (const name of Object.keys(CatalogSearchFields)) {
      const value = raw[name];
      if (typeof value === 'string' && value) search[name] = value;
      else if (typeof value === 'number') search[name] = String(value);
    }
    return { search, query: catalogQueryOf(search) };
  }, [raw]);
}

/** Returns `go(patch)`, which moves the catalog to the address with `patch` applied (fields set to undefined are removed). */
export function useCatalogNavigate() {
  const navigate = useNavigate();
  return (patch: CatalogSearch, options: { replace?: boolean } = {}) =>
    void navigate({ to: '/catalog', search: ((prev: Record<string, unknown>) => ({ ...prev, ...patch })) as never, replace: options.replace ?? false, resetScroll: false });
}
