import { describe, expect, test } from 'bun:test';

import { credentialChain } from '../src/aws-credentials';
import { S3Error, s3Store } from '../src/s3-store';

const keys = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' };
const error = (code: string, status: number, headers: Record<string, string> = {}) => new Response(`<Error><Code>${code}</Code><Message>${code} happened</Message></Error>`, { status, headers });
const listing = (names: string[], truncated = false) => new Response(`<ListBucketResult><IsTruncated>${truncated}</IsTruncated>${truncated ? '<NextContinuationToken>next</NextContinuationToken>' : ''}${names.map(name => `<Contents><Key>${name}</Key></Contents>`).join('')}</ListBucketResult>`);

type Call = { method: string; url: URL; headers: Headers };
function scripted(replies: (Response | Error | ((call: Call) => Response))[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const call = { method: init?.method ?? 'GET', url: new URL(String(input)), headers: new Headers(init?.headers) };
    calls.push(call);
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected request ${call.method} ${call.url}`);
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(call) : reply;
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const quick = { sleep: async () => {}, env: {}, credentials: keys, region: 'eu-west-1' };

describe('s3Store requests', () => {
  test('AWS addresses are virtual-hosted, a custom endpoint is path-style, and keys are encoded', async () => {
    const aws = scripted([new Response('x'), new Response('x')]);
    await s3Store({ ...quick, bucket: 'my-bucket', prefix: 'atlas/p', fetch: aws.fetchImpl }).get('a b/c.json');
    expect(aws.calls[0]!.url.href).toBe('https://my-bucket.s3.eu-west-1.amazonaws.com/atlas/p/a%20b/c.json');
    const dotted = scripted([new Response('x')]);
    await s3Store({ ...quick, bucket: 'my.dotted.bucket', fetch: dotted.fetchImpl }).get('k');
    expect(dotted.calls[0]!.url.href).toBe('https://s3.eu-west-1.amazonaws.com/my.dotted.bucket/k');
    const custom = scripted([new Response('x')]);
    await s3Store({ ...quick, bucket: 'b', endpoint: 'https://acct.r2.cloudflarestorage.com', fetch: custom.fetchImpl }).get('k');
    expect(custom.calls[0]!.url.href).toBe('https://acct.r2.cloudflarestorage.com/b/k');
  });

  test('every request is signed with a body hash and a session token when there is one', async () => {
    const { calls, fetchImpl } = scripted([new Response(null, { status: 200 })]);
    await s3Store({ ...quick, bucket: 'b', credentials: { ...keys, sessionToken: 'TOKEN' }, fetch: fetchImpl }).put('k', new Uint8Array([1, 2, 3]), 'application/json');
    const headers = calls[0]!.headers;
    expect(headers.get('authorization')).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token');
    expect(headers.get('x-amz-content-sha256')).toMatch(/^[0-9a-f]{64}$/);
    expect(headers.get('x-amz-security-token')).toBe('TOKEN');
    expect(headers.get('content-type')).toBe('application/json');
  });

  test('throttling and server errors are retried, then succeed', async () => {
    const { calls, fetchImpl } = scripted([error('SlowDown', 503), error('InternalError', 500), new Error('socket hang up'), new Response('ok')]);
    const object = await s3Store({ ...quick, bucket: 'b', fetch: fetchImpl }).get('k');
    expect(await new Response(object!.body).text()).toBe('ok');
    expect(calls.length).toBe(4);
  });

  test('retries stop, and the error says what happened', async () => {
    const { calls, fetchImpl } = scripted(Array.from({ length: 6 }, () => error('SlowDown', 503)));
    await expect(s3Store({ ...quick, bucket: 'b', retries: 2, fetch: fetchImpl }).get('k')).rejects.toThrow('SlowDown');
    expect(calls.length).toBe(3);
  });

  test('a mistake is not retried: access denied says which permissions are needed', async () => {
    const { calls, fetchImpl } = scripted([error('AccessDenied', 403)]);
    const failure = await s3Store({ ...quick, bucket: 'b', prefix: 'p', fetch: fetchImpl }).put('k', new Uint8Array(), 'text/plain').catch(caught => caught as S3Error);
    expect(failure).toBeInstanceOf(S3Error);
    expect((failure as S3Error).message).toContain('s3:PutObject');
    expect((failure as S3Error).message).toContain('atlas report policy');
    expect(calls.length).toBe(1);
  });

  test('a missing key is an answer, a missing bucket is a mistake', async () => {
    const store = s3Store({ ...quick, bucket: 'b', fetch: scripted([error('NoSuchKey', 404), new Response(null, { status: 404 }), error('NoSuchBucket', 404)]).fetchImpl });
    expect(await store.get('k')).toBeNull();
    expect(await store.head('k')).toBe(false);
    await expect(store.get('k')).rejects.toThrow('bucket does not exist');
  });

  test('a bucket in another region is followed once', async () => {
    const { calls, fetchImpl } = scripted([error('PermanentRedirect', 301, { 'x-amz-bucket-region': 'ap-south-1' }), new Response('ok')]);
    await s3Store({ ...quick, bucket: 'b', fetch: fetchImpl }).get('k');
    expect(calls[1]!.url.host).toBe('b.s3.ap-south-1.amazonaws.com');
    expect(calls[1]!.headers.get('authorization')).toContain('/ap-south-1/s3/aws4_request');
  });

  test('expired credentials are refreshed once and the request is repeated', async () => {
    let issued = 0;
    const provider = Object.assign(async () => ({ ...keys, sessionToken: `T${++issued}` }), { invalidate: () => {}, source: () => 'test' });
    const { calls, fetchImpl } = scripted([error('ExpiredToken', 400), new Response('ok')]);
    await s3Store({ ...quick, bucket: 'b', credentials: provider, fetch: fetchImpl }).get('k');
    expect(calls.map(call => call.headers.get('x-amz-security-token'))).toEqual(['T1', 'T2']);
  });

  test('listing follows continuation tokens, decodes keys, strips the prefix and sorts', async () => {
    const { calls, fetchImpl } = scripted([listing(['p/b%20c', 'p/a'], true), listing(['p/%C3%BCber'])]);
    const keysOut = await s3Store({ ...quick, bucket: 'b', prefix: 'p', fetch: fetchImpl }).listKeys('');
    expect(keysOut).toEqual(['a', 'b c', 'über']);
    expect(calls[0]!.url.searchParams.get('prefix')).toBe('p/');
    expect(calls[1]!.url.searchParams.get('continuation-token')).toBe('next');
  });

  test('requests in flight are capped', async () => {
    let active = 0, peak = 0;
    const fetchImpl = (async () => { active += 1; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active -= 1; return new Response(null, { status: 200 }); }) as unknown as typeof fetch;
    const store = s3Store({ ...quick, bucket: 'b', concurrency: 3, fetch: fetchImpl });
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.head(`k${i}`)));
    expect(peak).toBe(3);
  });

  test('the label never contains a secret', () => {
    expect(s3Store({ ...quick, bucket: 'b', prefix: 'p', credentials: { accessKeyId: 'AKID', secretAccessKey: 'SUPERSECRET' } }).label).toBe('s3://b/p/ (eu-west-1)');
  });
});

describe('credentialChain', () => {
  const none = { run: async () => null, readFile: async () => { throw new Error('ENOENT'); } };
  const offline = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;

  test('ATLAS_S3_* beats AWS_*, and AWS_* beats files', async () => {
    const both = credentialChain({ ...none, fetch: offline, env: { ATLAS_S3_ACCESS_KEY_ID: 'a', ATLAS_S3_SECRET_ACCESS_KEY: 'b', AWS_ACCESS_KEY_ID: 'c', AWS_SECRET_ACCESS_KEY: 'd' } });
    expect((await both()).accessKeyId).toBe('a');
    expect(both.source()).toContain('ATLAS_S3');
    const aws = credentialChain({ ...none, fetch: offline, env: { AWS_ACCESS_KEY_ID: 'c', AWS_SECRET_ACCESS_KEY: 'd', AWS_SESSION_TOKEN: 't' } });
    expect(await aws()).toEqual({ accessKeyId: 'c', secretAccessKey: 'd', sessionToken: 't' });
  });

  test('the shared credentials file is read for the profile in use', async () => {
    const file = '[default]\naws_access_key_id = DEF\naws_secret_access_key = defsecret\n\n[prod]\naws_access_key_id = PROD\naws_secret_access_key = prodsecret\n';
    const chain = (env: Record<string, string>) => credentialChain({ run: async () => null, fetch: offline, home: '/home/x', env, readFile: async path => { if (path === '/home/x/.aws/credentials') return file; throw new Error('ENOENT'); } });
    expect((await chain({})()).accessKeyId).toBe('DEF');
    expect((await chain({ AWS_PROFILE: 'prod' })()).accessKeyId).toBe('PROD');
  });

  test('the AWS CLI covers SSO and assumed roles', async () => {
    const chain = credentialChain({ ...none, fetch: offline, env: {}, run: async (command, args) => (command === 'aws' && args[0] === 'configure' ? JSON.stringify({ Version: 1, AccessKeyId: 'SSO', SecretAccessKey: 's', SessionToken: 't', Expiration: '2999-01-01T00:00:00Z' }) : null) });
    expect(await chain()).toMatchObject({ accessKeyId: 'SSO', sessionToken: 't', expiresAtMs: Date.parse('2999-01-01T00:00:00Z') });
    expect(chain.source()).toContain('AWS CLI');
  });

  test('EKS web identity exchanges the pod token for credentials', async () => {
    let asked = '';
    const fetchImpl = (async (url: URL | string) => {
      asked = String(url);
      return new Response('<AssumeRoleWithWebIdentityResponse><AssumeRoleWithWebIdentityResult><Credentials><AccessKeyId>IRSA</AccessKeyId><SecretAccessKey>s</SecretAccessKey><SessionToken>t</SessionToken><Expiration>2999-01-01T00:00:00Z</Expiration></Credentials></AssumeRoleWithWebIdentityResult></AssumeRoleWithWebIdentityResponse>');
    }) as unknown as typeof fetch;
    const chain = credentialChain({ run: async () => null, fetch: fetchImpl, env: { AWS_WEB_IDENTITY_TOKEN_FILE: '/token', AWS_ROLE_ARN: 'arn:aws:iam::1:role/atlas', AWS_REGION: 'us-west-2' }, readFile: async () => 'jwt\n' });
    expect((await chain()).accessKeyId).toBe('IRSA');
    expect(asked).toContain('sts.us-west-2.amazonaws.com');
    expect(asked).toContain('WebIdentityToken=jwt');
  });

  test('ECS container credentials and EC2 metadata are used when nothing else is there', async () => {
    const ecs = credentialChain({ ...none, env: { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/creds' }, fetch: (async (url: string) => (String(url) === 'http://169.254.170.2/creds' ? Response.json({ AccessKeyId: 'ECS', SecretAccessKey: 's', Token: 't' }) : new Response(null, { status: 404 }))) as unknown as typeof fetch });
    expect((await ecs()).accessKeyId).toBe('ECS');
    const ec2 = credentialChain({ ...none, env: {}, fetch: (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/token') && init?.method === 'PUT') return new Response('TOK');
      if (String(url).endsWith('/security-credentials/')) return new Response('atlas-role');
      if (String(url).endsWith('/security-credentials/atlas-role')) return Response.json({ AccessKeyId: 'EC2', SecretAccessKey: 's', Token: 't' });
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch });
    expect((await ec2()).accessKeyId).toBe('EC2');
  });

  test('credentials are cached until shortly before they expire, then fetched again, once for many callers', async () => {
    let clock = 1_000_000, runs = 0;
    const chain = credentialChain({ ...none, fetch: offline, env: {}, now: () => clock, skewMs: 60_000, run: async () => { runs += 1; return JSON.stringify({ AccessKeyId: `K${runs}`, SecretAccessKey: 's', Expiration: new Date(clock + 600_000).toISOString() }); } });
    const [a, b, c] = await Promise.all([chain(), chain(), chain()]);
    expect([a.accessKeyId, b.accessKeyId, c.accessKeyId]).toEqual(['K1', 'K1', 'K1']);
    clock += 400_000;
    expect((await chain()).accessKeyId).toBe('K1');
    clock += 200_000;
    expect((await chain()).accessKeyId).toBe('K2');
  });

  test('finding nothing says everywhere it looked and how to fix it', async () => {
    const chain = credentialChain({ ...none, fetch: offline, env: { AWS_EC2_METADATA_DISABLED: 'true', ATLAS_NO_AWS_CLI: '1' } });
    const failure = await chain().catch(caught => caught as Error);
    expect(failure.message).toContain('No AWS credentials found');
    expect(failure.message).toContain('aws sso login');
  });
});

describe('timeouts', () => {
  test('the timeout is for the service to answer: a body that takes longer than it is still delivered whole', async () => {
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({ async start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        await new Promise(resolve => setTimeout(resolve, 120));
        if (init?.signal?.aborted) { controller.error(new Error('aborted')); return; }
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      } });
      return new Response(body, { headers: { 'content-length': '4' } });
    }) as unknown as typeof fetch;
    const object = await s3Store({ ...quick, bucket: 'b', timeoutMs: 40, fetch: fetchImpl }).get('big');
    expect([...new Uint8Array(await new Response(object!.body).arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });

  test('a service that never answers is given up on, and says so', async () => {
    const hang = ((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    await expect(s3Store({ ...quick, bucket: 'b', timeoutMs: 30, retries: 0, fetch: hang }).get('k')).rejects.toThrow('timed out after 30ms');
  });

  test('a page of a listing starts after a key and says where the next begins', async () => {
    const { calls, fetchImpl } = scripted([new Response('<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>p/a</Key></Contents><Contents><Key>p/b</Key></Contents></ListBucketResult>')]);
    const page = await s3Store({ ...quick, bucket: 'b', prefix: 'p', fetch: fetchImpl }).listPage('', { after: 'a0', limit: 2 });
    expect(page).toEqual({ keys: ['a', 'b'], next: 'b' });
    expect(calls[0]!.url.searchParams.get('start-after')).toBe('p/a0');
    expect(calls[0]!.url.searchParams.get('max-keys')).toBe('2');
  });
});

describe('the clock', () => {
  test('time spent waiting for a turn is not time the service took to answer', async () => {
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 40); init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); }); });
      return new Response('ok');
    }) as unknown as typeof fetch;
    const store = s3Store({ ...quick, bucket: 'b', concurrency: 1, timeoutMs: 100, retries: 0, fetch: fetchImpl });
    // Eight requests, one at a time, 40 ms each: the last waits 280 ms, far past the 100 ms timeout.
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => store.get(`k${i}`)));
    expect(results.every(result => result !== null)).toBe(true);
  });
});

describe('the request cap', () => {
  test('a finished request hands its place to the next in line: newcomers cannot slip past and exceed the cap', async () => {
    let active = 0, peak = 0;
    let store!: ReturnType<typeof s3Store>;
    let started = 0;
    const fetchImpl = (async () => {
      active += 1; peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      // The moment one finishes, someone new arrives from outside.
      if (started < 300) { started += 1; void store.head(`n${started}`); }
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    store = s3Store({ ...quick, bucket: 'b', concurrency: 2, fetch: fetchImpl });
    await Promise.all(Array.from({ length: 30 }, (_, i) => store.head(`k${i}`)));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(peak).toBeLessThanOrEqual(2);
  });
});
