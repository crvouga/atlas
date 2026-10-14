/**
 * @module ObjectStore conformance check
 *
 * Runs the `ObjectStore` contract against any implementation, so a new backend (GCS, an HTTP service, a device lab) can
 * prove it composes with the others before it holds evidence. It is a plain async function with no test-runner
 * dependency. It writes only under a scratch prefix and removes what it wrote.
 *
 * @see docs/report-contract.md#backends
 */
import { readBytes } from './object-io';
import type { ObjectStore } from './object-store';

/** The outcome of `verifyObjectStore`: `ok` is true exactly when `failures` is empty. */
export type StoreVerification = { readonly ok: boolean; readonly failures: readonly string[] };

const text = (value: string) => new TextEncoder().encode(value);

/**
 * Checks a backend against the {@link ObjectStore} contract before trusting it with evidence. It
 * writes a few objects under a scratch prefix and removes them. Use it in the test suite of an S3,
 * GCS, R2 or HTTP adapter; an adapter that passes composes with every other backend.
 *
 * It is a plain async function, so it runs under any test runner and from a script. It checks: a missing key reads
 * `null` (`get`, `getUri`) and `false` (`head`); `put` overwrites and round-trips bytes, size and content type;
 * `listKeys` is in code-unit order, filters by any string prefix and is empty for an unused one; `withPrefix` scopes
 * reads and writes; `delete` and `deleteMany` accept missing keys. A failed expectation is reported in `failures`;
 * an exception from the store is reported as one `threw: ...` failure rather than thrown. It does not check
 * `listPage`.
 *
 * @param store the backend to verify.
 * @param scratch the key prefix to write under; defaults to a random `atlas-conformance-<id>/`. If you pass one,
 * nothing else may live under it: the check asserts that `listKeys(scratch)` returns exactly the four objects it wrote.
 *
 * @example
 * const { ok, failures } = await verifyObjectStore(myStore);
 * if (!ok) throw new Error(failures.join('\n'));
 */
export async function verifyObjectStore(store: ObjectStore, scratch = `atlas-conformance-${Math.random().toString(36).slice(2, 10)}/`): Promise<StoreVerification> {
  const failures: string[] = [];
  const expect = (ok: boolean, message: string) => { if (!ok) failures.push(message); };
  const key = (name: string) => `${scratch}${name}`;
  const created: string[] = [];
  try {
    expect((await store.get(key('missing'))) === null, 'get returns null for a missing key');
    expect((await store.head(key('missing'))) === false, 'head returns false for a missing key');
    expect((await store.getUri(key('missing'))) === null, 'getUri returns null for a missing key');
    await store.delete(key('missing'));

    const payload = new Uint8Array([0, 1, 2, 254, 255]);
    created.push(key('a/b.json'));
    await store.put(key('a/b.json'), payload, 'application/json');
    await store.put(key('a/b.json'), payload, 'application/json');
    const stored = await store.get(key('a/b.json'));
    expect(stored !== null, 'a written key can be read');
    if (stored) {
      expect(stored.contentType.startsWith('application/json'), 'the content type round-trips');
      const bytes = await readBytes(stored.body);
      expect(bytes.length === payload.length && payload.every((byte, i) => bytes[i] === byte), 'bytes round-trip exactly');
      expect(stored.size === payload.length, 'size is the byte length');
    }
    expect(await store.head(key('a/b.json')), 'head is true for a written key');

    await store.put(key('a/b.json'), text('{}'), 'application/json');
    const replaced = await store.get(key('a/b.json'));
    expect(replaced !== null && (await readBytes(replaced.body)).length === 2, 'put overwrites the same key');

    for (const name of ['a/c.json', 'a/d/e.json', 'z.json']) { created.push(key(name)); await store.put(key(name), text(name), 'text/plain'); }
    const all = await store.listKeys(scratch);
    expect(JSON.stringify(all) === JSON.stringify([...all].sort()), 'listKeys is sorted by code unit');
    expect(all.length === 4, 'listKeys lists every key under the prefix, nothing else');
    const nested = await store.listKeys(key('a/'));
    expect(nested.length === 3 && nested.every((name) => name.startsWith(key('a/'))), 'listKeys filters by prefix, including across directories');
    expect((await store.listKeys(key('a/c'))).length === 1, 'a prefix need not end at a separator');
    expect((await store.listKeys(key('nothing/'))).length === 0, 'listKeys is empty for an unused prefix');

    const scoped = store.withPrefix(scratch);
    expect((await scoped.listKeys()).length === 4 && (await scoped.listKeys())[0] === 'a/b.json', 'withPrefix scopes keys, which are relative to it');
    await scoped.put('scoped.json', text('s'), 'text/plain');
    created.push(key('scoped.json'));
    expect(await store.head(key('scoped.json')), 'a write through withPrefix lands under the prefix');

    await store.delete(key('z.json'));
    expect(!(await store.head(key('z.json'))), 'delete removes a key');
    await store.deleteMany([key('a/c.json'), key('a/d/e.json'), key('missing-too')]);
    expect(!(await store.head(key('a/c.json'))) && !(await store.head(key('a/d/e.json'))), 'deleteMany removes keys, missing ones included');
  } catch (error) {
    failures.push(`threw: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await store.deleteMany(created).catch(() => {});
  }
  return { ok: failures.length === 0, failures };
}
