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
  readonly load: (testId: string) => void;
  readonly ensureBlob?: (testId: string, file: string) => void;
  readonly state: (testId: string) => TestLoad;
};

