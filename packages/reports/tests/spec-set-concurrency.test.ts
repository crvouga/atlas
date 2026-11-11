import { describe, expect, it } from 'bun:test';

import { publishSpecSet, readSpecSet } from '../src/spec-set';
import { memoryStore } from './memory-store';


describe('publishSpecSet under concurrent publishers (#106)', () => {
  const input = { files: [{ path: 'example.feature', text: 'Feature: Example\n' }], branch: 'dev', sha: 'a'.repeat(40), recordedAtMs: 1_800_000_000_000 };

  it('accepts a set another publisher wrote first with a different recorded time', async () => {
    const objects = new Map<string, Uint8Array>();
    let racing = true;
    const store = memoryStore();
    store.head = async key => (racing ? false : objects.has(key));
    const put = store.put.bind(store);
    store.put = async (key, bytes, contentType) => {
      const held = objects.get(key);
      if (held && Buffer.compare(Buffer.from(held), Buffer.from(bytes)) !== 0) throw new Error(`409 immutable conflict: ${key}`);
      objects.set(key, new Uint8Array(bytes));
      await put(key, bytes, contentType);
    };
    const first = await publishSpecSet(store, input);
    // Both publishers saw HEAD=false; the second one's set write meets the winner's different bytes.
    const second = await publishSpecSet(store, { ...input, recordedAtMs: input.recordedAtMs + 1000 });
    racing = false;
    expect(second.id).toBe(first.id);
    expect((await readSpecSet(store, first.id))?.id).toBe(first.id);
    // Both catalog entries exist, each naming the one set.
    expect((await store.listKeys('layers/specs/index/')).length).toBe(2);
  });

  it('still rejects when the set write fails and no set was stored', async () => {
    const store = memoryStore();
    const put = store.put.bind(store);
    store.put = async (key, bytes, contentType) => {
      if (key.startsWith('layers/specs/sets/')) throw new Error('503 unavailable');
      await put(key, bytes, contentType);
    };
    await expect(publishSpecSet(store, input)).rejects.toThrow('503 unavailable');
  });
});
