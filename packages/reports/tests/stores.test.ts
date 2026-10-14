import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { directoryStore } from '../src/directory-store';
import { verifyObjectStore } from '../src/object-store-conformance';
import { readUtf8, writeUtf8 } from '../src/object-io';
import { memoryStore } from './memory-store';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function scratch() { const root = await mkdtemp(path.join(tmpdir(), 'atlas-store-')); roots.push(root); return root; }

test('the in-memory store meets the contract', async () => {
  expect(await verifyObjectStore(memoryStore())).toEqual({ ok: true, failures: [] });
});

test('the directory store meets the contract and leaves nothing behind', async () => {
  const root = await scratch();
  expect(await verifyObjectStore(directoryStore(root))).toEqual({ ok: true, failures: [] });
  expect((await directoryStore(root).listKeys()).length).toBe(0);
});

test('a verification fails a backend that breaks the contract', async () => {
  const broken = { ...memoryStore(), async head() { return true; } };
  const result = await verifyObjectStore(broken);
  expect(result.ok).toBe(false);
  expect(result.failures).toContain('head returns false for a missing key');
});

test('directory store keys cannot leave the directory or collide with its bookkeeping', async () => {
  const store = directoryStore(await scratch());
  for (const key of ['../x', 'a/../../x', '/abs', 'a//b', 'a/.', 'a\\b', 'x.content-type', 'a/.tmp-1']) await expect(store.put(key, new Uint8Array(), 'text/plain')).rejects.toThrow('Invalid object store key');
  for (const prefix of ['../', '/etc', 'a/../..', 'a\\b']) await expect(store.listKeys(prefix)).rejects.toThrow('Invalid object store prefix');
});

test('concurrent writers of one key never leave a partial object or a stray temporary file', async () => {
  const root = await scratch();
  const store = directoryStore(root);
  const big = (fill: string) => fill.repeat(200_000);
  await Promise.all(['a', 'b', 'c', 'd'].map(fill => writeUtf8(store, 'layers/x.json', big(fill), 'application/json')));
  const value = (await readUtf8(store, 'layers/x.json'))!;
  expect(value.length).toBe(200_000);
  expect(new Set(value).size).toBe(1);
  expect((await readdir(path.join(root, 'layers'))).sort()).toEqual(['x.json', 'x.json.content-type']);
});
