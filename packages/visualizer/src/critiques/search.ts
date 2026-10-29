/**
 * @module Needs-polish address
 *
 * What the needs-polish page shows is in the address of the `/critiques` route, so a link reproduces the view: the critic whose
 * scores rank the list, the kind of UI state, and the entry opened. Anything unreadable is dropped, never an error.
 */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { z } from 'zod/v4';

const text = z
  .preprocess((value) => (typeof value === 'number' || typeof value === 'boolean' ? String(value) : value), z.string().min(1))
  .optional()
  .catch(undefined);

/** The `/critiques` route's search: the critic, the state kind and the open entry (an entry key). */
export const CritiqueSearchFields = { critic: text, kind: text, entry: text };

/** The address's parts, as the router holds them. */
export type CritiqueSearch = { readonly [K in keyof typeof CritiqueSearchFields]?: string | undefined };

/** The needs-polish parameters, read from the address. */
export function useCritiqueSearch(): CritiqueSearch {
  const raw = useSearch({ strict: false }) as Record<string, unknown>;
  return useMemo(() => {
    const search: Record<string, string> = {};
    for (const name of Object.keys(CritiqueSearchFields)) {
      const value = raw[name];
      if (typeof value === 'string' && value) search[name] = value;
      else if (typeof value === 'number') search[name] = String(value);
    }
    return search;
  }, [raw]);
}

/** Returns `go(patch)`, which moves the page to the address with `patch` applied (fields set to undefined are removed). */
export function useCritiqueNavigate() {
  const navigate = useNavigate();
  return (patch: CritiqueSearch, options: { replace?: boolean } = {}) =>
    void navigate({ to: '/critiques', search: ((prev: Record<string, unknown>) => ({ ...prev, ...patch })) as never, replace: options.replace ?? false, resetScroll: false });
}
