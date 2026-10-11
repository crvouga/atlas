import type { ObjectStore, StoredObject } from '@crvouga/atlas-reports/object-store';
import { ObjectStoreWithPrefix } from '@crvouga/atlas-reports/store-prefix';

/** An in-memory store for tests, with a switch that makes every read fail like an unreachable service. */
export function memoryStore(): ObjectStore & { down: boolean; lists: number } {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const store: ObjectStore & { down: boolean; lists: number } = {
    down: false,
    lists: 0,
    async get(key): Promise<StoredObject | null> {
      if (store.down) throw new Error('store unavailable');
      const found = objects.get(key);
      if (!found) return null;
      return { body: new Blob([new Uint8Array(found.bytes)]).stream(), contentType: found.contentType, size: found.bytes.length };
    },
    async put(key, bytes, contentType) {
      objects.set(key, { bytes: new Uint8Array(bytes), contentType });
    },
    async head(key) {
      if (store.down) throw new Error('store unavailable');
      return objects.has(key);
    },
    async delete(key) {
      objects.delete(key);
    },
    async deleteMany(keys) {
      for (const key of keys) objects.delete(key);
    },
    async getUri() {
      return null;
    },
    async listKeys(prefix = '') {
      if (store.down) throw new Error('store unavailable');
      store.lists += 1;
      return [...objects.keys()].filter(key => key.startsWith(prefix)).sort();
    },
    withPrefix(prefix) {
      return new ObjectStoreWithPrefix(store, prefix);
    },
  };
  return store;
}

export function testClock(start = 1_000_000) {
  const clock = { at: start, now: () => clock.at };
  const timers = { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} };
  return { clock, timers };
}
