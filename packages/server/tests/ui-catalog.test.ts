import { afterEach, describe, expect, test } from 'bun:test';

import { applyEffectiveDelta, isEffectiveDelta } from '../../reports/src/effective-delta';
import { httpStore } from '../../reports/src/http-store';
import { publishChecks } from '../../reports/src/publish-checks';
import type { EffectiveEvidence } from '../../reports/src/report-index';
import { uiCatalog, type UiCatalog } from '../../reports/src/ui-catalog';
import { uiPlanLayer, uiStateLayer } from '../../reports/src/ui-catalog-publish';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { listen, type RunningServer } from '../src/host';

const running: { server: AtlasServer; http: RunningServer }[] = [];
afterEach(async () => {
  for (const { server, http } of running.splice(0)) { server.close(); await http.close(200); }
});

async function start() {
  const server = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data', refreshMs: 60_000, heartbeatMs: 50 });
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
  running.push({ server, http });
  await server.ready;
  const url = `http://127.0.0.1:${http.port}`;
  return { server, url, store: httpStore({ url }) };
}

async function listenTo(url: string) {
  const response = await fetch(`${url}/api/events`);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const next = async (until: (text: string) => boolean, ms = 3000) => {
    const deadline = Date.now() + ms;
    while (!until(text) && Date.now() < deadline) {
      const result = await Promise.race([reader.read(), new Promise<null>(resolve => setTimeout(() => resolve(null), 100))]);
      if (result && !result.done) text += decoder.decode(result.value);
    }
    return text;
  };
  return { next, close: () => reader.cancel() };
}

const shot = (id: string) => ({ id, route: `/${id}`, covers: [id], screenshot: { data: new TextEncoder().encode(`png:${id}`) } });
const catalogAt = async (url: string, query = '') => (await fetch(`${url}/api/reports/ui-catalog${query}`)).json() as Promise<UiCatalog>;
const cells = (catalog: UiCatalog) => catalog.states.flatMap(state => state.cells.map(cell => `${state.id}|${cell.profile.label}|${cell.coverage}`)).sort();

describe('R2: realtime loading', () => {
  test('5. a capture produced while a viewer is open is announced on the stream and is in the catalog, with nothing rebuilt', async () => {
    const { url, store } = await start();
    const stream = await listenTo(url);
    await stream.next(text => text.includes('event: hello'));
    expect((await catalogAt(url)).states).toEqual([]);
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 5, environment: 'desktop-web', profile: { viewport: '1280x800' }, shard: '1/2', states: [shot('home')] }));
    const text = await stream.next(value => value.includes('event: report'));
    expect(JSON.parse(/event: report\ndata: (.*)\n/.exec(text)![1]!).added[0]).toMatchObject({ producer: 'capture', environment: 'desktop-web' });
    const catalog = await catalogAt(url);
    expect(cells(catalog)).toEqual(['home|Desktop web · 1280x800|captured']);
    expect(catalog.states[0]!.cells[0]!.capture!.labels.shard).toBe('1/2');
    await stream.close();
  });

  test('6. after the stream drops, one delta read brings every capture produced meanwhile: none missing and none duplicated', async () => {
    const { url, store } = await start();
    const states = ['a', 'b', 'c', 'd'];
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, environment: 'ios', states: states.slice(0, 2).map(shot) }));
    const held = await (await fetch(`${url}/api/reports/evidence/effective`)).json() as EffectiveEvidence;
    const before = uiCatalog(held.layers);
    expect(cells(before)).toHaveLength(2);
    // The viewer is offline: a shard finishes, another re-runs a capture the viewer already holds, one repeats a layer.
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 2, environment: 'ios', states: states.slice(2).map(shot) }));
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 3, environment: 'ios', states: [shot('a')] }));
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 2, environment: 'ios', states: states.slice(2).map(shot) }));
    const stream = await listenTo(url);
    const hello = await stream.next(text => text.includes('event: hello'));
    expect(JSON.parse(/event: hello\ndata: (.*)\n/.exec(hello)![1]!).version).not.toBe(held.version);
    const answer = await (await fetch(`${url}/api/reports/evidence/effective?since=${held.version}`)).json();
    expect(isEffectiveDelta(answer)).toBe(true);
    const applied = applyEffectiveDelta(held, answer as never)!;
    const viewer = uiCatalog(applied.layers);
    const server = await catalogAt(url);
    expect(cells(viewer)).toEqual(['a|iOS|captured', 'b|iOS|captured', 'c|iOS|captured', 'd|iOS|captured']);
    expect(cells(viewer)).toEqual(cells(server));
    expect(viewer.states.find(state => state.id === 'a')!.cells[0]!.capture!.origin.recordedAtMs).toBe(3);
    await stream.close();
  });

  test('7. while a collection is in progress, what has not been produced is not shown as captured', async () => {
    const { url, store } = await start();
    await publishChecks(store, uiPlanLayer({ producer: 'planner', recordedAtMs: 1, environment: 'ios', states: ['a', 'b', 'c'].map(id => ({ id })) }));
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 2, environment: 'ios', states: [shot('a'), { ...shot('b'), status: 'running' }] }));
    const catalog = await catalogAt(url);
    expect(cells(catalog)).toEqual(['a|iOS|captured', 'b|iOS|capturing', 'c|iOS|missing']);
    expect(catalog.summary).toMatchObject({ planned: true, coverage: { captured: 1, capturing: 1, missing: 1 } });
    // The collection finishes: b is captured, replacing the running mark, and the plan is still what it was.
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 3, environment: 'ios', states: [shot('b')] }));
    expect(cells(await catalogAt(url))).toEqual(['a|iOS|captured', 'b|iOS|captured', 'c|iOS|missing']);
  });
});

describe('the catalog route', () => {
  test('narrows by the same words the viewer uses, pages, answers Markdown, and revalidates with an ETag', async () => {
    const { url, store } = await start();
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, environment: 'desktop-web', states: [shot('cart'), shot('home'), { ...shot('checkout'), status: 'failed', detail: 'timed out waiting for #total' }] }));
    expect((await catalogAt(url, '?coverage=failed')).states.map(state => state.id)).toEqual(['checkout']);
    expect((await catalogAt(url, '?q=nothing-like-it')).states).toEqual([]);
    expect((await catalogAt(url, '?q=home')).states.map(state => state.id)).toEqual(['home']);
    expect(await catalogAt(url, '?limit=1&offset=1')).toMatchObject({ total: 3, offset: 1, limit: 1, states: [{ id: 'checkout' }] });
    const markdown = await (await fetch(`${url}/api/reports/ui-catalog?format=markdown`)).text();
    expect(markdown).toContain('# UI catalog');
    expect(markdown).toContain('checkout');
    const first = await fetch(`${url}/api/reports/ui-catalog`);
    const etag = first.headers.get('etag')!;
    expect((await fetch(`${url}/api/reports/ui-catalog`, { headers: { 'if-none-match': etag } })).status).toBe(304);
    // Another producer's checks leave it as it was; a new capture changes it.
    await publishChecks(store, { producer: 'unit', recordedAtMs: 2, checks: [{ id: 'plain', title: 'plain', status: 'passed' }] });
    expect((await catalogAt(url)).states).toHaveLength(3);
  });

  test('the picture of a capture is served from the layer, lazily, as the file the producer gave', async () => {
    const { url, store } = await start();
    await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 1, environment: 'desktop-web', states: [shot('home')] }));
    const image = (await catalogAt(url)).states[0]!.cells[0]!.capture!.image!;
    const response = await fetch(`${url}/api/reports${image.path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(await response.text()).toBe('png:home');
  });
});
