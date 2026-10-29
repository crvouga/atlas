import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { UiCatalogSchema } from '../../schema/src/api';
import { ReportIndex } from '../src/report-index';
import { filterUiCatalog, pageUiCatalog, parseUiCatalogQuery, uiCatalog, uiCatalogMarkdown, uiCatalogParams, type UiCatalog } from '../src/ui-catalog';
import { diffUiCatalogs } from '../src/ui-catalog-diff';
import { uiCatalogHtml } from '../src/ui-catalog-export';
import { uiPlanLayer, uiStateLayer } from '../src/ui-catalog-publish';
import { publishChecks } from '../src/publish-checks';
import { UI_STATE_EXTENSION, uiStateFacts, uiStateOf } from '../src/ui-state';
import { memoryStore } from './memory-store';
import { contractCatalog } from './ui-catalog-fixture';

/**
 * The UI catalog document is a contract other projects read (the viewer, `GET /api/reports/ui-catalog`, the export, a critic).
 * `fixtures/ui-catalog-v1.json` is what version 1 of it looked like when it was frozen. Like `layer-v1.json`, it is never edited to
 * make a test pass: within a schema version a document may gain fields, never lose one or change what one means.
 */
const frozen = JSON.parse(readFileSync(path.join(import.meta.dir, 'fixtures', 'ui-catalog-v1.json'), 'utf8')) as UiCatalog;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Everything in `expected` is in `actual`, with the same value; `actual` may have more. Arrays match item by item. */
function missing(expected: unknown, actual: unknown, where = '$'): string[] {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return [`${where}: the list changed (${Array.isArray(actual) ? actual.length : typeof actual} items, expected ${expected.length})`];
    return expected.flatMap((item, i) => missing(item, actual[i], `${where}[${i}]`));
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return [`${where}: no longer an object`];
    return Object.entries(expected).flatMap(([key, value]) => (key in actual ? missing(value, (actual as Record<string, unknown>)[key], `${where}.${key}`) : [`${where}.${key}: gone`]));
  }
  return Object.is(expected, actual) ? [] : [`${where}: ${JSON.stringify(expected)} became ${JSON.stringify(actual)}`];
}

describe('the version 1 document is frozen', () => {
  test('what the first version wrote is still written, with the same meaning; only additions are allowed', async () => {
    expect(missing(frozen, JSON.parse(JSON.stringify(await contractCatalog())))).toEqual([]);
  });

  test('the frozen document is a valid response, and so is the current one', async () => {
    expect(UiCatalogSchema.safeParse(frozen).success).toBe(true);
    expect(UiCatalogSchema.safeParse(JSON.parse(JSON.stringify(await contractCatalog()))).success).toBe(true);
  });

  test('a document written before attributes existed is still read by every reader', () => {
    const old = clone(frozen) as unknown as { states: { attributes?: unknown }[]; facets: { attributes?: unknown } };
    for (const state of old.states) delete state.attributes;
    delete old.facets.attributes;
    const document = old as unknown as UiCatalog;
    expect(UiCatalogSchema.safeParse(document).success).toBe(true);
    expect(filterUiCatalog(document, { attribute: ['locale=en-US'] }).states).toEqual([]);
    expect(filterUiCatalog(document, { q: 'payment' }).states.map(state => state.id)).toEqual(['checkout/payment']);
    expect(uiCatalogMarkdown(document)).toContain('checkout/payment');
    expect(uiCatalogHtml(document)).toContain('Payment');
    expect(diffUiCatalogs(document, document).entries.every(entry => entry.change === 'unchanged' || entry.change === 'unverified')).toBe(true);
  });
});

describe('readers tolerate what a later version adds', () => {
  /** A document from a later minor version: a new field on every object and a coverage, expectation and surface status this version has never heard of. */
  function future(): UiCatalog {
    const walk = (value: unknown, where: string): void => {
      if (Array.isArray(value)) { value.forEach((item, i) => walk(item, `${where}[${i}]`)); return; }
      if (value === null || typeof value !== 'object') return;
      const holder = value as Record<string, unknown>;
      // Maps whose keys are data, not fields.
      if (!/(parameters|labels|attributes|coverage)$/.test(where)) holder['x-from-the-future'] = { where };
      for (const [key, inner] of Object.entries(holder)) if (key !== 'x-from-the-future') walk(inner, `${where}.${key}`);
    };
    const document = clone(frozen) as unknown as { states: { cells: { coverage: string; expected: string }[] }[]; surfaces: { status: string }[]; summary: { coverage: Record<string, number> } };
    walk(document, 'catalog');
    document.states[0]!.cells[0]!.coverage = 'quarantined';
    document.states[0]!.cells[0]!.expected = 'deferred';
    document.surfaces[0]!.status = 'retired';
    document.summary.coverage.quarantined = 1;
    return document as unknown as UiCatalog;
  }

  test('the schema accepts new fields and new words, and keeps them', () => {
    const parsed = UiCatalogSchema.safeParse(future());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.states[0]!.cells[0]!.coverage).toBe('quarantined');
    expect((parsed.data as Record<string, unknown>)['x-from-the-future']).toEqual({ where: 'catalog' });
    expect((parsed.data.states[0] as Record<string, unknown>)['x-from-the-future']).toBeDefined();
  });

  test('filtering, paging, Markdown, the single file and a comparison do not fail, and never call a new word a capture', () => {
    const document = future();
    expect(pageUiCatalog(filterUiCatalog(document, { coverage: ['captured'] }), { limit: 1 }).states.length).toBeLessThanOrEqual(1);
    expect(uiCatalogMarkdown(document)).toContain('quarantined');
    const html = uiCatalogHtml(document);
    expect(html).toContain('quarantined');
    expect(html).not.toContain('undefined');
    const changes = diffUiCatalogs(frozen, document).entries.filter(entry => entry.change !== 'unchanged');
    // A picture given only by address cannot be told apart by content, in either document; the new word is the one change of coverage.
    expect(changes.map(entry => entry.change).filter(change => change !== 'unverified')).toEqual(['coverage']);
  });

  test('a filter, a query word or a parameter this version does not know is ignored, not an error', () => {
    const params = new URLSearchParams('q=payment&coverage=captured,quarantined&sort=newest&view=grid&attribute=locale%3Den-US');
    const query = parseUiCatalogQuery(params);
    expect(query).toEqual({ q: 'payment', coverage: ['captured'], attribute: ['locale=en-US'] });
    expect(uiCatalogParams(query).toString()).toBe('q=payment&coverage=captured&attribute=locale%3Den-US');
  });
});

describe('the convention in a layer is open', () => {
  test('a producer that writes more than this version reads is read for what it knows, and the rest stays in the layer', () => {
    const check = { extensions: { [UI_STATE_EXTENSION]: { route: '/x', from: 'the-future', flags: ['a', 7, null], covers: 'not-a-list', attributes: { locale: 'fr', depth: 3, tree: { no: 'thanks' }, '': 'nameless' }, weird: { nested: true } } } };
    expect(uiStateFacts(check)).toEqual({ route: '/x', flags: ['a'], attributes: { depth: '3', locale: 'fr' } });
    expect(uiStateOf('ui-state', check)).toEqual({ route: '/x', flags: ['a'], attributes: { depth: '3', locale: 'fr' } });
    // Reading never edits what was written.
    expect((check.extensions[UI_STATE_EXTENSION] as Record<string, unknown>).from).toBe('the-future');
  });

  test('attributes are bounded: a state keeps at most 32 of them, each name and value bounded', () => {
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${String(i).padStart(2, '0')}`, 'v'.repeat(2000)]));
    const facts = uiStateFacts({ extensions: { [UI_STATE_EXTENSION]: { attributes: many } } });
    expect(Object.keys(facts.attributes!)).toHaveLength(32);
    expect(Object.keys(facts.attributes!)[0]).toBe('k00');
    expect(Object.values(facts.attributes!).every(value => value.length === 512)).toBe(true);
  });
});

describe('attributes: a new dimension without a new version', () => {
  const profile = { environment: 'desktop-web', profile: { viewport: '1280x800' } } as const;

  async function catalogOf(layers: readonly { producer: string; at: number; attributes?: Record<string, string>; ids: string[] }[]) {
    const store = memoryStore();
    for (const layer of layers) {
      await publishChecks(store, uiStateLayer({
        producer: layer.producer, recordedAtMs: layer.at, ...profile,
        states: layer.ids.map(id => ({ id, ...(layer.attributes ? { attributes: layer.attributes } : {}), screenshot: { data: new TextEncoder().encode(`${id}${layer.producer}`) } }))
      }));
    }
    const index = new ReportIndex([{ id: 'a', store }]);
    await index.refresh();
    return uiCatalog(index.snapshot().layers);
  }

  test('a producer declares them, the catalog carries them, offers them as a filter and finds them by word', async () => {
    const catalog = await catalogOf([{ producer: 'p', at: 1, attributes: { locale: 'de-DE', brand: 'acme' }, ids: ['home', 'cart'] }, { producer: 'q', at: 1, attributes: { locale: 'en-US' }, ids: ['settings'] }]);
    expect(catalog.states.find(state => state.id === 'home')!.attributes).toEqual({ brand: 'acme', locale: 'de-DE' });
    expect(catalog.facets.attributes).toEqual([{ value: 'brand=acme', count: 2 }, { value: 'locale=de-DE', count: 2 }, { value: 'locale=en-US', count: 1 }]);
    expect(filterUiCatalog(catalog, { attribute: ['locale=de-DE'] }).states.map(state => state.id)).toEqual(['cart', 'home']);
    expect(filterUiCatalog(catalog, { attribute: ['locale=de-DE', 'locale=en-US'] }).states).toHaveLength(3);
    expect(filterUiCatalog(catalog, { attribute: ['locale=de-DE', 'brand=nope'] }).states).toHaveLength(0);
    expect(filterUiCatalog(catalog, { attribute: ['brand'] }).states).toHaveLength(0);
    expect(filterUiCatalog(catalog, { q: 'acme' }).states).toHaveLength(2);
    expect(parseUiCatalogQuery(uiCatalogParams({ attribute: ['locale=de-DE'] }))).toEqual({ attribute: ['locale=de-DE'] });
  });

  test('they never split a slot: a producer that adds one still replaces its own earlier capture', async () => {
    const catalog = await catalogOf([{ producer: 'p', at: 1, ids: ['home'] }, { producer: 'p', at: 2, attributes: { locale: 'fr' }, ids: ['home'] }]);
    expect(catalog.states).toHaveLength(1);
    expect(catalog.states[0]!.cells).toHaveLength(1);
    expect(catalog.states[0]!.cells[0]!.capture!.alternatives).toBe(0);
    expect(catalog.states[0]!.attributes).toEqual({ locale: 'fr' });
  });

  test('where producers disagree, the newest result wins a name, whatever order the layers arrive in', async () => {
    const layers = [{ producer: 'p', at: 1, attributes: { locale: 'old', only: 'p' }, ids: ['home'] }, { producer: 'q', at: 9, attributes: { locale: 'new' }, ids: ['home'] }];
    const forward = await catalogOf(layers), backward = await catalogOf([...layers].reverse());
    expect(forward.states[0]!.attributes).toEqual({ locale: 'new', only: 'p' });
    expect(JSON.stringify(backward.states)).toBe(JSON.stringify(forward.states));
  });

  test('a plan can declare them too, and a plan-only state carries them', async () => {
    const store = memoryStore();
    await publishChecks(store, uiPlanLayer({ producer: 'plan', recordedAtMs: 1, ...profile, states: [{ id: 'later', attributes: { locale: 'ja' } }] }));
    const index = new ReportIndex([{ id: 'a', store }]);
    await index.refresh();
    const catalog = uiCatalog(index.snapshot().layers);
    expect(catalog.states[0]).toMatchObject({ id: 'later', attributes: { locale: 'ja' } });
    expect(catalog.states[0]!.cells[0]!.coverage).toBe('missing');
  });

  test('two backends holding the same layers give the same attributes', async () => {
    const a = memoryStore(), b = memoryStore();
    await publishChecks(a, uiStateLayer({ producer: 'p', recordedAtMs: 1, ...profile, states: [{ id: 'one', attributes: { locale: 'x' } }] }));
    await publishChecks(b, uiStateLayer({ producer: 'q', recordedAtMs: 2, ...profile, states: [{ id: 'two', attributes: { locale: 'x' } }] }));
    const index = new ReportIndex([{ id: 'a', store: a }, { id: 'b', store: b }]);
    await index.refresh();
    const catalog = uiCatalog(index.snapshot().layers);
    expect(filterUiCatalog(catalog, { attribute: ['locale=x'] }).states.map(state => state.id)).toEqual(['one', 'two']);
  });
});
