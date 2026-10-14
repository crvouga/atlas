/**
 * @module Reading and writing whole objects
 *
 * Small helpers over `ObjectStore` for the common case of an object read or written whole: draining a stream,
 * decoding UTF-8, and encoding text for `put`. They hold the object in memory, so they are for manifests, catalog
 * entries and bounded blobs, not for large files. Errors from the store are not caught.
 */
import type { ObjectStore } from './object-store';

/** Drains a stream into one byte array (it reads the stream to its end; it holds every chunk in memory). */
export async function readBytes(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value !== undefined) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Reads an object as UTF-8 text, or `null` when the key is missing. Invalid UTF-8 is decoded leniently (replacement characters), not rejected. Transport errors throw. */
export async function readUtf8(
  store: ObjectStore,
  key: string
): Promise<string | null> {
  const obj = await store.get(key);
  if (obj === null) return null;
  const bytes = await readBytes(obj.body);
  return new TextDecoder().decode(bytes);
}

/** Writes UTF-8 text under `key` with the given content type (default `text/plain; charset=utf-8`). Overwrites; transport errors throw. */
export async function writeUtf8(
  store: ObjectStore,
  key: string,
  text: string,
  contentType = 'text/plain; charset=utf-8'
): Promise<void> {
  await store.put(key, new TextEncoder().encode(text), contentType);
}

/** Reads an object's bytes whole, or `null` when the key is missing. Transport errors throw. */
export async function readObjectBytes(
  store: ObjectStore,
  key: string
): Promise<Uint8Array | null> {
  const obj = await store.get(key);
  if (obj === null) return null;
  return readBytes(obj.body);
}
