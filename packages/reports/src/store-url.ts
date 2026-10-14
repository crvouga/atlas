import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BackendInput } from './compose';
import { directoryStore } from './directory-store';
import type { ObjectStore } from './object-store';
import { httpStore, type HttpStore } from './http-store';
import { s3Store, type S3Store } from './s3-store';

type Env = Readonly<Record<string, string | undefined>>;

export type StoreLocation =
  | { readonly kind: 'directory'; readonly directory: string }
  | { readonly kind: 's3'; readonly bucket: string; readonly prefix: string; readonly region?: string; readonly endpoint?: string; readonly pathStyle?: boolean }
  /** An Atlas server: uploads go to it, and it shows everyone the combined report. */
  | { readonly kind: 'server'; readonly url: string };

export type OpenedStore = {
  readonly store: ObjectStore;
  /** What to show people: no credentials, ever. */
  readonly label: string;
  readonly location: StoreLocation;
  /** The S3 handle, for credential source and ping. */
  readonly s3?: S3Store;
  /** The server handle, for ping. */
  readonly server?: HttpStore;
};

/**
 * Where a store is, from one string:
 *
 * - `./atlas-reports`, `/srv/atlas`, `file:///srv/atlas`: a directory.
 * - `s3://bucket/prefix`: S3. Add `?region=eu-west-1`, `?endpoint=https://…` for R2, MinIO and the
 *   rest, `?pathStyle=1`. Keys are never in the URL: they come from the environment (see
 *   `credentialChain`).
 * - `r2://bucket/prefix?account=<id>` (Cloudflare R2) and `gs://bucket/prefix` (Google Cloud Storage with
 *   HMAC keys): the same store with the endpoint filled in. Atlas does not test against these two.
 */
export function parseStoreLocation(spec: string, base: string, env: Env = {}): StoreLocation {
  // Shorthands for two services that speak S3's protocol, so there is no endpoint to look up.
  const shorthand = /^(r2|gs):\/\/(.*)$/i.exec(spec);
  if (shorthand) {
    const kind = shorthand[1]!.toLowerCase();
    const url = new URL(`s3://${shorthand[2]}`);
    const account = url.searchParams.get('account') ?? env.R2_ACCOUNT_ID ?? env.CLOUDFLARE_ACCOUNT_ID;
    if (kind === 'r2' && !account) throw new Error('An r2:// store needs the Cloudflare account id: r2://bucket/folder?account=<id>, or set R2_ACCOUNT_ID');
    url.searchParams.delete('account');
    url.searchParams.set('endpoint', kind === 'r2' ? `https://${account}.r2.cloudflarestorage.com` : 'https://storage.googleapis.com');
    if (!url.searchParams.has('region')) url.searchParams.set('region', 'auto');
    return parseStoreLocation(url.toString(), base, env);
  }
  if (/^s3:\/\//i.test(spec)) {
    const url = new URL(spec);
    const bucket = decodeURIComponent(url.hostname);
    if (!bucket) throw new Error(`"${spec}" names no bucket. Write s3://<bucket>/<folder>`);
    if (url.username || url.password) throw new Error('Keys do not belong in a store URL: put them in AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (or ATLAS_S3_*), or sign in with `aws sso login`.');
    const prefix = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');
    const region = url.searchParams.get('region') ?? undefined;
    const endpoint = url.searchParams.get('endpoint') ?? undefined;
    const pathStyle = url.searchParams.get('pathStyle');
    return { kind: 's3', bucket, prefix, ...(region ? { region } : {}), ...(endpoint ? { endpoint } : {}), ...(pathStyle ? { pathStyle: pathStyle !== '0' && pathStyle !== 'false' } : {}) };
  }
  if (/^https?:\/\//i.test(spec)) {
    const url = new URL(spec);
    if (url.username || url.password) throw new Error('A token does not belong in a server URL: set ATLAS_TOKEN.');
    return { kind: 'server', url: `${url.origin}${url.pathname.replace(/\/+$/, '')}` };
  }
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(spec) && !/^file:\/\//i.test(spec)) throw new Error(`Unsupported store "${spec}". Use a directory, an Atlas server (https://…), s3://bucket/prefix, r2://bucket/prefix?account=<id> or gs://bucket/prefix`);
  return { kind: 'directory', directory: /^file:\/\//i.test(spec) ? fileURLToPath(spec) : path.resolve(base, spec) };
}

export function openStore(spec: string, options: { readonly base: string; readonly env?: Env; readonly fetch?: typeof fetch }): OpenedStore {
  const location = parseStoreLocation(spec, options.base, options.env ?? {});
  if (location.kind === 'directory') return { store: directoryStore(location.directory), label: location.directory, location };
  if (location.kind === 'server') {
    const env = options.env ?? {};
    const server = httpStore({ url: location.url, ...(serverToken(env) ? { token: serverToken(env)! } : {}), ...(options.fetch ? { fetch: options.fetch } : {}) });
    return { store: server, label: server.label, location, server };
  }
  const s3 = s3Store({
    bucket: location.bucket,
    prefix: location.prefix,
    ...(location.region ? { region: location.region } : {}),
    ...(location.endpoint ? { endpoint: location.endpoint } : {}),
    ...(location.pathStyle !== undefined ? { forcePathStyle: location.pathStyle } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {})
  });
  return { store: s3, label: s3.label, location, s3 };
}

/** The token a client sends to an Atlas server: `ATLAS_TOKEN`, or the first line of the file `ATLAS_TOKEN_FILE` names. */
export function serverToken(env: Env, readFile: (file: string) => string | null = file => { try { return readFileSync(file, 'utf8'); } catch { return null; } }): string | null {
  if (env.ATLAS_TOKEN) return env.ATLAS_TOKEN.trim();
  if (env.ATLAS_TOKEN_FILE) return readFile(env.ATLAS_TOKEN_FILE)?.split('\n')[0]?.trim() || null;
  return null;
}

/** A short id for a store, unique among the given ones: `my-bucket-ci`, `reports`. */
export function storeId(location: StoreLocation, taken: ReadonlySet<string>): string {
  const raw = location.kind === 's3' ? [location.bucket, location.prefix].filter(Boolean).join('-') : location.kind === 'server' ? new URL(location.url).host : path.basename(location.directory);
  const base = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'store';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** `--store` values, or `ATLAS_STORE` when there are none: one store, or several separated by commas or new lines (a folder may have spaces in its name). */
export function storeSpecs(flags: readonly string[], env: Env): string[] {
  if (flags.length) return [...flags];
  return (env.ATLAS_STORE ?? '').split(/[\n,]+/).map(spec => spec.trim()).filter(Boolean);
}

/** `id=url` or a bare url, opened and given a unique id. */
export function openBackends(specs: readonly string[], options: { readonly base: string; readonly env?: Env; readonly fetch?: typeof fetch; readonly mustExist?: boolean }): (BackendInput & OpenedStore)[] {
  const taken = new Set<string>();
  const named = specs.map(spec => /^([a-z0-9-]+)=(.+)$/.exec(spec)).flatMap(match => (match ? [match[1]!] : []));
  for (const id of named) {
    if (taken.has(id)) throw new Error(`Two stores are named "${id}"`);
    taken.add(id);
  }
  return specs.map(spec => {
    const match = /^([a-z0-9-]+)=(.+)$/.exec(spec);
    const opened = openStore(match ? match[2]! : spec, options);
    const id = match ? match[1]! : storeId(opened.location, taken);
    taken.add(id);
    return { ...opened, id, label: match ? id : opened.location.kind === 'directory' ? path.basename(opened.location.directory) : opened.label };
  });
}
