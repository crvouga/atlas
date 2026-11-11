import { describe, expect, test } from 'bun:test';

import type { CollectItem, CollectUnit } from '../../reports/src/ui-catalog-collect';
import { CollectorInfrastructureError } from '../../reports/src/ui-catalog-collect';
import type { CapturePage } from './ui-catalog';
import { catalogWorkerPool, type CatalogRecipe } from './ui-catalog-pool';

/** A stub browser: counts the pages it made and whether it is still connected. */
type StubBrowser = { id: number; pages: StubPage[]; connected: boolean; closed: boolean };
/** A stub page with mutable state a capture could leak, and the profile it was opened for. */
type StubPage = CapturePage & { browser: number; state: string[]; closed: boolean; viewport: { width: number; height: number }; close(): Promise<void> };

const profile = (scheme: string, viewport = '390x844') => ({ key: `web|${scheme}|${viewport}`, values: { scheme }, environment: 'web', parameters: { scheme, viewport } });
const item = (state: string, scheme = 'light'): CollectItem => ({ key: `${state}@${scheme}`, state: { id: state }, profile: profile(scheme) }) as CollectItem;
const unit = (...items: CollectItem[]): CollectUnit => ({ key: items.map(entry => entry.key).join('+'), tier: 'empty', items }) as CollectUnit;

function stubs() {
  const browsers: StubBrowser[] = [];
  const launch = async (index: number) => { const browser = { id: index, pages: [], connected: true, closed: false }; browsers.push(browser); return browser; };
  const newPage = async (browser: StubBrowser, given: CollectItem) => {
    const [width, height] = given.profile.parameters.viewport!.split('x').map(Number) as [number, number];
    const page: StubPage = {
      browser: browser.id, state: [], closed: false, viewport: { width, height },
      screenshot: async () => { if (page.closed) throw new Error('page closed'); return new TextEncoder().encode(`${given.key}:${page.state.join(',')}`); },
      viewportSize: () => page.viewport,
      close: async () => { page.closed = true; }
    };
    browser.pages.push(page);
    return page;
  };
  return { browsers, launch, newPage, teardown: async (browser: StubBrowser) => { browser.closed = true; } };
}

const text = (data: Uint8Array | undefined) => new TextDecoder().decode(data);

describe('#91: a pool of warm capture workers', () => {
  test('1: a small pool amortises startup over many claims, and every capture gets a fresh, isolated page', async () => {
    const { browsers, launch, newPage, teardown } = stubs();
    const recipe: CatalogRecipe<StubPage> = { open: async page => { expect(page.state).toEqual([]); page.state.push('signed-in'); } };
    const pool = catalogWorkerPool({ size: 2, launch, newPage, teardown, recipes: { a: recipe, b: recipe, c: recipe } });
    const units = Array.from({ length: 12 }, (_, i) => unit(item(['a', 'b', 'c'][i % 3]!, i % 2 ? 'dark' : 'light')));
    const results = await Promise.all(units.map(each => pool.capture(each, new AbortController().signal)));
    expect(browsers).toHaveLength(2);
    expect(results.flat().every(result => result.status === 'passed')).toBe(true);
    // Each picture shows only its own capture's state: nothing leaked from an earlier page.
    expect(results.flat().map(result => text(result.screenshot?.data).split(':')[1])).toEqual(Array(12).fill('signed-in'));
    expect(browsers.flatMap(browser => browser.pages)).toHaveLength(12);
    expect(browsers.flatMap(browser => browser.pages).every(page => page.closed)).toBe(true);
    expect(pool.stats()).toMatchObject({ launched: 2, captures: 12, pagesOpen: 0, busy: 0 });
    await pool.close();
    expect(browsers.every(browser => browser.closed)).toBe(true);
    await expect(pool.capture(units[0]!, new AbortController().signal)).rejects.toThrow('closed');
  });

  test('2: the profile reaches the page through the hook, and the item\'s facts and id reach the capture', async () => {
    const { launch, newPage } = stubs();
    const seen: string[] = [];
    const pool = catalogWorkerPool({
      launch, newPage: async (browser, given, signal) => { seen.push(given.profile.parameters.scheme!); return newPage(browser, given); },
      recipes: given => given.state.id === 'home' ? { labels: { browser: 'stub' } } : undefined
    });
    const home = { ...item('home', 'dark'), state: { id: 'home', title: 'Home', route: '/' } } as CollectItem;
    const [shot] = await pool.capture(unit(home), new AbortController().signal);
    expect(seen).toEqual(['dark']);
    expect(shot).toMatchObject({ item: 'home@dark', status: 'passed', route: '/', labels: { browser: 'stub' }, screenshot: { width: 390, height: 844 } });
    expect('id' in shot!).toBe(false);
    expect('readiness' in shot!).toBe(false);
    await pool.close();
  });

  test('3: cancelling stops the active work, closes its page and returns nothing', async () => {
    const { browsers, launch, newPage } = stubs();
    const stop = new AbortController();
    let signalled: AbortSignal | undefined;
    const pool = catalogWorkerPool({
      launch, newPage,
      recipes: { slow: { open: async (_page, context) => { signalled = context.signal; setTimeout(() => stop.abort(new Error('claim lost')), 5); await new Promise(() => {}); } } }
    });
    await expect(pool.capture(unit(item('slow'), item('slow', 'dark')), stop.signal)).rejects.toThrow('claim lost');
    expect(signalled?.aborted).toBe(true);
    expect(browsers[0]!.pages).toHaveLength(1);
    expect(browsers[0]!.pages[0]!.closed).toBe(true);
    expect(pool.stats()).toMatchObject({ pagesOpen: 0, captures: 0, busy: 0 });
    // A capture that finishes after the cancellation is not handed back either.
    const late = new AbortController();
    const quick = catalogWorkerPool({ launch, newPage, recipes: { a: { ready: async () => { late.abort(new Error('stopping')); } } } });
    await expect(quick.capture(unit(item('a')), late.signal)).rejects.toThrow('stopping');
    await Promise.all([pool.close(), quick.close()]);
  });

  test('3: a capture waiting for a busy worker stops waiting when cancelled', async () => {
    const { launch, newPage } = stubs();
    let release!: () => void;
    const pool = catalogWorkerPool({ size: 1, launch, newPage, recipes: { hold: { open: () => new Promise<void>(resolve => { release = resolve; }) }, b: {} } });
    const first = pool.capture(unit(item('hold')), new AbortController().signal);
    const stop = new AbortController();
    const waiting = pool.capture(unit(item('b')), stop.signal);
    stop.abort(new Error('stopped while queued'));
    await expect(waiting).rejects.toThrow('stopped while queued');
    await new Promise(resolve => setTimeout(resolve, 0));
    release();
    expect((await first)[0]!.status).toBe('passed');
    await pool.close();
  });

  test('4: one recipe failing is that item\'s failure, and the next capture on the same worker is clean', async () => {
    const { browsers, launch, newPage } = stubs();
    const pool = catalogWorkerPool({
      launch, newPage,
      recipes: {
        broken: { open: async page => { page.state.push('poisoned'); throw new Error('fixture refused'); } },
        fine: {},
        flaky: { ready: async () => { throw new Error('#total not visible'); } }
      }
    });
    const results = await pool.capture(unit(item('broken'), item('fine'), item('flaky'), item('ghost')), new AbortController().signal);
    expect(results.map(result => [result.item, result.status])).toEqual([['broken@light', 'failed'], ['fine@light', 'passed'], ['flaky@light', 'failed'], ['ghost@light', 'failed']]);
    expect(results[0]!.detail).toContain('fixture refused');
    expect(text(results[1]!.screenshot?.data)).toBe('fine@light:');
    expect(results[2]!.screenshot?.data).toBeDefined();
    expect(results[3]!.detail).toContain('No recipe declares the state "ghost"');
    expect(browsers).toHaveLength(1);
    await pool.close();
  });

  test('4: a worker that is no longer healthy is replaced, and one that cannot start is an infrastructure error', async () => {
    const { browsers, launch, newPage, teardown } = stubs();
    const pool = catalogWorkerPool({ launch, newPage, teardown, healthy: browser => browser.connected, recipes: { crash: { open: async page => { browsers[page.browser]!.connected = false; } }, ok: {} } });
    await pool.capture(unit(item('crash')), new AbortController().signal);
    expect(browsers[0]!.closed).toBe(true);
    const [after] = await pool.capture(unit(item('ok')), new AbortController().signal);
    expect(after!.status).toBe('passed');
    expect(browsers).toHaveLength(2);
    await pool.close();
    const broken = catalogWorkerPool({ launch: async () => { throw new Error('no chromium'); }, newPage, recipes: {} });
    const failure = await broken.capture(unit(item('ok')), new AbortController().signal).catch(error => error);
    expect(failure).toBeInstanceOf(CollectorInfrastructureError);
    expect(failure.diagnostic).toMatchObject({ phase: 'launch', retryable: true });
  });

  test('5: reports and core never import Playwright or this adapter', async () => {
    const { Glob } = await import('bun');
    const offenders: string[] = [];
    for (const dir of ['packages/reports/src', 'packages/core/src']) {
      for await (const file of new Glob('**/*.ts').scan(dir)) {
        const source = await Bun.file(`${dir}/${file}`).text();
        if (/from ['"](playwright|@playwright\/test|playwright-core)['"]|packages\/playwright\//.test(source)) offenders.push(`${dir}/${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
