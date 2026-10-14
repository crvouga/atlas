import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import { ConfigError, loadServerConfig } from '../src/config';

const cwd = '/work/project';
const load = (argv: string[] = [], env: Record<string, string> = {}, file?: unknown) =>
  loadServerConfig(argv, env, cwd, () => JSON.stringify(file ?? {}));
const filed = (argv: string[], env: Record<string, string>, file: unknown) => load(['--config', 'atlas.server.json', ...argv], env, file);

describe('server configuration', () => {
  test('with nothing given, the server is for this machine, keeps its data in ./atlas-data and writes there', () => {
    const config = load();
    expect(config).toMatchObject({ host: '127.0.0.1', port: 8080, writeId: 'data', tokens: [], anonymousRead: false, insecure: false, refreshSeconds: 10 });
    expect(config.data).toBe(path.join(cwd, 'atlas-data'));
    expect(config.backends).toEqual([{ id: 'data', label: 'Server data', url: path.join(cwd, 'atlas-data') }]);
  });

  test('the file, then the environment, then the flags: the later wins', () => {
    const file = { port: 1111, data: 'from-file', refreshSeconds: 30 };
    expect(filed([], {}, file)).toMatchObject({ port: 1111, refreshSeconds: 30 });
    expect(filed([], { PORT: '2222' }, file).port).toBe(2222);
    expect(filed([], { ATLAS_PORT: '3333', PORT: '2222' }, file).port).toBe(3333);
    expect(filed(['--port', '4444'], { ATLAS_PORT: '3333' }, file).port).toBe(4444);
    expect(filed(['--data', 'flag'], { ATLAS_DATA: 'env' }, file).data).toBe(path.join(cwd, 'flag'));
  });

  test('a path in the file is relative to the file, one on the command line to where it is run', () => {
    const config = loadServerConfig(['--config', 'deploy/atlas.json'], {}, cwd, () => JSON.stringify({ data: 'results', site: 'dist' }));
    expect(config.data).toBe(path.join(cwd, 'deploy/results'));
    expect(config.site).toBe(path.join(cwd, 'deploy/dist'));
  });

  test('more backends are read as well, in order, and uploads can go to any one of them', () => {
    const config = filed(['--store', 'lab=https://lab.example.com'], { ATLAS_STORE: 'ignored-when-flag-given' }, { backends: [{ id: 'archive', url: 's3://bucket/atlas?region=us-east-1', label: 'Archive' }], write: 'archive' });
    expect(config.backends.map(item => item.id)).toEqual(['data', 'archive', 'lab']);
    expect(config.writeId).toBe('archive');
    expect(load([], { ATLAS_STORE: 's3://a/b,https://other.example.com' }).backends.map(item => item.id)).toEqual(['data', 'a-b', 'other-example-com']);
  });

  test('what is wrong is said in words and changes nothing', () => {
    expect(() => load(['--write', 'nope'])).toThrow('which is not a backend');
    expect(() => load(['--store', 'data=/x'])).toThrow('Two backends are called "data"');
    expect(() => load(['--port', 'abc'])).toThrow(ConfigError);
    expect(() => load(['--nope'])).toThrow(ConfigError);
    expect(() => filed([], {}, { prot: 1 })).toThrow('prot');
    expect(() => loadServerConfig(['--config', 'x.json'], {}, cwd, () => { throw new Error('ENOENT'); })).toThrow('Cannot read');
    expect(() => filed([], {}, { backends: [{ id: 'a', url: 'x', write: true }, { id: 'b', url: 'y', write: true }] })).toThrow('Only one backend can take uploads');
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
