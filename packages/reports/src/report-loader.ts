/**
 * @module Test loading state
 *
 * The state of loading one recorded test into the viewer, and the interface a report gives the viewer to load tests on
 * demand. Types only.
 */

/** Where loading a test is: `ready`, `loading` (with how many frame files have arrived and how many there are, when known), `missing`, or `error` with a message to show. */
export type TestLoad =
  | { readonly kind: 'ready' }
  | {
      readonly kind: 'loading';
      readonly frames: number;
      readonly framesTotal: number | null;
    }
  | { readonly kind: 'missing' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Loads a test's steps on first view, then individual frame files as the
 * scrubber reaches them. Absent when every test arrives with its frames
 * (a standalone HTML file).
 */
export type ReportTestLoader = {
  /** Starts loading a test's timeline if it has not started (or failed before). Returns at once. */
  readonly load: (testId: string) => void;
  /** Starts fetching one frame file of a test if it is not held or already being fetched. */
  readonly ensureBlob?: (testId: string, file: string) => void;
  /** The current load state of a test; reactive where the host is. */
  readonly state: (testId: string) => TestLoad;
};

