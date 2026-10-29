/**
 * @module Spooling unsent critiques
 *
 * A critic that has finished judging must not lose its work because the server went away. `spoolingStore` wraps the store
 * a run publishes to: when the server cannot be reached (a network error, a 5xx, a rate limit that did not clear) the
 * objects of the layer are written to a local directory instead of failing, and the next invocation sends them with
 * `flushSpool`, byte for byte what was written, in the order they were written. A layer is content-addressed and the store
 * protocol is idempotent, so sending one that did arrive is harmless and nothing is duplicated. A refusal (401, 403, 409,
 * 413, 422) is not spooled: it will not pass by waiting, and the caller must hear it.
 *
 * What is spooled is only what would have been published (a layer, its files and its catalog entry): never a credential.
 *
 * @see docs/critics.md#when-the-server-goes-away
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AtlasHttpError } from '../../reports/src/http-store';
import type { ObjectStore } from '../../reports/src/object-store';
import { sha256Hex } from '../../reports/src/sigv4';

/** A store that spools what it cannot send. */
export type SpoolingStore = ObjectStore & {
  /** How many objects this store has written to the spool since it was made. */
  readonly spooled: () => number;
};

type SpooledObject = { readonly key: string; readonly contentType: string; readonly base64: string };

/** Whether an error says the server is away or overloaded, as opposed to saying no. */
function isAbsence(error: unknown): boolean {
  return error instanceof AtlasHttpError ? error.retryable || error.status === null : true;
}

async function entries(dir: string): Promise<string[]> {
  try { return (await readdir(dir)).filter(name => name.endsWith('.json')).sort(); } catch { return []; }
}

/** How many objects wait in a spool directory. */
export async function pendingInSpool(dir: string): Promise<number> {
  return (await entries(dir)).length;
}

/**
 * Wraps `inner` so that a `put` that cannot reach the server is written to `dir` instead of throwing. After the first such
 * failure the rest of the run goes straight to the spool (it does not wait through every retry again), and `head` answers
 * "not there". Reads are not spooled. A refusal from the server still throws.
 *
 * @param inner the store a run publishes to.
 * @param dir the spool directory; created when first needed.
 */
export function spoolingStore(inner: ObjectStore, dir: string): SpoolingStore {
  let away = false;
  let count = 0;
  let sequence: Promise<number> | undefined;
  const next = async () => {
    sequence ??= entries(dir).then(names => (names.length ? Number.parseInt(names[names.length - 1]!.split('-')[0]!, 10) + 1 : 1));
    const value = await sequence;
    sequence = Promise.resolve(value + 1);
    return value;
  };
  async function spool(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const id = (await sha256Hex(key)).slice(0, 16);
    // The same object spooled twice is one file: nothing is duplicated.
    if ((await entries(dir)).some(name => name.endsWith(`-${id}.json`))) return;
    const name = `${String(await next()).padStart(8, '0')}-${id}.json`;
    const body: SpooledObject = { key, contentType, base64: Buffer.from(bytes).toString('base64') };
    await writeFile(path.join(dir, `${name}.tmp`), JSON.stringify(body), { mode: 0o600 });
    await rename(path.join(dir, `${name}.tmp`), path.join(dir, name));
    count += 1;
  }
  const store: SpoolingStore = {
    spooled: () => count,
    get: key => inner.get(key),
    async put(key, bytes, contentType) {
      if (!away) {
        try { await inner.put(key, bytes, contentType); return; } catch (error) {
          if (!isAbsence(error)) throw error;
          away = true;
        }
      }
      await spool(key, bytes, contentType);
    },
    async head(key) {
      if (away) return false;
      try { return await inner.head(key); } catch (error) {
        if (!isAbsence(error)) throw error;
        away = true;
        return false;
      }
    },
    delete: key => inner.delete(key),
    deleteMany: keys => inner.deleteMany(keys),
    getUri: key => inner.getUri(key),
    listKeys: prefix => inner.listKeys(prefix),
    withPrefix: prefix => inner.withPrefix(prefix)
  };
  return store;
}

/** What {@link flushSpool} did. */
export type SpoolFlush = {
  /** Objects sent and removed from the spool. */
  readonly sent: number;
  /** Objects still waiting (the server is still away, or refused one). */
  readonly remaining: number;
  /** Why sending stopped, with no credential in it; absent when everything was sent. */
  readonly error?: string;
};

/**
 * Sends what an earlier run could not, in the order it was written, and removes each object once the server has it. Stops at the
 * first failure and leaves the rest, so the order a layer needs (its files, then the layer, then its catalog entry) is kept. A
 * spool that is empty or missing is not an error.
 */
export async function flushSpool(inner: ObjectStore, dir: string): Promise<SpoolFlush> {
  const names = await entries(dir);
  let sent = 0;
  for (const name of names) {
    let item: SpooledObject;
    try { item = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as SpooledObject; } catch {
      return { sent, remaining: names.length - sent, error: `The spooled file ${name} cannot be read; it was left in place` };
    }
    try {
      await inner.put(item.key, Uint8Array.from(Buffer.from(item.base64, 'base64')), item.contentType);
    } catch (error) {
      return { sent, remaining: names.length - sent, error: error instanceof Error ? error.message : String(error) };
    }
    await rm(path.join(dir, name), { force: true });
    sent += 1;
  }
  return { sent, remaining: 0 };
}
