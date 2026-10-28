import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import { ConfigError, loadServerConfig } from '../src/config';
import { resolveS3Config, S3ConfigError, S3_VARIABLES } from '../src/storage';
import { S3_TEST_ENV } from './fake-s3';

const cwd = '/work/project';
const load = (argv: string[] = [], env: Record<string, string> = {}, file?: unknown) =>
  loadServerConfig(argv, { ...S3_TEST_ENV, ...env }, cwd, () => JSON.stringify(file ?? {}));
const filed = (argv: string[], env: Record<string, string>, file: unknown) => load(['--config', 'atlas.server.json', ...argv], env, file);

describe('server configuration', () => {
  test('with only the required storage given, the server is for this machine and keeps everything in S3', () => {
    const config = load();
    expect(config).toMatchObject({ host: '127.0.0.1', port: 8080, tokens: [], anonymousRead: false, insecure: false, refreshSeconds: 10 });
    expect(config.s3).toEqual({ endpoint: 'http://s3.test', bucket: 'atlas-test', region: 'us-east-1', prefix: '', pathStyle: true, accessKeyId: 'testkey', secretAccessKey: 'testsecret' });
    expect('data' in config).toBe(false);
    expect('backends' in config).toBe(false);
  });

  test('the file, then the environment, then the flags: the later wins', () => {
    const file = { port: 1111, refreshSeconds: 30 };
    expect(filed([], {}, file)).toMatchObject({ port: 1111, refreshSeconds: 30 });
    expect(filed([], { PORT: '2222' }, file).port).toBe(2222);
    expect(filed([], { ATLAS_PORT: '3333', PORT: '2222' }, file).port).toBe(3333);
    expect(filed(['--port', '4444'], { ATLAS_PORT: '3333' }, file).port).toBe(4444);
    expect(filed(['--refresh', '5'], { ATLAS_REFRESH_SECONDS: '7' }, file).refreshSeconds).toBe(5);
  });

  test('a path in the file is relative to the file', () => {
    const config = loadServerConfig(['--config', 'deploy/atlas.json'], S3_TEST_ENV, cwd, () => JSON.stringify({ site: 'dist' }));
    expect(config.site).toBe(path.join(cwd, 'deploy/dist'));
  });

  test('settings saved in S3 are the lowest layer: the file, the environment and the flags override them', () => {
    const saved = { refreshSeconds: 40, runStallSeconds: 100, limits: { maxStreams: 9 }, include: { branches: ['main'] } };
    const withSaved = (argv: string[], env: Record<string, string>, file: unknown = {}) => loadServerConfig(['--config', 'atlas.server.json', ...argv], { ...S3_TEST_ENV, ...env }, cwd, () => JSON.stringify(file), saved);
    expect(withSaved([], {})).toMatchObject({ refreshSeconds: 40, runStallSeconds: 100, limits: { maxStreams: 9 }, include: { branches: ['main'] } });
    expect(withSaved([], {}, { refreshSeconds: 20 }).refreshSeconds).toBe(20);
    expect(withSaved([], { ATLAS_REFRESH_SECONDS: '15' }, { refreshSeconds: 20 }).refreshSeconds).toBe(15);
    expect(withSaved(['--refresh', '3'], { ATLAS_REFRESH_SECONDS: '15' }).refreshSeconds).toBe(3);
  });

  test('where reports are kept is no longer a setting: a file that still names a folder or backends is refused, in words', () => {
    for (const removed of ['data', 'backends', 'write']) expect(() => filed([], {}, { [removed]: removed === 'backends' ? [] : 'x' })).toThrow(`"${removed}" is no longer supported`);
    expect(() => load(['--data', 'x'])).toThrow(ConfigError);
    expect(() => load(['--store', 'x'])).toThrow(ConfigError);
    expect(() => load(['--write', 'x'])).toThrow(ConfigError);
  });

  test('what is wrong is said in words and changes nothing', () => {
    expect(() => load(['--port', 'abc'])).toThrow(ConfigError);
    expect(() => load(['--nope'])).toThrow(ConfigError);
    expect(() => filed([], {}, { prot: 1 })).toThrow('prot');
    expect(() => loadServerConfig(['--config', 'x.json'], S3_TEST_ENV, cwd, () => { throw new Error('ENOENT'); })).toThrow('Cannot read');
  });

  test('tokens: roles from the environment or the file, long enough, all different, and named where they are read from', () => {
    const config = load([], { ATLAS_TOKEN: 'admin-token-123456', ATLAS_PUBLISH_TOKEN: 'publish-token-12345', ATLAS_READ_TOKEN: 'read-token-1234567' });
    expect(config.tokens.map(item => item.role)).toEqual(['admin', 'publish', 'read']);
    expect(filed([], { CI_TOKEN: 'ci-token-1234567' }, { auth: { tokens: [{ name: 'ci', role: 'publish', tokenEnv: 'CI_TOKEN' }] } }).tokens).toEqual([{ name: 'ci', role: 'publish', token: 'ci-token-1234567' }]);
    expect(() => filed([], {}, { auth: { tokens: [{ name: 'ci', role: 'publish', tokenEnv: 'CI_TOKEN' }] } })).toThrow('CI_TOKEN');
    expect(() => load([], { ATLAS_TOKEN: 'short' })).toThrow('shorter than 12');
    expect(() => load([], { ATLAS_TOKEN: 'same-token-123456', ATLAS_READ_TOKEN: 'same-token-123456' })).toThrow('Two tokens are the same');
    expect(() => filed([], {}, { auth: { tokens: [{ name: 'x', role: 'publish', token: 'a', tokenEnv: 'B' }] } })).toThrow();
  });

  test('beyond this machine it needs tokens, or to be told that something else does the signing in', () => {
    expect(() => load(['--host', '0.0.0.0'])).toThrow('would let anyone on the network upload');
    expect(load(['--host', '0.0.0.0'], { ATLAS_TOKEN: 'admin-token-123456' }).host).toBe('0.0.0.0');
    expect(load(['--host', '0.0.0.0', '--insecure']).insecure).toBe(true);
    expect(load(['--host', '0.0.0.0'], { ATLAS_INSECURE: '1' }).insecure).toBe(true);
    expect(load(['--host', 'localhost']).host).toBe('localhost');
  });

  test('which layers the report shows: branches and whether laptops count', () => {
    const config = load(['--branch', 'main', '--ignore-modified'], { ATLAS_ONLY_BRANCH: 'release/1, release/2' });
    expect(config.include).toMatchObject({ branches: ['main', 'release/1', 'release/2'], ignoreModified: true });
  });
});

describe('required S3 storage', () => {
  const bannerOf = (env: Record<string, string | undefined>) => {
    try { loadServerConfig([], env, cwd, () => '{}'); } catch (error) { expect(error).toBeInstanceOf(S3ConfigError); return (error as Error).message; }
    throw new Error('expected the configuration to be refused');
  };

  test('with no S3 variables at all, every required one is listed by name and marked missing, with the reason', () => {
    const banner = bannerOf({});
    for (const variable of S3_VARIABLES) expect(banner).toContain(variable.name);
    for (const name of ['ATLAS_S3_ENDPOINT', 'ATLAS_S3_BUCKET', 'ATLAS_S3_REGION', 'ATLAS_S3_ACCESS_KEY_ID', 'ATLAS_S3_SECRET_ACCESS_KEY']) expect(banner).toMatch(new RegExp(`\\[MISSING\\] ${name}`));
    expect(banner).toContain('ATLAS CANNOT START');
    expect(banner).toContain('ALL reports and ALL user state');
    expect(banner).toContain('garbage collection policy');
    expect(banner).toContain('in-memory or database fallback');
    expect(banner).toContain('Fix these 5');
  });

  test('every problem is reported at once, not only the first, and only the broken variables are marked', () => {
    const banner = bannerOf({ ...S3_TEST_ENV, ATLAS_S3_ENDPOINT: 'not a url', ATLAS_S3_BUCKET: 'Bad_Bucket', ATLAS_S3_REGION: '', ATLAS_S3_ACCESS_KEY_ID: undefined, ATLAS_S3_PATH_STYLE: 'maybe' });
    expect(banner).toMatch(/\[INVALID\] ATLAS_S3_ENDPOINT/);
    expect(banner).toMatch(/\[INVALID\] ATLAS_S3_BUCKET/);
    expect(banner).toMatch(/\[MISSING\] ATLAS_S3_REGION/);
    expect(banner).toMatch(/\[MISSING\] ATLAS_S3_ACCESS_KEY_ID/);
    expect(banner).toMatch(/\[INVALID\] ATLAS_S3_PATH_STYLE/);
    expect(banner).toMatch(/\[ok\]\s+ATLAS_S3_SECRET_ACCESS_KEY/);
    expect(banner).toContain('Fix these 5');
  });

  test('a whitespace-only value is missing, and a secret is never printed', () => {
    const banner = bannerOf({ ...S3_TEST_ENV, ATLAS_S3_BUCKET: '   ', ATLAS_S3_SECRET_ACCESS_KEY: 'has a space' });
    expect(banner).toMatch(/\[MISSING\] ATLAS_S3_BUCKET/);
    expect(banner).toMatch(/\[INVALID\] ATLAS_S3_SECRET_ACCESS_KEY/);
    expect(banner).not.toContain('has a space');
  });

  test('optional variables may be left out, and a prefix, path style and session token are read when given', () => {
    expect(resolveS3Config(S3_TEST_ENV)).toMatchObject({ prefix: '', pathStyle: true });
    expect(resolveS3Config({ ...S3_TEST_ENV, ATLAS_S3_PREFIX: '/atlas/prod/', ATLAS_S3_PATH_STYLE: 'false', ATLAS_S3_SESSION_TOKEN: 'tok', ATLAS_S3_ENDPOINT: 'https://s3.example.com/' })).toMatchObject({ prefix: 'atlas/prod', pathStyle: false, sessionToken: 'tok', endpoint: 'https://s3.example.com' });
    expect(() => resolveS3Config({ ...S3_TEST_ENV, ATLAS_S3_PREFIX: '../x' })).toThrow('ATLAS_S3_PREFIX');
  });

  test('no other environment stands in for the S3 variables: AWS_* and a bare bucket name are not fallbacks', () => {
    const banner = bannerOf({ AWS_ACCESS_KEY_ID: 'x', AWS_SECRET_ACCESS_KEY: 'y', AWS_REGION: 'eu-west-1', ATLAS_STORE: 's3://b/p', ATLAS_DATA: './atlas-data' });
    expect(banner).toMatch(/\[MISSING\] ATLAS_S3_ACCESS_KEY_ID/);
    expect(banner).toMatch(/\[MISSING\] ATLAS_S3_REGION/);
  });

  test('storage is checked before anything else, so a deployer sees it first', () => {
    expect(() => loadServerConfig(['--port', 'abc'], {}, cwd, () => '{}')).toThrow(S3ConfigError);
  });
});
