import { afterEach, describe, expect, test } from 'bun:test';

import { createCatalogClient, buildCritique, defineCritic, publishCritiques, type CritiqueOutcome } from '../../critics/src/index';
import { httpStore } from '../../reports/src/http-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { sha256Hex } from '../../reports/src/sigv4';
import { uiStateLayer } from '../../reports/src/ui-catalog-publish';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { listen, type RunningServer } from '../src/host';

const running: { server: AtlasServer; http: RunningServer }[] = [];
afterEach(async () => {
  for (const { server, http } of running.splice(0)) { server.close(); await http.close(200); }
});

const TOKENS = [
  { name: 'ci', role: 'publish' as const, token: 'publish-token-12345' },
  { name: 'critic', role: 'critic' as const, token: 'critic-token-12345' },
  { name: 'eyes', role: 'read' as const, token: 'read-token-1234567' }
];

async function start(tokens: typeof TOKENS | 'open' = 'open') {
  const server = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data', ...(tokens === 'open' ? {} : { tokens }), refreshMs: 60_000, heartbeatMs: 50 });
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
  running.push({ server, http });
  await server.ready;
  const url = `http://127.0.0.1:${http.port}`;
  return { server, url, publisher: httpStore({ url, ...(tokens === 'open' ? {} : { token: TOKENS[0]!.token }), retries: 0 }) };
}

const png = (id: string) => new TextEncoder().encode(`\x89PNG fake image of ${id}`);
const state = (id: string, extra: Record<string, unknown> = {}) => ({ id, route: `/${id}`, screenshot: { data: png(id) }, ...extra });
const pad = (n: number) => String(n).padStart(3, '0');

describe('catalog access for critics', () => {
  test('1. a page size smaller than the catalog: a cursor visits each entry exactly once, in a stable order', async () => {
    const { url, publisher } = await start();
    const ids = Array.from({ length: 23 }, (_, i) => `screen-${pad(i)}`);
    // Published in a scrambled order and by several producers: the order a critic sees does not depend on it.
    await publishChecks(publisher, uiStateLayer({ producer: 'b', recordedAtMs: 1, environment: 'desktop-web', states: ids.filter((_, i) => i % 2).map(id => state(id)) }));
    await publishChecks(publisher, uiStateLayer({ producer: 'a', recordedAtMs: 2, environment: 'desktop-web', states: ids.filter((_, i) => !(i % 2)).reverse().map(id => state(id)) }));
    const client = createCatalogClient({ url });
    const seen: string[] = [];
    let pages = 0;
    for (let cursor: string | undefined; ;) {
      const page = await client.page({ limit: 5, ...(cursor ? { cursor } : {}) });
      expect(page.total).toBe(23);
      seen.push(...page.entries.map(entry => entry.stateId));
      pages += 1;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(pages).toBe(5);
    expect(seen).toEqual(ids);
    // The whole read is the same list, and a second pass is the same order.
    expect((await client.read({})).entries.map(entry => entry.stateId)).toEqual(ids);
    expect(await (await fetch(`${url}/api/reports/ui-catalog/entries?cursor=not-a-cursor!`)).status).toBe(400);
  });

  test('1b. filters narrow what is iterated: state kind, area, words, and what a critic has not judged yet', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'desktop-web', states: [state('home', { kind: 'screen', area: 'shop' }), state('spinner', { kind: 'loading', area: 'shop' }), state('settings', { area: 'account' })] }));
    const client = createCatalogClient({ url });
    expect((await client.read({ state: ['loading'] })).entries.map(entry => entry.stateId)).toEqual(['spinner']);
    expect((await client.read({ area: ['account'] })).entries.map(entry => [entry.stateId, entry.state])).toEqual([['settings', 'unknown']]);
    expect((await client.read({ q: 'hom' })).entries.map(entry => entry.stateId)).toEqual(['home']);

    const critic = defineCritic({ name: 'uiclip', version: '1.0.0', describe: () => ({ sendsImagesTo: null, needsSetup: false }), evaluate: async () => ({ verdict: { score: 0.4 } }) });
    const all = (await client.read({})).entries;
    const home = all.find(entry => entry.stateId === 'home')!;
    const outcomes: CritiqueOutcome[] = [{ entry: { key: home.key, title: home.title, state: home.state, imageSha256: home.image.sha256 }, critique: buildCritique(critic, critic.describe(), { key: home.key, title: home.title, state: home.state, imageSha256: home.image.sha256 }, { verdict: { score: 0.4 } }) }];
    await publishCritiques(publisher, { critic, outcomes, recordedAtMs: 5 });
    expect((await client.read({ unjudgedBy: { name: 'uiclip', version: '1.0.0' } })).entries.map(entry => entry.stateId)).toEqual(['settings', 'spinner']);
    // Another version has not judged it; another critic neither.
    expect((await client.read({ unjudgedBy: { name: 'uiclip', version: '2.0.0' } })).entries).toHaveLength(3);
    expect((await client.read({ unjudgedBy: { name: 'uiclip' } })).entries).toHaveLength(2);
    const judged = (await client.read({})).entries.find(entry => entry.stateId === 'home')!;
    expect(judged.critiques).toHaveLength(1);
    expect(judged.critiques[0]).toMatchObject({ currency: 'current', producer: 'critic.uiclip', status: 'passed' });
  });

  test('1c. an entry whose picture changed is judged again: the old critique is shown as judging an earlier image', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: [state('home')] }));
    const client = createCatalogClient({ url });
    const [before] = (await client.read({})).entries;
    const critic = defineCritic({ name: 'uiclip', version: '1.0.0', describe: () => ({ sendsImagesTo: null, needsSetup: false }), evaluate: async () => ({ verdict: { score: 0.4 } }) });
    const subject = { key: before!.key, title: before!.title, state: before!.state, imageSha256: before!.image.sha256 };
    await publishCritiques(publisher, { critic, outcomes: [{ entry: subject, critique: buildCritique(critic, critic.describe(), subject, { verdict: { score: 0.4 } }) }], recordedAtMs: 5 });
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 10, environment: 'ios', states: [{ id: 'home', route: '/home', screenshot: { data: png('home-redesigned') } }] }));
    const [after] = (await client.read({})).entries;
    expect(after!.image.sha256).not.toBe(before!.image.sha256);
    expect(after!.critiques.map(found => found.currency)).toEqual(['earlier-image']);
    expect((await client.read({ unjudgedBy: { name: 'uiclip' } })).entries.map(entry => entry.stateId)).toEqual(['home']);
  });

  test('2. a critic that holds a version asks `since` it and receives only what was added or changed; an unknown version gets everything', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: [state('a'), state('b')] }));
    const client = createCatalogClient({ url });
    const first = await client.read({});
    expect(first.entries.map(entry => entry.stateId)).toEqual(['a', 'b']);
    // Nothing new: nothing comes.
    const quiet = await client.read({ since: first.version });
    expect(quiet.entries).toEqual([]);
    expect(quiet.sinceHonored).toBe(true);
    // A shard adds one state; another recaptures `a` with a new picture.
    await publishChecks(publisher, uiStateLayer({ producer: 'shard-2', recordedAtMs: 2, environment: 'ios', states: [state('c')] }));
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 3, environment: 'ios', states: [{ id: 'a', screenshot: { data: png('a-v2') } }] }));
    const delta = await client.read({ since: first.version });
    expect(delta.entries.map(entry => entry.stateId).sort()).toContain('c');
    expect(delta.entries.map(entry => entry.stateId).sort()).toContain('a');
    expect(delta.entries.find(entry => entry.stateId === 'a')!.image.sha256).toBe(await sha256Hex(png('a-v2')));
    expect(delta.version).not.toBe(first.version);
    // A version the server has never seen is answered with the whole catalog, and says so.
    const unknown = await client.read({ since: 'f'.repeat(20) });
    expect(unknown.sinceHonored).toBe(false);
    expect(unknown.entries.map(entry => entry.stateId)).toEqual(['a', 'b', 'c']);
  });

  test('3. following the stream: after the connection drops, the catch-up read misses no entry and hands none over twice', async () => {
    const { url, publisher, server } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: [state('a')] }));
    const client = createCatalogClient({ url });
    const controller = new AbortController();
    const handed: string[] = [];
    const batches: { initial: boolean; entries: string[] }[] = [];
    const reading = (async () => {
      for await (const batch of client.follow({ signal: controller.signal, reconnectMs: 20 })) {
        batches.push({ initial: batch.initial, entries: batch.entries.map(entry => entry.stateId) });
        handed.push(...batch.entries.map(entry => entry.stateId));
      }
    })();
    const until = async (done: () => boolean) => { const deadline = Date.now() + 5000; while (!done() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20)); expect(done()).toBe(true); };
    await until(() => handed.length === 1);
    expect(batches[0]).toEqual({ initial: true, entries: ['a'] });
    // Live: an entry arrives while the stream is open.
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 2, environment: 'ios', states: [state('b')] }));
    await until(() => handed.includes('b'));
    // The connection drops (every viewer is let go); entries arrive while the follower is away.
    server.events.close();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 3, environment: 'ios', states: [state('c'), state('d')] }));
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 3, environment: 'ios', states: [state('c'), state('d')] }));
    await until(() => handed.includes('c') && handed.includes('d'));
    // A later arrival is still followed after the reconnection.
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 4, environment: 'ios', states: [state('e')] }));
    await until(() => handed.includes('e'));
    controller.abort();
    await reading;
    expect(handed.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('4. a picture is fetched by its hash through the safe attachment path, and bytes that are not the hash are refused', async () => {
    const { url, publisher } = await start();
    await publishChecks(publisher, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: [state('a')] }));
    const client = createCatalogClient({ url });
    const [entry] = (await client.read({})).entries;
    expect(entry!.image.path).toMatch(/^\/layers\/[0-9a-f]{64}\/blobs\/attachments\/[0-9a-f]{64}$/);
    expect(entry!.image.sha256).toBe(await sha256Hex(png('a')));
    expect(await client.image(entry!)).toEqual(png('a'));
    // The same path every viewer uses: untrusted bytes are served with their defences.
    const served = await fetch(`${url}/api/reports${entry!.image.path}`);
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toContain("default-src 'none'");
    await expect(client.image({ image: { ...entry!.image, sha256: 'e'.repeat(64) } })).rejects.toThrow(/not the bytes the catalog hashed/);
  });

  test('17/18. a server with tokens answers 401 without one; a read token reads the catalog; a critic token reads and does not leak', async () => {
    const { url } = await start(TOKENS);
    expect((await fetch(`${url}/api/reports/ui-catalog/entries`)).status).toBe(401);
    await expect(createCatalogClient({ url, retries: 0 }).page()).rejects.toThrow(/wants a token/);
    await expect(createCatalogClient({ url, token: 'wrong-token-1234567', retries: 0 }).page()).rejects.toThrow(/wants a token/);
    expect((await createCatalogClient({ url, token: TOKENS[1]!.token }).page()).entries).toEqual([]);
    expect((await createCatalogClient({ url, token: TOKENS[2]!.token }).page()).entries).toEqual([]);
    // The token is a header, never part of an address or an error.
    try { await createCatalogClient({ url, token: 'wrong-token-1234567', retries: 0 }).page(); } catch (error) { expect(String(error)).not.toContain('wrong-token-1234567'); }
  });
});
