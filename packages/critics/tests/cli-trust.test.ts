import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CriticCalibrateResultSchema, CriticReviewResultSchema, CriticWatchResultSchema } from '../../schema/src/cli-results';
import { httpStore } from '../../reports/src/http-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { uiStateLayer } from '../../reports/src/ui-catalog-publish';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../../server/src/app';
import { listen, type RunningServer } from '../../server/src/host';
import { createCatalogClient } from '../src/catalog-client';
import { criticMain, type CriticIo } from '../src/cli';

// Obviously fake credentials: nothing here is, or looks like, a real key.
const TOKENS = [
  { name: 'ci', role: 'publish' as const, token: 'fake-publish-token-for-tests' },
  { name: 'critic', role: 'critic' as const, token: 'fake-critic-token-for-tests' },
  { name: 'eyes', role: 'read' as const, token: 'fake-read-token-for-tests' }
];

const running: { server: AtlasServer; http: RunningServer }[] = [];
let dir = '';
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'atlas-critic-trust-')); });
afterEach(async () => {
  for (const { server, http } of running.splice(0)) { server.close(); await http.close(200); }
  await rm(dir, { recursive: true, force: true });
  delete (globalThis as Record<string, unknown>).__criticCalls;
});

async function start() {
  const server = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data', tokens: TOKENS, refreshMs: 60_000, heartbeatMs: 50 });
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
  running.push({ server, http });
  await server.ready;
  const url = `http://127.0.0.1:${http.port}`;
  const publisher = httpStore({ url, token: TOKENS[0]!.token, retries: 0 });
  const critic = createCatalogClient({ url, token: TOKENS[1]!.token });
  return { url, publisher, critic };
}

const png = (id: string) => new TextEncoder().encode(`\x89PNG fake image of ${id}`);
const states = (...items: [string, string?][]) => items.map(([id, kind]) => ({ id, route: `/${id}`, ...(kind ? { kind } : {}), screenshot: { data: png(id) } }));
const calls = () => ((globalThis as Record<string, unknown>).__criticCalls as number | undefined) ?? 0;

/** A critic of the project's own that counts its calls, scores by length, and gives one finding to every picture. */
const moduleCritic = (name: string, { sends = 'null', findings = false, score = '(image.length % 10) / 10' } = {}) => `
export default {
  name: ${JSON.stringify(name)}, version: '1.0.0', kind: 'heuristic',
  describe: () => ({ sendsImagesTo: ${sends}, needsSetup: false }),
  async evaluate({ image, entry }) {
    globalThis.__criticCalls = (globalThis.__criticCalls ?? 0) + 1;
    const text = new TextDecoder().decode(image);
    return { verdict: { score: ${score}, scale: '0..1', label: 'needs-polish' }${findings ? ", findings: [{ id: 'f1', category: 'spacing', severity: 'minor', region: { unit: 'normalized', x: 0.1, y: 0.1, w: 0.5, h: 0.2 }, rationale: 'Cramped.' }, { id: 'f2', category: 'contrast', severity: 'major', rationale: 'Faint.' }]" : ''} };
  }
};
`;

async function configure(critics: Record<string, unknown>, files: Record<string, string> = {}) {
  await writeFile(path.join(dir, 'atlas.critics.json'), JSON.stringify({ critics }));
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

async function until(condition: () => boolean | Promise<boolean>, what: string, ms = 8000) {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > ms) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

type Watch = { ok: boolean; stoppedBy: string; batches: number; version: string | null; critics: { judged: number; skipped: number; failed: number; entries: number; published: { layers: number; critiques: number } }[] };

describe('atlas critic watch', () => {
  test('catches up on the whole catalog, publishes, and a second watch judges nothing again; the document validates', async () => {
    const { url, publisher, critic } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['home', 'screen'], ['spinner', 'loading'], ['error', 'error']) }));
    await configure({ contrast: { type: 'module', module: 'contrast.mjs' } }, { 'contrast.mjs': moduleCritic('contrast') });
    const first = await json<Watch>(['watch', '--critic', 'contrast', '--server', url, '--max-batches', '1']);
    expect(CriticWatchResultSchema.safeParse(first.doc).success).toBe(true);
    expect(first.code).toBe(0);
    expect(first.doc).toMatchObject({ ok: true, stoppedBy: 'max-batches', batches: 1, critics: [{ judged: 3, skipped: 0, failed: 0, published: { layers: 1, critiques: 3 } }] });
    expect(first.doc.version).toMatch(/\S/);
    expect(calls()).toBe(3);
    const entries = (await critic.read({})).entries;
    expect(entries.every(entry => entry.critiques.length === 1 && entry.critiques[0]!.currency === 'current')).toBe(true);
    // The score is read against its own state kind, as `run` does.
    expect(entries[0]!.critiques[0]!.critique.verdict!.relative).toMatchObject({ stateKind: expect.any(String) });
    const second = await json<Watch>(['watch', '--critic', 'contrast', '--server', url, '--max-batches', '1']);
    expect(second.doc.critics[0]).toMatchObject({ judged: 0, skipped: 3 });
    expect(calls()).toBe(3);
  });

  test('follows the catalog: an entry captured while it runs is judged once, and an interrupt ends it with its summary and the version to resume from', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['home']) }));
    await configure({ contrast: { type: 'module', module: 'contrast.mjs' } }, { 'contrast.mjs': moduleCritic('contrast') });
    const controller = new AbortController();
    const context = io({ signal: controller.signal });
    const running_ = criticMain(['watch', '--critic', 'contrast', '--server', url, '--format', 'json'], context);
    await until(() => calls() === 1, 'the first entry to be judged');
    await publishChecks(publisher, uiStateLayer({ producer: 'cap2', recordedAtMs: 2, environment: 'ios', states: states(['cart']) }));
    await until(() => calls() === 2, 'the entry captured later to be judged');
    controller.abort();
    expect(await running_).toBe(0);
    const doc = JSON.parse(context.text()) as Watch;
    expect(doc).toMatchObject({ stoppedBy: 'interrupted', critics: [{ judged: 2, failed: 0, published: { critiques: 2 } }] });
    expect(doc.batches).toBeGreaterThanOrEqual(2);
    expect(calls()).toBe(2);

    // Resume from the version it reached: only what is new since.
    await publishChecks(publisher, uiStateLayer({ producer: 'cap3', recordedAtMs: 3, environment: 'ios', states: states(['settings']) }));
    const resumed = await json<Watch>(['watch', '--critic', 'contrast', '--server', url, '--since', doc.version!, '--max-batches', '1']);
    expect(resumed.doc.critics[0]).toMatchObject({ entries: 1, judged: 1 });
    expect(calls()).toBe(3);
  });

  test('a budget for the whole watch stops it cleanly, having published what it finished', async () => {
    const { url, publisher, critic } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['a'], ['b'], ['c']) }));
    await configure({ contrast: { type: 'module', module: 'contrast.mjs' } }, { 'contrast.mjs': moduleCritic('contrast') });
    const result = await json<Watch>(['watch', '--critic', 'contrast', '--server', url, '--max-images', '2']);
    expect(result.doc).toMatchObject({ stoppedBy: 'budget', critics: [{ judged: 2, published: { critiques: 2 } }] });
    expect((await critic.read({})).entries.filter(entry => entry.critiques.length).length).toBe(2);
  });

  test('--dry-run reads once and sends and publishes nothing', async () => {
    const { url, publisher, critic } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['a'], ['b']) }));
    await configure({ remote: { type: 'module', module: 'remote.mjs' } }, { 'remote.mjs': moduleCritic('remote', { sends: "'vision.example.com'" }) });
    const result = await json<Watch & { critics: { sendsImagesTo: string }[] }>(['watch', '--critic', 'remote', '--server', url, '--dry-run']);
    expect(result.doc).toMatchObject({ dryRun: true, stoppedBy: 'dry-run', critics: [{ sendsImagesTo: 'vision.example.com', published: { layers: 0 } }] });
    expect(calls()).toBe(0);
    expect((await critic.read({})).entries.every(entry => entry.critiques.length === 0)).toBe(true);
  });

  test('a critic that would send images to a third party needs --yes (or a yes at the terminal), and a missing choice exits 2 naming the flags', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['a']) }));
    await configure({ remote: { type: 'module', module: 'remote.mjs' } }, { 'remote.mjs': moduleCritic('remote', { sends: "'vision.example.com'" }) });
    const args = ['watch', '--critic', 'remote', '--server', url, '--max-batches', '1'];
    await expect(criticMain(args, io())).rejects.toThrow(/sends images to vision\.example\.com: pass --yes/);
    let question = '';
    await expect(criticMain(args, io({ interactive: true, ask: async text => { question = text; return 'n'; } }))).rejects.toThrow(/not confirmed/);
    expect(question).toContain('vision.example.com');
    expect(calls()).toBe(0);
    expect(await criticMain([...args, '--yes'], io())).toBe(0);
    expect(calls()).toBe(1);
    await expect(criticMain(['watch'], io({ env: {} }))).rejects.toThrow(/--critic <name>.*--server <url>.*no terminal/);
  });

  test('a critic that fails on an entry is recorded and exits 1', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['a']) }));
    await configure({ flaky: { type: 'module', module: 'flaky.mjs' } }, { 'flaky.mjs': moduleCritic('flaky').replace('const text', "throw new Error('model fell over'); const text") });
    const result = await json<Watch & { critics: { failures: { reason: string }[] }[] }>(['watch', '--critic', 'flaky', '--server', url, '--max-batches', '1']);
    expect(result.code).toBe(1);
    expect(result.doc).toMatchObject({ ok: false, critics: [{ failed: 1, failures: [{ reason: 'error' }] }] });
  });
});

type Review = {
  critic: string | null; critics: string[]; reviewer: string; rankedBy: string; summary: { ranked: number; unranked: number; unjudged: number };
  entries: { rank: number | null; key: string; score: number | null; marks: { state: string; accepted: string[]; dismissed: string[] }; findings: { id: string | null; marks: { state: string } | null }[] }[];
  marked?: { dryRun: boolean; reviewer: string; layer: string | null; marks: { entry: string; critic: string; finding: string | null; decision: string }[] };
};

describe('atlas critic review', () => {
  async function judged(findings = true) {
    const world = await start();
    await world.publisher && await publishChecks(world.publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['home', 'screen'], ['spinner', 'loading'], ['cart', 'screen']) }));
    await configure({ vision: { type: 'module', module: 'vision.mjs' } }, { 'vision.mjs': moduleCritic('vision', { findings, score: "text.includes('home') ? 0.2 : text.includes('cart') ? 0.9 : 0.5" }) });
    expect(await criticMain(['run', '--critic', 'vision', '--all', '--server', world.url], io())).toBe(0);
    return world;
  }

  test('lists the ranked needs-polish entries, lowest first, with their findings; the document validates', async () => {
    const { url } = await judged();
    const { doc, code } = await json<Review>(['review', '--server', url]);
    expect(code).toBe(0);
    expect(CriticReviewResultSchema.safeParse(doc).success).toBe(true);
    expect(doc.critic).toBe('vision');
    expect(doc.entries.map(entry => [entry.rank, entry.key])).toEqual([[1, 'home@ios'], [2, 'spinner@ios'], [3, 'cart@ios']]);
    expect(doc.entries[0]!.findings.map(finding => [finding.id, finding.marks!.state])).toEqual([['f1', 'unmarked'], ['f2', 'unmarked']]);
    expect((await json<Review>(['review', '--server', url, '--limit', '1'])).doc.entries).toHaveLength(1);
    expect((await json<Review>(['review', '--server', url, '--state', 'loading'])).doc.entries.map(entry => entry.key)).toEqual(['spinner@ios']);
    const text = io();
    expect(await criticMain(['review', '--server', url], text)).toBe(0);
    expect(text.text()).toContain('Needs polish, by vision');
    expect(text.text()).toContain('home@ios');
    expect(text.text()).toContain('f1: spacing (minor)');
  });

  test('accepts and dismisses findings and whole opinions by flag; later reads show the marks, and a newer mark of the same reviewer replaces the older', async () => {
    const { url, critic } = await judged();
    const accept = await json<Review>(['review', '--server', url, '--entry', 'home@ios', '--accept', '--finding', 'f1', '--note', 'Really cramped', '--reviewer', 'Pat']);
    expect(accept.code).toBe(0);
    expect(accept.doc.marked).toMatchObject({ dryRun: false, reviewer: 'pat', marks: [{ entry: 'home@ios', critic: 'vision', finding: 'f1', decision: 'accept' }] });
    expect(accept.doc.marked!.layer).toMatch(/^[0-9a-f]{64}$/);
    await json<Review>(['review', '--server', url, '--entry', 'home@ios', '--dismiss', '--finding', 'f2', '--reviewer', 'pat']);
    await json<Review>(['review', '--server', url, '--entry', 'home@ios', '--accept', '--reviewer', 'pat']);
    let doc = (await json<Review>(['review', '--server', url, '--entry', 'home@ios'])).doc;
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]!.marks).toMatchObject({ state: 'accepted', accepted: ['pat'] });
    expect(doc.entries[0]!.findings.map(finding => [finding.id, finding.marks!.state])).toEqual([['f1', 'accepted'], ['f2', 'dismissed']]);
    // Pat changes their mind about f1 later.
    await json<Review>(['review', '--server', url, '--entry', 'home@ios', '--dismiss', '--finding', 'f1', '--reviewer', 'pat'], { clock: () => Date.now() + 60_000 });
    doc = (await json<Review>(['review', '--server', url, '--entry', 'home@ios'])).doc;
    expect(doc.entries[0]!.findings[0]!.marks!.state).toBe('dismissed');
    // The server shows the marks on the entry, as evidence.
    const entry = (await critic.read({})).entries.find(item => item.key === 'home@ios')!;
    expect(entry.marks.length).toBe(3);
    expect(entry.marks.every(item => item.producer === 'critic.review.pat' && item.currency === 'current')).toBe(true);
  });

  test('--dry-run says what would be marked and publishes nothing', async () => {
    const { url, critic } = await judged();
    const { doc } = await json<Review>(['review', '--server', url, '--entry', 'home@ios', '--dismiss', '--dry-run']);
    expect(doc.marked).toMatchObject({ dryRun: true, layer: null, marks: [{ decision: 'dismiss', finding: null }] });
    expect((await critic.read({})).entries.every(entry => entry.marks.length === 0)).toBe(true);
  });

  test('a mistake in the flags marks nothing and says what there is', async () => {
    const { url, critic } = await judged();
    const run = (...args: string[]) => criticMain(['review', '--server', url, ...args], io());
    await expect(run('--accept')).rejects.toThrow(/--accept needs --entry/);
    await expect(run('--entry', 'home@ios', '--accept', '--dismiss')).rejects.toThrow(/opposites/);
    await expect(run('--finding', 'f1')).rejects.toThrow(/go with --accept or --dismiss/);
    await expect(run('--entry', 'nowhere', '--accept')).rejects.toThrow(/No entry "nowhere"/);
    await expect(run('--entry', 'home@ios', '--accept', '--finding', 'f9')).rejects.toThrow(/no finding "f9".*Its findings: f1, f2/);
    await expect(run('--entry', 'home@ios', '--accept', '--critic', 'other')).rejects.toThrow(/other has not judged home@ios \(judged by vision\)/);
    await expect(run('--critic', 'other')).rejects.toThrow(/No entry has a critique from "other"/);
    expect((await critic.read({})).entries.every(entry => entry.marks.length === 0)).toBe(true);
  });

  test('an opinion about an earlier picture cannot be marked as if it were about this one', async () => {
    const { url, publisher } = await judged();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 50, environment: 'ios', states: states(['home', 'screen']).map(state => ({ ...state, screenshot: { data: png('home, redesigned') } })) }));
    await expect(criticMain(['review', '--server', url, '--entry', 'home@ios', '--accept'], io())).rejects.toThrow(/judged an earlier picture/);
  });

  test('with a terminal it walks the list and asks: accept, dismiss, skip, quit', async () => {
    const { url, critic } = await judged();
    const questions: string[] = [];
    const answers = ['a', 'd', 's', 'q'];
    const context = io({ interactive: true, ask: async question => { questions.push(question); return answers.shift() ?? 'q'; } });
    expect(await criticMain(['review', '--server', url, '--reviewer', 'pat'], context)).toBe(0);
    expect(questions.join('\n')).toContain('[a]ccept, [d]ismiss, [s]kip, [q]uit?');
    expect(context.text()).toContain('Marked 2 opinions as pat');
    const home = (await critic.read({})).entries.find(item => item.key === 'home@ios')!;
    expect(home.marks.map(item => [item.mark.finding, item.mark.decision]).sort()).toEqual([['f1', 'accept'], ['f2', 'dismiss']]);
  });

  test('a token that may only read cannot mark: the server refuses and nothing is stored', async () => {
    const { url, critic } = await judged();
    await expect(criticMain(['review', '--server', url, '--entry', 'home@ios', '--accept'], io({ env: { ATLAS_CRITIC_TOKEN: TOKENS[2]!.token } }))).rejects.toThrow();
    expect((await critic.read({})).entries.every(entry => entry.marks.length === 0)).toBe(true);
    // A publish token may, like a critic token.
    expect(await criticMain(['review', '--server', url, '--entry', 'home@ios', '--accept'], io({ env: { ATLAS_CRITIC_TOKEN: TOKENS[0]!.token } }))).toBe(0);
  });
});

describe('atlas critic calibrate', () => {
  const badAndGood = async () => {
    // A critic that scores by what the picture says, so the examples are labelled by construction.
    await configure({ judge: { type: 'module', module: 'judge.mjs' } }, { 'judge.mjs': moduleCritic('judge', { score: "text.includes('BAD') ? 0.2 : 0.8" }) });
    const write = async (file: string, label: string) => { await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await writeFile(path.join(dir, file), `\x89PNG ${label} ${file}`); };
    for (const i of [1, 2, 3]) {
      await write(`examples/good/screen/g${i}.png`, 'ok'); await write(`examples/bad/screen/b${i}.png`, 'BAD');
      await write(`examples/good/loading/g${i}.png`, 'ok'); await write(`examples/bad/loading/b${i}.png`, 'BAD');
    }
    await write('examples/held-good/screen/h1.png', 'ok'); await write('examples/held-bad/screen/h2.png', 'BAD');
    await write('examples/held-good/screen/h3.png', 'ok'); await write('examples/held-bad/screen/h4.png', 'BAD');
  };
  type Calibrate = { critic: { name: string; version: string | null }; examples: { files: number; marks: number; used: number; skipped: { source: string; reason: string }[] }; calibration: { critic: { name: string; version: string }; kinds: { stateKind: string; threshold: number | null; samples: number; positives: number; negatives: number; precision: number | null; recall: number | null; inSample: boolean }[] } | null; written: string | null; gate: { eligible: boolean; reasons: string[] } | null };

  test('measures a critic on labelled pictures per state kind, says what is in-sample, and writes a calibration that run can read', async () => {
    await badAndGood();
    const { doc, code } = await json<Calibrate>(['calibrate', 'judge', '--good', 'examples/good', '--bad', 'examples/bad', '--heldout-good', 'examples/held-good', '--heldout-bad', 'examples/held-bad', '--out', 'calibration/judge.json']);
    expect(code).toBe(0);
    expect(CriticCalibrateResultSchema.safeParse(doc).success).toBe(true);
    expect(doc.examples).toMatchObject({ files: 16, marks: 0, used: 16, skipped: [] });
    const kinds = Object.fromEntries(doc.calibration!.kinds.map(kind => [kind.stateKind, kind]));
    // `screen` has held-out examples, `loading` has none: its figures flatter the critic and say so.
    expect(kinds.screen).toMatchObject({ samples: 10, positives: 5, negatives: 5, precision: 1, recall: 1, inSample: false });
    expect(kinds.loading).toMatchObject({ samples: 6, positives: 3, negatives: 3, precision: 1, recall: 1, inSample: true });
    expect(kinds.screen!.threshold).toBeGreaterThan(0.2);
    expect(kinds.screen!.threshold).toBeLessThan(0.8);
    expect(doc.calibration!.critic).toMatchObject({ name: 'judge', version: '1.0.0' });
    // Far too few examples to gate on, and the command says why.
    expect(doc.gate!.eligible).toBe(false);
    expect(doc.gate!.reasons.join(' ')).toMatch(/at least 10 of each/);
    expect(doc.written).toBe(path.join('calibration', 'judge.json'));
    expect(JSON.parse(await readFile(path.join(dir, 'calibration/judge.json'), 'utf8'))).toMatchObject({ schema: 1, critic: { name: 'judge' } });
    // The same pictures, the same critic: the same figures.
    const again = await json<Calibrate>(['calibrate', 'judge', '--good', 'examples/good', '--bad', 'examples/bad', '--heldout-good', 'examples/held-good', '--heldout-bad', 'examples/held-bad']);
    expect(again.doc.calibration!.kinds).toEqual(doc.calibration!.kinds);
    expect(again.doc.written).toBeNull();
  });

  test('pictures directly in a directory take the state kind of --state; a directory without pictures, or a missing label, is a mistake', async () => {
    await badAndGood();
    await mkdir(path.join(dir, 'flat/good'), { recursive: true });
    await mkdir(path.join(dir, 'flat/bad'), { recursive: true });
    await writeFile(path.join(dir, 'flat/good/a.png'), 'ok');
    await writeFile(path.join(dir, 'flat/bad/b.png'), 'BAD');
    const { doc } = await json<Calibrate>(['calibrate', 'judge', '--good', 'flat/good', '--bad', 'flat/bad', '--state', 'overlay']);
    expect(doc.calibration!.kinds.map(kind => [kind.stateKind, kind.samples])).toEqual([['overlay', 2]]);
    await mkdir(path.join(dir, 'empty'), { recursive: true });
    await expect(criticMain(['calibrate', 'judge', '--good', 'empty', '--bad', 'flat/bad'], io())).rejects.toThrow(/holds no pictures/);
    await expect(criticMain(['calibrate', 'judge'], io())).rejects.toThrow(/--good <dir> and --bad <dir>/);
    await expect(criticMain(['calibrate'], io())).rejects.toThrow(/needs the name of a critic/);
  });

  test('--dry-run counts the pictures and where they would go, and judges nothing', async () => {
    await badAndGood();
    await configure({ remote: { type: 'module', module: 'remote.mjs' } }, { 'remote.mjs': moduleCritic('remote', { sends: "'vision.example.com'" }) });
    const { doc } = await json<Calibrate & { sendsImagesTo: string }>(['calibrate', 'remote', '--good', 'examples/good', '--bad', 'examples/bad', '--dry-run']);
    expect(doc).toMatchObject({ dryRun: true, sendsImagesTo: 'vision.example.com', calibration: null, examples: { files: 12 } });
    expect(calls()).toBe(0);
    // Without --dry-run the pictures leave this machine only with a yes.
    await expect(criticMain(['calibrate', 'remote', '--good', 'examples/good', '--bad', 'examples/bad'], io())).rejects.toThrow(/pass --yes/);
    expect(calls()).toBe(0);
  });

  test('pictures a critic could not score are left out and named, never invented', async () => {
    await badAndGood();
    await configure({ flaky: { type: 'module', module: 'flaky.mjs' } }, { 'flaky.mjs': moduleCritic('flaky', { score: "text.includes('BAD') ? 0.2 : 0.8" }).replace('const text = new TextDecoder().decode(image);', "const text = new TextDecoder().decode(image); if (entry.title === 'b1.png') throw new Error('model fell over');") });
    const { doc } = await json<Calibrate>(['calibrate', 'flaky', '--good', 'examples/good', '--bad', 'examples/bad']);
    expect(doc.examples.used).toBe(10);
    expect(doc.examples.skipped.map(item => item.reason)).toEqual(['the critic could not judge it (error)', 'the critic could not judge it (error)']);
  });

  test('--from-marks calibrates on the whole-opinion marks reviewers made: accepted is bad, dismissed is good, disputed and finding-level marks are not examples', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: states(['a', 'screen'], ['b', 'screen'], ['c', 'screen'], ['d', 'screen'], ['e', 'screen']) }));
    await configure({ vision: { type: 'module', module: 'vision.mjs' } }, { 'vision.mjs': moduleCritic('vision', { findings: true, score: "text.includes('image of a') ? 0.1 : text.includes('image of b') ? 0.2 : text.includes('image of c') ? 0.8 : text.includes('image of d') ? 0.9 : 0.5" }) });
    expect(await criticMain(['run', '--critic', 'vision', '--all', '--server', url], io())).toBe(0);
    const mark = (entry: string, decision: '--accept' | '--dismiss', reviewer = 'pat', ...more: string[]) => criticMain(['review', '--server', url, '--entry', `${entry}@ios`, decision, '--reviewer', reviewer, ...more], io());
    await mark('a', '--accept'); await mark('b', '--accept'); await mark('c', '--dismiss'); await mark('d', '--dismiss');
    await mark('e', '--accept'); await mark('e', '--dismiss', 'sam');                       // reviewers disagree
    await mark('a', '--dismiss', 'pat', '--finding', 'f1');                                   // a finding is not an example
    const { doc } = await json<Calibrate>(['calibrate', 'vision', '--from-marks', '--server', url]);
    expect(doc).toMatchObject({ critic: { name: 'vision', version: '1.0.0' }, examples: { files: 0, marks: 4, used: 4 } });
    expect(doc.examples.skipped).toEqual([{ source: 'e@ios', reason: 'reviewers disagree' }]);
    expect(doc.calibration!.kinds).toMatchObject([{ stateKind: 'screen', samples: 4, positives: 2, negatives: 2, precision: 1, recall: 1, inSample: true }]);
    expect(doc.calibration!.kinds[0]!.threshold).toBeGreaterThan(0.2);
    expect(doc.calibration!.kinds[0]!.threshold).toBeLessThan(0.8);
    await expect(criticMain(['calibrate', 'vision', '--from-marks'], io({ env: {} }))).rejects.toThrow(/--from-marks needs --server/);
  });
});
