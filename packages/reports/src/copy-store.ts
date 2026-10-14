import { eachLimited } from './completion-order';
import { readBytes } from './object-io';
import type { ObjectStore } from './object-store';

const INDEX = 'layers/index/';

/**
 * Copy every layer object (`layers/…`) of `from` that `to` does not have. Only layers: they are
 * immutable, so an object that exists is already right. Commit-keyed legacy objects are mutable and
 * are left where they are. This is how partial reports meet: each CI
 * node publishes into its own store, and copying them together is the aggregate, because layers are
 * immutable, addressed by content, and never share a key with different bytes. It is idempotent,
 * commutative and safe to repeat after a failure.
 *
 * A layer's catalog entry is copied last, so a reader of `to` never sees an entry for a layer
 * whose content has not arrived.
 */
export async function copyStore(from: ObjectStore, to: ObjectStore, options: { readonly concurrency?: number } = {}): Promise<{ readonly copied: number; readonly skipped: number }> {
  const keys = await from.listKeys('layers/');
  const width = options.concurrency ?? 16;
  let copied = 0, skipped = 0;
  const copy = async (key: string) => {
    if (await to.head(key)) { skipped += 1; return; }
    const stored = await from.get(key);
    if (!stored) return;
    await to.put(key, await readBytes(stored.body), stored.contentType);
    copied += 1;
  };
  await eachLimited(keys.filter(key => !key.startsWith(INDEX)), width, copy);
  await eachLimited(keys.filter(key => key.startsWith(INDEX)), width, copy);
  return { copied, skipped };
}
