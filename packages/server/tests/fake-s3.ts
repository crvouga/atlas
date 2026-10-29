/**
 * An in-memory S3 server for tests, as a `fetch`. It speaks the subset the Atlas S3 store uses (path-style GET, PUT, HEAD,
 * DELETE and ListObjectsV2), checks the access key in the SigV4 `Authorization` header and the bucket name, and answers
 * like S3 does when either is wrong. It cannot prove that real S3 accepts the signature: the S3 integration tests do that.
 */
export const S3_TEST_ENV = {
  ATLAS_S3_ENDPOINT: 'http://s3.test', ATLAS_S3_BUCKET: 'atlas-test', ATLAS_S3_REGION: 'us-east-1',
  ATLAS_S3_ACCESS_KEY_ID: 'testkey', ATLAS_S3_SECRET_ACCESS_KEY: 'testsecret'
} as const;

const xmlError = (status: number, code: string) => new Response(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`, { status, headers: { 'content-type': 'application/xml' } });

/** A fake S3 for `bucket` that accepts `accessKey`. `objects` is the bucket's content, `requests` the log. */
export function fakeS3(options: { bucket?: string; accessKey?: string } = {}) {
  const bucket = options.bucket ?? S3_TEST_ENV.ATLAS_S3_BUCKET;
  const accessKey = options.accessKey ?? S3_TEST_ENV.ATLAS_S3_ACCESS_KEY_ID;
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const requests: { method: string; key: string }[] = [];
  const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
    const request = typeof input === 'string' || input instanceof URL ? new Request(String(input), init) : new Request(input, init);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const headers = request.headers;
    const credential = /Credential=([^/]+)\//.exec(headers.get('authorization') ?? '')?.[1];
    if (!credential) return xmlError(403, 'AccessDenied');
    if (credential !== accessKey) return xmlError(403, 'InvalidAccessKeyId');
    const [, named, ...rest] = url.pathname.split('/');
    if (named !== bucket) return xmlError(404, 'NoSuchBucket');
    const key = rest.map(part => decodeURIComponent(part)).join('/');
    requests.push({ method, key });
    if (method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const after = url.searchParams.get('start-after') ?? '';
      const max = Number(url.searchParams.get('max-keys') ?? 1000);
      const keys = [...objects.keys()].filter(item => item.startsWith(prefix) && item > after).sort();
      const page = keys.slice(0, max);
      const body = `<?xml version="1.0"?><ListBucketResult><IsTruncated>${keys.length > max}</IsTruncated>${page.map(item => `<Contents><Key>${encodeURIComponent(item).replace(/%2F/g, '/')}</Key></Contents>`).join('')}</ListBucketResult>`;
      return new Response(body, { headers: { 'content-type': 'application/xml' } });
    }
    if (method === 'PUT') {
      objects.set(key, { bytes: new Uint8Array(await request.arrayBuffer()), contentType: headers.get('content-type') ?? 'application/octet-stream' });
      return new Response(null, { status: 200 });
    }
    if (method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }); }
    const found = objects.get(key);
    if (!found) return method === 'HEAD' ? new Response(null, { status: 404 }) : xmlError(404, 'NoSuchKey');
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': String(found.bytes.length), 'content-type': found.contentType } });
    return new Response(new Uint8Array(found.bytes), { headers: { 'content-type': found.contentType, 'content-length': String(found.bytes.length) } });
  }) as typeof fetch;
  return { fetch: fetchImpl, objects, requests, bucket,
    text: (key: string) => { const found = objects.get(key); return found ? new TextDecoder().decode(found.bytes) : null; } };
}

/** Serves a fake S3 over real HTTP on a free local port, for tests that start `atlas` as a separate process. Returns its URL and `stop`. */
export function listenFakeS3(fake: ReturnType<typeof fakeS3>, hostname = '127.0.0.1') {
  const server = Bun.serve({ port: 0, hostname, fetch: request => fake.fetch(request) });
  return { url: `http://127.0.0.1:${server.port}`, port: server.port as number, stop: () => server.stop(true) };
}
