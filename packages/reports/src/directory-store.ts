import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ObjectStore, StoredObject } from './object-store';
import { ObjectStoreWithPrefix } from './store-prefix';

const TYPE_SUFFIX = '.content-type';
const TEMP_PREFIX = '.tmp-';

function rejectKey(key: string): void {
  const parts = key.split('/');
  const last = parts.at(-1) ?? '';
  if (key.length === 0 || key.startsWith('/') || key.includes('\\') || parts.some((part) => part.length === 0 || part === '.' || part === '..') || last.endsWith(TYPE_SUFFIX) || last.startsWith(TEMP_PREFIX)) {
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
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

let counter = 0;

/** Write beside the target and rename into place: a reader sees the whole object or none of it. */
async function writeAtomically(file: string, bytes: Uint8Array | string): Promise<void> {
  const temporary = path.join(path.dirname(file), `${TEMP_PREFIX}${process.pid}-${Date.now().toString(36)}-${(counter += 1).toString(36)}`);
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * An {@link ObjectStore} on a directory: one file per key, its content type in a sidecar file. The
 * backend for a CI workspace, a downloaded artifact or a laptop. Writes are atomic, listing reads
 * only the directories a prefix can reach, and two stores over copies of the same layers can be
 * merged with `cp -R` because layers are immutable and addressed by content.
 */
export function directoryStore(root: string): ObjectStore {
  const store: ObjectStore = {
    async get(key): Promise<StoredObject | null> {
      const file = fileOf(root, key);
      try {
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
      // The type first: an object is never visible without it.
      await writeAtomically(file + TYPE_SUFFIX, contentType);
      await writeAtomically(file, bytes);
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
      const file = fileOf(root, key);
      await rm(file, { force: true });
      await rm(file + TYPE_SUFFIX, { force: true });
    },
    async deleteMany(keys) {
      for (const key of keys) await store.delete(key);
    },
    async getUri(key) {
      return (await store.head(key)) ? pathToFileURL(fileOf(root, key)).href : null;
    },
    async listKeys(prefix = '') {
      const rootPath = path.resolve(root);
      const found: string[] = [];
      const walk = async (dir: string) => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (error) {
          if (missing(error)) return;
          throw error;
        }
        await Promise.all(entries.map(async (entry) => {
          if (entry.name.startsWith(TEMP_PREFIX) || entry.name.endsWith(TYPE_SUFFIX)) return;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) return walk(full);
          if (!entry.isFile()) return;
          const key = path.relative(rootPath, full).split(path.sep).join('/');
          if (key.startsWith(prefix)) found.push(key);
        }));
      };
      // Only the directory a prefix names can hold its keys.
      const slash = prefix.lastIndexOf('/');
      if (prefix.startsWith('/') || prefix.includes('\\') || prefix.split('/').some((part) => part === '..')) throw new Error(`Invalid object store prefix: ${prefix}`);
      await walk(slash < 0 ? rootPath : path.resolve(rootPath, prefix.slice(0, slash)));
      return found.sort();
    },
    withPrefix(prefix) {
      return new ObjectStoreWithPrefix(store, prefix);
    }
  };
  return store;
}
