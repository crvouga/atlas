import { describe, expect, test } from 'bun:test';

import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { catalogEntries, catalogEntryKey, decodeEntryCursor, encodeEntryCursor, pageCatalogEntries, parseCatalogEntriesQuery, catalogEntriesParams } from '../src/ui-catalog-entries';
import { uiStateLayer } from '../src/ui-catalog-publish';
import { memoryStore } from './memory-store';

const png = (id: string) => new TextEncoder().encode(`png:${id}`);

async function entriesOf(store: ReturnType<typeof memoryStore>) {
  const index = new ReportIndex([{ id: 'data', store }]);
  await index.refresh();
  return { index, ...catalogEntries(index.snapshot().layers) };
}

describe('catalog entries', () => {
  test('one entry per captured state and profile, keyed uniquely, with the hash of the stored picture', async () => {
    const store = memoryStore();
    await publishChecks(store, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'dark' }, states: [{ id: 'home', kind: 'overlay', screenshot: { data: png('dark') } }] }));
    await publishChecks(store, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'light' }, states: [{ id: 'home', screenshot: { data: png('light') } }] }));
    const { entries, unjudgeable } = await entriesOf(store);
    expect(unjudgeable).toBe(0);
    expect(entries.map(entry => entry.key)).toEqual(['home@mobile-web;scheme=dark;viewport=390x844', 'home@mobile-web;scheme=light;viewport=390x844']);
    // The kind belongs to the state, whatever the profile that declared it.
    expect(entries.map(entry => entry.state)).toEqual(['overlay', 'overlay']);
    expect(new Set(entries.map(entry => entry.image.sha256)).size).toBe(2);
  });

  test('a state that declared no kind is `unknown`, not a screen', async () => {
    const store = memoryStore();
    await publishChecks(store, uiStateLayer({ producer: 'cap', recordedAtMs: 1, states: [{ id: 'home', screenshot: { data: png('home') } }] }));
    expect((await entriesOf(store)).entries.map(entry => [entry.key, entry.state])).toEqual([['home', 'unknown']]);
  });

  test('a capture that failed, one given only by address, and a plan are not entries to judge; the first two are counted', async () => {
    const store = memoryStore();
    await publishChecks(store, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: [
      { id: 'ok', screenshot: { data: png('ok') } }, { id: 'broken', status: 'failed', detail: 'never ready', screenshot: { data: png('broken') } }, { id: 'remote', screenshot: { uri: 'https://example.com/a.png' } }
    ] }));
    const { entries, unjudgeable } = await entriesOf(store);
    expect(entries.map(entry => entry.stateId)).toEqual(['ok']);
    expect(unjudgeable).toBe(1);
  });

  test('the key is the state id when the profile says nothing, and never collides across profiles', () => {
    expect(catalogEntryKey('home', { environment: null, parameters: {} })).toBe('home');
    expect(catalogEntryKey('home', { environment: 'ios', parameters: {} })).toBe('home@ios');
    expect(catalogEntryKey('home', { environment: 'ios', parameters: { a: 'b;c=d' } })).not.toBe(catalogEntryKey('home', { environment: 'ios', parameters: { a: 'b', c: 'd' } }));
  });

  test('a cursor round-trips any key and nothing else is accepted', () => {
    for (const key of ['home', 'checkout/payment@ios;a=b', 'ünï/cödé']) expect(decodeEntryCursor(encodeEntryCursor(key))).toBe(key);
    for (const bad of ['', '!!!', 'abc', encodeEntryCursor('x') + '=']) expect(decodeEntryCursor(bad)).toBeNull();
  });

  test('paging by cursor is stable while entries arrive: nothing is repeated, and a late entry that sorts earlier is found by `since`', async () => {
    const store = memoryStore();
    await publishChecks(store, uiStateLayer({ producer: 'cap', recordedAtMs: 1, environment: 'ios', states: ['b', 'd', 'f'].map(id => ({ id, screenshot: { data: png(id) } })) }));
    const first = await entriesOf(store);
    const page1 = pageCatalogEntries(first.entries, { limit: 2 });
    expect(page1.entries.map(entry => entry.stateId)).toEqual(['b', 'd']);
    const version = first.index.snapshot().version;
    await publishChecks(store, uiStateLayer({ producer: 'cap2', recordedAtMs: 2, environment: 'ios', states: [{ id: 'a', screenshot: { data: png('a') } }] }));
    await first.index.refresh();
    const second = catalogEntries(first.index.snapshot().layers);
    const page2 = pageCatalogEntries(second.entries, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.entries.map(entry => entry.stateId)).toEqual(['f']);
    const changed = first.index.changedSince(version);
    expect(pageCatalogEntries(second.entries, { since: version }, changed).entries.map(entry => entry.stateId)).toEqual(['a']);
    expect(pageCatalogEntries(second.entries, { since: 'unknown' }, first.index.changedSince('unknown')).entries).toHaveLength(4);
  });

  test('queries read from and write to URL parameters', () => {
    const query = parseCatalogEntriesQuery(new URLSearchParams('state=loading,overlay&area=shop&unjudgedBy=uiclip@1.2.0&limit=5&since=abc&q=pay%20now&limit=x'));
    expect(query).toEqual({ q: 'pay now', area: ['shop'], state: ['loading', 'overlay'], unjudgedBy: { name: 'uiclip', version: '1.2.0' }, since: 'abc', limit: 5 });
    expect(parseCatalogEntriesQuery(catalogEntriesParams(query))).toEqual(query);
  });
});
