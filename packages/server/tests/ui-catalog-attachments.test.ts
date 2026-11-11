import { afterEach, describe, expect, test } from 'bun:test';

import { httpStore } from '../../reports/src/http-store';
import { collectCatalog } from '../../reports/src/ui-catalog-collect';
import type { UiCatalog } from '../../reports/src/ui-catalog';
import { memoryStore } from '../../reports/tests/memory-store';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { listen } from '../src/host';

const servers: AtlasServer[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  for (const close of closers.splice(0)) await close();
});

const TOKEN = 'publish-token-12345';

async function serve() {
  const server = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data', tokens: [{ name: 'ci', role: 'publish', token: TOKEN }], refreshMs: 60_000 });
  servers.push(server);
  await server.ready;
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
  closers.push(() => http.close(100));
  return { server, url: `http://127.0.0.1:${http.port}` };
}

describe('#90: collecting captures with supplemental attachments', () => {
  test('1, 2, 4: views and a trace are published with their state; one past the byte budget is omitted, the failure stays failed', async () => {
    const { server, url } = await serve();
    const result = await collectCatalog({
      store: httpStore({ url, token: TOKEN }), catalog: { name: 'web', maxAttempts: 1, states: [{ id: 'home' }, { id: 'pay' }] }, shard: { id: 'one' }, maxBufferedBytes: 64,
      capture: async unit => unit.items.map(item => item.state.id === 'home'
        ? { item: item.key, screenshot: { data: new Uint8Array(8) }, attachments: [{ label: 'Top', data: new Uint8Array(8) }, { label: 'Bottom', data: new Uint8Array(8) }] }
        : { item: item.key, status: 'failed' as const, detail: 'never stable', screenshot: { data: new Uint8Array(8) }, attachments: [{ role: 'trace', contentType: 'application/zip', data: new Uint8Array(100) }] })
    });
    expect(result.items).toEqual({ captured: 1, failed: 1, other: 0 });
    const catalog = await (await server.fetch(new Request('http://atlas.test/api/reports/ui-catalog', { headers: { authorization: `Bearer ${TOKEN}` } }))).json() as UiCatalog;
    const cell = (id: string) => catalog.states.find(state => state.id === id)!.cells.find(item => item.capture)!;
    expect(cell('home').coverage).toBe('captured');
    expect(cell('home').capture!.attachments!.map(item => [item.label, item.order, item.omitted ?? null])).toEqual([['Top', 0, null], ['Bottom', 1, null]]);
    expect(cell('pay').coverage).toBe('failed');
    expect(cell('pay').capture!.attachments!.map(item => [item.role, item.omitted])).toEqual([['trace', 'over-budget']]);
  });
});

describe('#91: a warm worker pool as the collector', () => {
  test('3: a shard stopped mid-capture closes the active page, publishes nothing late and releases the claim', async () => {
    const { catalogWorkerPool } = await import('../../playwright/src/ui-catalog-pool');
    const { server, url } = await serve();
    const stop = new AbortController();
    const pages: { closed: boolean }[] = [];
    let launched = 0;
    const pool = catalogWorkerPool({
      size: 2, launch: async () => ++launched,
      newPage: async () => { const page = { closed: false, screenshot: async () => new Uint8Array(4), viewportSize: () => null, close: async () => { page.closed = true; } }; pages.push(page); return page; },
      recipes: { home: {}, hang: { open: () => { setTimeout(() => stop.abort(new Error('stop')), 20); return new Promise<void>(() => {}); } } }
    });
    const result = await collectCatalog({
      store: httpStore({ url, token: TOKEN }), catalog: { name: 'web', states: [{ id: 'home' }, { id: 'hang' }] }, shard: { id: 'pool' }, batchSize: 1, concurrency: 2, signal: stop.signal, capture: pool.capture
    });
    await pool.close();
    expect(result.stoppedBy).toBe('signal');
    expect(result.items.failed).toBe(0);
    expect(pages.every(page => page.closed)).toBe(true);
    expect(launched).toBeLessThanOrEqual(2);
    const catalog = await (await server.fetch(new Request('http://atlas.test/api/reports/ui-catalog', { headers: { authorization: `Bearer ${TOKEN}` } }))).json() as UiCatalog;
    expect(catalog.states.find(state => state.id === 'hang')!.cells.every(cell => cell.coverage !== 'captured' && cell.coverage !== 'failed')).toBe(true);
  });
});
