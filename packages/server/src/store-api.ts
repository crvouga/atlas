import { Hono, type Context } from 'hono';

import { isPaged, type ObjectStore } from '../../reports/src/object-store';
import { readBytes } from '../../reports/src/object-io';
import type { Auth } from './auth';
import { classify, isCatalog, Refusal, sameBytes, validateUpload, validKey } from './validate';

export type StoreApiOptions = {
  readonly store: ObjectStore;
  readonly auth: Auth;
  readonly maxObjectBytes: number;
  /** Told after something was uploaded: its key, and what kind of thing it is. */
  readonly onStored: (key: string, kind: string) => void | Promise<void>;
};

/** Read a request body, refusing as soon as it is over the limit rather than after holding it all. */
export async function readLimited(request: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > limit) throw new Refusal(413, `That is ${declared} bytes; the limit is ${limit}`);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Refusal(413, `The body is over the limit of ${limit} bytes`); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}

const decode = (c: Context, prefix: string): string | null => {
  try { return decodeURIComponent(new URL(c.req.url).pathname.slice(prefix.length)); } catch { return null; }
};

/**
 * The store protocol: the seven operations of an object store over HTTP, for what the server keeps. A client
 * that publishes to it uses the same code that publishes to a folder or a bucket. It differs from a bucket in
 * that the server checks what it is given, keeps layers immutable, and tells every viewer when something lands.
 *
 *   GET    /api/store?prefix=&after=&limit=   a page of keys, in order
 *   GET    /api/store/<key>                   the object
 *   HEAD   /api/store/<key>                   does it exist
 *   PUT    /api/store/<key>                   upload it (publish token, Bearer)
 *   DELETE /api/store/<key>                   remove a scratch object (publish token, Bearer)
 */
/** A plain relative path: no traversal, no backslash, no control characters. */
const safePath = (value: string) => value.length > 0 && value.length <= 1024 && !value.startsWith('/') && !value.includes('\\') && !/[\u0000-\u001f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');

export function storeApi(options: StoreApiOptions) {
  const app = new Hono();
  const { store, auth } = options;
  const refuse = (c: Context, status: number, message: string) => c.json({ error: message }, status as 400);

  app.get('/', async c => {
    const verdict = auth.check(c.req.raw, 'read');
    if (!verdict.ok) return refuse(c, verdict.status, verdict.message);
    // Only layers/ is listed: the whole store may hold other things.
    const prefix = c.req.query('prefix') || 'layers/';
    const after = c.req.query('after');
    const limit = Math.max(1, Math.min(Number(c.req.query('limit') ?? 1000) || 1000, 1000));
    const named = prefix.replace(/\/$/, '');
    if (prefix !== 'layers/' && !validKey(named)) {
      // Older layouts keep things outside layers/. A server holds none of them: nothing there, not an error.
      if (safePath(named)) return c.json({ keys: [], next: null });
      return refuse(c, 422, 'Not a prefix Atlas holds');
    }
    if (isPaged(store)) return c.json(await store.listPage(prefix, { ...(after === undefined ? {} : { after }), limit }));
    const all = (await store.listKeys(prefix)).filter(key => after === undefined || key > after);
    return c.json({ keys: all.slice(0, limit), next: all.length > limit ? all[limit - 1]! : null });
  });

  const key = (c: Context) => decode(c, '/api/store/');

  app.on(['GET', 'HEAD'], '/*', async c => {
    const verdict = auth.check(c.req.raw, 'read');
    if (!verdict.ok) return refuse(c, verdict.status, verdict.message);
    const name = key(c);
    if (name === null || !validKey(name)) {
      if (name !== null && safePath(name)) return new Response(c.req.method === 'HEAD' ? null : JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
      return refuse(c, 422, 'Not a key Atlas holds');
    }
    const stored = await store.get(name);
    if (!stored) return new Response(c.req.method === 'HEAD' ? null : JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    // Everything under layers/ is immutable, so it may be kept for good.
    const headers = { 'content-type': stored.contentType, 'cache-control': 'public, max-age=31536000, immutable', ...(stored.size ? { 'content-length': String(stored.size) } : {}) };
    if (c.req.method === 'HEAD') { await stored.body.cancel(); return new Response(null, { headers }); }
    return new Response(stored.body, { headers });
  });

  app.put('/*', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return refuse(c, verdict.status, verdict.message);
    const name = key(c);
    if (name === null || !validKey(name)) return refuse(c, 422, 'Not a key Atlas holds');
    try {
      const bytes = await readLimited(c.req.raw, options.maxObjectBytes);
      const kind = await validateUpload(name, bytes, store);
      const present = await sameBytes(store, name, bytes);
      // Scratch objects may be overwritten (an object store's contract says writing a key twice is fine); layers may not.
      if (present === 'different' && kind !== 'scratch') throw new Refusal(409, `${name} already exists with other content. Layers are immutable: publish a new one.`);
      if (present !== 'same') await store.put(name, bytes, c.req.header('content-type') ?? 'application/octet-stream');
      // Catalog entries make a layer, spec set or run visible, so everyone is told only once they are in.
      if (present === 'absent' || isCatalog(kind)) await options.onStored(name, kind);
      return c.json({ ok: true, key: name, kind, created: present === 'absent' }, present === 'absent' ? 201 : 200);
    } catch (error) {
      if (error instanceof Refusal) return refuse(c, error.status, error.message);
      throw error;
    }
  });

  app.delete('/*', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return refuse(c, verdict.status, verdict.message);
    const name = key(c);
    // Nothing a report is made of can be taken away. Only what `atlas report doctor` writes to try the store.
    if (name === null || classify(name)?.kind !== 'scratch') return refuse(c, 403, 'Layers, specs and runs are never removed through the API');
    await store.delete(name);
    return c.body(null, 204);
  });

  return app;
}

export { readBytes };
