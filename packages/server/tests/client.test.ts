import { afterEach, describe, expect, test } from 'bun:test';

import { httpStore } from '../../reports/src/http-store';
import { reportMain } from '../../reports/src/report-cli';
import { createReporter } from '../../reports/src/reporter';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { listen, type RunningServer } from '../src/host';

const running: { server: AtlasServer; http: RunningServer }[] = [];
afterEach(async () => {
  for (const { server, http } of running.splice(0)) { server.close(); await http.close(200); }
});

async function start(tokens?: { name: string; role: 'admin' | 'publish' | 'read'; token: string }[]) {
  const server = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data', ...(tokens ? { tokens } : {}), refreshMs: 60_000 });
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 << 20 });
  running.push({ server, http });
  await server.ready;
  return { server, url: `http://127.0.0.1:${http.port}` };
}
const lines = (...items: unknown[]) => (async function* () { for (const item of items) yield `${JSON.stringify(item)}\n`; })();

describe('the reporter', () => {
  test('a suite streams to the server as it runs: running, then passed, and the later one wins', async () => {
    const { url, server } = await start();
    let time = 1000;
    const reporter = createReporter({ producer: 'e2e', environment: 'ios', branch: 'main' }, { store: httpStore({ url }), flushMs: 0, now: () => time });
    reporter.check({ id: 'login', title: 'login', status: 'running' });
    await reporter.flush();
    expect(server.index.stats().slots).toBe(1);
    const running = await (await fetch(`${url}/api/status`)).json() as { checks: { running: number; passed: number }; ok: boolean };
    expect(running.checks).toMatchObject({ running: 1, passed: 0 });
    expect(running.ok).toBe(false);
    reporter.check({ id: 'login', title: 'login', status: 'passed' });
    reporter.check({ id: 'cart', title: 'cart', status: 'failed' });
    expect(await reporter.close()).toEqual({ layers: 2, checks: 3, lost: 0 });
    const done = await (await fetch(`${url}/api/status`)).json() as { checks: { running: number; passed: number; failed: number }; layers: number };
    expect(done.checks).toMatchObject({ running: 0, passed: 1, failed: 1 });
    expect(done.layers).toBe(2);
  });

  test('a flush that fails is kept and sent again as the same layer; time only moves forward', async () => {
    const store = memoryStore();
    let failing = 2;
    const flaky = { ...store, put: async (key: string, bytes: Uint8Array, type: string) => { if (failing-- > 0) throw new Error('down'); return store.put(key, bytes, type); } };
    const errors: string[] = [];
    const reporter = createReporter({ producer: 'p' }, { store: flaky as typeof store, flushMs: 0, now: () => 5, sleep: async () => undefined, onError: (error, willRetry) => errors.push(`${error.message}:${willRetry}`) });
    reporter.check({ id: 'a', title: 'a', status: 'passed' });
    await reporter.flush();
    expect(errors).toEqual(['down:true']);
    reporter.check({ id: 'b', title: 'b', status: 'passed' });
    const result = await reporter.close();
    expect(result).toEqual({ layers: 2, checks: 2, lost: 0 });
    expect((await store.listKeys('layers/index/')).length).toBe(2);
  });

  test('what never arrives is counted, not thrown into the suite', async () => {
    const dead = httpStore({ url: 'http://127.0.0.1:1', retries: 0 });
    const reporter = createReporter({ producer: 'p' }, { store: dead, flushMs: 0, attempts: 2, sleep: async () => undefined, onError: () => undefined });
    reporter.check({ id: 'a', title: 'a', status: 'passed' });
    expect(await reporter.close()).toEqual({ layers: 0, checks: 0, lost: 1 });
  });

  test('a check that could not be a layer is refused where it was reported', () => {
    const reporter = createReporter({ producer: 'p' }, { store: memoryStore(), flushMs: 0 });
    expect(() => reporter.check({ id: 'a', title: 'a', status: 'maybe' as never })).toThrow();
  });
});

describe('atlas report stream and status against a server', () => {
  test('checks on standard input arrive as layers, and the gate is asked of the server', async () => {
    const { url } = await start([{ name: 'ci', role: 'admin', token: 'admin-token-123456' }]);
    const env = { ATLAS_TOKEN: 'admin-token-123456' };
    let output = '';
    const io = { out: (text: string) => { output += text; }, env, cwd: process.cwd(), git: () => null };
    const code = await reportMain(['stream', '--store', url, '--producer', 'e2e', '--environment', 'ios', '--flush-ms', '0'], { ...io, stdin: lines({ id: 'a', title: 'a', status: 'passed' }, { id: 'b', title: 'b', status: 'failed' }) });
    expect(code).toBe(0);
    expect(output).toContain('Streamed 2 checks in 1 layer as "e2e" on ios');
    output = '';
    expect(await reportMain(['status', '--store', url, '--format', 'json'], io)).toBe(1);
    expect(JSON.parse(output)).toMatchObject({ ok: false, checks: { passed: 1, failed: 1 } });
    output = '';
    expect(await reportMain(['status', '--store', url, '--require-environments', 'ios'], io)).toBe(1);
  });

  test('a bad line is skipped and said; no token is said too', async () => {
    const { url } = await start([{ name: 'ci', role: 'admin', token: 'admin-token-123456' }]);
    let output = '';
    const io = { out: (text: string) => { output += text; }, env: { ATLAS_TOKEN: 'admin-token-123456' }, cwd: process.cwd(), git: () => null };
    const bad = (async function* () { yield 'not json\n{"id":"a","title":"a","status":"passed"}\n'; })();
    expect(await reportMain(['stream', '--store', url, '--producer', 'p', '--flush-ms', '0'], { ...io, stdin: bad })).toBe(0);
    expect(output).toContain('line 1 skipped');
    output = '';
    const anonymous = { ...io, env: {} };
    await expect(reportMain(['status', '--store', url], anonymous)).rejects.toThrow('wants a token');
  });
});

describe('atlas report doctor against a server', () => {
  test('it writes, lists and reads back through the protocol, and says what to fix when the token is wrong', async () => {
    const { url } = await start([{ name: 'ci', role: 'publish', token: 'publish-token-12345' }]);
    let output = '';
    const io = (token?: string) => ({ out: (text: string) => { output += text; }, env: token ? { ATLAS_TOKEN: token } : {}, cwd: process.cwd(), git: () => null });
    expect(await reportMain(['doctor', '--store', url], io('publish-token-12345'))).toBe(0);
    expect(output).toContain('All good');
    output = '';
    expect(await reportMain(['doctor', '--store', url], io())).toBe(1);
    expect(output).toContain('token');
  });
});
