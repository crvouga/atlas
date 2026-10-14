/**
 * @module ObjectStore interface
 *
 * The one interface a backend implements: seven async methods over keys and bytes, with no transactions, renames,
 * locks or conditional writes. That is what lets a directory, an S3-compatible bucket, an HTTP server and a device
 * lab hold the same report. Implementations here are `directoryStore`, `s3Store` and `httpStore`; `verifyObjectStore`
 * proves a new one. This interface is part of the stable report contract.
 *
 * Read semantics: `get` returns `null` when the key is missing; transport and parse errors throw. `head` returns
 * `false` for a missing key and never throws on "not found".
 *
 * Write semantics: `put` is idempotent (writing a key twice overwrites without error) and the stored `contentType`
 * round-trips through `get`. `delete` and `deleteMany` on a missing key are no-ops.
 *
 * URI semantics: `getUri` returns a URL the host can load directly (a `file://` URL for a directory, a presigned URL
 * for S3), or `null` for a missing key or a store with no addressable URL.
 *
 * Listing: `listKeys` returns keys in sorted code-unit order, optionally only those starting with `prefix`.
 *
 * @see docs/report-contract.md#backends
 */

/** An object read from a store: a one-shot byte stream with its media type and length. */
export interface StoredObject {
  /** Stream of stored bytes. Single-use; consume or discard before issuing more I/O on the same store. */
  readonly body: ReadableStream<Uint8Array>;
  /** The media type the object was written with. */
  readonly contentType: string;
  /** The length of the object in bytes. */
  readonly size: number;
}

/** A place that holds objects by key: the backend interface of the report contract. Keys are `/`-separated strings; see each method for its rules. */
export interface ObjectStore {
  /** Returns the stored object, or `null` if no value exists for `key`. */
  get(key: string): Promise<StoredObject | null>;

  /** Idempotently writes `bytes` under `key` with the given `contentType`. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;

  /** `true` iff a value exists for `key`. Never throws on "not found". */
  head(key: string): Promise<boolean>;

  /** Removes the value at `key` if present. No-op when missing. */
  delete(key: string): Promise<void>;

  /** Remove every key, idempotently. Errors (including partial failure) throw. */
  deleteMany(keys: readonly string[]): Promise<void>;

  /**
   * Returns a URL that the host runtime can load directly without reading bytes
   * through {@link ObjectStore.get} again. Returns `null` for missing keys, and
   * `null` for stores whose backend has no addressable URL (e.g. R2).
   */
  getUri(key: string): Promise<string | null>;

  /**
   * Returns keys present in the store, sorted by code-unit order.
   * When `prefix` is set, only keys that start with it are returned.
   */
  listKeys(prefix?: string): Promise<readonly string[]>;

  /**
   * Returns a new store scoped to `prefix`. Caller keys are relative (must not
   * include the prefix). All I/O operates on `prefix + key`. Nested calls compose
   * prefixes (`a/` + `b/` → `a/b/`).
   */
  withPrefix(prefix: string): ObjectStore;
}

/**
 * Optional, beyond the seven methods: list one page of keys, starting after a key. A reader that has
 * already seen most of a catalog uses it to find what is new without listing all of it. A store without
 * it works the same, a little slower. Pages are in the same code-unit order as {@link ObjectStore.listKeys}.
 */
export interface PagedListing {
  listPage(prefix: string, options?: { readonly after?: string; readonly limit?: number }): Promise<{ readonly keys: readonly string[]; /** The `after` for the next page, or null on the last. */ readonly next: string | null }>;
}

/** Whether a store also implements `PagedListing`. */
export function isPaged(store: ObjectStore): store is ObjectStore & PagedListing {
  return typeof (store as Partial<PagedListing>).listPage === 'function';
}
