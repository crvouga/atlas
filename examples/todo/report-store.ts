import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ObjectStore, StoredObject } from '@crvouga/atlas/reports/object-store';
import { ObjectStoreWithPrefix } from '@crvouga/atlas/reports/store-prefix';

const TYPE_SUFFIX = '.content-type';

function rejectKey(key: string): void {
  const parts = key.split('/');
  if (key.length === 0 || key.startsWith('/') || key.includes('\\') || parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error(`Invalid object store key: ${key}`);
  }
}

function fileOf(root: string, key: string): string {
  rejectKey(key);
  const rootPath = path.resolve(root);
  const file = path.resolve(rootPath, key);
  if (file !== rootPath && !file.startsWith(rootPath + path.sep)) throw new Error(`Invalid object store key: ${key}`);
  return file;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** A directory of one file per key, with the content type beside it. Enough for the example's report layer. */
export function directoryStore(root: string): ObjectStore {
  const store: ObjectStore = {
    async get(key): Promise<StoredObject | null> {
      try {
        const file = fileOf(root, key);
        const bytes = new Uint8Array(await readFile(file));
        const contentType = await readFile(file + TYPE_SUFFIX, 'utf8').catch(() => 'application/octet-stream');
        return {
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            }
          }),
          contentType: contentType.trim() || 'application/octet-stream',
          size: bytes.byteLength
        };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async put(key, bytes, contentType) {
      const file = fileOf(root, key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
      await writeFile(file + TYPE_SUFFIX, contentType);
    },
    async head(key) {
      try {
        return (await stat(fileOf(root, key))).isFile();
      } catch (error) {
        if (missing(error)) return false;
        throw error;
      }
    },
    async delete(key) {
      await rm(fileOf(root, key), { force: true });
      await rm(fileOf(root, key) + TYPE_SUFFIX, { force: true });
    },
    async deleteMany(keys) {
      for (const key of keys) await store.delete(key);
    },
    async getUri(key) {
      return (await store.head(key)) ? pathToFileURL(fileOf(root, key)).href : null;
    },
    async listKeys(prefix = '') {
      const found: string[] = [];
      const walk = async (dir: string) => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (error) {
          if (missing(error)) return;
          throw error;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (entry.isFile() && !entry.name.endsWith(TYPE_SUFFIX)) {
            const key = path.relative(root, full).split(path.sep).join('/');
            if (key.startsWith(prefix)) found.push(key);
          }
        }
      };
      await walk(path.resolve(root));
      return found.sort();
    },
    withPrefix(prefix) {
      return new ObjectStoreWithPrefix(store, prefix);
    }
  };
  return store;
}

export async function emptyDirectory(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
}
