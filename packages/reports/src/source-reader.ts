/**
 * @module Reading a source's files
 *
 * Chooses how to read the files of one source of a commit: through its bundle index when it has one, otherwise as
 * individual objects (stores written before bundles existed stay readable).
 */
import type { ObjectStore } from './object-store';
import type { BundleEntry } from './bundle';
import { bundleIndexKey, createBundleReader, readBundleIndex } from './bundle';

/**
 * Returns a function that reads one file of a source by key, resolving to its bytes and media type or `null` when it is
 * absent. Reads through the bundle index at `commits/<sha>/bundles/<source>.json` when that has entries, otherwise reads
 * the key directly from `store`. Throws when the index is present but not JSON.
 */
export async function sourceReader(
  store: ObjectStore,
  args: { sha: string; source: string }
) {
  const index = await readBundleIndex(
    store,
    bundleIndexKey(args.sha, args.source)
  );
  if (Object.keys(index).length > 0) return createBundleReader(store, index);
  // Existing stored reports remain readable while writers use bundles.
  return async (key: string): Promise<BundleEntry | null> => {
    const obj = await store.get(key);
    return obj === null
      ? null
      : {
          key,
          contentType: obj.contentType,
          bytes: new Uint8Array(await new Response(obj.body).arrayBuffer()),
        };
  };
}
