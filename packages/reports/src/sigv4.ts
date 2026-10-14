/**
 * AWS Signature Version 4, with Web Crypto only, so it runs unchanged on Bun, Node and in a Worker.
 * S3 and every store that speaks its protocol (R2, MinIO, GCS interoperability, B2, Wasabi) sign this way.
 */

export type Credentials = {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  /** Epoch milliseconds after which these stop working. Absent for long-lived keys. */
  readonly expiresAtMs?: number;
};

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

async function hmac(key: ArrayBuffer | Uint8Array | string, data: string): Promise<ArrayBuffer> {
  const raw = typeof key === 'string' ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, encoder.encode(data));
}

/** RFC 3986 percent-encoding, which is what SigV4 asks for: unreserved characters stay, everything else is %XX. */
export function uriEncode(value: string, keepSlash = false): string {
  let out = '';
  for (const byte of encoder.encode(value)) {
    const char = String.fromCharCode(byte);
    if ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || char === '-' || char === '_' || char === '.' || char === '~' || (keepSlash && char === '/')) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

export function amzDate(at: Date): { readonly date: string; readonly datetime: string } {
  const iso = at.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { date: iso.slice(0, 8), datetime: iso };
}

function canonicalQuery(params: Iterable<[string, string]>): string {
  return [...params]
    .map(([key, value]) => [uriEncode(key), uriEncode(value)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

async function signingKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  return hmac(await hmac(await hmac(await hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
}

export type SignInput = {
  readonly method: string;
  readonly url: URL;
  /** Every header to sign, lowercase names. `host` is added when missing. */
  readonly headers: Readonly<Record<string, string>>;
  /** SHA-256 hex of the body, or `UNSIGNED-PAYLOAD`. */
  readonly payloadHash: string;
  readonly credentials: Credentials;
  readonly region: string;
  readonly service: string;
  readonly at: Date;
  /** S3 keeps the path exactly as given; other services encode it twice. */
  readonly doubleEncodePath?: boolean;
};

/** The headers to send: those given, plus `authorization`. */
export async function signRequest(input: SignInput): Promise<Record<string, string>> {
  const { date, datetime } = amzDate(input.at);
  const headers: Record<string, string> = { ...input.headers };
  headers.host ??= input.url.host;
  const names = Object.keys(headers).map(name => name.toLowerCase()).sort();
  const canonicalHeaders = names.map(name => `${name}:${(headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const path = input.url.pathname.split('/').map(segment => uriEncode(decodeURIComponent(segment))).join('/') || '/';
  const canonicalPath = input.doubleEncodePath ? path.split('/').map(segment => uriEncode(segment)).join('/') : path;
  const signedHeaders = names.join(';');
  const canonical = [input.method, canonicalPath, canonicalQuery(input.url.searchParams), canonicalHeaders, signedHeaders, input.payloadHash].join('\n');
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', datetime, scope, await sha256Hex(canonical)].join('\n');
  const signature = hex(await hmac(await signingKey(input.credentials.secretAccessKey, date, input.region, input.service), toSign));
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

/** A URL anyone can GET until it expires, without credentials: for handing a file to a browser. */
export async function presignUrl(input: { readonly url: URL; readonly credentials: Credentials; readonly region: string; readonly service: string; readonly at: Date; readonly expiresSeconds: number }): Promise<string> {
  const { date, datetime } = amzDate(input.at);
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const url = new URL(input.url);
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${input.credentials.accessKeyId}/${scope}`);
  url.searchParams.set('X-Amz-Date', datetime);
  url.searchParams.set('X-Amz-Expires', String(input.expiresSeconds));
  url.searchParams.set('X-Amz-SignedHeaders', 'host');
  if (input.credentials.sessionToken) url.searchParams.set('X-Amz-Security-Token', input.credentials.sessionToken);
  const path = url.pathname.split('/').map(segment => uriEncode(decodeURIComponent(segment))).join('/') || '/';
  const canonical = ['GET', path, canonicalQuery(url.searchParams), `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', datetime, scope, await sha256Hex(canonical)].join('\n');
  url.searchParams.set('X-Amz-Signature', hex(await hmac(await signingKey(input.credentials.secretAccessKey, date, input.region, input.service), toSign)));
  return url.toString();
}
