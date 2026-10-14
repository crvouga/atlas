/**
 * @module Copying layers between stores
 *
 * `copyStore` copies the layers one store has and another lacks: how partial reports meet (each CI node publishes to its own
 * store; copying them together is the aggregate). It is idempotent, commutative and safe to repeat, because layers are
 * immutable and named by their content, and it writes in dependency order (files, then documents, then catalog entries) so a
 * reader of the destination, or a server that checks, never sees something before what it names.
 *
 * @see docs/report-contract.md
 */

import { eachLimited } from './completion-order';
import { readBytes } from './object-io';
import type { ObjectStore } from './object-store';

/**
 * What is copied after what it names, so a reader (or a server that checks) never sees one without its content:
 * files first, then the documents that name files (a layer's manifest, a spec set, a run's manifest), then the
 * catalog entries that make a document visible.
 */
const isCatalog = (key: string) => key.includes('/index/');
const isDocument = (key: string) => /^layers\/(manifests\/|specs\/sets\/|runs\/[^/]+\/manifest\.json$)/.test(key);

/**
 * Copy every layer object (`layers/…`) of `from` that `to` does not have. Only layers: they are
 * immutable, so an object that exists is already right. Commit-keyed legacy objects are mutable and
 * are left where they are. This is how partial reports meet: each CI
 * node publishes into its own store, and copying them together is the aggregate, because layers are
 * immutable, addressed by content, and never share a key with different bytes. It is idempotent,
 * commutative and safe to repeat after a failure.
 *
 * A layer's catalog entry is copied last, and its manifest after its files, so a reader of `to` never sees an
 * entry for a layer whose content has not arrived.
 */
export async function copyStore(from: ObjectStore, to: ObjectStore, options: { readonly concurrency?: number } = {}): Promise<{ readonly copied: number; readonly skipped: number; readonly ignored: number }> {
  const everything = await from.listKeys();
  const keys = everything.filter(key => key.startsWith('layers/'));
  const width = options.concurrency ?? 16;
  let copied = 0, skipped = 0;
  const copy = async (key: string) => {
    if (await to.head(key)) { skipped += 1; return; }
    const stored = await from.get(key);
    if (!stored) return;
    await to.put(key, await readBytes(stored.body), stored.contentType);
    copied += 1;
  };
  await eachLimited(keys.filter(key => !isCatalog(key) && !isDocument(key)), width, copy);
  await eachLimited(keys.filter(key => !isCatalog(key) && isDocument(key)), width, copy);
  await eachLimited(keys.filter(isCatalog), width, copy);
  // Said, not silent: whatever is not a layer was left where it is.
  return { copied, skipped, ignored: everything.length - keys.length };
}
