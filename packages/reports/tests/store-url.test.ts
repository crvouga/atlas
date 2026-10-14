import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import { openBackends, parseStoreLocation, storeId, storeSpecs } from '../src/store-url';

const base = '/work/project';

describe('where a store is', () => {
  test('a folder, relative to where the command runs, or a file URL', () => {
    expect(parseStoreLocation('./atlas-reports', base)).toEqual({ kind: 'directory', directory: path.resolve(base, 'atlas-reports') });
    expect(parseStoreLocation('/srv/atlas', base)).toEqual({ kind: 'directory', directory: '/srv/atlas' });
    expect(parseStoreLocation('file:///srv/atlas', base)).toEqual({ kind: 'directory', directory: '/srv/atlas' });
    expect(parseStoreLocation('My Reports', base)).toEqual({ kind: 'directory', directory: path.resolve(base, 'My Reports') });
  });

  test('S3, with the folder, region and endpoint it was given', () => {
    expect(parseStoreLocation('s3://my-bucket/atlas/my-project', base)).toEqual({ kind: 's3', bucket: 'my-bucket', prefix: 'atlas/my-project' });
    expect(parseStoreLocation('s3://my-bucket?region=eu-west-1', base)).toEqual({ kind: 's3', bucket: 'my-bucket', prefix: '', region: 'eu-west-1' });
    expect(parseStoreLocation('s3://b/p/?endpoint=http://localhost:9000&pathStyle=1', base)).toEqual({ kind: 's3', bucket: 'b', prefix: 'p', endpoint: 'http://localhost:9000', pathStyle: true });
    expect(parseStoreLocation('s3://b/p?pathStyle=0', base)).toMatchObject({ pathStyle: false });
  });

  test('R2 and Google Cloud Storage fill in their endpoints', () => {
    expect(parseStoreLocation('r2://b/p?account=abc123', base)).toEqual({ kind: 's3', bucket: 'b', prefix: 'p', region: 'auto', endpoint: 'https://abc123.r2.cloudflarestorage.com' });
    expect(parseStoreLocation('r2://b/p', base, { R2_ACCOUNT_ID: 'fromenv' })).toMatchObject({ endpoint: 'https://fromenv.r2.cloudflarestorage.com' });
    expect(() => parseStoreLocation('r2://b/p', base)).toThrow('Cloudflare account id');
    expect(parseStoreLocation('gs://b/p', base)).toEqual({ kind: 's3', bucket: 'b', prefix: 'p', region: 'auto', endpoint: 'https://storage.googleapis.com' });
  });

  test('keys in a URL, an unknown scheme and a missing bucket are refused with the way forward', () => {
    expect(() => parseStoreLocation('s3://KEY:SECRET@b/p', base)).toThrow('Keys do not belong in a store URL');
    expect(() => parseStoreLocation('azure://b/p', base)).toThrow('Unsupported store');
    expect(() => parseStoreLocation('s3:///p', base)).toThrow();
  });
});

describe('which stores a command uses', () => {
  test('flags win; ATLAS_STORE is one store or several separated by commas or new lines, never split on spaces', () => {
    expect(storeSpecs(['a', 'b'], { ATLAS_STORE: 'z' })).toEqual(['a', 'b']);
    expect(storeSpecs([], { ATLAS_STORE: '/Users/me/My Reports' })).toEqual(['/Users/me/My Reports']);
    expect(storeSpecs([], { ATLAS_STORE: 's3://a/x, s3://b/y\ns3://c/z' })).toEqual(['s3://a/x', 's3://b/y', 's3://c/z']);
    expect(storeSpecs([], {})).toEqual([]);
  });

  test('each store gets a short unique id from its bucket and folder, or the one it was given', () => {
    const backends = openBackends(['s3://my-bucket/atlas/shop', 's3://my-bucket/atlas/shop?region=eu-west-1', 'lab=./lab', './reports'], { base });
    expect(backends.map(backend => backend.id)).toEqual(['my-bucket-atlas-shop', 'my-bucket-atlas-shop-2', 'lab', 'reports']);
    expect(() => openBackends(['a=./x', 'a=./y'], { base })).toThrow('Two stores are named "a"');
    expect(storeId({ kind: 'directory', directory: '/x/My Reports!' }, new Set())).toBe('my-reports');
  });

  test('a store label never contains a secret', () => {
    const [store] = openBackends(['s3://b/p'], { base, env: { AWS_ACCESS_KEY_ID: 'AKIASECRET', AWS_SECRET_ACCESS_KEY: 'supersecret' } });
    expect(store!.label).not.toContain('AKIASECRET');
    expect(store!.label).not.toContain('supersecret');
  });
});

describe('a token belongs to one server', () => {
  const tokenOf = (spec: string, env: Record<string, string>, others: string[] = []) => {
    const seen: string[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => { seen.push(String((init.headers as Record<string, string>)?.authorization ?? '')); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const [backend] = openBackends([spec, ...others], { base: '/work', env, fetch: fetcher });
    return { backend: backend!, seen };
  };

  test('with one server, ATLAS_TOKEN is its token', async () => {
    const { backend, seen } = tokenOf('https://atlas.corp.example', { ATLAS_TOKEN: 'corp-token-123456' });
    await backend.store.head('layers/x');
    expect(seen).toEqual(['Bearer corp-token-123456']);
  });

  test('with several servers, ATLAS_TOKEN is sent to none; ATLAS_TOKEN_<ID> is for the store of that name', async () => {
    const env = { ATLAS_TOKEN: 'corp-token-123456', ATLAS_TOKEN_LAB: 'lab-token-1234567' };
    const both = openBackends(['https://atlas.corp.example', 'lab=https://lab.partner.example'], { base: '/work', env, fetch: (async (url: string, init: RequestInit) => new Response(JSON.stringify({ url, auth: (init.headers as Record<string, string>)?.authorization ?? null }), { status: 200 })) as unknown as typeof fetch });
    const sent = async (i: number) => (await (await both[i]!.store.get('layers/x'))!.body.getReader().read()).value as Uint8Array;
    expect(JSON.parse(new TextDecoder().decode(await sent(0)))).toMatchObject({ auth: null });
    expect(JSON.parse(new TextDecoder().decode(await sent(1)))).toMatchObject({ auth: 'Bearer lab-token-1234567' });
  });

  test('a token is not sent over plain http beyond this machine, unless the network is said to be trusted', () => {
    expect(() => tokenOf('http://atlas.corp.example', { ATLAS_TOKEN: 'corp-token-123456' })).toThrow('over plain http');
    expect(() => tokenOf('http://127.0.0.1:8080', { ATLAS_TOKEN: 'corp-token-123456' })).not.toThrow();
    expect(() => tokenOf('http://localhost:8080', { ATLAS_TOKEN: 'corp-token-123456' })).not.toThrow();
    expect(() => tokenOf('http://atlas.corp.example', { ATLAS_TOKEN: 'corp-token-123456', ATLAS_TRUST_NETWORK: '1' })).not.toThrow();
    expect(() => tokenOf('http://atlas.corp.example', {})).not.toThrow();
  });
});
