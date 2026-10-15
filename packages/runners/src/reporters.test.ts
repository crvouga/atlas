import { afterEach, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createAtlasServer, type AtlasServer } from '../../server/src/app';
import { listen, type RunningServer } from '../../server/src/host';
import { memoryStore } from '../../reports/tests/memory-store';
import AtlasCodeceptReporter from './codecept';
import AtlasMochaReporter from './mocha';
import AtlasJestReporter from './jest';
import atlasNodeReporter from './node-test';
import { uploadChecks } from './publish';

const running: { app: AtlasServer; http: RunningServer }[] = [];
afterEach(async () => { for (const { app, http } of running.splice(0)) { app.close(); await http.close(); } });
async function server() {
  const app = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data', tokens: [{ name: 'ci', role: 'publish', token: 'publish-token-123' }] });
  await app.ready;
  const http = await listen(app.fetch, { host: '127.0.0.1', port: 0, maxBodyBytes: 32 * 1024 * 1024 });
  running.push({ app, http });
  return { app, options: { url: http.url, token: 'publish-token-123', rootDir: '/project' } };
}
function checks(app: AtlasServer) { return app.index.snapshot().layers.flatMap(entry => entry.rows); }

test('Mocha and CodeceptJS await final outcomes and publish one layer to the server', async () => {
  for (const Reporter of [AtlasMochaReporter, AtlasCodeceptReporter]) {
    const { app, options } = await server();
    const runner = new EventEmitter();
    const reporter = new Reporter(runner, { reporterOptions: options });
    runner.emit('pass', { title: 'passes', file: '/project/tests/a.js', fullTitle: () => 'suite passes', duration: 5, currentRetry: () => 1, steps: [{ name: 'click', status: 'passed' }] });
    runner.emit('fail', { title: 'fails', file: '/project/tests/a.js', fullTitle: () => 'suite fails' }, new Error('broken'));
    runner.emit('pending', { title: 'skips', fullTitle: () => 'suite skips' });
    expect(await new Promise<number>(resolve => reporter.done(1, resolve))).toBe(1);
    expect(checks(app).map(check => check.status)).toEqual(['passed', 'failed', 'not-run']);
    expect(checks(app)[0]!.id).toBe('tests/a.js > suite passes');
    expect(checks(app)[0]!.evidence?.labels.flaky).toBe('true');
    expect(checks(app)[0]!.evidence?.steps).toBe(1);
    expect(checks(app)[1]!.detail).toContain('broken');
    expect(app.index.snapshot().layers[0]!.layer.producer).toBe(Reporter === AtlasMochaReporter ? 'mocha' : 'codeceptjs');
  }
});

test('Jest keeps suite crashes, unknown outcomes and duplicate identities; resets watch errors', async () => {
  const { app, options } = await server();
  const reporter = new AtlasJestReporter({}, options);
  const assertion = { title: 'a', fullName: 'suite a', status: 'future', failureMessages: [] };
  await reporter.onRunComplete([], { testResults: [{ testFilePath: '/project/tests/a.js', testResults: [assertion, { ...assertion, status: 'passed', invocations: 2 }], testExecError: { message: 'beforeAll broke' } }] });
  expect(reporter.getLastError()).toBeUndefined();
  expect(checks(app).map(check => check.status)).toEqual(['not-run', 'passed', 'failed']);
  expect(new Set(checks(app).map(check => check.id)).size).toBe(3);
  expect(checks(app)[2]!.detail).toBe('beforeAll broke');
  const denied = new AtlasJestReporter({}, { ...options, token: 'wrong' });
  await denied.onRunComplete([], { testResults: [] });
  expect(denied.getLastError()?.message).toContain('401');
  denied.onRunStart();
  expect(denied.getLastError()).toBeUndefined();
});

test('Node reporter excludes suites, retains nested identities and never passes TODOs', async () => {
  const { app, options } = await server();
  const before = { url: process.env.ATLAS_SERVER_URL, token: process.env.ATLAS_PUBLISH_TOKEN };
  process.env.ATLAS_SERVER_URL = options.url;
  process.env.ATLAS_PUBLISH_TOKEN = options.token;
  try {
    async function* events() {
      yield { type: 'test:start', data: { name: 'suite', nesting: 0 } };
      yield { type: 'test:pass', data: { name: 'a', nesting: 1, file: 'a.js', details: { duration_ms: 1 } } };
      yield { type: 'test:fail', data: { name: 'todo', nesting: 1, todo: true } };
      yield { type: 'test:pass', data: { name: 'skip', nesting: 1, skip: true } };
      yield { type: 'test:pass', data: { name: 'suite', nesting: 0, details: { type: 'suite' } } };
    }
    const lines = [];
    for await (const line of atlasNodeReporter(events())) lines.push(line);
    expect(lines).toEqual(['Atlas: uploaded 3 checks\n']);
    expect(checks(app).map(check => check.status)).toEqual(['passed', 'not-run', 'not-run']);
    expect(checks(app)[0]!.id).toBe('a.js > suite > a');
  } finally {
    if (before.url === undefined) delete process.env.ATLAS_SERVER_URL; else process.env.ATLAS_SERVER_URL = before.url;
    if (before.token === undefined) delete process.env.ATLAS_PUBLISH_TOKEN; else process.env.ATLAS_PUBLISH_TOKEN = before.token;
  }
});

test('Node suite hook failures remain failed checks while failed-child summaries are excluded', async () => {
  const { app, options } = await server();
  const priorUrl = process.env.ATLAS_SERVER_URL, priorToken = process.env.ATLAS_PUBLISH_TOKEN;
  process.env.ATLAS_SERVER_URL = options.url;
  process.env.ATLAS_PUBLISH_TOKEN = options.token;
  try {
    async function* events() {
      yield { type: 'test:fail', data: { name: 'setup failed', details: { type: 'suite', error: { message: 'before hook failed', failureType: 'hookFailed' } } } };
      yield { type: 'test:fail', data: { name: 'child summary', details: { type: 'suite', error: { failureType: 'subtestsFailed' } } } };
    }
    for await (const _ of atlasNodeReporter(events())) { /* consume */ }
    expect(checks(app).map(check => [check.title, check.status])).toEqual([['setup failed', 'failed']]);
  } finally {
    if (priorUrl === undefined) delete process.env.ATLAS_SERVER_URL; else process.env.ATLAS_SERVER_URL = priorUrl;
    if (priorToken === undefined) delete process.env.ATLAS_PUBLISH_TOKEN; else process.env.ATLAS_PUBLISH_TOKEN = priorToken;
  }
});

test('bad destination and publication errors cannot silently pass CI', async () => {
  await expect(uploadChecks('mocha', [], { url: 'file:///tmp/report' })).rejects.toThrow('HTTP(S)');
  const { options } = await server();
  await expect(uploadChecks('mocha', [], { ...options, token: 'bad-token' })).rejects.toThrow('401');
  const runner = new EventEmitter();
  const reporter = new AtlasMochaReporter(runner, { reporterOptions: { ...options, token: 'bad-token' } });
  expect(await new Promise<number>(resolve => reporter.done(0, resolve))).toBe(1);
});
