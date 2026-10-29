import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CriticDoctorResultSchema, CriticListResultSchema, CriticRunResultSchema, CriticSetupResultSchema } from '../../schema/src/cli-results';
import { httpStore } from '../../reports/src/http-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { uiStateLayer } from '../../reports/src/ui-catalog-publish';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../../server/src/app';
import { listen, type RunningServer } from '../../server/src/host';
import { createCatalogClient } from '../src/catalog-client';
import { criticMain, CRITIC_USAGE, type CriticIo } from '../src/cli';
import { loadCriticsConfig } from '../src/registry';

// Obviously fake credentials: nothing here is, or looks like, a real key.
const TOKENS = [
  { name: 'ci', role: 'publish' as const, token: 'fake-publish-token-for-tests' },
  { name: 'critic', role: 'critic' as const, token: 'fake-critic-token-for-tests' },
  { name: 'eyes', role: 'read' as const, token: 'fake-read-token-for-tests' }
];
/** A function that stands in for `fetch`. */
const asFetch = (fake: unknown) => fake as typeof fetch;
const PROVIDER_KEY = 'fake-provider-key-for-tests';

const running: { server: AtlasServer; http: RunningServer }[] = [];
let dir = '';
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'atlas-critic-cli-')); });
afterEach(async () => {
  for (const { server, http } of running.splice(0)) { server.close(); await http.close(200); }
  await rm(dir, { recursive: true, force: true });
  delete (globalThis as Record<string, unknown>).__criticCalls;
});

async function start(tokens: typeof TOKENS | 'open' = TOKENS) {
  const store = memoryStore();
  const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', ...(tokens === 'open' ? {} : { tokens }), refreshMs: 60_000, heartbeatMs: 50 });
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
  running.push({ server, http });
  await server.ready;
  const url = `http://127.0.0.1:${http.port}`;
  const publisher = httpStore({ url, ...(tokens === 'open' ? {} : { token: TOKENS[0]!.token }), retries: 0 });
  return { store, url, publisher };
}

const png = (id: string) => new TextEncoder().encode(`\x89PNG fake image of ${id}`);
const states = (...items: [string, string?][]) => items.map(([id, kind]) => ({ id, route: `/${id}`, ...(kind ? { kind } : {}), screenshot: { data: png(id) } }));

/** A critic of the project's own: counts its calls so a test can tell that nothing was judged. */
const moduleCritic = (name: string, extra = '', sends = 'null') => `
export default {
  name: ${JSON.stringify(name)}, version: '1.0.0', kind: 'heuristic',
  describe: () => ({ sendsImagesTo: ${sends}, needsSetup: false }),
  async evaluate({ image, entry }) {
    globalThis.__criticCalls = (globalThis.__criticCalls ?? 0) + 1;
    ${extra}
    return { verdict: { score: (image.length % 10) / 10, scale: '0..1' } };
  }
};
`;
const calls = () => ((globalThis as Record<string, unknown>).__criticCalls as number | undefined) ?? 0;

async function configure(critics: Record<string, unknown>, files: Record<string, string> = {}, server?: Record<string, unknown>) {
  await writeFile(path.join(dir, 'atlas.critics.json'), JSON.stringify({ ...(server ? { server } : {}), critics }));
  for (const [name, content] of Object.entries(files)) { await mkdir(path.dirname(path.join(dir, name)), { recursive: true }); await writeFile(path.join(dir, name), content); }
}

function io(overrides: Partial<CriticIo> = {}): CriticIo & { text: () => string } {
  let out = '';
  return { out: text => { out += text; }, cwd: dir, env: { ATLAS_CRITIC_TOKEN: TOKENS[1]!.token }, interactive: false, sleep: async () => {}, ...overrides, text: () => out };
}

async function json<T>(args: string[], overrides: Partial<CriticIo> = {}): Promise<{ code: number; doc: T; text: string }> {
  const context = io(overrides);
  const code = await criticMain([...args, '--format', 'json'], context);
  return { code, doc: JSON.parse(context.text()) as T, text: context.text() };
}

describe('atlas critic run', () => {
  test('judges the catalog, publishes critiques, and a second run skips what is already judged; --format json validates against the published schema (34)', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['home', 'screen'], ['spinner', 'loading'], ['error', 'error']) }));
    await configure({ contrast: { type: 'module', module: 'contrast.mjs' } }, { 'contrast.mjs': moduleCritic('contrast') });
    const first = await json<{ ok: boolean; critics: { judged: number; skipped: number; published: { layer: string | null; critiques: number } }[] }>(['run', '--critic', 'contrast', '--all', '--server', url]);
    expect(CriticRunResultSchema.safeParse(first.doc).success).toBe(true);
    expect(first.code).toBe(0);
    expect(first.doc.critics[0]).toMatchObject({ judged: 3, skipped: 0, published: { critiques: 3 } });
    expect(first.doc.critics[0]!.published.layer).toMatch(/^[0-9a-f]{64}$/);
    const entries = (await createCatalogClient({ url, token: TOKENS[1]!.token }).read({})).entries;
    expect(entries.every(entry => entry.critiques.length === 1 && entry.critiques[0]!.currency === 'current')).toBe(true);
    // The score is read against the same state kind.
    expect(entries[0]!.critiques[0]!.critique.verdict!.relative).toMatchObject({ stateKind: expect.any(String) });
    expect(calls()).toBe(3);
    const second = await json<{ critics: { judged: number; skipped: number; published: { layer: string | null } }[] }>(['run', '--critic', 'contrast', '--all', '--server', url]);
    expect(second.doc.critics[0]).toMatchObject({ judged: 0, skipped: 3, published: { layer: null } });
    expect(calls()).toBe(3);
    // A scope narrows the catalog.
    const scoped = await json<{ critics: { entries: number }[]; scope: Record<string, string> }>(['run', '--critic', 'contrast', '--state', 'loading', '--force', '--server', url]);
    expect(scoped.doc.critics[0]!.entries).toBe(1);
    expect(scoped.doc.scope).toEqual({ state: 'loading' });
  });

  test('33. without a terminal, a run missing its choices exits 2, names every missing flag and asks nothing', async () => {
    await configure({ contrast: { type: 'module', module: 'contrast.mjs' } }, { 'contrast.mjs': moduleCritic('contrast') });
    let asked = 0;
    const context = io({ env: {}, ask: async () => { asked += 1; return ''; } });
    await expect(criticMain(['run'], context)).rejects.toThrow(/--critic <name>.*--server <url>.*a scope: --all, --unjudged/);
    expect(asked).toBe(0);
    await expect(criticMain(['run', '--critic', 'contrast', '--server', 'http://127.0.0.1:1'], context)).rejects.toThrow(/a scope/);
    // The terminal wrapper turns it into exit code 2 and a JSON document on standard error.
    const { runCriticCommand } = await import('../src/cli');
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((text: string) => { written.push(String(text)); return true; }) as typeof process.stderr.write;
    try { expect(await runCriticCommand(['run', '--format', 'json'], { cwd: dir, env: {}, out: () => {} })).toBe(2); } finally { process.stderr.write = original; }
    expect(JSON.parse(written.join(''))).toMatchObject({ ok: false, error: { code: 'usage' } });
  });

  test('with a terminal, the missing choices are asked for', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['home']) }));
    await configure({ contrast: { type: 'module', module: 'contrast.mjs' } }, { 'contrast.mjs': moduleCritic('contrast') });
    const questions: string[] = [];
    const answers = ['contrast', url, 'a'];
    const context = io({ interactive: true, ask: async question => { questions.push(question); return answers.shift()!; } });
    expect(await criticMain(['run'], context)).toBe(0);
    expect(questions.map(question => question.split('?')[0])).toEqual(['Which critic (contrast)', 'Atlas server address', 'Scope: judge (a)ll entries, or only those (u)njudged by this critic']);
    expect(calls()).toBe(1);
  });

  test('32. a critic that would send images to a third party shows the destination: interactively it needs a yes, otherwise --yes', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['home'], ['cart']) }));
    await configure({ remote: { type: 'module', module: 'remote.mjs' } }, { 'remote.mjs': moduleCritic('remote', '', "'vision.example.com'") });
    const args = ['run', '--critic', 'remote', '--all', '--server', url];
    await expect(criticMain(args, io())).rejects.toThrow(/sends images to vision\.example\.com: pass --yes/);
    expect(calls()).toBe(0);
    // Interactively: the destination and the count are on the question, and anything but yes stops.
    let question = '';
    await expect(criticMain(args, io({ interactive: true, ask: async text => { question = text; return 'n'; } }))).rejects.toThrow(/not confirmed/);
    expect(question).toContain('vision.example.com');
    expect(question).toContain('2 images');
    expect(calls()).toBe(0);
    expect(await criticMain(args, io({ interactive: true, ask: async () => 'y' }))).toBe(0);
    expect(calls()).toBe(2);
    expect(await criticMain([...args, '--force', '--yes'], io())).toBe(0);
    expect(calls()).toBe(4);
  });

  test('35. --dry-run says what would be judged and where images would go, and sends and publishes nothing', async () => {
    const { url, publisher, store } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['home'], ['cart']) }));
    await configure({ remote: { type: 'module', module: 'remote.mjs' } }, { 'remote.mjs': moduleCritic('remote', '', "'vision.example.com'") });
    const before = (await store.listKeys('')).length;
    const { doc, code } = await json<{ dryRun: boolean; critics: { sendsImagesTo: string; waiting: number; judged: number; published: { layer: string | null } }[] }>(['run', '--critic', 'remote', '--all', '--dry-run', '--server', url]);
    expect(code).toBe(0);
    expect(doc).toMatchObject({ dryRun: true, critics: [{ sendsImagesTo: 'vision.example.com', waiting: 2, judged: 0, published: { layer: null } }] });
    expect(calls()).toBe(0);
    expect((await store.listKeys('')).length).toBe(before);
  });

  test('a critic that fails on an entry is recorded as failed with its reason, exits 1, and is retried by the next run', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['home'], ['cart']) }));
    await configure({ flaky: { type: 'module', module: 'flaky.mjs' } }, { 'flaky.mjs': moduleCritic('flaky', "if (entry.key.startsWith('cart') && !globalThis.__criticHealed) throw new Error('model fell over');") });
    const first = await json<{ ok: boolean; critics: { judged: number; failed: number; failures: { entry: string; reason: string }[] }[] }>(['run', '--critic', 'flaky', '--all', '--server', url]);
    expect(first.code).toBe(1);
    expect(first.doc).toMatchObject({ ok: false, critics: [{ judged: 1, failed: 1, failures: [{ entry: 'cart@ios', reason: 'error' }] }] });
    (globalThis as Record<string, unknown>).__criticHealed = true;
    const second = await json<{ critics: { judged: number; skipped: number; failed: number }[] }>(['run', '--critic', 'flaky', '--all', '--server', url]);
    delete (globalThis as Record<string, unknown>).__criticHealed;
    expect(second.code).toBe(0);
    expect(second.doc.critics[0]).toMatchObject({ judged: 1, skipped: 1, failed: 0 });
  });

  test('15/16. report never fails on a low score, warn lists it, gate is refused without calibrated held-out evidence and fails once it has it', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['home', 'screen']) }));
    await configure({ low: { type: 'module', module: 'low.mjs' } }, { 'low.mjs': moduleCritic('low').replace('(image.length % 10) / 10', '0.1') });
    const base = ['run', '--critic', 'low', '--all', '--server', url, '--threshold', 'screen=0.5'];
    expect(await criticMain(base, io())).toBe(0);
    const warn = io();
    expect(await criticMain([...base, '--mode', 'warn'], warn)).toBe(0);
    expect(warn.text()).toContain('home@ios');
    expect(warn.text()).toContain('scored 0.1, below 0.5');
    // Gate without a calibration is refused before anything is spent.
    const before = calls();
    await expect(criticMain([...base, '--mode', 'gate', '--force'], io())).rejects.toThrow(/gate was refused for low@1\.0\.0[\s\S]*No calibration for state kind "screen"/);
    expect(calls()).toBe(before);
    const calibration = { schema: 1, critic: { name: 'low', version: '1.0.0' }, kinds: [{ stateKind: 'screen', threshold: 0.5, samples: 40, positives: 20, negatives: 20, precision: 0.9, recall: 0.8, inSample: false, evaluatedOn: 'held-out' }] };
    await writeFile(path.join(dir, 'calibration.json'), JSON.stringify(calibration));
    const gated = io();
    expect(await criticMain([...base, '--mode', 'gate', '--calibration', 'calibration.json'], gated)).toBe(1);
    expect(gated.text()).toContain('gate: 1 score below threshold');
  });

  test('a budget stops the run cleanly and says so', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['a'], ['b'], ['c']) }));
    await configure({ contrast: { type: 'module', module: 'contrast.mjs' } }, { 'contrast.mjs': moduleCritic('contrast') });
    const context = io();
    expect(await criticMain(['run', '--critic', 'contrast', '--all', '--server', url, '--max-images', '1', '--concurrency', '1'], context)).toBe(0);
    expect(context.text()).toContain('The budget was reached');
    expect(calls()).toBe(1);
  });

  test('a token is not sent over plain http beyond this machine', async () => {
    await configure({ contrast: { type: 'module', module: 'contrast.mjs' } }, { 'contrast.mjs': moduleCritic('contrast') });
    await expect(criticMain(['run', '--critic', 'contrast', '--all', '--server', 'http://atlas.example.com'], io())).rejects.toThrow(/Refusing to send a token to atlas\.example\.com over plain http/);
  });
});

describe('28. the server goes away during a run', () => {
  test('finished critiques are kept locally and published, byte for byte, on the next invocation, without duplicates', async () => {
    const { url, publisher, store } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['home'], ['cart']) }));
    await configure({ contrast: { type: 'module', module: 'contrast.mjs' } }, { 'contrast.mjs': moduleCritic('contrast') });
    const args = ['run', '--critic', 'contrast', '--all', '--server', url];
    // The catalog is read, then the server goes away: every upload fails.
    let away = false;
    const flaky = asFetch(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (away && init?.method === 'PUT') throw new TypeError('fetch failed');
      return fetch(input, init);
    });
    let tick = 0;
    const first = await json<{ ok: boolean; critics: { judged: number; published: { layer: string | null } }[]; spool: { spooled: number; pending: number; flushed: number }; warnings: string[] }>(args, {
      fetch: (async (input, init) => { const response = await flaky(input, init); if (String(input).includes('/blobs/')) { tick += 1; if (tick === 2) away = true; } return response; }) as typeof fetch, clock: () => 1000
    });
    expect(first.doc.critics[0]!.judged).toBe(2);
    expect(first.doc.spool.spooled).toBeGreaterThan(0);
    expect(first.doc.spool.pending).toBe(first.doc.spool.spooled);
    expect(first.doc.warnings.join(' ')).toMatch(/could not be reached/);
    const spool = path.join(dir, '.atlas/critic-spool');
    const spooled = await readdir(spool);
    expect(spooled.length).toBe(first.doc.spool.pending);
    const keysBefore = (await store.listKeys('layers/')).filter(key => key.includes('critic'));
    expect(keysBefore).toEqual([]);

    // The next invocation sends them first, exactly as they were written, then judges what is left.
    const second = await json<{ critics: { judged: number; skipped: number }[]; spool: { flushed: number; pending: number } }>(args, { clock: () => 2000 });
    expect(second.doc.spool).toMatchObject({ flushed: first.doc.spool.spooled, pending: 0 });
    expect(await readdir(spool)).toEqual([]);
    // Nothing was judged twice: the critiques that were spooled count as published.
    expect(second.doc.critics[0]).toMatchObject({ judged: 0, skipped: 2 });
    const layer = first.doc.critics[0]!.published.layer!;
    const stored = await store.get(`layers/manifests/${layer}.json`);
    expect(stored).not.toBeNull();
    const entries = (await createCatalogClient({ url, token: TOKENS[1]!.token }).read({})).entries;
    expect(entries.map(entry => entry.critiques.length)).toEqual([1, 1]);
    // A third invocation changes nothing.
    const keys = (await store.listKeys('')).length;
    await json(args);
    expect((await store.listKeys('')).length).toBe(keys);
  });
});

describe('atlas critic doctor', () => {
  const uiclipConfig = { type: 'uiclip', checkpoint: { path: 'models/uiclip.onnx', sha256: 'a'.repeat(64) } };
  const llmConfig = { type: 'llm', baseUrl: 'https://provider.invalid/v1', apiKey: 'env:PROVIDER_KEY', model: 'some-model' };
  const refuse = async (input: unknown, _init?: unknown): Promise<Response> => { if (String(input).startsWith('https://provider.invalid')) throw new TypeError('getaddrinfo ENOTFOUND provider.invalid'); throw new TypeError('unexpected'); };
  const through = (extra?: (input: string) => Response | undefined): typeof fetch => asFetch(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => extra?.(String(input)) ?? (String(input).startsWith('https://provider.invalid') ? refuse(input, init) : fetch(input, init)));

  test('36. a bad token, an unreachable provider and a missing model file are each reported separately with how to fix them', async () => {
    const { url } = await start();
    await configure({ uiclip: uiclipConfig, vision: llmConfig });
    const { doc, code } = await json<{ ok: boolean; role: string | null; checks: { name: string; status: string; detail: string; fix?: string }[] }>(['doctor', '--server', url], {
      env: { ATLAS_CRITIC_TOKEN: 'fake-wrong-token-for-tests', PROVIDER_KEY }, fetch: through(), importModule: async name => { throw new Error(`Cannot find package '${name}'`); }
    });
    expect(CriticDoctorResultSchema.safeParse(doc).success).toBe(true);
    expect(code).toBe(1);
    const problem = (name: string) => doc.checks.find(check => check.name === name);
    expect(problem('token')).toMatchObject({ status: 'problem', fix: expect.stringContaining('ATLAS_CRITIC_TOKEN') });
    expect(problem('vision:provider')).toMatchObject({ status: 'problem', detail: expect.stringContaining('provider.invalid'), fix: expect.stringContaining('baseUrl') });
    expect(problem('uiclip:model-file')).toMatchObject({ status: 'problem', fix: expect.stringContaining('atlas critic setup uiclip') });
    expect(problem('uiclip:onnxruntime-node')).toMatchObject({ status: 'problem', detail: expect.stringContaining('onnxruntime-node') });
    expect(problem('vision:credential')).toMatchObject({ status: 'ok' });
    // The credentials are in no part of the output.
    expect(JSON.stringify(doc)).not.toContain(PROVIDER_KEY);
    expect(JSON.stringify(doc)).not.toContain('fake-wrong-token-for-tests');
  });

  test('an unset credential reference is a problem that names the variable, never a value', async () => {
    const { url } = await start();
    await configure({ vision: llmConfig });
    const { doc } = await json<{ checks: { name: string; status: string; detail: string }[] }>(['doctor', '--server', url], { env: { ATLAS_CRITIC_TOKEN: TOKENS[1]!.token }, fetch: through() });
    expect(doc.checks.find(check => check.name === 'vision:credential')).toMatchObject({ status: 'problem', detail: expect.stringContaining('env:PROVIDER_KEY') });
  });

  test('21. a server that is open warns that every caller is an administrator', async () => {
    const { url } = await start('open');
    await configure({});
    const { doc, code } = await json<{ ok: boolean; open: boolean | null; role: string | null; checks: { name: string; status: string; detail: string }[] }>(['doctor', '--server', url], { env: {} });
    expect(code).toBe(0);
    expect(doc).toMatchObject({ ok: true, open: true, role: 'admin' });
    expect(doc.checks.find(check => check.name === 'scope')).toMatchObject({ status: 'warning', detail: expect.stringMatching(/every caller is an administrator/) });
  });

  test('a critic token is the right scope; a read token cannot publish; a publish token is more than needed', async () => {
    const { url } = await start();
    await configure({});
    const scope = async (token: string) => (await json<{ checks: { name: string; status: string }[] }>(['doctor', '--server', url], { env: { ATLAS_CRITIC_TOKEN: token } })).doc.checks.find(check => check.name === 'scope')!.status;
    expect(await scope(TOKENS[1]!.token)).toBe('ok');
    expect(await scope(TOKENS[2]!.token)).toBe('problem');
    expect(await scope(TOKENS[0]!.token)).toBe('warning');
  });

  test('an unreachable server is a problem with a fix, and a clean setup reports no problems', async () => {
    await configure({});
    const down = await json<{ ok: boolean; checks: { name: string; status: string }[] }>(['doctor', '--server', 'http://127.0.0.1:1'], { env: {} });
    expect(down.code).toBe(1);
    expect(down.doc.checks[0]).toMatchObject({ name: 'server', status: 'problem' });
    const { url } = await start();
    const good = await json<{ ok: boolean }>(['doctor', '--server', url]);
    expect(good).toMatchObject({ code: 0, doc: { ok: true } });
  });
});

describe('38. atlas critic setup', () => {
  const bytes = new TextEncoder().encode('pretend this is a model checkpoint');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const serving = (counter: { n: number }, body: Uint8Array = bytes): typeof fetch => asFetch(async () => { counter.n += 1; return new Response(body as unknown as BodyInit); });
  const config = (pin: string) => ({ uiclip: { type: 'uiclip', checkpoint: { path: 'models/uiclip.onnx', sha256: pin, url: 'https://models.invalid/uiclip.onnx' } } });

  test('downloads the checkpoint, verifies it against the pinned checksum, and uses a verified file without downloading again', async () => {
    await configure(config(sha256));
    const counter = { n: 0 };
    const first = await json<{ ok: boolean; details: string[] }>(['setup', 'uiclip'], { fetch: serving(counter) });
    expect(CriticSetupResultSchema.safeParse(first.doc).success).toBe(true);
    expect(first).toMatchObject({ code: 0, doc: { ok: true } });
    expect(first.doc.details.join(' ')).toContain(sha256);
    expect(await readFile(path.join(dir, 'models/uiclip.onnx'))).toEqual(Buffer.from(bytes));
    expect(counter.n).toBe(1);
    await json(['setup', 'uiclip'], { fetch: serving(counter) });
    expect(counter.n).toBe(1);
  });

  test('a download with the wrong checksum is an error and is discarded; an existing file with the wrong checksum is an error and is left alone', async () => {
    await configure(config('b'.repeat(64)));
    const counter = { n: 0 };
    const bad = await json<{ ok: boolean; error: string }>(['setup', 'uiclip'], { fetch: serving(counter) });
    expect(bad.code).toBe(1);
    expect(bad.doc.ok).toBe(false);
    expect(bad.doc.error).toMatch(/does not match its pinned checksum/);
    expect(await readdir(path.join(dir, 'models'))).toEqual([]);
    await writeFile(path.join(dir, 'models/uiclip.onnx'), 'tampered');
    const existing = await json<{ error: string }>(['setup', 'uiclip'], { fetch: serving(counter) });
    expect(existing.code).toBe(1);
    expect(existing.doc.error).toMatch(/does not match its pinned checksum/);
    expect(await readFile(path.join(dir, 'models/uiclip.onnx'), 'utf8')).toBe('tampered');
    expect(counter.n).toBe(1);
  });

  test('inference never downloads: a run with the checkpoint missing fails without a single request for it', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['home']) }));
    await configure(config(sha256));
    const counter = { n: 0 };
    const requested: string[] = [];
    const watching: typeof fetch = (async (input, init) => { requested.push(String(input)); if (String(input).startsWith('https://models.invalid')) counter.n += 1; return fetch(input, init); }) as typeof fetch;
    await expect(criticMain(['run', '--critic', 'uiclip', '--all', '--server', url], io({ fetch: watching, importModule: async name => { throw new Error(`no ${name}`); } }))).rejects.toThrow(/onnxruntime-node/);
    expect(counter.n).toBe(0);
    expect(requested.every(item => item.startsWith(url))).toBe(true);
  });

  test('a configuration that contains a literal credential is refused, naming where and never the value', async () => {
    await writeFile(path.join(dir, 'atlas.critics.json'), JSON.stringify({ critics: { vision: { type: 'llm', baseUrl: 'https://provider.invalid/v1', apiKey: 'a-literal-value-that-is-not-a-reference', model: 'm' } } }));
    const error = await loadCriticsConfig(dir).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('critics.vision.apiKey');
    expect((error as Error).message).not.toContain('a-literal-value');
  });
});

describe('atlas critic list', () => {
  test('lists configured critics with their readiness and where images go, and the built-in ones that are not configured', async () => {
    await configure({
      contrast: { type: 'module', module: 'contrast.mjs' },
      uiclip: { type: 'uiclip', checkpoint: { path: 'models/uiclip.onnx', sha256: 'c'.repeat(64) } }
    }, { 'contrast.mjs': moduleCritic('contrast') });
    const { doc, code } = await json<{ critics: { name: string; status: string; sendsImagesTo: string | null; type: string }[] }>(['list'], { importModule: async name => (name.startsWith('file:') ? import(name) : { default: {} }) });
    expect(code).toBe(0);
    expect(CriticListResultSchema.safeParse(doc).success).toBe(true);
    const by = Object.fromEntries(doc.critics.map(critic => [critic.name, critic]));
    expect(by.contrast).toMatchObject({ status: 'ready', sendsImagesTo: null, type: 'module' });
    expect(by.uiclip).toMatchObject({ status: 'needs-setup', sendsImagesTo: null });
    expect(by.llm).toMatchObject({ status: 'not-configured', type: 'not-configured' });
  });

  test('--help prints the usage, and an unknown command is a mistake', async () => {
    const context = io();
    expect(await criticMain(['--help'], context)).toBe(0);
    expect(context.text()).toBe(CRITIC_USAGE);
    expect(await criticMain(['frobnicate'], io())).toBe(2);
  });
});
