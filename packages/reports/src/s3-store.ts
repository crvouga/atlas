/**
 * @module S3 object store
 *
 * An `ObjectStore` on AWS S3 or anything that speaks its protocol (Cloudflare R2, MinIO, SeaweedFS, GCS interoperability,
 * Backblaze B2, Wasabi), written without an SDK: requests are signed with Signature Version 4 and sent with `fetch`, so
 * it runs on Bun and Node. Built for many writers and a long-lived reader: connections are reused, requests in flight
 * are capped, throttling and server errors are retried with jittered backoff, a bucket in another region is followed,
 * and expired credentials are refreshed once. Credentials never come from a URL; they come from options or the
 * environment the way an AWS SDK finds them. Importing the module does no work. Change it only with the S3 integration
 * tests passing against a real server: a fake `fetch` cannot tell you S3 accepts your signature.
 *
 * @see docs/report-contract.md#backends
 * @see docs/deploying.md
 */
import { XMLParser } from 'fast-xml-parser';

import { credentialChain, staticCredentials, type CredentialProvider } from './aws-credentials';
import type { ObjectStore, PagedListing, StoredObject } from './object-store';
import { amzDate, presignUrl, sha256Hex, signRequest, uriEncode, type Credentials } from './sigv4';
import { ObjectStoreWithPrefix } from './store-prefix';

/** How to reach a bucket. Only `bucket` is required. */
export type S3StoreOptions = {
  /** The bucket name. A name containing `.` is addressed path-style. */
  readonly bucket: string;
  /** A folder inside the bucket that holds everything: `atlas/my-project`. */
  readonly prefix?: string;
  /** Default `AWS_REGION`, then `us-east-1`. Cloudflare R2 uses `auto`. */
  readonly region?: string;
  /** For anything that is not AWS: `https://<account>.r2.cloudflarestorage.com`, `http://localhost:9000`. */
  readonly endpoint?: string;
  /** `endpoint/bucket/key` instead of `bucket.endpoint/key`. Default: yes for a custom endpoint, no for AWS. */
  readonly forcePathStyle?: boolean;
  /** Keys, or a provider. Default: the same lookup an AWS SDK does ({@link credentialChain}). */
  readonly credentials?: Credentials | CredentialProvider;
  /** The environment variables to read (`AWS_REGION`, `AWS_ENDPOINT_URL_S3`, credentials, ...). Default: `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The `fetch` to send requests with. Default: the global one; inject a fake in tests. */
  readonly fetch?: typeof fetch;
  /** Attempts after the first for a request that failed in a way worth retrying. Default 4. */
  readonly retries?: number;
  /** For the service to start answering, per attempt, in milliseconds. A large body may take longer. Default 30 000. */
  readonly timeoutMs?: number;
  /** Requests in flight at once. Default 64: S3 answers in tens of milliseconds, so parallelism is what makes a cold start fast. */
  readonly concurrency?: number;
  /** The clock used to sign requests. Default: the system clock; inject in tests. */
  readonly now?: () => Date;
  /** The wait between retries, in milliseconds. Default: a real timer; inject in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
};

/**
 * An error from the store. The message names the bucket and what to do about it (for example the missing IAM
 * permission); `status` and `code` are what the service answered, `null` when it was never reached.
 * `retryable` says whether trying again can help; the store already retried before throwing.
 */
export class S3Error extends Error {
  constructor(message: string, readonly status: number | null, readonly code: string | null, readonly retryable = false) {
    super(message);
    this.name = 'S3Error';
  }
}

let parser: XMLParser | undefined;
/** Built on first use, so importing this module does no work. */
const xml = { parse: (text: string) => (parser ??= new XMLParser({ ignoreAttributes: true, parseTagValue: false, isArray: name => name === 'Contents' || name === 'CommonPrefixes' })).parse(text) };

const RETRYABLE_CODES = new Set(['SlowDown', 'RequestTimeout', 'InternalError', 'ServiceUnavailable', 'RequestTimeTooSkewedRetry', 'Throttling', 'ThrottlingException', 'RequestLimitExceeded']);

function hint(code: string | null, status: number | null, where: string, method = 'GET'): string {
  switch (code) {
    case 'AccessDenied': case 'Forbidden':
      return `${where}: access denied. The credentials need s3:GetObject, s3:PutObject and s3:ListBucket on this bucket and prefix (\`atlas report policy\` prints a least-privilege policy), and the bucket must not forbid them.${method === 'GET' || method === 'HEAD' ? ' Note that S3 also answers 403 for an object that does not exist when s3:ListBucket is not granted.' : ''}`;
    case 'InvalidAccessKeyId':
      return `${where}: the access key id is not known to this service. Check AWS_ACCESS_KEY_ID, and that the endpoint and region belong to the same account.`;
    case 'SignatureDoesNotMatch':
      return `${where}: the signature was rejected. The secret key is wrong, or the region/endpoint is not the one the keys belong to, or the clock is far off.`;
    case 'RequestTimeTooSkewed':
      return `${where}: this machine's clock differs from the service's by more than 15 minutes. Fix the clock.`;
    case 'NoSuchBucket':
      return `${where}: the bucket does not exist (or is in another account or endpoint).`;
    case 'ExpiredToken': case 'InvalidToken':
      return `${where}: the session token expired. Sign in again (\`aws sso login\`) or refresh the role.`;
    default:
      return `${where}: ${code ?? 'HTTP ' + status}`;
  }
}

function parseError(text: string): { code: string | null; message: string | null } {
  try {
    const found = xml.parse(text)?.Error;
    return { code: found?.Code ?? null, message: found?.Message ?? null };
  } catch {
    return { code: null, message: null };
  }
}

class Gate {
  #active = 0;
  #waiting: (() => void)[] = [];
  constructor(readonly limit: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    // A finished request hands its place straight to the next in line, so no newcomer can slip in between.
    if (this.#active >= this.limit) await new Promise<void>(resolve => this.#waiting.push(resolve));
    else this.#active += 1;
    try {
      return await task();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active -= 1;
    }
  }
}

/** An `ObjectStore` on S3 with paged listing, a secret-free label, and diagnostics. */
export type S3Store = ObjectStore & PagedListing & {
  /** A description with no secrets: `s3://bucket/prefix (us-east-1)`. */
  readonly label: string;
  /** Where the credentials came from, once a request has been made. */
  credentialSource(): string | null;
  /** One cheap round trip: can this store be listed? Used by readiness checks and `atlas report doctor`. */
  ping(): Promise<{ readonly ok: boolean; readonly ms: number; readonly error?: string }>;
};

/**
 * An {@link ObjectStore} on S3, or anything that speaks its protocol: Cloudflare R2, MinIO, Google
 * Cloud Storage (interoperability), Backblaze B2, Wasabi, SeaweedFS. No SDK: requests are signed with
 * Signature Version 4 and sent with `fetch`, so it runs on Bun and Node and adds nothing
 * to the install.
 *
 * Made for many writers and a long-lived reader: connections are reused, requests in flight are
 * capped, throttling and server errors are retried with jittered backoff, a bucket in another region
 * is followed, and expired credentials are refreshed once.
 *
 * Behaviour to know: a missing key reads as `null`/`false` only when S3 answers 404. For an account without
 * `s3:ListBucket`, S3 answers 403 for a missing key, which throws `S3Error` with a hint: the publishing credentials
 * need `s3:GetObject`, `s3:PutObject` and `s3:ListBucket` (`atlas report policy` prints a least-privilege policy).
 * `getUri` returns a presigned URL valid for one hour. `deleteMany` sends one request per key, 16 at a time.
 * `listKeys` pages through the whole listing and sorts it; use `listPage` to read part of a large catalog. Nothing is
 * checked or created at construction: the first request is the first contact.
 *
 * @example
 * const store = s3Store({ bucket: 'my-evidence', prefix: 'atlas/my-project', region: 'eu-west-1' });
 * await store.put('layers/manifests/x.json', bytes, 'application/json');
 * const { ok, error } = await store.ping();
 */
export function s3Store(options: S3StoreOptions): S3Store {
  const env = options.env ?? process.env;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const retries = options.retries ?? 4;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const gate = new Gate(options.concurrency ?? 64);
  const provider: CredentialProvider = !options.credentials ? credentialChain({ env, fetch: doFetch })
    : typeof options.credentials === 'function' ? options.credentials : staticCredentials(options.credentials);
  const prefix = (options.prefix ?? '').replace(/^\/+/, '');
  const base = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;
  let region = options.region || env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1';
  const customEndpoint = options.endpoint || env.AWS_ENDPOINT_URL_S3 || env.AWS_ENDPOINT_URL;
  const pathStyle = options.forcePathStyle ?? (Boolean(customEndpoint) || options.bucket.includes('.'));
  const where = `s3://${options.bucket}/${base}`;

  function urlFor(key: string, query: [string, string][] = []): URL {
    const encodedKey = key.split('/').map(segment => uriEncode(segment)).join('/');
    let url: URL;
    if (customEndpoint) {
      url = new URL(customEndpoint);
      url.pathname = `${url.pathname.replace(/\/$/, '')}/${pathStyle ? `${options.bucket}/` : ''}${encodedKey}`;
      if (!pathStyle) url.hostname = `${options.bucket}.${url.hostname}`;
    } else if (pathStyle) {
      url = new URL(`https://s3.${region}.amazonaws.com/${options.bucket}/${encodedKey}`);
    } else {
      url = new URL(`https://${options.bucket}.s3.${region}.amazonaws.com/${encodedKey}`);
    }
    for (const [name, value] of query) url.searchParams.append(name, value);
    return url;
  }

  async function request(method: string, key: string, init: { query?: [string, string][]; body?: Uint8Array; contentType?: string; allow404?: boolean } = {}): Promise<Response | null> {
    let refreshed = false;
    let redirected = false;
    for (let attempt = 0; ; attempt++) {
      const credentials = await provider();
      const url = urlFor(key, init.query);
      const payloadHash = init.body ? await sha256Hex(init.body) : await sha256Hex('');
      // One instant for the date header and the signature, or a request that straddles a second is rejected.
      const at = now();
      const { datetime } = amzDate(at);
      const headers = await signRequest({
        method, url, payloadHash, credentials, region, service: 's3', at,
        headers: { 'x-amz-content-sha256': payloadHash, 'x-amz-date': datetime, ...(credentials.sessionToken ? { 'x-amz-security-token': credentials.sessionToken } : {}) }
      });
      if (init.contentType) headers['content-type'] = init.contentType;
      let response: Response | null = null;
      let failure: S3Error | null = null;
      // The timeout is for the service to answer, not for a large body to arrive: it stops at the headers.
      let timedOut = false;
      try {
        // The clock starts when the request does, not while it waits its turn behind the others.
        response = await gate.run(async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
          try {
            return await doFetch(url, { method, headers, ...(init.body ? { body: init.body as BodyInit } : {}), signal: controller.signal });
          } finally {
            clearTimeout(timer);
          }
        });
      } catch (error) {
        const reason = timedOut ? `timed out after ${timeoutMs}ms` : error instanceof Error ? error.message : String(error);
        failure = new S3Error(`${where}: cannot reach ${url.host} (${reason})`, null, null, true);
      }
      if (response) {
        if (response.ok) return response;
        const text = method === 'HEAD' ? '' : await response.text().catch(() => '');
        const { code, message } = parseError(text);
        // A missing key is an answer. A missing bucket is a mistake, and says so.
        if (response.status === 404 && init.allow404 && code !== 'NoSuchBucket') return null;
        const bucketRegion = response.headers.get('x-amz-bucket-region');
        if (bucketRegion && bucketRegion !== region && !redirected && [301, 307, 400, 403].includes(response.status)) {
          region = bucketRegion;
          redirected = true;
          continue;
        }
        if ((code === 'ExpiredToken' || code === 'InvalidToken' || code === 'ExpiredTokenException') && !refreshed) {
          provider.invalidate();
          refreshed = true;
          continue;
        }
        const retryable = response.status >= 500 || response.status === 429 || response.status === 408 || RETRYABLE_CODES.has(code ?? '');
        failure = new S3Error(`${hint(code, response.status, `${where}${key.slice(base.length)}`, method)}${message && code !== 'AccessDenied' ? ` (${message})` : ''}`, response.status, code, retryable);
      }
      if (!failure || !failure.retryable || attempt >= retries) throw failure!;
      // Exponential backoff with full jitter, capped.
      await sleep(Math.random() * Math.min(8_000, 100 * 2 ** attempt));
    }
  }

  const store: S3Store = {
    label: `s3://${options.bucket}/${base}${customEndpoint ? ` (${new URL(customEndpoint).host})` : ` (${region})`}`,
    credentialSource: () => provider.source(),

    async get(key): Promise<StoredObject | null> {
      const response = await request('GET', base + key, { allow404: true });
      if (!response) return null;
      return { body: response.body ?? new Blob([]).stream(), contentType: response.headers.get('content-type') ?? 'application/octet-stream', size: Number(response.headers.get('content-length') ?? 0) };
    },

    async put(key, bytes, contentType) {
      const response = await request('PUT', base + key, { body: bytes, contentType });
      await response?.arrayBuffer();
    },

    async head(key) {
      const response = await request('HEAD', base + key, { allow404: true });
      return response !== null;
    },

    async delete(key) {
      const response = await request('DELETE', base + key, { allow404: true });
      await response?.arrayBuffer();
    },

    async deleteMany(keys) {
      // One request per key, a few at a time: DeleteObjects needs a checksum Web Crypto cannot make (MD5).
      const queue = [...keys];
      await Promise.all(Array.from({ length: Math.min(16, queue.length) }, async () => {
        for (let key = queue.shift(); key !== undefined; key = queue.shift()) await store.delete(key);
      }));
    },

    async getUri(key) {
      if (!(await store.head(key))) return null;
      return presignUrl({ url: urlFor(base + key), credentials: await provider(), region, service: 's3', at: now(), expiresSeconds: 3600 });
    },

    async listKeys(listPrefix = '') {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const query: [string, string][] = [['list-type', '2'], ['encoding-type', 'url'], ['prefix', base + listPrefix]];
        if (token) query.push(['continuation-token', token]);
        const response = (await request('GET', '', { query }))!;
        const result = xml.parse(await response.text())?.ListBucketResult;
        if (!result) throw new S3Error(`${where}: the listing was not a ListBucketResult`, response.status, null);
        for (const entry of result.Contents ?? []) keys.push(decodeURIComponent(String(entry.Key).replace(/\+/g, ' ')).slice(base.length));
        token = result.IsTruncated === 'true' ? result.NextContinuationToken : undefined;
      } while (token);
      // The contract is code-unit order.
      return keys.sort();
    },

    async listPage(listPrefix = '', options = {}) {
      const limit = Math.max(1, Math.min(options.limit ?? 1000, 1000));
      const query: [string, string][] = [['list-type', '2'], ['encoding-type', 'url'], ['prefix', base + listPrefix], ['max-keys', String(limit)]];
      if (options.after !== undefined) query.push(['start-after', base + options.after]);
      const response = (await request('GET', '', { query }))!;
      const result = xml.parse(await response.text())?.ListBucketResult;
      if (!result) throw new S3Error(`${where}: the listing was not a ListBucketResult`, response.status, null);
      const keys = (result.Contents ?? []).map((entry: { Key: unknown }) => decodeURIComponent(String(entry.Key).replace(/\+/g, ' ')).slice(base.length));
      return { keys, next: result.IsTruncated === 'true' && keys.length ? keys.at(-1)! : null };
    },

    withPrefix(extra) {
      return new ObjectStoreWithPrefix(store, extra);
    },

    async ping() {
      const started = performance.now();
      try {
        await request('GET', '', { query: [['list-type', '2'], ['max-keys', '1'], ['prefix', base]] });
        return { ok: true, ms: Math.round(performance.now() - started) };
      } catch (error) {
        return { ok: false, ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) };
      }
    }
  };
  return store;
}
