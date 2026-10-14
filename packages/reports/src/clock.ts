/**
 * @module Injectable time
 *
 * The two time dependencies of the reports code, as types, so tests and simulations can supply virtual time.
 * Production hosts pass `{ now: Date.now }` and wrappers over the global timers (see `host.ts`). There is no
 * default implementation in this module.
 */

/** The clock a reader or route uses to decide when polling or tailing has run long enough. */
export type Clock = {
  /** Epoch milliseconds (virtual or wall). */
  readonly now: () => number;
};

/** The timer functions the reports code schedules work with; each handle is opaque and only passed back to the matching `clear*`. */
export type Timers = {
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly setInterval: (fn: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};
