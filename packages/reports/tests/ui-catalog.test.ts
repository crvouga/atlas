import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { combineBackends, type BackendInput } from '../src/compose';
import type { LayerEvidence } from '../src/evidence-types';
import { ReportIndex } from '../src/report-index';
import { publishChecks } from '../src/publish-checks';
import { filterUiCatalog, pageUiCatalog, parseUiCatalogQuery, uiCatalog, uiCatalogMarkdown, uiCatalogParams, uiProfile, type UiCatalog } from '../src/ui-catalog';
import { uiPlanLayer, uiStateLayer, type UiStateCapture } from '../src/ui-catalog-publish';
import { memoryStore } from './memory-store';
import { random } from './plans';

const PNG = (seed: string) => new TextEncoder().encode(`png:${seed}`);
const PROFILES = [
  { environment: 'desktop-web', profile: { viewport: '1280x800', scheme: 'light' } },
  { environment: 'desktop-web', profile: { viewport: '1280x800', scheme: 'dark' } },
  { environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'light' } }
] as const;
const STATES = ['home', 'cart', 'checkout/address', 'checkout/payment', 'checkout/receipt', 'account', 'settings/privacy'];

const capture = (id: string, extra: Partial<UiStateCapture> = {}): UiStateCapture => ({
  id, title: id, route: `/${id}`, area: id.split('/')[0]!, covers: [id.split('/')[0]!], screenshot: { data: PNG(id), width: 10, height: 20 }, ...extra
});

type Shot = { readonly state: string; readonly profile: number; readonly at: number; readonly shard?: string };

/** One layer per profile and shard: what a collector publishes, with no knowledge of the others. */
async function publishCaptures(store: ReturnType<typeof memoryStore>, shots: readonly Shot[], base: { producer?: string } = {}) {
  const groups = new Map<string, Shot[]>();
  for (const shot of shots) groups.set(`${shot.profile}|${shot.shard ?? ''}|${shot.at}`, [...(groups.get(`${shot.profile}|${shot.shard ?? ''}|${shot.at}`) ?? []), shot]);
  for (const group of groups.values()) {
    const first = group[0]!;
    const where = PROFILES[first.profile]!;
    await publishChecks(store, uiStateLayer({
      producer: base.producer ?? 'capture', recordedAtMs: first.at, environment: where.environment, profile: where.profile, sha: 'a'.repeat(40), branch: 'main',
      ...(first.shard ? { shard: first.shard } : {}), states: group.map(shot => capture(shot.state))
    }));
  }
}

async function catalogOf(backends: readonly BackendInput[]) {
  const index = new ReportIndex(backends);
  await index.refresh();
  const snapshot = index.snapshot();
  return { index, snapshot, catalog: uiCatalog(snapshot.layers, { version: snapshot.version, backends: snapshot.backends, notices: snapshot.notices }) };
}

/** Which layer holds a capture, and the backend, are provenance: they differ by design when layers are cut differently. */
const DROP = ['backend', 'layer', 'path', 'labels'];

/** The catalog without what legitimately depends on how layers were divided: which backend holds a layer, and the report's version. */
function essence(catalog: UiCatalog, drop: readonly string[] = ['backend']) {
  const { version: _version, sources: _sources, ...rest } = catalog;
  return JSON.parse(JSON.stringify(rest, (key, value) => (drop.includes(key) ? undefined : value))) as unknown;
}

describe('R1: layered reporting', () => {
  test('1. layers of one catalog in two backends are shown together, each capture saying its layer and backend', async () => {
    const a = memoryStore(), b = memoryStore();
    await publishCaptures(a, [{ state: 'home', profile: 0, at: 10 }, { state: 'cart', profile: 0, at: 10 }]);
    await publishCaptures(b, [{ state: 'checkout/payment', profile: 2, at: 11 }]);
    const { catalog, snapshot } = await catalogOf([{ id: 'ci', store: a }, { id: 'lab', store: b }]);
    expect(catalog.states.map(state => state.id)).toEqual(['cart', 'checkout/payment', 'home']);
    const payment = catalog.states.find(state => state.id === 'checkout/payment')!.cells[0]!;
    expect(payment).toMatchObject({ coverage: 'captured', profile: { environment: 'mobile-web', label: 'Mobile web · light · 390x844' } });
    expect(payment.capture!.origin.backend).toBe('lab');
    expect(catalog.states.find(state => state.id === 'home')!.cells[0]!.capture!.origin.backend).toBe('ci');
    expect(snapshot.layers.map(layer => layer.id)).toContain(payment.capture!.origin.layer);
    expect(payment.capture!.image).toMatchObject({ width: 10, height: 20, contentType: 'image/png' });
    expect(payment.capture!.image!.path).toMatch(/^\/layers\/[0-9a-f]{64}\/blobs\/attachments\/[0-9a-f]{64}$/);
  });

  test('2. the same layers in another order, or divided differently, give the same catalog', async () => {
    for (const seed of [1, 2, 3, 5, 8]) {
      const r = random(seed);
      const shots: Shot[] = [];
      for (const state of STATES) for (let profile = 0; profile < PROFILES.length; profile++) if (r.next() < 0.7) shots.push({ state, profile, at: 100 + Math.floor(r.next() * 5) });
      const single = memoryStore();
      await publishCaptures(single, shots);
      const reference = essence((await catalogOf([{ id: 'only', store: single }])).catalog, DROP);
      const shuffled = shots.slice().sort(() => r.next() - 0.5);
      const stores = [memoryStore(), memoryStore(), memoryStore()];
      for (const shot of shuffled) await publishCaptures(stores[Math.floor(r.next() * 3)]!, [shot]);
      const overlapping = [stores[0]!, stores[1]!, stores[2]!];
      await publishCaptures(overlapping[1]!, shots.slice(0, 3));
      const divided = (await catalogOf(overlapping.map((store, i) => ({ id: `b${i}`, store })))).catalog;
      expect(essence(divided, DROP)).toEqual(reference);
    }
  });

  test('3. a slow backend does not hold back the captures of the others, and its own appear when it answers', async () => {
    const fast = memoryStore(), slow = memoryStore();
    await publishCaptures(fast, [{ state: 'home', profile: 0, at: 1 }]);
    await publishCaptures(slow, [{ state: 'cart', profile: 0, at: 2 }]);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const slowStore = { ...slow, listKeys: async (prefix?: string) => { await gate; return slow.listKeys(prefix); }, listPage: async (prefix?: string, options?: { after?: string; limit?: number }) => { await gate; return slow.listPage(prefix, options); }, withPrefix: slow.withPrefix };
    const index = new ReportIndex([{ id: 'fast', store: fast }, { id: 'slow', store: slowStore as typeof slow }]);
    const refreshing = index.refresh();
    for (let i = 0; i < 50 && !index.ready; i++) await new Promise(resolve => setTimeout(resolve, 2));
    expect(index.ready).toBe(true);
    const early = uiCatalog(index.snapshot().layers);
    expect(early.states.map(state => state.id)).toEqual(['home']);
    release();
    await refreshing;
    expect(uiCatalog(index.snapshot().layers).states.map(state => state.id)).toEqual(['cart', 'home']);
  });

  test('4. a backend that fails is named, and nothing that depended on it is shown as captured', async () => {
    const good = memoryStore(), bad = memoryStore();
    await publishChecks(good, uiPlanLayer({ producer: 'planner', recordedAtMs: 1, environment: 'desktop-web', profile: { viewport: '1280x800', scheme: 'light' }, states: [{ id: 'home' }, { id: 'cart' }] }));
    await publishCaptures(good, [{ state: 'home', profile: 0, at: 2 }]);
    await publishCaptures(bad, [{ state: 'cart', profile: 0, at: 3 }]);
    bad.down = true;
    const { catalog } = await catalogOf([{ id: 'good', store: good }, { id: 'bad', store: bad, label: 'Device lab' }]);
    expect(catalog.sources.backends.find(backend => backend.id === 'bad')!.available).toBe(false);
    expect(catalog.sources.notices.join()).toContain('Device lab is unavailable');
    const cart = catalog.states.find(state => state.id === 'cart')!.cells[0]!;
    expect(cart).toMatchObject({ coverage: 'missing', capture: null, expected: 'declared' });
    expect(catalog.states.find(state => state.id === 'home')!.cells[0]!.coverage).toBe('captured');
    expect(catalog.summary.coverage).toMatchObject({ captured: 1, missing: 1 });
  });

  test('4. a layer that cannot be read is a notice, and its captures are not captured', async () => {
    const store = memoryStore();
    const layer = await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, environment: 'desktop-web', states: [capture('home')] }));
    await publishChecks(store, uiPlanLayer({ producer: 'planner', recordedAtMs: 1, environment: 'desktop-web', states: [{ id: 'home' }] }));
    await store.put(`layers/manifests/${layer.id}.json`, new TextEncoder().encode('{not json'), 'application/json');
    const { catalog } = await catalogOf([{ id: 'one', store }]);
    expect(catalog.sources.notices.length).toBeGreaterThan(0);
    expect(catalog.states[0]!.cells[0]).toMatchObject({ coverage: 'missing', capture: null });
  });
});

describe('expected versus captured', () => {
  test('a plan is a layer too: expected and not captured is missing, captured replaces it, and what no plan names is undeclared', async () => {
    const store = memoryStore();
    const where = PROFILES[0]!;
    await publishChecks(store, uiPlanLayer({ producer: 'planner', recordedAtMs: 1, environment: where.environment, profile: where.profile, states: [{ id: 'home', covers: ['home'] }, { id: 'cart', covers: ['cart'] }, { id: 'surface-only', inventory: true }, { id: 'admin', inventory: true }] }));
    await publishCaptures(store, [{ state: 'home', profile: 0, at: 5 }, { state: 'surprise', profile: 0, at: 5 }]);
    const { catalog } = await catalogOf([{ id: 'one', store }]);
    const cell = (id: string) => catalog.states.find(state => state.id === id)!.cells[0]!;
    expect(cell('home')).toMatchObject({ coverage: 'captured', expected: 'declared' });
    expect(cell('cart')).toMatchObject({ coverage: 'missing', expected: 'declared', capture: null });
    expect(cell('surprise')).toMatchObject({ coverage: 'captured', expected: 'undeclared' });
    expect(catalog.summary).toMatchObject({ planned: true, undeclared: 1, coverage: { captured: 2, missing: 1 } });
    expect(catalog.surfaces.map(surface => [surface.id, surface.status])).toEqual([['admin', 'uncovered'], ['cart', 'uncaptured'], ['home', 'covered'], ['surface-only', 'uncovered'], ['surprise', 'covered']]);
    expect(catalog.surfaces.find(surface => surface.id === 'admin')!.inventoried).toBe(true);
  });

  test('without any plan nothing is missing and nothing is undeclared: what should exist is unknown', async () => {
    const store = memoryStore();
    await publishCaptures(store, [{ state: 'home', profile: 0, at: 5 }]);
    const { catalog } = await catalogOf([{ id: 'one', store }]);
    expect(catalog.states[0]!.cells[0]!.expected).toBe('unknown');
    expect(catalog.summary).toMatchObject({ planned: false, undeclared: 0, coverage: { missing: 0 } });
  });

  test('a failed capture says why and is never captured; a later passing capture replaces it, and a plan never beats a capture', async () => {
    const store = memoryStore();
    const base = { producer: 'capture', environment: 'desktop-web' } as const;
    await publishChecks(store, uiStateLayer({ ...base, recordedAtMs: 1, states: [capture('home', { status: 'failed', detail: 'ready check never became true: #total', screenshot: undefined }), capture('cart', { status: 'running' }), capture('account', { status: 'not-run', detail: 'needs a login' })] }));
    await publishChecks(store, uiPlanLayer({ producer: 'planner', recordedAtMs: 99, environment: 'desktop-web', states: [{ id: 'home' }, { id: 'cart' }, { id: 'account' }, { id: 'later' }] }));
    let { catalog } = await catalogOf([{ id: 'one', store }]);
    const covers = () => Object.fromEntries(catalog.states.map(state => [state.id, state.cells[0]!.coverage]));
    expect(covers()).toEqual({ home: 'failed', cart: 'capturing', account: 'skipped', later: 'missing' });
    expect(catalog.states.find(state => state.id === 'home')!.cells[0]!.capture!.detail).toContain('#total');
    await publishChecks(store, uiStateLayer({ ...base, recordedAtMs: 2, states: [capture('home')] }));
    catalog = (await catalogOf([{ id: 'one', store }])).catalog;
    expect(covers().home).toBe('captured');
  });
});

describe('R3: shardable reports', () => {
  const everything: Shot[] = STATES.flatMap(state => PROFILES.map((_, profile) => ({ state, profile, at: 50 })));

  test.each([1, 2, 3, 5, 21])('9. captures divided among %i independent shards combine to the catalog of one unsharded run', async shards => {
    const unsharded = memoryStore();
    await publishCaptures(unsharded, everything);
    // Which layer holds a capture, and the shard label, are provenance: they differ by design, and everything else must not.
    const drop = ['backend', 'layer', 'path', 'labels'];
    const reference = essence((await catalogOf([{ id: 'run', store: unsharded }])).catalog, drop);
    // Each shard owns every n-th capture, publishes into a store of its own, and knows nothing of the others.
    const stores = Array.from({ length: shards }, () => memoryStore());
    for (let n = 0; n < shards; n++) await publishCaptures(stores[n]!, everything.filter((_, i) => i % shards === n).map(shot => ({ ...shot, shard: `${n + 1}/${shards}` })));
    const combined = await catalogOf(stores.map((store, n) => ({ id: `shard-${n}`, store })));
    expect(essence(combined.catalog, drop)).toEqual(reference);
    expect(combined.catalog.summary.coverage.captured).toBe(everything.length);
    // The origin of each capture stays visible: its shard.
    if (shards > 1) expect(new Set(combined.catalog.states.flatMap(state => state.cells.map(cell => cell.capture!.labels.shard))).size).toBeGreaterThan(1);
  });

  test('10. running one shard again changes only the captures that shard produces', async () => {
    const stores = [memoryStore(), memoryStore(), memoryStore()];
    for (let n = 0; n < 3; n++) await publishCaptures(stores[n]!, everything.filter((_, i) => i % 3 === n).map(shot => ({ ...shot, shard: `${n + 1}/3` })));
    const before = (await catalogOf(stores.map((store, n) => ({ id: `s${n}`, store })))).catalog;
    const again = everything.filter((_, i) => i % 3 === 1).map(shot => ({ ...shot, at: 80, shard: '2/3' }));
    await publishCaptures(stores[1]!, again);
    const after = (await catalogOf(stores.map((store, n) => ({ id: `s${n}`, store })))).catalog;
    const cells = (catalog: UiCatalog) => new Map(catalog.states.flatMap(state => state.cells.map(cell => [`${state.id}|${cell.profile.key}`, cell] as const)));
    const was = cells(before), now = cells(after);
    const rerun = new Set(again.map(shot => `${shot.state}|${uiProfile({ environment: PROFILES[shot.profile]!.environment, parameters: PROFILES[shot.profile]!.profile }).key}`));
    expect(rerun.size).toBe(again.length);
    for (const [key, cell] of now) {
      if (rerun.has(key)) expect(cell.capture!.origin.recordedAtMs).toBe(80);
      else expect(cell).toEqual(was.get(key)!);
    }
    expect(now.size).toBe(was.size);
  });

  test('11. a shard that never publishes leaves its states missing when a plan names them, and absent when none does', async () => {
    const live = memoryStore();
    const planned = memoryStore();
    for (const [index, where] of PROFILES.entries()) await publishChecks(planned, uiPlanLayer({ producer: 'planner', recordedAtMs: 1, environment: where.environment, profile: where.profile, states: STATES.map(id => ({ id })) }));
    await publishCaptures(live, everything.filter((_, i) => i % 2 === 0));
    const withPlan = (await catalogOf([{ id: 'live', store: live }, { id: 'plan', store: planned }])).catalog;
    const absent = everything.filter((_, i) => i % 2 === 1).length;
    expect(withPlan.summary.coverage.missing).toBe(absent);
    expect(withPlan.summary.coverage.captured).toBe(everything.length - absent);
    const withoutPlan = (await catalogOf([{ id: 'live', store: live }])).catalog;
    expect(withoutPlan.summary.coverage.captured).toBe(everything.length - absent);
    expect(withoutPlan.summary.cells).toBe(everything.length - absent);
  });
});

describe('exploring: query, filter, page, text', () => {
  async function sample() {
    const store = memoryStore();
    const [light, dark, phone] = PROFILES;
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, environment: light.environment, profile: light.profile, states: [capture('home', { cohort: 'new-customer', flags: ['new-nav'] }), capture('cart'), capture('checkout/payment', { status: 'failed', detail: 'timed out' })] }));
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, environment: dark.environment, profile: dark.profile, states: [capture('home')] }));
    await publishChecks(store, uiStateLayer({ producer: 'devices', recordedAtMs: 1, environment: phone.environment, profile: phone.profile, states: [capture('home')] }));
    return (await catalogOf([{ id: 'one', store }])).catalog;
  }

  test('filters keep the states and cells that match, recompute the summary, and keep offering every choice', async () => {
    const catalog = await sample();
    expect(catalog.profiles.length).toBe(3);
    const failed = filterUiCatalog(catalog, { coverage: ['failed'] });
    expect(failed.states.map(state => state.id)).toEqual(['checkout/payment']);
    expect(failed.summary).toMatchObject({ states: 1, cells: 1, coverage: { failed: 1, captured: 0 } });
    expect(failed.profiles).toEqual(catalog.profiles);
    const dark = catalog.profiles.find(profile => profile.parameters.scheme === 'dark')!;
    const onlyDark = filterUiCatalog(catalog, { profile: [dark.key] });
    expect(onlyDark.states.map(state => [state.id, state.cells.length])).toEqual([['home', 1]]);
    expect(filterUiCatalog(catalog, { q: 'new-customer' }).states.map(state => state.id)).toEqual(['home']);
    expect(filterUiCatalog(catalog, { flag: ['new-nav'], producer: ['capture'] }).states.map(state => state.id)).toEqual(['home']);
    expect(filterUiCatalog(catalog, { producer: ['devices'] }).states.map(state => state.id)).toEqual(['home']);
    expect(filterUiCatalog(catalog, { q: 'checkout cart' }).states).toEqual([]);
    expect(filterUiCatalog(catalog, {})).toBe(catalog);
  });

  test('a query survives the address, and pages and Markdown say the same thing', async () => {
    const catalog = await sample();
    const query = { q: 'home', coverage: ['captured', 'failed'] as const, profile: ['desktop-web|[["scheme","dark"],["viewport","1280x800"]]'], flag: ['a,b'] };
    const params = uiCatalogParams(query as never);
    expect(parseUiCatalogQuery(new URLSearchParams(params.toString()))).toEqual(query as never);
    expect(parseUiCatalogQuery(new URLSearchParams('coverage=captured,bogus'))).toEqual({ coverage: ['captured'] });
    expect(pageUiCatalog(catalog, { limit: 1, offset: 1 })).toMatchObject({ total: 3, offset: 1, limit: 1, states: [{ id: 'checkout/payment' }] });
    const text = uiCatalogMarkdown(catalog);
    expect(text).toContain('3 states in 3 profiles');
    expect(text).toContain('checkout/payment');
    expect(text).toContain('No plan was published');
  });

  test('every capture says the layer it came from, and unsafe picture addresses are dropped', async () => {
    const store = memoryStore();
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, environment: 'ios', states: [capture('home', { screenshot: { uri: 'https://cdn.example/home.png', name: 'home.png' } }), capture('cart', { screenshot: { uri: 'javascript:alert(1)', name: 'cart.png' } })] }));
    const { catalog } = await catalogOf([{ id: 'one', store }]);
    expect(catalog.states.find(state => state.id === 'home')!.cells[0]!.capture!.image).toMatchObject({ uri: 'https://cdn.example/home.png' });
    expect(catalog.states.find(state => state.id === 'cart')!.cells[0]!.capture!.image!.uri).toBeUndefined();
  });
});

describe('the convention costs the contract nothing', () => {
  test('a state is an ordinary check: the gate counts it, a plan only qualifies it, and rows of other kinds carry no state', async () => {
    const { reportStatus } = await import('../src/report-status');
    const store = memoryStore();
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, environment: 'ios', states: [capture('home'), capture('cart', { status: 'failed', detail: 'boom' })] }));
    await publishChecks(store, uiPlanLayer({ producer: 'planner', recordedAtMs: 1, environment: 'ios', states: [{ id: 'home' }, { id: 'cart' }, { id: 'more' }] }));
    await publishChecks(store, { producer: 'unit', recordedAtMs: 1, checks: [{ id: 'plain', title: 'plain', status: 'passed' }] });
    const { snapshot } = await catalogOf([{ id: 'one', store }]);
    expect(snapshot.layers.flatMap(layer => layer.rows).filter(row => row.kind === 'behavior' || row.kind === 'checks').every(row => row.state === undefined)).toBe(true);
    const status = reportStatus(await combineBackends([{ id: 'one', store }]));
    expect(status.checks).toMatchObject({ passed: 2, failed: 1 });
    expect(status.ok).toBe(false);
  });
});

describe('R5: decoupled from collection', () => {
  const sources = (dir: string, match: (file: string) => boolean): string[] => readdirSync(dir, { recursive: true, withFileTypes: true }).flatMap(entry => (entry.isFile() && match(entry.name) ? [path.join(entry.parentPath, entry.name)] : []));
  const root = path.resolve(import.meta.dir, '../../..');

  test('15. nothing that reads, composes or shows the catalog imports a collection framework, and none is a dependency', () => {
    const files = [
      ...sources(path.join(root, 'packages/reports/src'), name => /^ui-.*\.ts$/.test(name)),
      ...sources(path.join(root, 'packages/visualizer/src/catalog'), name => /\.tsx?$/.test(name)),
      path.join(root, 'packages/server/src/app.ts')
    ];
    expect(files.length).toBeGreaterThan(3);
    const forbidden = /from\s+['"](?:@playwright\/test|playwright(?:-core)?|puppeteer|cypress|selenium-webdriver|webdriverio|detox)[^'"]*['"]|require\(['"](?:@playwright\/test|playwright|puppeteer)/;
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(forbidden);
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, Record<string, unknown>>;
    // Playwright is an optional peer dependency used only by its own adapter, never by the catalog.
    expect(manifest.peerDependenciesMeta!.playwright).toEqual({ optional: true });
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('playwright');
  });

  test('14. a collector that is not Playwright, writing the layer format by hand, is explored like any other', async () => {
    const { createAtlasServer } = await import('../../server/src/app');
    const store = memoryStore();
    const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', refreshMs: 60_000 });
    await server.ready;
    // A shell script, a Go program or a device farm: JSON in, nothing else.
    const post = await server.fetch(new Request('http://x/api/checks', { method: 'POST', body: JSON.stringify({
      producer: 'cypress-component-shots', kind: 'ui-state', environment: 'desktop-web', parameters: { viewport: '1280x800' },
      checks: [{ id: 'login/error', title: 'Login error', status: 'passed', extensions: { 'atlas.ui-state': { route: '/login', fixture: 'locked-account', covers: ['login-form'] } }, attachments: [{ name: 'login-error.png', role: 'screenshot', contentType: 'image/png', base64: btoa('not really a png'), width: 800, height: 600 }] }]
    }) }));
    expect(post.status).toBe(201);
    const got = await (await server.fetch(new Request('http://x/api/reports/ui-catalog'))).json() as UiCatalog;
    expect(got.states[0]).toMatchObject({ id: 'login/error', route: '/login', fixture: 'locked-account', covers: ['login-form'] });
    const image = got.states[0]!.cells[0]!.capture!.image!;
    expect(image).toMatchObject({ width: 800, height: 600, contentType: 'image/png' });
    const file = await server.fetch(new Request(`http://x/api/reports${image.path}`));
    expect(file.status).toBe(200);
    expect(await file.text()).toBe('not really a png');
    server.close();
  });
});

describe('R5: a file written by any program', () => {
  test('14. `atlas report publish --checks` takes a ui-state file with its picture beside it, and the catalog explores it', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { reportMain } = await import('../src/report-cli');
    const { directoryStore } = await import('../src/directory-store');
    const dir = mkdtempSync(path.join(tmpdir(), 'ui-catalog-'));
    writeFileSync(path.join(dir, 'login.png'), 'pretend png');
    writeFileSync(path.join(dir, 'checks.json'), JSON.stringify({
      producer: 'go-capture', kind: 'ui-state', environment: 'ios', parameters: { device: 'iphone-15', scheme: 'dark' }, recordedAtMs: 7,
      checks: [{ id: 'login/error', title: 'Login error', status: 'passed', labels: { shard: '3/9' },
        extensions: { 'atlas.ui-state': { route: '/login', cohort: 'locked', flags: ['passkeys'], covers: ['login-form'] } },
        attachments: [{ name: 'login.png', role: 'screenshot', contentType: 'image/png', path: 'login.png' }] }]
    }));
    const store = path.join(dir, 'store');
    expect(await reportMain(['publish', '--store', store, '--checks', path.join(dir, 'checks.json')], { out: () => {}, cwd: dir })).toBe(0);
    const { catalog } = await catalogOf([{ id: 'dir', store: directoryStore(store) }]);
    expect(catalog.states[0]).toMatchObject({ id: 'login/error', route: '/login', cohort: 'locked', flags: ['passkeys'], covers: ['login-form'] });
    expect(catalog.states[0]!.cells[0]).toMatchObject({ coverage: 'captured', profile: { label: 'iOS · iphone-15 · dark' } });
    expect(catalog.states[0]!.cells[0]!.capture!.labels.shard).toBe('3/9');
    expect(catalog.states[0]!.cells[0]!.capture!.image!.path).toContain('/blobs/attachments/');
  });
});

describe('the catalog is a function of the report', () => {
  test('layers handed over directly (not through an index) give the same catalog as the index holds', async () => {
    const store = memoryStore();
    await publishCaptures(store, STATES.map(state => ({ state, profile: 0, at: 5 })));
    const { snapshot, catalog } = await catalogOf([{ id: 'one', store }]);
    const reversed: LayerEvidence[] = snapshot.layers.slice().reverse();
    expect(essence(uiCatalog(reversed))).toEqual(essence(catalog));
  });
});
