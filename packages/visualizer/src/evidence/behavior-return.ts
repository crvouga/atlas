/**
 * @module Returning from the read-and-watch workspace
 *
 * Opening a behavior in the dedicated workspace replaces the index, so the index would come back at the top with
 * nothing selected. The scope (the search words and the coverage filter) and the selection are in the address and come
 * back by themselves. What an address cannot hold is where the reader had scrolled to, how much of a long list had been
 * shown, and which row had focus: they are remembered here for the session, against the scope they were taken in, and
 * given back once, only to the same scope.
 */

const KEY = 'atlas-behaviors-return';

/** What the index remembers when it is left for the workspace. */
export type ReturnPoint = {
  /** The scope the point was taken in ({@link scopeKey}); it is only used for that scope. */
  readonly scope: string;
  /** How far the page was scrolled, in pixels. */
  readonly scrollY: number;
  /** How many rows of the list had been shown. */
  readonly shown: number;
  /** The behavior whose row had focus, or null. */
  readonly focus: string | null;
};

/** The scope of an index: its search words and its coverage filter. */
export function scopeKey(search: { readonly q?: string | undefined; readonly coverage?: string | undefined }): string {
  return JSON.stringify([search.q ?? '', search.coverage ?? '']);
}

/** Remembers where the reader was. Storage that is unavailable or full only means nothing is restored. */
export function rememberReturn(point: ReturnPoint): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(point));
  } catch {
    // Not being able to remember means the list opens at its top.
  }
}

/** The remembered point, if it was taken in `scope`; a point of another scope is never used. Reading does not forget it. */
export function recallReturn(scope: string): ReturnPoint | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const point = JSON.parse(raw) as Partial<ReturnPoint>;
    if (point.scope !== scope || typeof point.scrollY !== 'number' || typeof point.shown !== 'number') return null;
    return { scope, scrollY: point.scrollY, shown: point.shown, focus: typeof point.focus === 'string' ? point.focus : null };
  } catch {
    return null;
  }
}

/** Forgets the remembered point, once it has been given back. */
export function forgetReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was remembered.
  }
}
