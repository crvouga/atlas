/**
 * @module Prefix-scoped object store
 *
 * A decorator that makes a store look like it starts at a key prefix: callers use short keys, the shared bucket stays
 * partitioned by prefix, and prefixes compose. It guards the keys it is given (no leading `/`, no `..`) so a scoped
 * store cannot reach outside its prefix by key.
 */
import type { ObjectStore, PagedListing, StoredObject } from './object-store';
import { assertLogicalObjectKey } from './namespace-guard';

/** Returns `prefix` with exactly one trailing `/` added when missing. Throws `ObjectStoreWithPrefix: prefix must be non-empty` for an empty prefix. */
export function normalizeObjectStorePrefix(prefix: string): string {
  if (prefix.length === 0) {
    throw new Error('ObjectStoreWithPrefix: prefix must be non-empty');
  }
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function joinObjectStorePrefixes(left: string, right: string): string {
  return normalizeObjectStorePrefix(
    `${left}${normalizeObjectStorePrefix(right)}`
  );
}

/**
 * Decorator that scopes every {@link ObjectStore} operation to a fixed key
 * prefix. Used at composition roots (e.g. API bindings) so feature code uses
 * logical keys while a shared bucket stays partitioned by prefix.
 *
 * Keys passed to `get`, `put`, `head`, `delete`, `deleteMany`, `getUri` are checked (`assertLogicalObjectKey`: not
 * empty, no leading `/`, no `..`) and throw otherwise. The `prefix` argument of `listKeys` and `listPage` is not
 * checked here; the store underneath is responsible for it. Returned keys have the prefix removed.
 */
export class ObjectStoreWithPrefix implements ObjectStore {
  private readonly prefix: string;

  constructor(
    private readonly inner: ObjectStore,
    prefix: string
  ) {
    this.prefix = normalizeObjectStorePrefix(prefix);
    const paged = (inner as Partial<PagedListing>).listPage;
    if (paged) {
      this.listPage = async (listPrefix, options = {}) => {
        const page = await paged.call(inner, `${this.prefix}${listPrefix}`, { ...options, ...(options.after === undefined ? {} : { after: `${this.prefix}${options.after}` }) });
        return { keys: page.keys.map(key => key.slice(this.prefix.length)), next: page.next === null ? null : page.next.slice(this.prefix.length) };
      };
    }
  }

  private scopedKey(key: string): string {
    assertLogicalObjectKey(key);
    return `${this.prefix}${key}`;
  }

  /** Reads `prefix + key` from the underlying store; `null` when missing. Throws for an invalid key. */
  get(key: string): Promise<StoredObject | null> {
    return this.inner.get(this.scopedKey(key));
  }

  /** Writes `prefix + key` in the underlying store. Throws for an invalid key. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    return this.inner.put(this.scopedKey(key), bytes, contentType);
  }

  /** Whether `prefix + key` exists in the underlying store. Throws for an invalid key. */
  head(key: string): Promise<boolean> {
    return this.inner.head(this.scopedKey(key));
  }

  /** Removes `prefix + key`; a no-op when missing. Throws for an invalid key. */
  delete(key: string): Promise<void> {
    return this.inner.delete(this.scopedKey(key));
  }

  /** Removes every `prefix + key`. Throws for an invalid key, before deleting any. */
  deleteMany(keys: readonly string[]): Promise<void> {
    return this.inner.deleteMany(keys.map((key) => this.scopedKey(key)));
  }

  /** The underlying store's URL for `prefix + key`, or `null`. Throws for an invalid key. */
  getUri(key: string): Promise<string | null> {
    return this.inner.getUri(this.scopedKey(key));
  }

  /** Lists keys under `prefix` (relative to this store's prefix) in the underlying store's order, with this store's prefix removed. */
  async listKeys(prefix = ''): Promise<readonly string[]> {
    const scopedPrefix = `${this.prefix}${prefix}`;
    const keys = await this.inner.listKeys(scopedPrefix);
    return keys.map((k) => k.slice(this.prefix.length));
  }

  /** Paged listing with this store's prefix removed from keys and from `next`; present only when the store underneath has `listPage`. */
  listPage?: (prefix: string, options?: { readonly after?: string; readonly limit?: number }) => Promise<{ readonly keys: readonly string[]; readonly next: string | null }>;

  /** A store scoped to this prefix followed by `subPrefix`, over the same underlying store (`a/` then `b/` is `a/b/`). */
  withPrefix(subPrefix: string): ObjectStore {
    return new ObjectStoreWithPrefix(
      this.inner,
      joinObjectStorePrefixes(this.prefix, subPrefix)
    );
  }
}
