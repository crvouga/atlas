/**
 * @module Explorer navigation
 *
 * Changing what the explorer shows is changing the address of `/`: these helpers read and write the explorer's
 * search parameters, keeping the rest of the address (the recorded run picked in the header) as it is.
 */
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';

import { explorerSearch, type ExplorerSearch } from './search';

/** The explorer's search parameters, read from the address. */
export function useExplorerSearch(): ExplorerSearch {
  const raw = useSearch({ strict: false }) as Record<string, unknown>;
  return useMemo(() => explorerSearch(raw), [raw]);
}

/** A change to the explorer's search: fields set to undefined are removed from the address. */
export type ExplorerPatch = { -readonly [K in keyof ExplorerSearch]?: ExplorerSearch[K] | undefined };

/** Returns `go(patch, { replace })`, which moves the explorer to the address with `patch` applied. */
export function useExplorerNavigate() {
  const navigate = useNavigate();
  return (patch: ExplorerPatch, options: { replace?: boolean } = {}) =>
    void navigate({
      to: '/',
      search: ((prev: Record<string, unknown>) => ({ ...prev, ...patch })) as never,
      replace: options.replace ?? false,
      resetScroll: false
    });
}

/** The search of a link that applies `patch` to the current explorer address. */
export function patched(patch: ExplorerPatch) {
  return ((prev: Record<string, unknown>) => ({ ...prev, ...patch })) as never;
}
