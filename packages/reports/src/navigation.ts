/**
 * @module Explorer navigation host
 *
 * The seam between a reports explorer and the page it is embedded in: where the address (hash), keyboard and title
 * live. It is a type only; a host (usually the browser) supplies the implementation, which keeps the explorer free of
 * `window` and testable.
 */

/** Host navigation and keyboard events, scoped to one reports explorer. */
export type ReportNavigation = {
  /** The current location hash, as the host holds it, with or without the leading `#` (the route parser accepts both). */
  readonly readHash: () => string;
  /** Sets the hash (given with its leading `#`, like `#/test/<id>`); `replace` true replaces the current history entry instead of adding one. */
  readonly writeHash: (hash: string, replace: boolean) => void;
  /** Calls `listener` whenever the hash changes; returns the function that stops listening. */
  readonly subscribeHash: (listener: () => void) => () => void;
  /** Calls `listener` for keyboard events scoped to this explorer; returns the function that stops listening. */
  readonly subscribeKeys: (
    listener: (event: KeyboardEvent) => void
  ) => () => void;
  /** Sets the page title. */
  readonly setTitle: (title: string) => void;
};
