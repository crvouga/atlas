/**
 * @module Per-attempt publication scope
 *
 * Lets concurrent CI attempts for one commit publish without overwriting each other: a store view that redirects the
 * commit-local keys (`commits/<sha>/...`) into `attempts/<publicationId>/`, while immutable shared content
 * (the spec inventory and spec bodies, blobs, layers) stays where it is. `reportStore` finds the right view for a
 * commit from the pointer `openCommit` leaves.
 */

import { readUtf8 } from './object-io';
import { ObjectStoreWithPrefix } from './store-prefix';
import type { ObjectStore } from './object-store';
import { commitKey } from './keys';
import type { CommitRecord } from './protocol';

/**
 * A view of `store` for one CI attempt: keys under `commits/` go to `attempts/<publicationId>/commits/...`, except
 * `commits/<sha>/inventory.json` and `commits/<sha>/specs/...`, which stay shared; all other keys are unchanged.
 * Listing a `commits/` prefix lists only the attempt's own copies, with the `attempts/<id>/` part removed.
 *
 * Throws `Invalid report publication id` unless `publicationId` is letters, digits, `.`, `_`, `:` or `-` and is not
 * `.` or `..`, so an id can never address another key.
 */
export function publicationStore(
  store: ObjectStore,
  publicationId: string
): ObjectStore {
  if (
    !/^[a-zA-Z0-9._:-]+$/.test(publicationId) ||
    publicationId === '.' ||
    publicationId === '..'
  )
    throw new Error('Invalid report publication id');
  const root = `attempts/${publicationId}/`;
  const keyOf = (key: string) =>
    key.startsWith('commits/') && !/^commits\/[^/]+\/(?:inventory\.json$|specs\/)/.test(key) ? root + key : key;
  const scoped: ObjectStore = {
    get: (key) => store.get(keyOf(key)),
    head: (key) => store.head(keyOf(key)),
    put: (key, bytes, type) => store.put(keyOf(key), bytes, type),
    delete: (key) => store.delete(keyOf(key)),
    deleteMany: (keys) => store.deleteMany(keys.map(keyOf)),
    getUri: (key) => store.getUri(keyOf(key)),
    async listKeys(prefix = '') {
      const keys = await store.listKeys(keyOf(prefix));
      return keys.map((key) =>
        key.startsWith(root) ? key.slice(root.length) : key
      );
    },
    withPrefix: (prefix) => new ObjectStoreWithPrefix(scoped, prefix),
  };
  return scoped;
}

/**
 * The store view to read a commit's records from: the attempt-scoped view when the commit's `commit.json` is a
 * pointer `{ "publicationId": ... }` (written by `openCommit` when given a `publicationId`), otherwise `store`
 * itself, also when the commit has no record. Throws if `commit.json` is not JSON.
 */
export async function reportStore(
  store: ObjectStore,
  sha: string
): Promise<ObjectStore> {
  const text = await readUtf8(store, commitKey(sha));
  if (text === null) return store;
  const stored = JSON.parse(text) as CommitRecord | { publicationId: string };
  return 'publicationId' in stored
    ? publicationStore(store, stored.publicationId)
    : store;
}
