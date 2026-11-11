import { afterEach, describe, expect, test } from 'bun:test';

import { publishChecks } from '../../reports/src/publish-checks';
import { uiCatalog } from '../../reports/src/ui-catalog';
import { uiCatalogMain } from '../../reports/src/ui-catalog-cli';
import { expandCatalog, resolveCatalog } from '../../reports/src/ui-catalog-definition';
import { uiCatalogFailureGroups } from '../../reports/src/ui-catalog-failures';
import { uiStateLayer } from '../../reports/src/ui-catalog-publish';
import { scopeUiCatalog } from '../../reports/src/ui-catalog-scope';
import { memoryStore } from '../../reports/tests/memory-store';
import { DEFINITION_A, DEFINITION_B } from '../../reports/tests/ui-catalog-scope-fixture';
import { UiCatalogFailuresSchema, UiCatalogSchema } from '../../schema/src/api';
import { UiCatalogFailuresResultSchema, UiCatalogStatusSchema } from '../../schema/src/cli-results';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { listen } from '../src/host';

const servers: AtlasServer[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  for (const close of closers.splice(0)) await close();
});

const TOKENS = [{ name: 'ci', role: 'publish' as const, token: 'publish-token-12345' }];
const headers = { 'content-type': 'application/json', authorization: `Bearer ${TOKENS[0].token}` };

/** A server where definition A was published and captured, then B replaced it and was partly captured. */
async function migratedServer() {
  const store = memoryStore();
  const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', tokens: TOKENS, refreshMs: 60_000, now: () => 1_000_000 });
  servers.push(server);
  await server.ready;
  const call = (path: string) => server.fetch(new Request(`http://atlas.test${path}`, { headers }));
  const publish = async (definition: typeof DEFINITION_A) => {
    const resolved = await resolveCatalog(definition);
    const response = await server.fetch(new Request(`http://atlas.test/api/ui-catalog/definitions/${resolved.version}`, { method: 'PUT', headers, body: JSON.stringify(resolved.document) }));
    expect(response.status).toBe(201);
    return { ...resolved, expanded: expandCatalog(resolved.document, resolved.version) };
  };
  const capture = async (profiles: ReturnType<typeof expandCatalog>['profiles'], at: number, states: Parameters<typeof uiStateLayer>[0]['states']) => {
    for (const profile of profiles) {
      const layer = await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: at, ...(profile.environment ? { environment: profile.environment } : {}), profile: profile.parameters, states }));
      await server.index.accept('data', `layers/index/${String(Number.MAX_SAFE_INTEGER - layer.recordedAtMs).padStart(16, '0')}-${layer.id}.json`, layer);
    }
  };
  const a = await publish(DEFINITION_A);
  await capture(a.expanded.profiles, 2_000, [{ id: 'cart', title: 'Cart' }, { id: 'home', title: 'Home' }, { id: 'legacy', title: 'Legacy', status: 'failed', detail: 'old screen', labels: { fingerprint: 'legacy-gone' } }]);
  const b = await publish(DEFINITION_B);
  await capture(b.expanded.profiles.slice(0, 2), 4_000, [{ id: 'cart', title: 'Cart' }, { id: 'home', title: 'Home', status: 'failed', detail: 'timeout', labels: { fingerprint: 'slow-api', phase: 'load' } }, { id: 'search', title: 'Search' }]);
  return { server, store, call, a, b };
}

const read = async (response: Response) => { expect(response.status).toBe(200); return response.json(); };

describe('#87 GET /api/reports/ui-catalog?definition=', () => {
  test('1, 3: latest resolves to B\'s version and counts exactly B\'s cells; a pinned version of A keeps A\'s counts after B was published', async () => {
    const { call, a, b } = await migratedServer();
    const latest = UiCatalogSchema.parse(await read(await call('/api/reports/ui-catalog?definition=latest')));
    expect(latest.scope).toMatchObject({ kind: 'definition', status: 'applied', definition: { version: b.version, name: 'web' }, expected: { cells: 24 }, excluded: { states: 1, profiles: 4, cells: 12 } });
    expect(latest.summary).toMatchObject({ states: 3, profiles: 8, cells: 24 });
    const pinned = UiCatalogSchema.parse(await read(await call(`/api/reports/ui-catalog?definition=${a.version}`)));
    expect(pinned.scope).toMatchObject({ definition: { version: a.version } });
    expect(pinned.summary).toMatchObject({ states: 3, profiles: 4, cells: 12 });
    // 2: the removed state is still under A and in all history.
    expect(pinned.states.map(state => state.id)).toContain('legacy');
    const all = UiCatalogSchema.parse(await read(await call('/api/reports/ui-catalog?definition=all')));
    expect(all.scope).toEqual({ kind: 'all-history', status: 'applied' });
    expect(all.summary.profiles).toBe(12);
    // Without the parameter the document is what it always was.
    expect((await read(await call('/api/reports/ui-catalog')) as { scope?: unknown }).scope).toBeUndefined();
  });

  test('4: an unknown definition is an explicit unavailable scope; a malformed one is refused', async () => {
    const { call } = await migratedServer();
    const missing = UiCatalogSchema.parse(await read(await call(`/api/reports/ui-catalog?definition=${'d'.repeat(64)}`)));
    expect(missing.scope).toMatchObject({ status: 'unavailable', definition: { version: 'd'.repeat(64) } });
    expect(missing.summary.cells).toBe(0);
    expect(missing.states).toEqual([]);
    expect((await call('/api/reports/ui-catalog?definition=newest')).status).toBe(422);
    const markdown = await (await call(`/api/reports/ui-catalog?definition=${'d'.repeat(64)}&format=markdown`)).text();
    expect(markdown).toContain('is unavailable');
  });

  test('5: the API, the CLI against the server, a projection of the same report (as the viewer makes) and the failures agree on every total', async () => {
    const { server, b } = await migratedServer();
    const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
    closers.push(() => http.close(100));
    const url = `http://127.0.0.1:${http.port}`;
    const api = UiCatalogSchema.parse(await read(await server.fetch(new Request(`http://atlas.test/api/reports/ui-catalog?definition=${b.version}`, { headers }))));
    let out = '';
    const code = await uiCatalogMain(['status', '--store', url, '--definition', 'latest', '--format', 'json'], { out: text => { out += text; }, env: { ATLAS_TOKEN: TOKENS[0].token }, git: () => null });
    expect(code).toBe(1);
    const cli = UiCatalogStatusSchema.parse(JSON.parse(out));
    const snapshot = server.index.snapshot();
    const viewer = scopeUiCatalog(uiCatalog(snapshot.layers, { version: snapshot.version, backends: snapshot.backends, notices: snapshot.notices }), { kind: 'definition', version: b.version, document: b.document });
    expect(cli.summary).toEqual(api.summary);
    expect(viewer.summary).toEqual(api.summary as typeof viewer.summary);
    expect(cli.scope).toEqual(api.scope);
    const failures = UiCatalogFailuresSchema.parse(await read(await server.fetch(new Request(`http://atlas.test/api/reports/ui-catalog/failures?definition=${b.version}`, { headers }))));
    expect(failures.total.failed).toBe(api.summary.coverage.failed);
    expect(failures).toEqual(JSON.parse(JSON.stringify(uiCatalogFailureGroups(viewer))));
    out = '';
    await uiCatalogMain(['failures', '--store', url, '--definition', b.version, '--format', 'json'], { out: text => { out += text; }, env: { ATLAS_TOKEN: TOKENS[0].token }, git: () => null });
    expect(UiCatalogFailuresResultSchema.parse(JSON.parse(out)).total).toEqual(failures.total);
  });
});

describe('#93 GET /api/reports/ui-catalog/failures', () => {
  test('1, 3: groups by the producer\'s fingerprint, in exactly the scope and filters asked for', async () => {
    const { call } = await migratedServer();
    const all = UiCatalogFailuresSchema.parse(await read(await call('/api/reports/ui-catalog/failures')));
    expect(all.groups.map(group => [group.fingerprint, group.count])).toEqual([['legacy-gone', 4], ['slow-api', 2]]);
    expect(all.groups[0]!.cells).toHaveLength(4);
    const latest = UiCatalogFailuresSchema.parse(await read(await call('/api/reports/ui-catalog/failures?definition=latest')));
    expect(latest.groups).toHaveLength(1);
    expect(latest.groups[0]).toMatchObject({ fingerprint: 'slow-api', phases: ['load'], count: 2, states: 1, profiles: 2, cells: [{ state: 'home' }, { state: 'home' }] });
    const filtered = UiCatalogFailuresSchema.parse(await read(await call('/api/reports/ui-catalog/failures?q=legacy')));
    expect(filtered.total.failed).toBe(4);
    const markdown = await (await call('/api/reports/ui-catalog/failures?format=markdown')).text();
    expect(markdown).toContain('Fingerprint `legacy-gone`: 4 cells');
  });
});
