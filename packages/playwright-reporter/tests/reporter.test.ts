import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FullConfig, Suite, TestCase, TestResult, TestStep } from 'playwright/types/testReporter';
import { readLayer, readLayerFile } from '../../reports/src/layer-store';
import type { ObjectStore } from '../../reports/src/object-store';
import type { ReportLayer } from '../../reports/src/layer-types';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../../server/src/app';
import { listen, type RunningServer } from '../../server/src/host';
import AtlasPlaywrightReporter, { bddFeaturePath, type AtlasPlaywrightReporterOptions } from '../src/index';

const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'atlas-pw-'));
  temps.push(dir);
  mkdirSync(path.join(dir, '.git'));
  return dir;
}

const ENV = { GITHUB_SHA: 'abc123', GITHUB_REF_NAME: 'main', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'acme/web', GITHUB_RUN_ID: '42' };
const T0 = Date.UTC(2026, 0, 1);

// Minimal Playwright objects: only what the reporter reads.
type Use = Record<string, unknown>;
function projectSuite(root: Suite, name: string, use: Use): Suite {
  const suite = { type: 'project', title: name, parent: root, suites: [], tests: [], project: () => ({ name, use }), allTests: () => all(suite as unknown as Suite) } as unknown as Suite;
  root.suites.push(suite);
  return suite;
}
function all(suite: Suite): TestCase[] { return [...suite.tests, ...suite.suites.flatMap(all)]; }
function rootSuite(): Suite { return { type: 'root', title: '', suites: [], tests: [], project: () => undefined, allTests: () => [] } as unknown as Suite; }
function childSuite(parent: Suite, type: 'file' | 'describe', title: string): Suite {
  const suite = { type, title, parent, suites: [], tests: [], project: () => parent.project(), allTests: () => all(suite as unknown as Suite) } as unknown as Suite;
  parent.suites.push(suite);
  return suite;
}
function testCase(parent: Suite, title: string, file: string, extra: Partial<TestCase> = {}): TestCase {
  const test = { type: 'test', title, parent, id: `id-${title}`, location: { file, line: 3, column: 1 }, expectedStatus: 'passed', retries: 0, repeatEachIndex: 0, tags: [], annotations: [], results: [], timeout: 30_000, ...extra } as unknown as TestCase;
  parent.tests.push(test);
  return test;
}
function step(title: string, category: string, startMs: number, duration: number, steps: TestStep[] = [], error?: { message: string }): TestStep {
  return { title, category, startTime: new Date(T0 + startMs), duration, steps, annotations: [], attachments: [], ...(error ? { error } : {}) } as unknown as TestStep;
}
function result(status: TestResult['status'], extra: Partial<TestResult> = {}): TestResult {
  return { status, retry: 0, duration: 1234, startTime: new Date(T0), steps: [], attachments: [], stdout: [], stderr: [], errors: [], annotations: [], workerIndex: 0, parallelIndex: 0, ...extra } as unknown as TestResult;
}
const config = (rootDir: string): FullConfig => ({ rootDir, version: '1.60.0', projects: [], shard: null } as unknown as FullConfig);

/** Run one test through begin and end, with every result it had (a retry is several). */
function run(reporter: AtlasPlaywrightReporter, test: TestCase, results: TestResult[]): void {
  for (const one of results) {
    reporter.onTestBegin(test, one);
    (test.results as TestResult[]).push(one);
    reporter.onTestEnd(test, one);
  }
}

async function layersOf(store: ObjectStore): Promise<ReportLayer[]> {
  const keys = await store.listKeys('layers/manifests/');
  const layers = await Promise.all(keys.map(key => readLayer(store, key.slice('layers/manifests/'.length, -'.json'.length))));
  return (layers.filter(Boolean) as ReportLayer[]).sort((a, b) => a.recordedAtMs - b.recordedAtMs);
}
type StoredCheck = ReportLayer['parts'][number]['checks'][number] & Record<string, any>;
const checksOf = (layer: ReportLayer) => layer.parts.flatMap(part => part.checks) as StoredCheck[];

function reporterWith(store: ObjectStore, options: AtlasPlaywrightReporterOptions = {}) {
  const lines: string[] = [];
  const reporter = new AtlasPlaywrightReporter({ store, env: ENV, flushMs: 0, log: line => lines.push(line), ...options });
  return { reporter, lines };
}

describe('Playwright Test reporter', () => {
  test('one stream per project: environment, labels, duration, steps, specs and origin', async () => {
    const dir = repo();
    const store = memoryStore();
    const root = rootSuite();
    const desktop = projectSuite(root, 'Desktop Chrome', { browserName: 'chromium', viewport: { width: 1280, height: 720 } });
    const mobile = projectSuite(root, 'Pixel 7', { defaultBrowserType: 'chromium', isMobile: true, viewport: { width: 412, height: 839 } });
    const file = path.join(dir, 'e2e', 'checkout.spec.ts');
    const tests = [desktop, mobile].map(project => testCase(childSuite(childSuite(project, 'file', 'e2e/checkout.spec.ts'), 'describe', 'Checkout'), 'pays by card', file, { tags: ['@smoke'] }));
    const { reporter, lines } = reporterWith(store);
    reporter.onBegin(config(dir), root);
    const steps = [step('Before Hooks', 'hook', 0, 10, [step('fixture: page', 'fixture', 1, 8)]), step('pay', 'test.step', 20, 500, [step('page.click(#pay)', 'pw:api', 30, 40), step('expect(toHaveText)', 'expect', 80, 5)])];
    for (const one of tests) run(reporter, one, [result('passed', { duration: 777, steps })]);
    await reporter.onEnd();

    const layers = await layersOf(store);
    expect(layers.map(layer => layer.environment).sort()).toEqual(['desktop-web', 'mobile-web']);
    const desktopLayer = layers.find(layer => layer.environment === 'desktop-web')!;
    expect(desktopLayer).toMatchObject({ producer: 'playwright', sha: 'abc123', branch: 'main', runUrl: 'https://github.com/acme/web/actions/runs/42', parameters: {} });
    expect(desktopLayer.specs).toEqual([{ path: 'e2e/checkout.spec.ts', domain: 'e2e', kind: 'ts', title: 'checkout.spec.ts' }]);
    const [check] = checksOf(desktopLayer);
    expect(check).toMatchObject({ id: 'e2e/checkout.spec.ts#Checkout > pays by card', title: 'pays by card', status: 'passed', specPath: 'e2e/checkout.spec.ts', durationMs: 777, tags: ['smoke'] });
    expect(check!.labels).toEqual({ browser: 'chromium', device: 'Desktop Chrome', viewport: '1280x720', os: process.platform, playwright: '1.60.0' });
    expect(checksOf(layers.find(layer => layer.environment === 'mobile-web')!)[0]!.labels).toMatchObject({ browser: 'chromium', device: 'Pixel 7', viewport: '412x839' });
    expect(check!.steps).toEqual([
      { id: 's1', name: 'Before Hooks', kind: 'hook', status: 'passed', offsetMs: 0, durationMs: 10 },
      { id: 's2', parentId: 's1', name: 'fixture: page', kind: 'fixture', status: 'passed', offsetMs: 1, durationMs: 8 },
      { id: 's3', name: 'pay', kind: 'step', status: 'passed', offsetMs: 20, durationMs: 500 },
      { id: 's4', parentId: 's3', name: 'page.click(#pay)', kind: 'action', status: 'passed', offsetMs: 30, durationMs: 40 },
      { id: 's5', parentId: 's3', name: 'expect(toHaveText)', kind: 'assertion', status: 'passed', offsetMs: 80, durationMs: 5 }
    ]);
    expect(lines).toEqual(['Atlas: 2 checks in 2 layers to the given store']);
  });

  test('names the execution from the option or ATLAS_RUN_ID, so shards of one invocation share a run', async () => {
    const dir = repo();
    const file = path.join(dir, 'e2e', 'checkout.spec.ts');
    const publish = async (options: AtlasPlaywrightReporterOptions, env: Record<string, string> = {}) => {
      const store = memoryStore();
      const root = rootSuite();
      const project = projectSuite(root, 'Desktop Chrome', { browserName: 'chromium' });
      const one = testCase(childSuite(childSuite(project, 'file', 'e2e/checkout.spec.ts'), 'describe', 'Checkout'), 'pays by card', file);
      const { reporter } = reporterWith(store, { ...options, env: { ...ENV, ...env } });
      reporter.onBegin(config(dir), root);
      run(reporter, one, [result('passed', { duration: 5 })]);
      await reporter.onEnd();
      return (await layersOf(store))[0]!;
    };
    expect((await publish({ run: { id: 'demo-1', title: 'Demo' } })).run).toEqual({ id: 'demo-1', title: 'Demo' });
    expect((await publish({}, { ATLAS_RUN_ID: 'demo-2', ATLAS_RUN_TITLE: 'From env' })).run).toEqual({ id: 'demo-2', title: 'From env' });
    expect(await publish({})).not.toHaveProperty('run');
  });

  test('a test that passed on retry is passed, tagged flaky, with an attempt per try and the failed try\'s evidence', async () => {
    const dir = repo();
    const store = memoryStore();
    const root = rootSuite();
    const project = projectSuite(root, 'chromium', { browserName: 'chromium' });
    const one = testCase(childSuite(project, 'file', 'a.spec.ts'), 'sometimes', path.join(dir, 'a.spec.ts'), { retries: 2 });
    const { reporter } = reporterWith(store);
    reporter.onBegin(config(dir), root);
    const shot = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    run(reporter, one, [
      result('failed', { retry: 0, duration: 100, error: { message: '\u001b[31mTimeout\u001b[39m 5000ms exceeded' }, attachments: [{ name: 'screenshot', contentType: 'image/png', body: Buffer.from(shot) }] }),
      result('passed', { retry: 1, duration: 200, startTime: new Date(T0 + 1000) })
    ]);
    await reporter.onEnd();

    const [layer] = await layersOf(store);
    const [check] = checksOf(layer!);
    expect(check).toMatchObject({ status: 'passed', durationMs: 200, tags: ['flaky'], labels: { flaky: 'true', retries: '1' } });
    expect(check!.detail).toBe('Passed on retry 1 (flaky): Timeout 5000ms exceeded');
    expect(check!.attempts).toHaveLength(2);
    expect(check!.attempts![0]).toMatchObject({ index: 0, status: 'failed', durationMs: 100, startedAtMs: T0, detail: 'Timeout 5000ms exceeded' });
    expect(check!.attempts![1]).toMatchObject({ index: 1, status: 'passed', durationMs: 200, startedAtMs: T0 + 1000 });
    const stored = check!.attempts![0]!.attachments![0]!;
    expect(stored).toMatchObject({ name: 'screenshot', role: 'screenshot', contentType: 'image/png', bytes: shot.length });
    expect((await readLayerFile(store, layer!.id, stored.bundleKey!))!.bytes).toEqual(shot);
  });

  test('a failure carries its detail without terminal codes and uploads video, trace, screenshot and output', async () => {
    const dir = repo();
    const store = memoryStore();
    const root = rootSuite();
    const project = projectSuite(root, 'firefox', { browserName: 'firefox' });
    const one = testCase(childSuite(project, 'file', 'b.spec.ts'), 'breaks', path.join(dir, 'b.spec.ts'));
    const video = path.join(dir, 'video.webm');
    const trace = path.join(dir, 'trace.zip');
    writeFileSync(video, new Uint8Array([26, 69, 223, 163, 9, 9]));
    writeFileSync(trace, new Uint8Array([80, 75, 3, 4, 7]));
    const { reporter } = reporterWith(store);
    reporter.onBegin(config(dir), root);
    run(reporter, one, [result('failed', {
      error: { message: '\u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m).toBe(expected)', stack: 'Error: \u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m).toBe(expected)\n    at b.spec.ts:3:1' },
      steps: [step('expect.toBe', 'expect', 5, 1, [], { message: '\u001b[31mnope\u001b[39m' })],
      attachments: [
        { name: 'video', contentType: 'video/webm', path: video },
        { name: 'trace', contentType: 'application/zip', path: trace },
        { name: 'screenshot', contentType: 'image/png', body: Buffer.from([1, 2, 3]) },
        { name: 'har', contentType: 'application/json', body: Buffer.from('{}') }
      ],
      stdout: ['hello\n'], stderr: [Buffer.from('warn\n')]
    })]);
    await reporter.onEnd();

    const [layer] = await layersOf(store);
    const [check] = checksOf(layer!);
    expect(check!.status).toBe('failed');
    expect(check!.detail).toBe('Error: expect(received).toBe(expected)\n    at b.spec.ts:3:1');
    expect(check!.detail).not.toContain('\u001b');
    expect(check!.steps![0]).toMatchObject({ status: 'failed', detail: 'nope', kind: 'assertion' });
    const byRole = Object.fromEntries(check!.attachments!.map((item: any) => [item.role, item]));
    expect(Object.keys(byRole).sort()).toEqual(['har', 'log', 'screenshot', 'trace', 'video']);
    expect(byRole.video).toMatchObject({ name: 'video.webm', contentType: 'video/webm', bytes: 6 });
    expect(byRole.trace).toMatchObject({ name: 'trace.zip', contentType: 'application/zip', bytes: 5 });
    expect((await readLayerFile(store, layer!.id, byRole.video.bundleKey))!.bytes).toEqual(new Uint8Array([26, 69, 223, 163, 9, 9]));
    expect((await readLayerFile(store, layer!.id, byRole.trace.bundleKey))!.bytes).toEqual(new Uint8Array([80, 75, 3, 4, 7]));
    expect(check!.attachments!.filter((item: any) => item.role === 'log').map((item: any) => [item.name, item.text])).toEqual([['stdout', 'hello\n'], ['stderr', 'warn\n']]);
    expect(check!.extensions!.playwright).toMatchObject({ testId: 'id-breaks', location: { file: 'b.spec.ts', line: 3, column: 1 }, status: 'failed' });
  });

  test('a test is reported running when it starts and with its result when it ends', async () => {
    const dir = repo();
    const store = memoryStore();
    const root = rootSuite();
    const project = projectSuite(root, 'chromium', {});
    const one = testCase(childSuite(project, 'file', 'c.spec.ts'), 'runs', path.join(dir, 'c.spec.ts'));
    const { reporter } = reporterWith(store, { batchSize: 1 });
    reporter.onBegin(config(dir), root);
    run(reporter, one, [result('passed')]);
    await reporter.onEnd();
    const layers = await layersOf(store);
    expect(layers.map(layer => checksOf(layer)[0]!.status)).toEqual(['running', 'passed']);
  });

  test('skipped is not-run; a test the run never finished is not-run, never left running', async () => {
    const dir = repo();
    const store = memoryStore();
    const root = rootSuite();
    const file = childSuite(projectSuite(root, 'chromium', {}), 'file', 'd.spec.ts');
    const skipped = testCase(file, 'later', path.join(dir, 'd.spec.ts'), { annotations: [{ type: 'skip', description: 'not on CI' }] });
    const cut = testCase(file, 'cut short', path.join(dir, 'd.spec.ts'));
    const { reporter } = reporterWith(store);
    reporter.onBegin(config(dir), root);
    run(reporter, skipped, [result('skipped', { duration: 0 })]);
    reporter.onTestBegin(cut, result('passed'));
    await reporter.onEnd();
    const checks = Object.fromEntries(checksOf((await layersOf(store))[0]!).map(check => [check.title, check]));
    expect(checks.later).toMatchObject({ status: 'not-run', detail: 'Skipped: not on CI', tags: ['skip'], annotations: [{ type: 'skip', message: 'not on CI' }] });
    expect(checks['cut short']).toMatchObject({ status: 'not-run', detail: 'The run ended before this test finished' });
  });

  test('a playwright-bdd test belongs to its .feature, with the scenario outline in its title', async () => {
    const dir = repo();
    mkdirSync(path.join(dir, 'e2e', 'features', 'auth'), { recursive: true });
    writeFileSync(path.join(dir, 'e2e', 'features', 'auth', 'login.feature'), 'Feature: Login\n');
    const store = memoryStore();
    const root = rootSuite();
    const generated = path.join(dir, 'e2e', '.features-gen', 'mobile', 'features', 'auth', 'login.feature.spec.js');
    const feature = childSuite(childSuite(projectSuite(root, 'mobile', { isMobile: true }), 'file', 'login.feature.spec.js'), 'describe', 'Login');
    const outline = childSuite(feature, 'describe', 'Signs in with a role');
    const one = testCase(outline, 'Example #1', generated, { tags: ['@auth'] });
    const { reporter } = reporterWith(store);
    reporter.onBegin(config(path.join(dir, 'e2e')), root);
    run(reporter, one, [result('passed', { steps: [step('Given I am on the login page', 'test.step', 0, 3)] })]);
    await reporter.onEnd();
    const [layer] = await layersOf(store);
    const [check] = checksOf(layer!);
    expect(check).toMatchObject({ specPath: 'e2e/features/auth/login.feature', id: 'e2e/features/auth/login.feature#Login > Signs in with a role > Example #1', title: 'Signs in with a role: Example #1', tags: ['auth'] });
    expect(check!.steps![0]!.kind).toBe('given');
    expect(layer!.environment).toBe('mobile-web');
    expect(layer!.specs).toEqual([{ path: 'e2e/features/auth/login.feature', domain: 'auth', kind: 'feature', title: 'Login' }]);
  });

  test('bddFeaturePath maps generated files back to features, and leaves other files alone', () => {
    const exists = (file: string) => file === '/repo/features/a.feature';
    expect(bddFeaturePath('/repo/.features-gen/features/a.feature.spec.js', exists)).toBe('/repo/features/a.feature');
    expect(bddFeaturePath('/repo/.features-gen/desktop/features/a.feature.spec.js', exists)).toBe('/repo/features/a.feature');
    expect(bddFeaturePath('/repo/.features-gen/missing/b.feature.spec.js', exists)).toBe('/repo/missing/b.feature');
    expect(bddFeaturePath('/repo/tests/a.spec.ts', exists)).toBeUndefined();
  });

  test('an attachment over the limit is skipped with an annotation; the rest still upload', async () => {
    const dir = repo();
    const store = memoryStore();
    const root = rootSuite();
    const one = testCase(childSuite(projectSuite(root, 'chromium', {}), 'file', 'e.spec.ts'), 'big', path.join(dir, 'e.spec.ts'));
    const video = path.join(dir, 'big.webm');
    writeFileSync(video, new Uint8Array(64));
    const { reporter } = reporterWith(store, { maxAttachmentBytes: 16 });
    reporter.onBegin(config(dir), root);
    run(reporter, one, [result('failed', { error: { message: 'x' }, attachments: [{ name: 'video', contentType: 'video/webm', path: video }, { name: 'screenshot', contentType: 'image/png', body: Buffer.from([1]) }, { name: 'gone', contentType: 'text/plain', path: path.join(dir, 'missing.txt') }] })]);
    await reporter.onEnd();
    const [check] = checksOf((await layersOf(store))[0]!);
    expect(check!.attachments!.map((item: any) => item.role)).toEqual(['screenshot']);
    expect(check!.annotations).toEqual([
      { type: 'attachment-skipped', level: 'warning', message: 'big.webm (64 bytes) was not uploaded: larger than maxAttachmentBytes (16)' },
      expect.objectContaining({ type: 'attachment-skipped', message: expect.stringContaining('missing.txt could not be read') })
    ]);
  });

  test('attachments: failures uploads only for failed results; none uploads nothing', async () => {
    for (const [mode, expected] of [['failures', ['screenshot']], ['none', []]] as const) {
      const dir = repo();
      const store = memoryStore();
      const root = rootSuite();
      const file = childSuite(projectSuite(root, 'chromium', {}), 'file', 'f.spec.ts');
      const ok = testCase(file, 'ok', path.join(dir, 'f.spec.ts'));
      const bad = testCase(file, 'bad', path.join(dir, 'f.spec.ts'));
      const { reporter } = reporterWith(store, { attachments: mode });
      reporter.onBegin(config(dir), root);
      const shot = [{ name: 'screenshot', contentType: 'image/png', body: Buffer.from([1]) }];
      run(reporter, ok, [result('passed', { attachments: shot })]);
      run(reporter, bad, [result('failed', { error: { message: 'x' }, attachments: shot })]);
      await reporter.onEnd();
      const checks = Object.fromEntries(checksOf((await layersOf(store))[0]!).map(check => [check.title, check]));
      expect(checks.ok!.attachments).toBeUndefined();
      expect((checks.bad!.attachments ?? []).map((item: any) => item.role)).toEqual([...expected]);
    }
  });

  test('never throws into the run when the store fails, and says so once', async () => {
    const dir = repo();
    const store = memoryStore();
    store.put = async () => { throw new Error('disk on fire'); };
    const root = rootSuite();
    const file = childSuite(projectSuite(root, 'chromium', {}), 'file', 'g.spec.ts');
    const { reporter, lines } = reporterWith(store, { attempts: 1, batchSize: 1 });
    reporter.onBegin(config(dir), root);
    for (const title of ['one', 'two', 'three']) run(reporter, testCase(file, title, path.join(dir, 'g.spec.ts')), [result('passed')]);
    await reporter.onEnd();
    expect(lines.filter(line => line.includes('disk on fire'))).toHaveLength(1);
    expect(lines.at(-1)).toMatch(/^Atlas: 3 checks in 0 layers to the given store; \d+ could not be sent$/);
  });

  test('without a destination it says how to configure one, once, and does nothing else', async () => {
    const lines: string[] = [];
    const reporter = new AtlasPlaywrightReporter({ env: {}, log: line => lines.push(line) });
    const root = rootSuite();
    const one = testCase(childSuite(projectSuite(root, 'chromium', {}), 'file', 'h.spec.ts'), 'x', '/nowhere/h.spec.ts');
    reporter.onBegin(config('/nowhere'), root);
    run(reporter, one, [result('passed')]);
    await reporter.onEnd();
    expect(lines).toEqual([expect.stringContaining('set ATLAS_SERVER_URL')]);
  });
});

describe('against an Atlas server', () => {
  const running: { app: AtlasServer; http: RunningServer }[] = [];
  afterEach(async () => { for (const { app, http } of running.splice(0)) { app.close(); await http.close(); } });

  test('uploads checks and their video through ATLAS_SERVER_URL and ATLAS_TOKEN', async () => {
    const backend = memoryStore();
    const app = createAtlasServer({ backends: [{ id: 'data', store: backend }], write: 'data', tokens: [{ name: 'ci', role: 'publish', token: 'publish-token-123' }] });
    await app.ready;
    const http = await listen(app.fetch, { host: '127.0.0.1', port: 0, maxBodyBytes: 32 * 1024 * 1024 });
    running.push({ app, http });

    const dir = repo();
    const video = path.join(dir, 'video.webm');
    const bytes = new Uint8Array(5 * 1024 * 1024).map((_, index) => index % 251);
    writeFileSync(video, bytes);
    const lines: string[] = [];
    const reporter = new AtlasPlaywrightReporter({ env: { ...ENV, ATLAS_SERVER_URL: http.url, ATLAS_TOKEN: 'publish-token-123' }, flushMs: 0, producer: 'e2e-web', log: line => lines.push(line) });
    const root = rootSuite();
    const one = testCase(childSuite(projectSuite(root, 'webkit', { browserName: 'webkit' }), 'file', 'i.spec.ts'), 'records', path.join(dir, 'i.spec.ts'));
    reporter.onBegin(config(dir), root);
    run(reporter, one, [result('failed', { error: { message: 'boom' }, attachments: [{ name: 'video', contentType: 'video/webm', path: video }] })]);
    await reporter.onEnd();

    expect(lines).toEqual([`Atlas: 1 checks in 1 layer to ${http.url}`]);
    const [layer] = await layersOf(backend);
    expect(layer!.producer).toBe('e2e-web');
    const [check] = checksOf(layer!);
    expect(check).toMatchObject({ status: 'failed', detail: 'boom', labels: { browser: 'webkit' } });
    expect((await readLayerFile(backend, layer!.id, check!.attachments![0]!.bundleKey!))!.bytes).toEqual(bytes);
  });
});
